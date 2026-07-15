mod config;
mod dbc;
mod generators;
mod protocol;
mod runtime;
mod scenarios;
mod transport;
mod util;

use clap::Parser;
use config::MockConfig;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = MockConfig::parse();

    tracing::info!(
        "🚗 telemetry-edge-mock iniciado | scenario={} | server={} | dbc_dir={}",
        cfg.scenario.label(),
        cfg.server,
        cfg.dbc_dir
    );

    dbc::load_manifest(&cfg.dbc_dir);
    runtime::run(cfg).await;
}
