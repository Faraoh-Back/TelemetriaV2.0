use crate::protocol::TelemetryFrame;
use crate::scenarios::ScenarioSnapshot;
use crate::util::clamp_i16;

pub const INS_01: u32 = 0x0000_0001;
pub const INS_02: u32 = 0x0000_0002;

pub fn frames(snapshot: &ScenarioSnapshot, wall_ts: f64) -> Vec<TelemetryFrame> {
    let mut a = [0u8; 8];
    let mut b = [0u8; 8];

    pack_pair(
        &mut a,
        snapshot.accel_x,
        0.0,
        snapshot.accel_y,
        0.0,
    );
    pack_pair(
        &mut b,
        snapshot.accel_z,
        snapshot.yaw_rate,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn unpack_i16(data: &[u8], start: usize) -> f64 {
        i16::from_le_bytes([data[start], data[start + 1]]) as f64 / 100.0
    }

    #[test]
    fn ins_02_packs_yaw_rate_without_scaling() {
        let mut snapshot = ScenarioSnapshot::nominal(0.0);
        snapshot.accel_z = 0.98;
        snapshot.yaw_rate = 1.24;
        snapshot.speed_x = 12.5;
        snapshot.speed_y = -0.4;

        let frames = frames(&snapshot, 10.0);
        let ins_02 = frames
            .iter()
            .find(|frame| frame.can_id == INS_02)
            .expect("INS_02 frame");

        assert_eq!(unpack_i16(&ins_02.data, 2), 1.24);
        assert_eq!(unpack_i16(&ins_02.data, 4), 12.5);
        assert_eq!(unpack_i16(&ins_02.data, 6), -0.4);
    }
}
