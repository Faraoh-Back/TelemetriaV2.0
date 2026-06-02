use crate::models::ProcessedSignal;
use sqlx::{postgres::PgPoolOptions, sqlite::SqlitePool, Row};
use tracing::{error, info, warn};

pub async fn init_timescale(pool: &sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sensor_data (
            time        TIMESTAMPTZ      NOT NULL,
            device_id   TEXT             NOT NULL,
            signal_name TEXT             NOT NULL,
            value       DOUBLE PRECISION NOT NULL,
            unit        TEXT,
            can_id      INTEGER          NOT NULL,
            quality     TEXT             DEFAULT 'ok'
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE)")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_device_signal_time
            ON sensor_data (device_id, signal_name, time DESC)
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_signal_time
            ON sensor_data (signal_name, time DESC)
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        SELECT add_retention_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE)
    "#,
    )
    .execute(pool)
    .await
    .ok();

    info!("✅ TimescaleDB inicializado (tempo real, retenção 7 dias)");
    Ok(())
}

// ==================== INIT SQLITE ====================

pub async fn init_sqlite(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all("./data")?;

    // Tabela de histórico CAN — igual à versão anterior
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS historico (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   REAL    NOT NULL,
            device_id   TEXT    NOT NULL,
            signal_name TEXT    NOT NULL,
            value       REAL    NOT NULL,
            unit        TEXT,
            can_id      INTEGER NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_hist_timestamp
            ON historico (timestamp DESC)
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_hist_signal
            ON historico (signal_name, timestamp DESC)
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_hist_device
            ON historico (device_id, timestamp DESC)
    "#,
    )
    .execute(pool)
    .await?;

    // Tabela de usuários para autenticação web
    // Senhas armazenadas como hash bcrypt — nunca plain text
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            role          TEXT    NOT NULL DEFAULT 'member',
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        r#"
        UPDATE users
        SET role = 'admin'
        WHERE lower(username) IN ('admin', 'adm', 'administrador')
          AND role = 'member'
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("PRAGMA journal_mode=WAL").execute(pool).await?;
    sqlx::query("PRAGMA synchronous=NORMAL")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS telemetry_log_sessions (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at_unix    REAL    NOT NULL,
            started_at_iso     TEXT    NOT NULL,
            start_requested_at TEXT,
            ended_at_unix      REAL,
            ended_at_iso       TEXT,
            stop_requested_at  TEXT,
            log_start_unix     REAL,
            log_stop_unix      REAL,
            collection_start_sec REAL   NOT NULL DEFAULT 0,
            collection_stop_sec  REAL,
            log_start_sec        REAL,
            log_stop_sec         REAL,
            state              TEXT    NOT NULL DEFAULT 'active',
            created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("ALTER TABLE telemetry_log_sessions ADD COLUMN collection_start_sec REAL NOT NULL DEFAULT 0")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE telemetry_log_sessions ADD COLUMN collection_stop_sec REAL")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE telemetry_log_sessions ADD COLUMN log_start_sec REAL")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE telemetry_log_sessions ADD COLUMN log_stop_sec REAL")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_telemetry_log_sessions_state
            ON telemetry_log_sessions (state, started_at_unix DESC)
    "#,
    )
    .execute(pool)
    .await?;

    info!("✅ SQLite inicializado (histórico persistente + users)");
    Ok(())
}

// ==================== SALVAR TIMESCALEDB ====================

