use super::super::laps::LapSequenceCandidate;
use super::*;
fn candidate(id: &str, start: f64, offset: f64, durations: &[f64]) -> SequenceCandidate {
    let mut time = start;
    let mut boundaries = vec![BoundaryMatch {
        video_seconds: time,
        telemetry_seconds: time + offset,
        lap_number: 1,
        residual_seconds: 0.,
    }];
    for (i, duration) in durations.iter().enumerate() {
        time += duration;
        boundaries.push(BoundaryMatch {
            video_seconds: time,
            telemetry_seconds: time + offset,
            lap_number: i as i32 + 2,
            residual_seconds: 0.,
        });
    }
    SequenceCandidate {
        recording_id: id.into(),
        recording_name: id.into(),
        hypothesis: 0,
        landmark_score: 0.2,
        marker_hypothesis: true,
        sequence: LapSequenceCandidate {
            clip: 0,
            offset_seconds: offset,
            matches: boundaries,
            rms_residual_seconds: 0.,
            max_residual_seconds: 0.,
            interval_rms_seconds: 0.,
            skipped_crossings: 0,
            score: 0.5,
        },
        motion: None,
        trigger_correction_seconds: None,
    }
}
fn assign_all(candidates: &[SequenceCandidate]) -> Assignment {
    assign(candidates, 0., 2000., false, &Default::default()).unwrap()
}
fn selected(assignment: &Assignment) -> Vec<&AssignmentSegment> {
    assignment
        .segments
        .iter()
        .filter(|s| s.status == AssignmentStatus::Selected)
        .collect()
}
#[test]
fn simultaneous_recordings_need_no_order_or_cut_and_leave_tails_unmapped() {
    let a = candidate("0361", 100., 10., &[27., 28., 29., 26., 27., 28.]);
    let b = candidate("0362", 600., -590., &[26., 28., 27., 29., 26., 28.]);
    for inputs in [vec![a.clone(), b.clone()], vec![b.clone(), a.clone()]] {
        let result = assign_all(&inputs);
        let chosen = selected(&result);
        assert_eq!(chosen.len(), 2);
        assert_eq!(chosen[0].recording_id, "0361");
        assert_eq!(chosen[1].recording_id, "0362");
        assert_eq!(chosen[0].video_start_seconds, 100.);
        assert_eq!(chosen[0].video_end_seconds, 265.);
        assert_eq!(result.unmapped_gaps.len(), 3);
        assert_eq!(result.unmapped_gaps[1].video_start_seconds, 265.);
        assert_eq!(result.unmapped_gaps[1].video_end_seconds, 600.);
    }
}
#[test]
fn same_recording_can_recur_in_video_with_repeated_telemetry() {
    let a = candidate("same", 100., -90., &[27.; 6]);
    let b = candidate("same", 600., -590., &[27.; 6]);
    let r = assign_all(&[a, b]);
    assert_eq!(selected(&r).len(), 2);
    assert_eq!(selected(&r)[0].telemetry_start_seconds, 10.);
    assert_eq!(selected(&r)[1].telemetry_start_seconds, 10.);
}
#[test]
fn pit_duration_splits_even_without_visual_edit() {
    let c = candidate(
        "a",
        100.,
        -90.,
        &[
            27., 28., 26., 29., 27., 28., 200., 27., 28., 26., 29., 27., 28.,
        ],
    );
    let r = assign_all(&[c]);
    let chosen = selected(&r);
    assert_eq!(chosen.len(), 2, "{r:?}");
    assert_eq!(chosen[0].video_end_seconds, 265.);
    assert_eq!(chosen[1].video_start_seconds, 465.);
    assert!(r
        .unmapped_gaps
        .iter()
        .any(|g| g.video_start_seconds == 265. && g.video_end_seconds == 465.));
}
#[test]
fn missed_normal_crossing_does_not_split_a_supported_sequence() {
    let mut c = candidate("a", 100., -90., &[27., 55., 29., 26., 27., 28.]);
    for b in &mut c.sequence.matches[2..] {
        b.lap_number += 1;
    }
    c.sequence.skipped_crossings = 1;
    let r = assign_all(&[c]);
    assert_eq!(selected(&r).len(), 1);
    assert_eq!(selected(&r)[0].matched_laps, 7);
}
#[test]
fn duplicate_chunk_hypotheses_union_support_without_double_counting() {
    let base = candidate("a", 100., -90., &[27.; 8]);
    let mut a = base.clone();
    a.sequence.matches = base.sequence.matches[..6].to_vec();
    let mut b = base.clone();
    b.sequence.matches = base.sequence.matches[3..].to_vec();
    let r = assign_all(&[a.clone(), b, a]);
    let chosen = selected(&r);
    assert_eq!(chosen.len(), 1);
    assert_eq!(chosen[0].boundaries.len(), 9);
    assert_eq!(chosen[0].candidate_indices.len(), 3);
    assert!((chosen[0].unique_interval_evidence - 8. * 0.95).abs() < 1e-8);
}
#[test]
fn different_clips_are_not_merged_across_a_cut() {
    let a = candidate("a", 100., -90., &[27.; 6]);
    let mut b = candidate("a", 262., -90., &[27.; 6]);
    for boundary in &mut b.sequence.matches {
        boundary.lap_number += 6;
    }
    b.sequence.clip = 1;
    let r = assign_all(&[a, b]);
    assert_eq!(selected(&r).len(), 2);
    assert_ne!(selected(&r)[0].clip, selected(&r)[1].clip);
}
#[test]
fn repeated_offsets_and_recording_ties_reject_only_the_ambiguous_region() {
    let a = candidate("a", 100., -90., &[27.; 6]);
    let b = candidate("b", 100., -60., &[27.; 6]);
    let c = candidate("a", 600., -590., &[27., 26., 29., 28., 27., 28.]);
    let r = assign_all(&[a, b, c]);
    assert_eq!(selected(&r).len(), 1);
    assert_eq!(selected(&r)[0].video_start_seconds, 600.);
    assert_eq!(
        r.segments
            .iter()
            .filter(|s| s.status == AssignmentStatus::RejectedAmbiguous)
            .count(),
        2
    );
    assert_eq!(r.competitor_margin, Some(0.));
    assert!(r
        .unmapped_gaps
        .iter()
        .any(|g| g.video_start_seconds == 0. && g.video_end_seconds == 600.));
}
#[test]
fn absolute_unique_support_beats_sum_of_normalized_fragment_scores() {
    let mut long = candidate("long", 100., -90., &[25.; 16]);
    long.sequence.score = 0.1;
    let mut a = candidate("short-a", 100., -90., &[25.; 6]);
    a.sequence.score = 1.;
    let mut b = candidate("short-b", 350., -340., &[25.; 6]);
    b.sequence.score = 1.;
    let r = assign_all(&[a, long, b]);
    assert_eq!(selected(&r).len(), 1, "{r:?}");
    assert_eq!(selected(&r)[0].recording_id, "long");
}
#[test]
fn competing_global_combination_can_make_a_long_span_ambiguous() {
    let long = candidate("long", 100., -90., &[25.; 12]);
    let a = candidate("short-a", 100., -90., &[25.; 6]);
    let b = candidate("short-b", 250., -240., &[25.; 6]);
    let separate = candidate("separate", 600., -590., &[27.; 6]);
    let r = assign_all(&[long, a, b, separate]);
    assert_eq!(selected(&r).len(), 1, "{r:?}");
    assert_eq!(selected(&r)[0].recording_id, "separate");
    assert_eq!(
        r.segments
            .iter()
            .filter(|s| s.status == AssignmentStatus::RejectedAmbiguous)
            .count(),
        3
    );
}
#[test]
fn generic_phase_and_too_short_marker_support_remain_insufficient() {
    let mut generic = candidate("a", 100., -90., &[27.; 8]);
    generic.marker_hypothesis = false;
    let short = candidate("b", 500., -490., &[27.; 3]);
    let r = assign_all(&[generic, short]);
    assert!(selected(&r).is_empty());
    assert!(r
        .segments
        .iter()
        .all(|s| s.status == AssignmentStatus::InsufficientEvidence));
    assert_eq!(r.unmapped_gaps.len(), 1);
}
#[test]
fn incomplete_comparisons_keep_proposals_but_do_not_claim_selection() {
    let c = candidate("a", 100., -90., &[27.; 6]);
    let r = assign(&[c], 0., 2000., true, &Default::default()).unwrap();
    assert!(r.comparison_incomplete);
    assert!(selected(&r).is_empty());
    assert_eq!(r.segments[0].status, AssignmentStatus::Provisional);
    assert!(r.segments[0].comparison_incomplete);
}
#[test]
fn empty_invalid_and_cancelled_inputs_are_handled() {
    assert_eq!(assign_all(&[]).unmapped_gaps.len(), 1);
    let token = CancellationToken::default();
    token.cancel();
    assert!(assign(&[], 0., 2000., false, &token).is_err());
    assert!(assign(&[], f64::NAN, 2000., false, &Default::default()).is_err());
    let mut c = candidate("a", 100., -90., &[27.; 6]);
    c.sequence.matches[1].video_seconds = 99.;
    assert!(assign(&[c], 0., 2000., false, &Default::default()).is_err());
}

