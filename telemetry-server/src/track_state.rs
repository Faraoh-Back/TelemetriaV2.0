use crate::config::{RPM_CORRECTION_WEIGHT, RPM_MOTOR_TO_MPS};
use crate::models::ProcessedSignal;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

pub struct RealtimeTrackState {
    configured_close_radius_m: Option<f64>,
    configured_min_lap_distance_m: Option<f64>,
    min_lap_time_sec: f64,
    max_map_points: usize,
    t0: Option<f64>,
    last_t: Option<f64>,
    heading_rad: f64,
    x_m: f64,
    y_m: f64,
    velocity_mps: f64,
    distance_m: f64,
    acc_x_mps2: Option<f64>,
    yaw_rate_rps: Option<f64>,
    speed_x_mps: Option<f64>,
    speed_y_mps: Option<f64>,
    rpm_a0: Option<f64>,
    rpm_b0: Option<f64>,
    rpm_a13: Option<f64>,
    rpm_b13: Option<f64>,
    learning_points: Vec<Point2>,
    map_points: Vec<Point2>,
    map_arc_m: Vec<f64>,
    map_len_m: f64,
    left_start_area: bool,
    map_sent: bool,
}

impl RealtimeTrackState {
    pub fn new() -> Self {
        let configured_close_radius_m =
            env_opt_f64("TRACK_CLOSE_RADIUS_M").map(|value| value.clamp(1.0, 50.0));
        let configured_min_lap_distance_m =
            env_opt_f64("TRACK_MIN_LAP_DISTANCE_M").map(|value| value.clamp(5.0, 5000.0));
        let min_lap_time_sec = env_f64("TRACK_MIN_LAP_SEC", 5.0).clamp(0.0, 120.0);

        Self {
            configured_close_radius_m,
            configured_min_lap_distance_m,
            min_lap_time_sec,
            max_map_points: 600,
            t0: None,
            last_t: None,
            heading_rad: 0.0,
            x_m: 0.0,
            y_m: 0.0,
            velocity_mps: 0.0,
            distance_m: 0.0,
            acc_x_mps2: None,
            yaw_rate_rps: None,
            speed_x_mps: None,
            speed_y_mps: None,
            rpm_a0: None,
            rpm_b0: None,
            rpm_a13: None,
            rpm_b13: None,
            learning_points: Vec::new(),
            map_points: Vec::new(),
            map_arc_m: Vec::new(),
            map_len_m: 0.0,
            left_start_area: false,
            map_sent: false,
        }
    }

    pub fn reset(&mut self) {
        self.t0 = None;
        self.last_t = None;
        self.heading_rad = 0.0;
        self.x_m = 0.0;
        self.y_m = 0.0;
        self.velocity_mps = 0.0;
        self.distance_m = 0.0;
        self.acc_x_mps2 = None;
        self.yaw_rate_rps = None;
        self.speed_x_mps = None;
        self.speed_y_mps = None;
        self.rpm_a0 = None;
        self.rpm_b0 = None;
        self.rpm_a13 = None;
        self.rpm_b13 = None;
        self.learning_points.clear();
        self.map_points.clear();
        self.map_arc_m.clear();
        self.map_len_m = 0.0;
        self.left_start_area = false;
        self.map_sent = false;
    }

