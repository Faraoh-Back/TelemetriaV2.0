use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let throttle = (0.5 + 0.5 * (t * 0.65).sin()).clamp(0.0, 1.0);
    let ripple = (t * 6.0).sin();
    s.aps_perc = 18.0 + 58.0 * throttle;
    s.brake = if t % 12.0 > 9.0 { 1.0 } else { 0.0 };
    s.vcu_state = 3;
    s.torque_a = 12.0 + 115.0 * throttle + 8.0 * ripple;
    s.torque_b = 10.0 + 108.0 * throttle + 6.0 * ripple;
    s.rpm_a = 1400.0 + 2100.0 * throttle + 160.0 * ripple;
    s.rpm_b = 1350.0 + 2080.0 * throttle + 120.0 * ripple;
    s.accel_x = 0.45 + 0.55 * throttle;
    s.accel_y = 0.06 * ripple;
    s.accel_z = 0.98;
    s.yaw_rate = 0.05 * ripple;
    s.speed_x = 8.0 + 24.0 * throttle;
    s.speed_y = 0.4 * ripple;
    s.cell_v_min = 3.90 - 0.04 * throttle;
    s.cell_v_max = 3.97 - 0.02 * throttle;
    s.cell_temp_max = 29.0 + 4.0 * throttle;
    s.motor_temp_a = 31.0 + 5.0 * throttle;
    s.motor_temp_b = 31.5 + 5.5 * throttle;
    s.coolant_temp = 27.0 + 2.5 * throttle;
    s.coolant_pressure = 1.4 + 0.2 * throttle;
    s.coolant_flow = 9.0 + 0.6 * throttle;
    s
}
