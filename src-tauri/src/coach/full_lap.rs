//! Continuous distance-domain point-mass capability scenarios, independent of inference.
use super::{modeled::at, types::*};
use crate::telemetry::{self, Analysis, Channel, Lap, LapView, Session};
use serde::{Deserialize, Serialize};
#[path = "full_lap_coaching.rs"]
mod coaching;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullLapResult {
    pub diagnostics: FullLapDiagnostics,
    pub opportunities: Vec<Opportunity>,
    pub profiles: Vec<SimulatedProfile>,
    pub calibrated_envelope: Option<VehicleEnvelope>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullLapDiagnostics {
    pub modeled_lap_seconds: Option<TimeRange>,
    pub gain_range: Option<GainRange>,
    pub coverage_fraction: f64,
    pub covered_meters: f64,
    pub total_meters: f64,
    pub baseline_integrated_seconds: f64,
    pub baseline_integration_error_seconds: f64,
    pub sections: Vec<PhysicsSection>,
    pub validation: PhysicsValidation,
    pub assumptions: Vec<String>,
    pub rejection_reasons: Vec<String>,
    pub dynamics_support: Option<DynamicsSupport>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicsSupport {
    pub acceleration_samples: usize,
    pub braking_samples: usize,
    pub acceleration_speed_mps: [f64; 2],
    pub braking_speed_mps: [f64; 2],
    pub extrapolated_distance_fraction: f64,
    pub maximum_speed_extrapolation_mps: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsSection {
    pub section_id: String,
    pub label: String,
    pub start_meters: f64,
    pub end_meters: f64,
    pub baseline_seconds: f64,
    pub conservative_seconds: Option<f64>,
    pub nominal_seconds: Option<f64>,
    pub gain_range: Option<GainRange>,
    pub excluded_reasons: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsValidation {
    #[serde(default)]
    pub prediction: Option<super::prediction::PredictionValidation>,
    pub training_lap_ids: Vec<String>,
    pub withheld_lap_ids: Vec<String>,
    pub speed_rmse_mps: Option<f64>,
    pub section_time_mae_seconds: Option<f64>,
    pub envelope_exceedance_fraction: Option<f64>,
    pub feasibility_violations: usize,
    pub tested_cells: usize,
    pub maximum_constraint_excess: f64,
    pub target: String,
    pub notes: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cyclic_solver_obeys_combined_grip_and_carries_exit_speed() {
        let k: Vec<_> = (0..200)
            .map(|i| if (60..90).contains(&i) { 0.06 } else { 0.001 })
            .collect();
        let c = Capability {
            acceleration: vec![(5., 2.), (30., 0.5)],
            braking: vec![(5., 5.), (30., 5.)],
            lateral: 8.,
            max_speed: 30.,
        };
        let v = solve(&k, 2., &c).unwrap();
        assert_eq!(violations(&k, 2., &c, &v).0, 0);
        assert!(v[70] < v[20]);
        assert!((v[199] - v[0]).abs() < 1.);
        let rotated: Vec<_> = k.iter().cycle().skip(65).take(200).copied().collect();
        let shifted = solve(&rotated, 2., &c).unwrap();
        assert!((time(&v, 2.) - time(&shifted, 2.)).abs() < 1e-4);
    }
    #[test]
    fn missing_direction_does_not_invent_capacity() {
        assert!(curve(&[], 0.9).is_none());
        assert!(curve(&[(12., 1.), (12.5, 1.2), (13., 1.1)], 0.9).is_some());
    }
    #[test]
    fn cached_geometry_gaps_preserve_curvature_with_a_nonlinear_clock() {
        let mut view = LapView {
            lap_id: "circle".into(),
            duration: 20.,
            length: Some(100.),
            mapping: (0..=100)
                .map(|i| telemetry::MappingPoint {
                    meters: i as f64,
                    time: i as f64 * 0.1 + (i * i) as f64 * 0.001,
                })
                .collect(),
            track: vec![],
            series: vec![],
            warnings: vec![],
        };
        view.track = view
            .mapping
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let angle = p.meters * std::f64::consts::TAU / 100.;
                telemetry::TrackPoint {
                    x: angle.cos() * 20.,
                    y: angle.sin() * 20.,
                    position: p.time,
                    speed: None,
                    break_before: i == 31 || i == 99,
                }
            })
            .collect();
        let trace = Trace::new(&view).unwrap();
        assert_eq!(
            trace.break_meters.as_ref().unwrap(),
            &vec![(30., 31.), (98., 99.)]
        );
        for x in [0., 20., 29., 30., 31., 32., 40., 80., 99.] {
            for chord in [2., 5., 10.] {
                let crosses_gap = [(30., 31.), (98., 99.)].iter().any(|&(a, b)| {
                    [-100., 0., 100.]
                        .iter()
                        .any(|offset| x - chord < b + offset && x + chord > a + offset)
                });
                let curvature = trace.curvature(x, chord);
                if crosses_gap {
                    assert!(curvature.is_none());
                } else {
                    assert!((curvature.unwrap() - 0.05).abs() < 1e-10);
                }
            }
        }
        // A gap outside the mapping previously withheld every curvature sample.
        view.track[0].position = -1.;
        view.track[1].break_before = true;
        let trace = Trace::new(&view).unwrap();
        assert!(trace.break_meters.is_none());
        assert!(trace.curvature(60., 5.).is_none());
    }
}

fn q(values: &[f64], p: f64) -> Option<f64> {
    let mut v: Vec<_> = values.iter().copied().filter(|x| x.is_finite()).collect();
    v.sort_by(f64::total_cmp);
    (!v.is_empty()).then(|| v[((v.len() - 1) as f64 * p).round() as usize])
}
#[derive(Clone)]
struct Capability {
    acceleration: Vec<(f64, f64)>,
    braking: Vec<(f64, f64)>,
    lateral: f64,
    max_speed: f64,
}
fn capacity(curve: &[(f64, f64)], v: f64) -> f64 {
    at(curve, v).unwrap_or_else(|| {
        if v < curve[0].0 {
            curve[0].1
        } else {
            curve.last().unwrap().1
        }
    })
}
/// Separate directional bands: interpolate sparse interiors rather than requiring braking
/// and propulsion observations in the same band. Outside support hold nearest evidence.
fn curve(samples: &[(f64, f64)], p: f64) -> Option<Vec<(f64, f64)>> {
    let mut result = Vec::new();
    for band in 0..32 {
        let v: Vec<_> = samples
            .iter()
            .filter(|s| (s.0 / 2.).floor() as usize == band)
            .map(|s| s.1)
            .collect();
        let v = robust(&v);
        if v.len() >= 3 {
            result.push((2. * band as f64 + 1., q(&v, p)?));
        }
    }
    (!result.is_empty()).then_some(result)
}
fn allowance(c: &Capability, a: f64, b: f64, k: f64, braking: bool) -> f64 {
    let (low, high) = (a.min(b), a.max(b));
    let curve = if braking { &c.braking } else { &c.acceleration };
    let cap = curve
        .iter()
        .filter(|p| p.0 > low && p.0 < high)
        .map(|p| p.1)
        .fold(capacity(curve, low).min(capacity(curve, high)), f64::min);
    let utilization = (high * high * k / c.lateral).min(1.);
    cap * (1. - utilization * utilization).max(0.).sqrt()
}
fn reachable(from: f64, cap: f64, ds: f64, k: f64, c: &Capability, braking: bool) -> f64 {
    if cap <= from {
        return cap;
    }
    let mut low = from;
    let mut high = cap;
    for _ in 0..40 {
        let mid = (low + high) * 0.5;
        if (mid * mid - from * from) / (2. * ds) <= allowance(c, from, mid, k, braking) {
            low = mid;
        } else {
            high = mid;
        }
    }
    low
}
#[cfg(test)]
fn solve(k: &[f64], ds: f64, c: &Capability) -> Option<Vec<f64>> {
    solve_with_cancel(k, ds, c, &|| false)
}
fn solve_with_cancel(
    k: &[f64],
    ds: f64,
    c: &Capability,
    cancelled: &impl Fn() -> bool,
) -> Option<Vec<f64>> {
    if k.len() < 3
        || !ds.is_finite()
        || ds <= 0.
        || c.lateral <= 0.
        || c.acceleration.is_empty()
        || c.braking.is_empty()
    {
        return None;
    }
    let n = k.len();
    let mut v: Vec<_> = (0..n)
        .map(|i| {
            c.max_speed.min(
                (c.lateral / k[i].max(k[(i + n - 1) % n]).max(k[(i + 1) % n]).max(1e-9)).sqrt(),
            )
        })
        .collect();
    for _ in 0..(n * 2).min(256) {
        if cancelled() {
            return None;
        }
        let old = v.clone();
        for i in 0..n {
            let j = (i + 1) % n;
            v[j] = reachable(v[i], v[j], ds, k[i].max(k[j]), c, false);
        }
        for i in (0..n).rev() {
            let j = (i + 1) % n;
            v[i] = reachable(v[j], v[i], ds, k[i].max(k[j]), c, true);
        }
        if v.iter().zip(old).all(|(a, b)| (a - b).abs() < 1e-8) {
            break;
        }
    }
    (v.iter().all(|x| x.is_finite() && *x > 0.5) && violations(k, ds, c, &v).0 == 0).then_some(v)
}
fn violations(k: &[f64], ds: f64, c: &Capability, v: &[f64]) -> (usize, f64) {
    let mut count = 0;
    let mut max = 0_f64;
    for i in 0..v.len() {
        let j = (i + 1) % v.len();
        let a = (v[j] * v[j] - v[i] * v[i]) / (2. * ds);
        let speed = v[i].max(v[j]);
        let excess = (a.abs() - allowance(c, v[i], v[j], k[i].max(k[j]), a < 0.))
            .max(speed * speed * k[i].max(k[j]) - c.lateral);
        max = max.max(excess);
        if excess > 1e-6 {
            count += 1;
        }
    }
    (count, max)
}
fn time(v: &[f64], ds: f64) -> f64 {
    (0..v.len())
        .map(|i| 2. * ds / (v[i] + v[(i + 1) % v.len()]))
        .sum()
}
struct Trace {
    mapping: Vec<(f64, f64)>,
    x: Vec<(f64, f64)>,
    y: Vec<(f64, f64)>,
    breaks: Vec<(f64, f64)>,
    break_meters: Option<Vec<(f64, f64)>>,
    length: f64,
}
impl Trace {
    fn new(view: &LapView) -> Option<Self> {
        let mapping: Vec<_> = view.mapping.iter().map(|p| (p.meters, p.time)).collect();
        if mapping.len() < 3
            || mapping
                .iter()
                .any(|p| !p.0.is_finite() || !p.1.is_finite() || p.0 < 0.)
            || mapping
                .windows(2)
                .any(|w| w[1].0 <= w[0].0 || w[1].1 <= w[0].1)
        {
            return None;
        }
        if view.track.len() < 3
            || view
                .track
                .iter()
                .any(|p| !p.position.is_finite() || !p.x.is_finite() || !p.y.is_finite())
            || view
                .track
                .windows(2)
                .any(|w| w[1].position <= w[0].position)
        {
            return None;
        }
        let breaks: Vec<_> = view
            .track
            .windows(2)
            .filter(|w| w[1].break_before)
            .map(|w| (w[0].position, w[1].position))
            .collect();
        let inverse: Vec<_> = mapping.iter().map(|&(m, t)| (t, m)).collect();
        let break_meters = breaks
            .iter()
            .map(|&(a, b)| Some((at(&inverse, a)?, at(&inverse, b)?)))
            .collect();
        Some(Self {
            length: mapping.last()?.0,
            mapping,
            x: view.track.iter().map(|p| (p.position, p.x)).collect(),
            y: view.track.iter().map(|p| (p.position, p.y)).collect(),
            breaks,
            break_meters,
        })
    }
    fn closed(&self, chord: f64) -> bool {
        let raw = |x: f64| -> Option<(f64, f64)> {
            let t = at(&self.mapping, x)?;
            Some((at(&self.x, t)?, at(&self.y, t)?))
        };
        let Some((a, b, c, d)) = raw(0.)
            .zip(raw(chord))
            .zip(raw(self.length - chord))
            .zip(raw(self.length))
            .map(|(((a, b), c), d)| (a, b, c, d))
        else {
            return false;
        };
        let u = (b.0 - a.0, b.1 - a.1);
        let v = (d.0 - c.0, d.1 - c.1);
        (a.0 - d.0).hypot(a.1 - d.1) <= 5.
            && (u.0 * v.0 + u.1 * v.1) > 0.5 * u.0.hypot(u.1) * v.0.hypot(v.1)
    }
    fn point(&self, x: f64) -> Option<(f64, f64)> {
        let t = at(&self.mapping, x.rem_euclid(self.length))?;
        if self.breaks.iter().any(|&(a, b)| t > a && t < b) {
            return None;
        }
        let p = (at(&self.x, t)?, at(&self.y, t)?);
        (p.0.is_finite() && p.1.is_finite()).then_some(p)
    }
    fn curvature(&self, x: f64, chord: f64) -> Option<f64> {
        for &(a, b) in self.break_meters.as_ref()? {
            for offset in [-self.length, 0., self.length] {
                if x - chord < b + offset && x + chord > a + offset {
                    return None;
                }
            }
        }
        let (a, b, c) = (
            self.point(x - chord)?,
            self.point(x)?,
            self.point(x + chord)?,
        );
        let (ab, bc, ac) = (
            (b.0 - a.0).hypot(b.1 - a.1),
            (c.0 - b.0).hypot(c.1 - b.1),
            (c.0 - a.0).hypot(c.1 - a.1),
        );
        if ab < chord * 0.25 || bc < chord * 0.25 || ac < chord * 0.25 {
            return None;
        }
        let cross = ((b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)).abs();
        let curvature = 2. * cross / (ab * bc * ac);
        curvature.is_finite().then_some(curvature)
    }
}
struct Speed {
    raw: Vec<(f64, f64)>,
    gaps: Vec<[f64; 2]>,
}
impl Speed {
    fn continuous(&self, start: f64, end: f64) -> bool {
        !self.gaps.iter().any(|g| start < g[1] && end > g[0])
    }
    fn new(c: &Channel) -> Self {
        Self {
            raw: c
                .times
                .iter()
                .copied()
                .zip(c.values.iter().copied())
                .collect(),
            gaps: telemetry::source_gaps(c),
        }
    }
    fn at(&self, t: f64) -> Option<f64> {
        if self.gaps.iter().any(|g| t > g[0] && t < g[1]) {
            return None;
        }
        at(&self.raw, t).filter(|v| v.is_finite() && *v > 0.5 && *v < 80.)
    }
}
struct Calibration {
    low: Capability,
    high: Capability,
    samples: usize,
    accel: Vec<(f64, f64)>,
    brake: Vec<(f64, f64)>,
}
fn calibrate(s: &Session, views: &[(&Lap, &LapView)], chord: f64) -> Option<Calibration> {
    let mut windows = Vec::new();
    let mut lateral = Vec::new();
    let mut speeds = Vec::new();
    for (lap, view) in views {
        let Some(channel) = super::sources::speed(s, lap) else {
            continue;
        };
        let speed = Speed::new(channel);
        let Some(trace) = Trace::new(view) else {
            continue;
        };
        let inverse: Vec<_> = trace.mapping.iter().map(|&(m, t)| (t, m)).collect();
        let mut t = lap.start;
        while t + 0.4 < lap.end {
            if !speed.gaps.iter().any(|g| t < g[1] && t + 0.4 > g[0]) {
                if let (Some(a), Some(b), Some(x)) = (
                    speed.at(t),
                    speed.at(t + 0.4),
                    at(&inverse, t + 0.2 - lap.start),
                ) {
                    if let Some(k) = trace.curvature(x, chord) {
                        let v = (a + b) * 0.5;
                        let ay = v * v * k;
                        let ax = (b - a) / 0.4;
                        if ay < 25. && ax.abs() < 15. {
                            windows.push((v, ax, ay));
                            if ay > 1. {
                                lateral.push(ay);
                            }
                            speeds.push(v);
                        }
                    }
                }
            }
            t += 0.4;
        }
    }
    if lateral.len() < 12 {
        return None;
    }
    let lateral = robust(&lateral);
    let lat_hi = q(&lateral, 0.995)?;
    let lat_low = q(&lateral, 0.97)?;
    let mut accel = Vec::new();
    let mut brake = Vec::new();
    for &(v, a, ay) in &windows {
        // Invert combined utilization only where conditioning is sound. High lateral
        // demand cannot identify free longitudinal capability.
        let u = ay / lat_hi;
        if u < 0.8 {
            let free = a.abs() / (1. - u * u).sqrt();
            if a > 0.08 {
                accel.push((v, free));
            } else if a < -0.08 {
                brake.push((v, free));
            }
        }
    }
    let low = Capability {
        acceleration: curve(&accel, 0.8)?,
        braking: curve(&brake, 0.8)?,
        lateral: lat_low,
        max_speed: q(&speeds, 0.99)?,
    };
    let high = Capability {
        acceleration: curve(&accel, 0.98)?,
        braking: curve(&brake, 0.98)?,
        lateral: lat_hi,
        max_speed: q(&speeds, 0.999)?,
    };
    Some(Calibration {
        low,
        high,
        samples: windows.len(),
        accel,
        brake,
    })
}

fn gain(baseline: f64, low: f64, high: f64) -> GainRange {
    GainRange{
    lower_seconds:baseline-low.max(high),upper_seconds:baseline-low.min(high),basis:"hypothesis".into(),
    assumption:"Conditional on repeatable telemetry-supported capacity and the recorded path; absolute vehicle limit is unidentified. Lower zero on a recommendation means no assured gain; signed costs remain in full-lap diagnostics.".into(),
    method:"Signed disjoint cell-time differences from two continuous cyclic combined-grip solutions. Quantile scenarios are sensitivity bounds, not confidence intervals.".into(),
}
}
fn section_time(v: &[f64], ds: f64, start: f64, end: f64) -> f64 {
    let n = v.len();
    let mut total = 0.;
    for i in 0..n {
        let a = start.max(i as f64 * ds);
        let b = end.min((i + 1) as f64 * ds);
        if b <= a {
            continue;
        }
        let u = v[i];
        let w = v[(i + 1) % n];
        let at_x = |x: f64| {
            (u * u + (w * w - u * u) * (x - i as f64 * ds) / ds)
                .max(0.)
                .sqrt()
        };
        total += 2. * (b - a) / (at_x(a) + at_x(b));
    }
    total
}
pub(super) fn analyze(
    s: &Session,
    base: &Analysis,
    best: &Lap,
    views: &[(&Lap, &LapView)],
    uncertainty: f64,
    cancelled: &impl Fn() -> bool,
) -> Result<FullLapResult, String> {
    let check = || {
        if cancelled() {
            Err("Coach analysis cancelled".to_string())
        } else {
            Ok(())
        }
    };
    check()?;
    let length = base
        .primary
        .length
        .filter(|v| v.is_finite() && *v > 0.)
        .unwrap_or(0.);
    let mut d=FullLapDiagnostics{modeled_lap_seconds:None,gain_range:None,coverage_fraction:0.,covered_meters:0.,total_meters:length,baseline_integrated_seconds:0.,baseline_integration_error_seconds:0.,sections:vec![],validation:PhysicsValidation{target:"Withheld driver versus optimal capability bound; errors below are bound residuals, not a prediction of unknown driver controls.".into(),..Default::default()},assumptions:vec![
        "2D point mass on the recorded path; no downforce, banking, grade, tire temperature or mass identification. No absolute grip or engine limit is inferred from driver demand.".into(),
        "Separate 2 m/s propulsion and braking bands with median/MAD upper-outlier rejection from nonoverlapping 0.4 s windows. Bands need three observations; interpolate interior gaps, hold nearest supported capability at outer speeds. Combined-demand correction uses lateral utilization below 0.8 only.".into(),
        "Scenario limits use sustained 80th/98th percentile directional demand and 97th/99.5th percentile lateral demand. Maximum speed uses 99th/99.9th percentile recorded speed; power above that support remains unknown. No arbitrary performance uplift.".into(),
        "Section baselines use measured elapsed times; optimized times integrate the speed solution. Baseline speed-integral minus recorded duration is reported separately as alignment/integration residual.".into(),
        "Cyclic forward/backward reachability uses maximum endpoint lateral demand throughout each cell and a friction ellipse; every section includes entry/exit and downstream speed consequences. Section gains stay signed and partition one lap.".into(),
        "RPM/gear/throttle identification is insufficient for a reliable shift map; No explicit shift model; short interruptions and mandatory shift losses may be underrepresented by sustained upper-tail demand. No separate shift-saving or RPM recovery is attributed.".into(),
    ],rejection_reasons:vec![],dynamics_support:None};
    let Some(trace) = Trace::new(&base.primary) else {
        return Ok(unavailable(
            d,
            "No valid continuous distance mapping for full-lap dynamics",
        ));
    };
    let length = trace.length;
    d.total_meters = length;
    let Some(channel) = super::sources::speed(s, best) else {
        return Ok(unavailable(d, "GPS speed in m/s is required"));
    };
    let speed = Speed::new(channel);
    let mut ordered = views.to_vec();
    ordered.sort_by(|(a, _), (b, _)| a.number.cmp(&b.number).then_with(|| a.id.cmp(&b.id)));
    let (training, withheld): (Vec<_>, Vec<_>) = ordered
        .into_iter()
        .enumerate()
        .partition(|(i, _)| views.len() < 3 || i % 3 != 2);
    let training: Vec<_> = training.into_iter().map(|(_, v)| v).collect();
    let withheld: Vec<_> = withheld.into_iter().map(|(_, v)| v).collect();
    d.validation.training_lap_ids = training.iter().map(|(l, _)| l.id.clone()).collect();
    d.validation.withheld_lap_ids = withheld.iter().map(|(l, _)| l.id.clone()).collect();
    let chord = 10_f64.max(uncertainty.max(0.) * 3.);
    let Some(mut cal) = calibrate(s, &training, chord) else {
        d.rejection_reasons.push("Insufficient sustained independent directional/lateral calibration; no full-lap potential published.".into());
        return Ok(FullLapResult {
            diagnostics: d,
            opportunities: vec![],
            profiles: vec![],
            calibrated_envelope: None,
        });
    };
    d.assumptions.push(format!("Calibration uses {} sustained windows on {} training laps; geometry chord {:.1} m; primary-path wider-chord curvature sensitivity retained (no geometry averaging across physically unaligned lap distances). {} heldout laps excluded from capability fitting.",cal.samples,training.len(),chord,withheld.len()));
    if !length.is_finite() || length < 30. || length > 20000. {
        return Ok(unavailable(
            d,
            "Track length outside 30–20000 m mesh support",
        ));
    }
    let n = (length / 2.).ceil() as usize;
    let ds = length / n as f64;
    let mut k_low = Vec::new();
    let mut k_high = Vec::new();
    let mut actual = Vec::new();
    let mut valid = Vec::new();
    if !trace.closed(chord) {
        d.rejection_reasons.push(
            "GPS seam fails endpoint proximity/heading continuity; closed-lap dynamics withheld."
                .into(),
        );
    }
    for i in 0..n {
        if i % 100 == 0 {
            check()?;
        }
        let x = i as f64 * ds;
        let median = trace.curvature(x, chord);
        let larger = median
            .zip(trace.curvature(x, chord * 1.5))
            .map(|(a, b)| a.max(b));
        let v = at(&trace.mapping, x).and_then(|t| speed.at(best.start + t));
        valid.push(
            median.is_some()
                && larger.is_some()
                && v.is_some()
                && trace.curvature(x, chord).is_some(),
        );
        k_low.push(larger.unwrap_or(0.));
        k_high.push(median.unwrap_or(0.));
        actual.push(v.unwrap_or(1.));
    }
    let actual_finish = speed.at(best.end);
    // Also check the whole source interval: a short dropout can lie between
    // two otherwise valid mesh samples. Actual finish speed is not periodic.
    let cells: Vec<_> = (0..n)
        .map(|i| {
            let times = at(&trace.mapping, i as f64 * ds)
                .zip(at(&trace.mapping, ((i + 1) as f64 * ds).min(length)));
            valid[i]
                && valid[(i + 1) % n]
                && (i + 1 < n || actual_finish.is_some())
                && times.is_some_and(|(a, b)| speed.continuous(best.start + a, best.start + b))
        })
        .collect();
    d.covered_meters = cells.iter().filter(|x| **x).count() as f64 * ds;
    d.coverage_fraction = d.covered_meters / length;
    d.baseline_integrated_seconds = time(&actual, ds) - 2. * ds / (actual[n - 1] + actual[0])
        + 2. * ds / (actual[n - 1] + actual_finish.unwrap_or(actual[0]));
    d.baseline_integration_error_seconds = d.baseline_integrated_seconds - best.duration;
    if cells.iter().any(|v| !*v) {
        d.rejection_reasons.push("Missing speed or continuous GPS geometry: excluded cells prevent a closed full-lap solution; no gap is bridged as an improvement.".into());
    }
    if (d.baseline_integrated_seconds - best.duration).abs() > best.duration * 0.05 {
        d.rejection_reasons.push("Speed-distance integral differs from recorded lap by more than 5%; alignment is unsuitable for a lap-time forecast.".into());
    }
    // Leave-one-training-lap-out stability widens the sensitivity scenarios using
    // actual refits, without imposing a desired improvement or invented grip uplift.
    let mut stability = Vec::new();
    let refit_count = training.len().min(12);
    if training.len() >= 3 && cells.iter().all(|v| *v) {
        let mut slow = solve_with_cancel(&k_low, ds, &cal.low, cancelled)
            .map(|v| time(&v, ds))
            .unwrap_or(0.);
        let mut fast = solve_with_cancel(&k_high, ds, &cal.high, cancelled)
            .map(|v| time(&v, ds))
            .unwrap_or(f64::INFINITY);
        // Bound resampling work on long sessions. Small sessions evaluate every
        // omission; larger sessions sample twelve evenly spaced omissions.
        for omitted in (0..refit_count).map(|i| i * training.len() / refit_count) {
            check()?;
            let subset: Vec<_> = training
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != omitted)
                .map(|(_, v)| *v)
                .collect();
            if let Some(fit) = calibrate(s, &subset, chord) {
                if let Some(v) = solve_with_cancel(&k_low, ds, &fit.low, cancelled) {
                    let t = time(&v, ds);
                    stability.push(t);
                    if t > slow {
                        slow = t;
                        cal.low = fit.low;
                    }
                }
                if let Some(v) = solve_with_cancel(&k_high, ds, &fit.high, cancelled) {
                    let t = time(&v, ds);
                    stability.push(t);
                    if t < fast {
                        fast = t;
                        cal.high = fit.high;
                    }
                }
            }
        }
    }
    check()?;
    if !stability.is_empty() {
        d.validation.notes.push(format!("Leave-one-training-lap-out refits ({} of {} omissions) produce {:.3}–{:.3} s across directional/lateral scenarios; published bounds include the slowest/fastest feasible refits.",refit_count,training.len(),q(&stability,0.).unwrap(),q(&stability,1.).unwrap()));
    }
    let conservative = solve_with_cancel(&k_low, ds, &cal.low, cancelled);
    let nominal = solve_with_cancel(&k_high, ds, &cal.high, cancelled);
    check()?;
    if conservative.is_none() || nominal.is_none() {
        d.rejection_reasons.push(
            "Cyclic solver failed its finite-speed or combined-grip feasibility check.".into(),
        );
    }
    let mut envelope=VehicleEnvelope{valid_lap_count:training.len(),speed_bands:vec![],observed_lateral_mps2:cal.high.lateral,conservative_lateral_mps2:cal.low.lateral,nominal_lateral_mps2:cal.high.lateral,max_observed_speed_mps:cal.high.max_speed,rpm_evidence:vec!["No reliable gear/shift identification; mandatory shift losses may be underrepresented; no separate shifting gain attributed.".into()],assumptions:d.assumptions.clone()};
    let mut band_speeds: Vec<_> = cal
        .low
        .acceleration
        .iter()
        .chain(&cal.low.braking)
        .map(|p| p.0)
        .collect();
    band_speeds.sort_by(f64::total_cmp);
    band_speeds.dedup();
    for v in band_speeds {
        envelope.speed_bands.push(SpeedBand {
            min_speed_mps: v - 1.,
            max_speed_mps: v + 1.,
            sample_count: cal
                .accel
                .iter()
                .chain(&cal.brake)
                .filter(|p| p.0 >= v - 1. && p.0 < v + 1.)
                .count(),
            observed_acceleration_mps2: capacity(&cal.high.acceleration, v),
            observed_braking_mps2: capacity(&cal.high.braking, v),
            conservative_acceleration_mps2: capacity(&cal.low.acceleration, v),
            nominal_acceleration_mps2: capacity(&cal.high.acceleration, v),
            conservative_braking_mps2: capacity(&cal.low.braking, v),
            nominal_braking_mps2: capacity(&cal.high.braking, v),
        });
    }
    if let (Some(lo), Some(hi)) = (&conservative, &nominal) {
        let (a, ae) = violations(&k_low, ds, &cal.low, lo);
        let (b, be) = violations(&k_high, ds, &cal.high, hi);
        d.validation.feasibility_violations = a + b;
        d.validation.tested_cells = 2 * n;
        d.validation.maximum_constraint_excess = ae.max(be);
        let tl = time(lo, ds);
        let th = time(hi, ds);
        let (lf, le) = unsupported(lo, ds, &cal.low);
        let (hf, he) = unsupported(hi, ds, &cal.high);
        d.dynamics_support = Some(DynamicsSupport {
            acceleration_samples: cal.accel.len(),
            braking_samples: cal.brake.len(),
            acceleration_speed_mps: [
                cal.high.acceleration[0].0 - 1.,
                cal.high.acceleration.last().unwrap().0 + 1.,
            ],
            braking_speed_mps: [
                cal.high.braking[0].0 - 1.,
                cal.high.braking.last().unwrap().0 + 1.,
            ],
            extrapolated_distance_fraction: lf.max(hf),
            maximum_speed_extrapolation_mps: le.max(he),
        });
        if lf.max(hf) > 0.2 || le.max(he) > 4. {
            d.rejection_reasons.push("Directional dynamics require nearest-band extrapolation over >20% of distance or >4 m/s beyond supported bands; capability is underidentified.".into());
        }
        if tl.min(th) < best.duration * 0.5 || tl.max(th) > best.duration * 1.5 {
            d.rejection_reasons.push("Modeled duration outside 0.5–1.5 times recording: reject unsupported calibration/alignment rather than tune capacity.".into());
        }
        // Validate against independently reconstructed heldout distance, never the
        // canonical spatial warp used for inter-lap section comparison.
        let mut squared = 0.;
        let mut count = 0;
        let mut exceed = 0;
        let mut errors = Vec::new();
        for (lap, _) in &withheld {
            check()?;
            let Some(channel) = super::sources::speed(s, lap) else {
                continue;
            };
            let speed = Speed::new(channel);
            if let Ok(a) = super::sources::analyze(s, lap, None, None) {
                if let Some(tr) = Trace::new(&a.primary) {
                    let wn = (tr.length / 2.).ceil() as usize;
                    let dx = tr.length / wn as f64;
                    let ks: Option<Vec<_>> = (0..wn)
                        .map(|i| tr.curvature(i as f64 * dx, chord))
                        .collect();
                    if let Some(ks) = ks {
                        if let Some(v) = solve_with_cancel(&ks, dx, &cal.high, cancelled) {
                            for i in 0..wn {
                                if let Some(real) = at(&tr.mapping, i as f64 * dx)
                                    .and_then(|t| speed.at(lap.start + t))
                                {
                                    squared += (v[i] - real).powi(2);
                                    count += 1;
                                    if real > v[i] + 0.5 {
                                        exceed += 1;
                                    }
                                }
                            }
                            for section in &a.segments {
                                let simulated =
                                    section_time(&v, dx, section.start_meters, section.end_meters);
                                errors.push((simulated - section.primary.elapsed).abs());
                            }
                        }
                    }
                }
            }
        }
        if count > 0 {
            d.validation.speed_rmse_mps = Some((squared / count as f64).sqrt());
            d.validation.envelope_exceedance_fraction = Some(exceed as f64 / count as f64);
        }
        if !errors.is_empty() {
            d.validation.section_time_mae_seconds =
                Some(errors.iter().sum::<f64>() / errors.len() as f64);
        }
        d.validation.notes.push("Heldout residuals compare a minimum-time bound to a human-controlled lap, not a driver predictor. Exceedance counts speeds > bound +0.5 m/s; high exceedance indicates an underidentified capability envelope, not unsafe driver behavior.".into());
        if d.validation
            .envelope_exceedance_fraction
            .is_some_and(|x| x > 0.2)
        {
            d.rejection_reasons.push("Over 20% of withheld speeds exceed the nominal capability envelope; reject underidentified calibration.".into());
            d.validation.notes.push("More than 20% of withheld samples exceed capability bound: empirical capacity is underidentified. Scenario bounds must not be represented as an achievable optimum or confidence interval.".into());
        }
        if withheld.is_empty() {
            d.validation.notes.push(
                "Too few aligned laps for independent holdout; scenario validity is unconfirmed."
                    .into(),
            );
        }
        if d.rejection_reasons.is_empty() {
            d.modeled_lap_seconds = Some(TimeRange {
                lower_seconds: tl.min(th),
                upper_seconds: tl.max(th),
            });
            d.gain_range = Some(gain(best.duration, tl, th));
        }
    }
    let publish = d.rejection_reasons.is_empty();
    let mut opportunities = Vec::new();
    let rpm = super::sources::recording(s, best).and_then(|r| {
        r.channels
            .iter()
            .find(|c| c.unit.eq_ignore_ascii_case("rpm"))
    });
    let rpm_points: Vec<_> = rpm
        .map(|r| {
            let pairs: Vec<_> = r
                .times
                .iter()
                .copied()
                .zip(r.values.iter().copied())
                .collect();
            let gaps = telemetry::source_gaps(r);
            (0..n)
                .filter_map(|i| {
                    let t = best.start + at(&trace.mapping, i as f64 * ds)?;
                    if gaps.iter().any(|g| t >= g[0] && t <= g[1]) {
                        return None;
                    }
                    at(&pairs, t).map(|v| (i as f64 * ds, v))
                })
                .collect()
        })
        .unwrap_or_default();
    for section in &base.segments {
        check()?;
        let start = section.start_meters.max(0.);
        let end = section.end_meters.min(length);
        let baseline = section.primary.elapsed;
        let excluded: Vec<_> = (0..n)
            .filter(|&i| i as f64 * ds < end && (i + 1) as f64 * ds > start && !cells[i])
            .collect();
        let lo = conservative
            .as_ref()
            .filter(|_| publish)
            .map(|v| section_time(v, ds, start, end));
        let hi = nominal
            .as_ref()
            .filter(|_| publish)
            .map(|v| section_time(v, ds, start, end));
        let range = lo.zip(hi).map(|(l, h)| gain(baseline, l, h));
        d.sections.push(PhysicsSection {
            section_id: section.id.clone(),
            label: section.label.clone(),
            start_meters: start,
            end_meters: end,
            baseline_seconds: baseline,
            conservative_seconds: lo,
            nominal_seconds: hi,
            gain_range: range.clone(),
            excluded_reasons: if !excluded.is_empty() {
                vec![format!(
                    "{} cells lack speed or reliable GPS geometry",
                    excluded.len()
                )]
            } else if !publish {
                d.rejection_reasons.clone()
            } else {
                vec![]
            },
        });
        if let Some(signed) = range.filter(|g| g.upper_seconds > 0.02) {
            let mut g = signed.clone();
            g.lower_seconds = g.lower_seconds.max(0.);
            let id = format!("physics:{}:{}", best.id, section.id);
            let indices: Vec<_> = (0..n)
                .filter(|i| *i as f64 * ds >= start && (*i as f64) * ds < end)
                .collect();
            if indices.is_empty() {
                // Exact signed timing still covers this short section; there
                // is no interior mesh evidence for a phase-specific experiment.
                continue;
            }
            let hi = nominal.as_ref().unwrap();
            let c = coaching::extract(
                &section.id,
                &section.label,
                &section.kind,
                start,
                end,
                &actual,
                hi,
                ds,
                &rpm_points,
                rpm.map(|r| r.id.as_str()),
            );
            opportunities.push(Opportunity{coaching:Some(c.details),id,lap_id:best.id.clone(),reference_lap_id:best.id.clone(),section_id:Some(section.id.clone()),label:section.label.clone(),kind:"physics".into(),start_time:best.start+at(&trace.mapping,start).unwrap_or(0.),end_time:best.start+at(&trace.mapping,end).unwrap_or(best.duration),start_meters:Some(start),end_meters:Some(end),observed_loss_seconds:None,estimated_gain_seconds:None,modeled_gain:Some(ModeledGain{lower_seconds:g.lower_seconds,upper_seconds:g.upper_seconds,assumption:g.assumption.clone(),method:g.method.clone(),reference_lap_id:None}),gain_range:Some(g.clone()),faster_example_count:0,confidence:"low".into(),status:"investigate".into(),priority_score:g.lower_seconds.max(0.)+g.upper_seconds.max(0.)*0.25,evidence:{let mut facts=c.facts; facts.push(Evidence{id:format!("physics:{}:time",section.id),metric:"Signed section time in continuous full-lap scenario".into(),unit:"s".into(),lap_value:baseline,reference_value:d.sections.last().and_then(|s|s.nominal_seconds),channel_ids:vec!["gps-speed".into()]});facts},observation:c.observation,action:c.action,uncertainty:"Demand-derived calibration does not establish absolute grip or engine limits; range includes geometry and sustained-demand quantile sensitivity. Negative section costs elsewhere must be retained.".into()});
        }
    }
    opportunities.sort_by(|a, b| b.priority_score.total_cmp(&a.priority_score));
    let mut profiles = Vec::new();
    if publish {
        if let (Some(lo), Some(hi)) = (conservative, nominal) {
            let mut points: Vec<_> = (0..n)
                .map(|i| SimulatedPoint {
                    meters: i as f64 * ds,
                    baseline_speed_mps: actual[i],
                    conservative_speed_mps: lo[i],
                    nominal_speed_mps: hi[i],
                    curvature_per_meter: k_high[i],
                })
                .collect();
            points.push(SimulatedPoint {
                meters: length,
                baseline_speed_mps: actual_finish.unwrap_or(actual[0]),
                conservative_speed_mps: lo[0],
                nominal_speed_mps: hi[0],
                curvature_per_meter: k_high[0],
            });
            profiles.push(SimulatedProfile {
                opportunity_id: "physics-full-lap".into(),
                strategy: "full-lap".into(),
                start_meters: 0.,
                end_meters: length,
                baseline_seconds: d.baseline_integrated_seconds,
                recorded_seconds: best.duration,
                conservative_seconds: time(&lo, ds),
                nominal_seconds: time(&hi, ds),
                points,
                assumptions: d.assumptions.clone(),
            });
        }
    }
    Ok(FullLapResult {
        diagnostics: d,
        opportunities,
        profiles,
        calibrated_envelope: Some(envelope),
    })
}

#[cfg(test)]
mod recording_tests {
    use super::*;
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_purdue_recordings_report_full_lap_physics_and_holdout_residuals() {
        for file in ["0361", "0362"] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "../data/yash dalal_59_PURDUE GP IN_Warm-up_a_{file}.xrk"
            ));
            let session = telemetry::parse_session(&path).unwrap();
            let mut laps: Vec<_> = session
                .laps
                .iter()
                .filter(|l| super::super::analysis::valid(l))
                .collect();
            laps.sort_by(|a, b| a.duration.total_cmp(&b.duration));
            let best = laps[0];
            let base =
                telemetry::analyze_with_boundaries(&session, &best.id, None, "time", &[], None)
                    .unwrap();
            let owned: Vec<_> = laps
                .iter()
                .filter_map(|lap| {
                    telemetry::analyze_with_boundaries(&session, &lap.id, None, "time", &[], None)
                        .ok()
                        .map(|a| (*lap, a.primary))
                })
                .collect();
            let views: Vec<_> = owned.iter().map(|(l, v)| (*l, v)).collect();
            let result = analyze(&session, &base, best, &views, 1., &|| false).unwrap();
            for opportunity in &result.opportunities {
                assert!(opportunity.start_time >= best.start && opportunity.end_time <= best.end);
                assert!(opportunity.end_time > opportunity.start_time);
                assert!(opportunity.coaching.is_some());
                assert!(opportunity.evidence.iter().all(
                    |e| e.lap_value.is_finite() && e.reference_value.is_none_or(f64::is_finite)
                ));
                let gap = opportunity
                    .evidence
                    .iter()
                    .find(|e| e.metric == "peakProfileGapLocation")
                    .unwrap()
                    .lap_value;
                assert!(
                    gap >= opportunity.start_meters.unwrap()
                        && gap <= opportunity.end_meters.unwrap()
                );
                assert!(opportunity.action.contains("Review the speed trace near"));
            }
            println!(
                "PHYSICS {file}: {}",
                serde_json::to_string(&result.diagnostics).unwrap()
            );
            assert!(result.diagnostics.coverage_fraction > 0.99);
            assert!(
                result.diagnostics.rejection_reasons.is_empty(),
                "{:?}",
                result.diagnostics.rejection_reasons
            );
            assert_eq!(result.diagnostics.validation.feasibility_violations, 0);
            assert!(!result.diagnostics.validation.withheld_lap_ids.is_empty());
            assert!(result.diagnostics.validation.speed_rmse_mps.is_some());
            let p = &result.profiles[0];
            assert!(
                (p.points.first().unwrap().nominal_speed_mps
                    - p.points.last().unwrap().nominal_speed_mps)
                    .abs()
                    < 1e-9
            );
            let sum: f64 = result
                .diagnostics
                .sections
                .iter()
                .map(|s| s.baseline_seconds - s.nominal_seconds.unwrap())
                .sum();
            assert!(
                (sum - (best.duration - p.nominal_seconds)).abs() < 0.01,
                "signed disjoint cells must reconcile"
            );
            assert!(result
                .opportunities
                .iter()
                .any(|o| o.section_id.as_deref() != Some("corner-1")));
        }
    }
}