    pub fn update(&mut self, signals: &[ProcessedSignal]) -> Vec<String> {
        if signals.is_empty() {
            return Vec::new();
        }

        let has_track_signal = signals
            .iter()
            .any(|signal| is_track_signal(signal.signal_name.trim()));
        if !has_track_signal {
            return Vec::new();
        }

        let timestamp = signals[0].timestamp;
        if self.t0.is_none() {
            self.t0 = Some(timestamp);
            self.last_t = Some(timestamp);
            for signal in signals {
                self.apply_signal(signal);
            }
            self.learning_points.push(Point2 { x: 0.0, y: 0.0 });
            return Vec::new();
        }

        for signal in signals {
            self.apply_signal(signal);
        }

        let Some(last_t) = self.last_t else {
            self.last_t = Some(timestamp);
            return Vec::new();
        };

        let dt = timestamp - last_t;
        if dt < 0.0 {
            self.reset();
            self.t0 = Some(timestamp);
            self.last_t = Some(timestamp);
            self.learning_points.push(Point2 { x: 0.0, y: 0.0 });
            return Vec::new();
        }

        self.last_t = Some(timestamp);
        if !(0.0..=1.0).contains(&dt) || dt == 0.0 {
            return Vec::new();
        }

        if let (Some(vx), Some(vy)) = (self.speed_x_mps, self.speed_y_mps) {
            self.velocity_mps = vx.hypot(vy);
            if self.velocity_mps > 1e-6 {
                self.heading_rad = vy.atan2(vx);
            }
            self.distance_m += self.velocity_mps * dt;
            self.x_m += vx * dt;
            self.y_m += vy * dt;
        } else {
            let rpm_speed = self.rpm_speed_mps();
            let acc_x = self.acc_x_mps2.unwrap_or(0.0);
            let predicted_speed = (self.velocity_mps + acc_x * dt).max(0.0);
            self.velocity_mps = if let Some(speed) = self.speed_x_mps {
                speed.abs()
            } else if let Some(speed) = rpm_speed {
                ((1.0 - RPM_CORRECTION_WEIGHT) * predicted_speed + RPM_CORRECTION_WEIGHT * speed)
                    .max(0.0)
            } else {
                predicted_speed
            };

            self.heading_rad += self.yaw_rate_rps.unwrap_or(0.0) * dt;
            self.distance_m += self.velocity_mps.abs() * dt;
            self.x_m += self.velocity_mps * self.heading_rad.cos() * dt;
            self.y_m += self.velocity_mps * self.heading_rad.sin() * dt;
        }

        let elapsed = timestamp - self.t0.unwrap_or(timestamp);
        let mut messages = Vec::new();

        if self.map_points.is_empty() {
            self.learning_points.push(Point2 {
                x: self.x_m,
                y: self.y_m,
            });
            self.update_start_area_state();

            if self.should_close_learning_lap(elapsed) {
                self.freeze_map();
                if !self.map_points.is_empty() {
                    messages.push(self.track_map_message(timestamp));
                    self.map_sent = true;
                }
            } else {
                if self.learning_points.len() >= 2 && (self.learning_points.len() % 5) == 0 {
                    messages.push(self.learning_track_message(timestamp));
                    messages.push(self.learning_pose_message(timestamp));
                }
                if (self.learning_points.len() % 25) == 0 {
                    messages.push(
                        json!({
                            "type": "track_status",
                            "state": "learning_first_lap",
                            "timestamp": timestamp,
                            "elapsed_sec": elapsed,
                            "close_radius_m": self.close_radius_m(),
                            "min_lap_distance_m": self.min_lap_distance_m(),
                            "points": self.learning_points.len(),
                        })
                        .to_string(),
                    );
                }
            }
        }

        if !self.map_points.is_empty() {
            if !self.map_sent {
                messages.push(self.track_map_message(timestamp));
                self.map_sent = true;
            }
            messages.push(self.track_pose_message(timestamp));
        }

        messages
    }

    fn apply_signal(&mut self, signal: &ProcessedSignal) {
        let name = signal.signal_name.trim();
        match name {
            "Accel_Linear_X" | "ACCEL_LINEAR_X" | "ventor_linear_acc_x" | "VENTOR_LINEAR_ACC_X" => {
                self.acc_x_mps2 = Some(signal.value)
            }
            "Velo_Angular_Z"
            | "VELO_ANGULAR_Z"
            | "ventor_angular_speed_z"
            | "VENTOR_ANGULAR_SPEED_Z" => self.yaw_rate_rps = Some(signal.value),
            "Speed_Linear_X"
            | "SPEED_LINEAR_X"
            | "ventor_linear_speed_x"
            | "VENTOR_LINEAR_SPEED_X" => {
                self.speed_x_mps = Some(if signal.unit.eq_ignore_ascii_case("km/h") {
                    signal.value / 3.6
                } else {
                    signal.value
                });
            }
            "Speed_Linear_Y"
            | "SPEED_LINEAR_Y"
            | "ventor_linear_speed_y"
            | "VENTOR_LINEAR_SPEED_Y" => {
                self.speed_y_mps = Some(if signal.unit.eq_ignore_ascii_case("km/h") {
                    signal.value / 3.6
                } else {
                    signal.value
                });
            }
            "act_Speed A0" | "act_Speed_A0" | "RPM 0A" | "RPM_0A" => {
                self.rpm_a0 = Some(signal.value)
            }
            "act_Speed B0" | "act_Speed_B0" | "RPM 0B" | "RPM_0B" => {
                self.rpm_b0 = Some(signal.value)
            }
            "act_Speed A13" | "act_Speed_A13" | "RPM 13A" | "RPM_13A" => {
                self.rpm_a13 = Some(signal.value)
            }
            "act_Speed B13" | "act_Speed_B13" | "RPM 13B" | "RPM_13B" => {
                self.rpm_b13 = Some(signal.value)
            }
            _ => {}
        }
    }