#[test]
fn jittered_duplicate_boundaries_keep_actual_pts_and_unique_support() {
    let base = candidate("a", 100., -90., &[27.; 6]);
    let mut jittered = base.clone();
    for boundary in &mut jittered.sequence.matches {
        boundary.video_seconds += 0.1;
        boundary.residual_seconds = -0.1;
    }
    jittered.sequence.offset_seconds -= 0.1;
    let r = assign_all(&[base, jittered]);
    let chosen = selected(&r);
    assert_eq!(chosen.len(), 1);
    assert_eq!(chosen[0].boundaries.len(), 7);
    assert_eq!(chosen[0].video_start_seconds, 100.);
    assert_eq!(chosen[0].video_end_seconds, 262.);
}
#[test]
fn generic_duplicates_cannot_extend_a_confirmed_marker_span() {
    let mut generic = candidate("a", 100., -90., &[27.; 10]);
    generic.marker_hypothesis = false;
    let mut marker = generic.clone();
    marker.marker_hypothesis = true;
    marker.sequence.matches = marker.sequence.matches[3..10].to_vec();
    let r = assign_all(&[generic, marker]);
    assert_eq!(selected(&r).len(), 1);
    assert_eq!(selected(&r)[0].video_start_seconds, 181.);
    assert_eq!(selected(&r)[0].video_end_seconds, 343.);
}
#[test]
fn candidate_budget_reports_provisional_results_and_never_forces_unknown_coverage() {
    let c: Vec<_> = (0..520)
        .map(|i| candidate(&i.to_string(), 100., -90., &[27.; 6]))
        .collect();
    let r = assign_all(&c);
    assert!(r.comparison_incomplete);
    assert!(r.segments.len() <= 512);
    assert!(selected(&r).is_empty());
    assert_eq!(r.unmapped_gaps.len(), 1);
}

