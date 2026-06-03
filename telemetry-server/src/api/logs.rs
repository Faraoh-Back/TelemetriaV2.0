use sqlx::{sqlite::SqlitePool, Row};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tracing::{error, info};

use super::http::{api_request_has_permission, send_json};
use crate::auth::PERMISSION_LOGS_READ;

// ==================== LISTAGEM ====================

pub(super) async fn handle_list_logs(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
) {
    if !api_request_has_permission(stream, request, PERMISSION_LOGS_READ).await {
        return;
    }

    // Parâmetros de filtro da query string
    let query_str = request
        .lines()
        .next()
        .and_then(|l| l.split('?').nth(1))
        .and_then(|q| q.split(' ').next())
        .unwrap_or("");

    let mut limit: i64 = 50;
    let mut filter_status: Option<String> = None;

    for pair in query_str.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("");
        let val = kv.next().unwrap_or("");
        match key {
            "limit" => limit = val.parse().unwrap_or(50).min(200),
            "status" => {
                if !val.is_empty() {
                    filter_status = Some(val.to_string());
                }
            }
            _ => {}
        }
    }

    let rows = if let Some(ref status) = filter_status {
        sqlx::query(
            r#"
            SELECT id, state, started_at_iso, ended_at_iso,
                   log_start_unix, log_stop_unix,
                   collection_start_sec, collection_stop_sec,
                   log_start_sec, log_stop_sec
            FROM telemetry_log_sessions
            WHERE state = ?
            ORDER BY id DESC
            LIMIT ?
            "#,
        )
        .bind(status)
        .bind(limit)
        .fetch_all(sqlite_pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT id, state, started_at_iso, ended_at_iso,
                   log_start_unix, log_stop_unix,
                   collection_start_sec, collection_stop_sec,
                   log_start_sec, log_stop_sec
            FROM telemetry_log_sessions
            ORDER BY id DESC
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(sqlite_pool)
        .await
    };

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            error!("Erro ao listar sessoes: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
            return;
        }
    };

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let state: String = row.get("state");
            let started_at: Option<String> = row.try_get("started_at_iso").ok();
            let ended_at: Option<String> = row.try_get("ended_at_iso").ok();
            let log_stop_sec: Option<f64> = row.try_get("log_stop_sec").ok().flatten();
            let collection_stop_sec: Option<f64> =
                row.try_get("collection_stop_sec").ok().flatten();
            let duration = log_stop_sec.or(collection_stop_sec);

            // Status para o frontend
            let status = match state.as_str() {
                "active" => "processing",
                "stopped" => "ready",
                _ => "failed",
            };

            serde_json::json!({
                "id": id,
                "name": format!("Sessao {}", id),
                "started_at": started_at,
                "ended_at": ended_at,
                "duration_seconds": duration,
                "status": status,
                "format": "motec",
                "size_bytes": null,
            })
        })
        .collect();

    let body = serde_json::json!({
        "ok": true,
        "items": items,
        "next_cursor": null,
    });

    send_json(stream, 200, &body.to_string()).await;
}

// ==================== DOWNLOAD .ld ====================

