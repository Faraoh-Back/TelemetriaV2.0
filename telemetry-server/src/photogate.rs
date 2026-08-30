use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::broadcast;
use tracing::{error, info, warn};
use serde_json::json;
use sqlx::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};

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
    let socket = match UdpSocket::bind(format!("0.0.0.0:{}", port)).await {
        Ok(s) => s,
        Err(e) => {
            error!("❌ Falha ao iniciar socket UDP do Photogate na porta {}: {:?}", port, e);
            return;
        }
    };
    info!("📡 Photogate UDP listener ativo em 0.0.0.0:{}", port);

    let state = Arc::new(tokio::sync::Mutex::new(PhotogateState::new()));
    let mut buf = [0u8; 1024];

    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                if len != 20 {
                    warn!("Photogate: pacote UDP de tamanho inválido ({} bytes) de {}. Esperado: 20 bytes.", len, addr);
                    continue;
                }

                // Copy payload
                let mut payload = [0u8; 20];
                payload.copy_from_slice(&buf[0..20]);

                let pool = sqlite_pool.clone();
                let tx = ws_tx.clone();
                let state_clone = state.clone();

                tokio::spawn(async move {
                    handle_photogate_packet(payload, addr, pool, tx, state_clone).await;
                });
            }
            Err(e) => {
                error!("Erro ao receber dados no socket UDP: {:?}", e);
            }
        }
    }
}

async fn handle_photogate_packet(
    payload: [u8; 20],
    addr: std::net::SocketAddr,
    sqlite_pool: SqlitePool,
    ws_tx: broadcast::Sender<Vec<u8>>,
    state: Arc<tokio::sync::Mutex<PhotogateState>>,
) {
    // Parse:
    // ID (4B, uint32, little-endian)
    // Timestamp (8B, float64, little-endian)
    // CAN PAYLOAD (8B, dados brutos)
    let sensor_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
    let mut timestamp = f64::from_le_bytes(payload[4..12].try_into().unwrap());
    let can_payload = &payload[12..20];

    // Fallback if the timestamp is near zero (placeholder value from physical sensor)
    let now_sec = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
        
    if timestamp < 1_000_000.0 {
        timestamp = now_sec;
    }

    // Parse lap count from raw CAN payload as u32 from the first 4 bytes.
    let lap_number = u32::from_le_bytes(can_payload[0..4].try_into().unwrap()) as i32;

    info!(
        "⏱️  Photogate UDP: de={}, ID=0x{:X}, Ts={:.3}, Lap={}",
        addr, sensor_id, timestamp, lap_number
    );

    if lap_number <= 0 {
        warn!("Photogate: número de volta inválido ({}) recebido. Ignorando.", lap_number);
        return;
    }

    let mut st = state.lock().await;

    // Se é a primeira vez que recebemos ou se a volta é menor do que a última registrada,
    // podemos considerar um início de sessão (por exemplo, volta 1, ou volta inicial do piloto).
    if st.last_pass_time.is_none() {
        info!("⏱️  Sessão Photogate iniciada em Ts={:.3} na Volta (Lap={})", timestamp, lap_number);
        st.last_pass_time = Some(timestamp);
        st.laps.clear();
        broadcast_laps(&ws_tx, &st.laps);
        return;
    }

    // Se st.last_pass_time já existe:
    if let Some(prev_time) = st.last_pass_time {
        let duration = timestamp - prev_time;
        if duration <= 2.0 { // Debounce de 2 segundos para evitar leituras duplicadas
            warn!("Photogate: tempo de volta muito curto ({:.3}s). Ignorando (provável debounce).", duration);
            return;
        }

        // Se o número da volta recebido for menor ou igual à última volta registrada,
        // significa que uma nova corrida/sessão foi iniciada. Resetamos tempos.
        if !st.laps.is_empty() && lap_number <= st.laps.last().unwrap().lap {
            info!("⏱️  Novo piloto ou reinício detectado (Lap {} <= última volta {}). Resetando tempos.", lap_number, st.laps.last().unwrap().lap);
            st.laps.clear();
            st.last_pass_time = Some(timestamp);
            broadcast_laps(&ws_tx, &st.laps);
            return;
        }

        st.last_pass_time = Some(timestamp);

        // A volta completada é a volta anterior
        let completed_lap = lap_number - 1;
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
        "lap_count": laps.len() as u32,
        "best_lap": best_lap,
        "laps": laps
    });

    let _ = ws_tx.send(json_msg.to_string().into_bytes());
}
