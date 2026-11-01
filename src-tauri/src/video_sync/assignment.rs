//! Bounded global proposals: supported spans only; selection is not accuracy validation.
use super::{laps::BoundaryMatch, pipeline::SequenceCandidate};
use crate::video_analysis::CancellationToken;
use std::collections::HashMap;

// Development abstention heuristic, not a calibrated accuracy threshold.
pub const MIN_OBSERVED_INTERVALS: usize = 6;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AssignmentStatus {
    Selected,
    Provisional,
    RejectedAmbiguous,
    RejectedConflict,
    InsufficientEvidence,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentSegment {
    pub candidate_index: usize,
    pub candidate_indices: Vec<usize>,
    pub recording_id: String,
    pub recording_name: String,
    pub clip: usize,
    pub video_start_seconds: f64,
    pub video_end_seconds: f64,
    pub telemetry_start_seconds: f64,
    pub telemetry_end_seconds: f64,
    pub offset_seconds: f64,
    pub matched_laps: usize,
    pub marker_supported: bool,
    pub unique_interval_evidence: f64,
    pub boundaries: Vec<BoundaryMatch>,
    pub status: AssignmentStatus,
    pub local_margin: Option<f64>,
    pub comparison_incomplete: bool,
}
impl AssignmentSegment {
    pub fn is_proposed(&self) -> bool {
        matches!(
            self.status,
            AssignmentStatus::Selected | AssignmentStatus::Provisional
        )
    }
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedGap {
    pub video_start_seconds: f64,
    pub video_end_seconds: f64,
    pub reason: String,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub segments: Vec<AssignmentSegment>,
    pub unmapped_gaps: Vec<UnmappedGap>,
    pub comparison_incomplete: bool,
    pub best_score: f64,
    pub competing_score: Option<f64>,
    pub competitor_margin: Option<f64>,
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let i = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[i - 1] + values[i]) / 2.
    } else {
        values[i]
    }
}
fn overlaps(a: &AssignmentSegment, b: &AssignmentSegment) -> bool {
    // Shared endpoints do not establish an overlapping interval.
    a.video_start_seconds < b.video_end_seconds - 1e-6
        && b.video_start_seconds < a.video_end_seconds - 1e-6
}
/// Keep one actual localization per source boundary. Disagreeing localizations remain hypotheses.
fn normalize_boundaries(boundaries: &[BoundaryMatch]) -> Option<Vec<BoundaryMatch>> {
    let mut ordered = boundaries.to_vec();
    ordered.sort_by(|a, b| {
        a.telemetry_seconds
            .total_cmp(&b.telemetry_seconds)
            .then_with(|| a.lap_number.cmp(&b.lap_number))
    });
    let mut unique = Vec::new();
    let mut first = 0;
    while first < ordered.len() {
        let mut end = first + 1;
        while end < ordered.len()
            && ordered[end].lap_number == ordered[first].lap_number
            && (ordered[end].telemetry_seconds - ordered[first].telemetry_seconds).abs() <= 0.001
        {
            end += 1;
        }
        let localizations = &ordered[first..end];
        let low = localizations
            .iter()
            .map(|b| b.video_seconds)
            .fold(f64::INFINITY, f64::min);
        let high = localizations
            .iter()
            .map(|b| b.video_seconds)
            .fold(f64::NEG_INFINITY, f64::max);
        if high - low > 0.25 {
            return None;
        }
        unique.push(
            localizations
                .iter()
                .min_by(|a, b| {
                    a.residual_seconds
                        .abs()
                        .total_cmp(&b.residual_seconds.abs())
                        .then_with(|| a.video_seconds.total_cmp(&b.video_seconds))
                })
                .unwrap()
                .clone(),
        );
        first = end;
    }
    unique.sort_by(|a, b| a.video_seconds.total_cmp(&b.video_seconds));
    if unique.windows(2).any(|w| {
        w[1].video_seconds <= w[0].video_seconds
            || w[1].telemetry_seconds <= w[0].telemetry_seconds
            || w[1].lap_number <= w[0].lap_number
    }) {
        return None;
    }
    Some(unique)
}
fn refresh(segment: &mut AssignmentSegment, landmark: f64) -> Result<(), String> {
    segment.boundaries =
        normalize_boundaries(&segment.boundaries).ok_or("Inconsistent merged boundary evidence")?;
    let mut offsets: Vec<_> = segment
        .boundaries
        .iter()
        .map(|b| b.telemetry_seconds - b.video_seconds)
        .collect();
    segment.offset_seconds = median(&mut offsets);
    for boundary in &mut segment.boundaries {
        boundary.residual_seconds =
            boundary.telemetry_seconds - boundary.video_seconds - segment.offset_seconds;
    }
    let first = segment.boundaries.first().unwrap();
    let last = segment.boundaries.last().unwrap();
    segment.video_start_seconds = first.video_seconds;
    segment.video_end_seconds = last.video_seconds;
    segment.telemetry_start_seconds = first.telemetry_seconds;
    segment.telemetry_end_seconds = last.telemetry_seconds;
    segment.matched_laps =
        (i64::from(last.lap_number) - i64::from(first.lap_number)).max(0) as usize;
    // Absolute unique interval evidence, not the sum of normalized candidate scores.
    segment.unique_interval_evidence = segment
        .boundaries
        .windows(2)
        .map(|w| {
            let residual = (w[1].residual_seconds - w[0].residual_seconds).abs();
            let missing =
                (i64::from(w[1].lap_number) - i64::from(w[0].lap_number) - 1).max(0) as f64;
            (0.75 + landmark.clamp(0., 0.25)) / (1. + residual / 0.35) / (1. + missing * 0.15)
        })
        .sum();
    Ok(())
}

