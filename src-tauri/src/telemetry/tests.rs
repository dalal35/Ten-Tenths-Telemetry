use super::*;
fn sample() -> Session {
    Session {
        merge: None,
        id: "test".into(),
        source: "".into(),
        name: "".into(),
        driver: "".into(),
        track: "".into(),
        recorded_at: "".into(),
        warnings: vec![],
        laps: vec![
            Lap {
                id: "a".into(),
                number: 1,
                start: 0.,
                end: 10.,
                duration: 10.,
                complete: true,
            },
            Lap {
                id: "b".into(),
                number: 2,
                start: 10.,
                end: 20.,
                duration: 10.,
                complete: true,
            },
        ],
        channels: vec![
            Channel {
                gaps: vec![],
                id: "gps-speed".into(),
                name: "GPS Speed".into(),
                unit: "m/s".into(),
                times: (0..=20).map(|i| i as f64).collect(),
                values: vec![10.; 21],
            },
            Channel {
                gaps: vec![],
                id: "rpm".into(),
                name: "RPM".into(),
                unit: "rpm".into(),
                times: vec![0., 2., 4., 6., 8., 10., 12., 14., 16., 18., 20.],
                values: vec![5000.; 11],
            },
        ],
    }
}
#[test]
fn different_sample_rates_and_distance() {
    let s = sample();
    let a = analyze(&s, "a", Some("b"), "distance", &["rpm".into()]).unwrap();
    assert_eq!(a.primary.length, Some(100.));
    assert_eq!(a.primary.series[0].x, vec![0., 20., 40., 60., 80., 100.]);
    assert!(a.delta.unwrap().values.iter().all(|v| v.abs() < 1e-9));
}
#[test]
fn time_axis_without_distance() {
    let mut s = sample();
    s.channels.remove(0);
    let a = analyze(&s, "a", Some("b"), "time", &["rpm".into()]).unwrap();
    assert_eq!(a.primary.series[0].x.last(), Some(&10.));
    assert!(a.primary.length.is_none());
    assert!(a.delta.is_none());
    assert!(analyze(&s, "a", None, "distance", &[]).is_err());
}
#[test]
fn interpolation_does_not_extrapolate() {
    assert_eq!(interpolate(&[1., 2.], &[10., 20.], 0.), None);
    assert_eq!(interpolate(&[1., 2.], &[10., 20.], 1.5), Some(15.));
}
#[test]
fn delta_positive_means_primary_slower() {
    let mut s = sample();
    s.laps[0].end = 10.2;
    s.laps[0].duration = 10.2;
    s.laps[1].start = 10.2;
    s.laps[1].end = 20.;
    s.laps[1].duration = 9.8;
    let a = analyze(&s, "a", Some("b"), "distance", &[]).unwrap();
    assert!((a.delta.unwrap().values.last().unwrap() - 0.4).abs() < 1e-9);
}
#[test]
fn incompatible_distances_disable_delta() {
    let mut s = sample();
    s.laps[0].end = 12.;
    s.laps[0].duration = 12.;
    s.laps[1].start = 12.;
    s.laps[1].duration = 8.;
    assert!(analyze(&s, "a", Some("b"), "distance", &[])
        .unwrap()
        .delta
        .is_none());
}
#[test]
fn speed_gaps_disable_distance() {
    let mut s = sample();
    s.channels[0].times.drain(4..8);
    s.channels[0].values.drain(4..8);
    assert!(analyze(&s, "a", None, "distance", &[]).is_err());
}
#[test]
fn rejected_speed_sample_disables_distance_and_delta() {
    let mut s = sample();
    let mut warnings = vec![];
    s.channels[0] = channel(
        "gps-speed".into(),
        "GPS Speed".into(),
        "m/s".into(),
        (0..=200).map(|i| i * 100).collect(),
        (0..=200)
            .map(|i| if i == 2 { f64::NAN } else { 10. })
            .collect(),
        &mut warnings,
    );
    assert_eq!(s.channels[0].gaps, vec![[0.1, 0.3]]);
    let time = analyze(&s, "a", Some("b"), "time", &[]).unwrap();
    assert!(time.primary.length.is_none());
    assert!(time.delta.is_none());
    assert!(analyze(&s, "a", Some("b"), "distance", &[]).is_err());
}
#[test]
fn incomplete_laps_disable_delta() {
    let mut s = sample();
    s.laps[0].complete = false;
    assert!(analyze(&s, "a", Some("b"), "distance", &[])
        .unwrap()
        .delta
        .is_none());
}

