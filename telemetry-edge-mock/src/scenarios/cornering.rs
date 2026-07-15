use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let phase = t * 0.85;
    let lat = phase.sin();
    let long = (phase * 0.5).cos();
    s.aps_perc = 42.0 + 10.0 * long;
    s.brake = 0.0;
    s.vcu_state = 3;
    s.torque_a = 74.0 + 9.0 * long;
    s.torque_b = 71.0 + 8.0 * long;
    s.rpm_a = 2400.0 + 210.0 * long;
    s.rpm_b = 2380.0 + 180.0 * long;
    s.accel_x = 0.9 + 0.15 * long;
    s.accel_y = 1.3 * lat;
    s.accel_z = 0.94;
    s.yaw_rate = 0.28 * lat;
    s.speed_x = 18.0 + 2.0 * long;
    s.speed_y = 0.3 * lat;
    s.cell_v_min = 3.90 - 0.02 * long.abs();
    s.cell_v_max = 3.96 - 0.01 * long.abs();
    s.cell_temp_max = 30.0 + 2.0 * long.abs();
    s.motor_temp_a = 34.0 + 1.5 * long.abs();
    s.motor_temp_b = 34.5 + 1.5 * long.abs();
    s.coolant_temp = 28.0 + 0.8 * long.abs();
    s.coolant_pressure = 1.45 + 0.03 * lat.abs();
    s.coolant_flow = 9.2 + 0.2 * long;
    s
}
