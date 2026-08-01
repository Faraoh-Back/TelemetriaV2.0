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

    // Gear ratio FSE: RPM = speed × 432.3
    let speed = 8.0 + 24.0 * throttle;
    let gear_rpm = speed * 432.3;
    s.rpm_a = gear_rpm + 100.0 * ripple;
    s.rpm_b = gear_rpm - 30.0 + 80.0 * ripple;

    s.accel_x = (0.45 + 0.75 * throttle).clamp(-1.6, 1.2);
    s.accel_y = 0.08 * ripple;
    s.accel_z = 9.81;
    s.yaw_rate = 0.05 * ripple;
    s.speed_x = speed;
    s.speed_y = 0.4 * ripple;

    // Voltagens com sag sob carga
    s.cell_v_min = 4.08 - 0.15 * throttle;
    s.cell_v_max = 4.12 - 0.08 * throttle;
    s.cell_temp_max = 30.0 + 8.0 * throttle;
    s.motor_temp_a = 32.0 + 15.0 * throttle;
    s.motor_temp_b = 32.5 + 14.0 * throttle;
    s.coolant_temp = 28.0 + 6.0 * throttle;
    s.coolant_pressure = 1.4 + 0.25 * throttle;
    s.coolant_flow = 9.0 + 1.2 * throttle;
    s
}
