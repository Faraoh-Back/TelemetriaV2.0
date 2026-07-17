use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedSignal {
    pub timestamp: f64,
    pub device_id: String,
    pub can_id: u32,
    pub signal_name: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    #[serde(default = "crate::auth::default_member_role")]
    pub role: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub iat: i64,
    pub exp: i64,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct CollectionStartRequest {
    pub requested_at: Option<String>,
}

#[derive(Deserialize)]
pub struct CollectionStopRequest {
    pub requested_at: Option<String>,
    pub log_name: Option<String>,
    pub log_start_unix: Option<f64>,
    pub log_stop_unix: Option<f64>,
}

#[derive(Deserialize)]
pub struct LogSessionBoundsRequest {
    pub log_name: Option<String>,
    pub log_start_unix: f64,
    pub log_stop_unix: f64,
}

