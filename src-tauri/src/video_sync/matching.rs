use super::{CornerEvidence, SyncCandidate, SyncResult, TelemetrySample};
use crate::video_analysis::motion::MotionSample;

const GRID: f64 = 0.2;
const REFINE: f64 = 0.05;
// A chunk can include a 0.5-second bracketing sample at each end.
const MAX_SAMPLES: usize = 6006;
const MAX_GAP: f64 = 0.5;
const MIN_PAIRS: usize = 50;

fn resample<T>(
    samples: &[T],
    get: impl Fn(&T) -> (f64, Option<f64>),
) -> Option<(f64, Vec<Option<f64>>)> {
    if samples.len() < 2 {
        return None;
    }
    let first = get(&samples[0]).0;
    let last = get(samples.last()?).0;
    if !first.is_finite() || !last.is_finite() {
        return None;
    }
    let start = (first / GRID).ceil() * GRID;
    let count = (((last - start) / GRID).floor() as isize + 1).max(0) as usize;
    if count == 0 || count > MAX_SAMPLES {
        return None;
    }
    let mut index = 0;
    let mut next_group = || -> Option<(f64, Option<f64>)> {
        if index == samples.len() {
            return None;
        }
        let mut group = get(&samples[index]);
        index += 1;
        while index < samples.len() {
            let point = get(&samples[index]);
            if point.0 != group.0 {
                break;
            }
            if point.1.is_none() {
                group.1 = None;
            }
            index += 1;
        }
        Some(group)
    };
    let mut a = next_group()?;
    let mut b = next_group();
    let mut values = Vec::with_capacity(count);
    for n in 0..count {
        let t = start + n as f64 * GRID;
        while b.is_some_and(|p| p.0 < t - 1e-8) {
            a = b?;
            b = next_group();
        }
        let value = if (a.0 - t).abs() < 1e-8 {
            a.1
        } else if let Some(b) = b {
            if (b.0 - t).abs() < 1e-8 {
                b.1
            } else if b.0 - a.0 <= MAX_GAP {
                a.1.zip(b.1)
                    .map(|(x, y)| x + (y - x) * (t - a.0) / (b.0 - a.0))
            } else {
                None
            }
        } else {
            None
        };
        values.push(value);
    }
    Some((start, values))
}

fn correlation(pairs: impl Iterator<Item = (f64, f64)>, min: usize) -> Option<(f64, usize)> {
    let (mut n, mut sx, mut sy, mut xx, mut yy, mut xy) = (0, 0., 0., 0., 0., 0.);
    for (x, y) in pairs {
        n += 1;
        sx += x;
        sy += y;
        xx += x * x;
        yy += y * y;
        xy += x * y;
    }
    if n < min {
        return None;
    }
    let vx = xx - sx * sx / n as f64;
    let vy = yy - sy * sy / n as f64;
    if vx <= 1e-12 || vy <= 1e-12 {
        return None;
    }
    Some(((xy - sx * sy / n as f64) / (vx * vy).sqrt(), n))
}

fn at(values: &[Option<f64>], index: f64) -> Option<f64> {
    if index < 0. || index > (values.len() - 1) as f64 {
        return None;
    }
    let lo = index.floor() as usize;
    let hi = index.ceil() as usize;
    let a = values[lo]?;
    if lo == hi {
        return Some(a);
    }
    Some(a + (values[hi]? - a) * (index - lo as f64))
}
fn score(
    v: &[Option<f64>],
    t: &[Option<f64>],
    lag: f64,
    range: std::ops::Range<usize>,
    min: usize,
) -> Option<(f64, usize)> {
    correlation(
        range.filter_map(|i| Some((v[i]?, at(t, i as f64 + lag)?))),
        min,
    )
}

