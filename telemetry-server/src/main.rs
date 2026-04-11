// [SERVIDOR] main.rs - DUAL DB + HTTP/WS com autenticação JWT
//
// FLUXO:
//   Edge (Jetson) ──Wi-Fi──→ TCP :8080 → decodifica → TimescaleDB + SQLite
//   Browser/App   ──HTTP──→ GET /       → index.html
//   Browser/App   ──HTTP──→ POST /login → JWT token
//   Browser/App   ──WS──→   /ws         → broadcast JSON (requer JWT)
//
// PORTAS:
//   8080 → TCP binário (edge → servidor) — NÃO MUDA
//   8081 → HTTP + WebSocket autenticado (servidor → clientes)

use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::broadcast;
use tracing::{info, warn, error};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use std::path::Path;
use jsonwebtoken::{encode, decode, Header, Algorithm, Validation, EncodingKey, DecodingKey};
use bcrypt::verify;
use chrono::Utc;

mod decoder;

// ==================== HTML ESTÁTICO ====================
// Embutido no binário — não precisa de arquivo externo em produção
const INDEX_HTML: &str = include_str!("../static/index.html");

// ==================== CONFIGURAÇÕES ====================
const TCP_PORT: u16 = 8080;
const HTTP_WS_PORT: u16 = 8081;
const SQLITE_PATH: &str = "sqlite:./data/historico.db";
const CSV_DATA_PATH: &str = "./csv_data";
const MAX_PG_CONNECTIONS: u32 = 20;
const JWT_EXPIRY_HOURS: i64 = 8;
const NTP_PORT: u16 = 9999;

fn get_pg_url() -> String {
    let password = std::env::var("DB_PASSWORD").expect("❌ DB_PASSWORD não definida no .env");
    format!("postgres://eracing:{}@localhost/telemetria", password)
}

fn get_jwt_secret() -> String {
    std::env::var("JWT_SECRET").expect("❌ JWT_SECRET não definida no .env")
}

// ==================== ESTRUTURAS ====================

#[derive(Debug, Clone, Serialize)]
pub struct ProcessedSignal {
    pub timestamp: f64,
    pub device_id: String,
    pub can_id: u32,
    pub signal_name: String,
    pub value: f64,
    pub unit: String,
}

// Claims do JWT — o que fica dentro do token
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,  // username
    iat: i64,     // issued at
    exp: i64,     // expiry
}

// Body do POST /login
#[derive(Debug, Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

// ==================== JWT — GERAR E VALIDAR ====================

fn generate_jwt(username: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: username.to_string(),
        iat: now,
        exp: now + (JWT_EXPIRY_HOURS * 3600),
    };
    encode(
        &Header::default(), // HS256
        &claims,
        &EncodingKey::from_secret(get_jwt_secret().as_bytes()),
    )
}

fn validate_jwt(token: &str) -> bool {
    let secret = get_jwt_secret();
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .is_ok()
}

// ==================== INIT TIMESCALEDB ====================

