// [SERVIDOR] main.rs - VERSÃO MELHORADA
use tokio::net::{TcpListener, TcpStream};
use tokio::io::AsyncReadExt;
use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;
use tracing::{info, warn, error};
use serde::Serialize;

mod decoder;

// ==================== CONFIGURAÇÕES ====================
const SERVER_PORT: u16 = 8080;
const DB_URL: &str = "postgres://postgres:eracing_secret@localhost/telemetria";
const MAX_CONNECTIONS: u32 = 50;
const CSV_DATA_PATH: &str = "./csv_data";

// ==================== ESTRUTURAS ====================

#[derive(Debug, Clone, Serialize)]
struct ProcessedSignal {
    timestamp: f64,
    device_id: String,
    can_id: u32,
    signal_name: String,
    value: f64,
    unit: String,
}

// ==================== INICIALIZAÇÃO DO BANCO ====================

async fn init_database(pool: &sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
    // Habilitar extensão TimescaleDB
    sqlx::query("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
        .execute(pool)
        .await?;
    
    // Criar tabela principal
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sensor_data (
            time TIMESTAMPTZ NOT NULL,
            device_id TEXT NOT NULL,
            signal_name TEXT NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            unit TEXT,
            can_id INTEGER NOT NULL,
            quality TEXT DEFAULT 'ok'
        );
        "#
    )
    .execute(pool)
    .await?;
    
    // Converter para hypertable (TimescaleDB)
    sqlx::query(
        "SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE)"
    )
    .execute(pool)
    .await
    .ok(); // Ignora erro se já for hypertable
    
    // Criar índices
    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_device_signal 
        ON sensor_data (device_id, signal_name, time DESC);
        
        CREATE INDEX IF NOT EXISTS idx_signal_time
        ON sensor_data (signal_name, time DESC);
        "#
    )
    .execute(pool)
    .await?;
    
    info!("✅ Banco TimescaleDB inicializado");
    Ok(())
}

// ==================== PROCESSAMENTO DE CLIENTE ====================

async fn handle_client(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    pool: sqlx::PgPool,
    decoder_map: decoder::DecoderMap,
    tx: broadcast::Sender<String>,
) {
    info!("🚗 Novo carro conectado: {}", addr);
    
    let device_id = format!("car_{}", addr.port()); // Identificar carro pelo IP/porta
    let mut frames_received = 0u64;
    let mut last_log = std::time::Instant::now();
    
    loop {
        // 1. Ler tamanho (4 bytes)
        let mut len_buf = [0u8; 4];
        if socket.read_exact(&mut len_buf).await.is_err() {
            warn!("Carro desconectado: {}", addr);
            break;
        }
        
        let len = u32::from_le_bytes(len_buf) as usize;
        
        // Validação de segurança
        if len > 1024 {
            error!("Payload muito grande ({}), desconectando {}", len, addr);
            break;
        }
        
        // 2. Ler payload
        let mut payload = vec![0u8; len];
        if socket.read_exact(&mut payload).await.is_err() {
            warn!("Erro ao ler payload de {}", addr);
            break;
        }
        
        // 3. Validar estrutura
        if payload.len() < 20 {
            warn!("Payload inválido de {}: {} bytes", addr, payload.len());
            continue;
        }
        
        // 4. Deserializar
        let can_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let timestamp = f64::from_le_bytes(payload[4..12].try_into().unwrap());
        let data = &payload[12..20];
        
        frames_received += 1;
        
        // 5. Decodificar sinais
        if let Some(signals) = decoder_map.get(&can_id) {
            let mut processed_signals = Vec::new();
            
            for signal_config in signals {
                let value = decoder::decode_signal(data, signal_config);
                
                let processed = ProcessedSignal {
                    timestamp,
                    device_id: device_id.clone(),
                    can_id,
                    signal_name: signal_config.signal_name.clone(),
                    value,
                    unit: signal_config.unit.clone(),
                };
                
                processed_signals.push(processed);
            }
            
            // 6. Salvar no banco (em lote)
            if let Err(e) = save_signals_batch(&pool, &processed_signals).await {
                error!("Erro ao salvar no banco: {:?}", e);
            }
            
            // 7. Broadcast para clientes WebSocket
            for signal in &processed_signals {
                if let Ok(json) = serde_json::to_string(signal) {
                    let _ = tx.send(json);
                }
            }
        }
        
        // Log periódico de performance
        if last_log.elapsed().as_secs() >= 10 {
            info!(
                "📊 {}: {} frames recebidos (taxa: {:.1} frames/s)",
                addr,
                frames_received,
                frames_received as f64 / last_log.elapsed().as_secs_f64()
            );
            frames_received = 0;
            last_log = std::time::Instant::now();
        }
    }
    
    info!("🔌 Carro desconectado: {} (total frames: {})", addr, frames_received);
}

// ==================== SALVAR EM LOTE ====================

async fn save_signals_batch(
    pool: &sqlx::PgPool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }
    
    // Usar COPY para inserção ultra-rápida no PostgreSQL
    let mut copy_data = String::new();
    
    for signal in signals {
        copy_data.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\n",
            chrono::DateTime::from_timestamp(signal.timestamp as i64, 0)
                .unwrap_or_default()
                .to_rfc3339(),
            signal.device_id,
            signal.signal_name,
            signal.value,
            signal.unit,
            signal.can_id
        ));
    }
    
    // Usar query normal (COPY requer mais configuração)
    let mut tx = pool.begin().await?;
    
    for signal in signals {
        sqlx::query(
            r#"
            INSERT INTO sensor_data (time, device_id, signal_name, value, unit, can_id)
            VALUES (to_timestamp($1), $2, $3, $4, $5, $6)
            "#
        )
        .bind(signal.timestamp)
        .bind(&signal.device_id)
        .bind(&signal.signal_name)
        .bind(signal.value)
        .bind(&signal.unit)
        .bind(signal.can_id as i32)
        .execute(&mut *tx)
        .await?;
    }
    
    tx.commit().await?;
    Ok(())
}

// ==================== MAIN ====================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Inicializar logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    
    info!("🚀 Telemetry Server v2.0 iniciando...");
    
    // 1. Carregar decodificadores CAN
    let decoder_map = decoder::load_can_mappings(CSV_DATA_PATH)?;
    info!("✅ {} mapas CAN carregados", decoder_map.len());
    
    // 2. Conectar TimescaleDB
    let pool = PgPoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .connect(DB_URL)
        .await?;
    info!("✅ Conectado ao TimescaleDB");
    
    // 3. Inicializar estrutura do banco
    init_database(&pool).await?;
    
    // 4. Criar broadcast channel para WebSocket
    let (tx, _rx) = broadcast::channel::<String>(1000);
    
    // 5. Spawn servidor WebSocket (implementar em servidor separado)
    // TODO: Implementar servidor WebSocket/HTTP em porta separada (8081)
    
    // 6. Ouvir conexões TCP
    let listener = TcpListener::bind(format!("0.0.0.0:{}", SERVER_PORT)).await?;
    info!("📡 Servidor TCP ouvindo em 0.0.0.0:{}", SERVER_PORT);
    info!("🌐 Pronto para receber carros!");
    
    loop {
        let (socket, addr) = listener.accept().await?;
        
        let pool = pool.clone();
        let decoder_map = decoder_map.clone();
        let tx = tx.clone();
        
        tokio::spawn(async move {
            handle_client(socket, addr, pool, decoder_map, tx).await;
        });
    }
}