fn match_chunk(
    video: &[MotionSample],
    telemetry: &[TelemetrySample],
    cancel: &crate::video_analysis::CancellationToken,
) -> SyncResult {
    let reject = |reason: &str| SyncResult {
        sequence: None,
        candidates: vec![],
        ambiguous: false,
        applicable: false,
        rejection_reason: Some(reason.into()),
    };
    if video.len() < 2
        || video.iter().any(|s| !s.time.is_finite())
        || video.windows(2).any(|w| w[0].time > w[1].time)
    {
        return reject("Invalid video interval");
    }
    let Some((vstart, v)) = resample(video, |s| {
        (
            s.time,
            s.yaw
                .filter(|x| x.is_finite() && s.quality.is_finite() && s.quality > 0.),
        )
    }) else {
        return reject("Invalid or oversized video interval");
    };
    if v.len() > 3000 {
        return reject("Invalid or oversized video interval");
    }
    let Some((tstart, t)) = resample(telemetry, |s| (s.time, s.yaw.filter(|x| x.is_finite())))
    else {
        return reject("Invalid or oversized telemetry interval");
    };
    if v.len() < MIN_PAIRS || t.len() < MIN_PAIRS {
        return reject("Insufficient overlap");
    }
    let mut peaks = Vec::new();
    for sign in [1_i8, -1] {
        let scores: Vec<_> = (-(v.len() as isize - MIN_PAIRS as isize)
            ..=(t.len() as isize - MIN_PAIRS as isize))
            .map(|lag| {
                if cancel.is_cancelled() {
                    return (lag, -2.0);
                }
                (
                    lag,
                    score(&v, &t, lag as f64, 0..v.len(), MIN_PAIRS)
                        .map(|(s, _)| s * sign as f64)
                        .unwrap_or(-2.),
                )
            })
            .collect();
        for i in 0..scores.len() {
            if cancel.is_cancelled() {
                return reject("Cancelled");
            }
            let (lag, s) = scores[i];
            if s < 0.3
                || (i > 0 && scores[i - 1].1 >= s)
                || (i + 1 < scores.len() && scores[i + 1].1 > s)
            {
                continue;
            }
            let mut best = (s, lag as f64);
            for step in -4..=4 {
                let l = lag as f64 + step as f64 * REFINE / GRID;
                if let Some((c, _)) = score(&v, &t, l, 0..v.len(), MIN_PAIRS) {
                    let c = c * sign as f64;
                    if c > best.0 {
                        best = (c, l);
                    }
                }
            }
            let mut left = i;
            let mut right = i;
            while left > 0 && scores[left - 1].1 >= s - 0.05 {
                left -= 1;
            }
            while right + 1 < scores.len() && scores[right + 1].1 >= s - 0.05 {
                right += 1;
            }
            peaks.push((best.0, best.1, sign, (right - left + 1) as f64 * GRID));
        }
    }
    let mut selected: Vec<(f64, f64, i8, f64)> = Vec::new();
    for p in peaks {
        if cancel.is_cancelled() {
            return reject("Cancelled");
        }
        if !selected
            .iter()
            .any(|q| p.2 == q.2 && (p.1 - q.1).abs() < REFINE / GRID / 2.)
        {
            selected.push(p);
        }
    }
    // GPS-derived yaw episodes are temporal evidence, not distinct physical corners.
    let mut separated = Vec::new();
    let mut episode: Option<(usize, f64, f64)> = None;
    for (i, value) in t.iter().enumerate() {
        if cancel.is_cancelled() {
            return reject("Cancelled");
        }
        let mut local: Vec<_> = t[i.saturating_sub(25)..(i + 26).min(t.len())]
            .iter()
            .flatten()
            .map(|y| y.abs())
            .collect();
        local.sort_by(f64::total_cmp);
        let threshold = local
            .get(local.len().saturating_mul(9) / 10)
            .copied()
            .unwrap_or(0.)
            * 0.2;
        match value.filter(|v| v.abs() >= threshold && v.abs() > 1e-9) {
            Some(y) => {
                if episode.is_some_and(|(_, _, sign)| sign != y.signum()) {
                    separated.push(episode.take().unwrap().0);
                }
                if episode.is_none_or(|(_, magnitude, _)| y.abs() > magnitude) {
                    episode = Some((i, y.abs(), y.signum()));
                }
            }
            None => {
                if let Some((center, _, _)) = episode.take() {
                    separated.push(center);
                }
            }
        }
    }
    if let Some((center, _, _)) = episode {
        separated.push(center);
    }
    let mut distinct: Vec<usize> = Vec::new();
    for center in separated {
        if let Some(last) = distinct.last_mut() {
            if center - *last < 15 {
                if t[center].unwrap().abs() > t[*last].unwrap().abs() {
                    *last = center;
                }
                continue;
            }
        }
        distinct.push(center);
    }
    let separated = distinct;
    let mut candidates = Vec::new();
    for &(cor, lag, sign, width) in &selected {
        if cancel.is_cancelled() {
            return reject("Cancelled");
        }
        let mut windows: Vec<CornerEvidence> = Vec::new();
        for &center in &separated {
            let index = center as f64 - lag;
            if index < 0. || index >= v.len() as f64 {
                continue;
            }
            let i = index.round() as usize;
            if cancel.is_cancelled() {
                return reject("Cancelled");
            }
            let start = i.saturating_sub(5);
            let end = (i + 6).min(v.len());
            let start_time = vstart + start as f64 * GRID;
            let end_time = vstart + (end - 1) as f64 * GRID;
            if windows
                .iter()
                .any(|w| start_time <= w.video_end_seconds && end_time >= w.video_start_seconds)
            {
                continue;
            }
            if let Some((c, _)) = score(&v, &t, lag, start..end, 6) {
                windows.push(CornerEvidence {
                    video_start_seconds: start_time,
                    video_end_seconds: end_time,
                    correlation: c * sign as f64,
                });
            }
        }
        windows.sort_by(|a, b| a.video_start_seconds.total_cmp(&b.video_start_seconds));
        let overlap =
            score(&v, &t, lag, 0..v.len(), MIN_PAIRS).map_or(0., |(_, n)| n as f64 * GRID);
        candidates.push(SyncCandidate {
            offset_seconds: tstart - vstart + lag * GRID,
            sign,
            correlation: cor,
            overlap_seconds: overlap,
            peak_width_seconds: width,
            consistent: windows.iter().all(|w| w.correlation > -0.3),
            windows,
        });
    }
    let truncated = retain_distinct_candidates(&mut candidates, vec![]);
    let ambiguous = is_ambiguous(&candidates);
    let reason = if candidates.is_empty() {
        "Insufficient motion or overlap"
    } else if truncated {
        "Competing peak comparison incomplete"
    } else if !candidates[0].consistent {
        "Inconsistent turning-event evidence"
    } else if candidates[0]
        .windows
        .iter()
        .filter(|w| w.correlation >= 0.3)
        .count()
        < 3
    {
        "Insufficient consistent turning-event evidence"
    } else if ambiguous {
        "Competing peaks are too close"
    } else {
        "Candidate only: physical corner independence, thresholds and cut continuity are not verified"
    };
    SyncResult {
        sequence: None,
        ambiguous: !candidates.is_empty(),
        candidates,
        applicable: false,
        rejection_reason: Some(reason.into()),
    }
}

