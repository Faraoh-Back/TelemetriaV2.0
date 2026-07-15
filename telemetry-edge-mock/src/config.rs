use clap::{Parser, ValueEnum};

#[derive(Parser, Debug, Clone)]
#[command(
    name = "telemetry-edge-mock",
    about = "Mock standalone da Jetson para Telemetria V2.2"
)]
pub struct MockConfig {
    #[arg(long, default_value = "127.0.0.1:8080")]
    pub server: String,

    #[arg(long, default_value = "car_mock_001")]
    pub device_id: String,

    #[arg(long, default_value = "assets/dbc")]
    pub dbc_dir: String,

    #[arg(long, value_enum, default_value_t = ScenarioKind::SimpleEnduro)]
    pub scenario: ScenarioKind,

    #[arg(long, default_value_t = 12345)]
    pub seed: u64,

    #[arg(long, default_value_t = 100.0)]
    pub bms_hz: f64,

    #[arg(long, default_value_t = 100.0)]
    pub ins_hz: f64,

    #[arg(long, default_value_t = 50.0)]
    pub vcu_hz: f64,

    #[arg(long, default_value_t = 50.0)]
    pub inverter_hz: f64,

    #[arg(long)]
    pub duration_secs: Option<f64>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum ScenarioKind {
    Idle,
    Drive,
    Braking,
    Cornering,
    Thermal,
    SimpleEnduro,
}

impl ScenarioKind {
    pub fn label(self) -> &'static str {
        match self {
            ScenarioKind::Idle => "idle",
            ScenarioKind::Drive => "drive",
            ScenarioKind::Braking => "braking",
            ScenarioKind::Cornering => "cornering",
            ScenarioKind::Thermal => "thermal",
            ScenarioKind::SimpleEnduro => "simple-enduro",
        }
    }
}
