use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let pulse = if (t * 0.15).sin() > 0.35 { 1.0 } else { 0.0 };
    let speed = 22.0 - 12.0 * pulse;

    // Gear ratio FSE: RPM = speed × 432.3
    let gear_rpm = speed * 432.3;

    s.aps_perc = 26.0 * (1.0 - pulse);
    s.brake = pulse;
    s.vcu_state = 3;
    // Torque negativo durante frenagem = frenagem regenerativa
    s.torque_a = if pulse > 0.5 { -25.0 } else { 18.0 };
    s.torque_b = if pulse > 0.5 { -22.0 } else { 16.0 };
    s.rpm_a = gear_rpm + 50.0;
    s.rpm_b = gear_rpm;
    // Desaceleração de -1.6g durante frenagem
    s.accel_x = if pulse > 0.5 { -1.6 } else { 0.3 };
    s.accel_y = 0.15;
    s.accel_z = 9.81;
    s.speed_x = speed;
    s.cell_v_min = 4.05 + 0.04 * pulse; // Regen sobe voltagem levemente
    s.cell_v_max = 4.10 + 0.02 * pulse;
    s.cell_temp_max = 32.0 + 3.0 * pulse;
    s.motor_temp_a = 38.0 + 4.0 * pulse;
    s.motor_temp_b = 38.0 + 3.5 * pulse;
    s.coolant_temp = 30.0 + 2.0 * pulse;
    s.coolant_pressure = 1.5;
    s.coolant_flow = 9.5 - 0.5 * pulse;
    s
}