pub(super) fn retain_distinct_candidates(
    candidates: &mut Vec<SyncCandidate>,
    incoming: Vec<SyncCandidate>,
) -> bool {
    candidates.extend(incoming);
    candidates.sort_by(|a, b| candidate_rank(b).total_cmp(&candidate_rank(a)));
    let mut unique: Vec<SyncCandidate> = Vec::new();
    let mut truncated = false;
    for c in candidates.drain(..) {
        if !unique
            .iter()
            .any(|u| c.sign == u.sign && (c.offset_seconds - u.offset_seconds).abs() < REFINE / 2.)
        {
            if unique.len() == 256 {
                truncated = true;
                break;
            }
            unique.push(c);
        }
    }
    *candidates = unique;
    truncated
}

fn candidate_rank(c: &SyncCandidate) -> f64 {
    let support = c
        .windows
        .iter()
        .filter(|w| w.correlation >= 0.3)
        .count()
        .min(3) as f64;
    let evidence = 0.5 + support / 6.;
    c.correlation * c.overlap_seconds.sqrt() * evidence * if c.consistent { 1. } else { 0.5 }
}

fn is_ambiguous(candidates: &[SyncCandidate]) -> bool {
    candidates.first().is_some_and(|first| {
        first
            .windows
            .iter()
            .filter(|w| w.correlation >= 0.3)
            .count()
            < 3
            || !first.consistent
            || candidates.iter().skip(1).any(|c| {
                candidate_rank(c) >= candidate_rank(first) * 0.95
                    || (c.overlap_seconds >= first.overlap_seconds * 0.8
                        && c.correlation >= first.correlation - 0.05)
            })
    })
}