pub(super) async fn handle_download_log(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
    pg_pool: &sqlx::PgPool,
) {
    if !api_request_has_permission(stream, request, PERMISSION_LOGS_READ).await {
        return;
    }

    // Extrai o ID da URL: GET /telemetry/logs/42/download
    let path = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");

    let session_id: i64 = path
        .trim_start_matches("/telemetry/logs/")
        .trim_end_matches("/download")
        .parse()
        .unwrap_or(0);

    if session_id == 0 {
        send_json(stream, 400, r#"{"ok":false,"message":"ID invalido"}"#).await;
        return;
    }

    // Busca a sessão no SQLite
    let session = match sqlx::query(
        "SELECT id, log_start_unix, log_stop_unix, started_at_iso FROM telemetry_log_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(sqlite_pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            send_json(stream, 404, r#"{"ok":false,"message":"Sessao nao encontrada"}"#).await;
            return;
        }
        Err(e) => {
            error!("Erro ao buscar sessao {}: {}", session_id, e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
            return;
        }
    };

    let log_start: f64 = session
        .try_get("log_start_unix")
        .ok()
        .flatten()
        .unwrap_or(0.0);
    let log_stop: f64 = session
        .try_get("log_stop_unix")
        .ok()
        .flatten()
        .unwrap_or(0.0);
    let started_at_iso: String = session
        .try_get("started_at_iso")
        .ok()
        .flatten()
        .unwrap_or_default();

    if log_start == 0.0 || log_stop == 0.0 || log_stop <= log_start {
        send_json(
            stream,
            422,
            r#"{"ok":false,"message":"Sessao sem bounds definidos"}"#,
        )
        .await;
        return;
    }

    // Busca dados do TimescaleDB para o período da sessão
    info!(
        "📦 Gerando .ld para sessao {} ({:.1}s de dados)",
        session_id,
        log_stop - log_start
    );

    let rows = match sqlx::query(
        r#"
        SELECT signal_name, value, EXTRACT(EPOCH FROM time)::float8 as ts, unit
        FROM sensor_data
        WHERE EXTRACT(EPOCH FROM time) BETWEEN $1 AND $2
        ORDER BY signal_name, time ASC
        "#,
    )
    .bind(log_start)
    .bind(log_stop)
    .fetch_all(pg_pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            error!("Erro ao buscar dados para .ld: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro ao buscar dados"}"#).await;
            return;
        }
    };

    if rows.is_empty() {
        send_json(
            stream,
            404,
            r#"{"ok":false,"message":"Sem dados no periodo da sessao"}"#,
        )
        .await;
        return;
    }

    // Agrupa por sinal
    let mut channels: std::collections::HashMap<String, (Vec<f64>, Vec<f64>, String)> =
        std::collections::HashMap::new();

    for row in &rows {
        let name: String = row.get("signal_name");
        let value: f64 = row.get("value");
        let ts: f64 = row.get("ts");
        let unit: String = row.try_get("unit").ok().flatten().unwrap_or_default();

        let entry = channels
            .entry(name.clone())
            .or_insert_with(|| (Vec::new(), Vec::new(), unit));
        entry.0.push(ts - log_start); // tempo relativo em segundos
        entry.1.push(value);
    }

    // Gera o arquivo .ld
    let ld_bytes = generate_ld_file(&channels, session_id, &started_at_iso, log_stop - log_start);

    let filename = format!("eracing_sessao_{}.ld", session_id);
    let header = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: application/octet-stream\r\n\
         Content-Disposition: attachment; filename=\"{}\"\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         \r\n",
        filename,
        ld_bytes.len()
    );

    let _ = stream.write_all(header.as_bytes()).await;
    let _ = stream.write_all(&ld_bytes).await;

    info!(
        "✅ .ld gerado: sessao {} — {} bytes — {} canais",
        session_id,
        ld_bytes.len(),
        channels.len()
    );
}

// ==================== GERADOR MoTeC .ld ====================
//
// Estrutura baseada em engenharia reversa do formato MoTeC .ld:
//   - Offset 0x00: magic "LDMOTEC\0" (8 bytes)
//   - Offset 0x08: versão (4 bytes, u32 LE) = 0x0000000A
//   - Offset 0x0C: número de canais (4 bytes, u32 LE)
//   - Offset 0x10: offset do bloco de metadados (4 bytes, u32 LE)
//   - Offset 0x14: offset do bloco de canais (4 bytes, u32 LE)
//   - Offset 0x40: bloco de metadados (texto fixo, 256 bytes)
//   - Offset 0x140: array de descritores de canal (64 bytes cada)
//   - Após descritores: dados de cada canal (f32 LE, amostras contíguas)
//
// Referências:
//   https://github.com/gotzl/ldparser
//   https://github.com/nickcoutsos/python-motec

