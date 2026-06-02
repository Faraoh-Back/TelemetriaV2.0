use crate::auth::*;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tracing::{info, warn};

pub async fn handle_ws_upgrade(
    mut stream: TcpStream,
    request: &str,
    addr: std::net::SocketAddr,
    ws_tx: broadcast::Sender<Vec<u8>>,
) {
    let token = extract_query_token(request).or_else(|| extract_bearer_token(request));

    match token {
        None => {
            let resp = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized";
            let _ = stream.write_all(resp.as_bytes()).await;
            warn!("🔒 WS rejeitado (sem token): {}", addr);
            return;
        }
        Some(t) if !validate_jwt(&t) => {
            let resp =
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: 21\r\n\r\nToken inválido/expirado";
            let _ = stream.write_all(resp.as_bytes()).await;
            warn!("🔒 WS rejeitado (token inválido): {}", addr);
            return;
        }
        Some(_) => {}
    }

    let ws_key = match extract_ws_key(request) {
        Some(k) => k,
        None => {
            let resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request";
            let _ = stream.write_all(resp.as_bytes()).await;
            return;
        }
    };

    let accept = compute_ws_accept(&ws_key);

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

    let mut rx = ws_tx.subscribe();
    loop {
        match rx.recv().await {
            Ok(json) => {
                if send_ws_binary_frame(&mut stream, &json).await.is_err() {
                    info!("📱 WS desconectado: {}", addr);
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("⚠️  WS cliente lento {}, ignorando {} msgs", addr, n);
            }
            Err(broadcast::error::RecvError::Closed) => {
                break;
            }
        }
    }
}

pub fn extract_ws_key(request: &str) -> Option<String> {
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

pub fn compute_ws_accept(key: &str) -> String {
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
                w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
            }
            for i in 16..80 {
                w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
            }
            let (mut a, mut b, mut c, mut d, mut e) =
                (self.h[0], self.h[1], self.h[2], self.h[3], self.h[4]);
            for i in 0..80 {
                let (f, k) = match i {
                    0..=19 => ((b & c) | ((!b) & d), 0x5A827999u32),
                    20..=39 => (b ^ c ^ d, 0x6ED9EBA1u32),
                    40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDCu32),
                    _ => (b ^ c ^ d, 0xCA62C1D6u32),
                };
                let temp = a
                    .rotate_left(5)
                    .wrapping_add(f)
                    .wrapping_add(e)
                    .wrapping_add(k)
                    .wrapping_add(w[i]);
                e = d;
                d = c;
                c = b.rotate_left(30);
                b = a;
                a = temp;
            }
            self.h[0] = self.h[0].wrapping_add(a);
            self.h[1] = self.h[1].wrapping_add(b);
            self.h[2] = self.h[2].wrapping_add(c);
            self.h[3] = self.h[3].wrapping_add(d);
            self.h[4] = self.h[4].wrapping_add(e);
        }
        let mut out = [0u8; 20];
        for (i, &val) in self.h.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&val.to_be_bytes());
        }
        out
    }
}

pub fn base64_encode_bytes(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(n >> 18) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub async fn send_ws_text_frame(stream: &mut TcpStream, msg: &str) -> Result<(), std::io::Error> {
    let payload = msg.as_bytes();
    let len = payload.len();
    let mut frame = Vec::new();
    frame.push(0x81u8);
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

pub async fn send_ws_binary_frame(
    stream: &mut TcpStream,
    data: &[u8],
) -> Result<(), std::io::Error> {
    let len = data.len();
    let mut frame = Vec::new();
    frame.push(0x82u8);
    if len <= 125 {
        frame.push(len as u8);
    } else if len <= 65535 {
        frame.push(126u8);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        frame.push(127u8);
        frame.extend_from_slice(&(len as u64).to_be_bytes());
    }
    frame.extend_from_slice(data);
    stream.write_all(&frame).await
}