/// Searches the complete telemetry span with overlapping bounded chunks.
pub fn match_signatures(video: &[MotionSample], telemetry: &[TelemetrySample]) -> SyncResult {
    match_inner(
        video,
        telemetry,
        &crate::video_analysis::CancellationToken::default(),
    )
}
pub fn match_signatures_cancellable(
    video: &[MotionSample],
    telemetry: &[TelemetrySample],
    cancel: &crate::video_analysis::CancellationToken,
) -> Result<SyncResult, String> {
    if cancel.is_cancelled() {
        return Err("Video analysis cancelled".into());
    }
    let result = match_inner(video, telemetry, cancel);
    if cancel.is_cancelled() {
        Err("Video analysis cancelled".into())
    } else {
        Ok(result)
    }
}
fn match_inner(
    video: &[MotionSample],
    telemetry: &[TelemetrySample],
    cancel: &crate::video_analysis::CancellationToken,
) -> SyncResult {
    let reject = |reason: &str| SyncResult {
        sequence: None,
        candidates: Vec::new(),
        ambiguous: false,
        applicable: false,
        rejection_reason: Some(reason.into()),
    };
    if telemetry.len() < 2
        || telemetry.iter().any(|s| !s.time.is_finite())
        || telemetry.windows(2).any(|w| w[0].time > w[1].time)
    {
        return reject("Invalid telemetry interval");
    }
    let first = telemetry[0].time;
    let last = telemetry.last().unwrap().time;
    if last - first <= 599. {
        let mut result = match_chunk(video, telemetry, cancel);
        result.candidates.truncate(8);
        return result;
    }
    if video.len() < 2 || video.last().unwrap().time - video[0].time > 599.8 + 1e-8 {
        return reject("Invalid or oversized video interval");
    }
    let mut candidates: Vec<SyncCandidate> = Vec::new();
    let mut truncated = false;
    let mut start = (first / GRID).floor() * GRID;
    while start <= last {
        if cancel.is_cancelled() {
            return reject("Cancelled");
        }
        let end = start + 1199.8;
        let mut lo = telemetry.partition_point(|s| s.time < start);
        if lo > 0 && start - telemetry[lo - 1].time <= MAX_GAP {
            lo -= 1;
        }
        let mut hi = telemetry.partition_point(|s| s.time <= end);
        if hi < telemetry.len() && telemetry[hi].time - end <= MAX_GAP {
            hi += 1;
        }
        if hi > lo + 1 {
            let result = match_chunk(video, &telemetry[lo..hi], cancel);
            if matches!(
                result.rejection_reason.as_deref(),
                Some(
                    "Input sample limit exceeded"
                        | "Invalid or oversized telemetry interval"
                        | "Invalid or oversized video interval"
                )
            ) {
                return result;
            }
            truncated |=
                result.rejection_reason.as_deref() == Some("Competing peak comparison incomplete");
            truncated |= retain_distinct_candidates(&mut candidates, result.candidates);
        }
        let next = start + 600.;
        let next_index = telemetry.partition_point(|s| s.time < next);
        if next_index < telemetry.len() && telemetry[next_index].time > next + 1199.8 {
            start = (telemetry[next_index].time / GRID).floor() * GRID;
        } else {
            start = next;
        }
        if !start.is_finite() || start <= end - 1199.8 {
            return reject("Invalid telemetry interval");
        }
    }
    candidates.sort_by(|a, b| candidate_rank(b).total_cmp(&candidate_rank(a)));
    let mut unique: Vec<SyncCandidate> = Vec::new();
    for c in candidates {
        if !unique
            .iter()
            .any(|u| c.sign == u.sign && (c.offset_seconds - u.offset_seconds).abs() < REFINE / 2.)
        {
            unique.push(c);
        }
    }
    let ambiguous = is_ambiguous(&unique);
    let reason = if unique.is_empty() {
        "Insufficient motion or overlap"
    } else if truncated {
        "Competing peak comparison incomplete"
    } else if !unique[0].consistent {
        "Inconsistent turning-event evidence"
    } else if unique[0]
        .windows
        .iter()
        .filter(|w| w.correlation >= 0.3)
        .count()
        < 3
    {
        "Insufficient consistent turning-event evidence"
    } else if ambiguous {
        "Competing peaks are too close"
    } else {
        "Candidate only: physical corner independence, thresholds and cut continuity are not verified"
    };
    unique.truncate(8);
    SyncResult {
        sequence: None,
        ambiguous: !unique.is_empty(),
        candidates: unique,
        applicable: false,
        rejection_reason: Some(reason.into()),
    }
}

