use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tracing::{error, info, warn};
use serde_json::json;
use sqlx::SqlitePool;

// Format representing a lap entry to send to the frontend
#[derive(serde::Serialize, Clone, Debug)]
pub struct LapEntry {
    pub lap: i32,
    pub time: f64,
    pub formatted: String,
}

// In-memory state of the photogate tracking session
struct PhotogateState {
    last_pass_time: Option<f64>,
    laps: Vec<LapEntry>,
}

impl PhotogateState {
    fn new() -> Self {
        Self {
            last_pass_time: None,
            laps: Vec::new(),
        }
    }
}

pub async fn run_photogate_server(
    port: u16,
    sqlite_pool: SqlitePool,
    ws_tx: broadcast::Sender<Vec<u8>>,
) {
    let listener = match TcpListener::bind(format!("0.0.0.0:{}", port)).await {
        Ok(l) => l,
        Err(e) => {
            error!("❌ Falha ao iniciar listener do Photogate na porta {}: {:?}", port, e);
            return;
        }
    };
    info!("📡 Photogate listener ativo em 0.0.0.0:{}", port);

    // Use a shared state protected by a Mutex (assuming a single active session)
    let state = Arc::new(tokio::sync::Mutex::new(PhotogateState::new()));

    loop {
        match listener.accept().await {
            Ok((socket, addr)) => {
                info!("⏱️  Dispositivo Photogate conectado: {}", addr);
                let pool = sqlite_pool.clone();
                let tx = ws_tx.clone();
                let state_clone = state.clone();
                tokio::spawn(async move {
                    handle_photogate_connection(socket, addr, pool, tx, state_clone).await;
                });
            }
            Err(e) => {
                error!("Erro ao aceitar conexão no Photogate listener: {:?}", e);
            }
        }
    }
}

async fn handle_photogate_connection(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    sqlite_pool: SqlitePool,
    ws_tx: broadcast::Sender<Vec<u8>>,
    state: Arc<tokio::sync::Mutex<PhotogateState>>,
) {
    loop {
        let mut len_buf = [0u8; 4];
        match socket.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(_) => {
                warn!("🔌 Dispositivo Photogate desconectado: {}", addr);
                break;
            }
        }

        let len = u32::from_le_bytes(len_buf) as usize;
        if len != 20 {
            error!("Photogate: tamanho de pacote inválido (len={}) de {} — desconectando", len, addr);
            break;
        }

        let mut payload = [0u8; 20];
        match socket.read_exact(&mut payload).await {
            Ok(_) => {}
            Err(e) => {
                warn!("Photogate: erro ao ler payload de {}: {}", addr, e);
                break;
            }
        }

        // Parse:
        // ID (4B, uint32, little-endian)
        // Timestamp (8B, float64, little-endian)
        // CAN PAYLOAD (8B, dados brutos)
        let sensor_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let timestamp = f64::from_le_bytes(payload[4..12].try_into().unwrap());
        let can_payload = &payload[12..20];

        // Parse lap count from raw CAN payload as u32 from the first 4 bytes.
        let lap_number = u32::from_le_bytes(can_payload[0..4].try_into().unwrap()) as i32;

        info!("⏱️  Photogate: ID=0x{:X}, Ts={:.3}, Lap={}", sensor_id, timestamp, lap_number);

        if lap_number <= 0 {
            warn!("Photogate: número de volta inválido ({}) recebido. Ignorando.", lap_number);
            continue;
        }

        let mut st = state.lock().await;

        if lap_number == 1 {
            // Volta 1: início do piloto, ponto de partida.
            info!("⏱️  Volta 1 iniciada em Ts={:.3} (Início do piloto)", timestamp);
            st.last_pass_time = Some(timestamp);
            st.laps.clear();

            // Envia evento de reset/atualização inicial das voltas para o frontend
            broadcast_laps(&ws_tx, &st.laps);
        } else {
            // Volta > 1: piloto completou a volta anterior (lap_number - 1).
            if let Some(prev_time) = st.last_pass_time {
                let duration = timestamp - prev_time;
                if duration <= 1.0 {
                    warn!("Photogate: tempo de volta muito curto ({:.3}s). Ignorando (provável debounce).", duration);
                    continue;
                }

                let completed_lap = lap_number - 1;
                st.last_pass_time = Some(timestamp);

                let formatted = format_lap_time(duration);
                let entry = LapEntry {
                    lap: completed_lap,
                    time: duration,
                    formatted: formatted.clone(),
                };
                st.laps.push(entry);

                info!("⏱️  Volta {} completada: {} ({:.3}s)", completed_lap, formatted, duration);

                // Salva no banco de dados SQLite
                if let Err(e) = crate::db::save_lap(&sqlite_pool, completed_lap, duration, timestamp).await {
                    error!("❌ Erro ao salvar volta no banco de dados: {:?}", e);
                }

                // Envia para o frontend via WebSocket
                broadcast_laps(&ws_tx, &st.laps);
            } else {
                // Caso o servidor tenha reiniciado/conectado no meio e recebido Volta > 1 sem ter visto a Volta 1
                warn!("Photogate: recebida Volta {}, mas não há registro da passagem inicial (Volta 1). Iniciando cronômetro agora.", lap_number);
                st.last_pass_time = Some(timestamp);
            }
        }
    }
}

fn format_lap_time(seconds: f64) -> String {
    let min = (seconds / 60.0).floor() as i32;
    let sec = seconds % 60.0;
    format!("{}:{:06.3}", min, sec)
}

fn broadcast_laps(ws_tx: &broadcast::Sender<Vec<u8>>, laps: &[LapEntry]) {
    let best_lap = laps
        .iter()
        .min_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal))
        .cloned();

    let json_msg = json!({
        "type": "laps",
        "payload": {
            "lap_count": laps.len() as u32,
            "best_lap": best_lap,
            "laps": laps
        }
    });

    let _ = ws_tx.send(json_msg.to_string().into_bytes());
}