fn recording(id: &str, durations: &[f64]) -> crate::telemetry::Session {
    let mut time = 10.;
    let laps = durations
        .iter()
        .enumerate()
        .map(|(i, duration)| {
            let start = time;
            time += duration;
            crate::telemetry::Lap {
                id: i.to_string(),
                number: i as i32 + 1,
                start,
                end: time,
                duration: *duration,
                complete: true,
            }
        })
        .collect();
    crate::telemetry::Session {
        id: id.into(),
        source: id.into(),
        name: id.into(),
        driver: String::new(),
        track: String::new(),
        recorded_at: String::new(),
        channels: vec![],
        laps,
        warnings: vec![],
        merge: None,
    }
}
#[test]
fn source_provenance_allows_missing_crossings_only_across_normal_complete_laps() {
    let mut c = candidate("a", 100., -90., &[27., 55., 29., 26., 27., 28.]);
    for b in &mut c.sequence.matches[2..] {
        b.lap_number += 1;
    }
    let session = recording("a", &[27., 27., 28., 29., 26., 27., 28.]);
    let r = assign_recordings(
        &[c.clone()],
        0.,
        2000.,
        false,
        &[session.clone()],
        &Default::default(),
    )
    .unwrap();
    assert_eq!(selected(&r).len(), 1);
    let mut out_lap = session;
    out_lap.laps[2].complete = false;
    let r = assign_recordings(&[c], 0., 2000., false, &[out_lap], &Default::default()).unwrap();
    assert!(
        selected(&r).is_empty(),
        "Hidden out/in lap must break continuity: {r:?}"
    );
}
#[test]
fn hidden_pit_lap_splits_even_when_aggregated_mean_looks_normal() {
    let durations = [
        27., 27., 27., 27., 27., 27., 27., 60., 27., 27., 27., 27., 27., 27., 27.,
    ];
    let session = recording("a", &durations);
    let mut c = candidate(
        "a",
        100.,
        -90.,
        &[
            27., 27., 27., 27., 27., 27., 114., 27., 27., 27., 27., 27., 27.,
        ],
    );
    for b in &mut c.sequence.matches[7..] {
        b.lap_number += 2;
    }
    assert_eq!(
        selected(&assign_all(&[c.clone()])).len(),
        1,
        "Mean-only control passes"
    );
    let mut generic = c.clone();
    generic.marker_hypothesis = false;
    let r = assign_recordings(
        &[generic, c],
        0.,
        2000.,
        false,
        &[session],
        &Default::default(),
    )
    .unwrap();
    let chosen = selected(&r);
    assert_eq!(chosen.len(), 2, "{r:?}");
    assert_eq!(chosen[0].video_end_seconds, 262.);
    assert_eq!(chosen[1].video_start_seconds, 376.);
    assert!(chosen
        .iter()
        .all(|c| c.candidate_index == 1 && c.candidate_indices == [1]));
    assert!(r
        .unmapped_gaps
        .iter()
        .any(|g| g.video_start_seconds == 262. && g.video_end_seconds == 376.));
}
#[test]
fn source_provenance_rejects_unknown_identity_and_broken_lap_timing() {
    let c = candidate("a", 100., -90., &[27.; 6]);
    let mut session = recording("other", &[27.; 6]);
    assert!(assign_recordings(
        &[c.clone()],
        0.,
        2000.,
        false,
        &[session.clone()],
        &Default::default()
    )
    .is_err());
    session.id = "a".into();
    session.laps[1].end += 1.;
    assert!(assign_recordings(&[c], 0., 2000., false, &[session], &Default::default()).is_err());
}