#[test]
fn gps_speed_takes_priority_over_other_speed_channels() {
    let mut s = sample();
    let mut other = s.channels[0].clone();
    other.id = "wheel-speed".into();
    other.name = "Wheel Speed".into();
    other.values = vec![200.; 21];
    s.channels.insert(0, other);
    assert_eq!(
        analyze(&s, "a", None, "distance", &[])
            .unwrap()
            .primary
            .length,
        Some(100.)
    );
}
#[test]
fn invalid_gps_fix_disables_distance() {
    let mut s = sample();
    s.channels.push(Channel {
        gaps: vec![],
        id: "gps-fix".into(),
        name: "GPS Fix".into(),
        unit: "".into(),
        times: vec![0., 10., 20.],
        values: vec![2., 2., 2.],
    });
    assert!(analyze(&s, "a", None, "distance", &[]).is_err());
}

fn rpm_with_gap(s: &mut Session) {
    s.channels[1].times = (0..=200)
        .filter(|i| !(40..70).contains(i))
        .map(|i| i as f64 / 10.)
        .collect();
    s.channels[1].values = vec![5000.; s.channels[1].times.len()];
}
#[test]
fn ordinary_channel_gaps_are_reported_without_losing_source_samples() {
    let mut s = sample();
    rpm_with_gap(&mut s);
    let a = analyze(&s, "a", None, "time", &["rpm".into()]).unwrap();
    assert!(a
        .primary
        .warnings
        .iter()
        .any(|w| w.contains("RPM") && w.contains("gap")));
    let series = serde_json::to_value(&a.primary.series[0]).unwrap();
    assert_eq!(series["gaps"], serde_json::json!([[3.9, 7.0]]));
    assert!(a.primary.series[0].x.contains(&3.9));
    assert!(a.primary.series[0].x.contains(&7.));
    let a = analyze(&s, "a", None, "distance", &["rpm".into()]).unwrap();
    let series = serde_json::to_value(&a.primary.series[0]).unwrap();
    assert_eq!(series["gaps"], serde_json::json!([[39.0, 70.0]]));
}
#[test]
fn lap_edges_inside_source_gaps_are_not_interpolated() {
    let mut s = sample();
    rpm_with_gap(&mut s);
    s.laps[0].start = 5.;
    s.laps[0].duration = 5.;
    let a = analyze(&s, "a", None, "time", &["rpm".into()]).unwrap();
    assert_eq!(a.primary.series[0].x.first(), Some(&2.));
    let series = serde_json::to_value(&a.primary.series[0]).unwrap();
    assert_eq!(series["gaps"], serde_json::json!([[0.0, 2.0]]));
    s.laps[0].start = 0.;
    s.laps[0].end = 5.;
    s.laps[0].duration = 5.;
    let a = analyze(&s, "a", None, "time", &["rpm".into()]).unwrap();
    assert_eq!(a.primary.series[0].x.last(), Some(&3.9));
}
#[test]
fn stationary_distance_interpolation_stays_finite() {
    assert_eq!(
        interpolate(&[0., 0., 10., 10.], &[0., 1., 2., 3.], 0.),
        Some(0.)
    );
    assert_eq!(
        interpolate(&[0., 0., 10., 10.], &[0., 1., 2., 3.], 10.),
        Some(2.)
    );
}

