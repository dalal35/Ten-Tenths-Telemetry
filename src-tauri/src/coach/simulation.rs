//! Distance-domain capability scenarios. Every number is calculated outside inference.
use super::{
    modeled::{at, curvature},
    types::*,
};
use crate::telemetry::{self, Lap, LapView, Session};

fn quantile(values: &[f64], fraction: f64) -> Option<f64> {
    let mut values: Vec<_> = values.iter().copied().filter(|v| v.is_finite()).collect();
    values.sort_by(f64::total_cmp);
    (!values.is_empty()).then(|| values[((values.len() - 1) as f64 * fraction).round() as usize])
}
fn supported_band(accel: &[f64], brake: &[f64]) -> bool {
    accel.len() >= 8 && brake.len() >= 8
}
fn geometry(view: &LapView, x: f64, chord: f64) -> Option<f64> {
    // Two independent spatial scales suppress GPS spikes; larger demand wins.
    Some(curvature(view, x, chord)?.max(curvature(view, x, chord * 1.5)?))
}
pub(super) fn envelope(
    s: &Session,
    views: &[(&Lap, &LapView)],
    uncertainty: f64,
) -> Option<VehicleEnvelope> {
    let chord = 10_f64.max(3. * uncertainty);
    let mut accel = vec![Vec::new(); 16];
    let mut brake = vec![Vec::new(); 16];
    let mut lateral = Vec::new();
    let mut lateral_conservative = Vec::new();
    let mut lateral_nominal = Vec::new();
    let mut speeds = Vec::new();
    let mut rpm_windows = Vec::new();
    for (lap, view) in views {
        let Some(source) = super::sources::recording(s, lap) else {
            continue;
        };
        let Some(speed) = super::sources::speed(s, lap) else {
            continue;
        };
        let gaps = telemetry::source_gaps(speed);
        let rpm_channel = source
            .channels
            .iter()
            .find(|c| c.unit.eq_ignore_ascii_case("rpm"));
        let rpm_raw: Vec<_> = rpm_channel
            .map(|c| {
                c.times
                    .iter()
                    .copied()
                    .zip(c.values.iter().copied())
                    .collect()
            })
            .unwrap_or_default();
        let rpm_gaps = rpm_channel.map(telemetry::source_gaps).unwrap_or_default();
        let mut lap_lateral = Vec::new();
        let mut next_time = lap.start;
        for (i, (&t, &v)) in speed.times.iter().zip(&speed.values).enumerate() {
            if t < next_time || t < lap.start || t > lap.end || !v.is_finite() || v <= 1. {
                continue;
            }
            let j = speed.times.partition_point(|u| *u < t + 0.4);
            let Some((&end, &last)) = speed.times.get(j).zip(speed.values.get(j)) else {
                continue;
            };
            if end > lap.end
                || end - t > 0.65
                || !last.is_finite()
                || gaps.iter().any(|g| t < g[1] && end > g[0])
            {
                continue;
            }
            next_time = end; // sustained, nonoverlapping windows; cadence cannot multiply evidence
            speeds.push(v);
            let a = (last - v) / (end - t);
            let band = ((v / 4.).floor() as usize).min(15);
            if a > 0.05 && a < 12. && !rpm_gaps.iter().any(|g| t < g[1] && end > g[0]) {
                if let Some(rpm) =
                    at(&rpm_raw, (t + end) * 0.5).filter(|rpm| rpm.is_finite() && *rpm > 0.)
                {
                    rpm_windows.push((band, a, rpm));
                }
            }
            if a > 0.05 && a < 12. {
                accel[band].push(a);
            }
            if a < -0.05 && a > -20. {
                brake[band].push(-a);
            }
            let map: Vec<_> = view.mapping.iter().map(|p| (p.time, p.meters)).collect();
            if let Some(x) = at(&map, (t + end) * 0.5 - lap.start) {
                if let Some(k) = geometry(view, x, chord) {
                    let ay = ((v + last) * 0.5).powi(2) * k;
                    if ay.is_finite() && ay > 0.5 && ay < 25. {
                        lateral.push(ay);
                        lap_lateral.push(ay);
                    }
                }
            }
            let _ = i;
        }
        // Grip capacity comes from the sustained upper tail of each lap, rather
        // than quantiles dominated by straight or mild-corner driving demand.
        if lap_lateral.len() >= 12 {
            lateral_conservative.push(quantile(&lap_lateral, 0.9)?);
            lateral_nominal.push(quantile(&lap_lateral, 0.95)?);
        }
    }
    // Sparse bands are explicitly unsupported: no global propulsion extrapolation.
    let mut bands = Vec::new();
    for i in 0..16 {
        if !supported_band(&accel[i], &brake[i]) {
            continue;
        }
        bands.push(SpeedBand {
            min_speed_mps: i as f64 * 4.,
            max_speed_mps: (i + 1) as f64 * 4.,
            sample_count: accel[i].len() + brake[i].len(),
            observed_acceleration_mps2: quantile(&accel[i], 0.9)?,
            observed_braking_mps2: quantile(&brake[i], 0.9)?,
            conservative_acceleration_mps2: quantile(&accel[i], 0.75)?,
            nominal_acceleration_mps2: quantile(&accel[i], 0.9)?,
            conservative_braking_mps2: quantile(&brake[i], 0.75)?,
            nominal_braking_mps2: quantile(&brake[i], 0.9)?,
        });
    }
    if bands.is_empty() || lateral.len() < 12 {
        return None;
    }
    let mut rpm_evidence = vec!["RPM does not identify torque, throttle, engine powerband or a recoverable shift duration; no numerical shifting gain is inferred.".into()];
    let values: Vec<_> = views
        .iter()
        .flat_map(|(lap, _)| {
            super::sources::recording(s, lap)
                .into_iter()
                .flat_map(move |source| {
                    source
                        .channels
                        .iter()
                        .filter(|c| c.unit.eq_ignore_ascii_case("rpm"))
                        .flat_map(move |c| {
                            c.times
                                .iter()
                                .zip(&c.values)
                                .filter(move |(t, v)| {
                                    **t >= lap.start && **t <= lap.end && v.is_finite() && **v > 0.
                                })
                                .map(|(_, v)| *v)
                        })
                })
        })
        .collect();
    if let (Some(lo), Some(hi)) = (quantile(&values, 0.1), quantile(&values, 0.9)) {
        rpm_evidence.push(format!("Valid-lap RPM central 80%: {lo:.0}–{hi:.0}; RPM interruption and recovery evidence is available in section assessments."));
    }
    for b in &bands {
        let windows: Vec<_> = rpm_windows
            .iter()
            .filter(|(band, _, _)| *band as f64 * 4. == b.min_speed_mps)
            .collect();
        if windows.len() < 12 {
            continue;
        }
        let rpms: Vec<_> = windows.iter().map(|(_, _, rpm)| *rpm).collect();
        let split = quantile(&rpms, 0.5)?;
        let low: Vec<_> = windows
            .iter()
            .filter(|(_, _, rpm)| *rpm <= split)
            .map(|(_, a, _)| *a)
            .collect();
        let high: Vec<_> = windows
            .iter()
            .filter(|(_, _, rpm)| *rpm > split)
            .map(|(_, a, _)| *a)
            .collect();
        if low.len() >= 4 && high.len() >= 4 {
            rpm_evidence.push(format!("At {:.0}–{:.0} m/s: {} independent propulsion windows; median acceleration below/above {split:.0} RPM = {:.2}/{:.2} m/s². Association is confounded by throttle, gear and corner grip; no torque curve or shift saving is inferred.",b.min_speed_mps,b.max_speed_mps,windows.len(),quantile(&low,0.5)?,quantile(&high,0.5)?));
        }
    }
    Some(VehicleEnvelope { valid_lap_count:views.len(), speed_bands:bands,
        observed_lateral_mps2:quantile(&lateral_nominal,0.5)?, conservative_lateral_mps2:quantile(&lateral_conservative,0.5)?, nominal_lateral_mps2:quantile(&lateral_nominal,0.5)?, max_observed_speed_mps:quantile(&speeds,0.99)?, rpm_evidence,
        assumptions:vec!["Observed sustained 0.4–0.65 s windows across spatially valid laps, sampled without overlap. Speed bands require eight acceleration and eight deceleration windows; nearest-rank q90 excludes a single extreme maximum.".into(),"Potential means sustained use of the session's robust propulsion, braking and lateral capability scenarios, not the vehicle's absolute limit. No external record, gain floor or capability uplift is used.".into(),"GPS curvature uses 10 m or 3×position uncertainty chords and a second 1.5× scale. Lateral estimates remain conditional on GPS line and comparable grip; no tire model is measured.".into(),"Lateral sensitivity uses median valid-lap 90th/95th percentile sustained demand; propulsion/braking uses 75th/90th percentile speed bands. This is not a confidence interval. Wind, driver inputs, RPM-dependent torque and track limits are unmeasured.".into()] })
}
#[cfg(test)]
fn capacity(e: &VehicleEnvelope, speed: f64, nominal: bool, braking: bool) -> Option<f64> {
    let b = e
        .speed_bands
        .iter()
        .find(|b| speed >= b.min_speed_mps && speed <= b.max_speed_mps)?;
    Some(match (nominal, braking) {
        (true, true) => b.nominal_braking_mps2,
        (false, true) => b.conservative_braking_mps2,
        (true, false) => b.nominal_acceleration_mps2,
        (false, false) => b.conservative_acceleration_mps2,
    })
}
#[cfg(test)]
fn longitudinal(
    e: &VehicleEnvelope,
    speed: f64,
    k: f64,
    nominal: bool,
    braking: bool,
) -> Option<f64> {
    let grip = if nominal {
        e.nominal_lateral_mps2
    } else {
        e.conservative_lateral_mps2
    };
    Some(
        capacity(e, speed, nominal, braking)?
            * (1. - (speed * speed * k / grip).powi(2)).max(0.).sqrt(),
    )
}
#[cfg(test)]
fn reachable(
    e: &VehicleEnvelope,
    low: f64,
    high: f64,
    k: f64,
    dx: f64,
    nominal: bool,
    braking: bool,
) -> Option<f64> {
    // Solve acceleration at the reachable speed itself. Using the unprojected cap
    // in the friction ellipse would falsely remove all propulsion at corner limits.
    let mut a = low;
    let mut b = high;
    for _ in 0..45 {
        let mid = (a + b) * 0.5;
        let limit = longitudinal(e, mid, k, nominal, braking)?;
        if mid * mid - low * low <= 2. * limit * dx {
            a = mid;
        } else {
            b = mid;
        }
    }
    Some(a)
}
/// Lower-only alternating projection, then independently validate each spatial cell.
#[cfg(test)]
fn solve(
    x: &[f64],
    k: &[f64],
    caps: &[f64],
    initial: f64,
    terminal: f64,
    e: &VehicleEnvelope,
    nominal: bool,
) -> Option<Vec<f64>> {
    if x.len() < 3
        || x.len() != k.len()
        || x.len() != caps.len()
        || x.windows(2).any(|w| w[1] <= w[0])
    {
        return None;
    }
    let mut v = caps.to_vec();
    if initial > v[0] + 1e-7 || terminal > *v.last()? + 1e-7 {
        return None;
    }
    v[0] = initial;
    let last = v.len() - 1;
    v[last] = terminal;
    for _ in 0..120 {
        let previous = v.clone();
        for i in 1..v.len() {
            if v[i] > v[i - 1] {
                v[i] = reachable(
                    e,
                    v[i - 1],
                    v[i],
                    k[i - 1].max(k[i]),
                    x[i] - x[i - 1],
                    nominal,
                    false,
                )?;
            }
        }
        for i in (0..last).rev() {
            if v[i] > v[i + 1] {
                v[i] = reachable(
                    e,
                    v[i + 1],
                    v[i],
                    k[i].max(k[i + 1]),
                    x[i + 1] - x[i],
                    nominal,
                    true,
                )?;
            }
        }
        if (v[0] - initial).abs() > 1e-6 || (v[last] - terminal).abs() > 1e-6 {
            return None;
        }
        if v.iter().zip(previous).all(|(a, b)| (*a - b).abs() < 1e-8) {
            break;
        }
    }
    if !feasible(x, k, &v, e, nominal) {
        return None;
    }
    Some(v)
}
#[cfg(test)]
fn feasible(x: &[f64], k: &[f64], v: &[f64], e: &VehicleEnvelope, nominal: bool) -> bool {
    let grip = if nominal {
        e.nominal_lateral_mps2
    } else {
        e.conservative_lateral_mps2
    };
    if v.iter()
        .zip(k)
        .any(|(v, k)| !v.is_finite() || *v <= 0. || v * v * k > grip + 1e-6)
    {
        return false;
    }
    (1..v.len()).all(|i| {
        let a = (v[i] * v[i] - v[i - 1] * v[i - 1]) / (2. * (x[i] - x[i - 1]));
        longitudinal(e, v[i].max(v[i - 1]), k[i].max(k[i - 1]), nominal, a < 0.)
            .is_some_and(|limit| a.abs() <= limit + 1e-6)
    })
}
/// Exact traversal time for piecewise constant acceleration (linear v² in distance).
#[cfg(test)]
fn seconds(x: &[f64], v: &[f64]) -> f64 {
    (1..v.len())
        .map(|i| 2. * (x[i] - x[i - 1]) / (v[i] + v[i - 1]))
        .sum()
}

