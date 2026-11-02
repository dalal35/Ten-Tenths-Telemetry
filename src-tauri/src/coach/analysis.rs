//! All coach numbers originate here or in the existing validated telemetry engines.
use super::types::*;
use crate::telemetry::{self, advanced, Analysis, Lap, Session};

pub const ANALYSIS_VERSION: &str = "coach-10-physics-coaching";
fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    if n % 2 == 0 {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.
    } else {
        sorted[n / 2]
    }
}
pub(crate) fn valid(l: &Lap) -> bool {
    l.complete
        && l.start.is_finite()
        && l.end.is_finite()
        && l.duration.is_finite()
        && l.end > l.start
        && l.duration > 0.
        && ((l.end - l.start) - l.duration).abs() <= 0.002
}
fn time_at(a: &Analysis, meters: f64, lap: &Lap, comparison: bool) -> Option<f64> {
    let v = if comparison {
        a.comparison.as_ref()?
    } else {
        &a.primary
    };
    let i = v.mapping.partition_point(|p| p.meters < meters);
    let relative = if i < v.mapping.len() && (v.mapping[i].meters - meters).abs() < 1e-7 {
        v.mapping[i].time
    } else {
        let (x, y) = (v.mapping.get(i.checked_sub(1)?)?, v.mapping.get(i)?);
        if y.meters <= x.meters {
            return None;
        }
        x.time + (y.time - x.time) * (meters - x.meters) / (y.meters - x.meters)
    };
    Some(lap.start + relative)
}
pub fn analyze(
    s: &Session,
    reference_id: Option<&str>,
    boundaries: Option<&[f64]>,
) -> Result<CoachReport, String> {
    analyze_with_cancel(s, reference_id, boundaries, || false)
}
pub fn analyze_with_cancel(
    s: &Session,
    _reference_id: Option<&str>,
    boundaries: Option<&[f64]>,
    cancelled: impl Fn() -> bool,
) -> Result<CoachReport, String> {
    let check = || {
        if cancelled() {
            Err("Coach analysis cancelled".to_string())
        } else {
            Ok(())
        }
    };
    check()?;
    let mut eligible: Vec<_> = s.laps.iter().filter(|l| valid(l)).collect();
    eligible.sort_by(|a, b| {
        a.duration
            .total_cmp(&b.duration)
            .then_with(|| a.id.cmp(&b.id))
    });
    let best = *eligible
        .first()
        .ok_or("No complete valid laps are available for coaching.")?;
    let mut excluded_laps = s
        .laps
        .iter()
        .filter(|l| !valid(l))
        .map(|l| ExcludedLap {
            lap_id: l.id.clone(),
            reason: "Incomplete crossing or invalid duration; outlaps/inlaps are not compared."
                .into(),
        })
        .collect::<Vec<_>>();
    let durations: Vec<_> = eligible.iter().map(|l| l.duration).collect();
    let med = median(&durations);
    let consistency = Consistency {
        median_seconds: med,
        median_absolute_deviation_seconds: median(
            &durations
                .iter()
                .map(|d| (d - med).abs())
                .collect::<Vec<_>>(),
        ),
        range_seconds: durations.last().unwrap() - durations[0],
        sample_count: durations.len(),
    };
    let base = super::sources::analyze(s, best, None, boundaries)?;
    let mut primary_samples = super::sources::recording(s, best)
        .ok_or("Fastest lap original recording unavailable")?
        .clone();
    // The lap identity is unified; all times and samples remain source-local.
    if s.merge.is_some() {
        primary_samples.laps = vec![best.clone()];
    }
    let samples_session = &primary_samples;
    let canonical: Vec<_> = base
        .segments
        .iter()
        .skip(1)
        .map(|p| p.start_meters)
        .collect();
    let mut comparisons = vec![];
    for lap in &eligible {
        check()?;
        if lap.id == best.id {
            continue;
        }
        match super::sources::analyze(
            s,
            best,
            Some(lap),
            if base.segments.is_empty() {
                None
            } else {
                Some(&canonical)
            },
        ) {
            Ok(a)
                if a.alignment.method == "spatial"
                    && partition_matches(&base, &a)
                    && a.delta.is_some() =>
            {
                comparisons.push((*lap, a))
            }
            Ok(a) => excluded_laps.push(ExcludedLap {
                lap_id: lap.id.clone(),
                reason: format!(
                    "Spatial section comparison withheld: {}",
                    a.alignment.notes.join(" ")
                ),
            }),
            Err(e) => excluded_laps.push(ExcludedLap {
                lap_id: lap.id.clone(),
                reason: format!("Spatial section comparison withheld: {e}"),
            }),
        }
    }
    let mut segments: Vec<_> = base
        .segments
        .iter()
        .map(|p| BestSegment {
            section_id: p.id.clone(),
            label: p.label.clone(),
            kind: p.kind.clone(),
            start_meters: p.start_meters,
            end_meters: p.end_meters,
            lap_id: best.id.clone(),
            elapsed_seconds: p.primary.elapsed,
        })
        .collect();
    let mut opportunities = vec![];
    let mut section_assessments = vec![];
    for (i, p) in base.segments.iter().enumerate() {
        check()?;
        let start = time_at(&base, p.start_meters, best, false).unwrap_or(best.start);
        let end = time_at(&base, p.end_meters, best, false).unwrap_or(best.end);
        let mut facts = section_evidence(
            samples_session,
            &format!("{}:{}", best.id, p.id),
            &p.primary,
            None,
        );
        let samples = validated_speed_samples(samples_session, p, start, end);
        if let (Some(entry), Some(exit)) = (p.primary.entry_speed, p.primary.exit_speed) {
            facts.push(fact(
                &p.id,
                "meanAcceleration",
                "m/s²",
                (exit - entry) / (end - start),
                None,
                speed_ids(samples_session),
            ));
        }
        if let Some(rpm) = samples_session
            .channels
            .iter()
            .find(|c| c.unit.eq_ignore_ascii_case("rpm"))
        {
            if !telemetry::source_gaps(rpm)
                .iter()
                .any(|g| start < g[1] && end > g[0])
            {
                let values: Vec<_> = rpm
                    .times
                    .iter()
                    .zip(&rpm.values)
                    .filter(|(t, v)| **t >= start && **t <= end && v.is_finite() && **v > 0.)
                    .map(|(_, v)| *v)
                    .collect();
                if values.len() >= 2 {
                    facts.push(fact(
                        &p.id,
                        "recordedMinimumRpm",
                        "rpm",
                        values.iter().copied().min_by(f64::total_cmp).unwrap(),
                        None,
                        vec![rpm.id.clone()],
                    ));
                    facts.push(fact(
                        &p.id,
                        "recordedMaximumRpm",
                        "rpm",
                        values.iter().copied().max_by(f64::total_cmp).unwrap(),
                        None,
                        vec![rpm.id.clone()],
                    ));
                }
            }
        }
        let mut notes=vec!["Entry, minimum and exit speed, acceleration, momentum, RPM recovery, shifts and GPS line screened; missing or invalid signals are withheld.".into()];
        if p.primary.min_speed.is_none() {
            notes.push(
                "Continuous validated speed unavailable; speed-shape heuristics withheld.".into(),
            );
        }
        if let Some(path) = section_path_length(&base, start - best.start, end - best.start) {
            facts.push(fact(
                &p.id,
                "recordedPathLength",
                "m",
                path,
                None,
                vec!["gps-latitude".into(), "gps-longitude".into()],
            ));
        }
        notes.push("GPS path length describes the recorded line; track limits, grip and an optimal line are not measured. No line correction or higher safe corner speed is inferred from curvature alone.".into());
        let mut faster: Vec<_> = comparisons
            .iter()
            .filter_map(|(lap, a)| {
                let m = a.segments.get(i)?.comparison.as_ref()?;
                let resolution = a.alignment.timing_uncertainty_s?.max(0.02);
                (p.primary.elapsed - m.elapsed > resolution).then_some((*lap, a, m, resolution))
            })
            .collect();
        faster.sort_by(|a, b| {
            a.2.elapsed
                .total_cmp(&b.2.elapsed)
                .then_with(|| a.0.id.cmp(&b.0.id))
        });
        // Lead with the fastest compatible source when one exists. Otherwise an
        // even faster incompatible trajectory can hide a supported quantified card.
        let preferred = preferred_support_index(
            &p.primary,
            &faster
                .iter()
                .map(|candidate| candidate.2)
                .collect::<Vec<_>>(),
        );
        if let Some((lap, a, m, resolution)) = preferred.and_then(|index| faster.get(index)) {
            let id = format!("{}:{}:observed", best.id, p.id);
            let evidence = section_evidence(samples_session, &id, &p.primary, Some(m));
            let loss = p.primary.elapsed - m.elapsed;
            let repeated: Vec<_> = faster
                .iter()
                .map(|(_, _, m, u)| (p.primary.elapsed - m.elapsed - u).max(0.))
                .collect();
            let estimated = (repeated.len() >= 2).then(|| median(&repeated));
            let downstream = match (p.primary.exit_speed, m.exit_speed) {
                (Some(x), Some(y)) => (y - x).max(0.),
                _ => 0.,
            };
            opportunities.push(Opportunity{coaching:None,
id,
lap_id:best.id.clone(),
reference_lap_id:lap.id.clone(),
section_id:Some(p.id.clone()),
label:p.label.clone(),
kind:p.kind.clone(),
start_time:start,
end_time:end,
start_meters:Some(p.start_meters),
end_meters:Some(p.end_meters),
observed_loss_seconds:Some(loss),
estimated_gain_seconds:estimated,
modeled_gain:None,
gain_range:boundary_compatible(&p.primary,m).then(|| GainRange {
    lower_seconds:(loss-resolution).max(0.), upper_seconds:(loss+resolution).min(p.primary.elapsed),
    basis:"demonstrated".into(),
    assumption:"Repeat the faster supporting section with compatible entry and exit speeds; line and grip still need validation.".into(),
    method:"Observed fixed-distance elapsed difference plus/minus spatial timing uncertainty; disjoint sections only.".into(),
}),
faster_example_count:faster.len(),
confidence:if faster.len()>=2 && loss>2.*resolution && a.alignment.coverage>=0.95 {"high"}else{"medium"}.into(),
status:"proven".into(),
priority_score:loss/resolution+faster.len() as f64+downstream*0.2,
evidence,
observation:"Your fastest lap took longer through this spatially matched section than a valid supporting lap. This is an observed section opportunity, not a promised combined lap gain.".into(),
action:section_action(&p.primary,m,&p.kind),
uncertainty:"Boundary speed and line differences can carry time into adjacent sections. Compare the preceding exit and following section before combining changes; GPS resolution limits the difference and speed does not establish brake, throttle or steering causes.".into()
});
        }
        // Conservative stitched reference: retain only observed improvements beyond
        // timing resolution with compatible entry AND exit speed, never sum event gains.
        // Fixed disjoint sections account for each meter exactly once.
        for (lap, _, m, _) in &faster {
            if boundary_compatible(&p.primary, m) && m.elapsed < segments[i].elapsed_seconds {
                segments[i].elapsed_seconds = m.elapsed;
                segments[i].lap_id = lap.id.clone();
            }
        }
        // Timing resolution gates quantitative gains, not comparative driving experiments.
        // Keep weaker speed-shape evidence available with explicitly unmeasured status.
        if !opportunities
            .iter()
            .any(|o| o.section_id.as_deref() == Some(p.id.as_str()))
        {
            if let Some(o) = comparative_experiment(s, &base, best, p, i, &comparisons) {
                opportunities.push(o);
            }
        }
        if let Some(samples) = samples {
            // Additional supporting laps must not suppress a baseline-only physics
            // hypothesis. Selection/budgeting resolves overlapping alternatives later.
            if let Some(o) = apex_recovery_experiment(samples_session, &base, best, p, &samples) {
                opportunities.push(o);
            }
            if let Some(o) = momentum_opportunity(samples_session, &base, best, p, &samples) {
                opportunities.push(o);
            }
        }
        section_assessments.push(SectionAssessment {
            section_id: p.id.clone(),
            label: p.label.clone(),
            kind: p.kind.clone(),
            start_time: start,
            end_time: end,
            start_meters: p.start_meters,
            end_meters: p.end_meters,
            evidence: facts,
            notes,
        });
    }
    check()?;
    let mut envelope_views = vec![(best, &base.primary)];
    for (lap, analysis) in &comparisons {
        if let Some(view) = analysis.comparison.as_ref() {
            envelope_views.push((*lap, view));
        }
    }
    let mut performance_envelope = base
        .alignment
        .position_uncertainty_m
        .and_then(|noise| super::simulation::envelope(s, &envelope_views, noise));
    // Canonical comparison distance is spatially warped. Fit dynamics only on
    // each lap's independent physical distance, keeping canonical views for
    // observed section matching above.
    let mut physical_views = Vec::new();
    for lap in &eligible {
        check()?;
        // Cross-recording capability reuse requires a spatially matched track.
        if s.merge.is_some()
            && lap.id != best.id
            && !comparisons.iter().any(|(l, _)| l.id == lap.id)
        {
            continue;
        }
        if super::sources::speed(s, lap).is_none() {
            continue;
        }
        if let Ok(a) = super::sources::analyze(s, lap, None, None) {
            if a.alignment.method == "spatial" {
                physical_views.push((*lap, a.primary));
            }
        }
    }
    let physical_refs: Vec<_> = physical_views.iter().map(|(l, v)| (*l, v)).collect();
    let mut physics = super::full_lap::analyze(
        s,
        &base,
        best,
        &physical_refs,
        base.alignment.position_uncertainty_m.unwrap_or(1.),
        &cancelled,
    )?;
    if let Some(envelope) = &physics.calibrated_envelope {
        physics.diagnostics.validation.prediction = Some(super::prediction::validate(
            s,
            &physics.diagnostics.validation.withheld_lap_ids,
            envelope,
            &cancelled,
        )?);
    }
    let full_lap = Some(physics.diagnostics);
    let full_lap_ids: Vec<_> = physics.opportunities.iter().map(|o| o.id.clone()).collect();
    let simulated_profiles = physics.profiles;
    if physics.calibrated_envelope.is_some() {
        performance_envelope = physics.calibrated_envelope;
    }
    opportunities.extend(physics.opportunities);
    check()?;
    let rpm_threshold = samples_session
        .channels
        .iter()
        .find(|c| c.unit.eq_ignore_ascii_case("rpm"))
        .and_then(|c| {
            let mut values: Vec<_> = c
                .times
                .iter()
                .zip(&c.values)
                .filter(|(t, v)| **t >= best.start && **t <= best.end && v.is_finite() && **v > 0.)
                .map(|(_, v)| *v)
                .collect();
            values.sort_by(f64::total_cmp);
            (values.len() >= 10).then(|| values[values.len() / 4])
        });
    for tool in ["shifts", "bog"] {
        check()?;
        if tool == "bog" && rpm_threshold.is_none() {
            continue;
        }
        let request = advanced::AdvancedRequest {
            tool: tool.into(),
            bog_threshold: rpm_threshold.unwrap_or(1.),
            ..Default::default()
        };
        if let Ok(events) = advanced::analyze(samples_session, &base, &request) {
            for event in events
                .laps
                .into_iter()
                .flat_map(|l| l.events)
                .filter(|e| e.lap_id == best.id)
            {
                let section = base.segments.iter().find(|p| {
                    event.source_time
                        >= time_at(&base, p.start_meters, best, false).unwrap_or(best.end)
                        && event.source_time
                            <= time_at(&base, p.end_meters, best, false).unwrap_or(best.start)
                });
                let Some(section) = section else {
                    continue;
                };
                // Gear transitions alone are normal operation; record coverage but only
                // flag the detector's sustained interruption or moving low-RPM candidates.
                if let Some(assessment) = section_assessments
                    .iter_mut()
                    .find(|p| p.section_id == section.id)
                {
                    assessment
                        .notes
                        .push(format!("{}: {}", event.kind, event.evidence));
                }
                if tool == "shifts" && !event.evidence.contains("Possible missed/long") {
                    continue;
                }
                if event.recovery_time.unwrap_or(0.) < 0.6 {
                    continue;
                }
                let id = format!("{}:{}", best.id, event.id);
                let mut evidence = vec![];
                for (metric, value, unit) in [
                    ("rpmBefore", event.rpm_before, "rpm"),
                    ("rpmAfter", event.rpm_after, "rpm"),
                    ("rpmRecovery", event.recovery_time, "s"),
                    ("minimumRpm", event.min_rpm, "rpm"),
                    (
                        "referenceLowerQuartileRpm",
                        if tool == "bog" { rpm_threshold } else { None },
                        "rpm",
                    ),
                ] {
                    if let Some(v) = value {
                        evidence.push(fact(&id, metric, unit, v, None, rpm_ids(samples_session)));
                    }
                }
                if let Some(assessment) = section_assessments
                    .iter_mut()
                    .find(|p| p.section_id == section.id)
                {
                    assessment.evidence.extend(evidence.clone());
                }
                opportunities.push(Opportunity{coaching:None,
id,
lap_id:best.id.clone(),
reference_lap_id:best.id.clone(),
section_id:Some(section.id.clone()),
label:if tool=="bog"{"Review low-RPM recovery"}else{"Review RPM interruption"}.into(),
kind:event.kind,
start_time:event.source_time.max(best.start),
end_time:event.end_time.min(best.end),
start_meters:meters_at(&base,best,event.source_time,false),
end_meters:meters_at(&base,best,event.end_time,false),
observed_loss_seconds:None,
estimated_gain_seconds:None,
modeled_gain:None,
gain_range:None,
faster_example_count:0,
confidence:"low".into(),
status:"investigate".into(),
priority_score:event.recovery_time.unwrap_or(0.),
evidence,
observation:format!("On your fastest lap: {} The relative threshold is derived from this lap, not an engine powerband.",event.evidence),
action:if tool=="bog"{"Inspect the speed and RPM recovery together. Try a repeatable exit that maintains momentum, and compare RPM recovery on the next run before changing gearing."}else{"Inspect RPM and available gear traces around the interruption. Test a consistent shift point on the next run and check speed recovery."}.into(),
uncertainty:"No faster example supports a time gain. RPM alone cannot confirm bogging, a missed shift, mechanical duration or a control-input cause.".into()
});
            }
        }
    }
    // Preserve only endpoint-matched scenarios in the additive budget. A modeled
    // speed envelope is conditional, and never added to the same measured section.
    for o in &mut opportunities {
        if o.gain_range.is_none() {
            if let Some(m) = &o.modeled_gain {
                if m.lower_seconds.is_finite()
                    && m.upper_seconds.is_finite()
                    && m.lower_seconds > 0.
                    && m.upper_seconds >= m.lower_seconds
                {
                    o.gain_range = Some(GainRange {
                        lower_seconds: m.lower_seconds,
                        upper_seconds: m.upper_seconds,
                        basis: "hypothesis".into(),
                        assumption: m.assumption.clone(),
                        method: m.method.clone(),
                    });
                }
            }
        }
    }
    let tier = |status: &str| match status {
        "proven" => 2,
        "likely" => 1,
        _ => 0,
    };
    opportunities.sort_by(|a, b| {
        b.gain_range
            .is_some()
            .cmp(&a.gain_range.is_some())
            .then_with(|| tier(&b.status).cmp(&tier(&a.status)))
            .then_with(|| {
                b.gain_range
                    .as_ref()
                    .map_or(0., |g| g.upper_seconds)
                    .total_cmp(&a.gain_range.as_ref().map_or(0., |g| g.upper_seconds))
            })
            .then_with(|| b.priority_score.total_cmp(&a.priority_score))
            .then_with(|| a.id.cmp(&b.id))
    });
    // Budget the complete lap, not merely the three visible cards. A compatible
    // recorded section and a modeled variant are alternatives, never additive.
    // A continuous physical lap is one alternative. Never add its gains to
    // recorded sections or independently optimized local scenarios.
    let physical_lap = full_lap
        .as_ref()
        .filter(|p| p.modeled_lap_seconds.is_some());
    let physical_potential = physical_lap.and_then(|p|p.gain_range.as_ref())
        .filter(|g|g.upper_seconds > 0.)
        .map(|g| {
            let mut potential = g.clone();
            // Signed losses remain in the modeled times and section diagnostics.
            // A zero lower potential promises no minimum improvement.
            potential.lower_seconds = potential.lower_seconds.max(0.);
            potential.assumption.push_str(" Zero lower potential means no supported minimum saving; a slower scenario remains visible in modeled lap times.");
            potential
        });
    let enhancement_budget = if physical_lap.is_some() {
        physical_potential
            .as_ref()
            .map(|gain| {
                vec![SectionGain {
                    section_id: "full-lap".into(),
                    source_lap_id: best.id.clone(),
                    opportunity_id: None,
                    gain_range: gain.clone(),
                }]
            })
            .unwrap_or_default()
    } else {
        section_budget(&base, &segments, &comparisons, &opportunities, best)
    };
    let mut primary: Vec<&Opportunity> = Vec::new();
    for o in &opportunities {
        if physical_lap.is_some() && !full_lap_ids.contains(&o.id) {
            continue;
        }
        if enhancement_budget
            .iter()
            .filter_map(|b| b.opportunity_id.as_ref())
            .filter_map(|id| opportunities.iter().find(|p| &p.id == id))
            .any(|chosen| {
                chosen.id != o.id
                    && o.start_time < chosen.end_time
                    && o.end_time > chosen.start_time
            })
        {
            continue;
        }
        if enhancement_budget
            .iter()
            .find(|b| o.section_id.as_deref() == Some(b.section_id.as_str()))
            .and_then(|b| b.opportunity_id.as_ref())
            .is_some_and(|id| id != &o.id)
        {
            continue;
        }
        if primary.len() == 3 {
            break;
        }
        if primary.iter().any(|p| {
            p.section_id == o.section_id
                || p.action == o.action
                || (physical_lap.is_some()
                    && p.coaching
                        .as_ref()
                        .zip(o.coaching.as_ref())
                        .is_some_and(|(a, b)| a.mechanism == b.mechanism))
                || (o.start_time < p.end_time && o.end_time > p.start_time)
        }) {
            continue;
        }
        primary.push(o);
    }
    let primary_opportunity_ids = primary.iter().map(|o| o.id.clone()).collect();
    let improvement_potential = if physical_lap.is_some() {
        physical_potential
    } else {
        (!enhancement_budget.is_empty()).then(|| GainRange {
        lower_seconds:enhancement_budget.iter().map(|b|b.gain_range.lower_seconds).sum(),
        upper_seconds:enhancement_budget.iter().map(|b|b.gain_range.upper_seconds).sum(),
        basis:if enhancement_budget.iter().all(|b|b.gain_range.basis == "demonstrated") {"demonstrated"}else{"hypothesis"}.into(),
        assumption:"Combine compatible alternatives over disjoint spatial intervals; corner-to-straight models replace every overlapping section. Validate boundary state, downstream sections and the complete lap.".into(),
        method:"Sum the full-lap section budget once, independently of the three displayed recommendations. Seed each section from its exact compatible traditional source. An endpoint-preserving corner-complex model replaces all touched sections only if both scenario bounds dominate their combined budget; overlapping alternatives are never added. Additional supported sections may contribute beyond the three cards.".into(),
    })
    };
    let enhanced_theoretical_best = physical_lap
        .and_then(|p| p.modeled_lap_seconds.clone())
        .or_else(|| {
            improvement_potential.as_ref().map(|g| TimeRange {
                lower_seconds: (best.duration - g.upper_seconds).max(0.),
                upper_seconds: (best.duration - g.lower_seconds).max(0.),
            })
        });
    let total = opportunities
        .iter()
        .filter_map(|o| o.observed_loss_seconds)
        .sum();
    let laps = eligible
        .iter()
        .map(|l| {
            let a = if l.id == best.id {
                Some(&base)
            } else {
                comparisons
                    .iter()
                    .find(|(p, _)| p.id == l.id)
                    .map(|(_, a)| a)
            };
            let spatial = a.is_some_and(|a| a.alignment.method == "spatial");
            LapSummary {
                lap_id: l.id.clone(),
                duration_seconds: l.duration,
                spatial_comparison: spatial,
                coverage: a.map_or(0., |a| a.alignment.coverage),
                timing_resolution_seconds: a.and_then(|a| a.alignment.timing_uncertainty_s),
                total_observed_loss_seconds: if l.id == best.id && spatial {
                    Some(total)
                } else {
                    None
                },
                notes: a.map_or_else(
                    || vec!["Spatial comparison unavailable.".into()],
                    |a| a.warnings.clone(),
                ),
            }
        })
        .collect();
    let theoretical = if base.alignment.method == "spatial"
        && !segments.is_empty()
        && (base.segments.iter().map(|p| p.primary.elapsed).sum::<f64>() - best.duration).abs()
            < 0.002
    {
        Some(segments.iter().map(|p| p.elapsed_seconds).sum::<f64>())
    } else {
        None
    };
    let mut notes = s.warnings.clone();
    notes.extend(base.warnings.clone());
    if s.channels.iter().any(|c| {
        let name = c.name.to_lowercase();
        name.contains("gear") && (name.contains("calculat") || name.contains("estimat"))
    }) {
        notes.push("Calculated gear is unverified: only integer states held for 150 ms on both sides are accepted as transition candidates. Oscillations and fractional states are suppressed; speed/RPM ratio, clutch slip and calibration can imitate shifts. Calculated transitions are recorded for inspection and never establish a missed shift, mechanical shift duration or time gain.".into());
    }
    notes.push(if physical_lap.is_some() {
        "The modeled lap is integrated from one continuous periodic speed profile under calibrated combined-grip constraints. Signed section costs are retained. Its gain replaces the entire overlapping heuristic budget; recorded theoretical best remains a separate measurement. Numerical ranges are conditional sensitivity scenarios, not confidence intervals or guaranteed performance."
    } else {
        "Full-lap physics was withheld; inspect its rejection diagnostics. The conditional estimate uses only compatible disjoint recorded or local scenarios. Numerical ranges are engineering sensitivity scenarios, not confidence intervals or guaranteed performance."
    }.into());
    notes.push("All findings target the fastest complete valid lap. Other laps only provide supporting same-position evidence. Proven means an observed faster section, not a guaranteed achievable gain.".into());
    notes.push("Theoretical best uses disjoint spatial sections only when improvements exceed timing resolution and both boundary speeds agree within 1 m/s or 5%. This compatibility screen cannot establish that every line and vehicle state combines perfectly; treat the result as a conditional analytical reference. Observed section opportunities can exceed the compatible theoretical improvement and must not be added to RPM or momentum findings.".into());
    notes.push("Whole-lap spatial timing resolution includes GPS cadence, position uncertainty and the slowest projected speed. Smaller section differences do not establish a measured time gain; separately labeled engineering scenarios can still quantify a conditional experiment. Likely improvements require repeated supporting speed patterns or a corroborated momentum interruption; areas to investigate are testable hypotheses, not established inefficiencies.".into());
    notes.push("Every corner and straight is screened. No finding means no supported opportunity was detected, not optimal driving. Completeness uses recorded crossings; pit intent, grip limit and optimal line are not measured. RPM/gear findings without supported scenarios have no numerical time gain; no finding asserts unmeasured brake/throttle causes.".into());
    let mut report = CoachReport {
        analysis_version: ANALYSIS_VERSION.into(),
        session_id: s.id.clone(),
        reference_lap_id: best.id.clone(),
        best_lap_id: best.id.clone(),
        best_lap_seconds: best.duration,
        theoretical_best_seconds: theoretical,
        theoretical_improvement_seconds: theoretical.map(|v| (best.duration - v).max(0.)),
        enhanced_theoretical_best,
        improvement_potential,
        primary_opportunity_ids,
        enhancement_budget,
        valid_lap_count: eligible.len(),
        excluded_laps,
        consistency,
        segments,
        section_assessments,
        laps,
        performance_envelope,
        simulated_profiles,
        full_lap,
        opportunities,
        total_observed_opportunity_seconds: (base.alignment.method == "spatial").then_some(total),
        opportunity_lap_id: Some(best.id.clone()),
        notes,
    };
    if s.merge.is_some() {
        report.notes.push("Merged recordings are treated as same-kart, same-track sessions with approximately equivalent grip and conditions; spatially incompatible laps are excluded from shared physics and section comparisons. Original recording timestamps and sample cadence are retained.".into());
        let qualify = |e: &mut Evidence, reference: Option<&Lap>| {
            let local_ids = e.channel_ids.clone();
            e.channel_ids = local_ids
                .iter()
                .filter(|id| primary_samples.channels.iter().any(|c| &c.id == *id))
                .map(|id| crate::merging::qualified_channel_id(&primary_samples.id, id))
                .collect();
            if e.reference_value.is_some() {
                if let Some(source) = reference.and_then(|lap| super::sources::recording(s, lap)) {
                    for id in &local_ids {
                        if source.channels.iter().any(|c| c.id == *id) {
                            let qualified = crate::merging::qualified_channel_id(&source.id, id);
                            if !e.channel_ids.contains(&qualified) {
                                e.channel_ids.push(qualified);
                            }
                        }
                    }
                }
            }
        };
        for section in &mut report.section_assessments {
            for e in &mut section.evidence {
                qualify(e, None);
            }
        }
        for opportunity in &mut report.opportunities {
            let reference = s.laps.iter().find(|l| l.id == opportunity.reference_lap_id);
            for e in &mut opportunity.evidence {
                qualify(e, reference);
            }
        }
    }
    Ok(report)
}
fn section_budget(
    base: &Analysis,
    segments: &[BestSegment],
    comparisons: &[(&Lap, Analysis)],
    opportunities: &[Opportunity],
    best: &Lap,
) -> Vec<SectionGain> {
    let mut enhancement_budget = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let baseline = &base.segments[index];
        let loss = (baseline.primary.elapsed - segment.elapsed_seconds).max(0.);
        let mut chosen = if segment.lap_id != best.id && loss > 0. {
            comparisons.iter().find(|(lap,_)|lap.id == segment.lap_id)
                .and_then(|(_,a)|a.alignment.timing_uncertainty_s).map(|resolution|resolution.max(0.02))
                .map(|resolution|SectionGain {
                    section_id:segment.section_id.clone(),source_lap_id:segment.lap_id.clone(),
                    opportunity_id:opportunities.iter().find(|o|o.section_id.as_deref()==Some(segment.section_id.as_str())
                        && o.reference_lap_id == segment.lap_id && o.observed_loss_seconds.is_some()).map(|o|o.id.clone()),
                    gain_range:GainRange {lower_seconds:(loss-resolution).max(0.),
                        upper_seconds:(loss+resolution).min(baseline.primary.elapsed),basis:"demonstrated".into(),
                        assumption:"Repeat this complete compatible supporting section under comparable conditions; validate adjacent sections and the complete lap.".into(),
                        method:"Elapsed difference of the exact recorded source selected for traditional stitching, plus/minus spatial alignment timing uncertainty.".into()},
                })
        } else {
            None
        };
        for opportunity in opportunities.iter().filter(|o| {
            o.section_id.as_deref() == Some(segment.section_id.as_str())
                && o.modeled_gain.is_some()
                && o.kind != "physics-counterfactual"
        }) {
            let Some(range) = opportunity.gain_range.as_ref() else {
                continue;
            };
            // Require dominance of both conservative bounds before replacing a
            // demonstrated alternative. This preserves the traditional possibility
            // without combining incompatible trajectories or forcing an artificial bound.
            let replace = chosen
                .as_ref()
                .map_or(true, |old| scenario_dominates(range, &old.gain_range));
            if replace {
                chosen = Some(SectionGain {
                    section_id: segment.section_id.clone(),
                    source_lap_id: opportunity.reference_lap_id.clone(),
                    opportunity_id: Some(opportunity.id.clone()),
                    gain_range: range.clone(),
                });
            }
        }
        if let Some(gain) = chosen {
            enhancement_budget.push(gain);
        }
    }
    // A corner-to-straight alternative consumes EVERY touched section; it cannot
    // coexist with that straight's measured or modeled opportunity.
    let mut physics: Vec<_> = opportunities
        .iter()
        .filter(|o| o.kind == "physics-counterfactual" && o.gain_range.is_some())
        .collect();
    physics.sort_by(|a, b| {
        b.gain_range
            .as_ref()
            .unwrap()
            .lower_seconds
            .total_cmp(&a.gain_range.as_ref().unwrap().lower_seconds)
            .then_with(|| {
                b.gain_range
                    .as_ref()
                    .unwrap()
                    .upper_seconds
                    .total_cmp(&a.gain_range.as_ref().unwrap().upper_seconds)
            })
    });
    let mut occupied: Vec<(f64, f64)> = Vec::new();
    for opportunity in physics {
        let (Some(start), Some(end), Some(range)) = (
            opportunity.start_meters,
            opportunity.end_meters,
            opportunity.gain_range.as_ref(),
        ) else {
            continue;
        };
        if occupied.iter().any(|(a, b)| start < *b && end > *a) {
            continue;
        }
        let touched = |id: &str| {
            base.segments
                .iter()
                .find(|s| s.id == id)
                .is_some_and(|s| start < s.end_meters && end > s.start_meters)
        };
        let lower: f64 = enhancement_budget
            .iter()
            .filter(|b| touched(&b.section_id))
            .map(|b| b.gain_range.lower_seconds)
            .sum();
        let upper: f64 = enhancement_budget
            .iter()
            .filter(|b| touched(&b.section_id))
            .map(|b| b.gain_range.upper_seconds)
            .sum();
        if range.lower_seconds < lower || range.upper_seconds < upper {
            continue;
        }
        enhancement_budget.retain(|b| !touched(&b.section_id));
        enhancement_budget.push(SectionGain {
            section_id: opportunity.section_id.clone().unwrap_or_default(),
            source_lap_id: best.id.clone(),
            opportunity_id: Some(opportunity.id.clone()),
            gain_range: range.clone(),
        });
        occupied.push((start, end));
    }
    enhancement_budget
}