// Synthetic geometry has known angular position; radial line changes deliberately make
// normalized travelled distance disagree with the common physical track position.
fn gps_session() -> Session {
    let mut s = sample();
    s.laps[0].end = 20.;
    s.laps[0].duration = 20.;
    s.laps[1].start = 20.;
    s.laps[1].end = 42.;
    s.laps[1].duration = 22.;
    let mut times = vec![];
    let mut lat = vec![];
    let mut lon = vec![];
    let mut speeds = vec![];
    for i in 0..=420 {
        let t = i as f64 / 10.;
        let (u, duration, second) = if t <= 20. {
            (t / 20., 20., false)
        } else {
            ((t - 20.) / 22., 22., true)
        };
        let theta = std::f64::consts::TAU * u;
        let radius = 60. + if second { 5. * theta.sin() } else { 0. };
        let derivative = if second { 5. * theta.cos() } else { 0. };
        times.push(t);
        lat.push(40. + (radius * theta.sin() / 6371000.).to_degrees());
        lon.push(
            -86. + (radius * theta.cos() / (6371000. * 40_f64.to_radians().cos())).to_degrees(),
        );
        speeds.push(
            (radius * radius + derivative * derivative).sqrt() * std::f64::consts::TAU / duration,
        );
    }
    s.channels = vec![];
    for (id, name, unit, values) in [
        ("gps-latitude", "Latitude", "deg", lat),
        ("gps-longitude", "Longitude", "deg", lon),
        ("gps-speed", "GPS Speed", "m/s", speeds),
        ("gps-fix", "GPS Fix", "", vec![3.; times.len()]),
        (
            "gps-accuracy",
            "GPS Position Accuracy",
            "m",
            vec![0.6; times.len()],
        ),
        ("rpm", "RPM", "rpm", vec![5000.; times.len()]),
    ] {
        s.channels.push(Channel {
            gaps: vec![],
            id: id.into(),
            name: name.into(),
            unit: unit.into(),
            times: times.clone(),
            values,
        });
    }
    s
}
#[test]
fn spatial_mapping_matches_position_despite_different_racing_line_lengths() {
    let s = gps_session();
    let a = analyze(&s, "a", Some("b"), "distance", &["rpm".into()]).unwrap();
    assert_eq!(a.alignment.method, "spatial");
    let c = a.comparison.as_ref().unwrap();
    let p = c
        .mapping
        .iter()
        .find(|p| (p.time - 5.5).abs() < 0.051)
        .unwrap();
    let length = a.alignment.reference_length.unwrap();
    assert!(
        (p.meters / length - 0.25).abs() < 0.006,
        "quarter-circle projects to same place: {}",
        p.meters / length
    );
    let d = a.delta.unwrap();
    assert_eq!(d.method, "spatial");
    assert!((d.values.last().unwrap() + 2.).abs() < 1e-9);
    assert!(a
        .segments
        .iter()
        .all(|seg| seg.primary.entry_speed.is_some() && seg.comparison.is_some()));
    assert!(a
        .segments
        .iter()
        .all(|seg| seg.primary.channels[0].unit == "rpm"));
}
#[test]
fn noisy_gps_outliers_are_rejected_and_small_noise_retains_alignment() {
    let mut s = gps_session();
    for c in s.channels.iter_mut().filter(|c| c.id == "gps-latitude") {
        for (i, v) in c.values.iter_mut().enumerate() {
            *v += (i as f64 * 1.7).sin() * 0.000002;
        }
        c.values[60] += 0.02;
    }
    let a = analyze(&s, "a", Some("b"), "distance", &[]).unwrap();
    assert_eq!(a.alignment.method, "spatial");
    assert!(a.alignment.notes.iter().any(|n| n.contains("rejected")));
}
#[test]
fn invalid_or_missing_gps_never_claims_spatial_precision() {
    for bad in ["gps-fix", "gps-accuracy", "gap", "crossing"] {
        let mut s = gps_session();
        match bad {
            "gps-fix" => {
                s.channels.iter_mut().find(|c| c.id == bad).unwrap().values[250..290].fill(2.)
            }
            "gps-accuracy" => s
                .channels
                .iter_mut()
                .find(|c| c.id == bad)
                .unwrap()
                .values
                .fill(30.),
            "gap" => {
                for c in s
                    .channels
                    .iter_mut()
                    .filter(|c| c.id == "gps-latitude" || c.id == "gps-longitude")
                {
                    c.times.drain(250..280);
                    c.values.drain(250..280);
                }
            }
            _ => {
                s.channels
                    .iter_mut()
                    .find(|c| c.id == "gps-longitude")
                    .unwrap()
                    .values[420] += 0.001
            }
        }
        let a = analyze(&s, "a", Some("b"), "time", &[]).unwrap();
        assert_ne!(a.alignment.method, "spatial", "{bad}");
        assert!(
            a.segments.iter().all(|x| x.comparison.is_none()),
            "unvalidated comparative metrics must not leak"
        );
    }
}
#[test]
fn spatial_time_axis_uses_primary_elapsed_time_and_endpoint_invariant() {
    let s = gps_session();
    let a = analyze(&s, "a", Some("b"), "time", &["rpm".into()]).unwrap();
    assert_eq!(a.alignment.method, "spatial");
    assert_eq!(
        a.comparison.as_ref().unwrap().series[0].x.last(),
        Some(&20.)
    );
    let d = a.delta.unwrap();
    assert_eq!(d.x.first(), Some(&0.));
    assert_eq!(d.x.last(), Some(&20.));
    assert!((d.values.last().unwrap() - (s.laps[0].duration - s.laps[1].duration)).abs() < 1e-9);
    assert!(a.segments.iter().all(|x| x.start >= 0. && x.end <= 20.));
}

