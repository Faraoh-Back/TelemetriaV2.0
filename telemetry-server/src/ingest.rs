use crate::db::save_timescale;
use crate::decoder;
use crate::models::ProcessedSignal;
use crate::track_state::SharedTrackState;
use std::collections::{HashMap, HashSet};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tracing::{error, info, warn};
use std::sync::Arc;
use std::sync::{AtomicI64, AtomicU64, Ordering};  
use tokio::io::AsyncWriteExt;

struct DecodeDebugConfig {
    enabled: bool,
    can_ids: Option<HashSet<u32>>,
    signal_names: Option<HashSet<String>>,
    latency_enabled: bool,
    unmapped_immediate: bool,
}

impl DecodeDebugConfig {
    fn from_env() -> Self {
        let enabled = env_bool("CAN_DECODE_DEBUG", false);

        Self {
            enabled,
            can_ids: parse_can_id_filter("CAN_DECODE_DEBUG_IDS"),
            signal_names: parse_string_filter("CAN_DECODE_DEBUG_SIGNALS"),
            latency_enabled: env_bool("CAN_LATENCY_LOG", true),
            unmapped_immediate: env_bool("CAN_DEBUG_UNMAPPED", false),
        }
    }

    fn should_log_frame(&self, can_id: u32) -> bool {
        self.enabled
            && self
                .can_ids
                .as_ref()
                .map(|ids| ids.contains(&can_id))
                .unwrap_or(true)
    }

    fn should_log_signal(&self, signal_name: &str) -> bool {
        self.signal_names
            .as_ref()
            .map(|names| names.contains(signal_name))
            .unwrap_or(true)
    }
}

fn env_bool(var_name: &str, default: bool) -> bool {
    std::env::var(var_name)
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"))
        .unwrap_or(default)
}

fn parse_can_id_filter(var_name: &str) -> Option<HashSet<u32>> {
    let value = std::env::var(var_name).ok()?;
    let ids: HashSet<u32> = value
        .split(',')
        .filter_map(|item| {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                return None;
            }
            let hex = trimmed
                .strip_prefix("0x")
                .or_else(|| trimmed.strip_prefix("0X"));
            match hex {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => trimmed.parse::<u32>().ok(),
            }
        })
        .collect();

    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}

fn parse_string_filter(var_name: &str) -> Option<HashSet<String>> {
    let value = std::env::var(var_name).ok()?;
    let names: HashSet<String> = value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    if names.is_empty() {
        None
    } else {
        Some(names)
    }
}

