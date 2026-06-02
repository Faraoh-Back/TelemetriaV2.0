pub const TCP_PORT: u16 = 8080;
pub const HTTP_WS_PORT: u16 = 8081;
pub const SQLITE_PATH: &str = "sqlite:./data/historico.db";
pub const CSV_DATA_PATH: &str = "./csv_data";
pub const DBC_DATA_PATH: &str = "./dbc_data";
pub const MAX_PG_CONNECTIONS: u32 = 20;
pub const JWT_EXPIRY_HOURS: i64 = 8;
pub const NTP_PORT: u16 = 9999;
// Calibracao oficial do veiculo para converter RPM do motor em m/s.
// Mantem os parametros fisicos informados pela direcao tecnica; nao substituir
// pela formula antiga sem nova validacao do conjunto mecanico.
pub const RPM_MOTOR_TO_MPS: f64 = 0.0381;
pub const RPM_CORRECTION_WEIGHT: f64 = 0.05;

pub fn get_pg_url() -> String {
    let password = std::env::var("DB_PASSWORD").expect("❌ DB_PASSWORD não definida no .env");
    format!("postgres://eracing:{}@localhost/telemetria", password)
}

pub fn get_jwt_secret() -> String {
    std::env::var("JWT_SECRET").expect("❌ JWT_SECRET não definida no .env")
}
