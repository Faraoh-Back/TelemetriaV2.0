// [SERVIDOR] main.rs - DUAL DB: TimescaleDB (tempo real) + SQLite (histórico)
//
// FLUXO:
//   Edge (Jetson) ──Wi-Fi Unifi──→ Roteador ──Cabo──→ Servidor
//   TCP :8080 recebe frames CAN binários
//       ↓ decodifica via decoder.rs + CSV
//       ├── TimescaleDB → tempo real (App Android via WebSocket :8081)
//       └── SQLite      → histórico persistente
//
// PORTAS:
//   8080 → TCP binário (edge → servidor)
//   8081 → WebSocket JSON (servidor → app Android)

use tokio::net::{TcpListener, TcpStream};
use tokio::io::AsyncReadExt;
use tokio::sync::broadcast;
use tracing::{info, warn, error};
use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::SqlitePool;
use std::path::Path;

mod decoder;

// ==================== CONFIGURAÇÕES ====================
const TCP_PORT: u16 = 8080;
const WS_PORT: u16 = 8081;
fn get_pg_url() -> String {
    let password = std::env::var("DB_PASSWORD").expect("❌ DB_PASSWORD não definida no .env");
    format!("postgres://eracing:{}@localhost/telemetria", password)
}
const SQLITE_PATH: &str = "sqlite:./data/historico.db";
const CSV_DATA_PATH: &str = "./csv_data";
const MAX_PG_CONNECTIONS: u32 = 20;

// ==================== ESTRUTURAS ====================

#[derive(Debug, Clone, Serialize)]
pub struct ProcessedSignal {
    pub timestamp: f64,
    pub device_id: String,
    pub can_id: u32,
    pub signal_name: String,
    pub value: f64,
    pub unit: String,
}

// ==================== INIT TIMESCALEDB ====================

