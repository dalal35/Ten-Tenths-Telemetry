use super::*;
fn laps(durations: &[f64]) -> Vec<Lap> {
    let mut time = 10.;
    durations
        .iter()
        .enumerate()
        .map(|(i, duration)| {
            let start = time;
            time += duration;
            Lap {
                id: i.to_string(),
                number: i as i32 + 1,
                start,
                end: time,
                duration: *duration,
                complete: true,
            }
        })
        .collect()
}
fn crossings(times: &[f64]) -> Vec<VideoCrossing> {
    times
        .iter()
        .map(|time| VideoCrossing {
            time: *time,
            uncertainty_seconds: 0.1,
            clip: 0,
        })
        .collect()
}
fn matched(v: &[VideoCrossing], t: &[Lap]) -> LapSequenceResult {
    match_lap_sequences(v, t, &CancellationToken::default()).unwrap()
}
#[test]
fn distinct_sequence_and_missing_crossing() {
    let t = laps(&[27., 28., 31., 26., 29.]);
    let v = crossings(&[110., 137., 196., 222., 251.]);
    let r = matched(&v, &t);
    assert_eq!(r.candidates[0].offset_seconds, -100.);
    assert_eq!(r.candidates[0].matches.len(), 5);
    assert_eq!(r.candidates[0].skipped_crossings, 1);
    assert!(!r.ambiguous, "{r:?}");
}
#[test]
fn repeated_similar_laps_keep_alternatives_ambiguous() {
    let r = matched(&crossings(&[110., 137., 164., 191.]), &laps(&[27.; 6]));
    assert!(r.ambiguous);
    assert!(r.candidates.len() >= 3);
}
#[test]
fn clips_have_independent_offsets_and_do_not_bridge_cuts() {
    let mut v = crossings(&[
        110., 137., 165., 196., 230., 257., 285., 316., 350., 377., 405., 436.,
    ]);
    for (i, c) in v.iter_mut().enumerate() {
        c.clip = i / 4;
    }
    let r = matched(&v, &laps(&[27., 28., 31.]));
    assert!(r
        .candidates
        .iter()
        .any(|c| c.clip == 0 && c.offset_seconds == -100.));
    assert!(r
        .candidates
        .iter()
        .any(|c| c.clip == 1 && c.offset_seconds == -220.));
    assert!(r
        .candidates
        .iter()
        .any(|c| c.clip == 2 && c.offset_seconds == -340.));
    assert!(r.candidates.iter().all(|c| c.matches.len() == 4));
}
#[test]
fn incomplete_and_missing_telemetry_laps_break_continuity() {
    let v = crossings(&[110., 137., 165., 196.]);
    let mut t = laps(&[27., 28., 31.]);
    t[1].complete = false;
    assert!(matched(&v, &t).candidates.is_empty());
    let mut t = laps(&[27., 28., 31.]);
    t[2].start += 1.;
    t[2].end += 1.;
    assert!(matched(&v, &t).candidates.is_empty());
}
#[test]
fn unrelated_and_isolated_intervals_are_rejected() {
    let t = laps(&[27., 28., 31.]);
    assert!(matched(&crossings(&[110., 122., 164., 205.]), &t)
        .candidates
        .is_empty());
    assert!(matched(&crossings(&[110., 137., 165.]), &t)
        .candidates
        .is_empty());
}
#[test]
fn invalid_order_uncertainty_and_cancellation_are_rejected() {
    let t = laps(&[27., 28., 31.]);
    let mut v = crossings(&[110., 137., 165., 196.]);
    v[1].time = f64::NAN;
    assert!(match_lap_sequences(&v, &t, &CancellationToken::default()).is_err());
    v[1].time = 110.;
    assert!(match_lap_sequences(&v, &t, &CancellationToken::default()).is_err());
    v[1].time = 137.;
    v[1].uncertainty_seconds = -1.;
    assert!(match_lap_sequences(&v, &t, &CancellationToken::default()).is_err());
    let token = CancellationToken::default();
    token.cancel();
    assert!(match_lap_sequences(&[], &t, &token).is_err());
}
#[test]
fn real_approximate_eleven_stripe_observations_favor_0362() {
    let mut v = crossings(&[
        1252.75, 1280.65, 1308.05, 1335.45, 1363.85, 1390.75, 1418.15, 1444.55, 1471.45, 1498.35,
        1525.75,
    ]);
    for crossing in &mut v {
        crossing.uncertainty_seconds = 0.5;
    }
    let mut results = Vec::new();
    for recording in ["0361", "0362"] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "../data/yash dalal_59_PURDUE GP IN_Warm-up_a_{recording}.xrk"
        ));
        let session = crate::telemetry::parse_session(&path).unwrap();
        let start = std::time::Instant::now();
        let result = matched(&v, &session.laps);
        let c = &result.candidates[0];
        println!("{recording}: offset={} matched={} interval_rms={} residual_rms={} max={} score={} elapsed={:?}", c.offset_seconds, c.matches.len(), c.interval_rms_seconds, c.rms_residual_seconds, c.max_residual_seconds, c.score, start.elapsed());
        results.push(result);
    }
    let control = &results[0].candidates[0];
    let target = &results[1].candidates[0];
    assert_eq!(target.matches.len(), 11);
    assert_eq!(target.matches[0].lap_number, 2);
    assert!((target.matches[0].telemetry_seconds - 41.295).abs() < 0.001);
    assert!((target.offset_seconds + 1211.41).abs() < 0.1);
    assert!(target.score > control.score);
    assert!(target.interval_rms_seconds < control.interval_rms_seconds);
    // These observations identify a sequence; they do not bound stripe-to-trigger bias.
}

#[test]
fn large_repeated_search_reports_incomplete_comparison() {
    let v = crossings(&(0..256).map(|i| 110. + i as f64 * 27.).collect::<Vec<_>>());
    let result = matched(&v, &laps(&[27.; 512]));
    assert!(result.comparison_truncated);
    assert!(result.ambiguous);
    assert!(result.candidates.len() <= 32);
}

#[test]
fn disjoint_runs_with_same_offset_survive_a_pit_gap_without_a_cut() {
    let mut t = laps(&[27., 28., 31., 200., 26., 29., 30.]);
    t[3].complete = false;
    let v = crossings(&[110., 137., 165., 196., 396., 422., 451., 481.]);
    let r = matched(&v, &t);
    let actual: Vec<_> = r
        .candidates
        .iter()
        .filter(|c| (c.offset_seconds + 100.).abs() < 0.001)
        .collect();
    assert_eq!(actual.len(), 2, "{r:?}");
    assert!(actual.iter().any(|c| c.matches[0].video_seconds == 110.));
    assert!(actual.iter().any(|c| c.matches[0].video_seconds == 396.));
    assert!(!r.ambiguous, "Disjoint runs do not compete: {r:?}");
}
