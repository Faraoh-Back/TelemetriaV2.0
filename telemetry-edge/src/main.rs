// [CARRO] main.rs - VERSÃO MELHORADA
use tokio::net::TcpStream;
use tokio::io::AsyncWriteExt;
use socketcan::{CanSocket, Socket, Frame};
use sqlx::sqlite::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, Duration};
use tracing::{info, warn, error};

// ==================== CONFIGURAÇÕES ====================
const SERVER_ADDR: &str = "192.168.1.100:8080";
const DB_PATH: &str = "sqlite:telemetria_backup.db";
const DEVICE_ID: &str = "car_001";
const RECONNECT_DELAY_MS: u64 = 1000;
const BATCH_SIZE: usize = 10; // Enviar em lotes para eficiência

// ==================== ESTRUTURAS ====================

#[derive(Debug, Clone)]
struct TelemetryFrame {
    timestamp: f64,
    can_id: u32,
    data: [u8; 8],
}

// ==================== INICIALIZAÇÃO DO BANCO ====================

async fn init_database() -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let pool = SqlitePool::connect(DB_PATH).await?;
    
    // Criar tabela se não existir
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS raw_can_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            can_id INTEGER NOT NULL,
            data BLOB NOT NULL,
            device_id TEXT NOT NULL DEFAULT 'car_001',
            synced INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_synced ON raw_can_logs(synced);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON raw_can_logs(timestamp);
        "#
    )
    .execute(&pool)
    .await?;
    
    info!("✅ Banco de dados SQLite inicializado");
    Ok(pool)
}

// ==================== LEITURA CAN NÃO-BLOQUEANTE ====================

async fn read_can_frames(
    socket: &CanSocket,
    buffer: &mut Vec<TelemetryFrame>,
    batch_size: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    // Configura socket como non-blocking
    socket.set_nonblocking(true)?;
    
    let mut count = 0;
    loop {
        match socket.read_frame() {
            Ok(frame) => {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)?
                    .as_secs_f64();
                
                let can_id: u32 = match frame.id() {
                    socketcan::Id::Standard(id) => id.as_raw() as u32,
                    socketcan::Id::Extended(id) => id.as_raw(),
                };
                
                let data_slice = frame.data();
                let mut data_fixed = [0u8; 8];
                data_fixed[..data_slice.len()].copy_from_slice(data_slice);
                
                buffer.push(TelemetryFrame {
                    timestamp,
                    can_id,
                    data: data_fixed,
                });
                
                count += 1;
                
                // Retorna quando atingir batch_size ou não houver mais dados
                if count >= batch_size {
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // Sem dados disponíveis no momento
                break;
            }
            Err(e) => {
                error!("Erro ao ler CAN frame: {:?}", e);
                break;
            }
        }
    }
    
    Ok(())
}

// ==================== ENVIO TCP EM LOTE ====================

async fn send_batch(
    stream: &mut TcpStream,
    frames: &[TelemetryFrame],
) -> Result<(), Box<dyn std::error::Error>> {
    for frame in frames {
        let mut payload = Vec::with_capacity(20);
        payload.extend_from_slice(&frame.can_id.to_le_bytes()); // 4 bytes
        payload.extend_from_slice(&frame.timestamp.to_le_bytes()); // 8 bytes
        payload.extend_from_slice(&frame.data); // 8 bytes
        
        let len = payload.len() as u32;
        
        // Envia tamanho + payload atomicamente
        stream.write_all(&len.to_le_bytes()).await?;
        stream.write_all(&payload).await?;
    }
    
    stream.flush().await?;
    Ok(())
}

// ==================== BACKUP LOCAL ====================

async fn backup_to_sqlite(
    pool: &SqlitePool,
    frames: &[TelemetryFrame],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut tx = pool.begin().await?;
    
    for frame in frames {
        sqlx::query(
            "INSERT INTO raw_can_logs (timestamp, can_id, data, device_id) VALUES (?, ?, ?, ?)"
        )
        .bind(frame.timestamp)
        .bind(frame.can_id as i64)
        .bind(&frame.data[..])
        .bind(DEVICE_ID)
        .execute(&mut *tx)
        .await?;
    }
    
    tx.commit().await?;
    Ok(())
}

// ==================== SINCRONIZAÇÃO DE DADOS PENDENTES ====================

