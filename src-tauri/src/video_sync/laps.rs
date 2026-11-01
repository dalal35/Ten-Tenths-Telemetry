//! Lap boundary sequence proposals. Scores measure fit, not calibrated correctness.
use crate::{telemetry::Lap, video_analysis::CancellationToken};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCrossing {
    pub time: f64,
    pub uncertainty_seconds: f64,
    pub clip: usize,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryMatch {
    pub video_seconds: f64,
    pub telemetry_seconds: f64,
    pub lap_number: i32,
    pub residual_seconds: f64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapSequenceCandidate {
    pub clip: usize,
    /// Telemetry = video + offset; visible landmark / XRK trigger bias is unresolved.
    pub offset_seconds: f64,
    pub matches: Vec<BoundaryMatch>,
    pub rms_residual_seconds: f64,
    pub max_residual_seconds: f64,
    pub interval_rms_seconds: f64,
    /// Telemetry boundaries absent from the video crossing sequence.
    pub skipped_crossings: usize,
    pub score: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LapSequenceResult {
    pub candidates: Vec<LapSequenceCandidate>,
    pub ambiguous: bool,
    pub comparison_truncated: bool,
}

fn overlaps(a: &LapSequenceCandidate, b: &LapSequenceCandidate) -> bool {
    a.matches[0].video_seconds < b.matches.last().unwrap().video_seconds - 1e-6
        && b.matches[0].video_seconds < a.matches.last().unwrap().video_seconds - 1e-6
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.
    } else {
        values[middle]
    }
}

/// Compare each continuous video clip with continuous runs of complete XRK laps.
/// Missing visual crossings aggregate complete laps; edited or partial laps never bridge runs.
pub fn match_lap_sequences(
    crossings: &[VideoCrossing],
    laps: &[Lap],
    cancel: &CancellationToken,
) -> Result<LapSequenceResult, String> {
    if cancel.is_cancelled() {
        return Err("Video analysis cancelled".into());
    }
    if crossings.len() > 2048
        || laps.len() > 8192
        || crossings.iter().any(|c| {
            !c.time.is_finite()
                || c.time < 0.
                || !c.uncertainty_seconds.is_finite()
                || c.uncertainty_seconds < 0.
                || c.uncertainty_seconds > 2.
        })
        || crossings
            .windows(2)
            .any(|w| w[1].time <= w[0].time || w[1].clip < w[0].clip)
        || laps.iter().any(|l| {
            !l.start.is_finite()
                || !l.end.is_finite()
                || !l.duration.is_finite()
                || l.start < 0.
                || l.end <= l.start
                || (l.duration - (l.end - l.start)).abs() > 0.01
        })
        || laps.windows(2).any(|w| w[1].start < w[0].end - 0.001)
    {
        return Err("Invalid or oversized lap sequence input".into());
    }
    let mut runs: Vec<Vec<(f64, i32)>> = Vec::new();
    let mut current: Vec<(f64, i32)> = Vec::new();
    for lap in laps {
        if !lap.complete
            || current
                .last()
                .is_some_and(|b| (b.0 - lap.start).abs() > 0.001)
        {
            if current.len() >= 4 {
                runs.push(std::mem::take(&mut current));
            }
            current.clear();
        }
        if lap.complete {
            if current.is_empty() {
                current.push((lap.start, lap.number));
            }
            current.push((lap.end, lap.number.saturating_add(1)));
        }
    }
    if current.len() >= 4 {
        runs.push(current);
    }
    let mut candidates: Vec<LapSequenceCandidate> = Vec::new();
    let mut operations = 0usize;
    let mut truncated = false;
    // shortcut: bounded proposal search, report incomplete comparisons rather than claim uniqueness.
    'search: for first in 0..crossings.len() {
        let clip = crossings[first].clip;
        let end = first + crossings[first..].partition_point(|c| c.clip == clip);
        if end - first < 4 {
            continue;
        }
        for run in &runs {
            for start in 0..run.len().saturating_sub(3) {
                if cancel.is_cancelled() {
                    return Err("Video analysis cancelled".into());
                }
                let seed = run[start].0 - crossings[first].time;
                let mut pairs = vec![(first, start)];
                let mut previous = start;
                for (v, crossing) in crossings.iter().enumerate().take(end).skip(first + 1) {
                    operations += 1;
                    if operations > 2_000_000 {
                        truncated = true;
                        break 'search;
                    }
                    let target = crossing.time + seed;
                    let pos = run.partition_point(|b| b.0 < target).max(previous + 1);
                    let nearest = [pos.checked_sub(1), (pos < run.len()).then_some(pos)]
                        .into_iter()
                        .flatten()
                        .filter(|p| *p > previous && *p < run.len())
                        .min_by(|a, b| {
                            (run[*a].0 - target)
                                .abs()
                                .total_cmp(&(run[*b].0 - target).abs())
                        });
                    let Some(b) = nearest else {
                        break;
                    };
                    let tolerance = 2.
                        * (crossings[first].uncertainty_seconds.max(0.05)
                            + crossing.uncertainty_seconds.max(0.05));
                    if (run[b].0 - target).abs() > tolerance {
                        break;
                    }
                    pairs.push((v, b));
                    previous = b;
                }
                if pairs.len() < 4 {
                    continue;
                }
                let mut offsets: Vec<_> = pairs
                    .iter()
                    .map(|(v, b)| run[*b].0 - crossings[*v].time)
                    .collect();
                let offset = median(&mut offsets);
                let matches: Vec<_> = pairs
                    .iter()
                    .map(|(v, b)| BoundaryMatch {
                        video_seconds: crossings[*v].time,
                        telemetry_seconds: run[*b].0,
                        lap_number: run[*b].1,
                        residual_seconds: run[*b].0 - crossings[*v].time - offset,
                    })
                    .collect();
                if pairs.iter().zip(&matches).any(|((v, _), m)| {
                    m.residual_seconds.abs() > 2. * crossings[*v].uncertainty_seconds.max(0.05)
                }) {
                    continue;
                }
                let rms = (matches
                    .iter()
                    .map(|m| m.residual_seconds.powi(2))
                    .sum::<f64>()
                    / matches.len() as f64)
                    .sqrt();
                let max = matches
                    .iter()
                    .map(|m| m.residual_seconds.abs())
                    .fold(0., f64::max);
                let interval_rms = (matches
                    .windows(2)
                    .map(|w| (w[1].residual_seconds - w[0].residual_seconds).powi(2))
                    .sum::<f64>()
                    / (matches.len() - 1) as f64)
                    .sqrt();
                let skipped = previous - start + 1 - matches.len();
                let mut uncertainties: Vec<_> = pairs
                    .iter()
                    .map(|(v, _)| crossings[*v].uncertainty_seconds.max(0.05))
                    .collect();
                let scale = median(&mut uncertainties);
                let clip_start = crossings.partition_point(|c| c.clip < clip);
                let coverage = (matches.len() - 1) as f64 / (end - clip_start - 1) as f64;
                let score = coverage * ((matches.len() - 1) as f64 / 6.).min(1.)
                    / (1. + interval_rms / scale)
                    / (1. + skipped as f64 * 0.1);
                let proposal = LapSequenceCandidate {
                    clip,
                    offset_seconds: offset,
                    matches,
                    rms_residual_seconds: rms,
                    max_residual_seconds: max,
                    interval_rms_seconds: interval_rms,
                    skipped_crossings: skipped,
                    score,
                };
                if let Some(old) = candidates.iter_mut().find(|c| {
                    c.clip == clip
                        && (c.offset_seconds - offset).abs() < 0.25
                        && overlaps(c, &proposal)
                }) {
                    if proposal.matches.len() > old.matches.len()
                        || (proposal.matches.len() == old.matches.len()
                            && proposal.score > old.score)
                    {
                        *old = proposal;
                    }
                } else {
                    if candidates.len() == 256 {
                        truncated = true;
                        break 'search;
                    }
                    candidates.push(proposal);
                }
            }
        }
    }
    candidates.sort_by(|a, b| {
        b.matches
            .len()
            .cmp(&a.matches.len())
            .then_with(|| b.score.total_cmp(&a.score))
            .then_with(|| a.rms_residual_seconds.total_cmp(&b.rms_residual_seconds))
    });
    let ambiguous = truncated
        || candidates.iter().enumerate().any(|(i, a)| {
            !candidates[..i]
                .iter()
                .any(|c| c.clip == a.clip && overlaps(c, a))
                && candidates[i + 1..]
                    .iter()
                    .any(|b| a.clip == b.clip && overlaps(a, b) && b.score >= a.score * 0.9)
        });
    if candidates.len() > 32 {
        truncated = true;
        candidates.truncate(32);
    }
    Ok(LapSequenceResult {
        candidates,
        ambiguous: ambiguous || truncated,
        comparison_truncated: truncated,
    })
}

#[cfg(test)]
#[path = "laps/tests.rs"]
mod tests;
