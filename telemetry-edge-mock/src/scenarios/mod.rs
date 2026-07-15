use crate::config::ScenarioKind;

pub mod braking;
pub mod cornering;
pub mod drive;
pub mod idle;
pub mod simple_enduro;
pub mod thermal;

#[derive(Clone, Debug)]
pub struct ScenarioSnapshot {
    pub t: f64,
    pub aps_perc: f64,
    pub brake: f64,
    pub hv_on: bool,
    pub vcu_state: u8,
    pub torque_a: f64,
    pub torque_b: f64,
    pub rpm_a: f64,
    pub rpm_b: f64,
    pub accel_x: f64,
    pub accel_y: f64,
    pub accel_z: f64,
    pub yaw_rate: f64,
    pub speed_x: f64,
    pub speed_y: f64,
    pub cell_v_min: f64,
    pub cell_v_max: f64,
    pub cell_temp_max: f64,
    pub motor_temp_a: f64,
    pub motor_temp_b: f64,
    pub coolant_temp: f64,
    pub coolant_pressure: f64,
    pub coolant_flow: f64,
}

impl ScenarioSnapshot {
    pub fn nominal(t: f64) -> Self {
        Self {
            t,
            aps_perc: 0.0,
            brake: 0.0,
            hv_on: true,
            vcu_state: 1,
            torque_a: 0.0,
            torque_b: 0.0,
            rpm_a: 0.0,
            rpm_b: 0.0,
            accel_x: 0.0,
            accel_y: 0.0,
            accel_z: 1.0,
            yaw_rate: 0.0,
            speed_x: 0.0,
            speed_y: 0.0,
            cell_v_min: 3.94,
            cell_v_max: 3.98,
            cell_temp_max: 29.0,
            motor_temp_a: 31.0,
            motor_temp_b: 31.0,
            coolant_temp: 27.0,
            coolant_pressure: 1.4,
            coolant_flow: 9.0,
        }
    }
}

pub fn snapshot(kind: ScenarioKind, t: f64, seed: u64) -> ScenarioSnapshot {
    match kind {
        ScenarioKind::Idle => idle::snapshot(t, seed),
        ScenarioKind::Drive => drive::snapshot(t, seed),
        ScenarioKind::Braking => braking::snapshot(t, seed),
        ScenarioKind::Cornering => cornering::snapshot(t, seed),
        ScenarioKind::Thermal => thermal::snapshot(t, seed),
        ScenarioKind::SimpleEnduro => simple_enduro::snapshot(t, seed),
    }
}