async fn sync_pending_data(
    pool: &SqlitePool,
    stream: &mut TcpStream,
) -> Result<usize, Box<dyn std::error::Error>> {
    // Buscar dados não sincronizados (limite para não travar)
    let rows = sqlx::query(
        "SELECT id, timestamp, can_id, data FROM raw_can_logs WHERE synced = 0 LIMIT 1000"
    )
    .fetch_all(pool)
    .await?;
    
    if rows.is_empty() {
        return Ok(0);
    }
    
    info!("🔄 Sincronizando {} registros pendentes...", rows.len());
    
    let mut synced_ids = Vec::new();
    
    for row in rows {
        let id: i64 = row.get("id");
        let timestamp: f64 = row.get("timestamp");
        let can_id: i64 = row.get("can_id");
        let data: Vec<u8> = row.get("data");
        
        let mut data_fixed = [0u8; 8];
        data_fixed[..data.len().min(8)].copy_from_slice(&data[..data.len().min(8)]);
        
        let frame = TelemetryFrame {
            timestamp,
            can_id: can_id as u32,
            data: data_fixed,
        };
        
        if send_batch(stream, &[frame]).await.is_ok() {
            synced_ids.push(id);
        } else {
            break; // Conexão perdida
        }
    }
    
    // Marcar como sincronizados
    if !synced_ids.is_empty() {
        let ids_str: Vec<String> = synced_ids.iter().map(|id| id.to_string()).collect();
        let query = format!(
            "UPDATE raw_can_logs SET synced = 1 WHERE id IN ({})",
            ids_str.join(",")
        );
        sqlx::query(&query).execute(pool).await?;
    }
    
    Ok(synced_ids.len())
}

// ==================== MAIN ====================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Inicializar logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    
    info!("🚀 Telemetria Edge v2.0 - {}", DEVICE_ID);
    
    // 1. Inicializar banco local
    let db_pool = init_database().await?;
    
    // 2. Abrir interface CAN
    let socket = CanSocket::open("can0")?;
    info!("✅ Interface CAN aberta: can0");
    
    // Buffer para frames em lote
    let mut frame_buffer = Vec::with_capacity(BATCH_SIZE);
    
    // Loop de conexão persistente
    loop {
        info!("🔌 Tentando conectar ao servidor: {}", SERVER_ADDR);
        
        let mut stream = match TcpStream::connect(SERVER_ADDR).await {
            Ok(s) => {
                info!("✅ Conectado ao servidor!");
                s
            }
            Err(e) => {
                warn!("❌ Falha ao conectar: {}. Tentando novamente em {}ms...", e, RECONNECT_DELAY_MS);
                sleep(Duration::from_millis(RECONNECT_DELAY_MS)).await;
                continue;
            }
        };
        
        // Sincronizar dados pendentes (se houver)
        match sync_pending_data(&db_pool, &mut stream).await {
            Ok(count) if count > 0 => {
                info!("✅ {} registros sincronizados", count);
            }
            Err(e) => {
                warn!("⚠️ Erro ao sincronizar dados pendentes: {}", e);
            }
            _ => {}
        }
        
        // Loop de transmissão
        loop {
            // Ler frames CAN em lote
            frame_buffer.clear();
            if let Err(e) = read_can_frames(&socket, &mut frame_buffer, BATCH_SIZE).await {
                error!("Erro ao ler CAN: {:?}", e);
                sleep(Duration::from_millis(10)).await;
                continue;
            }
            
            if frame_buffer.is_empty() {
                // Sem dados, aguarda um pouco
                sleep(Duration::from_millis(1)).await;
                continue;
            }
            
            // Tentar enviar ao servidor
            match send_batch(&mut stream, &frame_buffer).await {
                Ok(_) => {
                    // Sucesso - dados enviados, não precisa backup
                }
                Err(e) => {
                    warn!("❌ Erro ao enviar dados: {}. Salvando localmente...", e);
                    
                    // Salvar no backup local
                    if let Err(e) = backup_to_sqlite(&db_pool, &frame_buffer).await {
                        error!("❌ CRÍTICO: Falha ao salvar backup: {:?}", e);
                    } else {
                        info!("💾 {} frames salvos no backup local", frame_buffer.len());
                    }
                    
                    // Conexão perdida, sair do loop interno para reconectar
                    break;
                }
            }
        }
        
        warn!("⚠️ Conexão perdida. Reconectando...");
        sleep(Duration::from_millis(RECONNECT_DELAY_MS)).await;
    }
}