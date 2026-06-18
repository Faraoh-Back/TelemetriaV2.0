// [SERVIDOR] main.rs - DUAL DB + HTTP/WS com autenticação JWT
//
// FLUXO:
//   Edge (Jetson) ──Wi-Fi──→ TCP :8080 → decodifica → TimescaleDB + SQLite
//   Browser/App   ──HTTP──→ GET /       → index.html
//   Browser/App   ──HTTP──→ POST /login → JWT token
//   Browser/App   ──WS──→   /ws         → broadcast JSON (requer JWT)

use models::ProcessedSignal;
use sqlx::postgres::PgPoolOptions;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicI64, AtomicU64};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tracing::{info, warn};

mod api;
mod auth;
mod config;
mod db;
mod decoder;
mod ingest;
mod models;
mod ntp;
mod track_state;
mod ws;

use config::*;
use track_state::RealtimeTrackState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Validar variáveis de ambiente obrigatórias
    let _ = get_pg_url();
    let _ = get_jwt_secret();

    info!("🚀 Telemetry Server v2.2 — Dual DB + JWT Auth");
    info!("   TimescaleDB → tempo real | SQLite → histórico + users");

    std::fs::create_dir_all("./data")?;
    std::fs::create_dir_all("./static")?;

    let can_map_source = std::env::var("CAN_MAP_SOURCE")
        .unwrap_or_else(|_| "dbc".to_string())
        .to_lowercase();
    let decoder_map = match can_map_source.as_str() {
        "csv" => {
            let map = decoder::load_can_mappings(CSV_DATA_PATH)?;
            info!(
                "✅ {} CAN IDs carregados de CSV ({})",
                map.len(),
                CSV_DATA_PATH
            );
            map
        }
        "dbc" => match decoder::load_can_mappings_from_dbc_dir(DBC_DATA_PATH) {
            Ok(map) => {
                info!(
                    "✅ {} CAN IDs carregados de DBC ({})",
                    map.len(),
                    DBC_DATA_PATH
                );
                map
            }
            Err(e) => {
                warn!(
                    "⚠️ Falha ao carregar DBC ({}) : {:?}. Tentando CSV...",
                    DBC_DATA_PATH, e
                );
                let map = decoder::load_can_mappings(CSV_DATA_PATH)?;
                info!(
                    "✅ {} CAN IDs carregados de CSV ({})",
                    map.len(),
                    CSV_DATA_PATH
                );
                map
            }
        },
        other => {
            warn!(
                "⚠️ CAN_MAP_SOURCE={} inválido. Use 'dbc' ou 'csv'. Usando DBC.",
                other
            );
            let map = decoder::load_can_mappings_from_dbc_dir(DBC_DATA_PATH)?;
            info!(
                "✅ {} CAN IDs carregados de DBC ({})",
                map.len(),
                DBC_DATA_PATH
            );
            map
        }
    };

    let pg_pool = PgPoolOptions::new()
        .max_connections(MAX_PG_CONNECTIONS)
        .connect(&get_pg_url())
        .await?;
    db::init_timescale(&pg_pool).await?;

    let sqlite_file = "./data/historico.db";
    if !Path::new(sqlite_file).exists() {
        std::fs::File::create(sqlite_file)?;
    }
    let sqlite_pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(SQLITE_PATH)
        .await?;
    db::init_sqlite(&sqlite_pool).await?;

    let pg_m = pg_pool.clone();
    let sq_m = sqlite_pool.clone();
    tokio::spawn(async move {
        info!("🔍 Verificando dados antigos para migração (background)...");
        match db::migrate_old_data(&pg_m, &sq_m).await {
            Ok(n) if n > 0 => info!("✅ Migração concluída: {} registros movidos.", n),
            Ok(_) => info!("✅ Migração: nada para mover."),
            Err(e) => warn!("⚠️ Erro na migração: {:?}", e),
        }    
    });

    let (ws_tx, _) = broadcast::channel::<Vec<u8>>(10_000);
    let (edge_cmd_tx, _) = broadcast::channel::<Vec<u8>>(32);
    let track_state = Arc::new(Mutex::new(RealtimeTrackState::new()));
    let latency_us = Arc::new(AtomicI64::new(0));
    let msg_rate   = Arc::new(AtomicU64::new(0));

    // Canal SQLite: buffer de 50k vetores de sinais
    let (sqlite_tx, mut sqlite_rx) =
        tokio::sync::mpsc::channel::<Vec<ProcessedSignal>>(50_000);

    // Canal TimescaleDB: buffer de 50k vetores de sinais
    let (timescale_tx, mut timescale_rx) =
        tokio::sync::mpsc::channel::<Vec<ProcessedSignal>>(50_000);

    // Task dedicada ao SQLite: acumula sinais e insere em lote a cada 2s ou 500 sinais
    {
        let sq = sqlite_pool.clone();
        tokio::spawn(async move {
            let mut pending: Vec<ProcessedSignal> = Vec::with_capacity(500);
            let mut interval = tokio::time::interval(
                tokio::time::Duration::from_secs(2)
            );
            loop {
                tokio::select! {
                    msg = sqlite_rx.recv() => {
                        match msg {
                            Some(signals) => {
                                pending.extend(signals);
                                if pending.len() >= 500 {
                                    if let Err(e) = db::save_sqlite(&sq, &pending).await {
                                        tracing::error!("❌ SQLite batch error: {:?}", e);
                                    }
                                    pending.clear();
                                }
                            }
                            None => break, // canal fechado
                        }
                    }
                    _ = interval.tick() => {
                        if !pending.is_empty() {
                            if let Err(e) = db::save_sqlite(&sq, &pending).await {
                                tracing::error!("❌ SQLite batch error: {:?}", e);
                            }
                            pending.clear();
                        }
                    }
                }
            }
        });
    }

    // Task dedicada ao TimescaleDB: acumula sinais e insere em lote a cada 1s ou 500 sinais
    {
        let pg = pg_pool.clone();
        tokio::spawn(async move {
            let mut pending: Vec<ProcessedSignal> = Vec::with_capacity(500);
            let mut interval = tokio::time::interval(
                tokio::time::Duration::from_secs(1)
            );
            loop {
                tokio::select! {
                    msg = timescale_rx.recv() => {
                        match msg {
                            Some(signals) => {
                                pending.extend(signals);
                                if pending.len() >= 500 {
                                    if let Err(e) = db::save_timescale(&pg, &pending).await {
                                        tracing::error!("❌ TimescaleDB batch error: {:?}", e);
                                    }
                                    pending.clear();
                                }
                            }
                            None => break, // canal fechado
                        }
                    }
                    _ = interval.tick() => {
                        if !pending.is_empty() {
                            if let Err(e) = db::save_timescale(&pg, &pending).await {
                                tracing::error!("❌ TimescaleDB batch error: {:?}", e);
                            }
                            pending.clear();
                        }
                    }
                }
            }
        });
    }

    // Spawn servidor HTTP+WS :8081
    {
        let tx = ws_tx.clone();
        let cmd_tx = edge_cmd_tx.clone();
        let pg = pg_pool.clone();
        let sqldb = sqlite_pool.clone();
        let dec_for_api = decoder_map.clone();
        let lat = latency_us.clone();
        let rate = msg_rate.clone();
        tokio::spawn(async move {
            api::run_http_ws_server(tx, cmd_tx, pg, sqldb, dec_for_api, lat, rate, HTTP_WS_PORT).await;
        });
    }

        // Spawn servidor NTP :9999
        tokio::spawn(async move {
            ntp::run_ntp_server(NTP_PORT).await;
        });

    let tcp_listener = TcpListener::bind(format!("0.0.0.0:{}", TCP_PORT)).await?;
    info!("📡 TCP CAN listener em 0.0.0.0:{}", TCP_PORT);
    info!("🌐 HTTP+WS server em 0.0.0.0:{}", HTTP_WS_PORT);
    info!("✅ Servidor pronto!\n");

    loop {
        let (socket, addr) = tcp_listener.accept().await?;
        let pg = pg_pool.clone();
        let dec = decoder_map.clone();
        let tx = ws_tx.clone();
        let cmd_tx = edge_cmd_tx.clone();
        let track = track_state.clone();
        let sqlite_tx = sqlite_tx.clone();
        let timescale_tx = timescale_tx.clone();
        let lat = latency_us.clone();
        let rate = msg_rate.clone();
        tokio::spawn(async move {
            ingest::handle_client(socket, addr, pg, dec, tx, track, sqlite_tx, timescale_tx, cmd_tx, lat, rate).await;
        });
    }
}
