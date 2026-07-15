use crate::config::MockConfig;
use crate::generators;
use crate::protocol::now_unix_f64;
use crate::protocol::TelemetryFrame;
use crate::scenarios;
use std::time::Instant;
use tokio::sync::mpsc;

pub async fn run(cfg: MockConfig) {
    let (tx, rx) = mpsc::channel::<TelemetryFrame>(4096);
    let transport_cfg = cfg.clone();
    tokio::spawn(async move {
        crate::transport::run(transport_cfg, rx).await;
    });

    let start = Instant::now();
    spawn_family_loop(
        "bms",
        cfg.bms_hz,
        cfg.clone(),
        tx.clone(),
        start,
        family_bms,
    );
    spawn_family_loop(
        "vcu",
        cfg.vcu_hz,
        cfg.clone(),
        tx.clone(),
        start,
        family_vcu,
    );
    spawn_family_loop(
        "inversor",
        cfg.inverter_hz,
        cfg.clone(),
        tx.clone(),
        start,
        family_inversor,
    );
    spawn_family_loop(
        "ins",
        cfg.ins_hz,
        cfg.clone(),
        tx.clone(),
        start,
        family_ins,
    );

    if let Some(duration) = cfg.duration_secs {
        tokio::time::sleep(std::time::Duration::from_secs_f64(duration)).await;
        tracing::info!("⏹️ duração finalizada, mock encerrando");
        return;
    }

    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("⏹️ ctrl-c recebido, mock encerrando");
}

fn spawn_family_loop(
    name: &'static str,
    hz: f64,
    cfg: MockConfig,
    tx: mpsc::Sender<TelemetryFrame>,
    start: Instant,
    build: fn(&MockConfig, f64, f64) -> Vec<TelemetryFrame>,
) {
    let period = std::time::Duration::from_secs_f64((1.0 / hz.max(1.0)).max(0.001));
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(period);
        loop {
            interval.tick().await;
            let t = start.elapsed().as_secs_f64();
            if let Some(limit) = cfg.duration_secs {
                if t > limit {
                    break;
                }
            }

            let wall_ts = now_unix_f64();
            let frames = build(&cfg, t, wall_ts);
            for frame in frames {
                if tx.send(frame).await.is_err() {
                    tracing::warn!("⚠️ canal fechado para {}", name);
                    return;
                }
            }
        }
    });
}

fn build_snapshot(cfg: &MockConfig, t: f64) -> scenarios::ScenarioSnapshot {
    scenarios::snapshot(cfg.scenario, t, cfg.seed)
}

fn family_bms(cfg: &MockConfig, t: f64, wall_ts: f64) -> Vec<TelemetryFrame> {
    let snap = build_snapshot(cfg, t);
    generators::bms::frames(&snap, wall_ts)
}

fn family_vcu(cfg: &MockConfig, t: f64, wall_ts: f64) -> Vec<TelemetryFrame> {
    let snap = build_snapshot(cfg, t);
    generators::vcu::frames(&snap, wall_ts)
}

fn family_inversor(cfg: &MockConfig, t: f64, wall_ts: f64) -> Vec<TelemetryFrame> {
    let snap = build_snapshot(cfg, t);
    generators::inversor::frames(&snap, wall_ts)
}

fn family_ins(cfg: &MockConfig, t: f64, wall_ts: f64) -> Vec<TelemetryFrame> {
    let snap = build_snapshot(cfg, t);
    generators::ins::frames(&snap, wall_ts)
}
