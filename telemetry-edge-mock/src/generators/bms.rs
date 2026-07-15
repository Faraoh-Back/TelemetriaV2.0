use crate::protocol::TelemetryFrame;
use crate::scenarios::ScenarioSnapshot;

pub const BMS_OVERALL: u32 = 0x19B5_0000;
pub const BMS_VOLT_1: u32 = 0x19B5_0001;
pub const BMS_CELL_TEMP: u32 = 0x19B5_0002;
pub const BMS_BAL_RATE: u32 = 0x19B5_0003;
pub const BMS_CELL_TEMP_OVERALL: u32 = 0x19B5_0008;
pub const BMS_VOLT_2: u32 = 0x19B5_0009;
pub const BMS_VOLT_A1: u32 = 0x19B5_0200;
pub const BMS_VOLT_A2: u32 = 0x19B5_0201;
pub const BMS_TEMP_A1: u32 = 0x19B5_0300;
pub const BMS_TEMP_A2: u32 = 0x19B5_0301;
pub const BMS_SOC: u32 = 0x19B5_0500;
pub const BMS_ENERGY: u32 = 0x19B5_0600;
pub const BMS_VOLT_A2_TAIL: u32 = 0x19B5_0801;

pub fn frames(snapshot: &ScenarioSnapshot, wall_ts: f64) -> Vec<TelemetryFrame> {
    let mut out = Vec::with_capacity(13);
    let t = snapshot.t;
    let cell_a = ((snapshot.cell_v_min * 100.0).round() as u8).max(180);
    let cell_b = ((snapshot.cell_v_max * 100.0).round() as u8).max(180);
    let temp = ((snapshot.cell_temp_max + 40.0).round() as u8).max(1);

    out.push(simple_bytes(
        BMS_OVERALL,
        wall_ts,
        [0x00, 0x00, 0x00, 0x00, cell_a, cell_b, temp, 0x00],
    ));
    out.push(repeated(BMS_VOLT_1, wall_ts, cell_a));
    out.push(repeated(BMS_CELL_TEMP, wall_ts, temp));
    out.push(simple_bytes(
        BMS_BAL_RATE,
        t,
        [0x08, 0x00, 0x08, 0x00, 0x04, 0x00, 0x04, 0x00],
    ));
    out.push(repeated(
        BMS_CELL_TEMP_OVERALL,
        wall_ts,
        temp.saturating_add(2),
    ));
    out.push(simple_bytes(
        BMS_VOLT_2,
        wall_ts,
        [0x00, 0x00, 0x00, 0x00, cell_b, cell_b, temp, 0x00],
    ));
    out.push(repeated(BMS_VOLT_A1, wall_ts, cell_a));
    out.push(repeated(BMS_VOLT_A2, wall_ts, cell_b));
    out.push(repeated(BMS_TEMP_A1, wall_ts, temp));
    out.push(repeated(BMS_TEMP_A2, wall_ts, temp.saturating_add(1)));
    out.push(simple_bytes(
        BMS_SOC,
        wall_ts,
        [
            clamp_soc(snapshot.cell_v_min),
            clamp_soc(snapshot.cell_v_max),
            0x00,
            0x00,
            0x50,
            0x00,
            0x40,
            0x00,
        ],
    ));
    out.push(simple_bytes(
        BMS_ENERGY,
        wall_ts,
        [0x20, 0x00, 0x10, 0x00, 0x08, 0x00, 0x04, 0x00],
    ));
    out.push(repeated(
        BMS_VOLT_A2_TAIL,
        wall_ts,
        cell_b.saturating_sub(1),
    ));
    out
}

fn clamp_soc(value: f64) -> u8 {
    let pct = ((value - 3.5) * 250.0).clamp(0.0, 100.0);
    pct.round() as u8
}

fn simple_bytes(can_id: u32, wall_ts: f64, data: [u8; 8]) -> TelemetryFrame {
    TelemetryFrame::new(can_id, wall_ts, data)
}

fn repeated(can_id: u32, wall_ts: f64, byte: u8) -> TelemetryFrame {
    TelemetryFrame::new(can_id, wall_ts, [byte; 8])
}
