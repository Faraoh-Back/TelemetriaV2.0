// [CARRO] main.rs - SocketCAN + Kvaser SDK Edition
//
// Lê frames CAN de duas fontes simultâneas:
//   - Canal 0: SocketCAN (can0, can1...) via socketcan crate
//   - Canal 1: Kvaser físico via kvaser-canlib FFI
//
// Aplica sistema de prioridades baseado em CSVs (igual ao Python):
//   Prioridade 1 (Alta)  → arquivos VCU, BMS no nome
//   Prioridade 2 (Média) → arquivos PT, PAINEL no nome
//   Prioridade 3 (Baixa) → outros arquivos CSV
//   Prioridade 4 (Default) → IDs não encontrados no CSV
//
// Envia para servidor via TCP (binário, little-endian, 24 bytes/frame)
// Backup local em SQLite se servidor cair, com sincronização automática.
//
// Compilação:
//   cargo build --release
//
// Uso:
//   ./telemetry-edge --pasta_csv ./csv_data --ch0 can0 --ch1 0
//   ./telemetry-edge --pasta_csv ./csv_data --ch0 can0              (só SocketCAN)
//   ./telemetry-edge --pasta_csv ./csv_data --ch1 0 --bitrate1 250000 (só Kvaser)

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use tokio::net::TcpStream;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn, error};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;

// ─── CLI Arguments ─────────────────────────────────────────────
#[derive(Parser, Debug)]
#[command(
    name = "telemetry-edge",
    about = "Telemetria Edge — SocketCAN + Kvaser SDK Edition"
)]
struct Args {
    /// Pasta com CSVs de IDs CAN (VCU, BMS, PT, PAINEL, etc.)
    #[arg(long)]
    pasta_csv: String,

    /// Canal 0: interface SocketCAN (ex: 'can0', 'can1')
    /// Se omitido, canal SocketCAN é desabilitado
    #[arg(long)]
    ch0: Option<String>,

    /// Canal 1: número do canal Kvaser (0, 1, 2...)
    /// Se omitido, canal Kvaser é desabilitado
    #[arg(long)]
    ch1: Option<u32>,

    /// Bitrate canal 0 (padrão: 500000)
    #[arg(long, default_value = "500000")]
    bitrate0: u32,

    /// Bitrate canal 1 (padrão: 250000)
    #[arg(long, default_value = "250000")]
    bitrate1: u32,

    /// Endereço do servidor (padrão: 192.168.1.100:8080)
    #[arg(long, default_value = "192.168.1.100:8080")]
    server: String,

    /// ID do dispositivo (padrão: car_001)
    #[arg(long, default_value = "car_001")]
    device_id: String,

    /// Caminho do banco SQLite de backup
    #[arg(long, default_value = "sqlite:telemetria_backup.db")]
    db_path: String,

    /// Tamanho do lote para envio TCP (padrão: 10)
    #[arg(long, default_value = "10")]
    batch_size: usize,
}

// ─── Estruturas ────────────────────────────────────────────────
#[derive(Debug, Clone)]
pub struct TelemetryFrame {
    pub timestamp: f64,
    pub can_id: u32,
    pub data: [u8; 8],
    pub priority: u8,   // 1=Alta, 2=Média, 3=Baixa, 4=Default
    pub channel: String,
}

/// Mapa de prioridades: CAN ID (u32) → prioridade (1-4)
pub type PriorityMap = HashMap<u32, u8>;

