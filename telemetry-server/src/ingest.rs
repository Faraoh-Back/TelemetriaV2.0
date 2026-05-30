use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::broadcast;
use tracing::{info, warn, error};
use crate::models::ProcessedSignal;
use crate::track_state::SharedTrackState;
use crate::db::*;
use crate::decoder;

pub async fn handle_client(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    pg_pool: sqlx::PgPool,
    decoder_map: decoder::DecoderMap,
    ws_tx: broadcast::Sender<Vec<u8>>,
    track_state: SharedTrackState,
) {
    info!("🚗 Carro conectado: {}", addr);
    let device_id = format!("car_{}", addr.ip().to_string().replace('.', "_"));

    let mut frames_total: u64 = 0;
    let mut frames_decoded: u64 = 0;
    let mut last_log = std::time::Instant::now();

    loop {
        let mut len_buf = [0u8; 4];
        match socket.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(_) => {
                warn!("🔌 Carro desconectado: {}", addr);
                break;
            }
        }

        let len = u32::from_le_bytes(len_buf) as usize;
        if len == 0 || len > 1024 {
            error!("Pacote inválido (len={}) de {} — desconectando", len, addr);
            break;
        }

        let mut payload = vec![0u8; len];
        match socket.read_exact(&mut payload).await {
            Ok(_) => {}
            Err(e) => {
                warn!("Erro ao ler payload de {}: {}", addr, e);
                break;
            }
        }

        if payload.len() < 20 {
            warn!("Payload curto ({} bytes) de {}", payload.len(), addr);
            continue;
        }

        let can_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let timestamp = f64::from_le_bytes(payload[4..12].try_into().unwrap());
        let raw_data = &payload[12..20];
        let raw_data_owned: [u8; 8] = raw_data.try_into().unwrap();

        // Latência real = agora no servidor - timestamp já corrigido pelo offset da Jetson
        let t_recv_srv = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let latency_ms = (t_recv_srv - timestamp) * 1000.0;
        if latency_ms >= 0.0 && latency_ms < 5000.0 {
            info!("⏱️  Latência | CAN=0x{:X} | {:.1}ms", can_id, latency_ms);
        }

        frames_total += 1;

        let signals_config = match decoder_map.get(&can_id) {
            Some(s) => s,
            None => continue,
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

        let pg_pool_c = pg_pool.clone();
        let processed_ts = processed.clone();

        tokio::spawn(async move {
            if let Err(e) = save_timescale(&pg_pool_c, &processed_ts).await {
                error!("❌ TimescaleDB insert error: {:?}", e);
            }
        });

        for signal in &processed {
            let mut frame = [0u8; 20];
            frame[0..4].copy_from_slice(&signal.can_id.to_le_bytes());
            frame[4..12].copy_from_slice(&signal.timestamp.to_le_bytes());
            frame[12..20].copy_from_slice(&raw_data_owned);
            let _ = ws_tx.send(frame.to_vec());
        }

        let track_messages = match track_state.lock() {
            Ok(mut state) => state.update(&processed),
            Err(e) => {
                error!("❌ track state lock error: {:?}", e);
                Vec::new()
            }
        };
        for json in track_messages {
            let _ = ws_tx.send(json.into_bytes());
        }

        if last_log.elapsed().as_secs() >= 10 {
            let elapsed = last_log.elapsed().as_secs_f64();
            info!(
                "📊 {} | frames: {} | sinais: {} | taxa: {:.0} frames/s",
                device_id, frames_total, frames_decoded,
                frames_total as f64 / elapsed
            );
            frames_total = 0;
            frames_decoded = 0;
            last_log = std::time::Instant::now();
        }
    }

    info!("👋 {} desconectado", device_id);
}

// ==================== SERVIDOR HTTP + WEBSOCKET :8081 ====================
// Uma única porta serve:
//   GET /       → index.html
//   POST /login → JWT
//   GET /ws     → WebSocket (requer JWT no header Authorization)
//   qualquer outra → 404

