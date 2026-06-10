use chrono::{DateTime, Utc};
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

use crate::auth::{
    claims_has_permission, extract_bearer_token, validate_jwt_claims, PERMISSION_TELEMETRY_START,
    PERMISSION_TELEMETRY_STOP,
};

pub(super) async fn serve_html(stream: &mut TcpStream) {
    match tokio::fs::read_to_string("./static/dist/index.html").await {
        Ok(body) => {
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
        }
        Err(_) => {
            let body = r#"{"ok":false,"message":"Frontend build nao encontrado. Execute o build em static/ antes de servir a aplicacao."}"#;
            let response = format!(
                "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-cache\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
        }
    }
}

pub(super) async fn serve_static_file(stream: &mut TcpStream, first_line: &str) {
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");
    let path_without_qs = path.split('?').next().unwrap_or(path);
    let file_path = format!("./static/dist{}", path_without_qs);

    let content_type = if path_without_qs.ends_with(".js") {
        "application/javascript"
    } else if path_without_qs.ends_with(".css") {
        "text/css"
    } else if path_without_qs.ends_with(".svg") {
        "image/svg+xml"
    } else if path_without_qs.ends_with(".png") {
        "image/png"
    } else if path_without_qs.ends_with(".jpg") || path_without_qs.ends_with(".jpeg") {
        "image/jpeg"
    } else if path_without_qs.ends_with(".ico") {
        "image/x-icon"
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

pub(super) async fn send_json(stream: &mut TcpStream, status: u16, body: &str) {
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

pub(super) fn parse_json_body<T: for<'de> Deserialize<'de>>(request: &str) -> Result<T, u16> {
    let body = request.split("\r\n\r\n").nth(1).ok_or(400u16)?.trim();
    serde_json::from_str(body).map_err(|_| 400)
}

pub(super) async fn api_request_has_permission(
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

pub(super) fn unix_seconds(dt: &DateTime<Utc>) -> f64 {
    dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_micros()) / 1_000_000.0
}

pub(super) const START_PERMISSION: &str = PERMISSION_TELEMETRY_START;
pub(super) const STOP_PERMISSION: &str = PERMISSION_TELEMETRY_STOP;