// ─── Carregamento de Prioridades (igual ao Python) ─────────────
pub fn load_priority_map(csv_dir: &str) -> PriorityMap {
    let mut map: PriorityMap = HashMap::new();

    let dir_path = Path::new(csv_dir);
    if !dir_path.is_dir() {
        error!("❌ Pasta CSV não encontrada: {}", csv_dir);
        return map;
    }

    info!("📂 Carregando CSVs de '{}'...", csv_dir);

    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(e) => {
            error!("❌ Erro ao ler pasta CSV: {}", e);
            return map;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // Só arquivos .csv
        if path.extension().and_then(|s| s.to_str()) != Some("csv") {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_uppercase();

        // Define prioridade pelo nome do arquivo (igual ao Python)
        let priority: u8 = if filename.contains("VCU") || filename.contains("BMS") {
            1 // Alta
        } else if filename.contains("PT") || filename.contains("PAINEL") {
            2 // Média
        } else {
            3 // Baixa
        };

        // Lê o CSV: coluna índice 1 (segunda coluna) tem os CAN IDs em hex
        // Igual ao Python: usecols=[1], comment='/', skip_blank_lines=True
        let mut count = 0usize;
        match csv::ReaderBuilder::new()
            .has_headers(false)
            .comment(Some(b'/'))
            .flexible(true)
            .from_path(&path)
        {
            Ok(mut rdr) => {
                for result in rdr.records() {
                    if let Ok(record) = result {
                        // Pega a segunda coluna (índice 1)
                        if let Some(id_str) = record.get(1) {
                            let cleaned = id_str.trim()
                                .trim_start_matches("0x")
                                .trim_start_matches("0X");
                            if let Ok(id_int) = u32::from_str_radix(cleaned, 16) {
                                map.insert(id_int, priority);
                                count += 1;
                            }
                        }
                    }
                }
                info!(
                    "  {:<35} → Prioridade {}  ({} IDs)",
                    path.file_name().unwrap_or_default().to_string_lossy(),
                    priority,
                    count
                );
            }
            Err(e) => {
                warn!("  ⚠️  Erro ao ler {:?}: {}", path.file_name().unwrap_or_default(), e);
            }
        }
    }

    info!("✅ Mapa de prioridades: {} IDs únicos\n", map.len());
    map
}

// ─── Banco de Dados Local (Backup) ─────────────────────────────
async fn init_database(db_path: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    // Garante que o arquivo existe antes de conectar
    let file_path = db_path.trim_start_matches("sqlite:");
    if !file_path.is_empty() && file_path != ":memory:" {
        // Cria o arquivo vazio se não existir
        if !Path::new(file_path).exists() {
            std::fs::File::create(file_path)?;
        }
    }

    let pool = SqlitePool::connect(db_path).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS raw_can_logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp  REAL    NOT NULL,
            can_id     INTEGER NOT NULL,
            data       BLOB    NOT NULL,
            device_id  TEXT    NOT NULL DEFAULT 'car_001',
            priority   INTEGER NOT NULL DEFAULT 4,
            channel    TEXT    NOT NULL DEFAULT 'unknown',
            synced     INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_synced    ON raw_can_logs(synced);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON raw_can_logs(timestamp);
        "#,
    )
    .execute(&pool)
    .await?;

    info!("✅ Banco SQLite inicializado: {}", db_path);
    Ok(pool)
}

