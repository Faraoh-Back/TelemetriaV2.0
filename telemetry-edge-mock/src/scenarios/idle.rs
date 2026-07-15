use super::ScenarioSnapshot;

pub fn snapshot(t: f64, _seed: u64) -> ScenarioSnapshot {
    let mut s = ScenarioSnapshot::nominal(t);
    s.vcu_state = 1;
    s
}
