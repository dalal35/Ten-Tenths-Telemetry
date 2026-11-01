use super::matching::match_signatures;
use super::TelemetrySample;
use crate::video_analysis::motion::MotionSample;

fn signal(t: f64) -> f64 {
    [(4., 1.), (10., -0.8), (17., 1.4)]
        .iter()
        .map(|(c, a)| a * (-((t - c) / 0.8).powi(2)).exp())
        .sum()
}
fn inputs(sign: f64, repeat: bool) -> (Vec<MotionSample>, Vec<TelemetrySample>) {
    let video = (0..121)
        .map(|i| {
            let t = i as f64 * 0.2;
            MotionSample {
                time: t,
                yaw: Some(signal(t) * sign),
                quality: 1.,
            }
        })
        .collect();
    let telemetry = (0..if repeat { 351 } else { 201 })
        .map(|i| {
            let t = i as f64 * 0.2;
            TelemetrySample {
                time: t,
                yaw: Some(signal(t - 5.) + if repeat { signal(t - 35.) } else { 0. }),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    (video, telemetry)
}
#[test]
fn finds_offset_and_reverse_sign() {
    for sign in [1., -1.] {
        let (v, t) = inputs(sign, false);
        let r = match_signatures(&v, &t);
        let c = &r.candidates[0];
        assert!((c.offset_seconds - 5.).abs() < 0.11, "{c:?}");
        assert_eq!(c.sign, sign as i8);
        assert!(c.windows.len() >= 3);
        assert!(!r.applicable);
    }
}
#[test]
fn repeated_laps_are_ambiguous() {
    let (v, t) = inputs(1., true);
    let r = match_signatures(&v, &t);
    assert!(r.ambiguous, "{r:?}");
    assert_eq!(
        r.rejection_reason.as_deref(),
        Some("Competing peaks are too close")
    );
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 5.).abs() < 0.11));
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 35.).abs() < 0.11));
    assert!(!r.applicable);
}
#[test]
fn insufficient_motion_and_quality_are_rejected() {
    let (mut v, t) = inputs(1., false);
    for s in &mut v {
        s.quality = 0.;
    }
    let r = match_signatures(&v, &t);
    assert!(r.candidates.is_empty());
    assert!(!r.applicable);
    for s in &mut v {
        s.quality = 1.;
        s.yaw = Some(0.);
    }
    let r = match_signatures(&v, &t);
    assert!(r.candidates.is_empty());
}
#[test]
fn gaps_and_short_overlap_never_apply() {
    let (mut v, t) = inputs(1., false);
    for s in &mut v {
        if (8. ..13.).contains(&s.time) {
            s.yaw = None;
        }
    }
    let r = match_signatures(&v, &t);
    assert!(!r.applicable);
    let r = match_signatures(&v[..10], &t);
    assert!(r.candidates.is_empty());
    assert!(!r.applicable);
}

#[test]
fn inconsistent_corners_are_reported() {
    let (v, mut t) = inputs(1., false);
    for s in &mut t {
        if (20. ..24.).contains(&s.time) {
            s.yaw = s.yaw.map(|y| -y);
        }
    }
    let r = match_signatures(&v, &t);
    assert!(!r.applicable);
    assert!(r.rejection_reason.is_some());
}
#[test]
fn cut_inside_interval_is_never_applied() {
    let (mut v, t) = inputs(1., false);
    for s in &mut v {
        if (11.8..12.4).contains(&s.time) {
            s.yaw = None;
        }
    }
    let r = match_signatures(&v, &t);
    assert!(!r.applicable);
}

#[test]
fn long_intervals_are_bounded() {
    let (mut v, t) = inputs(1., false);
    v.push(MotionSample {
        time: 601.,
        yaw: Some(1.),
        quality: 1.,
    });
    let r = match_signatures(&v, &t);
    assert!(r.candidates.is_empty());
    assert!(!r.applicable);
}

#[test]
fn finds_competing_laps_across_long_telemetry() {
    let (v, _) = inputs(1., false);
    let t: Vec<_> = (0..9001)
        .map(|i| {
            let time = i as f64 * 0.2;
            TelemetrySample {
                time,
                yaw: Some(signal(time - 5.) + signal(time - 1505.)),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert!(r.ambiguous, "{r:?}");
    assert_eq!(
        r.rejection_reason.as_deref(),
        Some("Competing peaks are too close")
    );
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 5.).abs() < 0.11));
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 1505.).abs() < 0.11));
}

