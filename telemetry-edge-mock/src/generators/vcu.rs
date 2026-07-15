use crate::protocol::TelemetryFrame;
use crate::scenarios::ScenarioSnapshot;

pub const VCU_OUT: u32 = 0x18FF_1515;

pub fn frames(snapshot: &ScenarioSnapshot, wall_ts: f64) -> Vec<TelemetryFrame> {
    let mut data = [0u8; 8];
    data[0] = if snapshot.aps_perc > 1.0 { 1 } else { 0 };
    data[1] = if snapshot.hv_on { 1 } else { 0 };
    data[2] = if snapshot.brake > 0.5 { 1 } else { 0 };
    data[3] = snapshot.vcu_state;
    data[4] = snapshot.aps_perc.round().clamp(0.0, 100.0) as u8;
    data[5] = if snapshot.hv_on { 1 } else { 0 };
    data[6] = if snapshot.torque_a.abs() > 1.0 { 1 } else { 0 };
    data[7] = (snapshot.aps_perc / 2.0).round().clamp(0.0, 100.0) as u8;

    vec![TelemetryFrame::new(VCU_OUT, wall_ts, data)]
}
