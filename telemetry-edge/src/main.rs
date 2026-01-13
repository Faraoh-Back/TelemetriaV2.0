// [CARRO] main.rs
use tokio::net::TcpStream;
use tokio::io::AsyncWriteExt;
use socketcan::{CanSocket, Socket, Frame}; 
use sqlx::sqlite::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Setup Banco Local
    let db_pool = SqlitePool::connect("sqlite:telemetria_backup.db").await?;
    
    // 2. Setup CAN (Use modo non-blocking se possível, ou thread separada em produção)
    let socket = CanSocket::open("can0").expect("Falha ao abrir CAN");
    
    println!("🚀 Telemetria Edge Iniciada");

    // Loop de conexão persistente
    loop {
        println!("Tentando conectar na Base...");
        // Tenta conectar, se falhar, espera 1s e tenta de novo
        let mut stream = match TcpStream::connect("192.168.1.100:8080").await {
            Ok(s) => s,
            Err(_) => {
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        println!("✅ Conectado à Base!");

        loop {
            // Leitura da CAN (Simples/Bloqueante para este exemplo)
            // Em produção real com Rust, use 'tokio-socketcan' para ser async de verdade
            if let Ok(frame) = socket.read_frame() {
                let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
                
                // Tratamento do ID (Standard ou Extended)
                let can_id: u32 = match frame.id() {
                    socketcan::Id::Standard(id) => id.as_raw() as u32,
                    socketcan::Id::Extended(id) => id.as_raw(),
                };
                
                let data = frame.data();

                // --- MONTAGEM DO PACOTE ---
                // Formato: [LEN (4 bytes)] + [ID (4 bytes)] + [TIMESTAMP (8 bytes)] + [DATA (8 bytes)]
                let mut payload = Vec::new();
                payload.extend_from_slice(&can_id.to_le_bytes()); // 4 bytes
                payload.extend_from_slice(&timestamp.to_le_bytes()); // 8 bytes
                
                // Normaliza dados para sempre ter 8 bytes (preenche com 0 se for menor)
                let mut data_fixed = [0u8; 8];
                data_fixed[..data.len()].copy_from_slice(data);
                payload.extend_from_slice(&data_fixed); // 8 bytes

                // Tamanho total do payload
                let len = payload.len() as u32;

                // --- ENVIO SEGURO ---
                // 1. Envia tamanho
                if stream.write_all(&len.to_le_bytes()).await.is_err() {
                    break; // Quebra o loop interno para reconectar
                }
                // 2. Envia payload
                if stream.write_all(&payload).await.is_err() {
                    break; // Quebra o loop interno para reconectar
                }

                // --- BACKUP LOCAL (SQLite) ---
                let pool = db_pool.clone();
                let data_vec = data.to_vec();
                tokio::spawn(async move {
                    sqlx::query("INSERT INTO raw_can_logs (timestamp, can_id, data) VALUES (?, ?, ?)")
                        .bind(timestamp)
                        .bind(can_id)
                        .bind(data_vec)
                        .execute(&pool).await.ok();
                });
            }
            // Pequeno sleep para não fritar a CPU se não houver dados CAN
            sleep(Duration::from_millis(1)).await;
        }
        println!("⚠️ Conexão perdida. Reconectando...");
    }
}