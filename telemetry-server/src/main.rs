// [SERVIDOR] main.rs
use tokio::net::TcpListener;
use tokio::io::AsyncReadExt;
use sqlx::postgres::PgPoolOptions;
mod decoder;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Carrega CSVs
    let decoder_map = decoder::load_can_mappings("./csv_data")?;
    println!("Mapas carregados com sucesso!");

    // 2. Conecta TimescaleDB
    let pool = PgPoolOptions::new()
        .max_connections(50)
        .connect("postgres://postgres:eracing_secret@localhost/telemetria").await?;

    // 3. Ouve porta TCP
    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    println!("📡 Servidor ouvindo na porta 8080...");

    loop {
        let (mut socket, addr) = listener.accept().await?;
        println!("Novo carro conectado: {}", addr);
        
        let pool = pool.clone();
        let decoder_map = decoder_map.clone();

        tokio::spawn(async move {
            loop {
                // 1. Lê o tamanho (4 bytes)
                let mut len_buf = [0u8; 4];
                if socket.read_exact(&mut len_buf).await.is_err() { break; }
                let len = u32::from_le_bytes(len_buf) as usize;

                // 2. Lê o payload (tamanho exato)
                let mut payload = vec![0u8; len];
                if socket.read_exact(&mut payload).await.is_err() { break; }

                // 3. Deserializa o Payload
                // Layout: [ID (4)] [TIME (8)] [DATA (8)]
                if payload.len() < 20 { continue; } // Segurança

                let can_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                let timestamp_f64 = f64::from_le_bytes(payload[4..12].try_into().unwrap());
                let data = &payload[12..20];

                // 4. Decodifica e Salva
                if let Some(signals) = decoder_map.get(&can_id) {
                    for signal in signals {
                        let valor = decoder::decode_signal(data, signal);
                        
                        // INSERE NO TIMESCALE
                        let _ = sqlx::query("INSERT INTO sensor_data (time, signal_name, value, unit, can_id) VALUES (to_timestamp($1), $2, $3, $4, $5)")
                            .bind(timestamp_f64)
                            .bind(&signal.signal_name)
                            .bind(valor)
                            .bind(&signal.unit)
                            .bind(can_id as i32)
                            .execute(&pool).await;
                    }
                }
            }
            println!("Carro desconectado: {}", addr);
        });
    }
}