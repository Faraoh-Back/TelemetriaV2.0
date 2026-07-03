use std::sync::atomic::{AtomicU64, AtomicI64, Ordering};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::process::Command;
use tracing::warn;

use super::http::send_json;
use crate::auth::ROLE_ADMIN;

// Verifica se o request tem role admin (não só permissão, mas role)
async fn request_is_admin(request: &str) -> bool {
    use crate::auth::{extract_bearer_token, extract_query_token, validate_jwt_claims};
    let token = extract_bearer_token(request)
        .or_else(|| extract_query_token(request));
    match token {
        Some(t) => validate_jwt_claims(&t)
            .map(|c| c.role == ROLE_ADMIN)
            .unwrap_or(false),
        None => false,
    }
}

pub(super) async fn handle_admin_stats(
    stream: &mut TcpStream,
    request: &str,
    latency_us: Arc<AtomicI64>,
    msg_rate: Arc<AtomicU64>,
) {
    if !request_is_admin(request).await {
        send_json(stream, 403, r#"{"ok":false,"message":"Acesso negado"}"#).await;
        return;
    }

    let latency_us_val = latency_us.load(Ordering::Relaxed);
    let rate = msg_rate.load(Ordering::Relaxed);

    let json = format!(
        r#"{{"ok":true,"latency_us":{},"msg_per_sec":{}}}"#,
        latency_us_val, rate
    );
    send_json(stream, 200, &json).await;
}

pub(super) async fn handle_admin_network(
    stream: &mut TcpStream,
    request: &str,
) {
    if !request_is_admin(request).await {
        send_json(stream, 403, r#"{"ok":false,"message":"Acesso negado"}"#).await;
        return;
    }

    // Detecta a interface de rede principal
    let iface = detect_main_iface().await.unwrap_or_else(|| "enp4s0f1".to_string());

    // Roda tc -s class show dev <iface>
    let tc_output = Command::new("tc")
        .args(["-s", "class", "show", "dev", &iface])
        .output()
        .await;

    let htb_classes = match tc_output {
        Ok(out) if out.status.success() => {
            parse_htb_classes(&String::from_utf8_lossy(&out.stdout))
        }
        Ok(out) => {
            warn!("tc falhou: {}", String::from_utf8_lossy(&out.stderr));
            vec![]
        }
        Err(e) => {
            warn!("Erro ao rodar tc: {}", e);
            vec![]
        }
    };

    // Lê /proc/net/dev para bytes totais por interface
    let net_dev = tokio::fs::read_to_string("/proc/net/dev").await.unwrap_or_default();
    let iface_stats = parse_proc_net_dev(&net_dev, &iface);

    let classes_json: Vec<String> = htb_classes.iter().map(|c| {
        format!(
            r#"{{"handle":"{}","label":"{}","sent_bytes":{},"sent_pkts":{}}}"#,
            c.handle, c.label, c.sent_bytes, c.sent_pkts
        )
    }).collect();

    let json = format!(
        r#"{{"ok":true,"iface":"{}","rx_bytes":{},"tx_bytes":{},"htb_classes":[{}],"rssi":null}}"#,
        iface,
        iface_stats.rx_bytes,
        iface_stats.tx_bytes,
        classes_json.join(",")
    );
    send_json(stream, 200, &json).await;
}

// ── Detecta interface principal (primeira que não é lo) ──────────────────────

async fn detect_main_iface() -> Option<String> {
    let output = Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .await
        .ok()?;
    let s = String::from_utf8_lossy(&output.stdout);
    // "default via X.X.X.X dev <iface> ..."
    for part in s.split_whitespace().collect::<Vec<_>>().windows(2) {
        if part[0] == "dev" {
            return Some(part[1].to_string());
        }
    }
    None
}

// ── Parser do output de `tc -s class show dev <iface>` ──────────────────────

struct HtbClass {
    handle: String,
    label: String,
    sent_bytes: u64,
    sent_pkts: u64,
}

fn parse_htb_classes(output: &str) -> Vec<HtbClass> {
    let mut classes = Vec::new();
    let mut current_handle: Option<String> = None;

    for line in output.lines() {
        let line = line.trim();

        // "class htb 1:10 parent 1: ..."
        if line.starts_with("class htb") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                current_handle = Some(parts[2].to_string());
            }
        }

        // " Sent 123456 bytes 789 pkt ..."
        if line.starts_with("Sent") {
            if let Some(ref handle) = current_handle {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let sent_bytes = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0u64);
                let sent_pkts  = parts.get(3).and_then(|v| v.parse().ok()).unwrap_or(0u64);

                let label = match handle.as_str() {
                    "1:10" => "CAN Telemetria",
                    "1:20" => "WebSocket Dashboard",
                    "1:30" => "Geral",
                    _      => handle.as_str(),
                }.to_string();

                classes.push(HtbClass {
                    handle: handle.clone(),
                    label,
                    sent_bytes,
                    sent_pkts,
                });
                current_handle = None;
            }
        }
    }
    classes
}

// ── Parser de /proc/net/dev ──────────────────────────────────────────────────

struct IfaceStats {
    rx_bytes: u64,
    tx_bytes: u64,
}

fn parse_proc_net_dev(content: &str, iface: &str) -> IfaceStats {
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with(iface) {
            // formato: iface: rx_bytes rx_pkts ... tx_bytes tx_pkts ...
            let after_colon = line.splitn(2, ':').nth(1).unwrap_or("").trim();
            let fields: Vec<&str> = after_colon.split_whitespace().collect();
            // campos: [rx_bytes, rx_pkts, rx_errs, rx_drop, rx_fifo, rx_frame, rx_comp, rx_multi,
            //          tx_bytes, tx_pkts, ...]
            let rx_bytes = fields.first().and_then(|v| v.parse().ok()).unwrap_or(0);
            let tx_bytes = fields.get(8).and_then(|v| v.parse().ok()).unwrap_or(0);
            return IfaceStats { rx_bytes, tx_bytes };
        }
    }
    IfaceStats { rx_bytes: 0, tx_bytes: 0 }
}