#[test]
fn contradictory_corner_is_reported_despite_three_supporting_windows() {
    fn four(t: f64) -> f64 {
        signal(t) + 1.2 * (-((t - 21.) / 0.8).powi(2)).exp()
    }
    let v: Vec<_> = (0..131)
        .map(|i| {
            let time = i as f64 * 0.2;
            MotionSample {
                time,
                yaw: Some(four(time)),
                quality: 1.,
            }
        })
        .collect();
    let t: Vec<_> = (0..201)
        .map(|i| {
            let time = i as f64 * 0.2;
            let x = time - 5.;
            TelemetrySample {
                time,
                yaw: Some(if (19. ..23.).contains(&x) {
                    -four(x)
                } else {
                    four(x)
                }),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    let c = r
        .candidates
        .iter()
        .find(|c| (c.offset_seconds - 5.).abs() < 0.1)
        .unwrap();
    assert!(c.windows.iter().filter(|w| w.correlation >= 0.3).count() >= 3);
    assert!(!c.consistent, "{c:?}");
}

#[test]
fn fractional_offset_with_nonzero_starts() {
    let (mut v, mut t) = inputs(1., false);
    for s in &mut v {
        s.time += 100.;
    }
    for s in &mut t {
        s.time += 100.15;
    }
    let r = match_signatures(&v, &t);
    assert!(
        (r.candidates[0].offset_seconds - 5.15).abs() <= 0.1,
        "{r:?}"
    );
}

#[test]
fn distinct_nearby_peaks_remain_ambiguous() {
    fn narrow(t: f64) -> f64 {
        [(4., 1.), (10., -0.8), (17., 1.4)]
            .iter()
            .map(|(c, a)| a * (-((t - c) / 0.25).powi(2)).exp())
            .sum()
    }
    let v: Vec<_> = (0..121)
        .map(|i| {
            let time = i as f64 * 0.2;
            MotionSample {
                time,
                yaw: Some(narrow(time)),
                quality: 1.,
            }
        })
        .collect();
    let t: Vec<_> = (0..201)
        .map(|i| {
            let time = i as f64 * 0.2;
            TelemetrySample {
                time,
                yaw: Some(narrow(time - 5.) + narrow(time - 6.2)),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert!(r.ambiguous, "{r:?}");
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 5.).abs() < 0.15));
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 6.2).abs() < 0.15));
}

#[test]
fn gap_removes_overlap_even_at_fractional_offset() {
    let (mut v, mut t) = inputs(1., false);
    for s in &mut t {
        s.time += 0.1;
    }
    let full = match_signatures(&v, &t);
    for s in &mut v {
        if (8. ..13.).contains(&s.time) {
            s.yaw = None;
        }
    }
    let gap = match_signatures(&v, &t);
    let c = gap
        .candidates
        .iter()
        .find(|c| (c.offset_seconds - 5.1).abs() < 0.2)
        .unwrap();
    assert!(c.overlap_seconds < full.candidates[0].overlap_seconds - 4.0);
    assert!(c
        .windows
        .iter()
        .all(|w| !(w.video_start_seconds < 10. && w.video_end_seconds > 10.)));
}