fn stadium_session() -> Session {
    let mut s = gps_session();
    let turn_time = std::f64::consts::PI * 30. / 12.;
    let cycle = 10. + 2. * turn_time;
    let times = s.channels[0].times.clone();
    let mut lat = vec![];
    let mut lon = vec![];
    let mut speed = vec![];
    for t in times {
        let (u, duration) = if t <= 20. {
            (t / 20., 20.)
        } else {
            ((t - 20.) / 22., 22.)
        };
        let tt = u * cycle;
        let (x, y, v) = if tt <= 5. {
            (tt * 20., 0., 20.)
        } else if tt <= 5. + turn_time {
            let a = -std::f64::consts::FRAC_PI_2 + (tt - 5.) * 12. / 30.;
            (100. + 30. * a.cos(), 30. + 30. * a.sin(), 12.)
        } else if tt <= 10. + turn_time {
            (100. - (tt - 5. - turn_time) * 20., 60., 20.)
        } else {
            let a = std::f64::consts::FRAC_PI_2 + (tt - 10. - turn_time) * 12. / 30.;
            (30. * a.cos(), 30. + 30. * a.sin(), 12.)
        };
        lat.push(40. + (y / 6371000.).to_degrees());
        lon.push(-86. + (x / (6371000. * 40_f64.to_radians().cos())).to_degrees());
        speed.push(v * cycle / duration);
    }
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-latitude")
        .unwrap()
        .values = lat;
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-longitude")
        .unwrap()
        .values = lon;
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-speed")
        .unwrap()
        .values = speed;
    s
}
#[test]
fn geometry_and_speed_profile_find_two_hairpins_with_straights() {
    let s = stadium_session();
    let a = analyze(&s, "a", Some("b"), "distance", &["rpm".into()]).unwrap();
    assert_eq!(a.alignment.method, "spatial");
    let corners = a
        .segments
        .iter()
        .filter(|s| s.kind == "corner")
        .collect::<Vec<_>>();
    assert_eq!(corners.len(), 2);
    assert!(a.segments.iter().filter(|s| s.kind == "straight").count() >= 2);
    assert!(corners
        .iter()
        .all(|s| s.primary.min_speed.unwrap() < s.primary.entry_speed.unwrap()));
    assert!(a
        .segments
        .iter()
        .all(|s| s.end_meters - s.start_meters > s.uncertainty_meters));
    assert!(
        (a.segments
            .iter()
            .map(|s| s.delta_seconds.unwrap())
            .sum::<f64>()
            + 2.)
            .abs()
            < 1e-8
    );
    assert!((a.segments.iter().map(|s| s.primary.elapsed).sum::<f64>() - 20.).abs() < 1e-8);
    assert!(a
        .segments
        .windows(2)
        .all(|s| (s[0].end_meters - s[1].start_meters).abs() < 1e-8));
}
#[test]
fn reverse_direction_fails_same_position_heading_gate() {
    let mut s = gps_session();
    for c in s
        .channels
        .iter_mut()
        .filter(|c| c.id == "gps-latitude" || c.id == "gps-longitude")
    {
        c.values[200..=420].reverse();
    }
    let a = analyze(&s, "a", Some("b"), "time", &[]).unwrap();
    assert_ne!(a.alignment.method, "spatial");
    assert!(a.segments.is_empty());
}
#[test]
fn unknown_accuracy_is_disclosed_as_low_resolution_not_zero_error() {
    let mut s = gps_session();
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-accuracy")
        .unwrap()
        .values
        .fill(0.);
    let a = analyze(&s, "a", None, "distance", &[]).unwrap();
    assert_eq!(a.alignment.method, "spatial");
    assert!(a.alignment.position_uncertainty_m.unwrap() >= 10.);
    assert!(a.alignment.notes.iter().any(|s| s.contains("5 m")));
}
#[test]
fn invalid_fix_cannot_invent_corner_minimum_speed_or_channel_mean() {
    let mut s = stadium_session();
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-fix")
        .unwrap()
        .values[95] = 2.;
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-speed")
        .unwrap()
        .values[95] = 0.;
    let a = analyze(&s, "a", Some("b"), "distance", &["gps-speed".into()]).unwrap();
    assert_eq!(a.alignment.method, "spatial");
    let segment = a
        .segments
        .iter()
        .find(|s| s.primary.min_speed.is_none())
        .unwrap();
    assert!(segment.primary.channels[0].mean.is_none());
    assert!(a.alignment.coverage < 1.);
}
#[test]
fn fallback_track_breaks_across_invalid_gps_and_long_gaps() {
    let mut s = gps_session();
    s.channels
        .iter_mut()
        .find(|c| c.id == "gps-fix")
        .unwrap()
        .values[50..80]
        .fill(2.);
    let a = analyze(&s, "a", Some("b"), "time", &[]).unwrap();
    assert_ne!(a.alignment.method, "spatial");
    assert!(a.primary.track.iter().any(|p| p.break_before));
}