fn unavailable(mut d: FullLapDiagnostics, reason: &str) -> FullLapResult {
    d.rejection_reasons.push(reason.into());
    FullLapResult {
        diagnostics: d,
        opportunities: vec![],
        profiles: vec![],
        calibrated_envelope: None,
    }
}

/// Reject isolated upper-tail GPS-derived demand spikes without manufacturing a limit.
fn robust(values: &[f64]) -> Vec<f64> {
    let Some(m) = q(values, 0.5) else {
        return vec![];
    };
    let deviations: Vec<_> = values.iter().map(|v| (v - m).abs()).collect();
    let mad = q(&deviations, 0.5).unwrap_or(0.);
    let cutoff = m + (6. * mad).max(m.abs() * 0.25);
    values
        .iter()
        .copied()
        .filter(|v| v.is_finite() && *v <= cutoff)
        .collect()
}

fn unsupported(v: &[f64], ds: f64, c: &Capability) -> (f64, f64) {
    let mut count = 0;
    let mut worst = 0_f64;
    for i in 0..v.len() {
        let j = (i + 1) % v.len();
        let a = (v[j] * v[j] - v[i] * v[i]) / (2. * ds);
        if a.abs() < 0.02 {
            continue;
        }
        let curve = if a > 0. { &c.acceleration } else { &c.braking };
        let low = curve[0].0 - 1.;
        let high = curve.last().unwrap().0 + 1.;
        let excess = (low - v[i].min(v[j])).max(v[i].max(v[j]) - high).max(0.);
        if excess > 1e-6 {
            count += 1;
        }
        worst = worst.max(excess);
    }
    (count as f64 / v.len() as f64, worst)
}

