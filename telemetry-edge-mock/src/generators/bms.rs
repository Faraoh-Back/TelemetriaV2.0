use crate::protocol::TelemetryFrame;
use crate::scenarios::ScenarioSnapshot;

pub const BMS_OVERALL: u32 = 0x19B5_0001;
pub const BMS_TEMP_OVERALL: u32 = 0x19B5_0008;
pub const BMS_VOLT_1: u32 = 0x19B5_000B;
pub const BMS_CELL_TEMP: u32 = 0x19B5_000E;

pub fn frames(snapshot: &ScenarioSnapshot, wall_ts: f64) -> Vec<TelemetryFrame> {
    let mut out = Vec::with_capacity(4);
    let cell_a = ((snapshot.cell_v_min - 2.0) * 100.0)
        .round()
        .clamp(0.0, 255.0) as u8;
    let cell_b = ((snapshot.cell_v_max - 2.0) * 100.0)
        .round()
        .clamp(0.0, 255.0) as u8;
    let cell_avg = (((snapshot.cell_v_min + snapshot.cell_v_max) * 0.5 - 2.0) * 100.0)
        .round()
        .clamp(0.0, 255.0) as u8;
    let temp_min = (snapshot.cell_temp_max - 2.0 + 100.0)
        .round()
        .clamp(0.0, 255.0) as u8;
    let temp_max = (snapshot.cell_temp_max + 100.0)
        .round()
        .clamp(0.0, 255.0) as u8;
    let temp_avg = (snapshot.cell_temp_max - 1.0 + 100.0)
        .round()
        .clamp(0.0, 255.0) as u8;

    out.push(simple_bytes(
        BMS_OVERALL,
        wall_ts,
        [cell_a, cell_b, cell_avg, 0x00, 0x00, 0x00, 0x00, 0x00],
    ));
    out.push(simple_bytes(
        BMS_TEMP_OVERALL,
        wall_ts,
        [temp_min, temp_max, temp_avg, 0x00, 0x00, 0x00, 0x00, 0x00],
    ));
    out.push(repeated(BMS_VOLT_1, wall_ts, cell_a));
    out.push(repeated(BMS_CELL_TEMP, wall_ts, temp_max));
    out
}

fn simple_bytes(can_id: u32, wall_ts: f64, data: [u8; 8]) -> TelemetryFrame {
    TelemetryFrame::new(can_id, wall_ts, data)
}

fn repeated(can_id: u32, wall_ts: f64, byte: u8) -> TelemetryFrame {
    TelemetryFrame::new(can_id, wall_ts, [byte; 8])
}
