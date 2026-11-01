use super::types::ModeledGain;
use crate::telemetry::{self, Channel, Lap, LapView, Session};

fn valid_profile(p: &[(f64, f64)]) -> bool {
    p.len() >= 2
        && p.iter()
            .all(|(x, v)| x.is_finite() && v.is_finite() && *v > 0.)
        && p.windows(2).all(|w| w[1].0 > w[0].0)
}
pub(super) fn at(p: &[(f64, f64)], x: f64) -> Option<f64> {
    if !x.is_finite() || x < p.first()?.0 || x > p.last()?.0 {
        return None;
    }
    let i = p.partition_point(|p| p.0 < x);
    if p.get(i)?.0 == x {
        return Some(p[i].1);
    }
    let (a, b) = (p.get(i.checked_sub(1)?)?, p.get(i)?);
    (b.0 > a.0).then(|| a.1 + (b.1 - a.1) * (x - a.0) / (b.0 - a.0))
}
/// Midpoint integration at <=0.1m resolution, with raw knots retained.
fn saved_seconds(base: &[(f64, f64)], model: &[(f64, f64)]) -> Option<f64> {
    if !valid_profile(base)
        || !valid_profile(model)
        || base.first()?.0 != model.first()?.0
        || base.last()?.0 != model.last()?.0
    {
        return None;
    }
    let mut knots: Vec<_> = base.iter().chain(model).map(|p| p.0).collect();
    knots.sort_by(f64::total_cmp);
    knots.dedup();
    let mut result = 0.;
    for w in knots.windows(2) {
        let n = ((w[1] - w[0]) / 0.1).ceil().max(1.) as usize;
        for i in 0..n {
            let dx = (w[1] - w[0]) / n as f64;
            let x = w[0] + (i as f64 + 0.5) * dx;
            result += dx * (1. / at(base, x)? - 1. / at(model, x)?);
        }
    }
    (result.is_finite() && result > 1e-9).then_some(result)
}
#[cfg(test)]
fn integrate(base: &[(f64, f64)], support: &[(f64, f64)]) -> Option<(f64, f64)> {
    if !valid_profile(base)
        || !valid_profile(support)
        || base.first()?.0 != support.first()?.0
        || base.last()?.0 != support.last()?.0
    {
        return None;
    }
    let mut knots: Vec<_> = base.iter().chain(support).map(|p| p.0).collect();
    knots.sort_by(f64::total_cmp);
    knots.dedup();
    // Preserve the exact positive envelope where two linear profiles cross.
    let mut crossings = Vec::new();
    for w in knots.windows(2) {
        let a = at(support, w[0])? - at(base, w[0])?;
        let b = at(support, w[1])? - at(base, w[1])?;
        if a * b < 0. {
            crossings.push(w[0] + (w[1] - w[0]) * (-a) / (b - a));
        }
    }
    knots.extend(crossings);
    knots.sort_by(f64::total_cmp);
    knots.dedup();
    let scenario = |fraction: f64| -> Option<Vec<(f64, f64)>> {
        knots
            .iter()
            .map(|&x| {
                let v = at(base, x)?;
                Some((x, v + fraction * (at(support, x)? - v).max(0.)))
            })
            .collect()
    };
    Some((
        saved_seconds(base, &scenario(0.5)?)?,
        saved_seconds(base, &scenario(1.)?)?,
    ))
}
pub(super) fn profile(
    channel: &Channel,
    view: &LapView,
    lap: &Lap,
    start: f64,
    end: f64,
) -> Option<Vec<(f64, f64)>> {
    if channel.unit != "m/s" || !start.is_finite() || !end.is_finite() || end <= start {
        return None;
    }
    let mapping: Vec<_> = view
        .mapping
        .iter()
        .map(|p| (p.meters, p.time + lap.start))
        .collect();
    if mapping.len() < 2
        || mapping.iter().any(|p| !p.0.is_finite() || !p.1.is_finite())
        || mapping
            .windows(2)
            .any(|w| w[1].0 <= w[0].0 || w[1].1 <= w[0].1)
    {
        return None;
    }
    let (a, b) = (at(&mapping, start)?, at(&mapping, end)?);
    if telemetry::source_gaps(channel)
        .iter()
        .any(|g| a < g[1] && b > g[0])
        || view.track.windows(2).any(|w| {
            w[1].break_before && a < w[1].position + lap.start && b > w[0].position + lap.start
        })
    {
        return None;
    }
    let raw: Vec<_> = channel
        .times
        .iter()
        .copied()
        .zip(channel.values.iter().copied())
        .collect();
    if raw.len() < 2 || raw.windows(2).any(|w| w[1].0 <= w[0].0) {
        return None;
    }
    let inverse: Vec<_> = mapping.iter().map(|&(m, t)| (t, m)).collect();
    let mut result = vec![(start, at(&raw, a)?)];
    for &(t, v) in &raw {
        if t > a && t < b {
            result.push((at(&inverse, t)?, v));
        }
    }
    result.push((end, at(&raw, b)?));
    (result.len() >= 3 && valid_profile(&result)).then_some(result)
}
pub(super) fn tradeoff(
    s: &Session,
    primary: &LapView,
    comparison: &LapView,
    best: &Lap,
    support: &Lap,
    start: f64,
    end: f64,
    position_uncertainty: f64,
) -> Option<ModeledGain> {
    let c = super::sources::speed(s, best)?;
    let supporting_channel = super::sources::speed(s, support)?;
    let baseline = profile(c, primary, best, start, end)?;
    let supporting = profile(supporting_channel, comparison, support, start, end)?;
    // Positive-only envelopes discard the cost of a different entry/apex strategy.
    // Retain its complete speed tradeoff and restore both baseline boundaries.
    let scenario = |fraction: f64| -> Option<Vec<(f64, f64)>> {
        let mut knots: Vec<_> = baseline.iter().chain(&supporting).map(|p| p.0).collect();
        knots.sort_by(f64::total_cmp);
        knots.dedup();
        knots
            .iter()
            .map(|&x| {
                let taper = (std::f64::consts::PI * (x - start) / (end - start))
                    .sin()
                    .powi(2);
                Some((
                    x,
                    at(&baseline, x)?
                        + fraction * taper * (at(&supporting, x)? - at(&baseline, x)?),
                ))
            })
            .collect()
    };
    let mut lower = scenario(0.25)?;
    let mut upper = scenario(0.5)?;
    lateral_cap(primary, &baseline, &mut lower, position_uncertainty)?;
    lateral_cap(primary, &baseline, &mut upper, position_uncertainty)?;
    let budget = acceleration_budget(c, best, &baseline)?;
    if peak_acceleration(&lower)? > budget || peak_acceleration(&upper)? > budget {
        return None;
    }
    let lower_seconds = saved_seconds(&baseline, &lower)?;
    let upper_seconds = saved_seconds(&baseline, &upper)?;
    if upper_seconds < lower_seconds || upper_seconds >= elapsed(primary, start, end)? {
        return None;
    }
    Some(ModeledGain { lower_seconds,upper_seconds,reference_lap_id:Some(support.id.clone()),
        assumption:"Recover 25–50% of the complete supporting speed tradeoff, tapered to unchanged entry/exit speeds and capped by recorded acceleration capacity.".into(),
        method:"Conditional fixed-distance integral of 1/v. Both positive and negative supporting speed differences are retained; a sine-squared spatial taper returns to baseline at each boundary. Candidate longitudinal acceleration cannot exceed sustained same-speed-band acceleration recorded on the fastest lap. Grip, line and combined lateral demand remain unverified; this is an engineering scenario, not an achievable forecast.".into() })
}
fn recovery_window(full: &[(f64, f64)]) -> Option<Vec<(f64, f64)>> {
    let (i, &(minimum_x, minimum)) = full
        .iter()
        .enumerate()
        .min_by(|a, b| a.1 .1.total_cmp(&b.1 .1))?;
    let last = i + 1 + full.iter().skip(i + 1).position(|p| p.1 >= minimum + 1.)?;
    let (a, b) = (full[last - 1], full[last]);
    let threshold = minimum + 1.;
    let end_x = a.0 + (b.0 - a.0) * (threshold - a.1) / (b.1 - a.1);
    let mut window = full[i..last].to_vec();
    window.push((end_x, threshold));
    (window.len() >= 3 && end_x > minimum_x && valid_profile(&window)).then_some(window)
}
fn elapsed(view: &LapView, start: f64, end: f64) -> Option<f64> {
    let mapping: Vec<_> = view.mapping.iter().map(|p| (p.meters, p.time)).collect();
    let duration = at(&mapping, end)? - at(&mapping, start)?;
    (duration.is_finite() && duration > 0.).then_some(duration)
}
fn peak_acceleration(profile: &[(f64, f64)]) -> Option<f64> {
    valid_profile(profile).then(|| {
        profile
            .windows(2)
            .map(|w| (w[1].1.powi(2) - w[0].1.powi(2)) / (2. * (w[1].0 - w[0].0)))
            .fold(0., f64::max)
    })
}
/// Sustained measured longitudinal capacity in this lap at comparable speeds.
fn acceleration_budget(c: &Channel, lap: &Lap, window: &[(f64, f64)]) -> Option<f64> {
    let low = window.iter().map(|p| p.1).min_by(f64::total_cmp)? - 2.;
    let high = window.iter().map(|p| p.1).max_by(f64::total_cmp)? + 2.;
    let mut sustained = Vec::new();
    for i in 0..c.times.len() {
        let t = c.times[i];
        let v = *c.values.get(i)?;
        if t < lap.start || t > lap.end || v < low || v > high {
            continue;
        }
        let j = c.times.partition_point(|u| *u < t + 0.4);
        let Some((&end, &next)) = c.times.get(j).zip(c.values.get(j)) else {
            continue;
        };
        let dt = end - t;
        if end > lap.end
            || dt > 0.7
            || next < low
            || next > high
            || telemetry::source_gaps(c)
                .iter()
                .any(|g| t < g[1] && end > g[0])
        {
            continue;
        }
        let a = (next - v) / dt;
        if a.is_finite() && a > 0.05 && a <= 4. {
            sustained.push(a);
        }
    }
    if sustained.len() < 3 {
        return None;
    }
    sustained.sort_by(f64::total_cmp);
    Some(sustained[(sustained.len() - 1) * 9 / 10])
}
/// Coarse GPS curvature is a feasibility screen, never a measured grip limit.
pub(super) fn curvature(view: &LapView, distance: f64, chord: f64) -> Option<f64> {
    let map: Vec<_> = view.mapping.iter().map(|p| (p.meters, p.time)).collect();
    let track_x: Vec<_> = view.track.iter().map(|p| (p.position, p.x)).collect();
    let track_y: Vec<_> = view.track.iter().map(|p| (p.position, p.y)).collect();
    let point = |x: f64| -> Option<(f64, f64)> {
        let t = at(&map, x)?;
        Some((at(&track_x, t)?, at(&track_y, t)?))
    };
    let start = at(&map, distance - chord)?;
    let end = at(&map, distance + chord)?;
    if view
        .track
        .windows(2)
        .any(|w| w[1].break_before && start < w[1].position && end > w[0].position)
    {
        return None;
    }
    let (a, b, c) = (
        point(distance - chord)?,
        point(distance)?,
        point(distance + chord)?,
    );
    let ab = (b.0 - a.0).hypot(b.1 - a.1);
    let bc = (c.0 - b.0).hypot(c.1 - b.1);
    let ac = (c.0 - a.0).hypot(c.1 - a.1);
    (ab > 5. && bc > 5. && ac > 5.).then(|| {
        (2. * ((b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0))).abs() / (ab * bc * ac)
    })
}
fn lateral_cap(
    view: &LapView,
    base: &[(f64, f64)],
    candidate: &mut [(f64, f64)],
    position_uncertainty: f64,
) -> Option<()> {
    if !position_uncertainty.is_finite() || position_uncertainty < 0. {
        return None;
    }
    let chord = 10_f64.max(3. * position_uncertainty);
    let first = curvature(view, base.first()?.0, chord)?;
    let last = curvature(view, base.last()?.0, chord)?;
    if last > first * 1.25 + 0.002 {
        return None;
    }
    let mut budget = 0_f64;
    for &(x, v) in base {
        budget = budget.max(v * v * curvature(view, x, chord)?);
    }
    for (x, v) in candidate {
        let k = curvature(view, *x, chord)?;
        if k > 1e-5 {
            *v = v.min((budget / k).sqrt());
        }
    }
    Some(())
}
pub(super) fn recovery(
    s: &Session,
    view: &LapView,
    best: &Lap,
    start: f64,
    end: f64,
    position_uncertainty: f64,
) -> Option<ModeledGain> {
    let c = s.channels.iter().find(|c| c.id == "gps-speed")?;
    let full = profile(c, view, best, start, end)?;
    let window = recovery_window(&full)?;
    let minimum_x = window.first()?.0;
    let end_x = window.last()?.0;
    let distance = end_x - minimum_x;
    let budget = acceleration_budget(c, best, &window)?;
    let average_acceleration =
        (window.last()?.1.powi(2) - window.first()?.1.powi(2)) / (2. * distance);
    // The scenario needs measured spare capacity at comparable speed. Do not infer
    // acceleration capacity from RPM or assume an engine powerband.
    if average_acceleration <= 0. || budget <= average_acceleration * 1.03 {
        return None;
    }
    let compression = (average_acceleration / budget).max(0.85);
    let stronger = compression;
    let modest = (1. + compression) * 0.5;
    let scenario = |fraction: f64| -> Option<Vec<(f64, f64)>> {
        let compressed_end = minimum_x + distance * fraction;
        let mut p: Vec<_> = window
            .iter()
            .map(|&(x, v)| (minimum_x + (x - minimum_x) * fraction, v))
            .collect();
        if compressed_end < end_x {
            p.push((end_x, window.last()?.1));
        }
        lateral_cap(view, &window, &mut p, position_uncertainty)?;
        // Forward reachability under v² = u² + 2 a dx; do not demand the
        // compressed profile's noisy instantaneous peaks from the vehicle.
        for i in 1..p.len() {
            let reachable = (p[i - 1].1.powi(2) + 2. * budget * (p[i].0 - p[i - 1].0)).sqrt();
            p[i].1 = p[i].1.min(reachable);
        }
        if (p.last()?.1 - window.last()?.1).abs() > 1e-7 {
            return None;
        }
        Some(p)
    };
    let lower_seconds = saved_seconds(&window, &scenario(modest)?)?;
    let upper_seconds = saved_seconds(&window, &scenario(stronger)?)?;
    if upper_seconds < lower_seconds || upper_seconds >= elapsed(view, minimum_x, end_x)? {
        return None;
    }
    Some(ModeledGain {lower_seconds,upper_seconds,reference_lap_id:None,
        assumption:"If a settled exit recovers to +1 m/s over a modestly shorter distance, capped by sustained same-speed acceleration already recorded on the fastest lap; available traction remains unverified.".into(),
        method:format!("Measured recovery window {:.1} m; a desired recovery shape compressed by up to15% is capped by the recorded acceleration and lateral-demand envelopes before computing any saving. Conditional fixed-distance integral of 1/v over the measured minimum-to-+1 m/s window. Compress the recorded speed-versus-distance shape by at most 15%, using the recorded same-speed acceleration envelope as a cap, then hold its recorded final speed to the original endpoint. Minimum speed, final speed and all speeds outside the window are preserved; no profile extrapolation. No faster lap validates this scenario, and the recovery duration is not time saved. Scenario choices are not confidence bounds or an achievable forecast; coarse GPS curvature must ease or remain stable; candidate lateral demand cannot exceed the recorded window maximum and longitudinal acceleration cannot exceed sustained same-speed measured capacity. Grip and control causes remain unverified; this is not a safe-speed instruction. Aggregation uses only disjoint endpoint-preserving scenarios.",distance)})
}

