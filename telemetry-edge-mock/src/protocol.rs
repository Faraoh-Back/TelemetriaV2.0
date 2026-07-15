use std::time::{SystemTime, UNIX_EPOCH};

pub const CAN_PAYLOAD_LEN: usize = 20;
pub const TCP_FRAME_LEN: usize = 24;

#[derive(Clone, Debug)]
pub struct TelemetryFrame {
    pub can_id: u32,
    pub timestamp: f64,
    pub data: [u8; 8],
}

impl TelemetryFrame {
    pub fn new(can_id: u32, timestamp: f64, data: [u8; 8]) -> Self {
        Self {
            can_id,
            timestamp,
            data,
        }
    }

    pub fn encode(&self) -> [u8; TCP_FRAME_LEN] {
        let mut buf = [0u8; TCP_FRAME_LEN];
        buf[0..4].copy_from_slice(&(CAN_PAYLOAD_LEN as u32).to_le_bytes());
        buf[4..8].copy_from_slice(&self.can_id.to_le_bytes());
        buf[8..16].copy_from_slice(&self.timestamp.to_le_bytes());
        buf[16..24].copy_from_slice(&self.data);
        buf
    }
}

pub fn now_unix_f64() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
