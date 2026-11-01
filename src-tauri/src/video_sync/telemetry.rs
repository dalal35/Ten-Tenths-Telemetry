use super::TelemetrySample;
use crate::telemetry::{sample_without_gaps, source_gaps, speed, validated_lap_fixes, Session};

pub fn telemetry_signature(session: &Session) -> Result<Vec<TelemetrySample>, String> {
    telemetry_signature_cancellable(
        session,
        &crate::video_analysis::CancellationToken::default(),
    )
}
pub fn telemetry_signature_cancellable(
    session: &Session,
    cancel: &crate::video_analysis::CancellationToken,
) -> Result<Vec<TelemetrySample>, String> {
    if cancel.is_cancelled() {
        return Err("Video analysis cancelled".into());
    }
    let latitude = session
        .channels
        .iter()
        .find(|c| c.id == "gps-latitude")
        .ok_or("GPS latitude unavailable")?;
    let gps_gaps: Vec<_> = session
        .channels
        .iter()
        .filter(|c| c.id == "gps-latitude" || c.id == "gps-longitude")
        .flat_map(source_gaps)
        .collect();
    let speed = speed(session).map(|(c, factor)| (c, factor, source_gaps(c)));
    let mut output = Vec::new();
    let mut valid_laps = 0;
    let mut laps: Vec<_> = session.laps.iter().filter(|l| l.complete).collect();
    laps.sort_by(|a, b| a.start.total_cmp(&b.start));
    for lap in laps {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let points = match validated_lap_fixes(session, lap) {
            Ok(p) => p,
            Err(_) => {
                for time in [lap.start, lap.end] {
                    output.push(TelemetrySample {
                        time,
                        yaw: None,
                        curvature: None,
                        speed: None,
                        acceleration: None,
                    });
                }
                continue;
            }
        };
        valid_laps += 1;
        let mut steps: Vec<_> = latitude
            .times
            .windows(2)
            .map(|w| w[1] - w[0])
            .filter(|dt| *dt > 0.)
            .collect();
        steps.sort_by(f64::total_cmp);
        let cadence = steps.get(steps.len() / 2).copied().unwrap_or(0.);
        let connected = |a: f64, b: f64| {
            let first = latitude.times.partition_point(|t| *t < a - 1e-8);
            let last = latitude.times.partition_point(|t| *t <= b + 1e-8);
            last.saturating_sub(first) <= 2
                && b - a <= cadence * 1.5 + 1e-8
                && !gps_gaps.iter().any(|g| g[0] < b && g[1] > a)
        };
        let mut headings = vec![None; points.len()];
        for i in 1..points.len() - 1 {
            let (a, b, c) = (points[i - 1], points[i], points[i + 1]);
            if connected(a.0, b.0) && connected(b.0, c.0) {
                let dx = c.1 - a.1;
                let dy = c.2 - a.2;
                if dx.hypot(dy) / (c.0 - a.0) >= 2. {
                    headings[i] = Some(dy.atan2(dx));
                }
            }
        }
        for i in 0..points.len() {
            if cancel.is_cancelled() {
                return Err("Video analysis cancelled".into());
            }
            let t = points[i].0;
            if i > 0 && !connected(points[i - 1].0, t) {
                output.push(TelemetrySample {
                    time: (points[i - 1].0 + t) / 2.,
                    yaw: None,
                    curvature: None,
                    speed: None,
                    acceleration: None,
                });
            }
            let sample_speed = |time| {
                speed.as_ref().and_then(|(c, f, gaps)| {
                    sample_without_gaps(c, time, gaps)
                        .map(|v| v * f)
                        .filter(|v| *v >= 0. && v.is_finite())
                })
            };
            let v = sample_speed(t);
            let mut yaw = None;
            let mut acceleration = None;
            if i > 0
                && i + 1 < points.len()
                && connected(points[i - 1].0, t)
                && connected(t, points[i + 1].0)
            {
                let dt = points[i + 1].0 - points[i - 1].0;
                if let (Some(a), Some(b)) = (headings[i - 1], headings[i + 1]) {
                    let delta = (b - a).sin().atan2((b - a).cos());
                    yaw = Some(delta / dt).filter(|v| v.is_finite());
                }
                if let (Some(a), Some(b)) =
                    (sample_speed(points[i - 1].0), sample_speed(points[i + 1].0))
                {
                    let crosses_gap = speed.as_ref().is_some_and(|(_, _, gaps)| {
                        gaps.iter()
                            .any(|g| g[0] < points[i + 1].0 && g[1] > points[i - 1].0)
                    });
                    if !crosses_gap {
                        acceleration = Some((b - a) / dt).filter(|v| v.is_finite());
                    }
                }
            }
            if v.is_some_and(|v| v < 2.) {
                yaw = None;
            }
            let curvature = yaw
                .zip(v)
                .and_then(|(y, v)| (v >= 2.).then_some(y / v))
                .filter(|v| v.is_finite());
            output.push(TelemetrySample {
                time: t,
                yaw,
                curvature,
                speed: v,
                acceleration,
            });
        }
        // A lap boundary always breaks derivative continuity.
        if let Some(last) = output.last_mut() {
            last.yaw = None;
            last.curvature = None;
            last.acceleration = None;
        }
    }
    if valid_laps == 0 {
        return Err("No complete lap with validated GPS is available.".into());
    }
    Ok(output)
}