fn shifted_localizations(base: &SequenceCandidate, sign: f64) -> SequenceCandidate {
    let mut result = base.clone();
    for (i, b) in result.sequence.matches.iter_mut().enumerate() {
        let shift = if i % 2 == 0 { 0.2 * sign } else { -0.2 * sign };
        b.video_seconds += shift;
        b.residual_seconds = -shift;
    }
    result
}
#[test]
fn conflicting_localizations_cannot_inflate_four_source_boundaries_into_eligibility() {
    let base = candidate("a", 100., -90., &[27.; 3]);
    let a = shifted_localizations(&base, 1.);
    let b = shifted_localizations(&base, -1.);
    let r = assign_all(&[a, b]);
    assert!(selected(&r).is_empty(), "{r:?}");
    assert_eq!(r.segments.len(), 2);
    assert!(r
        .segments
        .iter()
        .all(|s| s.boundaries.len() == 4 && s.status == AssignmentStatus::InsufficientEvidence));
    assert!(r.segments.iter().all(|s| s
        .boundaries
        .windows(2)
        .all(|w| w[0].telemetry_seconds < w[1].telemetry_seconds
            && w[0].video_seconds < w[1].video_seconds)));
}
#[test]
fn incompatible_localizations_remain_competing_mapping_hypotheses() {
    let base = candidate("a", 100., -90., &[27.; 7]);
    let a = shifted_localizations(&base, 1.);
    let b = shifted_localizations(&base, -1.);
    let r = assign_all(&[a, b]);
    assert_eq!(r.segments.len(), 2);
    assert!(r
        .segments
        .iter()
        .all(|s| s.boundaries.len() == 8 && s.status == AssignmentStatus::RejectedAmbiguous));
    assert_eq!(r.competitor_margin, Some(0.));
}
#[test]
fn intermediate_localization_cannot_hide_original_incompatibility() {
    let base = candidate("a", 100., -90., &[27.; 7]);
    let a = shifted_localizations(&base, 1.);
    let b = shifted_localizations(&base, -1.);
    let r = assign_all(&[a, base, b]);
    assert_eq!(r.segments.len(), 2, "{r:?}");
    assert!(r.segments.iter().all(|s| s.boundaries.len() == 8));
    assert!(r.segments.iter().any(|s| s.candidate_indices == [0, 1]));
    assert!(r.segments.iter().any(|s| s.candidate_indices == [2]));
}
#[test]
fn source_identity_union_rejects_backwards_or_repeated_telemetry_after_merge() {
    let base = candidate("a", 100., -90., &[27.; 6]);
    let mut different = base.clone();
    for b in &mut different.sequence.matches {
        b.video_seconds += 0.1;
        b.telemetry_seconds += 0.1;
    }
    // Each hypothesis is ordered, but their union repeats lap identities at different times.
    let r = assign_all(&[base, different]);
    assert_eq!(r.segments.len(), 2);
    assert!(r.segments.iter().all(|s| s.boundaries.len() == 7));
    assert!(r.segments.iter().all(|s| s
        .boundaries
        .windows(2)
        .all(|w| w[0].lap_number < w[1].lap_number
            && w[0].telemetry_seconds < w[1].telemetry_seconds)));
}

