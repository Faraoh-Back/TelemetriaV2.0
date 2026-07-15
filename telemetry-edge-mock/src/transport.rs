use crate::config::MockConfig;
use crate::protocol::TelemetryFrame;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::mpsc;

pub async fn run(cfg: MockConfig, mut rx: mpsc::Receiver<TelemetryFrame>) {
    let mut backoff = Duration::from_millis(750);

    loop {
        match TcpStream::connect(&cfg.server).await {
            Ok(mut stream) => {
                if let Err(err) = stream.set_nodelay(true) {
                    tracing::warn!("⚠️ falha ao setar TCP_NODELAY: {}", err);
                }
                tracing::info!("🔌 conectado ao servidor mock: {}", cfg.server);
                backoff = Duration::from_millis(750);

                while let Some(frame) = rx.recv().await {
                    let bytes = frame.encode();
                    if let Err(err) = stream.write_all(&bytes).await {
                        tracing::warn!("⚠️ falha ao escrever no TCP: {}", err);
                        break;
                    }
                }

                tracing::warn!("🔌 fila encerrada ou conexão perdida, tentando reconectar");
            }
            Err(err) => {
                tracing::warn!("⚠️ erro ao conectar em {}: {}", cfg.server, err);
            }
        }

        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(5));
    }
}
