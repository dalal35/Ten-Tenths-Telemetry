//! Same-position comparison in one session-local tangent plane. Thresholds are
//! conservative engineering gates, not statistical confidence intervals.
use super::*;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingPoint {
    pub meters: f64,
    pub time: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alignment {
    pub method: String,
    pub reference_length: Option<f64>,
    pub position_uncertainty_m: Option<f64>,
    pub timing_uncertainty_s: Option<f64>,
    pub coverage: f64,
    pub notes: Vec<String>,
}
impl Alignment {
    pub(super) fn unavailable(note: String) -> Self {
        Self {
            method: "unavailable".into(),
            reference_length: None,
            position_uncertainty_m: None,
            timing_uncertainty_s: None,
            coverage: 0.,
            notes: vec![note],
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMean {
    pub channel_id: String,
    pub name: String,
    pub unit: String,
    pub mean: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentMetrics {
    pub elapsed: f64,
    pub entry_speed: Option<f64>,
    pub min_speed: Option<f64>,
    pub exit_speed: Option<f64>,
    pub channels: Vec<ChannelMean>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub start: f64,
    pub end: f64,
    pub start_meters: f64,
    pub end_meters: f64,
    pub uncertainty_meters: f64,
    pub primary: SegmentMetrics,
    pub comparison: Option<SegmentMetrics>,
    pub delta_seconds: Option<f64>,
}
#[derive(Clone)]
struct Fix {
    t: f64,
    x: f64,
    y: f64,
    accuracy: f64,
}
fn norm(x: f64, y: f64) -> f64 {
    x.hypot(y)
}
fn separation(a: &Fix, b: &Fix) -> f64 {
    norm(a.x - b.x, a.y - b.y)
}
fn median(v: &[f64]) -> f64 {
    let mut v = v.to_vec();
    v.sort_by(f64::total_cmp);
    v.get(v.len() / 2).copied().unwrap_or(0.)
}
fn channel_by_id<'a>(s: &'a Session, id: &str) -> Option<&'a Channel> {
    s.channels.iter().find(|c| c.id == id)
}
// Categorical fix and accuracy are never interpolated through an invalid neighbour.
pub(super) fn bracket(c: &Channel, t: f64) -> Option<(f64, f64)> {
    if c.times.is_empty() || t < c.times[0] || t > *c.times.last()? {
        return None;
    }
    let i = c.times.partition_point(|v| *v < t);
    if i < c.times.len() && (c.times[i] - t).abs() < 1e-8 {
        return Some((c.values[i], c.values[i]));
    }
    if i == 0 || i == c.times.len() || c.times[i] - c.times[i - 1] > 0.6 {
        return None;
    }
    Some((c.values[i - 1], c.values[i]))
}
fn origin(s: &Session) -> Option<(f64, f64)> {
    let lat = channel_by_id(s, "gps-latitude")?;
    let lon = channel_by_id(s, "gps-longitude")?;
    lat.times.iter().zip(&lat.values).find_map(|(&t, &a)| {
        let b = interpolate(&lon.times, &lon.values, t)?;
        if a.abs() < 85.
            && b.abs() <= 180.
            && a != 0.
            && b != 0.
            && channel_by_id(s, "gps-fix")
                .and_then(|c| bracket(c, t))
                .is_some_and(|(a, b)| a >= 3. && b >= 3.)
        {
            Some((a, b))
        } else {
            None
        }
    })
}
fn fixes(
    s: &Session,
    l: &Lap,
    origin: (f64, f64),
    preserve_gaps: bool,
) -> Result<(Vec<Fix>, usize, bool), String> {
    let lat = channel_by_id(s, "gps-latitude")
        .ok_or("Spatial alignment unavailable: no GPS latitude.")?;
    let lon = channel_by_id(s, "gps-longitude")
        .ok_or("Spatial alignment unavailable: no GPS longitude.")?;
    let fix = channel_by_id(s, "gps-fix")
        .ok_or("Spatial alignment unavailable: GPS fix validity is unknown.")?;
    let accuracy = channel_by_id(s, "gps-accuracy");
    let cadence = median(
        &lat.times
            .windows(2)
            .map(|w| w[1] - w[0])
            .collect::<Vec<_>>(),
    );
    if cadence <= 0. || cadence > 0.5 {
        return Err("Spatial alignment unavailable: GPS sampling is too sparse.".into());
    }
    let limit = (cadence * 3.5).clamp(0.35, 0.6);
    let (times, values) = clipped(lat, l);
    let mut points = vec![];
    let mut rejected = 0;
    let mut unknown = false;
    let lon_gaps = source_gaps(lon);
    let lat_gaps = source_gaps(lat);
    for (t, a) in times.into_iter().zip(values) {
        if preserve_gaps && lat_gaps.iter().any(|g| t > g[0] && t < g[1]) {
            rejected += 1;
            continue;
        }
        let Some(b) = sample_without_gaps(lon, t, &lon_gaps) else {
            rejected += 1;
            continue;
        };
        let valid = bracket(fix, t).is_some_and(|(a, b)| a >= 3. && b >= 3.);
        if !valid || a.abs() > 90. || b.abs() > 180. || a == 0. || b == 0. {
            rejected += 1;
            continue;
        }
        let accuracy = match accuracy.and_then(|c| bracket(c, t)) {
            Some((a, b)) if a > 0. && b > 0. => a.max(b),
            _ => {
                unknown = true;
                5.
            }
        };
        if accuracy > 12. {
            rejected += 1;
            continue;
        }
        points.push(Fix {
            t,
            x: (b - origin.1).to_radians() * 6371000. * origin.0.to_radians().cos(),
            y: (a - origin.0).to_radians() * 6371000.,
            accuracy,
        });
    }
    // Remove isolated position spikes. A genuine turn cannot make two huge jumps
    // while its two surrounding samples remain close together.
    let mut bad = vec![false; points.len()];
    for i in 1..points.len().saturating_sub(1) {
        let a = &points[i - 1];
        let b = &points[i];
        let c = &points[i + 1];
        let threshold = (80. * (b.t - a.t)).max(10. + 3. * b.accuracy);
        if separation(a, b) > threshold
            && separation(b, c) > threshold
            && separation(a, c) < threshold
        {
            bad[i] = true;
        }
    }
    let raw_len = points.len();
    points = points
        .into_iter()
        .enumerate()
        .filter_map(|(i, p)| (!bad[i]).then_some(p))
        .collect();
    rejected += raw_len - points.len();
    if points.len() < 25
        || (points[0].t - l.start).abs() > 1e-7
        || (points.last().unwrap().t - l.end).abs() > 1e-7
    {
        return Err(
            "Spatial alignment unavailable: valid GPS does not bracket both lap crossings.".into(),
        );
    }
    if points.windows(2).any(|w| w[1].t - w[0].t > limit + 1e-8) {
        return Err("Spatial alignment unavailable: missing or invalid GPS spans exceed interpolation limits.".into());
    }
    if points.windows(2).any(|w| {
        separation(&w[0], &w[1]) > 80. * (w[1].t - w[0].t) + 3. * w[0].accuracy.max(w[1].accuracy)
    }) {
        return Err("Spatial alignment unavailable: implausible GPS motion.".into());
    }
    let uncertainty = points.iter().map(|p| p.accuracy).fold(0., f64::max);
    if separation(&points[0], points.last().unwrap()) > (3. * uncertainty).max(8.) {
        return Err(
            "Spatial alignment unavailable: GPS does not validate a closed start/finish crossing."
                .into(),
        );
    }
    if points
        .windows(5)
        .any(|w| w.windows(2).all(|p| separation(&p[0], &p[1]) < 0.05))
    {
        return Err("Spatial alignment unavailable: stationary GPS positions cannot define unique crossing times.".into());
    }
    // Five-fix symmetric smoothing removes metre-scale jitter. Endpoints stay at
    // their measured crossings; the reference is this lap's line, not a surveyed centreline.
    let raw = points.clone();
    for i in 1..points.len() - 1 {
        let mut radius = 2.min(i).min(points.len() - 1 - i);
        if preserve_gaps {
            while radius > 0
                && raw[i - radius..=i + radius].windows(2).any(|w| {
                    let a = lat.times.partition_point(|t| *t < w[0].t - 1e-8);
                    let b = lat.times.partition_point(|t| *t <= w[1].t + 1e-8);
                    b.saturating_sub(a) > 2
                        || w[1].t - w[0].t > cadence * 1.5 + 1e-8
                        || lat_gaps
                            .iter()
                            .chain(lon_gaps.iter())
                            .any(|g| g[0] < w[1].t && g[1] > w[0].t)
                })
            {
                radius -= 1;
            }
        }
        let lo = i - radius;
        let hi = i + radius;
        points[i].x = raw[lo..=hi].iter().map(|p| p.x).sum::<f64>() / (hi - lo + 1) as f64;
        points[i].y = raw[lo..=hi].iter().map(|p| p.y).sum::<f64>() / (hi - lo + 1) as f64;
    }
    Ok((points, rejected, unknown))
}

pub(super) struct Geometry {
    pub primary: Distance,
    pub comparison: Option<Distance>,
    reference: Vec<Fix>,
    comparison_fixes: Option<Vec<Fix>>,
    uncertainty: f64,
    timing: f64,
    coverage: f64,
    notes: Vec<String>,
}
fn cumulative(points: &[Fix]) -> Vec<f64> {
    let mut meters = vec![0.];
    for w in points.windows(2) {
        meters.push(meters.last().unwrap() + separation(&w[0], &w[1]));
    }
    meters
}
fn project(
    points: &[Fix],
    reference: &[Fix],
    meters: &[f64],
    uncertainty: f64,
) -> Result<(Distance, f64), String> {
    let length = *meters.last().unwrap();
    let mut mapped = vec![0.];
    let mut residuals = vec![];
    for i in 1..points.len() - 1 {
        let p = &points[i];
        let prev = &points[i - 1];
        let next = &points[i + 1];
        let hx = next.x - prev.x;
        let hy = next.y - prev.y;
        let hn = norm(hx, hy);
        if hn < 0.2 {
            return Err(
                "Spatial alignment unavailable: stationary or ambiguous GPS heading.".into(),
            );
        }
        let last = *mapped.last().unwrap();
        let max_step = (80. * (p.t - prev.t) + uncertainty * 2.).max(15.);
        let mut candidates = vec![];
        for j in 0..reference.len() - 1 {
            let a = &reference[j];
            let b = &reference[j + 1];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let n = norm(dx, dy);
            if n < 0.05 {
                continue;
            }
            let heading = (dx * hx + dy * hy) / (n * hn);
            if heading < 0.5 {
                continue;
            }
            let f = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (n * n)).clamp(0., 1.);
            let position = meters[j] + f * n;
            if position < last - uncertainty.max(2.) || position > last + max_step {
                continue;
            }
            let residual = norm(p.x - (a.x + f * dx), p.y - (a.y + f * dy));
            candidates.push((residual, position));
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        let Some(&(residual, position)) = candidates.first() else {
            return Err("Spatial alignment unavailable: trajectory cannot be matched continuously with consistent heading.".into());
        };
        if residual > (uncertainty * 3.).max(12.).min(20.) {
            return Err("Spatial alignment unavailable: racing lines are too far apart for same-position timing.".into());
        }
        if candidates
            .iter()
            .any(|&(r, m)| (m - position).abs() > 20. && r < residual + uncertainty)
        {
            return Err(
                "Spatial alignment unavailable: GPS projection has competing physical positions."
                    .into(),
            );
        }
        // Tiny backwards motion within the uncertainty envelope is clamped. Larger
        // reversals fail the monotonic matching gate above rather than jumping branches.
        mapped.push(position.max(last));
        residuals.push(residual);
    }
    if mapped.last().is_none_or(|m| {
        length - m
            > 80. * (points.last().unwrap().t - points[points.len() - 2].t) + uncertainty * 2.
    }) {
        return Err("Spatial alignment unavailable: finish approach is unmatched.".into());
    }
    mapped.push(length);
    let flats =
        mapped.windows(2).filter(|w| w[1] - w[0] < 0.01).count() as f64 / (mapped.len() - 1) as f64;
    if flats > 0.08 {
        return Err(
            "Spatial alignment unavailable: too many uncertain or reversing GPS projections."
                .into(),
        );
    }
    // Duplicate projected positions cannot define a unique crossing time. The
    // interpolation uncertainty includes cadence; keep the last sample per interior plateau.
    let mut times = vec![points[0].t];
    let mut unique = vec![0.];
    for (i, &m) in mapped.iter().enumerate().skip(1) {
        if m <= *unique.last().unwrap() + 1e-7 && i < points.len() - 1 {
            continue;
        }
        unique.push(m);
        times.push(points[i].t);
    }
    Ok((
        Distance {
            times,
            meters: unique,
        },
        median(&residuals),
    ))
}

pub(super) fn align_sources(
    primary_source: LapSource<'_>,
    comparison_source: Option<LapSource<'_>>,
) -> Result<Geometry, String> {
    let s = primary_source.session;
    let p = primary_source.lap;
    let c = comparison_source.map(|c| c.lap);
    let cs = comparison_source.map(|c| c.session).unwrap_or(s);
    if !p.complete || c.is_some_and(|c| !c.complete) {
        return Err(
            "Spatial alignment unavailable: complete validated lap crossings are required.".into(),
        );
    }
    let origin = origin(s).ok_or("Spatial alignment unavailable: GPS coordinates are absent.")?;
    let (reference, mut rejected, mut unknown) = fixes(s, p, origin, false)?;
    let meters = cumulative(&reference);
    let length = *meters.last().unwrap();
    if !(100. ..100_000.).contains(&length) {
        return Err("Spatial alignment unavailable: implausible reference lap geometry.".into());
    }
    let stationary = reference
        .windows(2)
        .filter(|w| separation(&w[0], &w[1]) < 0.05)
        .count();
    if stationary as f64 / (reference.len() - 1) as f64 > 0.03 {
        return Err("Spatial alignment unavailable: stationary GPS positions cannot define unique crossing times.".into());
    }
    let primary = Distance {
        times: reference.iter().map(|p| p.t).collect(),
        meters,
    };
    if distance(s, p).is_some_and(|d| (*d.meters.last().unwrap() - length).abs() / length > 0.15) {
        return Err("Spatial alignment unavailable: GPS path length disagrees with speed-integrated distance.".into());
    }
    let mut uncertainty = reference
        .iter()
        .map(|p| p.accuracy)
        .fold(0., f64::max)
        .max(0.5);
    let mut comparison = None;
    let mut comparison_fixes = None;
    let mut accepted = reference.len();
    let mut residual = 0.;
    if let Some(c) = c {
        let (points, r, u) = fixes(cs, c, origin, false)?;
        rejected += r;
        unknown |= u;
        accepted += points.len();
        uncertainty = uncertainty.max(points.iter().map(|p| p.accuracy).fold(0., f64::max));
        let tolerance = (3. * uncertainty).max(8.);
        if separation(&reference[0], &points[0]) > tolerance
            || separation(reference.last().unwrap(), points.last().unwrap()) > tolerance
        {
            return Err("Spatial alignment unavailable: lap start/finish positions disagree beyond GPS resolution.".into());
        }
        let (mapped, r) = project(&points, &reference, &primary.meters, uncertainty)?;
        residual = r;
        comparison = Some(mapped);
        comparison_fixes = Some(points);
    }
    // GPS receiver accuracy, line separation, and sample spacing all limit the
    // interpretation. This is an explicit resolution estimate, never a confidence bound.
    uncertainty = (uncertainty * 2.).max(residual);
    let cadence = median(
        &reference
            .windows(2)
            .map(|w| w[1].t - w[0].t)
            .collect::<Vec<_>>(),
    );
    let slow = reference
        .windows(2)
        .map(|w| separation(&w[0], &w[1]) / (w[1].t - w[0].t))
        .fold(f64::INFINITY, f64::min)
        .max(2.);
    let comparison_cadence = comparison_fixes
        .as_ref()
        .map(|points| {
            median(
                &points
                    .windows(2)
                    .map(|w| w[1].t - w[0].t)
                    .collect::<Vec<_>>(),
            )
        })
        .unwrap_or(cadence);
    let comparison_slow = comparison
        .as_ref()
        .map(|d| {
            d.times
                .windows(2)
                .zip(d.meters.windows(2))
                .map(|(t, m)| (m[1] - m[0]) / (t[1] - t[0]))
                .fold(f64::INFINITY, f64::min)
        })
        .unwrap_or(slow)
        .max(2.);
    let timing = cadence + comparison_cadence + 2. * uncertainty / slow.min(comparison_slow);
    let mut notes=vec!["GPS spatial alignment projects both laps onto the selected lap's smoothed line in a common local coordinate frame; corners follow that reference. Boundaries and timing have engineering resolution estimates, not confidence bounds.".into()];
    if unknown {
        notes.push("Receiver position accuracy is missing or zero; a conservative 5 m per-fix floor is assumed.".into());
    }
    if rejected > 0 {
        notes.push(format!("{rejected} invalid or isolated GPS outlier sample(s) rejected; only short validated gaps are interpolated."));
    }
    Ok(Geometry {
        primary,
        comparison,
        reference,
        comparison_fixes,
        uncertainty,
        timing,
        coverage: accepted as f64 / (accepted + rejected) as f64,
        notes,
    })
}
impl Geometry {
    pub fn alignment(&self) -> Alignment {
        Alignment {
            method: "spatial".into(),
            reference_length: self.primary.meters.last().copied(),
            position_uncertainty_m: Some(self.uncertainty),
            timing_uncertainty_s: Some(self.timing),
            coverage: self.coverage,
            notes: self.notes.clone(),
        }
    }
    pub fn track(&self, s: &Session, _l: &Lap, comparison: bool, axis: &str) -> Vec<TrackPoint> {
        let speed = speed(s).map(|(c, f)| (c, f, source_gaps(c)));
        let points = if comparison {
            self.comparison_fixes.as_ref().unwrap()
        } else {
            &self.reference
        };
        let mapping = if comparison {
            self.comparison.as_ref().unwrap()
        } else {
            &self.primary
        };
        points
            .iter()
            .filter_map(|p| {
                let meters = interpolate(&mapping.times, &mapping.meters, p.t)?;
                let position = if axis == "distance" {
                    meters
                } else {
                    interpolate(&self.primary.meters, &self.primary.times, meters)?
                        - self.primary.times[0]
                };
                Some(TrackPoint {
                    x: p.x,
                    y: p.y,
                    position,
                    speed: speed
                        .as_ref()
                        .and_then(|(c, f, gaps)| sample_without_gaps(c, p.t, gaps).map(|v| v * f)),
                    break_before: false,
                })
            })
            .filter(|p| p.position.is_finite())
            .collect()
    }
    pub fn segments_sources(
        &self,
        s: &Session,
        cs: &Session,
        p: &Lap,
        c: Option<&Lap>,
        axis: &str,
        ids: &[String],
        comparison_ids: &[String],
        boundaries: Option<&[f64]>,
    ) -> Result<Vec<Segment>, String> {
        let length = *self.primary.meters.last().unwrap();
        // Uniform geometric sampling avoids cadence/speed-dependent curvature.
        let n = (length / 2.).ceil().max(50.) as usize;
        let step = length / n as f64;
        let xs = self.reference.iter().map(|p| p.x).collect::<Vec<_>>();
        let ys = self.reference.iter().map(|p| p.y).collect::<Vec<_>>();
        let xy = (0..=n)
            .map(|i| {
                let m = i as f64 * step;
                (
                    interpolate(&self.primary.meters, &xs, m).unwrap(),
                    interpolate(&self.primary.meters, &ys, m).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        let window = (10. / step).round().max(2.) as usize;
        let mut curvature = vec![0.; n + 1];
        let mut speeds = vec![None; n + 1];
        for i in 0..=n {
            let a = xy[(i + n - window) % n];
            let b = xy[i];
            let c = xy[(i + window) % n];
            let ux = b.0 - a.0;
            let uy = b.1 - a.1;
            let vx = c.0 - b.0;
            let vy = c.1 - b.1;
            curvature[i] = (ux * vy - uy * vx).atan2(ux * vx + uy * vy) / (window as f64 * step);
        }
        if let Some((channel, f)) = speed(s) {
            let gaps = source_gaps(channel);
            for (i, v) in speeds.iter_mut().enumerate() {
                *v = interpolate(&self.primary.meters, &self.primary.times, i as f64 * step)
                    .and_then(|t| sample_without_gaps(channel, t, &gaps))
                    .map(|v| v * f);
            }
        }
        let mut corner = vec![0_i8; n + 1];
        for i in 0..=n {
            let local_slow = match (
                speeds[i],
                speeds[(i + n - window) % n],
                speeds[(i + window) % n],
            ) {
                (Some(v), Some(a), Some(b)) => v < a.max(b) * 0.92,
                _ => false,
            };
            if curvature[i].abs() > 0.014 || (curvature[i].abs() > 0.008 && local_slow) {
                corner[i] = if curvature[i] > 0. { 1 } else { -1 };
            }
        }
        // Merge short straight islands inside a turning complex, reject short
        // noise-only arcs, and require meaningful accumulated heading change.
        for i in 1..n {
            if corner[i] == 0 && corner[i - 1] != 0 {
                if let Some(j) = ((i + 1)..=(i + window).min(n)).find(|&j| corner[j] != 0) {
                    if corner[j] == corner[i - 1] {
                        let sign = corner[j];
                        corner[i..j].fill(sign);
                    }
                }
            }
        }
        let mut ranges = vec![];
        let mut start = 0;
        for i in 1..=n + 1 {
            if i == n + 1 || corner[i] != corner[start] {
                let len = (i - start) as f64 * step;
                let angle = curvature[start..i].iter().map(|v| v.abs()).sum::<f64>() * step;
                let is_corner = if corner[start] != 0 && len >= 10. && angle >= 0.25 {
                    corner[start]
                } else {
                    0
                };
                ranges.push((
                    start as f64 * step,
                    ((i - 1) as f64 * step).min(length),
                    is_corner,
                ));
                start = i;
            }
        }
        // Adjacent equal classes collapse into a continuous partition.
        let mut merged: Vec<(f64, f64, i8)> = vec![];
        for (a, b, k) in ranges {
            if let Some(last) = merged.last_mut() {
                if last.2 == k {
                    last.1 = b;
                    continue;
                }
            }
            merged.push((a, b, k));
        }
        for i in 0..merged.len().saturating_sub(1) {
            merged[i].1 = merged[i + 1].0;
        }
        let resolution = self.uncertainty + window as f64 * step;
        let mut i = 1;
        while i + 1 < merged.len() {
            if merged[i].2 == 0
                && merged[i].1 - merged[i].0 < resolution
                && merged[i - 1].2 != 0
                && merged[i + 1].2 != 0
            {
                if merged[i - 1].2 == merged[i + 1].2 {
                    merged[i - 1].1 = merged[i + 1].1;
                    merged.remove(i + 1);
                    merged.remove(i);
                } else {
                    let boundary = (merged[i].0 + merged[i].1) * 0.5;
                    merged[i - 1].1 = boundary;
                    merged[i + 1].0 = boundary;
                    merged.remove(i);
                    i += 1;
                }
            } else {
                i += 1;
            }
        }
        if let Some(last) = merged.last_mut() {
            last.1 = length;
        }
        if let Some(boundaries) = boundaries {
            if boundaries.len() != merged.len().saturating_sub(1) {
                return Err("Manual boundary count no longer matches automatic sections. Reset to automatic.".into());
            }
            let mut previous = 0.;
            for &boundary in boundaries.iter().chain(std::iter::once(&length)) {
                if !boundary.is_finite() || boundary - previous < 2. {
                    return Err("Keep boundaries ordered, at least 2 meters apart, inside the reference lap.".into());
                }
                previous = boundary;
            }
            for (i, section) in merged.iter_mut().enumerate() {
                section.0 = if i == 0 { 0. } else { boundaries[i - 1] };
                section.1 = boundaries.get(i).copied().unwrap_or(length);
            }
        }
        let mut turns = 0;
        let mut straights = 0;
        Ok(merged
            .into_iter()
            .enumerate()
            .filter_map(|(i, (a, b, turn))| {
                let primary = metrics(s, &self.primary, a, b, ids)?;
                let comparison = self
                    .comparison
                    .as_ref()
                    .and_then(|m| metrics(cs, m, a, b, comparison_ids));
                let delta_seconds = comparison.as_ref().map(|c| primary.elapsed - c.elapsed);
                let (start, end) = if axis == "distance" {
                    (a, b)
                } else {
                    (
                        interpolate(&self.primary.meters, &self.primary.times, a)? - p.start,
                        interpolate(&self.primary.meters, &self.primary.times, b)? - p.start,
                    )
                };
                let label = if turn != 0 {
                    turns += 1;
                    format!("Corner {turns}")
                } else {
                    straights += 1;
                    format!("Straight {straights}")
                };
                let _ = c;
                Some(Segment {
                    id: format!("segment-{i}"),
                    label,
                    kind: if turn != 0 { "corner" } else { "straight" }.into(),
                    start,
                    end,
                    start_meters: a,
                    end_meters: b,
                    uncertainty_meters: self.uncertainty + window as f64 * step,
                    primary,
                    comparison,
                    delta_seconds,
                })
            })
            .collect())
    }
}
// GPS speed readouts cannot be trusted across invalid fixes or implausible
// disagreement with the validated geometric motion. Withhold rather than invent minima.
fn speed_sample_valid(s: &Session, c: &Channel, d: &Distance, t: f64, v: f64) -> bool {
    if c.id != "gps-speed" {
        return true;
    }
    if !channel_by_id(s, "gps-fix")
        .and_then(|c| bracket(c, t))
        .is_some_and(|(a, b)| a >= 3. && b >= 3.)
    {
        return false;
    }
    let a = (t - 0.15).max(d.times[0]);
    let b = (t + 0.15).min(*d.times.last().unwrap());
    let geometric = interpolate(&d.times, &d.meters, a)
        .zip(interpolate(&d.times, &d.meters, b))
        .map(|(a_pos, b_pos)| (b_pos - a_pos) / (b - a));
    geometric.is_some_and(|g| (g - v).abs() <= (g * 0.6).max(5.))
}
fn metrics(s: &Session, d: &Distance, a: f64, b: f64, ids: &[String]) -> Option<SegmentMetrics> {
    let start = interpolate(&d.meters, &d.times, a)?;
    let end = interpolate(&d.meters, &d.times, b)?;
    let lap = Lap {
        id: String::new(),
        number: 0,
        start,
        end,
        duration: end - start,
        complete: true,
    };
    let mut entry_speed = None;
    let mut exit_speed = None;
    let mut min_speed = None;
    if let Some((c, f)) = speed(s) {
        let gaps = source_gaps(c);
        entry_speed = sample_without_gaps(c, start, &gaps)
            .filter(|v| speed_sample_valid(s, c, d, start, *v * f))
            .map(|v| v * f);
        exit_speed = sample_without_gaps(c, end, &gaps)
            .filter(|v| speed_sample_valid(s, c, d, end, *v * f))
            .map(|v| v * f);
        if !gaps.iter().any(|g| gap_overlaps(g, &lap)) {
            let (t, v) = clipped(c, &lap);
            if t.first().is_some_and(|t| *t <= start)
                && t.last().is_some_and(|t| *t >= end)
                && t.iter()
                    .zip(&v)
                    .all(|(&t, &v)| speed_sample_valid(s, c, d, t, v * f))
            {
                min_speed = v.into_iter().map(|v| v * f).min_by(f64::total_cmp);
            }
        }
    }
    let channels = s
        .channels
        .iter()
        .filter(|c| ids.contains(&c.id))
        .map(|c| {
            let gaps = source_gaps(c);
            let (times, values) = clipped(c, &lap);
            let mean = if end > start
                && !gaps.iter().any(|g| gap_overlaps(g, &lap))
                && (c.id != "gps-speed"
                    || times
                        .iter()
                        .zip(&values)
                        .all(|(&t, &v)| speed_sample_valid(s, c, d, t, v)))
                && times.first().is_some_and(|t| *t <= start)
                && times.last().is_some_and(|t| *t >= end)
            {
                Some(
                    times
                        .windows(2)
                        .zip(values.windows(2))
                        .map(|(t, v)| (t[1] - t[0]) * (v[0] + v[1]) * 0.5)
                        .sum::<f64>()
                        / (end - start),
                )
            } else {
                None
            };
            ChannelMean {
                channel_id: c.id.clone(),
                name: c.name.clone(),
                unit: c.unit.clone(),
                mean,
            }
        })
        .collect();
    Some(SegmentMetrics {
        elapsed: end - start,
        entry_speed,
        min_speed,
        exit_speed,
        channels,
    })
}

/// Validated lap positions in the session-local tangent plane, in session seconds.
pub fn validated_lap_fixes(session: &Session, lap: &Lap) -> Result<Vec<(f64, f64, f64)>, String> {
    if !lap.complete {
        return Err(
            "Spatial alignment unavailable: complete validated lap crossings are required.".into(),
        );
    }
    align_sources(LapSource { session, lap }, None)?;
    let origin =
        origin(session).ok_or("Spatial alignment unavailable: GPS coordinates are absent.")?;
    let (points, _, _) = fixes(session, lap, origin, true)?;
    Ok(points.into_iter().map(|p| (p.t, p.x, p.y)).collect())
}
