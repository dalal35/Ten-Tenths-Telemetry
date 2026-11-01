//! Interpret a solved profile without changing its capability or timing calculations.
use super::super::types::*;
use super::section_time;

pub(super) struct Coaching {
    pub details: CoachingEvidence,
    pub observation: String,
    pub action: String,
    pub facts: Vec<Evidence>,
}

pub(super) fn extract(
    section_id: &str,
    label: &str,
    kind: &str,
    start: f64,
    end: f64,
    actual: &[f64],
    model: &[f64],
    ds: f64,
    rpm: &[(f64, f64)],
    rpm_id: Option<&str>,
) -> Coaching {
    let indices: Vec<_> = (0..actual.len())
        .filter(|&i| i as f64 * ds >= start && (i as f64 * ds) < end)
        .collect();
    let first = indices[0];
    let last = *indices.last().unwrap();
    let minimum = |v: &[f64]| {
        *indices
            .iter()
            .min_by(|&&a, &&b| v[a].total_cmp(&v[b]))
            .unwrap()
    };
    let apex = minimum(actual);
    let model_apex = minimum(model);
    let peak = *indices
        .iter()
        .max_by(|&&a, &&b| (model[a] - actual[a]).total_cmp(&(model[b] - actual[b])))
        .unwrap();
    let entry = model[first] - actual[first];
    let exit = model[last] - actual[last];
    let min_delta = model[model_apex] - actual[apex];
    let location_delta = (model_apex as f64 - apex as f64) * ds;
    let phase_time =
        |a: f64, b: f64| section_time(actual, ds, a, b) - section_time(model, ds, a, b);
    let entry_gain = phase_time(start, apex as f64 * ds);
    let exit_gain = phase_time(apex as f64 * ds, end);
    let recovery_distance = |v: &[f64], m: usize| {
        (m..=last)
            .find(|&i| v[i] >= v[m] + 2.)
            .map(|i| (i - m) as f64 * ds)
    };
    let actual_recovery = recovery_distance(actual, apex);
    let model_recovery = recovery_distance(model, model_apex);
    // A speed fall following a genuine recovery is evidence of interruption;
    // do not call normal initial slowing an error or infer pedals/gears.
    let mut high = actual[apex];
    let mut dip: f64 = 0.;
    for &i in indices.iter().filter(|&&i| i > apex) {
        if actual[i] > high {
            high = actual[i];
        }
        if high > actual[apex] + 0.7 {
            dip = dip.max(high - actual[i]);
        }
    }
    let decel_start = indices
        .windows(2)
        .find(|w| actual[w[1]] < actual[w[0]] - 0.08)
        .map(|w| w[0]);
    let model_decel = indices
        .windows(2)
        .find(|w| model[w[1]] < model[w[0]] - 0.08)
        .map(|w| w[0]);
    let decel_shift = decel_start
        .zip(model_decel)
        .map(|(a, b)| (b as f64 - a as f64) * ds);
    let (mechanism, title, hypothesis, experiment, validation) = if kind == "straight"
        && entry > 0.5
    {
        ("downstream", "Carry the preceding exit", "The preceding exit may limit speed carried along this straight.", "Keep the approach repeatable; try opening the preceding exit arc and compare speed along the straight.", "Compare preceding-corner plus straight time, including any entry cost.")
    } else if kind == "straight" {
        ("straight-recovery", "Investigate sustained speed recovery", "Sustained acceleration or model calibration may explain the increasing speed gap along this straight.", "Repeat the preceding exit and inspect where speed stops building; compare the speed trace before adjusting technique.", "Compare speed increase along the straight and combined preceding-corner time.")
    } else if dip > 0.6 && exit_gain > 0.02 {
        ("recovery-interruption", "Smooth the exit recovery", "An exit correction may interrupt recovery; changing curvature could also explain the speed dip.", "Review the speed dip after minimum speed; try a smoother exit arc while holding approach speed repeatable.", "Check that the post-minimum speed dip shrinks and corner-plus-following time improves.")
    } else if entry_gain < -0.015 && exit_gain > 0.02 {
        ("entry-exit-tradeoff", "Trade entry speed for exit", "A slower entry may allow earlier recovery; the modeled line and grip assumptions could also explain the tradeoff.", "Try a slightly more settled entry and open the exit arc earlier; accept the entry cost only if the whole interval improves.", "Compare entry time cost against exit and following-straight time gained.")
    } else if min_delta > 0.5 && location_delta < -8. && apex > first + 4 {
        ("late-minimum", "Bring the minimum-speed transition earlier", "A late speed trough may delay the recovery; a changing corner radius could also explain its position.", "Keep approach speed repeatable and try completing the slowdown earlier so speed can start building before the recorded trough.", "Compare minimum-speed location and recovery onset, then verify corner-plus-following time and exit speed.")
    } else if min_delta > 0.5
        && (peak as isize - apex as isize).abs() <= 5
        && (min_delta > 1.5 || exit_gain <= entry_gain.max(0.) * 1.25)
    {
        ("minimum-speed", "Test the minimum-speed tradeoff", "The minimum-speed region may be too costly; line geometry or grip assumptions could also explain the modeled gap.", "Keep entry speed repeatable and test a smoother arc through minimum speed; preserve the exit before increasing entry speed.", "Compare minimum speed and its location, then verify exit speed and corner-plus-following time.")
    } else if exit_gain > entry_gain.max(0.) * 1.25 && exit > 0.5 {
        ("exit-recovery", "Build speed after the minimum", "The exit arc may delay speed recovery; lower entry momentum could also explain the deficit.", "Hold approach speed repeatable and try opening the exit arc earlier, then build acceleration smoothly.", "Compare distance to recover speed after the minimum, exit speed, and corner-plus-following time.")
    } else if entry_gain > 0.02
        && peak < apex
        && decel_start.zip(model_decel).is_some_and(|(a, b)| {
            (apex.saturating_sub(a)) as f64 * ds > (model_apex.saturating_sub(b)) as f64 * ds + 4.
        })
    {
        ("deceleration-placement", "Reposition the entry slowdown", "The slowdown placement may cost entry time; a necessary line setup could also explain it.", "Use the same approach speed and test a smoother, more compact slowdown toward the minimum; keep approach speed unchanged.", "Compare slowdown onset and minimum-speed location; require a repeatable full-interval gain without an exit loss.")
    } else if entry > 0.5 && peak < apex {
        ("approach-carry", "Preserve speed into the approach", "The preceding exit may limit approach speed; the current slowdown placement is not established as a fault.", "Repeat the corner entry and try preserving speed from the preceding exit while holding the minimum-speed arc repeatable.", "Compare approach speed, minimum speed and the combined preceding-plus-current corner time.")
    } else {
        ("profile-investigation", "Investigate the speed-profile gap", "Geometry, capability calibration or driving line may explain the profile gap; the mechanism is not established.", "Review the recorded line and speed at the largest model gap; repeat the same approach before changing a control.", "Check repeatable speed and section timing at the gap, then compare the following interval.")
    };
    let mut facts = Vec::new();
    let mut fact = |name: &str, unit: &str, a: f64, b: Option<f64>, channels: Vec<String>| {
        facts.push(Evidence {
            id: format!("physics:{section_id}:{name}"),
            metric: name.into(),
            unit: unit.into(),
            lap_value: a,
            reference_value: b,
            channel_ids: channels,
        })
    };
    let speed = || vec!["gps-speed".into()];
    fact(
        "entrySpeed",
        "m/s",
        actual[first],
        Some(model[first]),
        speed(),
    );
    fact(
        "minimumSpeed",
        "m/s",
        actual[apex],
        Some(model[model_apex]),
        speed(),
    );
    fact(
        "minimumSpeedLocation",
        "m",
        apex as f64 * ds,
        Some(model_apex as f64 * ds),
        speed(),
    );
    fact("exitSpeed", "m/s", actual[last], Some(model[last]), speed());
    fact(
        "peakProfileGapLocation",
        "m",
        peak as f64 * ds,
        None,
        speed(),
    );
    fact(
        "speedAtPeakGap",
        "m/s",
        actual[peak],
        Some(model[peak]),
        speed(),
    );
    fact("entryTimeGain", "s", entry_gain, None, speed());
    fact("exitTimeGain", "s", exit_gain, None, speed());
    fact("postMinimumSpeedDip", "m/s", dip, None, speed());
    if let Some((a, b)) = actual_recovery.zip(model_recovery) {
        fact("distanceToRecoverTwoMps", "m", a, Some(b), speed());
    }
    if let Some((a, b)) = decel_start.zip(model_decel) {
        fact(
            "slowdownOnset",
            "m",
            a as f64 * ds,
            Some(b as f64 * ds),
            speed(),
        );
        fact(
            "slowdownDistance",
            "m",
            apex.saturating_sub(a) as f64 * ds,
            Some(model_apex.saturating_sub(b) as f64 * ds),
            speed(),
        );
    }
    let values: Vec<_> = rpm
        .iter()
        .filter(|(d, v)| *d >= apex as f64 * ds && *d <= end && v.is_finite())
        .map(|(_, v)| *v)
        .collect();
    if let (Some(a), Some(b), Some(rpm_source)) = (values.first(), values.last(), rpm_id) {
        let channel = || vec![rpm_source.into()];
        fact("rpmAtMinimum", "rpm", *a, None, channel());
        fact("rpmAtExit", "rpm", *b, None, channel());
        let mut high = *a;
        let mut fall: f64 = 0.;
        for value in &values {
            high = high.max(*value);
            fall = fall.max(high - *value);
        }
        fact("largestRecoveryRpmFall", "rpm", fall, None, channel());
    }
    let rpm_note = if values.len() >= 3 && rpm_id.is_some() {
        " RPM recovery is available for corroboration; it does not establish a shift or powerband."
    } else {
        " RPM recovery is unavailable; no shift or engine diagnosis is supported."
    };
    let observation=format!("{label}: recorded minimum {:.1} m/s at {:.0} m; model {:.1} m/s at {:.0} m. Largest speed gap {:.1} m/s at {:.0} m; entry/exit time contributions {:+.2}/{:+.2} s.{}{}{}",actual[apex],apex as f64*ds,model[model_apex],model_apex as f64*ds,model[peak]-actual[peak],peak as f64*ds,entry_gain,exit_gain,if dip>0.6 {format!(" Recovery includes a {:.1} m/s speed dip.",dip)}else{String::new()},decel_shift.filter(|s|s.abs()>4.).map(|s|format!(" Modeled slowdown begins {:.0} m {} along the lap.",s.abs(),if s<0. {"earlier"}else{"later"})).unwrap_or_default(),rpm_note);
    let action = format!("{label}: {experiment} Review the speed trace near {:.0} m, where the model-recorded gap is {:.1} m/s; this is a comparison point, not a commanded target.",peak as f64*ds,model[peak]-actual[peak]);
    Coaching { details:CoachingEvidence {mechanism:mechanism.into(),title:format!("{label}: {title}"),validation:validation.into(),hypotheses:vec![CoachingHypothesis{id:mechanism.into(),title:title.into(),hypothesis:hypothesis.into(),experiment:experiment.into(),validation:validation.into()},CoachingHypothesis{id:"check-model-alignment".into(),title:"Check the modeled gap".into(),hypothesis:"GPS geometry or capability calibration may explain the gap rather than a driver technique fault.".into(),experiment:"Repeat the same line and approach; inspect speed alignment before changing technique.".into(),validation:"Check repeated section timing and speed alignment, including the following interval.".into()}]},observation,action,facts }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn interpret(actual: &[f64], model: &[f64], kind: &str) -> Coaching {
        extract(
            "corner-test",
            "Test corner",
            kind,
            0.,
            actual.len() as f64 * 2.,
            actual,
            model,
            2.,
            &[],
            None,
        )
    }
    #[test]
    fn distinct_profiles_support_distinct_driving_experiments() {
        let actual = [
            20., 19., 18., 17., 16., 15., 14., 13., 12., 11., 10., 11., 12., 13., 14., 15., 16.,
            17., 18., 19.,
        ];
        let minimum: Vec<_> = actual
            .iter()
            .enumerate()
            .map(|(i, v)| v + (2. - ((i as f64 - 10.) / 5.).abs()).max(0.))
            .collect();
        let min = interpret(&actual, &minimum, "corner");
        assert_eq!(min.details.mechanism, "minimum-speed");
        let mut exit = actual;
        for (i, v) in exit.iter_mut().enumerate().skip(11) {
            *v += (i - 10) as f64 * 0.3;
        }
        let recovery = interpret(&actual, &exit, "corner");
        assert_eq!(recovery.details.mechanism, "exit-recovery");
        assert_ne!(min.action, recovery.action);
        let straight = [10., 11., 12., 13., 14., 15.];
        let model = [10., 11., 12.5, 14., 16., 18.];
        let straight_coach = interpret(&straight, &model, "straight");
        assert_eq!(straight_coach.details.mechanism, "straight-recovery");
        assert!(!straight_coach.action.contains("RPM"));
    }
    #[test]
    fn uncertain_and_rpm_absent_do_not_invent_a_driver_fault() {
        let speeds = [20., 19., 18., 19., 20.];
        let c = interpret(&speeds, &speeds, "corner");
        assert_eq!(c.details.mechanism, "profile-investigation");
        assert!(c.observation.contains("RPM recovery is unavailable"));
        assert!(c.facts.iter().all(|f| f.unit != "rpm"));
        assert!(c
            .details
            .hypotheses
            .iter()
            .all(|h| h.hypothesis.contains("may")));
    }
    #[test]
    fn rpm_provenance_and_interruption_are_recording_local() {
        let speeds = [20., 19., 18., 19., 20.];
        let c = extract(
            "test",
            "Test",
            "corner",
            0.,
            10.,
            &speeds,
            &speeds,
            2.,
            &[(4., 7000.), (6., 7500.), (8., 7200.)],
            Some("engine-rpm"),
        );
        let f = c
            .facts
            .iter()
            .find(|f| f.metric == "largestRecoveryRpmFall")
            .unwrap();
        assert_eq!(f.lap_value, 300.);
        assert_eq!(f.channel_ids, vec!["engine-rpm"]);
    }
}