#[cfg(test)]
mod evidence_tests {
    use super::*;

    #[test]
    fn noisy_chunk_limits_evidence_without_losing_competing_peaks() {
        let video: Vec<_> = (0..300)
            .map(|i| {
                let time = i as f64 * GRID;
                MotionSample {
                    time,
                    yaw: Some((time * 2.).sin()),
                    quality: 1.,
                }
            })
            .collect();
        let telemetry: Vec<_> = (0..1500)
            .map(|i| {
                let time = i as f64 * GRID;
                TelemetrySample {
                    time,
                    yaw: Some((time * 2.).sin()),
                    curvature: None,
                    speed: None,
                    acceleration: None,
                }
            })
            .collect();
        let result = match_chunk(&video, &telemetry, &Default::default());
        assert!(result.ambiguous);
        assert!(result.candidates.len() >= 8);
    }
}

/// Refine only near a sequence proposal. A motion peak cannot establish lap identity
/// or calibrate the visible-landmark / XRK-trigger difference.
pub fn refine_near(
    video: &[MotionSample],
    telemetry: &[TelemetrySample],
    offset: f64,
    radius: f64,
    cancel: &crate::video_analysis::CancellationToken,
) -> Result<Option<SyncCandidate>, String> {
    if cancel.is_cancelled() {
        return Err("Video analysis cancelled".into());
    }
    if !offset.is_finite()
        || !radius.is_finite()
        || !(0. ..=5.).contains(&radius)
        || video.iter().any(|s| !s.time.is_finite())
        || video.windows(2).any(|w| w[1].time < w[0].time)
        || telemetry.iter().any(|s| !s.time.is_finite())
        || telemetry.windows(2).any(|w| w[1].time < w[0].time)
    {
        return Err("Invalid bounded motion refinement input".into());
    }
    let Some((vstart, v)) = resample(video, |s| {
        (
            s.time,
            s.yaw
                .filter(|y| y.is_finite() && s.quality.is_finite() && s.quality > 0.),
        )
    }) else {
        return Ok(None);
    };
    if v.len() > 3000 || v.len() < MIN_PAIRS {
        return Ok(None);
    }
    let start = vstart + offset - radius - MAX_GAP;
    let end = vstart + (v.len() - 1) as f64 * GRID + offset + radius + MAX_GAP;
    let lo = telemetry.partition_point(|s| s.time < start);
    let hi = telemetry.partition_point(|s| s.time <= end);
    let Some((tstart, t)) = resample(&telemetry[lo..hi], |s| {
        (s.time, s.yaw.filter(|y| y.is_finite()))
    }) else {
        return Ok(None);
    };
    let minimum = MIN_PAIRS.max(v.iter().flatten().count() / 2);
    let steps = (radius / REFINE).ceil() as i32;
    let mut scores = Vec::new();
    for step in -steps..=steps {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let proposed = offset + (step as f64 * REFINE).clamp(-radius, radius);
        let lag = (vstart + proposed - tstart) / GRID;
        if let Some((correlation, n)) = score(&v, &t, lag, 0..v.len(), minimum) {
            for sign in [1_i8, -1] {
                scores.push((correlation * sign as f64, proposed, lag, sign, n));
            }
        }
    }
    let Some(&(correlation, best_offset, lag, sign, n)) = scores.iter().max_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then_with(|| (b.1 - offset).abs().total_cmp(&(a.1 - offset).abs()))
    }) else {
        return Ok(None);
    };
    if correlation < 0.3 {
        return Ok(None);
    }
    let mut windows = Vec::new();
    for first in (0..v.len().saturating_sub(10)).step_by(15) {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let values: Vec<_> = (first..first + 11)
            .filter_map(|i| at(&t, i as f64 + lag))
            .collect();
        let low = values.iter().copied().fold(f64::INFINITY, f64::min);
        let high = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if high - low < 0.01 {
            continue;
        }
        if let Some((c, _)) = score(&v, &t, lag, first..first + 11, 6) {
            windows.push(CornerEvidence {
                video_start_seconds: vstart + first as f64 * GRID,
                video_end_seconds: vstart + (first + 10) as f64 * GRID,
                correlation: c * sign as f64,
            });
        }
    }
    let mut peak_offsets: Vec<_> = scores
        .iter()
        .filter(|s| s.3 == sign && s.0 >= correlation - 0.05)
        .map(|s| s.1)
        .collect();
    peak_offsets.sort_by(f64::total_cmp);
    let width = peak_offsets.last().unwrap() - peak_offsets.first().unwrap();
    let consistent = windows.iter().filter(|w| w.correlation >= 0.3).count() >= 3
        && windows.iter().all(|w| w.correlation > -0.3);
    Ok(Some(SyncCandidate {
        offset_seconds: best_offset,
        sign,
        correlation,
        overlap_seconds: n as f64 * GRID,
        peak_width_seconds: width,
        windows,
        consistent,
    }))
}