fn scenario_dominates(candidate: &GainRange, recorded: &GainRange) -> bool {
    candidate.lower_seconds >= recorded.lower_seconds
        && candidate.upper_seconds >= recorded.upper_seconds
}

/// Select a speed tradeoff worth testing even when section timing cannot establish a gain.
/// A stronger exit must not simply be explained by a substantially faster entry.
fn comparative_experiment(
    s: &Session,
    base: &Analysis,
    best: &Lap,
    section: &telemetry::Segment,
    index: usize,
    comparisons: &[(&Lap, Analysis)],
) -> Option<Opportunity> {
    let a = &section.primary;
    let (entry, minimum, exit) = (a.entry_speed?, a.min_speed?, a.exit_speed?);
    let tolerance = 0.5_f64.max(exit * 0.03);
    let mut candidates: Vec<_> = comparisons
        .iter()
        .filter_map(|(lap, analysis)| {
            let b = analysis.segments.get(index)?.comparison.as_ref()?;
            let (be, bm, bx) = (b.entry_speed?, b.min_speed?, b.exit_speed?);
            let resolution = analysis.alignment.timing_uncertainty_s?;
            // Avoid using a plainly slower overall section to claim a beneficial tradeoff.
            if b.elapsed > a.elapsed + resolution || be > entry + tolerance {
                return None;
            }
            let exit_advantage = bx - exit;
            let apex_advantage = bm - minimum;
            let exit_focus = exit_advantage > tolerance;
            let apex_focus = apex_advantage > tolerance && bx >= exit - tolerance * 0.5;
            (exit_focus || apex_focus).then_some((
                *lap,
                analysis,
                b,
                exit_focus,
                if exit_focus {
                    exit_advantage * 1.5
                } else {
                    apex_advantage
                },
            ))
        })
        .collect();
    candidates.sort_by(|a, b| b.4.total_cmp(&a.4).then_with(|| a.0.id.cmp(&b.0.id)));
    let (lap, comparison, b, exit_focus, score) = *candidates.first()?;
    let repeated = candidates.iter().filter(|c| c.3 == exit_focus).count();
    let id = format!("{}:{}:tradeoff", best.id, section.id);
    let mut evidence = section_evidence(super::sources::recording(s, best)?, &id, a, Some(b));
    evidence.push(fact(
        &id,
        "timingResolution",
        "s",
        comparison.alignment.timing_uncertainty_s?,
        None,
        vec!["gps-latitude".into(), "gps-longitude".into()],
    ));
    let start = time_at(base, section.start_meters, best, false)?;
    let end = time_at(base, section.end_meters, best, false)?;
    let other_start = time_at(comparison, section.start_meters, lap, true)?;
    let other_end = time_at(comparison, section.end_meters, lap, true)?;
    if let Some(path) = section_path_length(base, start - best.start, end - best.start) {
        // Path lengths are contextual only: GPS line differences do not prove a faster line.
        let track = &comparison.comparison.as_ref()?.track;
        let points: Vec<_> = track
            .iter()
            .filter(|p| {
                p.position >= other_start - lap.start && p.position <= other_end - lap.start
            })
            .collect();
        if points.len() >= 3 && !points.iter().any(|p| p.break_before) {
            let other_path = points
                .windows(2)
                .map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y))
                .sum();
            evidence.push(fact(
                &id,
                "recordedPathLength",
                "m",
                path,
                Some(other_path),
                vec!["gps-latitude".into(), "gps-longitude".into()],
            ));
        }
    }
    Some(Opportunity {coaching:None,
        id, lap_id: best.id.clone(), reference_lap_id: lap.id.clone(),
        section_id: Some(section.id.clone()),
        label: format!("{}: {}", section.label, if exit_focus {"exit momentum"} else {"minimum-speed tradeoff"}),
        kind: if exit_focus {"exit-tradeoff"} else {"apex-tradeoff"}.into(),
        start_time: start, end_time: end,
        start_meters: Some(section.start_meters), end_meters: Some(section.end_meters),
        observed_loss_seconds: None, estimated_gain_seconds: None, modeled_gain: super::modeled::tradeoff(s, &comparison.primary, comparison.comparison.as_ref()?, best, lap, section.start_meters, section.end_meters,base.alignment.position_uncertainty_m?),
        gain_range:None,
faster_example_count: 0,
        confidence: if repeated >= 2 {"medium"} else {"low"}.into(),
        status: if repeated >= 2 {"likely"} else {"investigate"}.into(),
        priority_score: score + repeated.min(4) as f64 * 0.2,
        evidence,
        observation: if exit_focus {
            "A supporting lap leaves this section faster without a substantially faster entry. This suggests an entry-versus-exit tradeoff worth testing; section timing does not establish a time saving."
        } else {
            "A supporting lap maintains a higher minimum speed without a substantially faster entry or materially poorer exit. This suggests a different apex approach worth testing; section timing does not establish a time saving."
        }.into(),
        action: if section.kind == "straight" {
            "Compare acceleration onset and RPM recovery with the supporting lap and inspect the preceding corner exit. Test one repeatable change, then compare this entire section and the next braking zone."
        } else if exit_focus {
            "Overlay the supporting GPS line and minimum-speed location. Try a more settled entry and an exit-focused arc; validate the whole corner plus following straight, not exit speed alone."
        } else {
            "Compare the supporting lap’s minimum-speed location and GPS arc. Try reducing mid-corner corrections while preserving exit speed; validate full section time and repeatability before increasing entry speed."
        }.into(),
        uncertainty: format!("{} supporting lap(s) show this speed pattern. Different lines, conditions and adjacent sections may explain it. Timing resolution prevents a measured time-gain claim. A conditional modeled range is shown only if its complete speed tradeoff preserves endpoints and passes measured acceleration and GPS lateral-demand screens; a faster exit or minimum alone does not establish a faster combined lap.", repeated),
    })
}

