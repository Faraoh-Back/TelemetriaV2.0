use bcrypt::verify;
use serde_json::json;
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use tokio::net::TcpStream;
use tracing::{error, info, warn};

use crate::auth::{generate_jwt, normalize_role, permissions_for_role};
use crate::models::LoginRequest;

use super::http::send_json;

pub(super) async fn handle_login(stream: &mut TcpStream, request: &str, sqlite_pool: &SqlitePool) {
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