// Conditional fixed-distance speed scenarios, separate from measured time gains.
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constant_profiles_integrate_seconds_and_half_full_gap() {
        let base = vec![(0., 10.), (100., 10.)];
        let support = vec![(0., 20.), (100., 20.)];
        let (lo, hi) = integrate(&base, &support).unwrap();
        assert!((lo - (10. - 100. / 15.)).abs() < 1e-9);
        assert!((hi - 5.).abs() < 1e-9);
        assert_eq!(integrate(&base, &base), None);
        assert_eq!(integrate(&base, &[(1., 20.), (100., 20.)]), None);
        assert_eq!(integrate(&base, &[(0., 0.), (100., 20.)]), None);
        assert_eq!(integrate(&base, &[(0., f64::NAN), (100., 20.)]), None);
    }
    #[test]
    fn only_positive_advantage_is_integrated_at_crossings() {
        let (lo, hi) = integrate(&[(0., 10.), (100., 10.)], &[(0., 5.), (100., 15.)]).unwrap();
        assert!((lo - (5. - 20. * 1.25_f64.ln())).abs() < 1e-6);
        assert!((hi - (5. - 10. * 1.5_f64.ln())).abs() < 1e-6);
    }
    #[test]
    fn recovery_interpolates_exact_plus_one_endpoint() {
        let window = recovery_window(&[(0., 12.), (10., 10.), (15., 10.5), (20., 11.5)]).unwrap();
        assert_eq!(window, vec![(10., 10.), (15., 10.5), (17.5, 11.)]);
        assert!(
            recovery_window(&[(0., 12.), (10., 10.), (20., 11.5)]).is_none(),
            "insufficient interior shape must be withheld"
        );
    }
    #[test]
    fn recovery_preserves_endpoints_and_integrates_continuous_compression() {
        let lap = Lap {
            id: "lap".into(),
            number: 1,
            start: 0.,
            end: 3.,
            duration: 3.,
            complete: true,
        };
        let mut channel = Channel {
            id: "gps-speed".into(),
            name: "speed".into(),
            unit: "m/s".into(),
            gaps: vec![],
            times: vec![0., 1., 1.5, 2., 2.5, 3.],
            values: vec![12., 10., 10.5, 11., 12., 13.],
        };
        let view = LapView {
            mapping: vec![(0., 0.), (10., 1.), (15., 1.5), (20., 2.), (30., 3.)]
                .into_iter()
                .map(|(meters, time)| telemetry::MappingPoint { meters, time })
                .collect(),
            lap_id: "lap".into(),
            duration: 3.,
            length: Some(30.),
            series: vec![],
            track: vec![(0., 0.), (1., 10.), (1.5, 15.), (2., 20.), (3., 30.)]
                .into_iter()
                .map(|(position, x)| telemetry::TrackPoint {
                    position,
                    x,
                    y: 0.,
                    break_before: false,
                    speed: None,
                })
                .collect(),
            warnings: vec![],
        };
        let mut session = Session {
            merge: None,
            id: "s".into(),
            source: "".into(),
            name: "".into(),
            driver: "".into(),
            track: "".into(),
            recorded_at: "".into(),
            channels: vec![channel.clone()],
            laps: vec![lap.clone()],
            warnings: vec![],
        };
        let estimate = recovery(&session, &view, &lap, 0., 30., 0.5).unwrap();
        let full_saving = 10. * (1.1_f64).ln() - 10. / 11.;
        assert!((estimate.lower_seconds - 0.075 * full_saving).abs() < 1e-6);
        assert!((estimate.upper_seconds - 0.15 * full_saving).abs() < 1e-6);
        assert!(estimate.reference_lap_id.is_none());
        let mut no_headroom = session.clone();
        no_headroom.channels[0].values = vec![12., 10., 10.5, 11., 11., 11.];
        assert!(
            recovery(&no_headroom, &view, &lap, 0., 30., 0.5).is_none(),
            "without measured spare same-speed acceleration, withhold the hypothetical gain"
        );
        let mut missing_geometry = view.clone();
        missing_geometry.track.clear();
        assert!(
            recovery(&session, &missing_geometry, &lap, 0., 30., 0.5).is_none(),
            "missing geometry cannot validate a lateral-demand envelope"
        );
        let mut gap_view = view.clone();
        gap_view.track = vec![
            telemetry::TrackPoint {
                break_before: false,
                x: 0.,
                y: 0.,
                position: 0.,
                speed: Some(10.),
            },
            telemetry::TrackPoint {
                break_before: true,
                x: 30.,
                y: 0.,
                position: 3.,
                speed: Some(10.),
            },
        ];
        assert!(
            profile(&channel, &gap_view, &lap, 10., 20.).is_none(),
            "window wholly inside spatial gap is invalid even with continuous speed"
        );
        gap_view.track[0].position = 1.5;
        gap_view.track[1].position = 2.;
        assert!(
            profile(&channel, &gap_view, &lap, 0., 15.).is_some(),
            "window ending exactly before the gap stays usable"
        );

        let mut incoherent = view.clone();
        for p in &mut incoherent.mapping {
            p.meters *= 100.;
        }
        assert!(
            recovery(&session, &incoherent, &lap, 0., 3000., 0.5).is_none(),
            "conditional gain exceeding recorded window time must be withheld"
        );

        channel.gaps = vec![[1.2, 1.4]];
        session.channels[0] = channel.clone();
        assert!(recovery(&session, &view, &lap, 0., 30., 0.5).is_none());
        channel.gaps.clear();
        channel.unit = "km/h".into();
        session.channels[0] = channel.clone();
        assert!(recovery(&session, &view, &lap, 0., 30., 0.5).is_none());
        channel.unit = "m/s".into();
        channel.values[2] = f64::NAN;
        session.channels[0] = channel;
        assert!(recovery(&session, &view, &lap, 0., 30., 0.5).is_none());
    }
    #[test]
    fn interpolation_has_no_endpoint_extrapolation() {
        assert_eq!(at(&[(10., 5.), (20., 15.)], 15.), Some(10.));
        assert_eq!(at(&[(10., 5.), (20., 15.)], 10.), Some(5.));
        assert_eq!(at(&[(10., 5.), (20., 15.)], 21.), None);
    }
}