/// A long recovery from an interior minimum motivates a controlled experiment, not
/// a claim that braking was unnecessary or the driver can safely carry more speed.
fn apex_recovery_experiment(
    s: &Session,
    base: &Analysis,
    best: &Lap,
    section: &telemetry::Segment,
    samples: &[(f64, f64)],
) -> Option<Opportunity> {
    if section.kind != "corner" {
        return None;
    }
    let (index, &(time, minimum)) = samples
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.1.total_cmp(&b.1))?;
    let (start, entry) = *samples.first()?;
    let (end, exit) = *samples.last()?;
    if time - start < 0.3 || end - time < 0.7 || entry - minimum < 1.5 || exit - minimum < 1. {
        return None;
    }
    let recovery = samples
        .iter()
        .skip(index + 1)
        .find(|(_, v)| *v >= minimum + 1.)?
        .0
        - time;
    if recovery < 0.6 {
        return None;
    }
    let id = format!("{}:{}:apex-recovery", best.id, section.id);
    Some(Opportunity {coaching:None,
        id: id.clone(), lap_id: best.id.clone(), reference_lap_id: best.id.clone(),
        section_id: Some(section.id.clone()), label: format!("{}: apex recovery experiment", section.label),
        kind: "apex-recovery".into(), start_time: start, end_time: end,
        start_meters: Some(section.start_meters), end_meters: Some(section.end_meters),
        observed_loss_seconds: None, estimated_gain_seconds: None, modeled_gain: super::modeled::recovery(s, &base.primary, best, section.start_meters, section.end_meters,base.alignment.position_uncertainty_m?), gain_range:None,
faster_example_count: 0,
        confidence: "low".into(), status: "investigate".into(), priority_score: recovery,
        evidence: vec![fact(&id,"minimumSpeed","m/s",minimum,None,speed_ids(s)),
            fact(&id,"recoveryToOneMeterPerSecond","s",recovery,None,speed_ids(s)),
            fact(&id,"minimumSpeedLocation","%",100.*(time-start)/(end-start),None,speed_ids(s))],
        observation: "Your fastest lap has a sustained low-speed phase after an interior corner minimum. Review the entry, minimum-speed location and exit together: earlier stable recovery may be worth testing, but this profile alone does not establish an inefficiency.".into(),
        action: "Inspect the GPS arc and RPM at the minimum. Test a settled entry and one smooth exit arc, then compare recovery onset, full corner time and the following section over repeated laps. Keep entry speed controlled while testing.".into(),
        uncertainty: "This may be normal braking and corner geometry. Grip, traffic and control inputs are not established. No faster comparison proves a gain, and the measured recovery interval is not recoverable time or a powerband diagnosis.".into(),
    })
}

