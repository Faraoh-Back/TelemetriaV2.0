use crate::protocol::TelemetryFrame;
use crate::scenarios::ScenarioSnapshot;
use crate::util::{clamp_i16, write_i16_le};

pub const INV_A: u32 = 0x18FF_0DEA;
pub const INV_B: u32 = 0x18FF_0EF7;

pub fn frames(snapshot: &ScenarioSnapshot, wall_ts: f64) -> Vec<TelemetryFrame> {
    let mut a = [0u8; 8];
    let mut b = [0u8; 8];

    write_i16_le(&mut a, 0, clamp_i16(snapshot.torque_a));
    write_i16_le(&mut a, 2, clamp_i16(snapshot.rpm_a));
    write_i16_le(&mut a, 4, clamp_i16(snapshot.torque_b));
    write_i16_le(&mut a, 6, clamp_i16(snapshot.rpm_b));

    write_i16_le(&mut b, 0, clamp_i16(snapshot.torque_a + 2.0));
    write_i16_le(&mut b, 2, clamp_i16(snapshot.rpm_a + 5.0));
    write_i16_le(&mut b, 4, clamp_i16(snapshot.torque_b + 2.0));
    write_i16_le(&mut b, 6, clamp_i16(snapshot.rpm_b + 5.0));

    vec![
        TelemetryFrame::new(INV_A, wall_ts, a),
        TelemetryFrame::new(INV_B, wall_ts, b),
    ]
}