fn write_u16_le(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_u32_le(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_f32_le(buf: &mut Vec<u8>, v: f32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_fixed_str(buf: &mut Vec<u8>, s: &str, len: usize) {
    let bytes = s.as_bytes();
    let copy_len = bytes.len().min(len);
    buf.extend_from_slice(&bytes[..copy_len]);
    for _ in copy_len..len {
        buf.push(0);
    }
}

fn generate_ld_file(
    channels: &std::collections::HashMap<String, (Vec<f64>, Vec<f64>, String)>,
    session_id: i64,
    started_at_iso: &str,
    duration_sec: f64,
) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::with_capacity(1 << 20); // 1 MB inicial

    let channel_names: Vec<&String> = {
        let mut names: Vec<&String> = channels.keys().collect();
        names.sort();
        names
    };
    let num_channels = channel_names.len() as u32;

    // ── HEADER PRINCIPAL (0x00..0x40, 64 bytes) ──────────────────────────────
    // Magic
    buf.extend_from_slice(b"LDMOTEC\0");

    // Versão
    write_u32_le(&mut buf, 0x0000000A);

    // Número de canais
    write_u32_le(&mut buf, num_channels);

    // Offset do bloco de metadados: 0x40
    write_u32_le(&mut buf, 0x40);

    // Offset do bloco de descritores de canal: 0x140
    write_u32_le(&mut buf, 0x140);

    // Padding até 0x40
    while buf.len() < 0x40 {
        buf.push(0);
    }

    // ── BLOCO DE METADADOS (0x40..0x140, 256 bytes) ──────────────────────────
    // Evento (nome da sessão)
    let event_name = format!("Sessao {}", session_id);
    write_fixed_str(&mut buf, &event_name, 64);

    // Veículo
    write_fixed_str(&mut buf, "UNICAMP E-RACING", 64);

    // Venue (local)
    write_fixed_str(&mut buf, "UNICAMP", 64);

    // Data/hora da sessão (ISO 8601 truncado)
    let datetime_str = started_at_iso.get(..19).unwrap_or(started_at_iso);
    write_fixed_str(&mut buf, datetime_str, 64);

    // Padding até 0x140
    while buf.len() < 0x140 {
        buf.push(0);
    }

    // ── DESCRITORES DE CANAL (64 bytes cada) ─────────────────────────────────
    // Primeiro calculamos os offsets de dados
    // Cada canal tem n amostras × 4 bytes (f32)
    let descriptor_block_size = num_channels as usize * 64;
    let data_start_offset = 0x140 + descriptor_block_size;

    let mut data_offsets: Vec<u32> = Vec::with_capacity(channel_names.len());
    let mut current_offset = data_start_offset;

    for name in &channel_names {
        data_offsets.push(current_offset as u32);
        let (timestamps, _, _) = &channels[*name];
        current_offset += timestamps.len() * 4; // f32 por amostra (só values)
    }

    // Escreve descritores
    for (i, name) in channel_names.iter().enumerate() {
        let (timestamps, _, unit) = &channels[*name];
        let n_samples = timestamps.len() as u32;

        // Frequência de amostragem estimada
        let freq_hz = if timestamps.len() > 1 && duration_sec > 0.0 {
            (timestamps.len() as f64 / duration_sec).round() as u16
        } else {
            10
        };

        // Offset dos dados deste canal
        write_u32_le(&mut buf, data_offsets[i]);

        // Número de amostras
        write_u32_le(&mut buf, n_samples);

        // Frequência (Hz)
        write_u16_le(&mut buf, freq_hz);

        // Shift (offset temporal, 0 por padrão)
        write_u16_le(&mut buf, 0);

        // Multiplicador de escala (fixo 1.0 em f32)
        write_f32_le(&mut buf, 1.0);

        // Offset de escala (0.0)
        write_f32_le(&mut buf, 0.0);

        // Nome do canal (32 bytes)
        write_fixed_str(&mut buf, name.as_str(), 32);

        // Unidade (8 bytes)
        write_fixed_str(&mut buf, unit.as_str(), 8);

        // Padding até completar 64 bytes por descritor
        // Já escrevemos: 4+4+2+2+4+4+32+8 = 60 bytes → 4 bytes de padding
        write_u32_le(&mut buf, 0);
    }

    // ── BLOCOS DE DADOS ───────────────────────────────────────────────────────
    for name in &channel_names {
        let (_, values, _) = &channels[*name];
        for &v in values {
            write_f32_le(&mut buf, v as f32);
        }
    }

    buf
}