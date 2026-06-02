use chrono::Utc;
use serde_json::json;
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use tokio::net::TcpStream;
use tracing::{error, info};

use crate::models::{CollectionStartRequest, CollectionStopRequest, LogSessionBoundsRequest};

use super::http::{
    api_request_has_permission, parse_json_body, send_json, unix_seconds, START_PERMISSION,
    STOP_PERMISSION,
};

pub(super) async fn handle_collection_start(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, START_PERMISSION).await {
        return;
    }

    let start_req: CollectionStartRequest = match parse_json_body(request) {
        Ok(r) => r,
        Err(status) => {
            send_json(stream, status, r#"{"ok":false,"message":"JSON inválido"}"#).await;
            return;
        }
    };

    let active = sqlx::query(
        "SELECT id FROM telemetry_log_sessions WHERE state = 'active' AND ended_at_unix IS NULL ORDER BY id DESC LIMIT 1"
    )
    .fetch_optional(sqlite_pool)
    .await;

    match active {
        Ok(Some(row)) => {
            let id: i64 = row.get("id");
            let body = json!({
                "ok": false,
                "message": "Ja existe uma coleta em andamento.",
                "active_session_id": id,
            });
            send_json(stream, 409, &body.to_string()).await;
            return;
        }
        Ok(None) => {}
        Err(e) => {
            error!("Erro ao consultar sessao ativa: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
            return;
        }
    }

    let now = Utc::now();
    let started_at_unix = unix_seconds(&now);
    let started_at_iso = now.to_rfc3339();

    match sqlx::query(
        r#"
        INSERT INTO telemetry_log_sessions
            (started_at_unix, started_at_iso, start_requested_at, collection_start_sec, state)
        VALUES (?, ?, ?, 0, 'active')
    "#,
    )
    .bind(started_at_unix)
    .bind(&started_at_iso)
    .bind(start_req.requested_at.as_deref())
    .execute(sqlite_pool)
    .await
    {
        Ok(result) => {
            let id = result.last_insert_rowid();
            let body = json!({
                "ok": true,
                "state": "live",
                "id": id,
                "collection_start_sec": 0.0,
                "started_at": 0.0,
                "received_at": started_at_iso,
            });
            info!("▶️  Coleta iniciada: sessao {}", id);
            send_json(stream, 200, &body.to_string()).await;
        }
        Err(e) => {
            error!("Erro ao iniciar coleta: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
        }
    }
}

pub(super) async fn handle_collection_stop(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, STOP_PERMISSION).await {
        return;
    }

    let stop_req: CollectionStopRequest = match parse_json_body(request) {
        Ok(r) => r,
        Err(status) => {
            send_json(stream, status, r#"{"ok":false,"message":"JSON inválido"}"#).await;
            return;
        }
    };

    let active = match sqlx::query(
        "SELECT id, started_at_unix FROM telemetry_log_sessions WHERE state = 'active' AND ended_at_unix IS NULL ORDER BY id DESC LIMIT 1"
    )
    .fetch_optional(sqlite_pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            error!("Erro ao consultar sessao ativa: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
            return;
        }
    };

    let Some(row) = active else {
        send_json(
            stream,
            409,
            r#"{"ok":false,"message":"Nao existe coleta em andamento."}"#,
        )
        .await;
        return;
    };

    let id: i64 = row.get("id");
    let started_at_unix: f64 = row.get("started_at_unix");
    let now = Utc::now();
    let ended_at_unix = unix_seconds(&now);
    let ended_at_iso = now.to_rfc3339();
    let collection_stop_sec = (ended_at_unix - started_at_unix).max(0.0);
    let log_duration_sec = match (stop_req.log_start_unix, stop_req.log_stop_unix) {
        (Some(start), Some(stop)) if stop >= start => Some(stop - start),
        _ => None,
    };

    match sqlx::query(
        r#"
        UPDATE telemetry_log_sessions
        SET ended_at_unix = ?,
            ended_at_iso = ?,
            stop_requested_at = ?,
            log_start_unix = COALESCE(?, log_start_unix),
            log_stop_unix = COALESCE(?, log_stop_unix),
            collection_stop_sec = ?,
            log_start_sec = CASE WHEN ? IS NOT NULL THEN 0 ELSE log_start_sec END,
            log_stop_sec = COALESCE(?, log_stop_sec),
            state = 'stopped',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#,
    )
    .bind(ended_at_unix)
    .bind(&ended_at_iso)
    .bind(stop_req.requested_at.as_deref())
    .bind(stop_req.log_start_unix)
    .bind(stop_req.log_stop_unix)
    .bind(collection_stop_sec)
    .bind(log_duration_sec)
    .bind(log_duration_sec)
    .bind(id)
    .execute(sqlite_pool)
    .await
    {
        Ok(_) => {
            let body = json!({
                "ok": true,
                "state": "stopped",
                "id": id,
                "collection_start_sec": 0.0,
                "collection_stop_sec": collection_stop_sec,
                "started_at": 0.0,
                "ended_at": collection_stop_sec,
                "duration_seconds": collection_stop_sec,
                "received_at": ended_at_iso,
            });
            info!("⏹️  Coleta encerrada: sessao {}", id);
            send_json(stream, 200, &body.to_string()).await;
        }
        Err(e) => {
            error!("Erro ao encerrar coleta: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
        }
    }
}

pub(super) async fn handle_log_session_bounds(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, STOP_PERMISSION).await {
        return;
    }

    let bounds_req: LogSessionBoundsRequest = match parse_json_body(request) {
        Ok(r) => r,
        Err(status) => {
            send_json(stream, status, r#"{"ok":false,"message":"JSON inválido"}"#).await;
            return;
        }
    };

    if bounds_req.log_stop_unix < bounds_req.log_start_unix {
        send_json(
            stream,
            400,
            r#"{"ok":false,"message":"Limites de coleta invalidos."}"#,
        )
        .await;
        return;
    }

    let session = match sqlx::query(
        "SELECT id FROM telemetry_log_sessions WHERE state = 'stopped' ORDER BY ended_at_unix DESC, id DESC LIMIT 1"
    )
    .fetch_optional(sqlite_pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            error!("Erro ao localizar sessao encerrada: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
            return;
        }
    };

    let Some(row) = session else {
        send_json(
            stream,
            409,
            r#"{"ok":false,"message":"Nenhuma coleta encerrada para atualizar."}"#,
        )
        .await;
        return;
    };

    let id: i64 = row.get("id");
    let log_stop_sec = bounds_req.log_stop_unix - bounds_req.log_start_unix;
    match sqlx::query(
        r#"
        UPDATE telemetry_log_sessions
        SET log_start_unix = ?,
            log_stop_unix = ?,
            log_start_sec = 0,
            log_stop_sec = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#,
    )
    .bind(bounds_req.log_start_unix)
    .bind(bounds_req.log_stop_unix)
    .bind(log_stop_sec)
    .bind(id)
    .execute(sqlite_pool)
    .await
    {
        Ok(_) => {
            let body = json!({
                "ok": true,
                "id": id,
                "status": "processing",
                "log_start_sec": 0.0,
                "log_stop_sec": log_stop_sec,
                "duration_seconds": log_stop_sec,
            });
            info!("🧭 Bounds persistidos para coleta {}", id);
            send_json(stream, 200, &body.to_string()).await;
        }
        Err(e) => {
            error!("Erro ao persistir bounds da coleta: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
        }
    }
}