/// Maximum-weight nonoverlapping schedule, with an optional excluded hypothesis.
fn schedule(
    segments: &[AssignmentSegment],
    excluded: Option<usize>,
    cancel: &CancellationToken,
) -> Result<(f64, Vec<usize>), String> {
    let mut order: Vec<_> = (0..segments.len())
        .filter(|i| {
            Some(*i) != excluded
                && segments[*i].boundaries.len() > MIN_OBSERVED_INTERVALS
                && segments[*i].marker_supported
        })
        .collect();
    order.sort_by(|a, b| {
        segments[*a]
            .video_end_seconds
            .total_cmp(&segments[*b].video_end_seconds)
            .then_with(|| {
                segments[*a]
                    .video_start_seconds
                    .total_cmp(&segments[*b].video_start_seconds)
            })
            .then_with(|| segments[*a].recording_id.cmp(&segments[*b].recording_id))
    });
    let mut scores = vec![0.; order.len() + 1];
    let mut previous = Vec::with_capacity(order.len());
    let mut taken = vec![false; order.len()];
    for (position, index) in order.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let segment = &segments[*index];
        let before = order[..position].partition_point(|i| {
            segments[*i].video_end_seconds <= segment.video_start_seconds + 1e-6
        });
        previous.push(before);
        let with = scores[before] + segment.unique_interval_evidence;
        if with > scores[position] + 1e-9 {
            scores[position + 1] = with;
            taken[position] = true;
        } else {
            scores[position + 1] = scores[position];
        }
    }
    let score = *scores.last().unwrap();
    let mut chosen = Vec::new();
    let mut position = order.len();
    while position > 0 {
        if taken[position - 1] {
            chosen.push(order[position - 1]);
            position = previous[position - 1];
        } else {
            position -= 1;
        }
    }
    chosen.reverse();
    Ok((score, chosen))
}

pub fn assign(
    candidates: &[SequenceCandidate],
    start: f64,
    end: f64,
    comparison_incomplete: bool,
    cancel: &CancellationToken,
) -> Result<Assignment, String> {
    assign_inner(candidates, start, end, comparison_incomplete, None, cancel)
}

