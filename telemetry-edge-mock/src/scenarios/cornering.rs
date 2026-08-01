use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let phase = t * 0.85;
    let lat = phase.sin();
    let long = (phase * 0.5).cos();
    let speed = 18.0 + 2.0 * long;

    // Gear ratio FSE: RPM = speed × 432.3
    let gear_rpm = speed * 432.3;

    s.aps_perc = 42.0 + 10.0 * long;
    s.brake = 0.0;
    s.vcu_state = 3;
    s.torque_a = 74.0 + 9.0 * long;
    s.torque_b = 71.0 + 8.0 * long;
    s.rpm_a = gear_rpm + 120.0 * long;
    s.rpm_b = gear_rpm - 40.0 + 100.0 * long;
    s.accel_x = (0.9 + 0.15 * long).clamp(-1.6, 1.2);
    s.accel_y = (1.8 * lat).clamp(-1.8, 1.8);
    s.accel_z = 9.81;
    s.yaw_rate = 0.35 * lat;
    s.speed_x = speed;
    s.speed_y = 0.3 * lat;
    s.cell_v_min = 4.06 - 0.06 * long.abs();
    s.cell_v_max = 4.10 - 0.03 * long.abs();
    s.cell_temp_max = 33.0 + 4.0 * long.abs();
    s.motor_temp_a = 40.0 + 5.0 * long.abs();
    s.motor_temp_b = 40.5 + 5.0 * long.abs();
    s.coolant_temp = 31.0 + 2.5 * long.abs();
    s.coolant_pressure = 1.45 + 0.05 * lat.abs();
    s.coolant_flow = 9.5 + 0.4 * long;
    s
}