pub async fn save_timescale(
    pool: &sqlx::PgPool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for s in signals {
        sqlx::query(
            r#"
            INSERT INTO sensor_data (time, device_id, signal_name, value, unit, can_id)
            VALUES (to_timestamp($1), $2, $3, $4, $5, $6)
        "#,
        )
        .bind(s.timestamp)
        .bind(&s.device_id)
        .bind(&s.signal_name)
        .bind(s.value)
        .bind(&s.unit)
        .bind(s.can_id as i32)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

// ==================== SALVAR SQLITE ====================

pub async fn save_sqlite(
    pool: &SqlitePool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for s in signals {
        sqlx::query(
            r#"
            INSERT INTO historico (timestamp, device_id, signal_name, value, unit, can_id)
            VALUES (?, ?, ?, ?, ?, ?)
        "#,
        )
        .bind(s.timestamp)
        .bind(&s.device_id)
        .bind(&s.signal_name)
        .bind(s.value)
        .bind(&s.unit)
        .bind(s.can_id as i64)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

// ==================== HANDLER TCP (FRAMES CAN) ====================
// Esta função não mudou — recebe frames do edge, decodifica, persiste e faz broadcast
pub async fn migrate_old_data(
    pg_pool: &sqlx::PgPool,
    sqlite_pool: &SqlitePool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    // Verifica se há dados antigos antes de fazer qualquer coisa
    let count_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM sensor_data WHERE time < NOW() - INTERVAL '7 days'",
    )
    .fetch_one(pg_pool)
    .await?;

    let count: i64 = count_row.get("cnt");

    if count == 0 {
        info!("✅ Migração: nenhum dado antigo no TimescaleDB");
        return Ok(0);
    }

    info!(
        "📦 Migração: {} registros antigos encontrados, iniciando...",
        count
    );

    // Busca em lotes de 5000 para não explodir a memória
    // DEPOIS — loop com cursor por timestamp:
    let mut total_migrated = 0usize;
    let batch_size: i64 = 5000;
    let mut last_ts: f64 = 0.0; // cursor — começa do início
    let mut prev_ts: f64 = 0.0; // para deletar só o lote migrado

    loop {
        let rows = sqlx::query(
            r#"
            SELECT
                EXTRACT(EPOCH FROM time)::float8 as ts,
                device_id,
                signal_name,
                value,
                COALESCE(unit, '') as unit,
                can_id
            FROM sensor_data
            WHERE time < NOW() - INTERVAL '7 days'
            AND EXTRACT(EPOCH FROM time)::float8 > $1
            ORDER BY time ASC
            LIMIT $2
        "#,
        )
        .bind(last_ts)
        .bind(batch_size)
        .fetch_all(pg_pool)
        .await?;

        if rows.is_empty() {
            break;
        }

        // Atualiza cursor com o timestamp do último registro do lote
        prev_ts = last_ts; // ← salva o cursor anterior antes de atualizar
        last_ts = rows
            .last()
            .map(|r| r.get::<f64, _>("ts"))
            .unwrap_or(last_ts);

        // Insere lote no SQLite em uma única transação
        let mut tx = sqlite_pool.begin().await?;
        for row in &rows {
            let ts: f64 = row.get("ts");
            let device_id: &str = row.get("device_id");
            let signal_name: &str = row.get("signal_name");
            let value: f64 = row.get("value");
            let unit: &str = row.get("unit");
            let can_id: i32 = row.get("can_id");

            sqlx::query(
                r#"
                INSERT OR IGNORE INTO historico
                    (timestamp, device_id, signal_name, value, unit, can_id)
                VALUES (?, ?, ?, ?, ?, ?)
            "#,
            )
            .bind(ts)
            .bind(device_id)
            .bind(signal_name)
            .bind(value)
            .bind(unit)
            .bind(can_id as i64)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;

        // Deleta do TimescaleDB os registros já migrados
        // Usa o timestamp do cursor anterior e do atual para deletar só o lote
        sqlx::query(
            r#"
            DELETE FROM sensor_data
            WHERE time > to_timestamp($1)
                AND time <= to_timestamp($2)
        "#,
        )
        .bind(prev_ts)
        .bind(last_ts)
        .execute(pg_pool)
        .await?;

        total_migrated += rows.len();
        info!("  → {} / {} migrados...", total_migrated, count);
    }

    info!(
        "✅ Migração concluída: {} registros movidos para SQLite",
        total_migrated
    );
    Ok(total_migrated)
}

// ==================== MAIN ====================
