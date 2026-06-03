mod auth_handlers;
mod collection;
mod http;
mod migrate;
mod logs;

use sqlx::sqlite::SqlitePool;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::ws::handle_ws_upgrade;

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
        http::serve_html(&mut stream).await;
    } else if first_line.starts_with("POST /login") {
        auth_handlers::handle_login(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("GET /ws") {
        handle_ws_upgrade(stream, &request, addr, ws_tx).await;
    } else if first_line.starts_with("POST /telemetry/collection/start") {
        collection::handle_collection_start(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("POST /telemetry/collection/stop") {
        collection::handle_collection_stop(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("POST /telemetry/log-session-bounds") {
        collection::handle_log_session_bounds(&mut stream, &request, &sqlite_pool).await;
    } else if first_line.starts_with("GET /assets/")
        || first_line.starts_with("GET /worker.js")
        || first_line.starts_with("GET /favicon.svg")
        || first_line.starts_with("GET /icons.svg")
    {
        http::serve_static_file(&mut stream, first_line).await;
    } else if first_line.starts_with("POST /migrate") {
        migrate::handle_migrate(&mut stream, &request, &pg_pool, &sqlite_pool).await;
    } else if first_line.starts_with("GET /telemetry/logs") && first_line.contains("/download") {
        logs::handle_download_log(&mut stream, &request, &sqlite_pool, &pg_pool).await;
    } else if first_line.starts_with("GET /telemetry/logs") {
        logs::handle_list_logs(&mut stream, &request, &sqlite_pool).await;
    } else {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
        let _ = stream.write_all(response.as_bytes()).await;
    }
}