    fn update_start_area_state(&mut self) {
        let Some(first) = self.learning_points.first().copied() else {
            return;
        };
        let current = Point2 {
            x: self.x_m,
            y: self.y_m,
        };
        if distance(first, current) > self.close_radius_m() * 2.0 {
            self.left_start_area = true;
        }
    }

    fn should_close_learning_lap(&self, elapsed: f64) -> bool {
        if self.learning_points.len() < 20 {
            return false;
        }
        if !self.left_start_area {
            return false;
        }
        if elapsed < self.min_lap_time_sec {
            return false;
        }
        if self.distance_m < self.min_lap_distance_m() {
            return false;
        }

        let Some(first) = self.learning_points.first().copied() else {
            return false;
        };
        let current = Point2 {
            x: self.x_m,
            y: self.y_m,
        };
        distance(first, current) <= self.close_radius_m()
    }

    fn learned_extent_m(&self) -> f64 {
        let Some(first) = self.learning_points.first().copied() else {
            return 0.0;
        };
        self.learning_points
            .iter()
            .map(|point| distance(first, *point))
            .fold(0.0, f64::max)
    }

    fn close_radius_m(&self) -> f64 {
        if let Some(radius) = self.configured_close_radius_m {
            return radius;
        }
        (self.learned_extent_m() * 0.08).clamp(4.0, 20.0)
    }

    fn min_lap_distance_m(&self) -> f64 {
        if let Some(distance_m) = self.configured_min_lap_distance_m {
            return distance_m;
        }
        let close_radius_m = self.close_radius_m();
        (self.learned_extent_m() * 2.0)
            .max(close_radius_m * 8.0)
            .clamp(25.0, 5000.0)
    }

    fn rpm_speed_mps(&self) -> Option<f64> {
        let values = [self.rpm_a0, self.rpm_b0, self.rpm_a13, self.rpm_b13];
        let valid: Vec<f64> = values.iter().filter_map(|v| *v).collect();
        if valid.is_empty() {
            return None;
        }
        Some(
            valid
                .iter()
                .map(|rpm| rpm.abs() * RPM_MOTOR_TO_MPS)
                .sum::<f64>()
                / valid.len() as f64,
        )
    }

    fn freeze_map(&mut self) {
        self.map_points = downsample_points(&self.learning_points, self.max_map_points);
        if let (Some(first), Some(last)) = (
            self.map_points.first().copied(),
            self.map_points.last().copied(),
        ) {
            let closing = distance(first, last);
            if closing > 1e-6 {
                self.map_points.push(first);
            }
        }
        self.rebuild_map_arc();
    }

    fn rebuild_map_arc(&mut self) {
        self.map_arc_m.clear();
        self.map_arc_m.push(0.0);
        for i in 1..self.map_points.len() {
            let next = self.map_arc_m[i - 1] + distance(self.map_points[i - 1], self.map_points[i]);
            self.map_arc_m.push(next);
        }
        self.map_len_m = *self.map_arc_m.last().unwrap_or(&0.0);
        if self.map_len_m <= 1e-6 {
            self.map_points.clear();
            self.map_arc_m.clear();
        }
    }

    fn position_on_map(&self) -> Point2 {
        if self.map_points.len() < 2 || self.map_len_m <= 1e-6 {
            return Point2 {
                x: self.x_m,
                y: self.y_m,
            };
        }
        let s = self.distance_m.rem_euclid(self.map_len_m);
        let idx = self
            .map_arc_m
            .partition_point(|v| *v < s)
            .clamp(1, self.map_arc_m.len() - 1);
        let s0 = self.map_arc_m[idx - 1];
        let s1 = self.map_arc_m[idx];
        let alpha = if s1 > s0 { (s - s0) / (s1 - s0) } else { 0.0 };
        let p0 = self.map_points[idx - 1];
        let p1 = self.map_points[idx];
        Point2 {
            x: p0.x + (p1.x - p0.x) * alpha,
            y: p0.y + (p1.y - p0.y) * alpha,
        }
    }

