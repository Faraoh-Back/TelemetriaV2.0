use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let pulse = if (t * 0.15).sin() > 0.35 { 1.0 } else { 0.0 };
    s.aps_perc = 26.0 * (1.0 - pulse);
    s.brake = pulse;
    s.vcu_state = 3;
    s.torque_a = 18.0 * (1.0 - pulse);
    s.torque_b = 16.0 * (1.0 - pulse);
    s.rpm_a = 2200.0 * (1.0 - 0.7 * pulse);
    s.rpm_b = 2180.0 * (1.0 - 0.7 * pulse);
    s.accel_x = if pulse > 0.5 { -1.4 } else { 0.3 };
    s.accel_y = 0.15;
    s.speed_x = 22.0 - 12.0 * pulse;
    s.cell_v_min = 3.91;
    s.cell_v_max = 3.96;
    s.cell_temp_max = 31.0;
    s.motor_temp_a = 33.0;
    s.motor_temp_b = 33.0;
    s.coolant_temp = 28.0;
    s.coolant_pressure = 1.5;
    s.coolant_flow = 8.8;
    s
}