#[cfg(test)]
fn timing_consistent(baseline: f64, recorded: f64) -> bool {
    baseline.is_finite()
        && recorded.is_finite()
        && recorded > 0.
        && (baseline - recorded).abs() <= 0.05_f64.max(recorded * 0.04)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vehicle() -> VehicleEnvelope {
        VehicleEnvelope {
            valid_lap_count: 4,
            speed_bands: vec![SpeedBand {
                min_speed_mps: 0.,
                max_speed_mps: 50.,
                sample_count: 100,
                observed_acceleration_mps2: 3.,
                observed_braking_mps2: 5.,
                conservative_acceleration_mps2: 2.,
                nominal_acceleration_mps2: 3.,
                conservative_braking_mps2: 4.,
                nominal_braking_mps2: 5.,
            }],
            observed_lateral_mps2: 12.,
            conservative_lateral_mps2: 10.,
            nominal_lateral_mps2: 12.,
            max_observed_speed_mps: 30.,
            rpm_evidence: vec![],
            assumptions: vec![],
        }
    }
    #[test]
    fn sparse_envelope_band_and_isolated_capacity_spike_are_rejected() {
        assert!(!supported_band(&[1.; 7], &[2.; 8]));
        assert!(!supported_band(&[1.; 8], &[2.; 7]));
        assert!(supported_band(&[1.; 8], &[2.; 8]));
        let clean = vec![1., 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7];
        let mut spike = clean.clone();
        spike[7] = 11.9;
        assert_eq!(quantile(&clean, 0.9), quantile(&spike, 0.9));
        assert_eq!(quantile(&clean, 0.75), quantile(&spike, 0.75));
    }
    #[test]
    fn exact_constant_acceleration_time_and_invalid_geometry() {
        let x = vec![0., 50., 100.];
        let v = vec![10., 200_f64.sqrt(), 300_f64.sqrt()];
        assert!((seconds(&x, &v) - (300_f64.sqrt() - 10.)).abs() < 1e-10);
        assert!(solve(
            &[0., 0., 100.],
            &[0.; 3],
            &[20.; 3],
            10.,
            10.,
            &vehicle(),
            true
        )
        .is_none());
        assert!(solve(
            &[0., 50., 100.],
            &[0.; 3],
            &[9.; 3],
            10.,
            10.,
            &vehicle(),
            true
        )
        .is_none());
    }
    #[test]
    fn optimal_profile_has_no_gain_and_enforces_braking_acceleration() {
        let x: Vec<_> = (0..=100).map(|i| i as f64).collect();
        let k = vec![0.; x.len()];
        let caps = vec![30.; x.len()];
        let e = vehicle();
        let v = solve(&x, &k, &caps, 10., 10., &e, true).unwrap();
        assert!(feasible(&x, &k, &v, &e, true));
        assert_eq!(v[0], 10.);
        assert_eq!(*v.last().unwrap(), 10.);
        let again = solve(&x, &k, &v, 10., 10., &e, true).unwrap();
        assert!((seconds(&x, &v) - seconds(&x, &again)).abs() < 1e-8);
        assert!(seconds(&x, &v) < 10.);
        let peak = ((2. * 3. * 5. * 100. + 5. * 100. + 3. * 100.) / (3. + 5.) as f64).sqrt();
        let analytic = (peak - 10.) / 3. + (peak - 10.) / 5.;
        assert!(
            (seconds(&x, &v) - analytic).abs() < 0.002,
            "bang-bang simulation agrees with exact full-interval time"
        );
        assert!(!timing_consistent(10., 20.));
        assert!(timing_consistent(10., 10.02));
        assert!(v.windows(2).any(|w| w[1] > w[0]));
        assert!(v.windows(2).any(|w| w[1] < w[0]));
    }
    #[test]
    fn combined_grip_and_sensitivity_are_checked_at_every_cell() {
        let x: Vec<_> = (0..=100).map(|i| i as f64).collect();
        let k: Vec<_> = x
            .iter()
            .map(|x| if *x > 25. && *x < 65. { 0.035 } else { 0. })
            .collect();
        let e = vehicle();
        let solve_for = |nominal| {
            let grip = if nominal {
                e.nominal_lateral_mps2
            } else {
                e.conservative_lateral_mps2
            };
            let cap: Vec<_> = k
                .iter()
                .map(|k| if *k > 0. { (grip / k).sqrt() } else { 30. })
                .collect();
            solve(&x, &k, &cap, 10., 10., &e, nominal).unwrap()
        };
        let conservative = solve_for(false);
        let nominal = solve_for(true);
        assert!(feasible(&x, &k, &conservative, &e, false));
        assert!(feasible(&x, &k, &nominal, &e, true));
        assert!(seconds(&x, &nominal) < seconds(&x, &conservative));
        let mut impossible = nominal.clone();
        impossible[50] = 30.;
        assert!(!feasible(&x, &k, &impossible, &e, true));
    }
    #[test]
    fn complete_downstream_timing_includes_endpoint_braking_cost() {
        let e = vehicle();
        let x: Vec<_> = (0..=150).map(|i| i as f64).collect();
        let k = vec![0.; x.len()];
        let candidate = solve(&x, &k, &vec![25.; x.len()], 10., 10., &e, true).unwrap();
        let mut base = candidate.clone();
        for i in 0..=40 {
            base[i] = 10.;
        }
        // Quantify full interval rather than the minimum alone, including terminal state.
        assert!(seconds(&x, &base) - seconds(&x, &candidate) > 0.1);
        assert_eq!(candidate.first(), candidate.last());
        let sparse = VehicleEnvelope {
            speed_bands: vec![],
            ..e
        };
        assert!(solve(&x, &k, &vec![25.; x.len()], 10., 10., &sparse, true).is_none());
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_actual_envelope_rejects_gaps_and_resists_an_isolated_speed_spike() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut s = telemetry::parse_session(&path).unwrap();
        let clean = super::super::analysis::analyze(&s, None, None)
            .unwrap()
            .performance_envelope
            .unwrap();
        let first = s
            .laps
            .iter()
            .find(|l| super::super::analysis::valid(l))
            .unwrap()
            .clone();
        let speed = s.channels.iter_mut().find(|c| c.id == "gps-speed").unwrap();
        let i = speed.times.partition_point(|t| *t < first.start + 1.);
        speed.values[i] += 3.5; // brief GPS glitch: sustained derivative can still pass hard sanity checks
        let noisy = super::super::analysis::analyze(&s, None, None)
            .unwrap()
            .performance_envelope
            .unwrap();
        for b in &clean.speed_bands {
            let n = noisy
                .speed_bands
                .iter()
                .find(|n| n.min_speed_mps == b.min_speed_mps)
                .unwrap();
            assert!(
                (b.nominal_acceleration_mps2 - n.nominal_acceleration_mps2).abs()
                    <= b.nominal_acceleration_mps2 * 0.1
            );
            assert!(
                (b.nominal_braking_mps2 - n.nominal_braking_mps2).abs()
                    <= b.nominal_braking_mps2 * 0.1
            );
        }
        let speed = s.channels.iter_mut().find(|c| c.id == "gps-speed").unwrap();
        speed.gaps = vec![[*speed.times.first().unwrap(), *speed.times.last().unwrap()]];
        let missing = super::super::analysis::analyze(&s, None, None).unwrap();
        assert!(missing.performance_envelope.is_none());
        assert!(missing.simulated_profiles.is_empty());
    }
}