#[test]
fn four_interval_coincidence_abstains_even_with_high_candidate_fit() {
    let mut tail = candidate("0362", 2100., -2090., &[27.; 4]);
    tail.sequence.score = 1.;
    tail.landmark_score = 1.;
    let r = assign_recordings(
        &[tail],
        0.,
        2636.,
        false,
        &[recording("0362", &[27.; 4])],
        &Default::default(),
    )
    .unwrap();
    assert_eq!(r.segments[0].boundaries.len(), 5);
    assert_eq!(r.segments[0].status, AssignmentStatus::InsufficientEvidence);
    assert!(selected(&r).is_empty());
    assert_eq!(r.unmapped_gaps.len(), 1);
    assert_eq!(r.unmapped_gaps[0].video_end_seconds, 2636.);
}
#[test]
fn six_observed_intervals_support_a_partial_recording_without_extrapolation() {
    let mut c = candidate("a", 100., -90., &[27.; 20]);
    c.sequence.matches = c.sequence.matches[4..11].to_vec();
    let r = assign_recordings(
        &[c],
        0.,
        2000.,
        false,
        &[recording("a", &[27.; 20])],
        &Default::default(),
    )
    .unwrap();
    let chosen = selected(&r);
    assert_eq!(chosen.len(), 1);
    assert_eq!(chosen[0].boundaries.len(), MIN_OBSERVED_INTERVALS + 1);
    assert_eq!(chosen[0].video_start_seconds, 208.);
    assert_eq!(chosen[0].video_end_seconds, 370.);
    assert_eq!(chosen[0].telemetry_start_seconds, 118.);
    assert_eq!(chosen[0].telemetry_end_seconds, 280.);
}
#[test]
fn duplicate_windows_cannot_inflate_six_source_boundaries_past_the_policy() {
    let base = candidate("a", 100., -90., &[27.; 5]);
    let mut duplicate = base.clone();
    for b in &mut duplicate.sequence.matches {
        b.video_seconds += 0.1;
        b.residual_seconds = -0.1;
    }
    duplicate.sequence.offset_seconds -= 0.1;
    let r = assign_all(&[base.clone(), duplicate, base]);
    assert_eq!(r.segments.len(), 1);
    assert_eq!(r.segments[0].boundaries.len(), 6);
    assert_eq!(r.segments[0].status, AssignmentStatus::InsufficientEvidence);
    assert!(selected(&r).is_empty());
}
#[test]
fn skipped_lap_count_cannot_replace_observed_interval_support() {
    let mut c = candidate("a", 100., -90., &[54.; 4]);
    for (i, b) in c.sequence.matches.iter_mut().enumerate() {
        b.lap_number = i as i32 * 2 + 1;
    }
    let r = assign_recordings(
        &[c],
        0.,
        2000.,
        false,
        &[recording("a", &[27.; 8])],
        &Default::default(),
    )
    .unwrap();
    assert_eq!(r.segments[0].matched_laps, 8);
    assert_eq!(r.segments[0].boundaries.len(), 5);
    assert_eq!(r.segments[0].status, AssignmentStatus::InsufficientEvidence);
    assert!(selected(&r).is_empty());
}
#[test]
fn repeated_same_xrk_with_six_observed_intervals_is_retained() {
    let a = candidate("same", 100., -90., &[27.; 6]);
    let b = candidate("same", 600., -590., &[27.; 6]);
    let r = assign_recordings(
        &[b, a],
        0.,
        2000.,
        false,
        &[recording("same", &[27.; 6])],
        &Default::default(),
    )
    .unwrap();
    let chosen = selected(&r);
    assert_eq!(chosen.len(), 2);
    assert_eq!(
        chosen[0].telemetry_start_seconds,
        chosen[1].telemetry_start_seconds
    );
    assert_eq!(
        chosen[0].telemetry_end_seconds,
        chosen[1].telemetry_end_seconds
    );
    assert_eq!(chosen[0].boundaries.len(), 7);
    assert_eq!(chosen[1].boundaries.len(), 7);
}