#[cfg(test)]
mod physical_regressions {
    use super::*;
    #[test]
    fn dense_independent_ellipse_check_includes_interior_capacity_dips() {
        let c = Capability {
            acceleration: vec![(5., 3.), (10., 0.8), (15., 2.5), (30., 1.)],
            braking: vec![(5., 2.), (12., 5.), (18., 1.2), (30., 6.)],
            lateral: 9.,
            max_speed: 28.,
        };
        let k: Vec<_> = (0..180)
            .map(|i| 0.002 + 0.07 * ((i as f64 / 17.).sin().max(0.)).powi(4))
            .collect();
        let ds = 2.;
        let v = solve(&k, ds, &c).unwrap();
        for i in 0..v.len() {
            let j = (i + 1) % v.len();
            let ax = (v[j] * v[j] - v[i] * v[i]) / (2. * ds);
            for sample in 0..101 {
                let f = sample as f64 / 100.;
                let speed = (v[i] * v[i] + f * (v[j] * v[j] - v[i] * v[i])).sqrt();
                let curvature = k[i] + f * (k[j] - k[i]);
                // This calculation independently samples continuous v², interpolated
                // curvature and the directional curve rather than solver violations().
                let long = capacity(if ax < 0. { &c.braking } else { &c.acceleration }, speed);
                let utilization =
                    (ax / long).powi(2) + (speed * speed * curvature / c.lateral).powi(2);
                assert!(
                    utilization <= 1. + 1e-6,
                    "cell{i} sample{sample}: {utilization}"
                );
            }
        }
        assert_eq!(allowance(&c, 8., 22., 0., true), 1.2);
    }
    #[test]
    fn geometry_gap_between_all_three_chord_samples_is_rejected() {
        let trace = Trace {
            mapping: vec![(0., 0.), (100., 100.)],
            x: vec![(0., 0.), (100., 100.)],
            y: vec![(0., 0.), (100., 0.)],
            breaks: vec![(42., 44.)],
            break_meters: Some(vec![(42., 44.)]),
            length: 100.,
        };
        assert!(
            trace.point(38.).is_some() && trace.point(50.).is_some() && trace.point(62.).is_some()
        );
        assert!(trace.curvature(50., 12.).is_none());
        assert!(!trace.closed(10.));
        let seam_gap = Trace {
            breaks: vec![(97., 99.)],
            break_meters: Some(vec![(97., 99.)]),
            ..trace
        };
        assert!(seam_gap.curvature(3., 10.).is_none());
    }
    #[test]
    fn speed_gap_between_mesh_samples_is_not_bridged() {
        let speed = Speed {
            raw: vec![(0., 10.), (1., 10.)],
            gaps: vec![[0.4, 0.45]],
        };
        assert!(speed.at(0.2).is_some() && speed.at(0.6).is_some());
        assert!(!speed.continuous(0.2, 0.6));
        assert!(speed.continuous(0., 0.4));
    }
    #[test]
    fn isolated_demand_glitches_do_not_set_calibrated_capacity() {
        let clean: Vec<_> = (0..100)
            .map(|i| (13., 1. + (i % 7) as f64 * 0.01))
            .collect();
        let mut noisy = clean.clone();
        noisy.push((13., 10.));
        assert_eq!(curve(&clean, 0.98), curve(&noisy, 0.98));
        let lat: Vec<_> = (0..100).map(|i| 8. + (i % 7) as f64 * 0.05).collect();
        let mut noisy = lat.clone();
        noisy.push(24.);
        assert_eq!(q(&robust(&lat), 0.995), q(&robust(&noisy), 0.995));
    }
    #[test]
    fn signed_partition_preserves_a_slower_section_cost() {
        let base = vec![10.; 4];
        let model = vec![8., 8., 16., 16.];
        let ds = 10.;
        let first = section_time(&base, ds, 0., 20.) - section_time(&model, ds, 0., 20.);
        let second = section_time(&base, ds, 20., 40.) - section_time(&model, ds, 20., 40.);
        assert!(first < 0. && second > 0.);
        assert!((first + second - (time(&base, ds) - time(&model, ds))).abs() < 1e-10);
        assert!(first.max(0.) + second.max(0.) > first + second);
    }
}
