use bcrypt::verify;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tracing::{error, info, warn};

use crate::auth::*;
use crate::db::*;
use crate::models::*;
use crate::ws::*;

const INDEX_HTML: &str = include_str!("../static/dist/index.html");

pub async fn run_http_ws_server(
    ws_broadcast_tx: broadcast::Sender<Vec<u8>>,
    pg_pool: sqlx::PgPool,
    sqlite_pool: SqlitePool,
    port: u16,
) {
    let listener = match TcpListener::bind(format!("0.0.0.0:{}", port)).await {
        Ok(l) => {
            info!("🌐 HTTP+WS server em 0.0.0.0:{}", port);
            l
        }
        Err(e) => {
            error!("❌ Falha ao abrir porta {}: {}", port, e);
            return;
        }
    };

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let tx = ws_broadcast_tx.clone();
                let db = sqlite_pool.clone();
                let pg = pg_pool.clone();
                tokio::spawn(async move {
                    handle_http_connection(stream, addr, tx, pg, db).await;
                });
            }
            Err(e) => error!("Erro ao aceitar conexão: {}", e),
        }
    }
}

async fn handle_http_connection(
    mut stream: TcpStream,
    addr: std::net::SocketAddr,
    ws_tx: broadcast::Sender<Vec<u8>>,
    pg_pool: sqlx::PgPool,
    sqlite_pool: SqlitePool,
) {
    let mut buf = vec![0u8; 4096];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request = match std::str::from_utf8(&buf[..n]) {
        Ok(s) => s.to_string(),
        Err(_) => return,
    };

    let first_line = request.lines().next().unwrap_or("");

    if first_line.starts_with("GET / ") || first_line.starts_with("GET / HTTP") {
        serve_html(&mut stream).await;
    } else if first_line.starts_with("POST /login") {
        handle_login(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("GET /ws") {
        handle_ws_upgrade(stream, &request, addr, ws_tx).await;
    } else if first_line.starts_with("POST /telemetry/collection/start") {
        handle_collection_start(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("POST /telemetry/collection/stop") {
        handle_collection_stop(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("POST /telemetry/log-session-bounds") {
        handle_log_session_bounds(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("GET /assets/")
        || first_line.starts_with("GET /worker.js")
        || first_line.starts_with("GET /favicon.svg")
        || first_line.starts_with("GET /icons.svg")
    {
        serve_static_file(&mut stream, first_line).await;
    } else if first_line.starts_with("POST /migrate") {
        handle_migrate(&mut stream, &request, &pg_pool, &sqlite_pool).await;
    } else {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
        let _ = stream.write_all(response.as_bytes()).await;
    }
}

async fn serve_html(stream: &mut TcpStream) {
    let body = INDEX_HTML;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

async fn serve_static_file(stream: &mut TcpStream, first_line: &str) {
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");
    let file_path = format!("./static/dist{}", path);

    let content_type = if path.ends_with(".js") {
        "application/javascript"
    } else if path.ends_with(".css") {
        "text/css"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    };

    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: max-age=3600\r\n\r\n",
                content_type,
                bytes.len()
            );
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(&bytes).await;
        }
        Err(_) => {
            let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
            let _ = stream.write_all(response.as_bytes()).await;
        }
    }
}

async fn handle_login(stream: &mut TcpStream, request: &str, sqlite_pool: &SqlitePool) {
    let body = match request.split("\r\n\r\n").nth(1) {
        Some(b) => b.trim(),
        None => {
            send_json(stream, 400, r#"{"ok":false,"message":"Bad request"}"#).await;
            return;
        }
    };

    let login_req: LoginRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(_) => {
            send_json(stream, 400, r#"{"ok":false,"message":"JSON inválido"}"#).await;
            return;
        }
    };

    let row = sqlx::query(
        "SELECT password_hash, COALESCE(role, 'member') as role FROM users WHERE username = ?",
    )
    .bind(&login_req.username)
    .fetch_optional(sqlite_pool)
    .await;

    match row {
        Ok(Some(row)) => {
            let hash: String = row.get("password_hash");
            let role_raw: String = row.get("role");
            let role = normalize_role(&role_raw);
            let permissions = permissions_for_role(role);

            match verify(&login_req.password, &hash) {
                Ok(true) => match generate_jwt(&login_req.username, role) {
                    Ok(token) => {
                        let body = json!({
                            "ok": true,
                            "token": token,
                            "user": {
                                "username": &login_req.username,
                                "role": role,
                                "permissions": permissions,
                            }
                        });
                        send_json(stream, 200, &body.to_string()).await;
                        info!("🔑 Login OK: {}", login_req.username);
                    }
                    Err(e) => {
                        error!("Erro ao gerar JWT: {}", e);
                        send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
                    }
                },
                _ => {
                    send_json(
                        stream,
                        401,
                        r#"{"ok":false,"message":"Credenciais inválidas"}"#,
                    )
                    .await;
                    warn!("🔒 Login falhou: {}", login_req.username);
                }
            }
        }
        Ok(None) => {
            send_json(
                stream,
                401,
                r#"{"ok":false,"message":"Credenciais inválidas"}"#,
            )
            .await;
        }
        Err(e) => {
            error!("Erro ao consultar banco: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
        }
    }
}

async fn handle_collection_start(stream: &mut TcpStream, request: &str, sqlite_pool: &SqlitePool) {
    if !api_request_has_permission(stream, request, PERMISSION_TELEMETRY_START).await {
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

async fn handle_collection_stop(stream: &mut TcpStream, request: &str, sqlite_pool: &SqlitePool) {
    if !api_request_has_permission(stream, request, PERMISSION_TELEMETRY_STOP).await {
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

async fn handle_log_session_bounds(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, PERMISSION_TELEMETRY_STOP).await {
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

async fn handle_migrate(
    stream: &mut TcpStream,
    request: &str,
    pg_pool: &sqlx::PgPool,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, PERMISSION_TELEMETRY_START).await {
        return;
    }

    info!("🔄 Migração manual disparada via POST /migrate");

    match migrate_old_data(pg_pool, sqlite_pool).await {
        Ok(n) => {
            let json = format!(r#"{{"ok":true,"migrated":{}}}"#, n);
            send_json(stream, 200, &json).await;
        }
        Err(e) => {
            error!("❌ Erro na migração manual: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro na migração"}"#).await;
        }
    }
}

async fn send_json(stream: &mut TcpStream, status: u16, body: &str) {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        500 => "Internal Server Error",
        _ => "Unknown",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
        status, status_text, body.len(), body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

fn parse_json_body<T: for<'de> Deserialize<'de>>(request: &str) -> Result<T, u16> {
    let body = request.split("\r\n\r\n").nth(1).ok_or(400u16)?.trim();

    serde_json::from_str(body).map_err(|_| 400)
}

async fn api_request_has_permission(
    stream: &mut TcpStream,
    request: &str,
    permission: &str,
) -> bool {
    let token = match extract_bearer_token(request) {
        Some(token) => token,
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token necessário"}"#).await;
            return false;
        }
    };

    let claims = match validate_jwt_claims(&token) {
        Some(claims) => claims,
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token inválido"}"#).await;
            return false;
        }
    };

    if !claims_has_permission(&claims, permission) {
        send_json(
            stream,
            403,
            r#"{"ok":false,"message":"Permissao insuficiente."}"#,
        )
        .await;
        return false;
    }

    true
}

fn unix_seconds(dt: &DateTime<Utc>) -> f64 {
    dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_micros()) / 1_000_000.0
}

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
