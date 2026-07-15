use crate::protocol::TelemetryFrame;
use crate::scenarios::ScenarioSnapshot;
use crate::util::clamp_i16;

pub const INS_01: u32 = 0x8000_0001;
pub const INS_02: u32 = 0x8000_0002;

pub fn frames(snapshot: &ScenarioSnapshot, wall_ts: f64) -> Vec<TelemetryFrame> {
    let mut a = [0u8; 8];
    let mut b = [0u8; 8];

    pack_pair(
        &mut a,
        snapshot.accel_x,
        snapshot.yaw_rate,
        snapshot.accel_y,
        snapshot.speed_x,
    );
    pack_pair(
        &mut b,
        snapshot.accel_z,
        snapshot.yaw_rate * 0.5,
        snapshot.speed_x,
        snapshot.speed_y,
    );

    vec![
        TelemetryFrame::new(INS_01, wall_ts, a),
        TelemetryFrame::new(INS_02, wall_ts, b),
    ]
}

fn pack_pair(dst: &mut [u8; 8], v0: f64, v1: f64, v2: f64, v3: f64) {
    dst[0..2].copy_from_slice(&clamp_i16(v0 * 100.0).to_le_bytes());
    dst[2..4].copy_from_slice(&clamp_i16(v1 * 100.0).to_le_bytes());
    dst[4..6].copy_from_slice(&clamp_i16(v2 * 100.0).to_le_bytes());
    dst[6..8].copy_from_slice(&clamp_i16(v3 * 100.0).to_le_bytes());
}