fn fact(
    id: &str,
    metric: &str,
    unit: &str,
    value: f64,
    reference: Option<f64>,
    channel_ids: Vec<String>,
) -> Evidence {
    Evidence {
        id: format!("{id}:{metric}"),
        metric: metric.into(),
        unit: unit.into(),
        lap_value: value,
        reference_value: reference,
        channel_ids,
    }
}
fn section_evidence(
    s: &Session,
    id: &str,
    m: &telemetry::SegmentMetrics,
    reference: Option<&telemetry::SegmentMetrics>,
) -> Vec<Evidence> {
    let mut facts = vec![fact(
        id,
        "sectionElapsed",
        "s",
        m.elapsed,
        reference.map(|r| r.elapsed),
        vec!["gps-latitude".into(), "gps-longitude".into()],
    )];
    for (name, x, y) in [
        (
            "entrySpeed",
            m.entry_speed,
            reference.and_then(|r| r.entry_speed),
        ),
        (
            "minimumSpeed",
            m.min_speed,
            reference.and_then(|r| r.min_speed),
        ),
        (
            "exitSpeed",
            m.exit_speed,
            reference.and_then(|r| r.exit_speed),
        ),
    ] {
        if let Some(x) = x {
            facts.push(fact(id, name, "m/s", x, y, speed_ids(s)));
        }
    }
    facts
}
fn preferred_support_index(
    primary: &telemetry::SegmentMetrics,
    supports: &[&telemetry::SegmentMetrics],
) -> Option<usize> {
    supports
        .iter()
        .position(|metrics| boundary_compatible(primary, metrics))
        .or_else(|| (!supports.is_empty()).then_some(0))
}
fn boundary_compatible(a: &telemetry::SegmentMetrics, b: &telemetry::SegmentMetrics) -> bool {
    [(a.entry_speed, b.entry_speed), (a.exit_speed, b.exit_speed)]
        .into_iter()
        .all(|(x, y)| {
            x.zip(y)
                .is_some_and(|(x, y)| (x - y).abs() <= 1_f64.max(x.abs() * 0.05))
        })
}
fn section_action(
    a: &telemetry::SegmentMetrics,
    b: &telemetry::SegmentMetrics,
    kind: &str,
) -> String {
    if a.exit_speed.zip(b.exit_speed).is_some_and(|(x,y)|y-x>0.5){"Compare the supporting lap’s minimum-speed location and exit line. Try preserving exit momentum and verify speed on the following straight; change one thing at a time."}
    else if a.min_speed.zip(b.min_speed).is_some_and(|(x,y)|y-x>0.5){"Compare the supporting lap’s line and minimum-speed location. Try a smoother arc with less speed scrub, then verify both section time and exit speed before adding entry speed."}
    else if a.entry_speed.zip(b.entry_speed).is_some_and(|(x,y)|y-x>0.5){"Inspect the preceding exit and approach against the supporting lap. Test preserving approach momentum and check that minimum and exit speed remain repeatable."}
    else if kind=="straight"{"Compare where acceleration and RPM recover with the supporting lap, including the preceding exit and shift points. Test one repeatable change and recheck the whole section."}
    else{"Compare the supporting lap’s GPS line and speed recovery across this corner. Test one repeatable line change and verify the following exit as well as corner time."}.into()
}
fn section_path_length(a: &Analysis, start: f64, end: f64) -> Option<f64> {
    let points: Vec<_> = a
        .primary
        .track
        .iter()
        .filter(|p| p.position >= start && p.position <= end)
        .collect();
    (points.len() >= 3 && !points.iter().any(|p| p.break_before)).then(|| {
        points
            .windows(2)
            .map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y))
            .sum()
    })
}
fn validated_speed_samples(
    s: &Session,
    p: &telemetry::Segment,
    start: f64,
    end: f64,
) -> Option<Vec<(f64, f64)>> {
    p.primary.min_speed?; // Shared spatial speed plausibility/fix/coverage gate.
    let c = s
        .channels
        .iter()
        .find(|c| c.id == "gps-speed" && c.unit == "m/s")?;
    if telemetry::source_gaps(c)
        .iter()
        .any(|g| start < g[1] && end > g[0])
    {
        return None;
    }
    let samples: Vec<_> = c
        .times
        .iter()
        .zip(&c.values)
        .filter(|(t, _)| **t >= start && **t <= end)
        .map(|(t, v)| (*t, *v))
        .collect();
    (samples.len() >= 8 && samples.iter().all(|(_, v)| v.is_finite() && *v >= 0.))
        .then_some(samples)
}
/// A sustained second deceleration after speed has recovered from the local minimum
/// is a reviewable momentum interruption. It is not proof of unnecessary braking.
fn momentum_opportunity(
    s: &Session,
    analysis: &Analysis,
    best: &Lap,
    p: &telemetry::Segment,
    samples: &[(f64, f64)],
) -> Option<Opportunity> {
    if p.kind != "corner" {
        return None;
    }
    // Average local windows rather than differencing adjacent noisy GPS samples.
    let smooth: Vec<_> = samples
        .iter()
        .map(|(t, _)| {
            let nearby: Vec<_> = samples
                .iter()
                .filter(|(u, _)| (u - t).abs() <= 0.15)
                .map(|(_, v)| *v)
                .collect();
            (*t, nearby.iter().sum::<f64>() / nearby.len() as f64)
        })
        .collect();
    let mut trough = 0;
    let mut peak = 0;
    let mut found = None;
    for i in 1..smooth.len() {
        if smooth[i].1 < smooth[trough].1 && smooth[peak].1 - smooth[trough].1 < 1. {
            trough = i;
            peak = i;
        }
        if smooth[i].1 > smooth[peak].1 {
            peak = i;
        }
        let dt = smooth[i].0 - smooth[peak].0;
        let drop = smooth[peak].1 - smooth[i].1;
        if trough > 0
            && smooth[..trough]
                .iter()
                .any(|(_, v)| *v - smooth[trough].1 >= 1.)
            && smooth[peak].1 - smooth[trough].1 >= 1.
            && dt >= 0.4
            && dt <= 3.
            && drop >= 1_f64.max(smooth[peak].1 * 0.05)
            && drop / dt <= 12.
            && easing_bend(analysis, best, p, smooth[peak].0, smooth[i].0).is_some()
        {
            found = Some((peak, i, drop));
            break;
        }
    }
    let (peak, trough, drop) = found?;
    let (peak_curvature, end_curvature) =
        easing_bend(analysis, best, p, smooth[peak].0, smooth[trough].0)?;
    let id = format!("{}:{}:momentum", best.id, p.id);
    Some(Opportunity{coaching:None,
id:id.clone(),
lap_id:best.id.clone(),
reference_lap_id:best.id.clone(),
section_id:Some(p.id.clone()),
label:format!("{}: momentum interruption",p.label),
kind:"momentum-interruption".into(),
start_time:smooth[peak].0,
end_time:smooth[trough].0,
start_meters:None,
end_meters:None,
observed_loss_seconds:None,
estimated_gain_seconds:None,
modeled_gain:None,
gain_range:None,
faster_example_count:0,
confidence:"medium".into(),
status:"likely".into(),
priority_score:drop,
evidence:vec![fact(&id,"speedDrop","m/s",drop,None,speed_ids(s)),fact(&id,"curvatureAtRecoveryPeak","1/m",peak_curvature,None,vec!["gps-latitude".into(),"gps-longitude".into()]),fact(&id,"curvatureAfterSpeedDrop","1/m",end_curvature,None,vec!["gps-latitude".into(),"gps-longitude".into()]),fact(&id,"decelerationDuration","s",smooth[trough].0-smooth[peak].0,None,speed_ids(s)),fact(&id,"specificKineticEnergyDrop","J/kg",(smooth[peak].1.powi(2)-smooth[trough].1.powi(2))*0.5,None,speed_ids(s))],
observation:"Within one corner on your fastest lap, speed fell, recovered, then fell again while the GPS bend continued in the same direction without substantial tightening. This is a possible momentum interruption worth reviewing, not proof that the correction was avoidable.".into(),
action:"Review the highlighted GPS line and speed trace for an extra correction or a linked corner. Try a smoother single arc only if the layout allows it, then compare exit speed and section time on the next run.".into(),
uncertainty:"Traffic, changing grip or a required correction may explain the dip. GPS curvature is an engineering screen, not a grip limit or proof of an optimal line. No faster example supports a time saving or higher safe speed.".into()
})
}
/// Corroborate a repeated speed correction using coarse spatial geometry. Chords
/// exceed both 10 m and three times position uncertainty; never cross a section
/// boundary or a track gap to infer an easing bend.
fn easing_bend(
    a: &Analysis,
    lap: &Lap,
    section: &telemetry::Segment,
    start: f64,
    end: f64,
) -> Option<(f64, f64)> {
    let Some(uncertainty) = a.alignment.position_uncertainty_m else {
        return None;
    };
    let chord = 10_f64.max(3. * uncertainty);
    let track = &a.primary.track;
    let section_start = match time_at(a, section.start_meters, lap, false) {
        Some(t) => t - lap.start,
        None => return None,
    };
    let section_end = match time_at(a, section.end_meters, lap, false) {
        Some(t) => t - lap.start,
        None => return None,
    };
    let curvature = |time: f64| -> Option<f64> {
        let i = track
            .iter()
            .enumerate()
            .min_by(|(_, x), (_, y)| {
                (x.position - time)
                    .abs()
                    .total_cmp(&(y.position - time).abs())
            })?
            .0;
        let p = &track[i];
        let mut left = i;
        let mut right = i;
        while left > 0 && (track[left].x - p.x).hypot(track[left].y - p.y) < chord {
            left -= 1;
        }
        while right + 1 < track.len() && (track[right].x - p.x).hypot(track[right].y - p.y) < chord
        {
            right += 1;
        }
        let (x, y) = (&track[left], &track[right]);
        if x.position < section_start
            || y.position > section_end
            || track[left..=right].iter().any(|p| p.break_before)
        {
            return None;
        }
        let (ux, uy, vx, vy) = (p.x - x.x, p.y - x.y, y.x - p.x, y.y - p.y);
        let denominator = ux.hypot(uy) * vx.hypot(vy) * (y.x - x.x).hypot(y.y - x.y);
        if denominator <= 0. {
            return None;
        }
        Some(2. * (ux * vy - uy * vx) / denominator)
    };
    let Some(first) = curvature(start - lap.start) else {
        return None;
    };
    // Almost straight GPS geometry gives no useful evidence of an easing bend.
    if first.abs() < 0.01 {
        return None;
    }
    let curvatures: Option<Vec<_>> = (0..=4)
        .map(|i| curvature(start - lap.start + (end - start) * i as f64 / 4.))
        .collect();
    let curvatures = curvatures?;
    curvatures
        .iter()
        .all(|k| {
            k.signum() == first.signum()
                && k.abs() <= first.abs() * 1.2
                && k.abs() >= first.abs() * 0.4
        })
        .then(|| (first, *curvatures.last().unwrap()))
}
fn meters_at(a: &Analysis, l: &Lap, time: f64, comparison: bool) -> Option<f64> {
    let v = if comparison {
        a.comparison.as_ref()?
    } else {
        &a.primary
    };
    let t = time - l.start;
    let i = v.mapping.partition_point(|p| p.time < t);
    if let Some(p) = v.mapping.get(i) {
        if (p.time - t).abs() < 1e-7 {
            return Some(p.meters);
        }
    }
    let (x, y) = (v.mapping.get(i.checked_sub(1)?)?, v.mapping.get(i)?);
    (y.time > x.time).then(|| x.meters + (y.meters - x.meters) * (t - x.time) / (y.time - x.time))
}
fn partition_matches(base: &Analysis, pair: &Analysis) -> bool {
    !base.segments.is_empty()
        && base.segments.len() == pair.segments.len()
        && base.segments.iter().zip(&pair.segments).all(|(a, b)| {
            (a.start_meters - b.start_meters).abs() < 1e-6
                && (a.end_meters - b.end_meters).abs() < 1e-6
                && b.comparison.is_some()
        })
}
fn rpm_ids(s: &Session) -> Vec<String> {
    s.channels
        .iter()
        .filter(|c| c.unit.eq_ignore_ascii_case("rpm") || c.name.to_lowercase().contains("rpm"))
        .map(|c| c.id.clone())
        .take(1)
        .collect()
}
fn speed_ids(s: &Session) -> Vec<String> {
    s.channels
        .iter()
        .filter(|c| c.id == "gps-speed" || c.name.eq_ignore_ascii_case("speed"))
        .map(|c| c.id.clone())
        .take(1)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::Channel;
    fn session(durations: &[f64]) -> Session {
        let mut s = Session {
            merge: None,
            id: "synthetic".into(),
            source: String::new(),
            name: String::new(),
            driver: String::new(),
            track: String::new(),
            recorded_at: String::new(),
            channels: vec![],
            laps: vec![],
            warnings: vec![],
        };
        let mut times = vec![];
        let mut lat = vec![];
        let mut lon = vec![];
        let mut speeds = vec![];
        let mut start = 0.;
        for (index, &duration) in durations.iter().enumerate() {
            s.laps.push(Lap {
                id: format!("lap-{index}"),
                number: index as i32 + 1,
                start,
                end: start + duration,
                duration,
                complete: true,
            });
            let n = (duration * 10.).round() as usize;
            for i in 0..=n {
                if index > 0 && i == 0 {
                    continue;
                }
                let u = i as f64 / n as f64;
                let theta = std::f64::consts::TAU * u;
                times.push(start + duration * u);
                lat.push(40. + (60. * theta.sin() / 6371000.).to_degrees());
                lon.push(
                    -86. + (60. * theta.cos() / (6371000. * 40_f64.to_radians().cos()))
                        .to_degrees(),
                );
                speeds.push(60. * std::f64::consts::TAU / duration);
            }
            start += duration;
        }
        for (id, unit, values) in [
            ("gps-latitude", "deg", lat),
            ("gps-longitude", "deg", lon),
            ("gps-speed", "m/s", speeds),
            ("gps-fix", "", vec![3.; times.len()]),
            ("gps-accuracy", "m", vec![0.6; times.len()]),
        ] {
            s.channels.push(Channel {
                gaps: vec![],
                id: id.into(),
                name: id.into(),
                unit: unit.into(),
                times: times.clone(),
                values,
            });
        }
        s
    }
    fn merged_fixture(mut recordings: Vec<Session>) -> Session {
        use crate::merging::{self, MergeInfo, MergeSource, SourceRef};
        for (i, recording) in recordings.iter_mut().enumerate() {
            recording.id = format!("recording-{i}");
            recording.recorded_at = format!("2026-10-14 {:02}:00:00", 10 + i);
        }
        let refs: Vec<_> = recordings
            .iter()
            .map(|s| SourceRef {
                session_id: s.id.clone(),
                content_version: "a".repeat(64),
            })
            .collect();
        let preview =
            merging::preview_sources(&recordings.iter().collect::<Vec<_>>(), &refs).unwrap();
        Session {
            id: "merged-fixture".into(),
            source: String::new(),
            name: String::new(),
            driver: String::new(),
            track: String::new(),
            recorded_at: preview.day.clone(),
            channels: preview.channels.iter().map(|c| c.channel.clone()).collect(),
            laps: preview.laps.iter().map(|l| l.lap.clone()).collect(),
            warnings: vec![],
            merge: Some(MergeInfo {
                preview,
                sources: recordings
                    .into_iter()
                    .zip(refs)
                    .map(|(session, reference)| MergeSource { session, reference })
                    .collect(),
            }),
        }
    }
    fn cross_recording_fixture() -> Session {
        let mut primary = session(&[20.]);
        for c in &mut primary.channels {
            for (t, value) in c.times.iter().zip(&mut c.values) {
                let theta = std::f64::consts::TAU * t / 20.;
                match c.id.as_str() {
                    "gps-latitude" => *value = 40. + (*value - 40.) * 0.5,
                    "gps-longitude" => *value = -86. + (*value + 86.) * 1.5,
                    "gps-speed" => {
                        *value *= ((1.5 * theta.sin()).powi(2) + (0.5 * theta.cos()).powi(2)).sqrt()
                    }
                    _ => (),
                }
            }
        }
        let mut supporting = primary.clone();
        // Smoothly redistribute one second to the first half while preserving
        // boundary speeds; sample at half the cadence on an independent clock.
        for channel in &mut supporting.channels {
            let raw_times = channel.times.clone();
            if channel.id == "gps-speed" {
                for (t, v) in raw_times.iter().zip(&mut channel.values) {
                    *v /=
                        1.01 + std::f64::consts::PI / 20. * (std::f64::consts::TAU * t / 20.).sin();
                }
            }
            channel.times = raw_times
                .iter()
                .enumerate()
                .filter(|(i, _)| i % 2 == 0)
                .map(|(_, t)| 10000. + 1.01 * t + (std::f64::consts::PI * t / 20.).sin().powi(2))
                .collect();
            channel.values = channel
                .values
                .iter()
                .enumerate()
                .filter(|(i, _)| i % 2 == 0)
                .map(|(_, v)| *v)
                .collect();
        }
        supporting.laps[0].start = 10000.;
        supporting.laps[0].end = 10020.2;
        supporting.laps[0].duration = 20.2;
        merged_fixture(vec![primary, supporting])
    }
    #[test]
    fn merged_cross_recording_sections_keep_alignment_samples_and_provenance() {
        let s = cross_recording_fixture();
        let primary = &s.laps[0];
        let own = super::super::sources::analyze(&s, primary, None, None).unwrap();
        let halfway = own.primary.length.unwrap() / 2.;
        assert!(own.segments.len() >= 2);
        let mut boundaries: Vec<_> = (1..own.segments.len()).map(|i| i as f64 * 10.).collect();
        *boundaries.last_mut().unwrap() = halfway;
        let report = analyze(&s, None, Some(&boundaries)).unwrap();
        assert_eq!(report.valid_lap_count, 2);
        assert_eq!(report.best_lap_id, primary.id);
        assert!(report.laps.iter().all(|l| l.spatial_comparison));
        assert!(
            report
                .segments
                .iter()
                .any(|part| part.lap_id == s.laps[1].id),
            "{:?}",
            report.segments
        );
        assert!(report.theoretical_best_seconds.unwrap() < primary.duration - 0.5);
        let observed = report
            .opportunities
            .iter()
            .find(|o| o.reference_lap_id == s.laps[1].id && o.observed_loss_seconds.is_some())
            .unwrap();
        assert!(observed.start_time >= primary.start && observed.end_time <= primary.end);
        let reference_speed = crate::merging::qualified_channel_id("recording-1", "gps-speed");
        assert!(observed
            .evidence
            .iter()
            .any(|e| e.channel_ids.contains(&reference_speed)));
        assert!(report
            .opportunities
            .iter()
            .flat_map(|o| &o.evidence)
            .flat_map(|e| &e.channel_ids)
            .all(|id| s.channels.iter().any(|c| &c.id == id)));
        assert!(s.merge.as_ref().unwrap().sources[1].session.channels[0].times[0] >= 10000.);
    }
    #[test]
    fn merged_missing_speed_and_optional_rpm_withhold_unsupported_physics() {
        let mut s = cross_recording_fixture();
        // GPS remains compatible; the absent speed channel must never be
        // substituted from the primary recording's overlapping clock.
        s.merge.as_mut().unwrap().sources[1]
            .session
            .channels
            .retain(|c| c.id != "gps-speed");
        let report = analyze(&s, None, None).unwrap();
        assert_eq!(report.valid_lap_count, 2);
        assert!(report.laps[1].spatial_comparison);
        assert!(report
            .segments
            .iter()
            .all(|part| part.lap_id == report.best_lap_id));
        assert!(!report
            .full_lap
            .as_ref()
            .unwrap()
            .validation
            .training_lap_ids
            .contains(&s.laps[1].id));
        assert!(report.opportunities.iter().filter(|o| o.reference_lap_id == s.laps[1].id)
            .all(|o| o.gain_range.is_none() && o.modeled_gain.is_none()),
            "GPS elapsed comparisons may survive, but missing speed cannot establish a feasible replacement");
        // None of the fixtures have RPM; no fabricated RPM finding is emitted.
        assert!(report
            .opportunities
            .iter()
            .flat_map(|o| &o.evidence)
            .all(|e| e.unit != "rpm"));
        s.merge.as_mut().unwrap().sources[0]
            .session
            .channels
            .retain(|c| c.id != "gps-speed");
        let report = analyze(&s, None, None).unwrap();
        let physics = report.full_lap.as_ref().unwrap();
        assert!(physics.modeled_lap_seconds.is_none());
        assert!(physics
            .rejection_reasons
            .iter()
            .any(|reason| reason.contains("GPS speed")));
        assert!(report.simulated_profiles.is_empty());
    }
    #[test]
    fn merged_missing_channels_and_incompatible_geometry_do_not_leak_calibration() {
        let mut s = cross_recording_fixture();
        let source = &mut s.merge.as_mut().unwrap().sources[1].session;
        source.channels.retain(|c| c.id != "gps-speed");
        for c in &mut source.channels {
            if c.id == "gps-latitude" {
                for v in &mut c.values {
                    *v += 1.;
                }
            }
        }
        let report = analyze(&s, None, None).unwrap();
        assert_eq!(report.valid_lap_count, 2);
        assert!(report
            .excluded_laps
            .iter()
            .any(|l| l.lap_id == s.laps[1].id));
        let validation = &report.full_lap.as_ref().unwrap().validation;
        assert!(!validation.training_lap_ids.contains(&s.laps[1].id));
        assert!(!validation.withheld_lap_ids.contains(&s.laps[1].id));
        assert!(report
            .segments
            .iter()
            .all(|p| p.lap_id == report.best_lap_id));
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_real_recordings_offer_qualified_tradeoffs_without_claiming_subresolution_time() {
        for file in ["0361", "0362"] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "../data/yash dalal_59_PURDUE GP IN_Warm-up_a_{file}.xrk"
            ));
            let session = telemetry::parse_session(&path).unwrap();
            let report = analyze(&session, None, None).unwrap();
            let qualified: Vec<_> = report
                .opportunities
                .iter()
                .filter(|o| matches!(o.status.as_str(), "likely" | "investigate"))
                .collect();
            assert!(
                !qualified.is_empty(),
                "{file}: supporting speed shapes should produce qualified experiments"
            );
            let rank = |status: &str| match status {
                "proven" => 2,
                "likely" => 1,
                _ => 0,
            };
            assert!(
                report.opportunities.windows(2).all(|w| (
                    w[0].gain_range.is_some(),
                    rank(&w[0].status)
                ) >= (
                    w[1].gain_range.is_some(),
                    rank(&w[1].status)
                )),
                "quantifiable scenarios lead, then strongest confidence tier"
            );
            assert!(qualified.iter().all(|o| o.observed_loss_seconds.is_none()
                && o.estimated_gain_seconds.is_none()
                && o.lap_id == report.best_lap_id));
            assert!(
                qualified
                    .iter()
                    .any(|o| o.reference_lap_id != report.best_lap_id),
                "{file}: use supporting lap evidence below the time-resolution gate"
            );
        }
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_fastest_lap_alone_can_offer_an_apex_recovery_experiment() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut session = telemetry::parse_session(&path).unwrap();
        let fastest = session
            .laps
            .iter()
            .filter(|l| valid(l))
            .min_by(|a, b| a.duration.total_cmp(&b.duration))
            .unwrap()
            .id
            .clone();
        session.laps.retain(|l| l.id == fastest);
        let report = analyze(&session, None, None).unwrap();
        let recovery = report
            .opportunities
            .iter()
            .find(|o| o.kind == "apex-recovery")
            .expect("sustained minimum-speed phase can inform a qualified exit experiment");
        assert_eq!(recovery.status, "investigate");
        assert!(
            recovery.observed_loss_seconds.is_none() && recovery.estimated_gain_seconds.is_none()
        );
        assert!(recovery.uncertainty.contains("normal braking"));
    }
    #[test]
    fn noisy_calculated_gear_is_documented_without_shift_diagnosis() {
        let mut s = session(&[20., 22.]);
        let times = s.channels[0].times.clone();
        s.channels.push(Channel {
            id: "calculated-gear".into(),
            name: "Calculated Gear".into(),
            unit: "".into(),
            values: times
                .iter()
                .enumerate()
                .map(|(i, _)| if i % 2 == 0 { 2. } else { 3. })
                .collect(),
            times: times.clone(),
            gaps: vec![],
        });
        s.channels.push(Channel {
            id: "rpm".into(),
            name: "RPM".into(),
            unit: "rpm".into(),
            values: vec![10000.; times.len()],
            times,
            gaps: vec![],
        });
        let report = analyze(&s, None, None).unwrap();
        assert!(!report
            .opportunities
            .iter()
            .any(|o| o.kind.contains("shift")));
        assert!(report
            .notes
            .iter()
            .any(|n| n.contains("Calculated gear") && n.contains("150 ms")));
    }
    #[test]
    fn supporting_exit_tradeoff_is_not_merely_a_faster_entry() {
        let s = session(&[20., 22.]);
        let best = &s.laps[0];
        let other = &s.laps[1];
        let base = telemetry::analyze(&s, &best.id, None, "time", &[]).unwrap();
        let mut comparison =
            telemetry::analyze(&s, &best.id, Some(&other.id), "time", &[]).unwrap();
        let section = &base.segments[0];
        let a = &section.primary;
        let b = comparison.segments[0].comparison.as_mut().unwrap();
        b.entry_speed = a.entry_speed.map(|x| x - 0.4);
        b.min_speed = a.min_speed.map(|x| x - 0.3);
        b.exit_speed = a.exit_speed.map(|x| x + 1.);
        b.elapsed = a.elapsed;
        let mut comparisons = vec![(other, comparison)];
        let finding = comparative_experiment(&s, &base, best, section, 0, &comparisons).unwrap();
        assert_eq!(finding.kind, "exit-tradeoff");
        assert_eq!(finding.status, "investigate");
        assert!(
            finding.observed_loss_seconds.is_none() && finding.estimated_gain_seconds.is_none()
        );
        assert_eq!(
            finding.faster_example_count, 0,
            "a speed example is not a timed faster example"
        );
        comparisons[0].1.segments[0]
            .comparison
            .as_mut()
            .unwrap()
            .entry_speed = a.entry_speed.map(|x| x + 2.);
        assert!(comparative_experiment(&s, &base, best, section, 0, &comparisons).is_none());
    }
    #[test]
    fn normal_deceleration_and_immediate_apex_recovery_do_not_imply_inefficiency() {
        let s = session(&[20.]);
        let base = telemetry::analyze(&s, "lap-0", None, "time", &[]).unwrap();
        let section = &base.segments[0];
        let normal_braking: Vec<_> = (0..=30)
            .map(|i| (i as f64 * 0.1, 20. - i as f64 * 0.2))
            .collect();
        assert!(
            apex_recovery_experiment(&s, &base, &s.laps[0], section, &normal_braking).is_none()
        );
        let ordinary_corner: Vec<_> = (0..=40)
            .map(|i| {
                let time = i as f64 * 0.1;
                (time, 10. + (time - 2.).abs() * 3.)
            })
            .collect();
        assert!(
            apex_recovery_experiment(&s, &base, &s.laps[0], section, &ordinary_corner).is_none()
        );
    }
    #[test]
    fn fastest_lap_is_always_target_even_with_selected_slower_reference() {
        let r = analyze(&session(&[20., 22., 21.]), Some("lap-1"), None).unwrap();
        assert_eq!(r.reference_lap_id, "lap-0");
        assert_eq!(r.opportunity_lap_id.as_deref(), Some("lap-0"));
        assert!(r.opportunities.iter().all(|o| o.lap_id == "lap-0"));
        assert_eq!(r.total_observed_opportunity_seconds, Some(0.));
    }
    #[test]
    fn slower_lap_can_supply_a_faster_section_on_best_lap() {
        let mut s = session(&[20., 22.]);
        let times = s.channels[0].times.clone();
        for c in &mut s.channels {
            if c.id == "gps-latitude" {
                for (t, v) in times.iter().zip(&mut c.values) {
                    let u = if *t <= 20. {
                        *t / 20.
                    } else {
                        (*t - 20.) / 22.
                    };
                    *v = 40. + (30. * (std::f64::consts::TAU * u).sin() / 6371000.).to_degrees();
                }
            }
            if c.id == "gps-speed" {
                for (t, v) in times.iter().zip(&mut c.values) {
                    let duration = if *t <= 20. { 20. } else { 22. };
                    let u = if *t <= 20. {
                        *t / 20.
                    } else {
                        (*t - 20.) / 22.
                    };
                    let theta = std::f64::consts::TAU * u;
                    *v = (30. * theta.cos()).hypot(60. * theta.sin()) * std::f64::consts::TAU
                        / duration;
                }
            }
        }
        // Preserve the geometry while making the second lap quicker in its first half.
        for c in &mut s.channels {
            for t in &mut c.times {
                if *t > 20. {
                    let u = (*t - 20.) / 22.;
                    *t = 20.
                        + if u <= 0.5 {
                            14. * u
                        } else {
                            7. + 30. * (u - 0.5)
                        };
                }
            }
            if c.id == "gps-speed" {
                for (t, v) in c.times.iter().zip(&mut c.values) {
                    if *t > 20. {
                        *v *= 22. / if *t <= 27. { 14. } else { 30. };
                    }
                }
            }
        }
        let r = analyze(&s, None, None).unwrap();
        let o = r
            .opportunities
            .iter()
            .find(|o| o.observed_loss_seconds.is_some())
            .expect("faster supporting section");
        assert_eq!(o.lap_id, "lap-0");
        assert_eq!(o.reference_lap_id, "lap-1");
        assert!(o.start_time >= 0. && o.end_time <= 20.);
        assert!(o.observed_loss_seconds.unwrap() > 0.5);
        assert_eq!(o.status, "proven");
        let summed: f64 = r
            .opportunities
            .iter()
            .filter_map(|o| o.observed_loss_seconds)
            .sum();
        assert!((summed - r.total_observed_opportunity_seconds.unwrap()).abs() < 1e-9);
        let theoretical = r.theoretical_best_seconds.unwrap();
        assert!(theoretical <= r.best_lap_seconds);
        assert!(
            (theoretical - r.segments.iter().map(|p| p.elapsed_seconds).sum::<f64>()).abs() < 1e-9
        );
        // These faster sections have incompatible boundary speeds: do not stitch them.
        assert!(r.segments.iter().all(|p| p.lap_id == r.best_lap_id));
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_real_xrk_best_lap_alone_keeps_screening_without_inventing_findings_or_gains() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut s = telemetry::parse_session(&path).unwrap();
        let best = s
            .laps
            .iter()
            .filter(|l| valid(l))
            .min_by(|a, b| a.duration.total_cmp(&b.duration))
            .unwrap()
            .clone();
        s.laps = vec![best.clone()];
        let r = analyze(&s, None, None).unwrap();
        assert!(
            !r.opportunities
                .iter()
                .any(|o| o.kind == "momentum-interruption"),
            "normal corner-to-corner acceleration and braking must not be called inefficient"
        );
        assert!(r.opportunities.iter().all(|o| o.lap_id == best.id
            && matches!(o.status.as_str(), "investigate" | "likely")
            && o.observed_loss_seconds.is_none()
            && o.estimated_gain_seconds.is_none()));
        assert!(r.opportunities.iter().all(|o| o.start_time >= best.start
            && o.end_time <= best.end
            && o.end_time > o.start_time));
        assert!(r
            .section_assessments
            .iter()
            .all(|p| p.start_time >= best.start && p.end_time <= best.end));
        assert_eq!(r.section_assessments.len(), r.segments.len());
        assert_eq!(r.theoretical_improvement_seconds, Some(0.));
    }
    #[test]
    fn matching_laps_have_no_opportunities() {
        let r = analyze(&session(&[20., 20., 20.]), None, None).unwrap();
        assert!(r.opportunities.is_empty());
        assert!(r.consistency.median_absolute_deviation_seconds < 1e-9);
    }
    #[test]
    fn missing_gps_and_optional_channels_withholds_spatial_claims() {
        let mut s = session(&[20., 22.]);
        s.channels.retain(|c| c.id == "gps-speed");
        let r = analyze(&s, None, None).unwrap();
        assert!(r.theoretical_best_seconds.is_none());
        assert!(r.opportunities.is_empty());
        assert!(r
            .laps
            .iter()
            .all(|l| l.total_observed_loss_seconds.is_none()));
    }
    #[test]
    fn incomplete_and_invalid_laps_never_become_reference() {
        let mut s = session(&[20., 22., 24.]);
        s.laps[0].complete = false;
        s.laps[2].duration = f64::NAN;
        let r = analyze(&s, None, None).unwrap();
        assert_eq!(r.best_lap_id, "lap-1");
        assert_eq!(r.valid_lap_count, 1);
        assert_eq!(
            analyze(&s, Some("lap-0"), None).unwrap().best_lap_id,
            "lap-1"
        );
    }
    #[test]
    fn isolated_slow_lap_does_not_distort_robust_consistency() {
        let r = analyze(&session(&[20., 20., 20., 40.]), None, None).unwrap();
        assert_eq!(r.consistency.median_seconds, 20.);
        assert_eq!(r.consistency.median_absolute_deviation_seconds, 0.);
        assert_eq!(r.consistency.range_seconds, 20.);
    }
    #[test]
    fn noisy_gps_and_sampling_mismatch_preserve_endpoint_accounting() {
        let mut s = session(&[20., 22.]);
        for c in &mut s.channels {
            let retained: Vec<_> = c
                .times
                .iter()
                .zip(&c.values)
                .enumerate()
                .filter(|(i, (t, _))| **t <= 20. || i % 2 == 0)
                .map(|(_, (&t, &v))| (t, v))
                .collect();
            c.times = retained.iter().map(|(t, _)| *t).collect();
            c.values = retained.iter().map(|(_, v)| *v).collect();
            if c.id == "gps-latitude" {
                for (i, v) in c.values.iter_mut().enumerate().skip(1) {
                    if i != 200 && i != 310 {
                        *v += (i as f64 * 1.7).sin() * 0.000001;
                    }
                }
            }
        }
        let r = analyze(&s, None, None).unwrap();
        let lap = r.laps.iter().find(|l| l.lap_id == "lap-1").unwrap();
        assert!(lap.spatial_comparison);
        assert!(lap.total_observed_loss_seconds.is_none());
        assert_eq!(r.total_observed_opportunity_seconds, Some(0.));
    }
    #[test]
    fn long_gps_outage_never_uses_normalized_distance_as_physical_evidence() {
        let mut s = session(&[20., 22.]);
        for c in &mut s.channels {
            if c.id == "gps-fix" {
                for (t, v) in c.times.iter().zip(&mut c.values) {
                    if *t > 25. && *t < 27. {
                        *v = 0.;
                    }
                }
            }
        }
        let r = analyze(&s, None, None).unwrap();
        assert!(
            !r.laps
                .iter()
                .find(|l| l.lap_id == "lap-1")
                .unwrap()
                .spatial_comparison
        );
        assert!(!r
            .opportunities
            .iter()
            .any(|o| o.lap_id == "lap-1" && o.observed_loss_seconds.is_some()));
    }
    #[test]
    fn cancellation_is_checked_before_calculation() {
        assert!(
            analyze_with_cancel(&session(&[20., 22.]), None, None, || true)
                .unwrap_err()
                .contains("cancelled")
        );
    }
    #[test]
    fn relative_low_rpm_recovery_is_candidate_without_causal_claim() {
        let mut s = session(&[20., 22.]);
        let times = s.channels[0].times.clone();
        let values = times
            .iter()
            .map(|t| if *t > 4. && *t < 6. { 6000. } else { 10000. })
            .collect();
        s.channels.push(Channel {
            gaps: vec![],
            id: "rpm".into(),
            name: "RPM".into(),
            unit: "rpm".into(),
            times,
            values,
        });
        let r = analyze(&s, None, None).unwrap();
        let o = r
            .opportunities
            .iter()
            .find(|o| o.kind == "low-rpm-recovery")
            .expect("relative recovery candidate");
        assert!(o.observation.contains("No confirmed bogging"));
        assert_eq!(o.lap_id, r.best_lap_id);
        assert!(o.observed_loss_seconds.is_none());
        assert!(o.estimated_gain_seconds.is_none());
        assert!(o
            .evidence
            .iter()
            .any(|e| e.metric == "referenceLowerQuartileRpm" && e.lap_value == 10000.));
    }
    #[test]
    fn repeated_low_rpm_is_only_a_suspected_review_without_time_gain() {
        let mut s = session(&[20., 20.]);
        let times = s.channels[0].times.clone();
        let values = times
            .iter()
            .map(|t| {
                if t % 20. > 4. && t % 20. < 6. {
                    6000.
                } else {
                    10000.
                }
            })
            .collect();
        s.channels.push(Channel {
            id: "rpm".into(),
            name: "RPM".into(),
            unit: "rpm".into(),
            times,
            values,
            gaps: vec![],
        });
        let r = analyze(&s, None, None).unwrap();
        assert!(r
            .opportunities
            .iter()
            .all(|o| o.observed_loss_seconds.is_none()
                && o.estimated_gain_seconds.is_none()
                && o.lap_id == r.best_lap_id));
    }
    fn shift_session(measured_gear: bool) -> Session {
        let mut s = session(&[20., 22.]);
        let times = s.channels[0].times.clone();
        let rpm = times
            .iter()
            .map(|t| {
                if (*t >= 4. && *t < 4.5) || (*t >= 26. && *t < 27.6) {
                    7000.
                } else {
                    10000.
                }
            })
            .collect();
        s.channels.push(Channel {
            gaps: vec![],
            id: "rpm".into(),
            name: "RPM".into(),
            unit: "rpm".into(),
            times: times.clone(),
            values: rpm,
        });
        if measured_gear {
            let gear = times
                .iter()
                .map(|t| {
                    if (*t >= 4. && *t < 20.) || *t >= 26. {
                        3.
                    } else {
                        2.
                    }
                })
                .collect();
            s.channels.push(Channel {
                gaps: vec![],
                id: "gear".into(),
                name: "Gear".into(),
                unit: "".into(),
                times,
                values: gear,
            });
        }
        s
    }
    #[test]
    fn slower_lap_shift_variation_does_not_become_a_best_lap_finding() {
        let r = analyze(&shift_session(true), None, None).unwrap();
        assert!(r.opportunities.iter().all(|o| o.lap_id == r.best_lap_id));
        assert!(!r.opportunities.iter().any(|o| o.kind == "measured-shift"));
    }
    #[test]
    fn long_rpm_interruption_without_gear_remains_unverified() {
        let mut s = shift_session(false);
        let rpm = s.channels.iter_mut().find(|c| c.unit == "rpm").unwrap();
        for (t, v) in rpm.times.iter().zip(&mut rpm.values) {
            if *t >= 4. && *t < 5.6 {
                *v = 7000.;
            }
        }
        let r = analyze(&s, None, None).unwrap();
        let o = r
            .opportunities
            .iter()
            .find(|o| o.kind == "inferred-upshift" && o.lap_id == "lap-0")
            .expect("prolonged RPM interruption");
        assert!(o.observation.contains("Possible missed/long"));
        assert!(o.observation.contains("not a confirmed missed shift"));
        assert!(o
            .evidence
            .iter()
            .any(|e| e.metric == "rpmRecovery" && e.lap_value >= 1.));
        assert!(o.observed_loss_seconds.is_none() && o.estimated_gain_seconds.is_none());
        assert_eq!(o.confidence, "low");
    }
    #[test]
    fn matching_measured_shift_locations_do_not_create_extra_findings() {
        let mut s = shift_session(true);
        let gear = s.channels.iter_mut().find(|c| c.id == "gear").unwrap();
        for (t, v) in gear.times.iter().zip(&mut gear.values) {
            if *t >= 20. {
                *v = if *t >= 24.4 { 3. } else { 2. };
            }
        }
        let r = analyze(&s, None, None).unwrap();
        assert!(!r.opportunities.iter().any(|o| o.kind == "measured-shift"));
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_recorded_sample_evidence_and_partition_are_finite() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let s = telemetry::parse_session(&path).unwrap();
        let r = analyze(&s, None, None).unwrap();
        if let Ok(path) = std::env::var("COACH_SAMPLE_REPORT") {
            std::fs::write(path, serde_json::to_vec_pretty(&r).unwrap()).unwrap();
        }
        assert!(r.valid_lap_count > 0);
        assert!(r.opportunities.iter().all(|o| o.lap_id == r.best_lap_id));
        assert_eq!(
            r.opportunity_lap_id.as_deref(),
            Some(r.best_lap_id.as_str())
        );
        assert!(
            r.segments.iter().all(|p| p.lap_id == r.best_lap_id),
            "sub-resolution fastest sectors must not create an imaginary theoretical gain"
        );
        assert!(r.best_lap_seconds.is_finite());
        for pair in r.segments.windows(2) {
            assert!((pair[0].end_meters - pair[1].start_meters).abs() < 1e-6);
        }
        for o in &r.opportunities {
            assert!(s.laps.iter().any(|l| l.id == o.lap_id));
            for e in &o.evidence {
                assert!(e.lap_value.is_finite());
                assert!(e
                    .channel_ids
                    .iter()
                    .all(|id| s.channels.iter().any(|c| c.id == *id)));
            }
        }
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_time_warped_real_xrk_detects_interior_momentum_interruption_without_faster_lap() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut s = telemetry::parse_session(&path).unwrap();
        let best = s
            .laps
            .iter()
            .filter(|l| valid(l))
            .min_by(|a, b| a.duration.total_cmp(&b.duration))
            .unwrap()
            .clone();
        s.laps = vec![best.clone()];
        // Controlled maneuver on the real recorded path: smooth time warp of ALL
        // channels, with GPS speed divided by dt_new/dt_old. This preserves the
        // position/speed relationship and leaves both lap endpoints unchanged.
        let bump = |t: f64, c: f64| {
            let x = (t - c) / 0.6;
            if x.abs() < 1. {
                0.5 * (1. + (std::f64::consts::PI * x).cos())
            } else {
                0.
            }
        };
        let integral = |t: f64, c: f64| {
            let x = t - c;
            if x <= -0.6 {
                0.
            } else if x >= 0.6 {
                0.6
            } else {
                0.5 * (x + 0.6)
                    + 0.6 / (2. * std::f64::consts::PI) * (std::f64::consts::PI * x / 0.6).sin()
            }
        };
        for channel in &mut s.channels {
            for (t, v) in channel.times.iter_mut().zip(&mut channel.values) {
                let relative = *t - best.start;
                let rate = 1. - 0.16 * bump(relative, 14.) + 0.16 * bump(relative, 14.9);
                if channel.id == "gps-speed" {
                    *v /= rate;
                }
                *t += -0.16 * integral(relative, 14.) + 0.16 * integral(relative, 14.9);
            }
        }
        let r = analyze(&s, None, None).unwrap();
        let findings: Vec<_> = r
            .opportunities
            .iter()
            .filter(|o| o.kind == "momentum-interruption")
            .collect();
        assert!(!findings.is_empty(),"a controlled, kinematically consistent interruption in an easing bend should be reviewable");
        assert!(findings.iter().all(|o| o.lap_id == best.id
            && matches!(o.status.as_str(), "investigate" | "likely")
            && o.observed_loss_seconds.is_none()
            && o.estimated_gain_seconds.is_none()));
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_second_real_xrk_always_targets_best_and_keeps_subresolution_gains_out() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0361.xrk");
        let s = telemetry::parse_session(&path).unwrap();
        let r = analyze(&s, Some("stale-saved-reference"), None).unwrap();
        assert_eq!(r.best_lap_id, "lap-8");
        assert!(r.opportunities.iter().all(|o| o.lap_id == r.best_lap_id));
        assert_eq!(r.theoretical_improvement_seconds, Some(0.));
        assert_eq!(r.section_assessments.len(), 11);
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_broken_speed_coverage_withholds_single_lap_momentum_findings() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut s = telemetry::parse_session(&path).unwrap();
        let best = s
            .laps
            .iter()
            .filter(|l| valid(l))
            .min_by(|a, b| a.duration.total_cmp(&b.duration))
            .unwrap()
            .clone();
        s.laps = vec![best.clone()];
        s.channels
            .iter_mut()
            .find(|c| c.id == "gps-speed")
            .unwrap()
            .gaps
            .push([best.start, best.end]);
        let r = analyze(&s, None, None).unwrap();
        assert!(!r
            .opportunities
            .iter()
            .any(|o| o.kind == "momentum-interruption"));
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_enhanced_best_uses_disjoint_validated_scenarios_even_without_faster_laps() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut s = telemetry::parse_session(&path).unwrap();
        let best = s
            .laps
            .iter()
            .filter(|l| valid(l))
            .min_by(|a, b| a.duration.total_cmp(&b.duration))
            .unwrap()
            .clone();
        s.laps = vec![best];
        let report = analyze(&s, None, None).unwrap();
        let json = serde_json::to_value(&report).unwrap();
        let selected = json["primaryOpportunityIds"]
            .as_array()
            .expect("automatic compatible selection");
        assert!(selected.len() <= 3);
        assert!(!selected.is_empty());
        let gain = json["improvementPotential"]
            .as_object()
            .expect("fastest-only conditional potential");
        assert!(gain["upperSeconds"].as_f64().unwrap() > 0.);
        assert!(
            json["enhancedTheoreticalBest"]["lowerSeconds"]
                .as_f64()
                .unwrap()
                < report.best_lap_seconds
        );
        let chosen: Vec<_> = report
            .opportunities
            .iter()
            .filter(|o| selected.iter().any(|id| id.as_str() == Some(&o.id)))
            .collect();
        for (i, a) in chosen.iter().enumerate() {
            for b in chosen.iter().skip(i + 1) {
                assert_ne!(a.section_id, b.section_id);
                assert!(a.end_time <= b.start_time || b.end_time <= a.start_time);
            }
        }
        let upper: f64 = report
            .enhancement_budget
            .iter()
            .map(|b| b.gain_range.upper_seconds)
            .sum();
        assert!((upper - gain["upperSeconds"].as_f64().unwrap()).abs() < 1e-9);
    }
    #[test]
    fn fastest_incompatible_source_cannot_hide_quantified_compatible_card() {
        let s = session(&[20., 22.]);
        let base = telemetry::analyze(&s, "lap-0", None, "time", &[]).unwrap();
        let mut primary = base.segments[0].primary.clone();
        primary.elapsed = 3.;
        primary.entry_speed = Some(15.);
        primary.exit_speed = Some(15.);
        let mut fastest = primary.clone();
        fastest.elapsed = 2.;
        fastest.entry_speed = Some(18.);
        let mut compatible = primary.clone();
        compatible.elapsed = 2.5;
        let sources = [&fastest, &compatible];
        let selected = preferred_support_index(&primary, &sources).unwrap();
        assert_eq!(
            selected, 1,
            "displayed card must reference the exact compatible traditional source"
        );
        assert!(boundary_compatible(&primary, sources[selected]));
        let difference = primary.elapsed - sources[selected].elapsed;
        assert_eq!(difference,0.5,"the displayed range must come from the compatible source, not the faster incompatible trajectory");
    }
    #[test]
    fn crossing_hypothesis_cannot_replace_traditional_budget() {
        let range = |lo, hi| GainRange {
            lower_seconds: lo,
            upper_seconds: hi,
            basis: "test".into(),
            assumption: String::new(),
            method: String::new(),
        };
        let measured = range(0.02, 0.18);
        assert!(
            !scenario_dominates(&range(0.04, 0.06), &measured),
            "a stronger lower bound cannot erase the demonstrated faster scenario"
        );
        assert!(
            !scenario_dominates(&range(0.01, 0.2), &measured),
            "a stronger upper bound cannot erase the conservative measured gain"
        );
        assert!(scenario_dominates(&range(0.03, 0.2), &measured));
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_full_session_preserves_local_hypotheses_and_recalibrates_physics() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let mut s = telemetry::parse_session(&path).unwrap();
        let full = analyze(&s, None, None).unwrap();
        s.laps.retain(|l| l.id == full.best_lap_id);
        let only = analyze(&s, None, None).unwrap();
        for hypothesis in only
            .opportunities
            .iter()
            .filter(|o| o.modeled_gain.is_some() && !o.id.starts_with("physics:"))
        {
            let matched = full
                .opportunities
                .iter()
                .find(|o| o.id == hypothesis.id)
                .expect("supporting evidence must not suppress a valid baseline hypothesis");
            assert_eq!(
                matched.gain_range.as_ref().unwrap().upper_seconds,
                hypothesis.gain_range.as_ref().unwrap().upper_seconds
            );
        }
        // More independent laps can lower an empirical capability estimate.
        // Never force monotonic gains merely because more data are available.
        assert!(
            full.full_lap
                .as_ref()
                .unwrap()
                .validation
                .training_lap_ids
                .len()
                > only
                    .full_lap
                    .as_ref()
                    .unwrap()
                    .validation
                    .training_lap_ids
                    .len()
        );
    }
    #[test]
    fn more_than_three_compatible_sectors_remain_in_full_lap_budget() {
        // Trusted disjoint-section input to budgeting: eight compatible measured
        // replacements, each half a second faster, with 50 ms timing uncertainty.
        let s = session(&[20., 22.]);
        let best = &s.laps[0];
        let support = &s.laps[1];
        let mut base = telemetry::analyze(&s, &best.id, None, "time", &[]).unwrap();
        let prototype = base.segments[0].clone();
        base.segments = (0..8)
            .map(|i| {
                let mut p = prototype.clone();
                p.id = format!("section-{i}");
                p.start_meters = i as f64 * 10.;
                p.end_meters = (i + 1) as f64 * 10.;
                p.primary.elapsed = 2.5;
                p
            })
            .collect();
        let mut comparison = base.clone();
        comparison.alignment.timing_uncertainty_s = Some(0.05);
        let segments: Vec<_> = base
            .segments
            .iter()
            .map(|p| BestSegment {
                section_id: p.id.clone(),
                label: p.label.clone(),
                kind: p.kind.clone(),
                start_meters: p.start_meters,
                end_meters: p.end_meters,
                lap_id: support.id.clone(),
                elapsed_seconds: 2.,
            })
            .collect();
        let budget = section_budget(&base, &segments, &[(support, comparison)], &[], best);
        assert_eq!(
            budget.len(),
            8,
            "card limit must never truncate the full-lap budget"
        );
        let low: f64 = budget.iter().map(|b| b.gain_range.lower_seconds).sum();
        let high: f64 = budget.iter().map(|b| b.gain_range.upper_seconds).sum();
        assert!((low - 3.6).abs() < 1e-9 && (high - 4.4).abs() < 1e-9);
        let traditional = segments.iter().map(|p| p.elapsed_seconds).sum::<f64>();
        assert!(best.duration - high <= traditional);
        assert!(
            best.duration - low >= traditional,
            "timing uncertainty should remain visible around the traditional point"
        );
    }
    #[test]
    fn spanning_corner_model_replaces_every_touched_measured_section() {
        let s = session(&[20., 22.]);
        let best = &s.laps[0];
        let support = &s.laps[1];
        let mut base = telemetry::analyze(&s, &best.id, None, "time", &[]).unwrap();
        let prototype = base.segments[0].clone();
        base.segments = (0..3)
            .map(|i| {
                let mut p = prototype.clone();
                p.id = format!("section-{i}");
                p.start_meters = i as f64 * 10.;
                p.end_meters = (i + 1) as f64 * 10.;
                p.primary.elapsed = 2.5;
                p
            })
            .collect();
        let mut comparison = base.clone();
        comparison.alignment.timing_uncertainty_s = Some(0.05);
        let segments: Vec<_> = base
            .segments
            .iter()
            .map(|p| BestSegment {
                section_id: p.id.clone(),
                label: p.label.clone(),
                kind: p.kind.clone(),
                start_meters: p.start_meters,
                end_meters: p.end_meters,
                lap_id: support.id.clone(),
                elapsed_seconds: 2.,
            })
            .collect();
        let range = GainRange {
            lower_seconds: 1.,
            upper_seconds: 1.2,
            basis: "hypothesis".into(),
            assumption: String::new(),
            method: String::new(),
        };
        let model = ModeledGain {
            lower_seconds: 1.,
            upper_seconds: 1.2,
            assumption: String::new(),
            method: String::new(),
            reference_lap_id: None,
        };
        let opportunity = Opportunity {
            coaching: None,
            id: "coupled".into(),
            lap_id: best.id.clone(),
            reference_lap_id: best.id.clone(),
            section_id: Some("section-0".into()),
            label: "coupled".into(),
            kind: "physics-counterfactual".into(),
            start_time: 0.,
            end_time: 10.,
            start_meters: Some(0.),
            end_meters: Some(20.),
            observed_loss_seconds: None,
            estimated_gain_seconds: None,
            modeled_gain: Some(model),
            gain_range: Some(range),
            faster_example_count: 0,
            confidence: "low".into(),
            status: "investigate".into(),
            priority_score: 1.2,
            evidence: vec![],
            observation: String::new(),
            action: String::new(),
            uncertainty: String::new(),
        };
        let mut competing = opportunity.clone();
        competing.id = "overlapping".into();
        competing.section_id = Some("section-1".into());
        competing.start_meters = Some(10.);
        competing.end_meters = Some(30.);
        let budget = section_budget(
            &base,
            &segments,
            &[(support, comparison)],
            &[opportunity, competing],
            best,
        );
        assert_eq!(
            budget.len(),
            2,
            "one coupled model plus the untouched measured section"
        );
        assert_eq!(
            budget.iter().filter(|b| b.opportunity_id.is_some()).count(),
            1,
            "competing overlapping complexes are alternatives"
        );
        assert!(budget.iter().any(|b| b.section_id == "section-2"));
        assert!(!budget.iter().any(|b| b.section_id == "section-1"));
        let total: f64 = budget.iter().map(|b| b.gain_range.upper_seconds).sum();
        assert!((total - 1.75).abs() < 1e-9);
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_real_recordings_have_a_single_integrated_full_lap_alternative() {
        for file in ["0361", "0362"] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "../data/yash dalal_59_PURDUE GP IN_Warm-up_a_{file}.xrk"
            ));
            let session = telemetry::parse_session(&path).unwrap();
            let report = analyze(&session, None, None).unwrap();
            let value = serde_json::to_value(&report).unwrap();
            let physics = &value["fullLap"];
            assert!(physics.is_object(), "full-lap diagnostics must be present");
            assert!(physics["coverageFraction"].as_f64().unwrap() > 0.99);
            assert!(
                physics["rejectionReasons"].as_array().unwrap().is_empty(),
                "{physics}"
            );
            let modeled = physics["modeledLapSeconds"]["lowerSeconds"]
                .as_f64()
                .unwrap();
            let full = report
                .simulated_profiles
                .iter()
                .find(|p| p.strategy == "full-lap")
                .unwrap();
            let best = session
                .laps
                .iter()
                .find(|l| l.id == report.best_lap_id)
                .unwrap();
            let channel = session
                .channels
                .iter()
                .find(|c| c.id == "gps-speed")
                .unwrap();
            let raw: Vec<_> = channel
                .times
                .iter()
                .copied()
                .zip(channel.values.iter().copied())
                .collect();
            let recorded_finish_speed = super::super::modeled::at(&raw, best.end).unwrap();
            assert!((full.points.last().unwrap().baseline_speed_mps-recorded_finish_speed).abs()<1e-9,
                "actual overlay must retain recorded finish speed, while optimized speeds are periodic");
            let integrated: f64 = full
                .points
                .windows(2)
                .map(|p| {
                    2. * (p[1].meters - p[0].meters)
                        / (p[0].nominal_speed_mps + p[1].nominal_speed_mps)
                })
                .sum();
            assert!((integrated - modeled).abs() < 1e-6);
            assert!(
                physics["validation"]["withheldLapIds"]
                    .as_array()
                    .unwrap()
                    .len()
                    > 0
            );
            assert_eq!(physics["validation"]["feasibilityViolations"], 0);
            assert!(report.primary_opportunity_ids.len() <= 3);
            if let Some(gain) = &report.improvement_potential {
                assert!((report.best_lap_seconds - gain.upper_seconds - modeled).abs() < 1e-6);
                assert_eq!(
                    report.enhancement_budget.len(),
                    1,
                    "global physics replaces every overlapping heuristic"
                );
            }
        }
    }
    #[test]
    #[ignore = "requires private XRKs; run npm run test:native:recordings"]
    fn private_recording_merged_real_recordings_keep_distinct_grounded_coaching_and_local_intervals() {
        let recordings = ["0361", "0362"]
            .iter()
            .map(|file| {
                let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                    "../data/yash dalal_59_PURDUE GP IN_Warm-up_a_{file}.xrk"
                ));
                telemetry::parse_session(&path).unwrap()
            })
            .collect();
        let session = merged_fixture(recordings);
        let report = analyze(&session, None, None).unwrap();
        let primary: Vec<_> = report
            .primary_opportunity_ids
            .iter()
            .map(|id| report.opportunities.iter().find(|o| &o.id == id).unwrap())
            .collect();
        assert_eq!(primary.len(), 3);
        let mut mechanisms = std::collections::HashSet::new();
        for o in primary {
            assert!(mechanisms.insert(&o.coaching.as_ref().unwrap().mechanism));
            let lap = session.laps.iter().find(|l| l.id == o.lap_id).unwrap();
            assert!(
                o.start_time >= lap.start && o.end_time <= lap.end && o.end_time > o.start_time
            );
            assert!(o.evidence.iter().all(|e| e.lap_value.is_finite()
                && e.channel_ids
                    .iter()
                    .all(|id| session.channels.iter().any(|c| &c.id == id))));
            assert!(o
                .evidence
                .iter()
                .any(|e| e.metric == "minimumSpeedLocation"));
            assert!(o.evidence.iter().any(|e| e.metric == "entryTimeGain"));
        }
    }
    #[test]
    fn report_roundtrip_preserves_evidence() {
        let r = analyze(&session(&[20., 22.]), None, None).unwrap();
        let json = serde_json::to_string(&r).unwrap();
        let decoded: CoachReport = serde_json::from_str(&json).unwrap();
        assert_eq!(
            decoded.section_assessments[0].evidence[0].lap_value,
            r.section_assessments[0].evidence[0].lap_value
        );
    }
}