async fn init_timescale(pool: &sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
        .execute(pool)
        .await?;

    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS sensor_data (
            time        TIMESTAMPTZ      NOT NULL,
            device_id   TEXT             NOT NULL,
            signal_name TEXT             NOT NULL,
            value       DOUBLE PRECISION NOT NULL,
            unit        TEXT,
            can_id      INTEGER          NOT NULL,
            quality     TEXT             DEFAULT 'ok'
        )
    "#)
    .execute(pool)
    .await?;

    sqlx::query(
        "SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE)"
    )
    .execute(pool)
    .await
    .ok();

    sqlx::query(r#"
        CREATE INDEX IF NOT EXISTS idx_device_signal_time
            ON sensor_data (device_id, signal_name, time DESC)
    "#)
    .execute(pool)
    .await?;

    sqlx::query(r#"
        CREATE INDEX IF NOT EXISTS idx_signal_time
            ON sensor_data (signal_name, time DESC)
    "#)
    .execute(pool)
    .await?;

    sqlx::query(r#"
        SELECT add_retention_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE)
    "#)
    .execute(pool)
    .await
    .ok();

    info!("✅ TimescaleDB inicializado (tempo real, retenção 7 dias)");
    Ok(())
}

// ==================== INIT SQLITE ====================

async fn init_sqlite(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all("./data")?;

    // Tabela de histórico CAN — igual à versão anterior
    sqlx::query(r#"
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
    "#).execute(pool).await?;

    sqlx::query(r#"
        CREATE INDEX IF NOT EXISTS idx_hist_timestamp
            ON historico (timestamp DESC)
    "#).execute(pool).await?;

    sqlx::query(r#"
        CREATE INDEX IF NOT EXISTS idx_hist_signal
            ON historico (signal_name, timestamp DESC)
    "#).execute(pool).await?;

    sqlx::query(r#"
        CREATE INDEX IF NOT EXISTS idx_hist_device
            ON historico (device_id, timestamp DESC)
    "#).execute(pool).await?;

    // Tabela de usuários para autenticação web
    // Senhas armazenadas como hash bcrypt — nunca plain text
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    "#).execute(pool).await?;

    sqlx::query("PRAGMA journal_mode=WAL").execute(pool).await?;
    sqlx::query("PRAGMA synchronous=NORMAL").execute(pool).await?;

    info!("✅ SQLite inicializado (histórico persistente + users)");
    Ok(())
}

// ==================== SALVAR TIMESCALEDB ====================

async fn save_timescale(
    pool: &sqlx::PgPool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for s in signals {
        sqlx::query(r#"
            INSERT INTO sensor_data (time, device_id, signal_name, value, unit, can_id)
            VALUES (to_timestamp($1), $2, $3, $4, $5, $6)
        "#)
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

async fn save_sqlite(
    pool: &SqlitePool,
    signals: &[ProcessedSignal],
) -> Result<(), Box<dyn std::error::Error>> {
    if signals.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for s in signals {
        sqlx::query(r#"
            INSERT INTO historico (timestamp, device_id, signal_name, value, unit, can_id)
            VALUES (?, ?, ?, ?, ?, ?)
        "#)
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

async fn handle_client(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    pg_pool: sqlx::PgPool,
    decoder_map: decoder::DecoderMap,
    ws_tx: broadcast::Sender<String>,
) {
    info!("🚗 Carro conectado: {}", addr);
    let device_id = format!("car_{}", addr.ip().to_string().replace('.', "_"));

    let mut frames_total: u64 = 0;
    let mut frames_decoded: u64 = 0;
    let mut last_log = std::time::Instant::now();

    loop {
        let mut len_buf = [0u8; 4];
        match socket.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(_) => {
                warn!("🔌 Carro desconectado: {}", addr);
                break;
            }
        }

        let len = u32::from_le_bytes(len_buf) as usize;
        if len == 0 || len > 1024 {
            error!("Pacote inválido (len={}) de {} — desconectando", len, addr);
            break;
        }

        let mut payload = vec![0u8; len];
        match socket.read_exact(&mut payload).await {
            Ok(_) => {}
            Err(e) => {
                warn!("Erro ao ler payload de {}: {}", addr, e);
                break;
            }
        }

        if payload.len() < 20 {
            warn!("Payload curto ({} bytes) de {}", payload.len(), addr);
            continue;
        }

        let can_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let timestamp = f64::from_le_bytes(payload[4..12].try_into().unwrap());
        let raw_data = &payload[12..20];

        // Latência real = agora no servidor - timestamp já corrigido pelo offset da Jetson
        let t_recv_srv = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let latency_ms = (t_recv_srv - timestamp) * 1000.0;
        if latency_ms >= 0.0 && latency_ms < 5000.0 {
            info!("⏱️  Latência | CAN=0x{:X} | {:.1}ms", can_id, latency_ms);
        }

        frames_total += 1;

        let signals_config = match decoder_map.get(&can_id) {
            Some(s) => s,
            None => continue,
        };

        let processed: Vec<ProcessedSignal> = signals_config
            .iter()
            .map(|cfg| {
                let value = decoder::decode_signal(raw_data, cfg);
                ProcessedSignal {
                    timestamp,
                    device_id: device_id.clone(),
                    can_id,
                    signal_name: cfg.signal_name.clone(),
                    value,
                    unit: cfg.unit.clone(),
                }
            })
            .collect();

        frames_decoded += processed.len() as u64;

        let pg_pool_c = pg_pool.clone();
        let processed_ts = processed.clone();

        tokio::spawn(async move {
            if let Err(e) = save_timescale(&pg_pool_c, &processed_ts).await {
                error!("❌ TimescaleDB insert error: {:?}", e);
            }
        });

        for signal in &processed {
            if let Ok(json) = serde_json::to_string(signal) {
                let _ = ws_tx.send(json);
            }
        }

        if last_log.elapsed().as_secs() >= 10 {
            let elapsed = last_log.elapsed().as_secs_f64();
            info!(
                "📊 {} | frames: {} | sinais: {} | taxa: {:.0} frames/s",
                device_id, frames_total, frames_decoded,
                frames_total as f64 / elapsed
            );
            frames_total = 0;
            frames_decoded = 0;
            last_log = std::time::Instant::now();
        }
    }

    info!("👋 {} desconectado", device_id);
}

// ==================== SERVIDOR HTTP + WEBSOCKET :8081 ====================
// Uma única porta serve:
//   GET /       → index.html
//   POST /login → JWT
//   GET /ws     → WebSocket (requer JWT no header Authorization)
//   qualquer outra → 404

async fn run_http_ws_server(
    ws_broadcast_tx: broadcast::Sender<String>,
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

// ==================== PARSER HTTP MÍNIMO ====================
// Lê os primeiros bytes da conexão TCP para identificar a requisição

async fn handle_http_connection(
    mut stream: TcpStream,
    addr: std::net::SocketAddr,
    ws_tx: broadcast::Sender<String>,
    pg_pool: sqlx::PgPool,
    sqlite_pool: SqlitePool,
) {
    // Lê até 4KB do request HTTP
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

    // Roteamento por método + path
    if first_line.starts_with("GET / ") || first_line.starts_with("GET / HTTP") {
        // Serve o HTML estático
        serve_html(&mut stream).await;

    } else if first_line.starts_with("POST /login") {
        // Autenticação — retorna JWT
        handle_login(&mut stream, &request, &sqlite_pool).await;

    } else if first_line.starts_with("GET /ws") {
        // Upgrade para WebSocket (com validação JWT)
        handle_ws_upgrade(stream, &request, addr, ws_tx).await;

    } else if first_line.starts_with("POST /migrate") {
        handle_migrate(&mut stream, &request, &pg_pool, &sqlite_pool).await;

    } else {
        // 404 para tudo mais
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
        let _ = stream.write_all(response.as_bytes()).await;
    }
}

// ==================== GET / → index.html ====================

async fn serve_html(stream: &mut TcpStream) {
    let body = INDEX_HTML;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

// ==================== POST /login ====================

async fn handle_login(
    stream: &mut TcpStream,
    request: &str,
    sqlite_pool: &SqlitePool,
) {
    // Extrai o body JSON do request HTTP
    let body = match request.split("\r\n\r\n").nth(1) {
        Some(b) => b.trim(),
        None => {
            send_json(stream, 400, r#"{"ok":false,"message":"Bad request"}"#).await;
            return;
        }
    };

    // Parseia JSON { "username": "...", "password": "..." }
    let login_req: LoginRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(_) => {
            send_json(stream, 400, r#"{"ok":false,"message":"JSON inválido"}"#).await;
            return;
        }
    };

    // Busca usuário no banco
    let row = sqlx::query(
        "SELECT password_hash FROM users WHERE username = ?"
    )
    .bind(&login_req.username)
    .fetch_optional(sqlite_pool)
    .await;

    match row {
        Ok(Some(row)) => {
            let hash: String = row.get("password_hash");

            // Verifica senha com bcrypt
            match verify(&login_req.password, &hash) {
                Ok(true) => {
                    // Gera JWT
                    match generate_jwt(&login_req.username) {
                        Ok(token) => {
                            let json = format!(r#"{{"ok":true,"token":"{}"}}"#, token);
                            send_json(stream, 200, &json).await;
                            info!("🔑 Login OK: {}", login_req.username);
                        }
                        Err(e) => {
                            error!("Erro ao gerar JWT: {}", e);
                            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
                        }
                    }
                }
                _ => {
                    send_json(stream, 401, r#"{"ok":false,"message":"Credenciais inválidas"}"#).await;
                    warn!("🔒 Login falhou: {}", login_req.username);
                }
            }
        }
        Ok(None) => {
            // Usuário não encontrado — mesma mensagem para não vazar info
            send_json(stream, 401, r#"{"ok":false,"message":"Credenciais inválidas"}"#).await;
        }
        Err(e) => {
            error!("Erro ao consultar banco: {}", e);
            send_json(stream, 500, r#"{"ok":false,"message":"Erro interno"}"#).await;
        }
    }
}

// ==================== POST /migrate ====================
// Rota manual para migrar dados antigos do TimescaleDB para SQLite
// Útil para exportar logs de corrida para análise fora de pista
// Requer JWT válido no header Authorization

async fn handle_migrate(
    stream: &mut TcpStream,
    request: &str,
    pg_pool: &sqlx::PgPool,
    sqlite_pool: &SqlitePool,
) {
    // Valida JWT — só usuários autenticados podem disparar migração
    let token = extract_bearer_token(request);
    match token {
        None => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token necessário"}"#).await;
            return;
        }
        Some(t) if !validate_jwt(&t) => {
            send_json(stream, 401, r#"{"ok":false,"message":"Token inválido"}"#).await;
            return;
        }
        Some(_) => {}
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

// ==================== GET /ws → WebSocket com JWT ====================

async fn handle_ws_upgrade(
    mut stream: TcpStream,
    request: &str,
    addr: std::net::SocketAddr,
    ws_tx: broadcast::Sender<String>,
) {
    // Extrai token do header Authorization: Bearer <token>
    let token = extract_query_token(request).or_else(|| extract_bearer_token(request));

    match token {
        None => {
            let resp = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized";
            let _ = stream.write_all(resp.as_bytes()).await;
            warn!("🔒 WS rejeitado (sem token): {}", addr);
            return;
        }
        Some(t) if !validate_jwt(&t) => {
            let resp = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 21\r\n\r\nToken inválido/expirado";
            let _ = stream.write_all(resp.as_bytes()).await;
            warn!("🔒 WS rejeitado (token inválido): {}", addr);
            return;
        }
        Some(_) => {
            // Token válido — faz o upgrade WebSocket
        }
    }

    // Extrai Sec-WebSocket-Key para o handshake
    let ws_key = match extract_ws_key(request) {
        Some(k) => k,
        None => {
            let resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request";
            let _ = stream.write_all(resp.as_bytes()).await;
            return;
        }
    };

    // Calcula o accept key conforme RFC 6455
    let accept = compute_ws_accept(&ws_key);

    // Responde com handshake de upgrade
    let handshake = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\r\n",
        accept
    );

    if stream.write_all(handshake.as_bytes()).await.is_err() {
        return;
    }

    info!("📱 WS conectado: {}", addr);

    // Loop de broadcast: envia cada frame JSON como mensagem WebSocket
    let mut rx = ws_tx.subscribe();
    loop {
        match rx.recv().await {
            Ok(json) => {
                if send_ws_text_frame(&mut stream, &json).await.is_err() {
                    info!("📱 WS desconectado: {}", addr);
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("WS {} atrasado, perdeu {} mensagens", addr, n);
            }
            Err(_) => break,
        }
    }
}

// ==================== HELPERS HTTP/WS ====================

async fn send_json(stream: &mut TcpStream, status: u16, body: &str) {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        _   => "Unknown",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
        status, status_text, body.len(), body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

fn extract_bearer_token(request: &str) -> Option<String> {
    for line in request.lines() {
        let lower = line.to_lowercase();
        if lower.starts_with("authorization:") {
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() == 2 {
                let value = parts[1].trim();
                if let Some(token) = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer ")) {
                    return Some(token.trim().to_string());
                }
            }
        }
    }
    None
}

fn extract_query_token(request: &str) -> Option<String> {
    let first_line = request.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    if let Some(query) = path.split('?').nth(1) {
        for param in query.split('&') {
            if let Some(value) = param.strip_prefix("token=") {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn extract_ws_key(request: &str) -> Option<String> {
    for line in request.lines() {
        if line.to_lowercase().starts_with("sec-websocket-key:") {
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() == 2 {
                return Some(parts[1].trim().to_string());
            }
        }
    }
    None
}

fn compute_ws_accept(key: &str) -> String {
    // RFC 6455: base64(SHA1(key + GUID))
    let combined = format!("{}258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key);
    let mut hasher = Sha1::new();
    hasher.extend(combined.as_bytes());
    let hash = hasher.finish();
    base64_encode_bytes(&hash)
}

struct Sha1 {
    h: [u32; 5],
    data: Vec<u8>,
}

impl Sha1 {
    fn new() -> Self {
        Sha1 {
            h: [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0],
            data: Vec::new(),
        }
    }
    fn extend(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
    }
    fn finish(mut self) -> [u8; 20] {
        let len = self.data.len() as u64;
        self.data.push(0x80);
        while (self.data.len() % 64) != 56 {
            self.data.push(0);
        }
        self.data.extend_from_slice(&(len * 8).to_be_bytes());
        for chunk in self.data.chunks(64) {
            let mut w = [0u32; 80];
            for i in 0..16 {
                w[i] = u32::from_be_bytes(chunk[i*4..i*4+4].try_into().unwrap());
            }
            for i in 16..80 {
                w[i] = (w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16]).rotate_left(1);
            }
            let (mut a, mut b, mut c, mut d, mut e) =
                (self.h[0], self.h[1], self.h[2], self.h[3], self.h[4]);
            for i in 0..80 {
                let (f, k) = match i {
                    0..=19  => ((b & c) | ((!b) & d),          0x5A827999u32),
                    20..=39 => (b ^ c ^ d,                     0x6ED9EBA1u32),
                    40..=59 => ((b & c) | (b & d) | (c & d),   0x8F1BBCDCu32),
                    _       => (b ^ c ^ d,                     0xCA62C1D6u32),
                };
                let temp = a.rotate_left(5)
                    .wrapping_add(f)
                    .wrapping_add(e)
                    .wrapping_add(k)
                    .wrapping_add(w[i]);
                e = d; d = c; c = b.rotate_left(30); b = a; a = temp;
            }
            self.h[0] = self.h[0].wrapping_add(a);
            self.h[1] = self.h[1].wrapping_add(b);
            self.h[2] = self.h[2].wrapping_add(c);
            self.h[3] = self.h[3].wrapping_add(d);
            self.h[4] = self.h[4].wrapping_add(e);
        }
        let mut out = [0u8; 20];
        for (i, &val) in self.h.iter().enumerate() {
            out[i*4..i*4+4].copy_from_slice(&val.to_be_bytes());
        }
        out
    }
}

fn base64_encode_bytes(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(n >> 18) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { out.push(TABLE[((n >> 6) & 0x3F) as usize] as char); } else { out.push('='); }
        if chunk.len() > 2 { out.push(TABLE[(n & 0x3F) as usize] as char); } else { out.push('='); }
    }
    out
}

// Envia uma mensagem como frame WebSocket text (opcode 0x1)
async fn send_ws_text_frame(stream: &mut TcpStream, msg: &str) -> Result<(), std::io::Error> {
    let payload = msg.as_bytes();
    let len = payload.len();
    let mut frame = Vec::new();
    frame.push(0x81u8); // FIN + opcode text
    if len <= 125 {
        frame.push(len as u8);
    } else if len <= 65535 {
        frame.push(126u8);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        frame.push(127u8);
        frame.extend_from_slice(&(len as u64).to_be_bytes());
    }
    frame.extend_from_slice(payload);
    stream.write_all(&frame).await
}

// ==================== SERVIDOR NTP (medição de offset) ====================
// Protocolo: recebe 8 bytes (t1 f64), responde 16 bytes (t2 f64 + t3 f64)
// t2 = timestamp de quando o servidor recebeu
// t3 = timestamp de quando o servidor vai responder
// A Jetson calcula: offset = ((t2 - t1) + (t3 - t4)) / 2

async fn run_ntp_server(port: u16) {
    let listener = match TcpListener::bind(format!("0.0.0.0:{}", port)).await {
        Ok(l) => { info!("🕐 NTP server em 0.0.0.0:{}", port); l }
        Err(e) => { error!("❌ Falha ao abrir porta NTP {}: {}", port, e); return; }
    };

    loop {
        match listener.accept().await {
            Ok((mut stream, addr)) => {
                tokio::spawn(async move {
                    let mut buf = [0u8; 8];
                    if stream.read_exact(&mut buf).await.is_err() { return; }

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

                    if stream.write_all(&resp).await.is_err() { return; }
                    info!("🕐 NTP respondido para {}", addr);
                });
            }
            Err(e) => error!("NTP accept error: {}", e),
        }
    }
}

// ==================== MIGRAÇÃO TimescaleDB → SQLite ====================
// Chamada uma vez no boot e também disponível via rota HTTP POST /migrate
// Migra dados com mais de 7 dias do TimescaleDB para o SQLite histórico.

async fn migrate_old_data(
    pg_pool: &sqlx::PgPool,
    sqlite_pool: &SqlitePool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {

    // Verifica se há dados antigos antes de fazer qualquer coisa
    let count_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM sensor_data WHERE time < NOW() - INTERVAL '7 days'"
    )
    .fetch_one(pg_pool)
    .await?;

    let count: i64 = count_row.get("cnt");

    if count == 0 {
        info!("✅ Migração: nenhum dado antigo no TimescaleDB");
        return Ok(0);
    }

    info!("📦 Migração: {} registros antigos encontrados, iniciando...", count);

    // Busca em lotes de 5000 para não explodir a memória
    let mut total_migrated = 0usize;
    let mut offset: i64 = 0;
    let batch_size: i64 = 5000;

    loop {
        let rows = sqlx::query(r#"
            SELECT
                extract(epoch from time) as ts,
                device_id,
                signal_name,
                value,
                COALESCE(unit, '') as unit,
                can_id
            FROM sensor_data
            WHERE time < NOW() - INTERVAL '7 days'
            ORDER BY time ASC
            LIMIT $1 OFFSET $2
        "#)
        .bind(batch_size)
        .bind(offset)
        .fetch_all(pg_pool)
        .await?;

        if rows.is_empty() {
            break;
        }

        // Insere lote no SQLite em uma única transação
        let mut tx = sqlite_pool.begin().await?;

        for row in &rows {
            let ts: f64          = row.get("ts");
            let device_id: &str  = row.get("device_id");
            let signal_name: &str = row.get("signal_name");
            let value: f64       = row.get("value");
            let unit: &str       = row.get("unit");
            let can_id: i32      = row.get("can_id");

            sqlx::query(r#"
                INSERT OR IGNORE INTO historico
                    (timestamp, device_id, signal_name, value, unit, can_id)
                VALUES (?, ?, ?, ?, ?, ?)
            "#)
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

        total_migrated += rows.len();
        offset += batch_size;
        info!("  → {} / {} migrados...", total_migrated, count);
    }

    info!("✅ Migração concluída: {} registros movidos para SQLite", total_migrated);
    Ok(total_migrated)
}

// ==================== MAIN ====================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Validar variáveis de ambiente obrigatórias
    let _ = get_pg_url();
    let _ = get_jwt_secret();

    info!("🚀 Telemetry Server v2.1 — Dual DB + JWT Auth");
    info!("   TimescaleDB → tempo real | SQLite → histórico + users");

    std::fs::create_dir_all("./data")?;
    std::fs::create_dir_all("./static")?;

    // Carrega mapa CAN
    let decoder_map = decoder::load_can_mappings(CSV_DATA_PATH)?;
    info!("✅ {} CAN IDs carregados do CSV", decoder_map.len());

    // Conecta TimescaleDB
    let pg_pool = PgPoolOptions::new()
        .max_connections(MAX_PG_CONNECTIONS)
        .connect(&get_pg_url())
        .await?;
    init_timescale(&pg_pool).await?;

    // Conecta SQLite
    let sqlite_file = "./data/historico.db";
    if !Path::new(sqlite_file).exists() {
        std::fs::File::create(sqlite_file)?;
    }
    let sqlite_pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(SQLITE_PATH)
        .await?;
    init_sqlite(&sqlite_pool).await?;
    // Migração no boot: move dados antigos do TimescaleDB para SQLite (roda uma vez)
    info!("🔍 Verificando dados antigos para migração...");
    match migrate_old_data(&pg_pool, &sqlite_pool).await {
        Ok(n) if n > 0 => info!("✅ Boot: {} registros migrados para SQLite", n),
        Ok(_)          => info!("✅ Boot: nenhum dado antigo para migrar"),
        Err(e)         => warn!("⚠️  Boot: erro na migração (não crítico): {:?}", e),
    }

    // Canal broadcast para WebSocket (buffer 10.000 msgs)
    let (ws_tx, _) = broadcast::channel::<String>(10_000);

    // Spawn servidor HTTP+WS :8081
    {
        let tx = ws_tx.clone();
        let pg = pg_pool.clone();
        let db = sqlite_pool.clone();
        tokio::spawn(async move {
            run_http_ws_server(tx, pg, db, HTTP_WS_PORT).await;
        });

        // Spawn servidor NTP :9999
        tokio::spawn(async move {
        run_ntp_server(NTP_PORT).await;
        });
    }

    // Listener TCP :8080 para frames CAN
    let tcp_listener = TcpListener::bind(format!("0.0.0.0:{}", TCP_PORT)).await?;
    info!("📡 TCP CAN listener em 0.0.0.0:{}", TCP_PORT);
    info!("🌐 HTTP+WS server em 0.0.0.0:{}", HTTP_WS_PORT);
    info!("✅ Servidor pronto!\n");

    loop {
        let (socket, addr) = tcp_listener.accept().await?;
        let pg  = pg_pool.clone();
        let dec = decoder_map.clone();
        let tx  = ws_tx.clone();
        tokio::spawn(async move {
            handle_client(socket, addr, pg, dec, tx).await;
        });
    }
}