#[test]
fn stationary_positions_cannot_define_unique_spatial_crossing_times() {
    let mut s = gps_session();
    for i in 0..=200 {
        let t = i as f64 / 10.;
        let (phase, factor) = if t <= 5. {
            (t, 1.)
        } else if t <= 6. {
            (5., 0.)
        } else {
            (5. + (t - 6.) * 15. / 14., 15. / 14.)
        };
        let theta = std::f64::consts::TAU * phase / 20.;
        s.channels
            .iter_mut()
            .find(|c| c.id == "gps-latitude")
            .unwrap()
            .values[i] = 40. + (60. * theta.sin() / 6371000.).to_degrees();
        s.channels
            .iter_mut()
            .find(|c| c.id == "gps-longitude")
            .unwrap()
            .values[i] =
            -86. + (60. * theta.cos() / (6371000. * 40_f64.to_radians().cos())).to_degrees();
        s.channels
            .iter_mut()
            .find(|c| c.id == "gps-speed")
            .unwrap()
            .values[i] = 60. * std::f64::consts::TAU / 20. * factor;
    }
    let a = analyze(&s, "a", Some("b"), "time", &[]).unwrap();
    assert_ne!(a.alignment.method, "spatial");
}
#[test]
fn segment_channel_means_are_time_weighted_and_suppress_outages() {
    let mut s = stadium_session();
    let c = s.channels.iter_mut().find(|c| c.id == "rpm").unwrap();
    c.times = vec![0., 0.1, 20., 42.];
    c.values = c.times.iter().map(|t| 100. + 10. * t).collect();
    // This sparse channel intentionally has no classified nominal cadence, but
    // piecewise-linear integration of this known linear function remains exact.
    let a = analyze(&s, "a", Some("b"), "time", &["rpm".into()]).unwrap();
    for seg in &a.segments {
        let mean = seg.primary.channels[0].mean.unwrap();
        assert!((mean - (100. + 10. * (seg.start + seg.end) * 0.5)).abs() < 1e-6);
    }
    let c = s.channels.iter_mut().find(|c| c.id == "rpm").unwrap();
    c.times = (0..=420)
        .filter(|i| !(50..90).contains(i))
        .map(|i| i as f64 / 10.)
        .collect();
    c.values = vec![5000.; c.times.len()];
    let a = analyze(&s, "a", Some("b"), "time", &["rpm".into()]).unwrap();
    assert!(a
        .segments
        .iter()
        .any(|seg| seg.primary.channels[0].mean.is_none()));
}

#[test]
fn rejected_invalid_sample_retains_an_outage() {
    let mut warnings = vec![];
    let c = channel(
        "bad".into(),
        "Bad".into(),
        "rpm".into(),
        vec![0, 100, 200, 300, 400, 500],
        vec![1., 1., f64::NAN, 1., 1., 1.],
        &mut warnings,
    );
    assert!(
        sample_without_gaps(&c, 0.2, &source_gaps(&c)).is_none(),
        "invalid sample must not be interpolated away"
    );
}

#[test]
fn consecutive_invalid_samples_form_one_outage() {
    let mut warnings = vec![];
    let c = channel(
        "bad".into(),
        "Bad".into(),
        "rpm".into(),
        vec![0, 100, 200, 300, 400, 500],
        vec![1., 1., f64::NAN, f64::NAN, 1., 1.],
        &mut warnings,
    );
    assert_eq!(
        c.gaps,
        vec![[0.1, 0.4]],
        "one outage per contiguous invalid run"
    );
}