/// Enforce every constituent source lap, including laps hidden by missed visual crossings.
pub fn assign_recordings(
    candidates: &[SequenceCandidate],
    start: f64,
    end: f64,
    comparison_incomplete: bool,
    recordings: &[crate::telemetry::Session],
    cancel: &CancellationToken,
) -> Result<Assignment, String> {
    assign_inner(
        candidates,
        start,
        end,
        comparison_incomplete,
        Some(recordings),
        cancel,
    )
}

fn source_interval_valid(
    a: &BoundaryMatch,
    b: &BoundaryMatch,
    recording: &crate::telemetry::Session,
    ordinary: f64,
) -> bool {
    let laps = &recording.laps;
    let lo = laps.partition_point(|l| l.end <= a.telemetry_seconds + 0.001);
    let hi = laps.partition_point(|l| l.start < b.telemetry_seconds - 0.001);
    if hi <= lo {
        return false;
    }
    let covered = &laps[lo..hi];
    (covered[0].start - a.telemetry_seconds).abs() <= 0.001
        && (covered.last().unwrap().end - b.telemetry_seconds).abs() <= 0.001
        && covered[0].number == a.lap_number
        && i64::from(covered.last().unwrap().number) + 1 == i64::from(b.lap_number)
        && covered
            .iter()
            .all(|l| l.complete && l.duration >= ordinary * 0.6 && l.duration <= ordinary * 1.5)
        && covered.windows(2).all(|w| {
            (w[0].end - w[1].start).abs() <= 0.001
                && i64::from(w[0].number) + 1 == i64::from(w[1].number)
        })
}

