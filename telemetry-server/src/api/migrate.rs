use sqlx::sqlite::SqlitePool;
use tokio::net::TcpStream;
use tracing::{error, info};

use crate::db::migrate_old_data;

use super::http::{api_request_has_permission, send_json, START_PERMISSION};

pub(super) async fn handle_migrate(
    stream: &mut TcpStream,
    request: &str,
    pg_pool: &sqlx::PgPool,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, START_PERMISSION).await {
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
