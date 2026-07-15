use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let heat = (1.0 - (-t / 180.0).exp()).clamp(0.0, 1.0);
    let ripple = (t * 0.2).sin();
    s.aps_perc = 12.0 + 5.0 * ripple;
    s.brake = 0.0;
    s.vcu_state = 3;
    s.torque_a = 8.0 + 4.0 * ripple;
    s.torque_b = 7.5 + 4.0 * ripple;
    s.rpm_a = 1200.0 + 50.0 * ripple;
    s.rpm_b = 1180.0 + 45.0 * ripple;
    s.accel_x = 0.15;
    s.accel_y = 0.05 * ripple;
    s.accel_z = 0.99;
    s.speed_x = 5.0;
    s.cell_v_min = 3.92 - 0.01 * heat;
    s.cell_v_max = 3.97 - 0.005 * heat;
    s.cell_temp_max = 29.0 + 12.0 * heat;
    s.motor_temp_a = 31.0 + 16.0 * heat;
    s.motor_temp_b = 31.5 + 15.0 * heat;
    s.coolant_temp = 27.0 + 11.0 * heat;
    s.coolant_pressure = 1.4 + 0.15 * heat;
    s.coolant_flow = 9.0 - 1.6 * heat;
    s
}
