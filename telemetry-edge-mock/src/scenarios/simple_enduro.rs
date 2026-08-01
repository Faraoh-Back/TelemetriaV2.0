use super::ScenarioSnapshot;
use std::f64::consts::PI;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);

    // Ciclo fechado: oval com pequenas ondulações para parecer uma pista de
    // enduro simples e ainda manter fechamento de volta.
    let lap_time = 48.0_f64;
    let phase = (t / lap_time) * 2.0 * PI;
    let theta = phase.rem_euclid(2.0 * PI);

    // Elipse base + leve modulação para simular um traçado menos perfeito.
    let a = 42.0;
    let b = 24.0;
    let wobble = 2.5 * (2.0 * theta).sin();
    let x = (a + wobble) * theta.cos();
    let y = (b + 0.7 * wobble) * theta.sin();

    let dtheta_dt = 2.0 * PI / lap_time;
    let dx_dtheta = -(a + wobble) * theta.sin() + 2.5 * (2.0 * theta).cos() * theta.cos()
        - 2.5 * (2.0 * theta).sin() * theta.sin();
    let dy_dtheta = (b + 0.7 * wobble) * theta.cos()
        + 0.7 * 2.5 * (2.0 * theta).cos() * theta.sin()
        + 0.7 * 2.5 * (2.0 * theta).sin() * theta.cos();

    // Velocidade tangencial aproximada na curva.
    let speed_geo = ((dx_dtheta * dtheta_dt).powi(2) + (dy_dtheta * dtheta_dt).powi(2)).sqrt();
    let speed = (14.0 + 4.5 * (theta * 3.0).sin() + 1.2 * (theta * 7.0).sin()).clamp(6.0, 24.0);
    let speed_scale = speed / speed_geo.max(1.0);

    // Derivadas de segunda ordem aproximadas para obter aceleração coerente.
    let ddx_dtheta2 = -(a + wobble) * theta.cos()
        - 4.0 * 2.5 * (2.0 * theta).sin() * theta.cos()
        - 4.0 * 2.5 * (2.0 * theta).cos() * theta.sin()
        + 4.0 * 2.5 * (2.0 * theta).sin() * theta.sin();
    let ddy_dtheta2 = -(b + 0.7 * wobble) * theta.sin()
        + 1.4 * 2.5 * (2.0 * theta).cos() * theta.cos()
        + 1.4 * 2.5 * (2.0 * theta).sin() * theta.sin()
        - 1.4 * 2.5 * (2.0 * theta).cos() * theta.sin();

    let vx = dx_dtheta * dtheta_dt * speed_scale;
    let vy = dy_dtheta * dtheta_dt * speed_scale;
    let ax = ddx_dtheta2 * dtheta_dt * dtheta_dt * speed_scale;
    let ay = ddy_dtheta2 * dtheta_dt * dtheta_dt * speed_scale;

    let heading = vy.atan2(vx);
    let speed_mag = (vx * vx + vy * vy).sqrt().max(0.1);
    let yaw_rate = (vx * ay - vy * ax) / speed_mag.powi(2);

    let cos_h = heading.cos();
    let sin_h = heading.sin();
    let acc_long = ax * cos_h + ay * sin_h;
    let acc_lat = -ax * sin_h + ay * cos_h;

    // --- Gear ratio FSE: G=11.5, wheel R=0.254m ---
    // RPM = speed × G / (2π × R) × 60 ≈ speed × 432.3
    let gear_rpm = speed * 432.3;

    s.aps_perc = 18.0 + 52.0 * (0.5 + 0.5 * (theta * 2.5).sin()).clamp(0.0, 1.0);
    s.brake = if (theta > 1.9 && theta < 2.15) || (theta > 5.0 && theta < 5.25) {
        1.0
    } else {
        0.0
    };
    s.vcu_state = 3;
    s.hv_on = true;

    let throttle = s.aps_perc / 100.0;
    s.torque_a = 18.0 + 85.0 * throttle + 10.0 * acc_long.max(0.0);
    s.torque_b = 17.0 + 82.0 * throttle + 8.0 * acc_long.max(0.0);
    s.rpm_a = gear_rpm + 80.0 * throttle;
    s.rpm_b = gear_rpm - 20.0 + 60.0 * throttle;
    s.accel_x = (acc_long).clamp(-1.6, 1.2);
    s.accel_y = (acc_lat).clamp(-1.8, 1.8);
    s.accel_z = 9.81;
    s.yaw_rate = yaw_rate;
    s.speed_x = speed;
    s.speed_y = 0.0;
    // Descarga: 4.12V full → voltage sag proporcional ao throttle
    let discharge_frac = (t / (lap_time * 22.0)).clamp(0.0, 1.0); // ~22 voltas para depletar
    s.cell_v_min = 4.10 - 0.80 * discharge_frac - 0.12 * throttle;
    s.cell_v_max = 4.12 - 0.72 * discharge_frac - 0.06 * throttle;
    s.cell_temp_max = 30.0 + 18.0 * discharge_frac + 5.0 * throttle + 2.0 * s.brake;
    s.motor_temp_a = 32.0 + 30.0 * discharge_frac + 8.0 * throttle + 3.0 * s.brake;
    s.motor_temp_b = 32.5 + 29.0 * discharge_frac + 8.5 * throttle + 3.0 * s.brake;
    s.coolant_temp = 28.0 + 14.0 * discharge_frac + 4.0 * throttle + 1.0 * s.brake;
    s.coolant_pressure = 1.40 + 0.25 * throttle;
    s.coolant_flow = 9.0 + 1.5 * throttle - 0.3 * s.brake;

    // Guarda o fechamento do loop no padrão da volta.
    let _ = (x, y);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_enduro_emits_body_frame_velocity() {
        for t in [0.0, 6.0, 12.0, 24.0, 36.0, 48.0] {
            let snapshot = snapshot(t, 12345);

            assert!(snapshot.speed_x > 0.0);
            assert!(snapshot.speed_x <= 24.0);
            assert!(snapshot.speed_y.abs() < 1e-9);
        }
    }
}
