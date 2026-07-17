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
                   log_start_sec, log_stop_sec, name
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
                   log_start_sec, log_stop_sec, name
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
            let name: Option<String> = row.try_get("name").ok().flatten();
            let display_name = name.unwrap_or_else(|| format!("Sessao {}", id));

            // Status para o frontend
            let status = match state.as_str() {
                "active" => "processing",
                "stopped" => "ready",
                _ => "failed",
            };

            serde_json::json!({
                "id": id,
                "name": display_name,
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

    // Linha de request: "GET /telemetry/logs/42/download?ext=ldx HTTP/1.1"
    let target = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");

    // Separa o path da query string
    let (path_part, query_part) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };

    let session_id: i64 = path_part
        .trim_start_matches("/telemetry/logs/")
        .trim_end_matches("/download")
        .parse()
        .unwrap_or(0);

    // Extensão pedida: ?ext=ld (binário, default) ou ?ext=ldx (XML)
    let mut ext = "ld";
    for pair in query_part.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next() == Some("ext") {
            match kv.next() {
                Some("ldx") => ext = "ldx",
                Some("ld") => ext = "ld",
                _ => {}
            }
        }
    }

    if session_id == 0 {
        send_json(stream, 400, r#"{"ok":false,"message":"ID invalido"}"#).await;
        return;
    }

    // Busca a sessão no SQLite (metadados — comum aos dois formatos)
    let session = match sqlx::query(
        "SELECT id, log_start_unix, log_stop_unix, started_at_iso, name FROM telemetry_log_sessions WHERE id = ?",
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

    let started_at_iso: String = session
        .try_get("started_at_iso")
        .ok()
        .flatten()
        .unwrap_or_default();

    let name: Option<String> = session.try_get("name").ok().flatten();
    let display_name = name.unwrap_or_else(|| format!("Sessao {}", session_id));

    // Sanitiza o nome do arquivo para evitar caracteres inválidos
    let safe_name = {
        let trimmed = display_name.trim();
        if trimmed.is_empty() {
            format!("eracing_sessao_{}", session_id)
        } else {
            trimmed.chars()
                .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
                .collect::<String>()
        }
    };

    // Mesmo nome base para ambos os arquivos (eracing_sessao_42.ld / .ldx)
    let filename = format!("{}.{}", safe_name, ext);

    // ── .ldx (índice XML) — apenas metadados, dispensa o TimescaleDB ──────────
    if ext == "ldx" {
        let xml = generate_ldx_file(session_id, &display_name, &started_at_iso);
        send_file(stream, &filename, "application/xml", xml.as_bytes()).await;
        info!("✅ .ldx gerado: sessao {} — {} bytes", session_id, xml.len());
        return;
    }

    // ── .ld (binário) — exige bounds definidos e dados do TimescaleDB ─────────
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

    // Agrupa por sinal: nome -> (timestamps relativos, valores, unidade)
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

    // Gera o arquivo .ld (resampleado em taxa fixa + canal mestre "Time")
    let ld_bytes = generate_ld_file(&channels, session_id, &started_at_iso, log_stop - log_start);

    send_file(stream, &filename, "application/octet-stream", &ld_bytes).await;

    info!(
        "✅ .ld gerado: sessao {} — {} bytes — {} canais (+Time)",
        session_id,
        ld_bytes.len(),
        channels.len()
    );
}

/// Envia um arquivo binário/texto como anexo HTTP, sem bufferizar duas vezes.
async fn send_file(stream: &mut TcpStream, filename: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {}\r\n\
         Content-Disposition: attachment; filename=\"{}\"\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         \r\n",
        content_type,
        filename,
        body.len()
    );

    let _ = stream.write_all(header.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let _ = stream.flush().await;
}

// ==================== GERADOR MoTeC .ld ====================
//
// Layout binário fiel à engenharia reversa do `gotzl/ldparser` (o que a MoTeC
// i2 Pro realmente lê). O formato anterior ("LDMOTEC", header de 64 bytes,
// descritores de 64 bytes) era inventado — por isso a i2 rejeitava o arquivo.
//
//   Header (1762 bytes):
//     0x000  u32  marker = 0x40              + 4 bytes pad
//     0x008  u32  meta_ptr (1º channel header)
//     0x00C  u32  data_ptr (início dos dados)
//     ...    20x  pad
//     0x024  u32  event_ptr
//     ...    24x  pad
//     0x040  u16,u16,u16 = (1, 0x4240, 0x000F)
//     0x046  u32  serial = 0x1F44
//     0x04A  8s   device = "ADL"
//     0x052  u16  version = 420
//     0x054  u16  = 0xADB0
//     0x056  u32  num_channels         + 4 bytes pad
//     0x05E  16s  date     + 16x pad
//     0x07E  16s  time     + 16x pad
//     0x09E  64s  driver
//     0x0DE  64s  vehicle id           + 64x pad
//     0x15E  64s  venue                + 64x pad + 1024x pad
//     0x5DE  u32  "pro logging" = 0xC81A4   + 66x pad
//     0x624  64s  short comment        + 126x pad  -> termina em 0x6E2 (1762)
//
//   Event (1154 bytes): 64s name, 64s session, 1024s comment, u16 venue_ptr
//   Channel header (124 bytes, lista encadeada via prev/next):
//     u32 prev, u32 next, u32 data_ptr, u32 n_data,
//     u16 counter(=0x2EE1+i), u16 dtype_a(=0x07 float), u16 dtype(=4 -> f32),
//     u16 freq, i16 shift, i16 mul, i16 scale, i16 dec,
//     32s name, 8s short_name, 12s unit, 40x pad
//   Dados: para cada canal, n_data amostras f32 LE contíguas.
//
// Referência: https://github.com/gotzl/ldparser

const LD_HEAD_SIZE: usize = 1762;
const LD_EVENT_SIZE: usize = 1154;
const LD_CHAN_SIZE: usize = 124;

/// Taxa fixa de amostragem do log exportado. O formato .ld NÃO armazena
/// timestamps por amostra: cada canal é um vetor f32 plano e a MoTeC deriva o
/// eixo de tempo a partir de `freq`. Como o CAN é assíncrono, reamostramos todos
/// os canais nesta grade comum para que os eixos horizontais fiquem alinhados.
const LD_SAMPLE_RATE_HZ: u16 = 100;

fn write_u16_le(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_i16_le(buf: &mut Vec<u8>, v: i16) {
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

/// Preenche `buf` com zeros até atingir o offset absoluto `target`.
fn pad_to(buf: &mut Vec<u8>, target: usize) {
    while buf.len() < target {
        buf.push(0);
    }
}

/// Reamostra uma série (timestamps relativos crescentes, valores) em `n`
/// amostras espaçadas por `dt`, usando sample-and-hold (zero-order hold) — o
/// modelo correto para sinais CAN discretos. Antes da 1ª amostra repete o
/// primeiro valor; depois da última, segura o último valor.
fn resample_zoh(timestamps: &[f64], values: &[f64], n: usize, dt: f64) -> Vec<f32> {
    let mut out = Vec::with_capacity(n);
    if timestamps.is_empty() {
        out.resize(n, 0.0);
        return out;
    }
    let mut idx = 0usize;
    for i in 0..n {
        let t = i as f64 * dt;
        while idx + 1 < timestamps.len() && timestamps[idx + 1] <= t {
            idx += 1;
        }
        out.push(values[idx] as f32);
    }
    out
}

/// Converte "2026-06-16T14:30:00Z" -> ("16/06/2026", "14:30:00") para o header.
fn iso_to_motec_datetime(iso: &str) -> (String, String) {
    let (date_part, time_part) = iso.split_once('T').unwrap_or((iso, ""));
    let date = {
        let p: Vec<&str> = date_part.split('-').collect();
        if p.len() == 3 {
            format!("{}/{}/{}", p[2], p[1], p[0])
        } else {
            date_part.to_string()
        }
    };
    let time = time_part.get(..8).unwrap_or(time_part).to_string();
    (date, time)
}

fn generate_ld_file(
    channels: &std::collections::HashMap<String, (Vec<f64>, Vec<f64>, String)>,
    session_id: i64,
    started_at_iso: &str,
    duration_sec: f64,
) -> Vec<u8> {
    let freq = LD_SAMPLE_RATE_HZ;
    let dt = 1.0 / freq as f64;
    // Nº de amostras na grade fixa (inclui o instante final).
    let n_samples = ((duration_sec * freq as f64).floor() as usize + 1).max(1);

    // ── Monta a lista ordenada de canais já reamostrados ─────────────────────
    // O 1º canal é o mestre "Time" (em segundos), conforme exigido.
    let mut sorted_names: Vec<&String> = channels.keys().collect();
    sorted_names.sort();

    let mut out_channels: Vec<(String, String, Vec<f32>)> =
        Vec::with_capacity(sorted_names.len() + 1);

    let time_values: Vec<f32> = (0..n_samples).map(|i| (i as f64 * dt) as f32).collect();
    out_channels.push(("Time".to_string(), "s".to_string(), time_values));

    for name in sorted_names {
        let (timestamps, values, unit) = &channels[name];
        let resampled = resample_zoh(timestamps, values, n_samples, dt);
        out_channels.push((name.clone(), unit.clone(), resampled));
    }

    let num_channels = out_channels.len();
    let meta_ptr = LD_HEAD_SIZE + LD_EVENT_SIZE; // 1º channel header
    let data_ptr = meta_ptr + num_channels * LD_CHAN_SIZE; // início dos dados
    let chan_data_bytes = n_samples * 4; // f32 por amostra, todos os canais iguais

    let total = data_ptr + num_channels * chan_data_bytes;
    let mut buf: Vec<u8> = Vec::with_capacity(total);

    let (date_str, time_str) = iso_to_motec_datetime(started_at_iso);
    let event_name = format!("Sessao {}", session_id);

    // ── HEADER (0x000 .. 0x6E2) ──────────────────────────────────────────────
    write_u32_le(&mut buf, 0x40); // marker
    pad_to(&mut buf, 0x08);
    write_u32_le(&mut buf, meta_ptr as u32); // chann_meta_ptr
    write_u32_le(&mut buf, data_ptr as u32); // chann_data_ptr
    pad_to(&mut buf, 0x24);
    write_u32_le(&mut buf, LD_HEAD_SIZE as u32); // event_ptr (logo após o header)
    pad_to(&mut buf, 0x40);
    write_u16_le(&mut buf, 1); // estáticos
    write_u16_le(&mut buf, 0x4240);
    write_u16_le(&mut buf, 0x000F);
    write_u32_le(&mut buf, 0x1F44); // serial
    write_fixed_str(&mut buf, "ADL", 8); // device type
    write_u16_le(&mut buf, 420); // device version
    write_u16_le(&mut buf, 0xADB0); // estático
    write_u32_le(&mut buf, num_channels as u32);
    pad_to(&mut buf, 0x5E);
    write_fixed_str(&mut buf, &date_str, 16);
    pad_to(&mut buf, 0x7E);
    write_fixed_str(&mut buf, &time_str, 16);
    pad_to(&mut buf, 0x9E);
    write_fixed_str(&mut buf, "UNICAMP E-RACING Team", 64); // driver
    write_fixed_str(&mut buf, "UNICAMP E-RACING", 64); // vehicle id
    pad_to(&mut buf, 0x15E);
    write_fixed_str(&mut buf, "UNICAMP", 64); // venue
    pad_to(&mut buf, 0x5DE);
    write_u32_le(&mut buf, 0xC81A4); // "pro logging" magic
    pad_to(&mut buf, 0x624);
    write_fixed_str(&mut buf, &event_name, 64); // short comment
    pad_to(&mut buf, LD_HEAD_SIZE);

    // ── EVENT (1154 bytes) ───────────────────────────────────────────────────
    write_fixed_str(&mut buf, &event_name, 64); // name
    write_fixed_str(&mut buf, &event_name, 64); // session
    write_fixed_str(&mut buf, "Telemetria V2.2", 1024); // comment
    write_u16_le(&mut buf, 0); // venue_ptr (sem bloco de venue separado)
    debug_assert_eq!(buf.len(), meta_ptr);

    // ── CHANNEL HEADERS (124 bytes cada, lista encadeada) ────────────────────
    for (i, (name, unit, _)) in out_channels.iter().enumerate() {
        let prev = if i == 0 {
            0
        } else {
            (meta_ptr + (i - 1) * LD_CHAN_SIZE) as u32
        };
        let next = if i + 1 == num_channels {
            0
        } else {
            (meta_ptr + (i + 1) * LD_CHAN_SIZE) as u32
        };
        let this_data_ptr = (data_ptr + i * chan_data_bytes) as u32;

        write_u32_le(&mut buf, prev);
        write_u32_le(&mut buf, next);
        write_u32_le(&mut buf, this_data_ptr);
        write_u32_le(&mut buf, n_samples as u32); // n_data
        write_u16_le(&mut buf, 0x2EE1u16.wrapping_add(i as u16)); // counter
        write_u16_le(&mut buf, 0x07); // dtype_a = float
        write_u16_le(&mut buf, 4); // dtype = f32 (4 bytes)
        write_u16_le(&mut buf, freq);
        write_i16_le(&mut buf, 0); // shift
        write_i16_le(&mut buf, 1); // mul
        write_i16_le(&mut buf, 1); // scale
        write_i16_le(&mut buf, 0); // dec_places
        write_fixed_str(&mut buf, name, 32);
        write_fixed_str(&mut buf, name, 8); // short name (reaproveita o nome)
        write_fixed_str(&mut buf, unit, 12);
        pad_to(&mut buf, meta_ptr + (i + 1) * LD_CHAN_SIZE); // 40x pad
    }
    debug_assert_eq!(buf.len(), data_ptr);

    // ── DADOS (f32 LE, n_samples por canal) ──────────────────────────────────
    for (_, _, values) in &out_channels {
        for &v in values {
            write_f32_le(&mut buf, v);
        }
    }

    buf
}

// ==================== GERADOR MoTeC .ldx (índice XML) ====================
//
// Sidecar XML que a i2 Pro lê junto do .ld para markers/laps e os campos de
// <Details> (Event, Venue, Vehicle Id, etc.). Sem esse arquivo a i2 não associa
// os metadados de sessão ao log binário.

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn generate_ldx_file(_session_id: i64, session_name: &str, started_at_iso: &str) -> String {
    let event = xml_escape(session_name);
    let start = xml_escape(started_at_iso);

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<LDXFile Locale="C" DefaultLocale="C" Version="1.6">
    <Layers>
        <Layer>
            <MarkerBlock Version="2.0">
                <MarkerGroup Index="0" Type="Beacon" Count="0"></MarkerGroup>
            </MarkerBlock>
        </Layer>
    </Layers>
    <Details>
        <String Id="Event" Value="{event}"/>
        <String Id="Session" Value="{event}"/>
        <String Id="Venue" Value="UNICAMP"/>
        <String Id="Vehicle Id" Value="UNICAMP E-RACING"/>
        <String Id="Driver" Value="UNICAMP E-RACING Team"/>
        <String Id="Engine Id" Value="E-Racing Powertrain"/>
        <String Id="Comment" Value="Telemetria V2.2 - exportacao automatica"/>
        <String Id="Start Time" Value="{start}"/>
    </Details>
</LDXFile>
"#
    )
}

// ==================== TESTES DE GERAÇÃO (offline) ====================
//
// Gera .ld/.ldx a partir de dados sintéticos em memória e grava em disco para
// validação cruzada com o `ldparser.py` da MoTeC. Não toca em rede/DB.
//   cargo test --bin telemetry-server motec -- --nocapture

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const OUT_LD: &str = "/tmp/motec_test/eracing_sessao_999.ld";
    const OUT_LDX: &str = "/tmp/motec_test/eracing_sessao_999.ldx";

    /// Constrói canais com timestamps ASSÍNCRONOS (taxas diferentes e
    /// desalinhados) — o caso real do CAN que precisa de reamostragem.
    fn fake_channels() -> HashMap<String, (Vec<f64>, Vec<f64>, String)> {
        let mut ch = HashMap::new();

        // EngineRPM: ~50 Hz, com jitter
        let mut t_rpm = Vec::new();
        let mut v_rpm = Vec::new();
        let mut t = 0.0_f64;
        let mut i = 0;
        while t < 2.0 {
            t_rpm.push(t);
            v_rpm.push(3000.0 + 2000.0 * (i as f64 * 0.13).sin());
            t += 0.019 + (i % 3) as f64 * 0.001; // jitter
            i += 1;
        }
        ch.insert("EngineRPM".to_string(), (t_rpm, v_rpm, "rpm".to_string()));

        // ThrottlePos: ~10 Hz, começa atrasado (assíncrono)
        let mut t_thr = Vec::new();
        let mut v_thr = Vec::new();
        let mut t = 0.35_f64;
        let mut i = 0;
        while t < 1.8 {
            t_thr.push(t);
            v_thr.push((i as f64 * 7.0) % 100.0);
            t += 0.1;
            i += 1;
        }
        ch.insert("ThrottlePos".to_string(), (t_thr, v_thr, "%".to_string()));

        ch
    }

    #[test]
    fn motec_generate_and_dump() {
        std::fs::create_dir_all("/tmp/motec_test").unwrap();

        let channels = fake_channels();
        let session_id = 999;
        let started = "2026-06-16T14:30:00Z";
        let duration = 2.0_f64;

        let ld = generate_ld_file(&channels, session_id, started, duration);
        let ldx = generate_ldx_file(session_id, &format!("Sessao {}", session_id), started);

        // Sanidade estrutural antes mesmo do ldparser:
        let freq = LD_SAMPLE_RATE_HZ as usize;
        let n = (duration * freq as f64).floor() as usize + 1;
        let num_channels = channels.len() + 1; // +Time
        let expected = LD_HEAD_SIZE
            + LD_EVENT_SIZE
            + num_channels * LD_CHAN_SIZE
            + num_channels * n * 4;
        assert_eq!(ld.len(), expected, "tamanho total do .ld divergente");
        assert_eq!(&ld[0..4], &0x40u32.to_le_bytes(), "marker incorreto");

        std::fs::write(OUT_LD, &ld).unwrap();
        std::fs::write(OUT_LDX, ldx.as_bytes()).unwrap();

        println!("LD_BYTES={}", ld.len());
        println!("WROTE_LD={}", OUT_LD);
        println!("WROTE_LDX={}", OUT_LDX);
    }
}