#[test]
fn dense_telemetry_chunks_do_not_abort_search() {
    let (v, _) = inputs(1., false);
    let t: Vec<_> = (0..130_001)
        .map(|i| {
            let time = i as f64 * 0.01;
            TelemetrySample {
                time,
                yaw: Some(signal(time - 5.) + signal(time - 1205.)),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert!(r.ambiguous, "{r:?}");
    assert!(r
        .candidates
        .iter()
        .any(|c| (c.offset_seconds - 1205.).abs() < 0.2));
}

#[test]
fn maximum_video_span_crossing_chunk_boundary_has_full_overlap() {
    let v: Vec<_> = (0..3000)
        .map(|i| {
            let time = i as f64 * 0.2;
            MotionSample {
                time,
                yaw: Some(signal(time - 100.) + signal(time - 580.)),
                quality: 1.,
            }
        })
        .collect();
    let t: Vec<_> = (0..9001)
        .map(|i| {
            let time = i as f64 * 0.2;
            TelemetrySample {
                time,
                yaw: Some(signal(time - 699.8) + signal(time - 1179.8)),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    let c = r
        .candidates
        .iter()
        .find(|c| (c.offset_seconds - 599.8).abs() < 0.2)
        .unwrap_or_else(|| panic!("{r:?}"));
    assert!(c.overlap_seconds >= 599.8, "{c:?}");
}

#[test]
fn chunk_duplicates_do_not_displace_ninth_distinct_peak() {
    use super::{matching::retain_distinct_candidates, SyncCandidate};
    let make = |offset, score| SyncCandidate {
        offset_seconds: offset,
        sign: 1,
        correlation: score,
        overlap_seconds: 20.,
        peak_width_seconds: 0.2,
        windows: vec![],
        consistent: true,
    };
    let mut all = vec![make(0., 1.)];
    let incoming: Vec<_> = (0..8)
        .map(|_| make(0., 1.))
        .chain(std::iter::once(make(50., 0.99)))
        .collect();
    retain_distinct_candidates(&mut all, incoming);
    assert!(all.iter().any(|c| c.offset_seconds == 50.), "{all:?}");
}

#[test]
fn sparse_bracketing_samples_do_not_reject_long_chunks() {
    let (v, _) = inputs(1., false);
    let t: Vec<_> = (0..5001)
        .map(|i| {
            let time = i as f64 * 0.4 + 0.2;
            TelemetrySample {
                time,
                yaw: Some(signal(time - 5.) + signal(time - 1505.)),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert!(r.ambiguous, "{r:?}");
    assert!(
        r.candidates
            .iter()
            .any(|c| (c.offset_seconds - 1505.).abs() < 0.25),
        "{r:?}"
    );
}

#[test]
fn cancelled_match_stops_before_search() {
    let video = vec![];
    let telemetry = vec![];
    let cancel = crate::video_analysis::CancellationToken::default();
    cancel.cancel();
    assert!(super::matching::match_signatures_cancellable(&video, &telemetry, &cancel).is_err());
}

#[test]
fn longer_multi_event_match_outranks_perfect_short_edge() {
    let pattern = |x: f64| {
        [(12., 1.), (36., -0.8), (65., 1.2), (94., -1.)]
            .iter()
            .map(|(c, a)| a * (-((x - c) / 1.2).powi(2)).exp())
            .sum::<f64>()
    };
    let v: Vec<_> = (0..601)
        .map(|i| {
            let time = i as f64 * 0.2;
            MotionSample {
                time,
                yaw: Some(pattern(time) + 0.15 * (time * 1.7).sin()),
                quality: 1.,
            }
        })
        .collect();
    let t: Vec<_> = (0..1001)
        .map(|i| {
            let time = i as f64 * 0.2;
            TelemetrySample {
                time,
                yaw: Some(
                    pattern(time - 30.)
                        + if time < 11.2 {
                            pattern(time + 109.) + 0.15 * ((time + 109.) * 1.7).sin()
                        } else {
                            0.
                        },
                ),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert!((r.candidates[0].offset_seconds - 30.).abs() < 0.3, "{r:?}");
}

#[test]
fn jitter_within_one_turn_does_not_count_as_multiple_events() {
    let v: Vec<_> = (0..151)
        .map(|i| {
            let time = i as f64 * 0.2;
            let y = (-((time - 12.) / 4.).powi(2)).exp() * (1. + 0.15 * (time * 4.).sin());
            MotionSample {
                time,
                yaw: Some(y),
                quality: 1.,
            }
        })
        .collect();
    let t: Vec<_> = v
        .iter()
        .map(|s| TelemetrySample {
            time: s.time + 5.,
            yaw: s.yaw,
            curvature: None,
            speed: None,
            acceleration: None,
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert!(r.candidates[0].windows.len() < 3, "{r:?}");
    assert!(r.ambiguous, "{r:?}");
}

#[test]
fn temporal_events_without_spatial_provenance_remain_unresolved() {
    let (v, t) = inputs(1., false);
    let r = match_signatures(&v, &t);
    assert!(r.candidates[0].windows.len() >= 3);
    assert!(r.ambiguous, "{r:?}");
    assert!(!r.applicable);
}

#[test]
fn chunk_retention_keeps_more_than_eight_distinct_peaks() {
    use super::{matching::retain_distinct_candidates, SyncCandidate};
    let candidates = (0..10)
        .map(|i| SyncCandidate {
            offset_seconds: i as f64 * 30.,
            sign: 1,
            correlation: 1. - i as f64 * 0.01,
            overlap_seconds: 20.,
            peak_width_seconds: 0.2,
            windows: vec![],
            consistent: true,
        })
        .collect();
    let mut retained = vec![];
    retain_distinct_candidates(&mut retained, candidates);
    assert_eq!(retained.len(), 10);
}

#[test]
fn unrelated_telemetry_outlier_does_not_erase_turning_windows() {
    let (v, mut t) = inputs(1., false);
    for s in &mut t {
        if (37. ..38.).contains(&s.time) {
            s.yaw = Some(100.);
        }
    }
    let r = match_signatures(&v, &t);
    let c = r
        .candidates
        .iter()
        .find(|c| (c.offset_seconds - 5.).abs() < 0.1)
        .unwrap();
    assert!(
        c.windows.iter().filter(|w| w.correlation >= 0.3).count() >= 3,
        "{c:?}"
    );
}

#[test]
fn peak_capacity_reports_incomplete_competitor_comparison() {
    let v: Vec<_> = (0..61)
        .map(|i| {
            let time = i as f64 * 0.2;
            MotionSample {
                time,
                yaw: Some((time * std::f64::consts::TAU).sin()),
                quality: 1.,
            }
        })
        .collect();
    let t: Vec<_> = (0..2001)
        .map(|i| {
            let time = i as f64 * 0.2;
            TelemetrySample {
                time,
                yaw: Some((time * std::f64::consts::TAU).sin()),
                curvature: None,
                speed: None,
                acceleration: None,
            }
        })
        .collect();
    let r = match_signatures(&v, &t);
    assert_eq!(
        r.rejection_reason.as_deref(),
        Some("Competing peak comparison incomplete"),
        "{r:?}"
    );
}