#[test]
fn cross_source_analysis_isolated() {
    let mut p = sample();
    p.id = "primary".into();
    let mut c = sample();
    c.id = "comparison".into();
    c.channels[1].values.fill(7000.);
    let binding = ChannelBinding {
        output_id: "selected-rpm".into(),
        primary_id: Some("rpm".into()),
        comparison_id: Some("rpm".into()),
    };
    let a = analyze_sources(
        LapSource {
            session: &p,
            lap: &p.laps[0],
        },
        Some(LapSource {
            session: &c,
            lap: &c.laps[0],
        }),
        "time",
        &[binding],
        None,
    )
    .unwrap();
    assert!(a.primary.series[0].values.iter().all(|v| *v == 5000.));
    assert!(a.comparison.as_ref().unwrap().series[0]
        .values
        .iter()
        .all(|v| *v == 7000.));
    assert_eq!(a.primary.series[0].channel_id, "selected-rpm");
    assert_eq!(p.channels[1].values[0], 5000.);
}
#[test]
fn cross_source_spatial_parity() {
    let p = stadium_session();
    let mut c = p.clone();
    c.id = "another".into();
    for axis in ["time", "distance"] {
        let original = analyze(&p, "a", Some("b"), axis, &["rpm".into()]).unwrap();
        let a = analyze_sources(
            LapSource {
                session: &p,
                lap: &p.laps[0],
            },
            Some(LapSource {
                session: &c,
                lap: &c.laps[1],
            }),
            axis,
            &[ChannelBinding {
                output_id: "rpm".into(),
                primary_id: Some("rpm".into()),
                comparison_id: Some("rpm".into()),
            }],
            None,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(a).unwrap(),
            serde_json::to_value(original).unwrap()
        );
    }
}
#[test]
fn cross_source_channel_gaps() {
    let mut p = sample();
    let mut c = sample();
    p.track = "Track A".into();
    c.track = "Track B".into();
    c.id = "c".into();
    c.channels.remove(1);
    let a = analyze_sources(
        LapSource {
            session: &p,
            lap: &p.laps[0],
        },
        Some(LapSource {
            session: &c,
            lap: &c.laps[0],
        }),
        "time",
        &[ChannelBinding {
            output_id: "rpm".into(),
            primary_id: Some("rpm".into()),
            comparison_id: None,
        }],
        None,
    )
    .unwrap();
    assert!(a.comparison.unwrap().series.is_empty());
    assert!(a.delta.is_none());
    assert!(a.warnings.iter().any(|w| w.contains("channel")));
}
#[test]
fn cross_source_advanced_provenance() {
    let p = sample();
    let mut c = sample();
    c.id = "c".into();
    c.channels[1].values.fill(7000.);
    let psrc = LapSource {
        session: &p,
        lap: &p.laps[0],
    };
    let csrc = LapSource {
        session: &c,
        lap: &c.laps[0],
    };
    let bindings = [ChannelBinding {
        output_id: "rpm".into(),
        primary_id: Some("rpm".into()),
        comparison_id: Some("rpm".into()),
    }];
    let a = analyze_sources(psrc, Some(csrc), "time", &bindings, None).unwrap();
    let r = advanced::AdvancedRequest {
        tool: "histogram".into(),
        hist_channel: Some("rpm".into()),
        axis: "time".into(),
        ..Default::default()
    };
    let v = advanced::analyze_sources(psrc, Some(csrc), &a, &r, &bindings).unwrap();
    assert_eq!(v.laps.len(), 2);
    assert_eq!(v.laps[0].stats.mean, Some(5000.));
    assert_eq!(v.laps[1].stats.mean, Some(7000.));
    assert_ne!(v.laps[0].lap_id, v.laps[1].lap_id);
    assert_eq!(v.laps[1].points[0].source_time, 0.);
    assert_eq!(v.laps[0].histogram[0].low, v.laps[1].histogram[0].low);
    assert_eq!(
        v.laps[0].histogram.last().unwrap().high,
        v.laps[1].histogram.last().unwrap().high
    );
}
#[test]
fn cross_source_equivalent_selected_channels_keep_distinct_output_ids() {
    let p = sample();
    let c = sample();
    let bindings: Vec<_> = ["p-rpm", "c-rpm"]
        .iter()
        .map(|id| ChannelBinding {
            output_id: (*id).into(),
            primary_id: Some("rpm".into()),
            comparison_id: Some("rpm".into()),
        })
        .collect();
    let a = analyze_sources(
        LapSource {
            session: &p,
            lap: &p.laps[0],
        },
        Some(LapSource {
            session: &c,
            lap: &c.laps[0],
        }),
        "time",
        &bindings,
        None,
    )
    .unwrap();
    assert_eq!(a.primary.series.len(), 2);
    assert_eq!(a.primary.series[0].channel_id, "p-rpm");
    assert_eq!(a.primary.series[1].channel_id, "c-rpm");
}
