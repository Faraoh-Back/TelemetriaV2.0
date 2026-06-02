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
    lap_period_sec: f64,
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
    direct_speed_mps: Option<f64>,
    rpm_a0: Option<f64>,
    rpm_b0: Option<f64>,
    rpm_a13: Option<f64>,
    rpm_b13: Option<f64>,
    learning_points: Vec<Point2>,
    map_points: Vec<Point2>,
    map_arc_m: Vec<f64>,
    map_len_m: f64,
    map_sent: bool,
}

impl RealtimeTrackState {
    pub fn new() -> Self {
        let lap_period_sec = std::env::var("TRACK_LAP_PERIOD_SEC")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(45.0)
            .clamp(5.0, 600.0);

        Self {
            lap_period_sec,
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
            direct_speed_mps: None,
            rpm_a0: None,
            rpm_b0: None,
            rpm_a13: None,
            rpm_b13: None,
            learning_points: Vec::new(),
            map_points: Vec::new(),
            map_arc_m: Vec::new(),
            map_len_m: 0.0,
            map_sent: false,
        }
    }

    pub fn update(&mut self, signals: &[ProcessedSignal]) -> Vec<String> {
        if signals.is_empty() {
            return Vec::new();
        }

        let timestamp = signals[0].timestamp;
        if self.t0.is_none() {
            self.t0 = Some(timestamp);
            self.last_t = Some(timestamp);
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
        self.last_t = Some(timestamp);
        if !(0.0..=1.0).contains(&dt) || dt == 0.0 {
            return Vec::new();
        }

        let rpm_speed = self.rpm_speed_mps();
        let acc_x = self.acc_x_mps2.unwrap_or(0.0);
        let predicted_speed = (self.velocity_mps + acc_x * dt).max(0.0);
        self.velocity_mps = if let Some(speed) = self.direct_speed_mps {
            speed.max(0.0)
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

        let elapsed = timestamp - self.t0.unwrap_or(timestamp);
        let mut messages = Vec::new();

        if self.map_points.is_empty() {
            self.learning_points.push(Point2 {
                x: self.x_m,
                y: self.y_m,
            });
            if elapsed >= self.lap_period_sec && self.learning_points.len() >= 20 {
                self.freeze_map();
                if !self.map_points.is_empty() {
                    messages.push(self.track_map_message(timestamp));
                    self.map_sent = true;
                }
            } else if (self.learning_points.len() % 25) == 0 {
                messages.push(
                    json!({
                        "type": "track_status",
                        "state": "learning_first_lap",
                        "timestamp": timestamp,
                        "elapsed_sec": elapsed,
                        "lap_period_sec": self.lap_period_sec,
                        "points": self.learning_points.len(),
                    })
                    .to_string(),
                );
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
                self.direct_speed_mps = Some(
                    if name.eq_ignore_ascii_case("Speed_Linear_X")
                        || signal.unit.eq_ignore_ascii_case("km/h")
                    {
                        signal.value / 3.6
                    } else {
                        signal.value
                    },
                );
            }
            "act_Speed A0" | "RPM 0A" => self.rpm_a0 = Some(signal.value),
            "act_Speed B0" | "RPM 0B" => self.rpm_b0 = Some(signal.value),
            "act_Speed A13" | "RPM 13A" => self.rpm_a13 = Some(signal.value),
            "act_Speed B13" | "RPM 13B" => self.rpm_b13 = Some(signal.value),
            _ => {}
        }
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
        let points: Vec<_> = self
            .map_points
            .iter()
            .map(|p| {
                let (x, y) = normalize_point(*p, min_x, max_x, min_y, max_y);
                json!([x, y])
            })
            .collect();
        json!({
            "type": "track_map",
            "timestamp": timestamp,
            "lap_period_sec": self.lap_period_sec,
            "track": {
                "points": points,
                "bounds": { "minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y },
                "length_m": self.map_len_m,
            }
        })
        .to_string()
    }

    fn track_pose_message(&self, timestamp: f64) -> String {
        let p = self.position_on_map();
        let (min_x, max_x, min_y, max_y) = bounds(&self.map_points);
        let (nx, ny) = normalize_point(p, min_x, max_x, min_y, max_y);
        json!({
            "type": "track_pose",
            "timestamp": timestamp,
            "vehicle": {
                "x": nx,
                "y": ny,
                "x_m": p.x,
                "y_m": p.y,
                "heading": self.heading_rad.to_degrees(),
                "speed": self.velocity_mps,
                "distance_m": self.distance_m,
            }
        })
        .to_string()
    }
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
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

fn normalize_point(p: Point2, min_x: f64, max_x: f64, min_y: f64, max_y: f64) -> (f64, f64) {
    let dx = (max_x - min_x).abs().max(1e-9);
    let dy = (max_y - min_y).abs().max(1e-9);
    ((p.x - min_x) / dx, (p.y - min_y) / dy)
}

pub type SharedTrackState = Arc<Mutex<RealtimeTrackState>>;