async fn init_timescale(pool: &sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
    // Extensão TimescaleDB
    sqlx::query("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
        .execute(pool)
        .await?;

    // Tabela de tempo real
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS sensor_data (
            time        TIMESTAMPTZ      NOT NULL,
            device_id   TEXT             NOT NULL,
            signal_name TEXT             NOT NULL,
            value       DOUBLE PRECISION NOT NULL,
            unit        TEXT,
            can_id      INTEGER          NOT NULL,
            quality     TEXT             DEFAULT 'ok'
        );
    "#)
    .execute(pool)
    .await?;

    // Hypertable para queries de série temporal eficientes
    sqlx::query(
        "SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE)"
    )
    .execute(pool)
    .await
    .ok();

    // Índices para o app Android consultar rápido
    sqlx::query(r#"
        CREATE INDEX IF NOT EXISTS idx_device_signal_time
            ON sensor_data (device_id, signal_name, time DESC);
        CREATE INDEX IF NOT EXISTS idx_signal_time
            ON sensor_data (signal_name, time DESC);
    "#)
    .execute(pool)
    .await?;

    // Política de retenção: mantém só os últimos 7 dias no TimescaleDB
    // (histórico longo fica no SQLite)
    sqlx::query(r#"
        SELECT add_retention_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE)
    "#)
    .execute(pool)
    .await
    .ok(); // Só disponível em TimescaleDB licenciado — ignora se falhar

    info!("✅ TimescaleDB inicializado (tempo real, retenção 7 dias)");
    Ok(())
}

// ==================== INIT SQLITE ====================

async fn init_sqlite(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    // Garante que o diretório existe
    std::fs::create_dir_all("./data")?;

    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS historico (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   REAL    NOT NULL,
            device_id   TEXT    NOT NULL,
            signal_name TEXT    NOT NULL,
            value       REAL    NOT NULL,
            unit        TEXT,
            can_id      INTEGER NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_hist_timestamp
            ON historico (timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_hist_signal
            ON historico (signal_name, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_hist_device
            ON historico (device_id, timestamp DESC);
    "#)
    .execute(pool)
    .await?;

    // WAL mode para melhor performance de escrita concorrente
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(pool)
        .await?;
    sqlx::query("PRAGMA synchronous=NORMAL")
        .execute(pool)
        .await?;

    info!("✅ SQLite inicializado (histórico persistente)");
    Ok(())
}

// ==================== SALVAR TIMESCALEDB ====================

async fn save_timescale(
    pool: &sqlx::PgPool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for s in signals {
        sqlx::query(r#"
            INSERT INTO sensor_data (time, device_id, signal_name, value, unit, can_id)
            VALUES (to_timestamp($1), $2, $3, $4, $5, $6)
        "#)
        .bind(s.timestamp)
        .bind(&s.device_id)
        .bind(&s.signal_name)
        .bind(s.value)
        .bind(&s.unit)
        .bind(s.can_id as i32)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

// ==================== SALVAR SQLITE ====================

async fn save_sqlite(
    pool: &SqlitePool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for s in signals {
        sqlx::query(r#"
            INSERT INTO historico (timestamp, device_id, signal_name, value, unit, can_id)
            VALUES (?, ?, ?, ?, ?, ?)
        "#)
        .bind(s.timestamp)
        .bind(&s.device_id)
        .bind(&s.signal_name)
        .bind(s.value)
        .bind(&s.unit)
        .bind(s.can_id as i64)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

// ==================== HANDLER DE CLIENTE TCP ====================

async fn handle_client(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    pg_pool: sqlx::PgPool,
    sqlite_pool: SqlitePool,
    decoder_map: decoder::DecoderMap,
    ws_tx: broadcast::Sender<String>,
) {
    info!("🚗 Carro conectado: {}", addr);

    // Identifica o carro pelo IP de origem (não pela porta — porta muda a cada reconexão)
    let device_id = format!("car_{}", addr.ip().to_string().replace('.', "_"));

    let mut frames_total: u64 = 0;
    let mut frames_decoded: u64 = 0;
    let mut last_log = std::time::Instant::now();

    loop {
        // ── 1. Ler tamanho do pacote (4 bytes little-endian) ──────────────
        let mut len_buf = [0u8; 4];
        match socket.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(_) => {
                warn!("🔌 Carro desconectado: {}", addr);
                break;
            }
        }

        let len = u32::from_le_bytes(len_buf) as usize;

        // Proteção contra pacotes malformados
        if len == 0 || len > 1024 {
            error!("Pacote inválido (len={}) de {} — desconectando", len, addr);
            break;
        }

        // ── 2. Ler payload ────────────────────────────────────────────────
        let mut payload = vec![0u8; len];
        match socket.read_exact(&mut payload).await {
            Ok(_) => {}
            Err(e) => {
                warn!("Erro ao ler payload de {}: {}", addr, e);
                break;
            }
        }

        // Estrutura esperada: [can_id: 4B][timestamp: 8B][data: 8B] = 20 bytes
        if payload.len() < 20 {
            warn!("Payload curto ({} bytes) de {}", payload.len(), addr);
            continue;
        }

        // ── 3. Deserializar frame ─────────────────────────────────────────
        let can_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let timestamp = f64::from_le_bytes(payload[4..12].try_into().unwrap());
        let raw_data = &payload[12..20];

        frames_total += 1;

        // ── 4. Decodificar via CSV ────────────────────────────────────────
        let signals_config = match decoder_map.get(&can_id) {
            Some(s) => s,
            None => continue, // CAN ID não está no CSV — ignora silenciosamente
        };

        let processed: Vec<ProcessedSignal> = signals_config
            .iter()
            .map(|cfg| {
                let value = decoder::decode_signal(raw_data, cfg);
                ProcessedSignal {
                    timestamp,
                    device_id: device_id.clone(),
                    can_id,
                    signal_name: cfg.signal_name.clone(),
                    value,
                    unit: cfg.unit.clone(),
                }
            })
            .collect();

        frames_decoded += processed.len() as u64;

        // ── 5. Persistir em paralelo: TimescaleDB + SQLite ────────────────
        let pg_pool_c = pg_pool.clone();
        let sqlite_pool_c = sqlite_pool.clone();
        let processed_c = processed.clone();

        let value = processed_c.clone();

        tokio::spawn(async move {
            // TimescaleDB — tempo real
            if let Err(e) = save_timescale(&pg_pool_c, &value).await {
                error!("❌ TimescaleDB insert error: {:?}", e);
            }
        });

        tokio::spawn(async move {
            // SQLite — histórico
            if let Err(e) = save_sqlite(&sqlite_pool_c, &processed).await {
                error!("❌ SQLite insert error: {:?}", e);
            }
        });

        // ── 6. Broadcast WebSocket → App Android ─────────────────────────
        for signal in &processed_c {
            if let Ok(json) = serde_json::to_string(signal) {
                // Se não houver listeners, send retorna Err — ignoramos
                let _ = ws_tx.send(json);
            }
        }

        // ── 7. Log de performance a cada 10s ─────────────────────────────
        if last_log.elapsed().as_secs() >= 10 {
            let elapsed = last_log.elapsed().as_secs_f64();
            info!(
                "📊 {} | frames: {} | sinais: {} | taxa: {:.0} frames/s",
                device_id,
                frames_total,
                frames_decoded,
                frames_total as f64 / elapsed
            );
            frames_total = 0;
            frames_decoded = 0;
            last_log = std::time::Instant::now();
        }
    }

    info!("👋 {} desconectado", device_id);
}

// ==================== SERVIDOR WEBSOCKET SIMPLES ====================
// Transmite JSON para o App Android em tempo real
// Protocolo: cada mensagem é uma linha JSON terminada em \n

async fn run_websocket_server(
    ws_rx: broadcast::Receiver<String>,
    port: u16,
) {
    let listener = match TcpListener::bind(format!("0.0.0.0:{}", port)).await {
        Ok(l) => {
            info!("🌐 WebSocket server em 0.0.0.0:{}", port);
            l
        }
        Err(e) => {
            error!("❌ Falha ao abrir porta WebSocket {}: {}", port, e);
            return;
        }
    };

    // Aceita múltiplos clientes (app Android, dashboard, etc.)
    loop {
        match listener.accept().await {
            Ok((mut stream, addr)) => {
                info!("📱 App conectado: {}", addr);

                // Cada cliente recebe uma cópia do receiver
                let mut rx = ws_rx.resubscribe();

                tokio::spawn(async move {
                    use tokio::io::AsyncWriteExt;

                    loop {
                        match rx.recv().await {
                            Ok(json) => {
                                let msg = format!("{}\n", json);
                                if stream.write_all(msg.as_bytes()).await.is_err() {
                                    info!("📱 App desconectado: {}", addr);
                                    break;
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                warn!("App {} atrasado, perdeu {} mensagens", addr, n);
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
            Err(e) => {
                error!("Erro ao aceitar conexão WebSocket: {}", e);
            }
        }
    }
}

// ==================== MAIN ====================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok(); // carrega o .env para acessar DB_PASSWORD
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("🚀 Telemetry Server v2.0 — Dual DB Edition");
    info!("   TimescaleDB → tempo real | SQLite → histórico");

    // 1. Garantir que pasta de dados existe
    std::fs::create_dir_all("./data")?;

    // 2. Carregar mapa CAN do CSV
    let decoder_map = decoder::load_can_mappings(CSV_DATA_PATH)?;
    info!("✅ {} CAN IDs carregados do CSV", decoder_map.len());

    // 3. Conectar TimescaleDB (PostgreSQL)
    let pg_url = get_pg_url();
    let pg_pool = PgPoolOptions::new()
        .max_connections(MAX_PG_CONNECTIONS)
        .connect(&pg_url)
        .await?;
    init_timescale(&pg_pool).await?;

    // 4. Conectar SQLite
    // Cria o arquivo se não existir
    let sqlite_file = "./data/historico.db";
    if !Path::new(sqlite_file).exists() {
        std::fs::File::create(sqlite_file)?;
    }
    let sqlite_pool = SqlitePool::connect(SQLITE_PATH).await?;
    init_sqlite(&sqlite_pool).await?;

    // 5. Canal broadcast para WebSocket (buffer de 10.000 msgs)
    let (ws_tx, ws_rx) = broadcast::channel::<String>(10_000);

    // 6. Spawn servidor WebSocket em task separada
    tokio::spawn(run_websocket_server(ws_rx, WS_PORT));

    // 7. Iniciar listener TCP para os carros
    let tcp_listener = TcpListener::bind(format!("0.0.0.0:{}", TCP_PORT)).await?;
    info!("📡 TCP listener em 0.0.0.0:{} (recebe frames CAN dos carros)", TCP_PORT);
    info!("🌐 WebSocket em 0.0.0.0:{} (envia JSON para app Android)", WS_PORT);
    info!("✅ Servidor pronto!\n");

    // 8. Loop de aceitação de conexões TCP
    loop {
        let (socket, addr) = tcp_listener.accept().await?;

        let pg_pool = pg_pool.clone();
        let sqlite_pool = sqlite_pool.clone();
        let decoder_map = decoder_map.clone();
        let ws_tx = ws_tx.clone();

        tokio::spawn(async move {
            handle_client(socket, addr, pg_pool, sqlite_pool, decoder_map, ws_tx).await;
        });
    }
}