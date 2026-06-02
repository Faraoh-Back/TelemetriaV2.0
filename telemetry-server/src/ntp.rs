use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::{error, info};

pub async fn run_ntp_server(port: u16) {
    let listener = match TcpListener::bind(format!("0.0.0.0:{}", port)).await {
        Ok(l) => {
            info!("🕐 NTP server em 0.0.0.0:{}", port);
            l
        }
        Err(e) => {
            error!("❌ Falha ao abrir porta NTP {}: {}", port, e);
            return;
        }
    };

    loop {
        match listener.accept().await {
            Ok((mut stream, addr)) => {
                tokio::spawn(async move {
                    let mut buf = [0u8; 8];
                    if stream.read_exact(&mut buf).await.is_err() {
                        return;
                    }

                    let t2 = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64();

                    let t3 = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64();

                    let mut resp = [0u8; 16];
                    resp[0..8].copy_from_slice(&t2.to_le_bytes());
                    resp[8..16].copy_from_slice(&t3.to_le_bytes());

                    if stream.write_all(&resp).await.is_err() {
                        return;
                    }
                    info!("🕐 NTP respondido para {}", addr);
                });
            }
            Err(e) => error!("NTP accept error: {}", e),
        }
    }
}