async fn backup_to_sqlite(
    pool: &SqlitePool,
    frames: &[TelemetryFrame],
    device_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut tx = pool.begin().await?;

    for frame in frames {
        sqlx::query(
            "INSERT INTO raw_can_logs (timestamp, can_id, data, device_id, priority, channel)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(frame.timestamp)
        .bind(frame.can_id as i64)
        .bind(&frame.data[..])
        .bind(device_id)
        .bind(frame.priority as i64)
        .bind(&frame.channel)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

// ─── Envio TCP ─────────────────────────────────────────────────
// Protocolo: [4 bytes: len][4 bytes: can_id][8 bytes: timestamp][8 bytes: data]
// Total: 24 bytes por frame, tudo little-endian
async fn send_batch(
    stream: &mut TcpStream,
    frames: &[TelemetryFrame],
) -> Result<(), Box<dyn std::error::Error>> {
    for frame in frames {
        let mut payload = Vec::with_capacity(20);
        payload.extend_from_slice(&frame.can_id.to_le_bytes());    // 4 bytes
        payload.extend_from_slice(&frame.timestamp.to_le_bytes()); // 8 bytes
        payload.extend_from_slice(&frame.data);                    // 8 bytes

        let len = payload.len() as u32;
        stream.write_all(&len.to_le_bytes()).await?;
        stream.write_all(&payload).await?;
    }
    stream.flush().await?;
    Ok(())
}

// ─── Sincronização de Pendentes ─────────────────────────────────
async fn sync_pending_data(
    pool: &SqlitePool,
    stream: &mut TcpStream,
) -> Result<usize, Box<dyn std::error::Error>> {
    let rows = sqlx::query(
        "SELECT id, timestamp, can_id, data FROM raw_can_logs WHERE synced = 0 LIMIT 1000",
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    info!("🔄 Sincronizando {} registros pendentes...", rows.len());

    let mut synced_ids: Vec<i64> = Vec::new();

    for row in &rows {
        let id: i64 = row.get("id");
        let timestamp: f64 = row.get("timestamp");
        let can_id: i64 = row.get("can_id");
        let data: Vec<u8> = row.get("data");

        let mut data_fixed = [0u8; 8];
        let len = data.len().min(8);
        data_fixed[..len].copy_from_slice(&data[..len]);

        let frame = TelemetryFrame {
            timestamp,
            can_id: can_id as u32,
            data: data_fixed,
            priority: 4,
            channel: "sync".to_string(),
        };

        if send_batch(stream, &[frame]).await.is_ok() {
            synced_ids.push(id);
        } else {
            break; // Conexão caiu
        }
    }

    if !synced_ids.is_empty() {
        let ids_str: Vec<String> = synced_ids.iter().map(|id| id.to_string()).collect();
        let query = format!(
            "UPDATE raw_can_logs SET synced = 1 WHERE id IN ({})",
            ids_str.join(",")
        );
        sqlx::query(&query).execute(pool).await?;
        info!("✅ {} registros marcados como sincronizados", synced_ids.len());
    }

    Ok(synced_ids.len())
}

// ─── Leitor SocketCAN ──────────────────────────────────────────
#[cfg(target_os = "linux")]
async fn run_socketcan_reader(
    iface: String,
    _bitrate: u32,
    priority_map: Arc<PriorityMap>,
    tx: mpsc::Sender<TelemetryFrame>,
    running: Arc<AtomicBool>,
) {
    use socketcan::{CanSocket, Socket};

    info!("📡 Abrindo SocketCAN '{}'...", iface);

    let socket = match CanSocket::open(&iface) {
        Ok(s) => s,
        Err(e) => {
            error!("❌ Falha ao abrir SocketCAN '{}': {}", iface, e);
            return;
        }
    };

    if let Err(e) = socket.set_nonblocking(true) {
        warn!("⚠️  Não foi possível setar non-blocking em '{}': {}", iface, e);
    }

    info!("✅ SocketCAN '{}' aberto", iface);

    while running.load(Ordering::Relaxed) {
        match socket.read_frame() {
            Ok(frame) => {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64();

                let can_id: u32 = match frame.id() {
                    socketcan::Id::Standard(id) => id.as_raw() as u32,
                    socketcan::Id::Extended(id) => id.as_raw(),
                };

                let data_slice = frame.data();
                let mut data_fixed = [0u8; 8];
                data_fixed[..data_slice.len().min(8)].copy_from_slice(&data_slice[..data_slice.len().min(8)]);

                let priority = *priority_map.get(&can_id).unwrap_or(&4);

                let tframe = TelemetryFrame {
                    timestamp,
                    can_id,
                    data: data_fixed,
                    priority,
                    channel: iface.clone(),
                };

                if tx.send(tframe).await.is_err() {
                    break; // Canal fechado
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // Sem dados disponíveis, yield para outras tasks
                tokio::time::sleep(Duration::from_micros(500)).await;
            }
            Err(e) => {
                error!("❌ Erro ao ler SocketCAN '{}': {:?}", iface, e);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }

    info!("🛑 Leitor SocketCAN '{}' encerrado", iface);
}

// ─── Leitor Kvaser (via canlib FFI) ────────────────────────────
// A biblioteca oficial `kvaser-canlib` para Rust usa FFI com a canlib do Linux.
// Requer: libcanlib.so instalada (pacote kvaser-drivers-dkms ou canlib SDK)
//
// Se a canlib não estiver disponível, este reader loga erro e retorna.
async fn run_kvaser_reader(
    ch_num: u32,
    bitrate: u32,
    priority_map: Arc<PriorityMap>,
    tx: mpsc::Sender<TelemetryFrame>,
    running: Arc<AtomicBool>,
) {
    // Tenta usar a canlib via comando de sistema (kvaser_stat) para verificar disponibilidade
    // Na prática, usa FFI direto. Aqui usamos o crate `canlib` se disponível.
    //
    // IMPORTANTE: Para habilitar Kvaser real, adicione ao Cargo.toml:
    //   [dependencies]
    //   canlib = "0.3"          # wrapper do kvaser canlib para Rust
    //
    // E descomente o bloco abaixo. Por ora, implementamos via subprocess
    // ou deixamos o aviso claro.

    #[cfg(feature = "kvaser")]
    {
        use canlib::{Channel, Bitrate, OpenFlags};

        info!("📡 Abrindo Kvaser canal {}...", ch_num);

        let kvaser_bitrate = match bitrate {
            1000000 => Bitrate::Bitrate1M,
            500000  => Bitrate::Bitrate500K,
            250000  => Bitrate::Bitrate250K,
            125000  => Bitrate::Bitrate125K,
            _       => Bitrate::Bitrate500K,
        };

        let mut ch = match Channel::open(ch_num as i32, OpenFlags::ACCEPT_VIRTUAL) {
            Ok(c) => c,
            Err(e) => {
                error!("❌ Falha ao abrir Kvaser canal {}: {:?}", ch_num, e);
                return;
            }
        };

        if let Err(e) = ch.set_bus_params(kvaser_bitrate) {
            error!("❌ Falha ao setar bitrate Kvaser: {:?}", e);
            return;
        }

        if let Err(e) = ch.bus_on() {
            error!("❌ Falha ao ativar barramento Kvaser: {:?}", e);
            return;
        }

        info!("✅ Kvaser canal {} aberto ({} bit/s)", ch_num, bitrate);

        let channel_name = format!("kvaser_ch{}", ch_num);

        while running.load(Ordering::Relaxed) {
            match ch.read(Some(std::time::Duration::from_millis(100))) {
                Ok(frame) => {
                    let timestamp = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64();

                    let can_id = frame.id() as u32;

                    let raw_data = frame.data();
                    let mut data_fixed = [0u8; 8];
                    data_fixed[..raw_data.len().min(8)].copy_from_slice(&raw_data[..raw_data.len().min(8)]);

                    let priority = *priority_map.get(&can_id).unwrap_or(&4);

                    let tframe = TelemetryFrame {
                        timestamp,
                        can_id,
                        data: data_fixed,
                        priority,
                        channel: channel_name.clone(),
                    };

                    if tx.send(tframe).await.is_err() {
                        break;
                    }
                }
                Err(e) if e.is_no_msg() => {
                    // Timeout — normal, continua
                    tokio::task::yield_now().await;
                }
                Err(e) => {
                    error!("❌ Erro Kvaser canal {}: {:?}", ch_num, e);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        let _ = ch.bus_off();
        info!("🛑 Leitor Kvaser canal {} encerrado", ch_num);
    }

    #[cfg(not(feature = "kvaser"))]
    {
        // Fallback: avisa que canlib não está compilada e simula dados para teste
        warn!(
            "⚠️  Kvaser canal {} solicitado, mas feature 'kvaser' não está habilitada.",
            ch_num
        );
        warn!("   Para habilitar, adicione 'kvaser' às features no Cargo.toml e instale o SDK.");
        warn!("   Rodando em modo SIMULAÇÃO para o canal Kvaser (dados sintéticos)...");

        let channel_name = format!("kvaser_ch{}_sim", ch_num);
        let mut fake_id: u32 = 0x100;
        let mut counter: u8 = 0;

        while running.load(Ordering::Relaxed) {
            // Gera frame sintético a cada 10ms (simulando 100 Hz)
            tokio::time::sleep(Duration::from_millis(10)).await;

            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64();

            let mut data_fixed = [0u8; 8];
            data_fixed[0] = counter;
            data_fixed[1] = (counter.wrapping_mul(2));
            counter = counter.wrapping_add(1);

            // Alterna entre alguns IDs simulados
            fake_id = match fake_id {
                0x100 => 0x200,
                0x200 => 0x300,
                _ => 0x100,
            };

            let priority = *priority_map.get(&fake_id).unwrap_or(&4);

            let tframe = TelemetryFrame {
                timestamp,
                can_id: fake_id,
                data: data_fixed,
                priority,
                channel: channel_name.clone(),
            };

            if tx.send(tframe).await.is_err() {
                break;
            }
        }
    }
}

// ─── Main ───────────────────────────────────────────────────────
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let args = Args::parse();

    // Validação mínima
    if args.ch0.is_none() && args.ch1.is_none() {
        error!("❌ Pelo menos um canal (--ch0 ou --ch1) deve ser especificado.");
        std::process::exit(1);
    }

    println!("═══════════════════════════════════════════════════════");
    println!("  Telemetria Edge — SocketCAN + Kvaser SDK Edition");
    println!("  Servidor: {}", args.server);
    println!("  Dispositivo: {}", args.device_id);
    println!("═══════════════════════════════════════════════════════\n");

    // 1. Carrega mapa de prioridades
    let priority_map = Arc::new(load_priority_map(&args.pasta_csv));
    if priority_map.is_empty() {
        warn!("⚠️  Mapa de prioridades vazio — todos os frames terão prioridade 4");
    }

    // 2. Inicializa banco local de backup
    let db_pool = init_database(&args.db_path).await?;

    // 3. Canal de comunicação entre leitores CAN e loop de envio
    // Buffer de 1000 frames — se o servidor estiver lento, eles acumulam aqui
    let (tx, mut rx) = mpsc::channel::<TelemetryFrame>(1000);

    // Flag de controle para encerrar threads graciosamente
    let running = Arc::new(AtomicBool::new(true));

    // Ctrl+C handler
    {
        let running_clone = running.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            info!("\n🛑 Sinal de encerramento recebido...");
            running_clone.store(false, Ordering::Relaxed);
        });
    }

    // 4. Inicia leitores CAN em tasks separadas
    if let Some(ref iface) = args.ch0 {
        let iface_clone = iface.clone();
        let pmap = priority_map.clone();
        let tx_clone = tx.clone();
        let running_clone = running.clone();
        let bitrate = args.bitrate0;

        tokio::spawn(async move {
            #[cfg(target_os = "linux")]
            run_socketcan_reader(iface_clone, bitrate, pmap, tx_clone, running_clone).await;

            #[cfg(not(target_os = "linux"))]
            {
                error!("❌ SocketCAN só funciona em Linux. Canal '{}' desabilitado.", iface_clone);
            }
        });
    }

    if let Some(ch1_num) = args.ch1 {
        let pmap = priority_map.clone();
        let tx_clone = tx.clone();
        let running_clone = running.clone();
        let bitrate = args.bitrate1;

        tokio::spawn(async move {
            run_kvaser_reader(ch1_num, bitrate, pmap, tx_clone, running_clone).await;
        });
    }

    // tx original não é mais necessário — os clones estão nas tasks
    drop(tx);

    // 5. Loop principal: recebe frames do canal e envia ao servidor
    let batch_size = args.batch_size;
    let server_addr = args.server.clone();
    let device_id = args.device_id.clone();

    let mut frame_buffer: Vec<TelemetryFrame> = Vec::with_capacity(batch_size);
    let mut total_sent: u64 = 0;
    let mut total_backed_up: u64 = 0;

    loop {
        if !running.load(Ordering::Relaxed) {
            info!("🛑 Encerrando loop principal...");
            break;
        }

        info!("🔌 Tentando conectar ao servidor: {}", server_addr);

        let mut stream = loop {
            match TcpStream::connect(&server_addr).await {
                Ok(s) => {
                    info!("✅ Conectado ao servidor!");
                    break s;
                }
                Err(e) => {
                    if !running.load(Ordering::Relaxed) {
                        info!("🛑 Encerrando antes de conectar.");
                        return Ok(());
                    }
                    warn!("❌ Falha ao conectar: {}. Tentando novamente em 1s...", e);
                    sleep(Duration::from_secs(1)).await;
                }
            }
        };

        // Sincroniza dados pendentes do backup
        match sync_pending_data(&db_pool, &mut stream).await {
            Ok(n) if n > 0 => info!("✅ {} registros pendentes sincronizados", n),
            Err(e) => warn!("⚠️  Erro ao sincronizar pendentes: {}", e),
            _ => {}
        }

        // Loop de envio
        'send_loop: loop {
            if !running.load(Ordering::Relaxed) {
                break 'send_loop;
            }

            // Coleta até batch_size frames do canal (não-bloqueante com timeout pequeno)
            frame_buffer.clear();

            // Recebe o primeiro frame com timeout (evita busy-wait)
            match tokio::time::timeout(Duration::from_millis(5), rx.recv()).await {
                Ok(Some(frame)) => {
                    frame_buffer.push(frame);
                }
                Ok(None) => {
                    // Canal fechado — todos os leitores encerraram
                    info!("📭 Canal de frames fechado. Encerrando.");
                    break 'send_loop;
                }
                Err(_) => {
                    // Timeout — sem frames no momento
                    continue 'send_loop;
                }
            }

            // Tenta pegar mais frames sem bloquear (até batch_size)
            while frame_buffer.len() < batch_size {
                match rx.try_recv() {
                    Ok(frame) => frame_buffer.push(frame),
                    Err(_) => break,
                }
            }

            // Log a cada 1000 frames enviados
            total_sent += frame_buffer.len() as u64;
            if total_sent % 1000 < frame_buffer.len() as u64 {
                let sample = &frame_buffer[0];
                info!(
                    "📊 Enviados: {} | Backup: {} | Último: ID=0x{:X} Prio={} Canal={}",
                    total_sent, total_backed_up,
                    sample.can_id, sample.priority, sample.channel
                );
            }

            // Tenta enviar ao servidor
            match send_batch(&mut stream, &frame_buffer).await {
                Ok(_) => {
                    // Sucesso — segue
                }
                Err(e) => {
                    warn!("❌ Erro ao enviar: {}. Salvando {} frames localmente...", e, frame_buffer.len());

                    match backup_to_sqlite(&db_pool, &frame_buffer, &device_id).await {
                        Ok(_) => {
                            total_backed_up += frame_buffer.len() as u64;
                            info!("💾 {} frames salvos no backup local", frame_buffer.len());
                        }
                        Err(e) => {
                            error!("❌ CRÍTICO: Falha ao salvar backup: {:?}", e);
                        }
                    }

                    // Sai do loop de envio para reconectar
                    break 'send_loop;
                }
            }
        }

        if !running.load(Ordering::Relaxed) {
            break;
        }

        warn!("⚠️  Conexão perdida. Reconectando em 1s...");
        sleep(Duration::from_secs(1)).await;
    }

    info!("📊 Resumo final — Enviados: {} | Backup local: {}", total_sent, total_backed_up);
    info!("👋 Telemetria Edge encerrada.");
    Ok(())
}