fn assign_inner(
    candidates: &[SequenceCandidate],
    start: f64,
    end: f64,
    comparison_incomplete: bool,
    recordings: Option<&[crate::telemetry::Session]>,
    cancel: &CancellationToken,
) -> Result<Assignment, String> {
    if cancel.is_cancelled() {
        return Err("Video analysis cancelled".into());
    }
    if !start.is_finite()
        || !end.is_finite()
        || start < 0.
        || end <= start
        || candidates.len() > 8192
        || candidates
            .iter()
            .map(|c| c.sequence.matches.len())
            .sum::<usize>()
            > 200_000
    {
        return Err("Invalid or oversized global assignment input".into());
    }
    let mut sources = HashMap::new();
    if let Some(recordings) = recordings {
        for recording in recordings {
            if recording.laps.iter().any(|l| {
                !l.start.is_finite()
                    || !l.end.is_finite()
                    || !l.duration.is_finite()
                    || l.start < 0.
                    || l.end <= l.start
                    || (l.duration - (l.end - l.start)).abs() > 0.01
            }) || recording
                .laps
                .windows(2)
                .any(|w| w[1].start < w[0].end - 0.001)
            {
                return Err("Invalid source lap provenance".into());
            }
            let mut durations: Vec<_> = recording
                .laps
                .iter()
                .filter(|l| l.complete)
                .map(|l| l.duration)
                .collect();
            let ordinary = if durations.is_empty() {
                0.
            } else {
                median(&mut durations)
            };
            if sources
                .insert(recording.id.as_str(), (recording, ordinary))
                .is_some()
            {
                return Err("Duplicate source recording identity".into());
            }
        }
        if candidates
            .iter()
            .any(|c| !sources.contains_key(c.recording_id.as_str()))
        {
            return Err("Unknown source recording in assignment candidate".into());
        }
    }
    let mut normal: HashMap<&str, HashMap<(i32, i32, u64, u64), f64>> = HashMap::new();
    for candidate in candidates {
        let sequence = &candidate.sequence;
        if candidate.recording_id.is_empty()
            || !candidate.landmark_score.is_finite()
            || !sequence.offset_seconds.is_finite()
            || sequence.matches.iter().any(|b| {
                !b.video_seconds.is_finite()
                    || b.video_seconds < 0.
                    || !b.telemetry_seconds.is_finite()
                    || b.telemetry_seconds < 0.
                    || !b.residual_seconds.is_finite()
            })
            || sequence.matches.windows(2).any(|w| {
                w[1].video_seconds <= w[0].video_seconds
                    || w[1].telemetry_seconds <= w[0].telemetry_seconds
                    || w[1].lap_number <= w[0].lap_number
            })
        {
            return Err("Invalid global assignment candidate".into());
        }
        for w in sequence.matches.windows(2) {
            normal.entry(&candidate.recording_id).or_default().insert(
                (
                    w[0].lap_number,
                    w[1].lap_number,
                    w[0].telemetry_seconds.to_bits(),
                    w[1].telemetry_seconds.to_bits(),
                ),
                (w[1].telemetry_seconds - w[0].telemetry_seconds)
                    / (i64::from(w[1].lap_number) - i64::from(w[0].lap_number)) as f64,
            );
        }
    }
    let normal: HashMap<_, _> = normal
        .into_iter()
        .filter_map(|(id, intervals)| {
            let mut values: Vec<_> = intervals.into_values().collect();
            (!values.is_empty()).then(|| (id, median(&mut values)))
        })
        .collect();
    let mut segments: Vec<AssignmentSegment> = Vec::new();
    let mut landmarks: Vec<f64> = Vec::new();
    let mut raw_localizations: Vec<Vec<BoundaryMatch>> = Vec::new();
    let mut incomplete = comparison_incomplete;
    // Split support at anomalous lap durations; no extrapolation across a stop or missing session tail.
    for (candidate_index, candidate) in candidates.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let boundaries: Vec<_> = candidate
            .sequence
            .matches
            .iter()
            .filter(|b| b.video_seconds >= start && b.video_seconds <= end)
            .cloned()
            .collect();
        if boundaries.len() < 2 {
            continue;
        }
        let ordinary = normal[candidate.recording_id.as_str()];
        let mut first = 0;
        for last in 1..=boundaries.len() {
            let split =
                last == boundaries.len() || {
                    let a = &boundaries[last - 1];
                    let b = &boundaries[last];
                    let per_lap = (b.telemetry_seconds - a.telemetry_seconds)
                        / (i64::from(b.lap_number) - i64::from(a.lap_number)) as f64;
                    sources.get(candidate.recording_id.as_str()).is_some_and(
                        |(recording, typical)| !source_interval_valid(a, b, recording, *typical),
                    ) || per_lap > ordinary * 1.5
                        || per_lap < ordinary * 0.6
                        || ((b.video_seconds - a.video_seconds)
                            - (b.telemetry_seconds - a.telemetry_seconds))
                            .abs()
                            > 2.
                };
            if !split {
                continue;
            }
            if last - first >= 2 {
                let mut segment = AssignmentSegment {
                    candidate_index,
                    candidate_indices: vec![candidate_index],
                    recording_id: candidate.recording_id.clone(),
                    recording_name: candidate.recording_name.clone(),
                    clip: candidate.sequence.clip,
                    video_start_seconds: 0.,
                    video_end_seconds: 0.,
                    telemetry_start_seconds: 0.,
                    telemetry_end_seconds: 0.,
                    offset_seconds: candidate.sequence.offset_seconds,
                    matched_laps: 0,
                    marker_supported: candidate.marker_hypothesis
                        && candidate.landmark_score >= 0.15,
                    unique_interval_evidence: 0.,
                    boundaries: boundaries[first..last].to_vec(),
                    status: AssignmentStatus::RejectedConflict,
                    local_margin: None,
                    comparison_incomplete,
                };
                refresh(&mut segment, candidate.landmark_score)?;
                let mut raw = segment.boundaries.clone();
                let mut landmark = candidate.landmark_score;
                let mut merged = true;
                while merged {
                    merged = false;
                    if let Some((position, combined, normalized)) =
                        segments.iter().enumerate().find_map(|(position, prior)| {
                            if prior.recording_id != segment.recording_id
                                || prior.clip != segment.clip
                                || prior.marker_supported != segment.marker_supported
                                || (prior.offset_seconds - segment.offset_seconds).abs() >= 0.25
                                || prior.video_start_seconds > segment.video_end_seconds + 1e-6
                                || segment.video_start_seconds > prior.video_end_seconds + 1e-6
                            {
                                return None;
                            }
                            let mut combined = raw.clone();
                            combined.extend_from_slice(&raw_localizations[position]);
                            normalize_boundaries(&combined)
                                .map(|normalized| (position, combined, normalized))
                        })
                    {
                        let prior = segments.remove(position);
                        landmark = landmarks.remove(position).max(landmark);
                        raw_localizations.remove(position);
                        raw = combined;
                        segment.boundaries = normalized;
                        segment.candidate_indices.extend(prior.candidate_indices);
                        segment.candidate_indices.sort_unstable();
                        segment.candidate_indices.dedup();
                        segment.candidate_index = segment.candidate_indices[0];
                        refresh(&mut segment, landmark)?;
                        merged = true;
                    }
                }
                if segments.len() == 512 {
                    incomplete = true;
                    break;
                }
                landmarks.push(landmark);
                raw_localizations.push(raw);
                segments.push(segment);
            }
            first = last;
        }
    }
    for segment in &mut segments {
        if segment.boundaries.len() <= MIN_OBSERVED_INTERVALS || !segment.marker_supported {
            segment.status = AssignmentStatus::InsufficientEvidence;
        }
        segment.comparison_incomplete = incomplete;
    }
    let (best_score, selected) = schedule(&segments, None, cancel)?;
    let mut competing_score: Option<f64> = None;
    let mut ambiguous = vec![false; segments.len()];
    for index in &selected {
        let (score, alternate) = schedule(&segments, Some(*index), cancel)?;
        competing_score = Some(competing_score.map_or(score, |prior| prior.max(score)));
        let margin = best_score - score;
        segments[*index].local_margin = Some(margin);
        let has_competitor = alternate
            .iter()
            .any(|i| !selected.contains(i) && overlaps(&segments[*i], &segments[*index]));
        if has_competitor && margin <= segments[*index].unique_interval_evidence * 0.15 + 1e-9 {
            for i in selected.iter().filter(|i| !alternate.contains(i)) {
                ambiguous[*i] = true;
            }
            for i in alternate.iter().filter(|i| !selected.contains(i)) {
                ambiguous[*i] = true;
            }
        }
    }
    for (index, segment) in segments.iter_mut().enumerate() {
        if ambiguous[index] {
            segment.status = AssignmentStatus::RejectedAmbiguous;
        } else if selected.contains(&index) {
            segment.status = if incomplete {
                AssignmentStatus::Provisional
            } else {
                AssignmentStatus::Selected
            };
        }
    }
    let mut mapped: Vec<_> = segments.iter().filter(|s| s.is_proposed()).collect();
    mapped.sort_by(|a, b| a.video_start_seconds.total_cmp(&b.video_start_seconds));
    let mut gaps = Vec::new();
    let mut cursor = start;
    for segment in mapped {
        if segment.video_start_seconds > cursor + 1e-6 {
            gaps.push(UnmappedGap {
                video_start_seconds: cursor,
                video_end_seconds: segment.video_start_seconds,
                reason: "No unambiguous supported sequence".into(),
            });
        }
        cursor = segment.video_end_seconds;
    }
    if end > cursor + 1e-6 {
        gaps.push(UnmappedGap {
            video_start_seconds: cursor,
            video_end_seconds: end,
            reason: "No unambiguous supported sequence".into(),
        });
    }
    segments.sort_by(|a, b| {
        a.video_start_seconds
            .total_cmp(&b.video_start_seconds)
            .then_with(|| a.recording_id.cmp(&b.recording_id))
    });
    Ok(Assignment {
        segments,
        unmapped_gaps: gaps,
        comparison_incomplete: incomplete,
        best_score,
        competing_score,
        competitor_margin: competing_score.map(|score| best_score - score),
    })
}

#[cfg(test)]
#[path = "assignment/tests.rs"]
mod tests;