#[cfg(test)]
mod refinement_tests {
    use super::*;
    fn signal(t: f64) -> f64 {
        [(4., 1.), (10., -0.8), (17., 1.4)]
            .iter()
            .map(|(c, a)| a * (-((t - c) / 0.8).powi(2)).exp())
            .sum()
    }
    fn inputs() -> (Vec<MotionSample>, Vec<TelemetrySample>) {
        let v = (0..121)
            .map(|i| {
                let time = i as f64 * GRID;
                MotionSample {
                    time,
                    yaw: Some(signal(time)),
                    quality: 1.,
                }
            })
            .collect();
        let t = (0..301)
            .map(|i| {
                let time = i as f64 * GRID;
                TelemetrySample {
                    time,
                    yaw: Some(signal(time - 5.)),
                    curvature: None,
                    speed: None,
                    acceleration: None,
                }
            })
            .collect();
        (v, t)
    }
    #[test]
    fn refines_within_sequence_neighborhood_and_reports_turning_evidence() {
        let (v, t) = inputs();
        let result = refine_near(&v, &t, 4.4, 1., &Default::default())
            .unwrap()
            .unwrap();
        assert!((result.offset_seconds - 5.).abs() < 0.051, "{result:?}");
        assert!(result.correlation > 0.99);
        assert!(result.consistent, "{result:?}");
        assert!(result.windows.len() >= 3);
    }
    #[test]
    fn bounded_refinement_does_not_chase_another_lap() {
        let (v, t) = inputs();
        let result = refine_near(&v, &t, 20., 1., &Default::default()).unwrap();
        if let Some(c) = result {
            assert!((19. ..=21.).contains(&c.offset_seconds));
        }
        let token = crate::video_analysis::CancellationToken::default();
        token.cancel();
        assert!(refine_near(&v, &t, 4.4, 1., &token).is_err());
        assert!(refine_near(&v, &t, 4.4, 6., &Default::default()).is_err());
    }
}