    fn track_map_message(&self, timestamp: f64) -> String {
        let (min_x, max_x, min_y, max_y) = bounds(&self.map_points);
        let points = json_points(&self.map_points);
        json!({
            "type": "track_map",
            "timestamp": timestamp,
            "close_radius_m": self.close_radius_m(),
            "track": {
                "points": points,
                "bounds": { "minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y },
                "length_m": self.map_len_m,
            }
        })
        .to_string()
    }

    fn learning_track_message(&self, timestamp: f64) -> String {
        let (min_x, max_x, min_y, max_y) = bounds(&self.learning_points);
        let points = json_points(&self.learning_points);
        json!({
            "type": "track_map",
            "timestamp": timestamp,
            "state": "learning_first_lap",
            "elapsed_sec": timestamp - self.t0.unwrap_or(timestamp),
            "close_radius_m": self.close_radius_m(),
            "min_lap_distance_m": self.min_lap_distance_m(),
            "track": {
                "points": points,
                "bounds": { "minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y },
                "learning": true,
            }
        })
        .to_string()
    }

    fn track_pose_message(&self, timestamp: f64) -> String {
        let p = self.position_on_map();
        json!({
            "type": "track_pose",
            "timestamp": timestamp,
            "vehicle": {
                "x": p.x,
                "y": p.y,
                "x_m": p.x,
                "y_m": p.y,
                "heading": self.heading_rad.to_degrees(),
                "speed": self.velocity_mps,
                "distance_m": self.distance_m,
            }
        })
        .to_string()
    }

    fn learning_pose_message(&self, timestamp: f64) -> String {
        json!({
            "type": "track_pose",
            "timestamp": timestamp,
            "vehicle": {
                "x": self.x_m,
                "y": self.y_m,
                "x_m": self.x_m,
                "y_m": self.y_m,
                "heading": self.heading_rad.to_degrees(),
                "speed": self.velocity_mps,
                "distance_m": self.distance_m,
                "learning": true,
            }
        })
        .to_string()
    }
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn env_f64(name: &str, default: f64) -> f64 {
    env_opt_f64(name).unwrap_or(default)
}

fn env_opt_f64(name: &str) -> Option<f64> {
    std::env::var(name).ok().and_then(|v| v.parse::<f64>().ok())
}

fn downsample_points(points: &[Point2], max_points: usize) -> Vec<Point2> {
    if points.len() <= max_points {
        return points.to_vec();
    }
    let last = points.len() - 1;
    (0..max_points)
        .map(|i| {
            let idx = ((i as f64) * (last as f64) / ((max_points - 1) as f64)).round() as usize;
            points[idx]
        })
        .collect()
}

fn bounds(points: &[Point2]) -> (f64, f64, f64, f64) {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for p in points {
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
        max_y = max_y.max(p.y);
    }
    if !min_x.is_finite() {
        return (0.0, 1.0, 0.0, 1.0);
    }
    (min_x, max_x, min_y, max_y)
}

fn json_points(points: &[Point2]) -> Vec<serde_json::Value> {
    points.iter().map(|p| json!([p.x, p.y])).collect()
}

fn is_track_signal(name: &str) -> bool {
    matches!(
        name,
        "Accel_Linear_X"
            | "ACCEL_LINEAR_X"
            | "ventor_linear_acc_x"
            | "VENTOR_LINEAR_ACC_X"
            | "Velo_Angular_Z"
            | "VELO_ANGULAR_Z"
            | "ventor_angular_speed_z"
            | "VENTOR_ANGULAR_SPEED_Z"
            | "Speed_Linear_X"
            | "SPEED_LINEAR_X"
            | "ventor_linear_speed_x"
            | "VENTOR_LINEAR_SPEED_X"
            | "Speed_Linear_Y"
            | "SPEED_LINEAR_Y"
            | "ventor_linear_speed_y"
            | "VENTOR_LINEAR_SPEED_Y"
            | "act_Speed A0"
            | "act_Speed_A0"
            | "RPM 0A"
            | "RPM_0A"
            | "act_Speed B0"
            | "act_Speed_B0"
            | "RPM 0B"
            | "RPM_0B"
            | "act_Speed A13"
            | "act_Speed_A13"
            | "RPM 13A"
            | "RPM_13A"
            | "act_Speed B13"
            | "act_Speed_B13"
            | "RPM 13B"
            | "RPM_13B"
    )
}

pub type SharedTrackState = Arc<Mutex<RealtimeTrackState>>;

#[cfg(test)]
mod tests {
    use super::*;

    fn signal(timestamp: f64, name: &str, value: f64) -> ProcessedSignal {
        ProcessedSignal {
            timestamp,
            device_id: "test-car".to_string(),
            can_id: 0,
            signal_name: name.to_string(),
            value,
            unit: String::new(),
        }
    }

    #[test]
    fn integrates_negative_speed_x_as_vector_component() {
        let mut state = RealtimeTrackState::new();

        state.update(&[
            signal(0.0, "Speed_Linear_X", 10.0),
            signal(0.0, "Speed_Linear_Y", 0.0),
        ]);
        state.update(&[
            signal(1.0, "Speed_Linear_X", 10.0),
            signal(1.0, "Speed_Linear_Y", 0.0),
        ]);
        state.update(&[
            signal(2.0, "Speed_Linear_X", -10.0),
            signal(2.0, "Speed_Linear_Y", 0.0),
        ]);

        assert!((state.x_m - 0.0).abs() < 1e-9);
        assert!((state.distance_m - 20.0).abs() < 1e-9);
        assert!((state.velocity_mps - 10.0).abs() < 1e-9);
    }

    #[test]
    fn ignores_non_track_signals_for_integration() {
        let mut state = RealtimeTrackState::new();

        state.update(&[
            signal(0.0, "Speed_Linear_X", 10.0),
            signal(0.0, "Speed_Linear_Y", 0.0),
        ]);
        state.update(&[
            signal(1.0, "Speed_Linear_X", 10.0),
            signal(1.0, "Speed_Linear_Y", 0.0),
        ]);
        state.update(&[signal(2.0, "VoltOverallParam_MinCellVoltage", 3.8)]);

        assert!((state.x_m - 10.0).abs() < 1e-9);
        assert!((state.distance_m - 10.0).abs() < 1e-9);
    }

    #[test]
    fn does_not_freeze_map_until_vehicle_returns_to_start() {
        let mut state = RealtimeTrackState::new();
        state.configured_close_radius_m = Some(3.0);
        state.configured_min_lap_distance_m = Some(20.0);
        state.min_lap_time_sec = 0.0;

        state.update(&[
            signal(0.0, "Speed_Linear_X", 10.0),
            signal(0.0, "Speed_Linear_Y", 0.0),
        ]);

        for t in 1..25 {
            state.update(&[
                signal(t as f64, "Speed_Linear_X", 10.0),
                signal(t as f64, "Speed_Linear_Y", 0.0),
            ]);
        }

        assert!(state.map_points.is_empty());
        assert!(state.left_start_area);
        assert!(state.distance_m >= state.min_lap_distance_m());
    }

    #[test]
    fn freezes_map_when_vehicle_returns_to_start_area() {
        let mut state = RealtimeTrackState::new();
        state.configured_close_radius_m = Some(3.0);
        state.configured_min_lap_distance_m = Some(20.0);
        state.min_lap_time_sec = 0.0;

        state.update(&[
            signal(0.0, "Speed_Linear_X", 10.0),
            signal(0.0, "Speed_Linear_Y", 0.0),
        ]);

        for t in 1..=20 {
            let (vx, vy) = match t {
                1..=5 => (2.0, 0.0),
                6..=10 => (0.0, 2.0),
                11..=15 => (-2.0, 0.0),
                _ => (0.0, -2.0),
            };
            state.update(&[
                signal(t as f64, "Speed_Linear_X", vx),
                signal(t as f64, "Speed_Linear_Y", vy),
            ]);
        }

        assert!(!state.map_points.is_empty());
        assert!(state.map_len_m > 0.0);
    }

    #[test]
    fn adaptive_closure_detects_generic_loop_without_fixed_distance() {
        let mut state = RealtimeTrackState::new();
        state.configured_close_radius_m = None;
        state.configured_min_lap_distance_m = None;
        state.min_lap_time_sec = 0.0;

        state.update(&[
            signal(0.0, "Speed_Linear_X", 4.0),
            signal(0.0, "Speed_Linear_Y", 0.0),
        ]);

        for t in 1..=40 {
            let (vx, vy) = match t {
                1..=10 => (4.0, 0.0),
                11..=20 => (0.0, 4.0),
                21..=30 => (-4.0, 0.0),
                _ => (0.0, -4.0),
            };
            state.update(&[
                signal(t as f64, "Speed_Linear_X", vx),
                signal(t as f64, "Speed_Linear_Y", vy),
            ]);
        }

        assert!(!state.map_points.is_empty());
        assert!(state.map_len_m > 0.0);
    }
}
