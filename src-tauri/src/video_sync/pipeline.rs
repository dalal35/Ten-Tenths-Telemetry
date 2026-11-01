//! Candidate-only orchestration; lap identity and trigger precision are separate evidence.
use super::{laps::LapSequenceCandidate, visual::CutBracket};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceCandidate {
    pub recording_id: String,
    pub recording_name: String,
    pub hypothesis: usize,
    pub landmark_score: f64,
    pub marker_hypothesis: bool,
    #[serde(flatten)]
    pub sequence: LapSequenceCandidate,
    pub motion: Option<super::SyncCandidate>,
    pub trigger_correction_seconds: Option<f64>,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceEvidence {
    pub candidates: Vec<SequenceCandidate>,
    pub cuts: Vec<CutBracket>,
    pub comparison_incomplete: bool,
    pub competitor_margin: Option<f64>,
    pub confidence: String,
    pub warnings: Vec<String>,
    pub sampled_frames: usize,
    pub runtime_seconds: f64,
    pub scan_seconds: f64,
    pub cache_hit: bool,
    pub cached_frames: usize,
    pub window_count: usize,
    pub assignment: super::assignment::Assignment,
}

fn rank(candidates: &mut Vec<SequenceCandidate>) {
    candidates.sort_by(|a, b| {
        (b.landmark_score >= 0.15 && b.sequence.matches.len() >= 5)
            .cmp(&(a.landmark_score >= 0.15 && a.sequence.matches.len() >= 5))
            .then_with(|| b.sequence.matches.len().cmp(&a.sequence.matches.len()))
            .then_with(|| b.sequence.score.total_cmp(&a.sequence.score))
    });
    let mut unique: Vec<SequenceCandidate> = Vec::new();
    for c in candidates.drain(..) {
        if !unique.iter().any(|u| {
            u.recording_id == c.recording_id
                && u.sequence.clip == c.sequence.clip
                && (u.sequence.offset_seconds - c.sequence.offset_seconds).abs() < 0.25
                && c.sequence.matches.iter().all(|m| {
                    u.sequence.matches.iter().any(|n| {
                        (m.video_seconds - n.video_seconds).abs() < 0.3
                            && (m.telemetry_seconds - n.telemetry_seconds).abs() < 0.3
                    })
                })
        }) {
            unique.push(c);
        }
    }
    *candidates = unique;
}

fn limit_per_clip(candidates: &mut Vec<SequenceCandidate>, limit: usize) -> bool {
    if candidates.len() <= limit {
        return false;
    }
    let mut counts = std::collections::HashMap::new();
    let mut ordered: Vec<_> = candidates
        .drain(..)
        .enumerate()
        .map(|(rank, c)| {
            let count = counts.entry(c.sequence.clip).or_insert(0usize);
            let result = (*count, rank, c);
            *count += 1;
            result
        })
        .collect();
    ordered.sort_by_key(|(within_clip, rank, _)| (*within_clip, *rank));
    *candidates = ordered.into_iter().take(limit).map(|(_, _, c)| c).collect();
    true
}

/// Window edges are processing boundaries, never video edits.
fn windows(start: f64, end: f64) -> Vec<(f64, f64)> {
    let mut result = Vec::new();
    let mut a = start;
    loop {
        let b = (a + 599.).min(end);
        result.push((a, b));
        if b >= end {
            break;
        }
        a += 300.;
    }
    result
}
fn ranges(recordings: &[crate::telemetry::Session]) -> Vec<(f64, f64)> {
    let mut ranges: Vec<(f64, f64)> = Vec::new();
    for recording in recordings {
        let mut durations: Vec<_> = recording
            .laps
            .iter()
            .filter(|l| l.complete && l.duration.is_finite() && l.duration > 1.)
            .map(|l| l.duration)
            .collect();
        durations.sort_by(f64::total_cmp);
        if durations.is_empty() {
            continue;
        }
        let median = durations[durations.len() / 2];
        let normal: Vec<_> = durations
            .into_iter()
            .filter(|d| *d >= median * 0.65 && *d <= median * 1.5)
            .collect();
        let range = (normal[0] * 0.9, normal[normal.len() - 1] * 1.1);
        if !ranges
            .iter()
            .any(|&(a, b)| (a - range.0).abs() < 0.5 && (b - range.1).abs() < 0.5)
        {
            ranges.push(range);
        }
    }
    ranges
}
fn candidates_for(
    visual: &super::visual::VisualAnalysis,
    recordings: &[crate::telemetry::Session],
    cancel: &crate::video_analysis::CancellationToken,
) -> Result<(Vec<SequenceCandidate>, bool), String> {
    let mut candidates = Vec::new();
    let mut incomplete = visual.incomplete;
    for (hypothesis, crossings) in visual.hypotheses.iter().enumerate() {
        for recording in recordings {
            let result = super::laps::match_lap_sequences(crossings, &recording.laps, cancel)?;
            incomplete |= result.comparison_truncated;
            candidates.extend(
                result
                    .candidates
                    .into_iter()
                    .map(|sequence| SequenceCandidate {
                        recording_id: recording.id.clone(),
                        recording_name: format!(
                            "{} · {}",
                            recording.name,
                            std::path::Path::new(&recording.source)
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                        ),
                        hypothesis,
                        landmark_score: visual.landmark_scores[hypothesis],
                        marker_hypothesis: visual.marker_hypotheses[hypothesis],
                        sequence,
                        motion: None,
                        trigger_correction_seconds: None,
                    }),
            );
        }
    }
    rank(&mut candidates);
    Ok((candidates, incomplete))
}
fn merged_windows(mut windows: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    windows.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (a, b) in windows {
        if let Some(last) = merged.last_mut().filter(|last| last.1 >= a) {
            last.1 = last.1.max(b);
        } else {
            merged.push((a, b));
        }
    }
    merged
}
fn uncovered_windows(requested: &[(f64, f64)], covered: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut result = Vec::new();
    for &(a, b) in requested {
        let mut cursor = a;
        for &(x, y) in covered {
            if y <= cursor {
                continue;
            }
            if x >= b {
                break;
            }
            if x > cursor {
                result.push((cursor, x.min(b)));
            }
            cursor = cursor.max(y);
            if cursor >= b {
                break;
            }
        }
        if cursor < b {
            result.push((cursor, b));
        }
    }
    result
}
/// All recordings share one full-video scan. Cache is optional and identity validated.
pub fn analyze_path(
    path: &std::path::Path,
    recordings: &[crate::telemetry::Session],
    start: f64,
    end: f64,
    cancel: &crate::video_analysis::CancellationToken,
    progress: impl FnMut(&str, f64),
) -> Result<super::SyncResult, String> {
    analyze_path_cached(path, recordings, start, end, cancel, progress, None)
}
pub fn analyze_path_cached(
    path: &std::path::Path,
    recordings: &[crate::telemetry::Session],
    start: f64,
    end: f64,
    cancel: &crate::video_analysis::CancellationToken,
    mut progress: impl FnMut(&str, f64),
    cache: Option<&std::path::Path>,
) -> Result<super::SyncResult, String> {
    use crate::video_analysis::{
        self, motion::MotionTracker, PixelFormat, ResizeOptions, SamplingOptions,
    };
    let began = std::time::Instant::now();
    let metadata = video_analysis::inspect(path, cancel).map_err(|e| e.to_string())?;
    super::service::validate_interval(start, end, metadata.duration_seconds)?;
    if recordings.is_empty() || recordings.len() > 32 {
        return Err("Choose between one and 32 imported recordings".into());
    }
    let ranges = ranges(recordings);
    if ranges.is_empty() {
        return Err("No complete recorded laps are available".into());
    }
    let scan = super::scan::scan_path(
        path,
        start,
        end,
        cancel,
        |phase, p| progress(phase, p * 0.45),
        cache,
    )?;
    let mut frames = scan.sampled_frames;
    let bounds = windows(start, end);
    let mut analyses = Vec::new();
    let mut fine_windows = Vec::new();
    let mut incomplete = false;
    for (i, &(a, b)) in bounds.iter().enumerate() {
        let mut visual = scan
            .analyzer
            .window(a, b)?
            .finish_recordings(&ranges, recordings, cancel)?;
        let (coarse, truncated) = candidates_for(&visual, recordings, cancel)?;
        incomplete |= truncated;
        let mut priorities = Vec::new();
        let mut recordings_seen = Vec::new();
        // Refine each recording's best local marker before spending capacity on alternatives.
        for c in &coarse {
            if c.marker_hypothesis
                && !recordings_seen.contains(&c.recording_id)
                && !priorities.contains(&c.hypothesis)
            {
                priorities.push(c.hypothesis);
                recordings_seen.push(c.recording_id.clone());
                if priorities.len() == 3 {
                    break;
                }
            }
        }
        for c in &coarse {
            if priorities.len() == 3 {
                break;
            }
            if c.marker_hypothesis && !priorities.contains(&c.hypothesis) {
                priorities.push(c.hypothesis);
            }
        }
        for c in &coarse {
            if priorities.len() == 3 {
                break;
            }
            if !priorities.contains(&c.hypothesis) {
                priorities.push(c.hypothesis);
            }
        }
        visual.prioritize(&priorities)?;
        fine_windows.extend(
            visual
                .refinement_windows()
                .into_iter()
                .map(|(a, b)| (a.max(start), b.min(end)))
                .filter(|(a, b)| b > a),
        );
        analyses.push(visual);
        progress(
            "matching",
            0.45 + 0.1 * (i + 1) as f64 / bounds.len() as f64,
        );
    }
    // Overlapping analysis windows reuse the same fine descriptor and media PTS.
    let merged = merged_windows(fine_windows);
    let mut fine_features = Vec::new();
    let resize = ResizeOptions {
        max_width: 320,
        max_height: 180,
    };
    for (i, &(a, b)) in merged.iter().enumerate() {
        video_analysis::sample_frames(
            path,
            SamplingOptions {
                start_seconds: a,
                end_seconds: Some(b),
                interval_seconds: 0.1,
                resize,
                pixel_format: PixelFormat::Gray8,
            },
            cancel,
            |frame| {
                let feature = super::visual::FineFeature::from_frame(&frame)?;
                for visual in &mut analyses {
                    visual.refine_feature(&feature)?;
                }
                fine_features.push(feature);
                frames += 1;
                Ok(())
            },
            |_| {},
        )
        .map_err(|e| e.to_string())?;
        progress(
            "matching",
            0.55 + 0.25 * (i + 1) as f64 / merged.len().max(1) as f64,
        );
    }
    let mut candidates = Vec::new();
    for visual in &analyses {
        let (found, truncated) = candidates_for(visual, recordings, cancel)?;
        incomplete |= truncated;
        candidates.extend(found);
    }
    rank(&mut candidates);
    incomplete |= limit_per_clip(&mut candidates, 4096);
    let mut assignment = super::assignment::assign_recordings(
        &candidates,
        start,
        end,
        incomplete,
        recordings,
        cancel,
    )?;
    // Learn the physical marking from supported scenes, then seek it everywhere without recording order.
    let mut templates = Vec::new();
    for segment in assignment.segments.iter().filter(|s| s.is_proposed()) {
        for boundary in &segment.boundaries {
            if let Some(feature) = fine_features
                .iter()
                .filter(|f| {
                    (f.time - boundary.video_seconds).abs() <= 0.15 && f.checker_score() >= 0.15
                })
                .max_by(|a, b| a.checker_score().total_cmp(&b.checker_score()))
            {
                templates.push(feature.clone());
                if templates.len() == 32 {
                    break;
                }
            }
        }
        if templates.len() == 32 {
            break;
        }
    }
    if !templates.is_empty() {
        let mut transferred = Vec::new();
        let mut requests = Vec::new();
        for &(a, b) in &bounds {
            let mut visual = scan
                .analyzer
                .window(a, b)?
                .finish_transferred(&templates, &ranges, recordings, cancel)?;
            for feature in &fine_features {
                visual.refine_feature(feature).map_err(|e| e.to_string())?;
            }
            requests.extend(
                visual
                    .refinement_windows()
                    .into_iter()
                    .map(|(a, b)| (a.max(start), b.min(end)))
                    .filter(|(a, b)| b > a),
            );
            transferred.push(visual);
        }
        let missing = uncovered_windows(&merged_windows(requests), &merged);
        for (i, &(a, b)) in missing.iter().enumerate() {
            video_analysis::sample_frames(
                path,
                SamplingOptions {
                    start_seconds: a,
                    end_seconds: Some(b),
                    interval_seconds: 0.1,
                    resize,
                    pixel_format: PixelFormat::Gray8,
                },
                cancel,
                |frame| {
                    let feature = super::visual::FineFeature::from_frame(&frame)?;
                    for visual in &mut transferred {
                        visual.refine_feature(&feature)?;
                    }
                    frames += 1;
                    Ok(())
                },
                |_| {},
            )
            .map_err(|e| e.to_string())?;
            progress(
                "matching",
                0.80 + 0.15 * (i + 1) as f64 / missing.len().max(1) as f64,
            );
        }
        for visual in &transferred {
            let (found, truncated) = candidates_for(visual, recordings, cancel)?;
            incomplete |= truncated;
            candidates.extend(found);
        }
        rank(&mut candidates);
        incomplete |= limit_per_clip(&mut candidates, 4096);
        assignment = super::assignment::assign_recordings(
            &candidates,
            start,
            end,
            incomplete,
            recordings,
            cancel,
        )?;
    }
    let mut warnings=vec!["XRK-conditioned marker proposals are unvalidated; fit residuals are not independent timing accuracy.".into(),"Proposed bounds stop at observed crossings. Pit/out/in tails, gaps and ambiguous regions remain unmapped. Automatic application is disabled.".into()];
    if let Some(note) = scan.cache_note.clone() {
        warnings.push(note);
    }
    let mut signatures = std::collections::HashMap::new();
    for segment in assignment
        .segments
        .iter()
        .filter(|s| s.is_proposed())
        .take(32)
    {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let a = segment.video_start_seconds;
        let b = segment.video_end_seconds.min(a + 599.);
        let mut motion = Vec::new();
        let mut tracker: Option<MotionTracker> = None;
        video_analysis::sample_frames(
            path,
            SamplingOptions {
                start_seconds: a,
                end_seconds: Some(b),
                interval_seconds: 0.2,
                resize,
                pixel_format: PixelFormat::Gray8,
            },
            cancel,
            |frame| {
                if tracker.is_none() {
                    tracker = Some(MotionTracker::new(frame.width, frame.height)?);
                }
                motion.push(tracker.as_mut().unwrap().push(&frame)?);
                frames += 1;
                Ok(())
            },
            |_| {},
        )
        .map_err(|e| e.to_string())?;
        if !signatures.contains_key(&segment.recording_id) {
            let recording = recordings
                .iter()
                .find(|r| r.id == segment.recording_id)
                .ok_or("Unknown recording in assignment")?;
            match super::telemetry::telemetry_signature_cancellable(recording, cancel) {
                Ok(signature) => {
                    signatures.insert(recording.id.clone(), signature);
                }
                Err(e) => {
                    if cancel.is_cancelled() {
                        return Err(e);
                    }
                    warnings.push(format!(
                        "Motion refinement unavailable for {}: {e}",
                        recording.name
                    ));
                    signatures.insert(recording.id.clone(), vec![]);
                }
            }
        }
        let refined = super::matching::refine_near(
            &motion,
            &signatures[&segment.recording_id],
            segment.offset_seconds,
            2.,
            cancel,
        )?;
        if let Some(candidate) = candidates.get_mut(segment.candidate_index) {
            candidate.trigger_correction_seconds = refined
                .as_ref()
                .filter(|c| c.consistent)
                .map(|c| c.offset_seconds - segment.offset_seconds);
            candidate.motion = refined;
        }
    }
    // Preserve selected-recording motion fallback for short intervals without an identified sequence.
    let mut fallback = Vec::new();
    if candidates.is_empty() {
        if let Ok(signature) =
            super::telemetry::telemetry_signature_cancellable(&recordings[0], cancel)
        {
            for &(a, b) in &bounds {
                let mut motion: Vec<_> = scan
                    .coarse_motion
                    .iter()
                    .copied()
                    .filter(|s| s.time >= a && s.time < b)
                    .collect();
                for sample in &mut motion {
                    if scan.analyzer.cuts().iter().any(|c| {
                        sample.time >= c.start_seconds && sample.time <= c.end_seconds + 0.4
                    }) {
                        sample.yaw = None;
                        sample.quality = 0.;
                    }
                }
                if let Some(first) = motion.first_mut() {
                    first.yaw = None;
                    first.quality = 0.;
                }
                let result =
                    super::matching::match_signatures_cancellable(&motion, &signature, cancel)?;
                super::matching::retain_distinct_candidates(&mut fallback, result.candidates);
            }
            fallback.truncate(8);
        }
        warnings.push("Motion-only fallback uses the selected recording and establishes no multi-recording coverage.".into());
    }
    if cancel.is_cancelled() {
        return Err("Video analysis cancelled".into());
    }
    scan.validate_source_unchanged(path)?;
    assignment.comparison_incomplete |= incomplete;
    progress("matching", 1.);
    Ok(super::SyncResult{
        candidates:fallback,ambiguous:true,applicable:false,rejection_reason:Some("Review proposed recording intervals; ambiguous and unsupported footage stays unmapped. Automatic application is disabled.".into()),
        sequence:Some(SequenceEvidence{candidates,cuts:scan.analyzer.cuts().to_vec(),comparison_incomplete:incomplete,competitor_margin:assignment.competitor_margin,confidence:"Multiple-recording proposals; XRK-conditioned and unvalidated".into(),warnings,sampled_frames:frames,runtime_seconds:began.elapsed().as_secs_f64(),scan_seconds:scan.runtime_seconds,cache_hit:scan.cache_hit,cached_frames:scan.cached_frames,window_count:bounds.len(),assignment}),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(recording: &str, offset: f64, n: usize) -> SequenceCandidate {
        SequenceCandidate {
            recording_id: recording.into(),
            recording_name: recording.into(),
            hypothesis: 0,
            landmark_score: 0.,
            marker_hypothesis: false,
            sequence: LapSequenceCandidate {
                clip: 0,
                offset_seconds: offset,
                matches: (0..n)
                    .map(|i| super::super::laps::BoundaryMatch {
                        video_seconds: i as f64 * 27.,
                        telemetry_seconds: i as f64 * 27. + offset,
                        lap_number: i as i32 + 1,
                        residual_seconds: 0.,
                    })
                    .collect(),
                rms_residual_seconds: 0.,
                max_residual_seconds: 0.,
                interval_rms_seconds: 0.,
                skipped_crossings: 0,
                score: 0.9,
            },
            motion: None,
            trigger_correction_seconds: None,
        }
    }
    #[test]
    fn preserves_equal_competing_recordings_and_distinct_landmark_phases() {
        let mut candidates = vec![
            candidate("a", -1200., 11),
            candidate("b", -1200., 11),
            candidate("a", -1205., 11),
            candidate("a", -1200.1, 4),
        ];
        rank(&mut candidates);
        assert_eq!(candidates.len(), 3);
        assert_eq!(candidates[0].sequence.matches.len(), 11);
        assert!(candidates.iter().any(|c| c.recording_id == "b"));
    }
    #[test]
    fn repeated_checker_support_prioritizes_marking_but_is_not_single_frame_proof() {
        let generic = candidate("a", -1217., 11);
        let mut marking = candidate("a", -1211., 7);
        marking.landmark_score = 0.2;
        let mut weak = candidate("b", -1200., 4);
        weak.landmark_score = 0.9;
        let mut proposals = vec![generic, weak, marking];
        rank(&mut proposals);
        assert_eq!(proposals[0].sequence.offset_seconds, -1211.);
        assert_eq!(proposals[1].sequence.offset_seconds, -1217.);
    }
    #[test]
    fn candidate_limit_keeps_other_edited_clips_visible() {
        let mut proposals: Vec<_> = (0..20)
            .map(|i| candidate("a", -1200. - i as f64, 11))
            .collect();
        let mut other = candidate("b", -900., 4);
        other.sequence.clip = 1;
        proposals.push(other);
        assert!(limit_per_clip(&mut proposals, 16));
        assert_eq!(proposals.len(), 16);
        assert!(proposals.iter().any(|c| c.sequence.clip == 1));
    }
    #[test]
    fn windows_cover_late_recording_runs_without_treating_window_edges_as_cuts() {
        let spans = windows(0., 2636.6);
        assert_eq!(spans.len(), 8);
        assert_eq!(spans.last().unwrap().1, 2636.6);
        for t in (0..2337).step_by(10) {
            let t = t as f64;
            assert!(spans.iter().any(|&(a, b)| a <= t && b >= t + 299.));
        }
    }
    #[test]
    fn second_pass_only_decodes_unseen_neighborhoods() {
        assert_eq!(
            merged_windows(vec![(10., 12.), (11., 14.), (2., 4.)]),
            vec![(2., 4.), (10., 14.)]
        );
        assert_eq!(
            uncovered_windows(&[(1., 8.), (10., 14.)], &[(2., 4.), (6., 11.)]),
            vec![(1., 2.), (4., 6.), (11., 14.)]
        );
    }
    #[test]
    fn disjoint_same_mapping_support_survives_ranking() {
        let a = candidate("a", 100., 5);
        let mut b = a.clone();
        for point in &mut b.sequence.matches {
            point.video_seconds += 400.;
            point.telemetry_seconds += 400.;
        }
        let mut proposals = vec![a, b];
        rank(&mut proposals);
        assert_eq!(proposals.len(), 2);
    }
}
