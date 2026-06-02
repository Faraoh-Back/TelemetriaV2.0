// [SERVIDOR] main.rs - DUAL DB + HTTP/WS com autenticação JWT
//
// FLUXO:
//   Edge (Jetson) ──Wi-Fi──→ TCP :8080 → decodifica → TimescaleDB + SQLite
//   Browser/App   ──HTTP──→ GET /       → index.html
//   Browser/App   ──HTTP──→ POST /login → JWT token
//   Browser/App   ──WS──→   /ws         → broadcast JSON (requer JWT)

use sqlx::postgres::PgPoolOptions;
use std::path::Path;
use std::sync::{Arc, Mutex};
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

    info!("🚀 Telemetry Server v2.1 — Dual DB + JWT Auth");
    info!("   TimescaleDB → tempo real | SQLite → histórico + users");

    std::fs::create_dir_all("./data")?;
    std::fs::create_dir_all("./static")?;

    let can_map_source = std::env::var("CAN_MAP_SOURCE").unwrap_or_else(|_| "dbc".to_string());
    let decoder_map = match decoder::load_can_mappings_from_dbc_dir(DBC_DATA_PATH) {
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

    info!("🔍 Verificando dados antigos para migração...");
    match db::migrate_old_data(&pg_pool, &sqlite_pool).await {
        Ok(n) if n > 0 => info!("✅ Boot: {} registros migrados para SQLite", n),
        Ok(_) => info!("✅ Boot: nenhum dado antigo para migrar"),
        Err(e) => warn!("⚠️  Boot: erro na migração (não crítico): {:?}", e),
    }

    let (ws_tx, _) = broadcast::channel::<Vec<u8>>(10_000);
    let track_state = Arc::new(Mutex::new(RealtimeTrackState::new()));

    // Spawn servidor HTTP+WS :8081
    {
        let tx = ws_tx.clone();
        let pg = pg_pool.clone();
        let sqldb = sqlite_pool.clone();
        tokio::spawn(async move {
            api::run_http_ws_server(tx, pg, sqldb, HTTP_WS_PORT).await;
        });

        // Spawn servidor NTP :9999
        tokio::spawn(async move {
            api::run_ntp_server(NTP_PORT).await;
        });
    }

    let tcp_listener = TcpListener::bind(format!("0.0.0.0:{}", TCP_PORT)).await?;
    info!("📡 TCP CAN listener em 0.0.0.0:{}", TCP_PORT);
    info!("🌐 HTTP+WS server em 0.0.0.0:{}", HTTP_WS_PORT);
    info!("✅ Servidor pronto!\n");

    loop {
        let (socket, addr) = tcp_listener.accept().await?;
        let pg = pg_pool.clone();
        let dec = decoder_map.clone();
        let tx = ws_tx.clone();
        let track = track_state.clone();
        tokio::spawn(async move {
            ingest::handle_client(socket, addr, pg, dec, tx, track).await;
        });
    }
}
