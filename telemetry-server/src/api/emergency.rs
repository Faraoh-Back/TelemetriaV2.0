use serde_json::json;
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::auth::{extract_bearer_token, validate_jwt_claims, ROLE_ADMIN};

use super::http::send_json;

/// POST /telemetry/emergency-stop
///
/// Envia o comando de emergência 0x67 para o barramento CAN via broadcast.
/// RESTRITO A ADMINISTRADORES — mata o carro imediatamente.
///
/// O frame broadcast segue o mesmo protocolo binário de 20 bytes:
///   [u32 can_id LE | f64 timestamp LE | u8×8 payload]
/// com can_id = 0x67 e payload todo 0xFF (sinal de kill).
pub(super) async fn handle_emergency_stop(
    stream: &mut TcpStream,
    request: &str,
    ws_tx: &broadcast::Sender<Vec<u8>>,
    edge_cmd_tx: &broadcast::Sender<Vec<u8>>,
) {
    // ── Autenticação: exige token JWT válido ──────────────────────────────────
    let token = match extract_bearer_token(request) {
        Some(t) => t,
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token necessário"}"#).await;
            return;
        }
    };

    let claims = match validate_jwt_claims(&token) {
        Some(c) => c,
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token inválido"}"#).await;
            return;
        }
    };

    // ── Autorização: somente admins podem matar o carro ──────────────────────
    if claims.role != ROLE_ADMIN {
        warn!(
            "🔒 Emergency stop NEGADO para usuario '{}' (role={})",
            claims.sub, claims.role
        );
        send_json(
            stream,
            403,
            r#"{"ok":false,"message":"Apenas administradores podem executar a parada de emergência."}"#,
        )
        .await;
        return;
    }

    // ── Monta o frame CAN de kill (0x67) ─────────────────────────────────────
    let can_id: u32 = 0x67;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();

    let mut frame = [0u8; 20];
    frame[0..4].copy_from_slice(&can_id.to_le_bytes());
    frame[4..12].copy_from_slice(&timestamp.to_le_bytes());
    // Payload: 0xFF em todos os 8 bytes — convenção de kill
    frame[12..20].copy_from_slice(&[0x00; 8]);

    // Broadcast para todos os listeners (WS clients + edge devices)
    match ws_tx.send(frame.to_vec()) {
        Ok(receivers) => {
            info!(
                "🛑 EMERGENCY STOP enviado por '{}' — 0x{:X} broadcast para {} receivers",
                claims.sub, can_id, receivers
            );
        }
        Err(_) => {
            warn!(
                "⚠️ EMERGENCY STOP enviado por '{}' mas sem receivers ativos",
                claims.sub
            );
        }
    }

    // Broadcast para clientes WebSocket (dashboard)
    match ws_tx.send(frame.to_vec()) {
        Ok(n) => info!("🛑 EMERGENCY → {} WS receivers", n),
        Err(_) => warn!("⚠️  Nenhum WS receiver ativo"),
    }

    // Canal dedicado para o edge/carro
    match edge_cmd_tx.send(frame.to_vec()) {
        Ok(n) => info!("🛑 EMERGENCY → {} edge receivers", n),
        Err(_) => warn!("⚠️  Nenhum edge conectado para receber o kill"),
    }

    let body = json!({
        "ok": true,
        "message": "Comando de parada de emergência enviado.",
        "can_id": format!("0x{:X}", can_id),
        "sent_by": claims.sub,
        "timestamp": timestamp,
    });

    send_json(stream, 200, &body.to_string()).await;
}

/// POST /telemetry/emergency-resume
pub(super) async fn handle_emergency_resume(
    stream: &mut TcpStream,
    request: &str,
    ws_tx: &broadcast::Sender<Vec<u8>>,
    edge_cmd_tx: &broadcast::Sender<Vec<u8>>,
) {
    let token = match extract_bearer_token(request) {
        Some(t) => t,
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token necessário"}"#).await;
            return;
        }
    };

    let claims = match validate_jwt_claims(&token) {
        Some(c) => c,
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token inválido"}"#).await;
            return;
        }
    };

    if claims.role != ROLE_ADMIN {
        send_json(stream, 403, r#"{"ok":false,"message":"Apenas administradores podem religar o carro."}"#).await;
        return;
    }

    let can_id: u32 = 0x67;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();

    let mut frame = [0u8; 20];
    frame[0..4].copy_from_slice(&can_id.to_le_bytes());
    frame[4..12].copy_from_slice(&timestamp.to_le_bytes());
    frame[12..20].copy_from_slice(&[0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    let _ = ws_tx.send(frame.to_vec());
    let _ = edge_cmd_tx.send(frame.to_vec());

    info!("🟢 EMERGENCY RESUME enviado por '{}'", claims.sub);

    let body = serde_json::json!({
        "ok": true,
        "message": "Comando de religamento enviado.",
        "can_id": format!("0x{:X}", can_id),
        "sent_by": claims.sub,
        "timestamp": timestamp,
    });

    send_json(stream, 200, &body.to_string()).await;
}