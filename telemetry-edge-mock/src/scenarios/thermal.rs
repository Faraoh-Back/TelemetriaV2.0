use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    let heat = (1.0 - (-t / 180.0).exp()).clamp(0.0, 1.0);
    let ripple = (t * 0.2).sin();
    let speed = 5.0 + 2.0 * ripple.abs();

    // Gear ratio FSE: RPM = speed × 432.3
    let gear_rpm = speed * 432.3;

    s.aps_perc = 12.0 + 5.0 * ripple;
    s.brake = 0.0;
    s.vcu_state = 3;
    s.torque_a = 8.0 + 4.0 * ripple;
    s.torque_b = 7.5 + 4.0 * ripple;
    s.rpm_a = gear_rpm + 30.0 * ripple;
    s.rpm_b = gear_rpm - 10.0 + 25.0 * ripple;
    s.accel_x = 0.15;
    s.accel_y = 0.05 * ripple;
    s.accel_z = 9.81;
    s.speed_x = speed;
    // Voltagem degrada com calor (resistência interna sobe)
    s.cell_v_min = 4.08 - 0.10 * heat;
    s.cell_v_max = 4.12 - 0.06 * heat;
    // Temp célula até 55°C (abaixo do shutdown FSAE de 60°C)
    s.cell_temp_max = 30.0 + 25.0 * heat;
    // Motor até 75°C sob carga contínua
    s.motor_temp_a = 32.0 + 43.0 * heat;
    s.motor_temp_b = 32.5 + 42.0 * heat;
    s.coolant_temp = 28.0 + 18.0 * heat;
    s.coolant_pressure = 1.4 + 0.20 * heat;
    s.coolant_flow = 9.0 - 2.0 * heat;
    s
}