fn format_raw_data(raw_data: &[u8]) -> String {
    raw_data
        .iter()
        .map(|byte| format!("{:02X}", byte))
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_can_counts(counts: &HashMap<u32, u64>, limit: usize) -> String {
    let mut items: Vec<(u32, u64)> = counts.iter().map(|(id, count)| (*id, *count)).collect();
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    items
        .into_iter()
        .take(limit)
        .map(|(id, count)| format!("0x{:X}/{}={}", id, id, count))
        .collect::<Vec<_>>()
        .join(", ")
}

pub async fn handle_client(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    pg_pool: sqlx::PgPool,
    decoder_map: decoder::DecoderMap,
    ws_tx: broadcast::Sender<Vec<u8>>,
    track_state: SharedTrackState,
    sqlite_tx: tokio::sync::mpsc::Sender<Vec<ProcessedSignal>>,
    timescale_tx: tokio::sync::mpsc::Sender<Vec<ProcessedSignal>>,
    edge_cmd_tx_source: broadcast::Sender<Vec<u8>>,
    latenccy_us: Arc<AtomicI64>,
    msg_rate: Arc<AtomicU64>,
) {
    info!("🚗 Carro conectado: {}", addr);

    // Split: write_half fica na task de comandos, read_half no loop principal
    let (mut read_half, write_half) = socket.into_split();
    let write_half = Arc::new(tokio::sync::Mutex::new(write_half));

    // Task que ouve comandos do servidor e escreve no TCP do carro
    {
        let write_half = write_half.clone();
        let mut edge_cmd_rx = edge_cmd_tx_source.subscribe();
        let addr_str = addr.to_string();
        tokio::spawn(async move {
            loop {
                match edge_cmd_rx.recv().await {
                    Ok(cmd_frame) => {
                        if cmd_frame.len() >= 4 {
                            let cmd_can_id = u32::from_le_bytes(cmd_frame[0..4].try_into().unwrap());
                            if cmd_can_id == 0x67 {
                                info!("🛑 EMERGENCY STOP → enviando 0x67 para {}", addr_str);
                                let mut wh = write_half.lock().await;
                                // Mesmo protocolo do edge: [4B len][payload]
                                let len = cmd_frame.len() as u32;
                                let _ = wh.write_all(&len.to_le_bytes()).await;
                                let _ = wh.write_all(&cmd_frame).await;
                                let _ = wh.flush().await;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("⚠️  edge_cmd canal atrasou {} mensagens", n);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let device_id = format!("car_{}", addr.ip().to_string().replace('.', "_"));
    let decode_debug = DecodeDebugConfig::from_env();
    if decode_debug.enabled {
        info!(
            "[CAN_DEBUG] ativo | ids={:?} | signals={:?} | unmapped_immediate={} | latency={}",
            decode_debug.can_ids,
            decode_debug.signal_names,
            decode_debug.unmapped_immediate,
            decode_debug.latency_enabled
        );
    }

    let mut frames_total: u64 = 0;
    let mut frames_decoded: u64 = 0;
    let mut frames_unmapped: u64 = 0;
    let mut unmapped_counts: HashMap<u32, u64> = HashMap::new();
    let mut last_log = std::time::Instant::now();

    loop {
        let mut len_buf = [0u8; 4];
        match read_half.read_exact(&mut len_buf).await {
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
        match read_half.read_exact(&mut payload).await {
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
        let should_log_decode = decode_debug.should_log_frame(can_id);

        if should_log_decode {
            info!(
                "[CAN_DEBUG] RX | id_dec={} | id_hex=0x{:X} | timestamp={:.6} | raw=[{}] | payload_len={}",
                can_id,
                can_id,
                timestamp,
                format_raw_data(raw_data),
                payload.len()
            );
        }

        // Latência real = agora no servidor - timestamp já corrigido pelo offset da Jetson
        let t_recv_srv = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let latency_ms = (t_recv_srv - timestamp) * 1000.0;
        if decode_debug.latency_enabled && latency_ms >= 0.0 && latency_ms < 5000.0 {
            info!("[CAN_LATENCY] id=0x{:X} | {:.1}ms", can_id, latency_ms);
        }
        if latency_ms >= 0.0 && latency_ms < 5000.0 {
            latency_us.store((latency_ms * 1000.0) as i64, Ordering::Relaxed);
        }

        frames_total += 1;

        let signals_config = match decoder_map.get(&can_id) {
            Some(s) => s,
            None => {
                frames_unmapped += 1;
                *unmapped_counts.entry(can_id).or_insert(0) += 1;
                if should_log_decode || decode_debug.unmapped_immediate {
                    warn!(
                        "[CAN_UNMAPPED] RX sem mapeamento | id_dec={} | id_hex=0x{:X} | raw=[{}]",
                        can_id,
                        can_id,
                        format_raw_data(raw_data)
                    );
                }
                continue;
            }
        };

        if should_log_decode {
            info!(
                "[CAN_DEBUG] map match | id_dec={} | id_hex=0x{:X} | sinais={}",
                can_id,
                can_id,
                signals_config.len()
            );
        }

        let processed: Vec<ProcessedSignal> = signals_config
            .iter()
            .map(|cfg| {
                let trace = decoder::decode_signal_trace(raw_data, cfg);
                if should_log_decode && decode_debug.should_log_signal(&cfg.signal_name) {
                    info!(
                        "[CAN_DEBUG] decode | id=0x{:X} | signal={} | sb={} | len={} | order={:?} | signed={} | raw_unsigned={} | raw_signed={:?} | calc_input={} | factor={} | offset={} | final={} {}",
                        can_id,
                        cfg.signal_name,
                        cfg.start_bit,
                        cfg.length,
                        cfg.byte_order,
                        cfg.is_signed,
                        trace.raw_unsigned,
                        trace.raw_signed,
                        trace.raw_physical_input,
                        trace.factor,
                        trace.offset,
                        trace.physical_value,
                        cfg.unit
                    );
                }
                ProcessedSignal {
                    timestamp,
                    device_id: device_id.clone(),
                    can_id,
                    signal_name: cfg.signal_name.clone(),
                    value: trace.physical_value,
                    unit: cfg.unit.clone(),
                }
            })
            .collect();

        frames_decoded += processed.len() as u64;
        
        // Envia para os buffers de banco de dados (não bloqueia — só empurra nos canais)
        let _ = sqlite_tx.try_send(processed.clone());
        let _ = timescale_tx.try_send(processed.clone());

        // Envia o frame CAN original apenas UMA VEZ para o broadcast, 
        // em vez de repetir para cada sinal decodificado. Isso reduz o tráfego significativamente.
        let mut frame = [0u8; 20];
        frame[0..4].copy_from_slice(&can_id.to_le_bytes());
        frame[4..12].copy_from_slice(&timestamp.to_le_bytes());
        frame[12..20].copy_from_slice(&raw_data_owned);
        let _ = ws_tx.send(frame.to_vec());

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
            let rate = (frames_total as f64 / elapsed) as u64;
            msg_rate.store(rate, Ordering::Relaxed);
            info!(
                "[CAN_STATS] {} | frames={} | sinais={} | sem_mapa={} | taxa={:.0} frames/s",
                device_id,
                frames_total,
                frames_decoded,
                frames_unmapped,
                frames_total as f64 / elapsed
            );
            if !unmapped_counts.is_empty() {
                warn!(
                    "[CAN_UNMAPPED] resumo_10s | ids={}",
                    format_can_counts(&unmapped_counts, 20)
                );
            }
            frames_total = 0;
            frames_decoded = 0;
            frames_unmapped = 0;
            unmapped_counts.clear();
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
