use super::{
    runtime::{self, RuntimeEvidence},
    CoachReport,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Explanation {
    pub opportunity_id: String,
    pub action: String,
    pub hypothesis: Option<String>,
    pub validation: Option<String>,
    pub related_evidence_ids: Vec<String>,
    pub interpretation_id: Option<String>,
    pub reasoning_source: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMetrics {
    pub evidence_build_us: u128,
    pub interpretation_mapping_us: u128,
    /// Set by the command layer; examples may supply reports directly.
    pub analysis_us: Option<u128>,
    pub cache_lookup_us: Option<u128>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachResult {
    pub report: CoachReport,
    pub explanations: Vec<Explanation>,
    pub mode: String,
    pub model_version: String,
    pub notice: Option<String>,
    pub cached: bool,
    pub elapsed_ms: u128,
    pub target_lap_seconds: Option<f64>,
    pub inference_metrics: Option<runtime::InferenceMetrics>,
    pub service_metrics: ServiceMetrics,
}
pub fn cache_key(
    content: &str,
    reference: Option<&str>,
    boundaries: Option<&[f64]>,
    model_terms_accepted: bool,
) -> Result<String, String> {
    cache_key_for_target(content, reference, boundaries, model_terms_accepted, None)
}

pub fn cache_key_for_target(
    content: &str,
    reference: Option<&str>,
    boundaries: Option<&[f64]>,
    model_terms_accepted: bool,
    _target_lap_seconds: Option<f64>,
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(
        content,
        reference,
        boundaries,
        super::analysis::ANALYSIS_VERSION,
        runtime::MODEL_VERSION,
        runtime::MODEL_SHA256,
        runtime::REASONING_VERSION,
        model_terms_accepted,
    ))
    .map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
/// Availability and replacement of a bundled model change request identity without
/// hashing a model-sized file on every cache lookup. Cold inference still checks SHA256.
pub fn model_state_key(key: &str, model: &std::path::Path) -> String {
    let metadata = std::fs::metadata(model).ok();
    let state = metadata.as_ref().map(|m| {
        (
            m.is_file(),
            m.len(),
            m.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|t| t.as_nanos()),
        )
    });
    format!("{:x}", Sha256::digest(format!("{key}:{state:?}")))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub job_id: Option<String>,
    pub phase: String,
}
#[derive(Default)]
struct Inner {
    active: Option<(String, Arc<AtomicBool>, String)>,
    cancelled: VecDeque<String>,
    cache: HashMap<String, CoachResult>,
    cache_order: VecDeque<String>,
}
#[derive(Clone, Default)]
pub struct CoachService(Arc<Mutex<Inner>>);
pub struct Job {
    id: String,
    flag: Arc<AtomicBool>,
    service: CoachService,
}
impl Job {
    pub fn cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
    pub fn phase(&self, phase: &str) {
        if let Some((id, _, p)) = &mut self.service.0.lock().unwrap().active {
            if id == &self.id {
                *p = phase.into();
            }
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        let mut s = self.service.0.lock().unwrap();
        if s.active.as_ref().is_some_and(|a| a.0 == self.id) {
            s.active = None;
        }
    }
}
impl CoachService {
    pub fn begin(&self, id: &str) -> Result<Job, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("Invalid coach request identity".into());
        }
        let mut s = self.0.lock().map_err(|_| "Coach unavailable")?;
        if s.cancelled.iter().any(|v| v == id) {
            return Err("Cancelled".into());
        }
        if s.active.is_some() {
            return Err(
                "Another coach request is running. Cancel it before analyzing again.".into(),
            );
        }
        let flag = Arc::new(AtomicBool::new(false));
        s.active = Some((id.into(), flag.clone(), "Validating recording".into()));
        Ok(Job {
            id: id.into(),
            flag,
            service: self.clone(),
        })
    }
    pub fn cancel(&self, id: &str) {
        if id.is_empty() || id.len() > 128 {
            return;
        }
        let mut s = self.0.lock().unwrap();
        if let Some((active, flag, _)) = &s.active {
            if active == id {
                flag.store(true, Ordering::Relaxed);
            }
        }
        if s.cancelled.len() >= 32 {
            s.cancelled.pop_front();
        }
        s.cancelled.push_back(id.into());
    }
    pub fn status(&self) -> Status {
        let s = self.0.lock().unwrap();
        s.active
            .as_ref()
            .map(|(id, _, phase)| Status {
                job_id: Some(id.clone()),
                phase: phase.clone(),
            })
            .unwrap_or(Status {
                job_id: None,
                phase: "Idle".into(),
            })
    }
    pub fn cached(&self, key: &str) -> Option<CoachResult> {
        self.0.lock().unwrap().cache.get(key).cloned().map(|mut r| {
            r.cached = true;
            r
        })
    }
    pub fn remember(&self, key: String, result: CoachResult) {
        let mut s = self.0.lock().unwrap();
        s.cache_order.retain(|k| k != &key);
        s.cache_order.push_back(key.clone());
        s.cache.insert(key, result);
        while s.cache_order.len() > 4 {
            if let Some(old) = s.cache_order.pop_front() {
                s.cache.remove(&old);
            }
        }
    }
}

/// Keep model-facing references opaque and short even when a lap ID contains
/// source-qualified JSON. UI/navigation retain the original opportunity identity.
fn model_evidence_id(id: &str) -> String {
    if id.len() <= 96
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-:.".contains(&c))
    {
        id.to_owned()
    } else {
        format!("evidence-{:x}", Sha256::digest(id.as_bytes()))
    }
}

fn runtime_evidence(report: &CoachReport) -> (Vec<RuntimeEvidence>, String) {
    // Compact all section summaries, including sections without a detected opportunity.
    // Quantities remain deterministic source facts; simulation profiles are compacted separately.
    let compact_facts = |facts: &[super::types::Evidence], limit: usize| {
        facts
            .iter()
            .take(limit)
            .map(|e| {
                serde_json::json!([
                    e.metric,
                    (e.lap_value * 1000.).round() / 1000.,
                    e.reference_value.map(|v| (v * 1000.).round() / 1000.),
                    e.unit,
                    e.channel_ids
                ])
            })
            .collect::<Vec<_>>()
    };
    let mut section_context = String::new();
    let mut evidence = Vec::new();
    for (metric_limit, section_limit) in [(8, 5), (8, 3), (8, 1), (5, 1), (4, 1), (1, 0), (0, 0)] {
        section_context = serde_json::to_string(
            &report
                .section_assessments
                .iter()
                .map(|section| {
                    serde_json::json!({"section": section.section_id, "kind": section.kind,
                "facts": compact_facts(&section.evidence, section_limit)})
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
        evidence = report
            .opportunities
            .iter()
            .filter(|o| report.primary_opportunity_ids.contains(&o.id))
            .take(3)
            .map(|o| RuntimeEvidence {
                evidence_id: model_evidence_id(&o.id),
                summary: if let Some(coaching) = &o.coaching {
                    serde_json::to_string(&serde_json::json!({
                        "section":o.section_id,"coaching":coaching,
                        "facts":o.evidence.iter().take(16).map(|e| serde_json::json!([
                            e.metric,(e.lap_value*1000.).round()/1000.,e.reference_value.map(|v|(v*1000.).round()/1000.),e.unit,
                            if e.channel_ids.is_empty() { vec![] } else if e.unit=="rpm" { vec!["raw-rpm"] } else { vec!["gps-speed"] }
                        ])).collect::<Vec<_>>(),
                        "observation":o.observation.chars().take(180).collect::<String>(),
                        "limitations":"Modeled comparison; line, grip and alignment can explain gaps. Pedals and steering are unmeasured."
                    })).unwrap()
                } else { serde_json::to_string(&serde_json::json!({
                    "kind": o.kind, "status": o.status, "section": o.section_id,
                    "coaching": o.coaching,
                    "confidence": o.confidence, "fasterExamples": o.faster_example_count,
                    "gainBasis": o.gain_range.as_ref().map(|g| &g.basis),
                    "gainRangeSeconds": o.gain_range.as_ref().map(|g| [g.lower_seconds, g.upper_seconds]),
                    "assumption": o.gain_range.as_ref().map(|g| g.assumption.chars().take(160).collect::<String>()),
                    "observation": o.observation.chars().take(140).collect::<String>(),
                    "suggestedExperiment": o.action.chars().take(140).collect::<String>(),
                    "facts": compact_facts(&o.evidence, metric_limit),
                    "limitations": o.uncertainty.chars().take(140).collect::<String>()
                }))
                .unwrap() },
            })
            .collect::<Vec<_>>();
        if !evidence.is_empty()
            && report
                .opportunities
                .iter()
                .filter(|o| report.primary_opportunity_ids.contains(&o.id))
                .all(|o| o.coaching.is_some())
        {
            // Coached model_input does not use the background sections. Retain every
            // primary corner rather than discarding it against an unused budget.
            return (evidence, String::new());
        }
        // Bound the combined package, not each independently. Actual tokenizer checks
        // the remaining hard limit before native prompt evaluation.
        if section_context.len() + serde_json::to_vec(&evidence).unwrap().len() <= 8500
            && evidence
                .iter()
                .all(|e| e.summary.len() <= runtime::MAX_EVIDENCE_SUMMARY)
        {
            break;
        }
    }
    while !evidence.is_empty()
        && section_context.len() + serde_json::to_vec(&evidence).unwrap().len() > 8500
    {
        evidence.pop();
    }
    (evidence, section_context)
}

/// The model may order the deterministically selected compatible sections.
/// It cannot substitute another candidate or change the numerical improvement budget.
fn distinct_interpretations(
    rows: Vec<runtime::RuntimeExplanation>,
    report: &CoachReport,
) -> Vec<runtime::RuntimeExplanation> {
    let mut selected: Vec<runtime::RuntimeExplanation> = Vec::new();
    for mut row in rows {
        let original = |id: &str| {
            report
                .opportunities
                .iter()
                .find(|o| o.id == id || model_evidence_id(&o.id) == id)
                .map(|o| o.id.clone())
        };
        let Some(id) = original(&row.evidence_id) else {
            continue;
        };
        row.evidence_id = id;
        row.related_evidence_ids = row
            .related_evidence_ids
            .iter()
            .filter_map(|id| original(id))
            .collect();
        if !report.primary_opportunity_ids.contains(&row.evidence_id) {
            continue;
        }
        let Some(source) = report
            .opportunities
            .iter()
            .find(|o| o.id == row.evidence_id)
        else {
            continue;
        };
        if selected.iter().any(|previous| {
            let other = report
                .opportunities
                .iter()
                .find(|o| o.id == previous.evidence_id)
                .unwrap();
            (source.section_id.is_some() && source.section_id == other.section_id)
                || row.experiment.eq_ignore_ascii_case(&previous.experiment)
        }) {
            continue;
        }
        selected.push(row);
        if selected.len() == 3 {
            break;
        }
    }
    selected
}

pub fn explain(
    report: CoachReport,
    model: &std::path::Path,
    job: &Job,
    model_terms_accepted: bool,
) -> Result<CoachResult, String> {
    explain_for_target(report, model, job, model_terms_accepted, None)
}

fn objective_context(report: &CoachReport) -> String {
    serde_json::json!({
        "fastestLapSeconds": report.best_lap_seconds,
        "validLapCount": report.valid_lap_count,
        "improvementPotential": report.improvement_potential.as_ref().map(|g| serde_json::json!({"lowerSeconds":g.lower_seconds,"upperSeconds":g.upper_seconds,"basis":g.basis})),
        "enhancedTheoreticalBest": report.enhanced_theoretical_best,
        "compatibleTheoreticalImprovementSeconds": report.theoretical_improvement_seconds,
        "physicsCoverage": report.full_lap.as_ref().map(|p|p.coverage_fraction),
        "objective": "Prioritize actionable experiments from the fastest valid lap. Numerical gains and compatible improvement membership are fixed by deterministic telemetry analysis. Full-lap scenarios are coupled: section deltas share one continuous speed profile, including negative costs and downstream effects. Explain what to change, why it might help, a competing explanation and how to verify it; do not allocate or add gains.",
        "constraints": "Speed, GPS, acceleration and RPM do not establish measured braking, throttle, steering, gear or engine powerband. Consider line, entry-exit tradeoff, downstream momentum, conditions and alignment uncertainty. Hypothetical scenarios are not demonstrated driving performance."
    }).to_string()
}

/// Compact actual fastest-lap traces and competing strategies, not generated facts.
fn engineering_context(report: &CoachReport, point_count: usize) -> String {
    let rounded = |v: f64| (v * 1000.).round() / 1000.;
    let envelope = report.performance_envelope.as_ref().map(|e| serde_json::json!({
        "validLaps":e.valid_lap_count,
        "speedBandColumns":["minSpeed","maxSpeed","samples","observedAccel","observedBrake","conservativeAccel","nominalAccel","conservativeBrake","nominalBrake"],
        "speedBands":e.speed_bands.iter().map(|b| vec![rounded(b.min_speed_mps),rounded(b.max_speed_mps),b.sample_count as f64,rounded(b.observed_acceleration_mps2),rounded(b.observed_braking_mps2),rounded(b.conservative_acceleration_mps2),rounded(b.nominal_acceleration_mps2),rounded(b.conservative_braking_mps2),rounded(b.nominal_braking_mps2)]).collect::<Vec<_>>(),
        "lateralObservedConservativeNominal": [rounded(e.observed_lateral_mps2),rounded(e.conservative_lateral_mps2),rounded(e.nominal_lateral_mps2)],
        "maxObservedSpeed":rounded(e.max_observed_speed_mps),
        "rpmEvidence":e.rpm_evidence,
        "assumptions":e.assumptions.iter().take(4).map(|s|s.chars().take(180).collect::<String>()).collect::<Vec<_>>()
    }));
    let mut profiles: Vec<_> = report.simulated_profiles.iter().collect();
    profiles.sort_by(|a, b| a.nominal_seconds.total_cmp(&b.nominal_seconds));
    let mut selected = Vec::new();
    for id in &report.primary_opportunity_ids {
        if let Some(profile) = profiles.iter().find(|p| &p.opportunity_id == id) {
            selected.push(*profile);
        }
    }
    for profile in profiles {
        if !selected.iter().any(|p| std::ptr::eq(*p, profile)) {
            selected.push(profile);
        }
    }
    let profiles = selected;
    let profiles:Vec<_> = profiles.iter().take(6).map(|p| {
        let count = point_count.min(p.points.len());
        let points:Vec<_> = (0..count).map(|i| {
            let point = &p.points[i * (p.points.len()-1) / (count-1).max(1)];
            vec![rounded(point.meters),rounded(point.baseline_speed_mps),rounded(point.conservative_speed_mps),rounded(point.nominal_speed_mps),(point.curvature_per_meter * 1_000_000.).round() / 1_000_000.]
        }).collect();
        serde_json::json!({"evidenceId":p.opportunity_id,"strategy":p.strategy,
            "intervalMeters":[rounded(p.start_meters),rounded(p.end_meters)],
            "elapsedBaselineRecordedConservativeNominal":[rounded(p.baseline_seconds),rounded(p.recorded_seconds),rounded(p.conservative_seconds),rounded(p.nominal_seconds)],
            "pointColumns":["meters","baselineSpeed","conservativeSpeed","nominalSpeed","curvature"],"points":points,
            "assumptions":p.assumptions.iter().take(2).collect::<Vec<_>>()})
    }).collect();
    let full_lap = report.full_lap.as_ref().map(|p| {
        serde_json::json!({
            "coverage": rounded(p.coverage_fraction),
            "modeledLapSeconds":p.modeled_lap_seconds,
            "rejections":p.rejection_reasons,
            "withheldSpeedRmseMps":p.validation.speed_rmse_mps.map(rounded),
            "withheldSectionTimeMaeSeconds":p.validation.section_time_mae_seconds.map(rounded),
            "validationTarget":p.validation.target,
            "sections":p.sections.iter().map(|s|serde_json::json!({
                "id":s.section_id,
                "baselineSeconds":rounded(s.baseline_seconds),
                "conservativeSeconds":s.conservative_seconds.map(rounded),
                "nominalSeconds":s.nominal_seconds.map(rounded),
            })).collect::<Vec<_>>(),
        })
    });
    serde_json::json!({"units":"m, m/s, m/s², s, 1/m","vehicleEnvelope":envelope,"simulatedProfiles":profiles,"fullLapPhysics":full_lap,
        "scope":"Baseline speeds are fastest-lap telemetry. Simulated strategies are alternatives, never additive at overlapping positions. Scenario sensitivity is not a confidence interval. RPM/shift causes remain unverified."}).to_string()
}

/// The same bounded package is shared by production and the offline diagnostic.
pub fn model_input(
    report: &CoachReport,
    _target: Option<f64>,
) -> Result<(Vec<RuntimeEvidence>, String), String> {
    let objective = objective_context(report);
    let (mut evidence, sections) = runtime_evidence(report);
    if !evidence.is_empty()
        && evidence.iter().all(|e| {
            serde_json::from_str::<serde_json::Value>(&e.summary)
                .ok()
                .is_some_and(|v| v.get("coaching").is_some_and(|c| c.is_object()))
        })
    {
        // Profile-derived facts and competing hypotheses already carry the relevant
        // engineering evidence. Avoid overwhelming the small offline model with all
        // unselected strategies and full-lap background traces.
        let context = serde_json::json!({
            "factsColumns":["metric","recorded","modeled","unit","sourceChannels"],
            "objective":"Choose a supported intervention or investigate calibration when evidence is ambiguous. Model values are hypothetical; controls are unmeasured.",
            "scope":"Full-lap section time includes entry costs and downstream effects. Gains are fixed; never add or rewrite them."
        }).to_string();
        if evidence
            .iter()
            .any(|e| e.summary.len() > runtime::MAX_EVIDENCE_SUMMARY)
            || context.len() + serde_json::to_vec(&evidence).unwrap().len() > 14000
        {
            return Err("Coach corner evidence exceeds local model budget".into());
        }
        return Ok((evidence, context));
    }
    let mut engineering = engineering_context(report, 5);
    if objective.len()
        + sections.len()
        + engineering.len()
        + serde_json::to_vec(&evidence).unwrap().len()
        > 13800
    {
        engineering = engineering_context(report, 2);
    }
    let mut context =
        format!("Objective: {objective}\nEngineering: {engineering}\nSections: {sections}");
    if context.len() > 12000 {
        // Retain the actual envelope and counterfactuals before background sections.
        context = format!("Objective: {objective}\nEngineering: {engineering}");
    }
    if context.len() > 12000 {
        return Err("Coach engineering context exceeds local model budget".into());
    }
    while !evidence.is_empty()
        && context.len() + serde_json::to_vec(&evidence).unwrap().len() > 14000
    {
        evidence.pop();
    }
    Ok((evidence, context))
}

pub fn explain_for_target(
    report: CoachReport,
    model: &std::path::Path,
    job: &Job,
    model_terms_accepted: bool,
    _target_lap_seconds: Option<f64>,
) -> Result<CoachResult, String> {
    let start = Instant::now();
    if job.cancelled() {
        return Err("Cancelled".into());
    }
    let mut result = CoachResult {
        report,
        explanations: vec![],
        mode: "deterministic".into(),
        model_version: runtime::MODEL_VERSION.into(),
        notice: None,
        cached: false,
        elapsed_ms: 0,
        target_lap_seconds: None,
        inference_metrics: None,
        service_metrics: ServiceMetrics {
            evidence_build_us: 0,
            interpretation_mapping_us: 0,
            analysis_us: None,
            cache_lookup_us: None,
        },
    };
    if !model_terms_accepted {
        result.notice=Some("AI analysis is inactive. Accept the bundled Gemma terms to enable offline interpretation. Showing telemetry findings and labeled engineering hypotheses.".into());
    }
    let evidence_started = Instant::now();
    let (evidence, section_context) = if model_terms_accepted {
        match model_input(&result.report, None) {
            Ok(input) => input,
            Err(error) => {
                result.notice = Some(format!(
                    "{error}. Showing computed telemetry and simulation results."
                ));
                (vec![], String::new())
            }
        }
    } else {
        (vec![], String::new())
    };
    result.service_metrics.evidence_build_us = evidence_started.elapsed().as_micros();
    if model_terms_accepted && !evidence.is_empty() {
        job.phase("Generating local explanations");
        match runtime::generate_with_context(model, &evidence, &section_context, &job.flag, false) {
            Ok((rows, metrics)) => {
                result.inference_metrics = Some(metrics);
                let mapping_started = Instant::now();
                // Preserve the model's relevance ordering; numerical confidence stays attached
                // to each source finding rather than silently overriding its judgment.
                let rows = distinct_interpretations(rows, &result.report);
                if !rows.is_empty() {
                    result.mode = "localModel".into();
                } else {
                    result.notice = Some("Local AI ran but found no validated distinct interpretation. Showing telemetry findings and labeled engineering hypotheses.".into());
                }
                result.explanations = rows
                    .into_iter()
                    .map(|r| Explanation {
                        opportunity_id: r.evidence_id,
                        action: r.experiment,
                        hypothesis: Some(r.hypothesis),
                        validation: Some(r.validation),
                        related_evidence_ids: r.related_evidence_ids,
                        reasoning_source: if r.interpretation_id.is_some() { "modelSelectedInterpretation".into() } else { "modelGeneratedProse".into() },
                        interpretation_id: r.interpretation_id,
                    })
                    .collect();
                result.service_metrics.interpretation_mapping_us = mapping_started.elapsed().as_micros();
            }
            Err(runtime::RuntimeError::Cancelled) => return Err("Cancelled".into()),
            Err(error) => {
                result.notice = Some(format!(
                "{error}. AI interpretation was unavailable; showing telemetry findings and labeled engineering hypotheses."
            ))
            }
        }
    }
    if job.cancelled() {
        return Err("Cancelled".into());
    }
    result.elapsed_ms = start.elapsed().as_millis();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn report() -> CoachReport {
        serde_json::from_value(serde_json::json!({"analysisVersion":"test","sessionId":"s","referenceLapId":"a","bestLapId":"a","bestLapSeconds":20.0,"theoreticalBestSeconds":null,"theoreticalImprovementSeconds":null,"validLapCount":1,"excludedLaps":[],"consistency":{"medianSeconds":20.0,"medianAbsoluteDeviationSeconds":0.0,"rangeSeconds":0.0,"sampleCount":1},"segments":[],"laps":[],"opportunities":[],"totalObservedOpportunitySeconds":null,"opportunityLapId":null,"notes":["Original measured facts"]})).unwrap()
    }
    #[test]
    fn model_aliases_restore_source_qualified_navigation_and_related_ids() {
        let mut r = report();
        let ids = [
            r#"physics:["recording-a","lap-7"]:segment-6"#,
            r#"physics:["recording-a","lap-7"]:segment-8"#,
        ];
        for (i, id) in ids.iter().enumerate() {
            r.opportunities.push(serde_json::from_value(serde_json::json!({
                "id":id,"lapId":"a","referenceLapId":"a","sectionId":format!("s{i}"),"label":"Exit","kind":"physics",
                "startTime":100.+i as f64,"endTime":101.+i as f64,"startMeters":0.,"endMeters":10.,"observedLossSeconds":null,
                "estimatedGainSeconds":null,"fasterExampleCount":0,"confidence":"low","status":"investigate","priorityScore":1.,
                "evidence":[],"observation":"Exit pattern","action":"Compare exit","uncertainty":"Unknown controls"
            })).unwrap());
        }
        r.primary_opportunity_ids = ids.iter().map(|id| id.to_string()).collect();
        let (input, _) = model_input(&r, None).unwrap();
        assert!(matches!(
            runtime::generate(
                std::path::Path::new("missing-alias-test.gguf"),
                &input,
                &AtomicBool::new(false),
                true
            ),
            Err(runtime::RuntimeError::MissingModel)
        ));
        let rows = vec![runtime::RuntimeExplanation {
            evidence_id: input[0].evidence_id.clone(),
            interpretation_id: None,
            hypothesis: "The exit arc may limit recovery.".into(),
            experiment: "Try opening the exit arc.".into(),
            validation: "Compare section time.".into(),
            related_evidence_ids: vec![input[1].evidence_id.clone()],
        }];
        let restored = distinct_interpretations(rows, &r);
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].evidence_id, ids[0]);
        assert_eq!(restored[0].related_evidence_ids, vec![ids[1]]);
        let source = r
            .opportunities
            .iter()
            .find(|o| o.id == restored[0].evidence_id)
            .unwrap();
        assert_eq!((source.start_time, source.end_time), (100., 101.));
    }
    #[test]
    fn model_can_rank_distinct_selected_sections_with_the_same_mechanism() {
        let mut r = report();
        let facts = serde_json::json!({"id":"a", "lapId":"a","referenceLapId":"b","sectionId":"s1","label":"Exit","kind":"exit-tradeoff","startTime":0.,"endTime":1.,"startMeters":0.,"endMeters":10.,"observedLossSeconds":null,"estimatedGainSeconds":null,"fasterExampleCount":0,"confidence":"medium","status":"likely","priorityScore":1.,"evidence":[],"observation":"Exit pattern","action":"Compare exit","uncertainty":"Unknown controls"});
        for (id, section, kind) in [
            ("a", "s1", "exit-tradeoff"),
            ("b", "s2", "exit-tradeoff"),
            ("c", "s3", "exit-tradeoff"),
        ] {
            let mut value = facts.clone();
            value["id"] = id.into();
            value["sectionId"] = section.into();
            value["kind"] = kind.into();
            r.opportunities.push(serde_json::from_value(value).unwrap());
        }
        r.primary_opportunity_ids = vec!["b".into(), "c".into()];
        let rows = ["a", "b", "c"]
            .into_iter()
            .map(|id| runtime::RuntimeExplanation {
                evidence_id: id.into(),
                hypothesis: "Exit momentum may need investigation.".into(),
                experiment: format!("Compare the {id} section approach."),
                validation: "Compare section traces.".into(),
                related_evidence_ids: vec![],
                interpretation_id: None,
            })
            .collect();
        let selected = distinct_interpretations(rows, &r);
        assert_eq!(
            selected
                .iter()
                .map(|r| r.evidence_id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "c"]
        );
    }

    #[test]
    fn model_receives_selected_scenario_assumptions_and_control_provenance() {
        let mut r = report();
        for id in ["selected", "unselected"] {
            r.opportunities.push(serde_json::from_value(serde_json::json!({
                "id":id,"lapId":"a","referenceLapId":"a","sectionId":"s1","label":"Exit","kind":"exit-tradeoff",
                "startTime":0.,"endTime":1.,"startMeters":0.,"endMeters":10.,"observedLossSeconds":null,
                "estimatedGainSeconds":null,"fasterExampleCount":0,"confidence":"medium","status":"hypothesis","priorityScore":1.,
                "evidence":[{"id":"recovery","metric":"rpmRecovery","unit":"s","lapValue":0.8,"referenceValue":null,"channelIds":["rpm"]}],
                "gainRange":{"lowerSeconds":0.03,"upperSeconds":0.08,"basis":"hypothesis","assumption":"Earlier speed recovery without sacrificing exit.","method":"bounded recovery envelope"},
                "observation":"Recovery follows the minimum speed.","action":"Test a smoother exit arc.","uncertainty":"Controls are not measured."
            })).unwrap());
        }
        r.primary_opportunity_ids = vec!["selected".into()];
        let (evidence, _) = model_input(&r, None).unwrap();
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].evidence_id, "selected");
        let candidate: serde_json::Value = serde_json::from_str(&evidence[0].summary).unwrap();
        assert_eq!(candidate["gainBasis"], "hypothesis");
        assert_eq!(
            candidate["assumption"],
            "Earlier speed recovery without sacrificing exit."
        );
        assert_eq!(candidate["facts"][0][4], serde_json::json!(["rpm"]));
        assert_eq!(candidate["fasterExamples"], 0);
        assert!(
            candidate.get("interpretations").is_none(),
            "production must permit authored reasoning rather than template selection"
        );
        assert_eq!(
            candidate["suggestedExperiment"],
            "Test a smoother exit arc."
        );
    }

    #[test]
    fn model_receives_fastest_telemetry_envelope_and_competing_simulations() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
        let session = crate::telemetry::parse_session(&path).unwrap();
        let report = super::super::analysis::analyze(&session, None, None).unwrap();
        let (evidence, context) = model_input(&report, None).unwrap();
        assert!(context.contains("factsColumns"));
        assert!(evidence.iter().all(|e| e.summary.contains("hypotheses")));
        assert!(evidence.iter().all(|e| e.summary.contains("minimumSpeed")));
        assert!(context.len() <= 12000);
        assert!(context.len() + serde_json::to_vec(&evidence).unwrap().len() <= 14000);
        assert!(evidence
            .iter()
            .all(|row| !row.summary.contains("interpretations")));
        for item in &evidence {
            let source: serde_json::Value = serde_json::from_str(&item.summary).unwrap();
            let facts = source["facts"].as_array().unwrap();
            assert!(matches!(
                runtime::generate(
                    std::path::Path::new("missing-merged-test.gguf"),
                    std::slice::from_ref(&item),
                    &AtomicBool::new(false),
                    true
                ),
                Err(runtime::RuntimeError::MissingModel)
            ));
            let original = report
                .opportunities
                .iter()
                .find(|o| model_evidence_id(&o.id) == item.evidence_id)
                .unwrap();
            for metric in ["rpmAtMinimum", "rpmAtExit", "largestRecoveryRpmFall"] {
                if original.evidence.iter().any(|f| f.metric == metric) {
                    assert!(
                        facts.iter().any(|f| f[0] == metric),
                        "missing available {metric}"
                    );
                }
            }
            for option in source["coaching"]["hypotheses"].as_array().unwrap() {
                let output = serde_json::json!([{"evidenceId":item.evidence_id,
                    "interpretationId":option["id"],"hypothesis":option["hypothesis"],
                    "experiment":option["experiment"],"validation":option["validation"],"relatedEvidenceIds":[]}]);
                assert!(
                    runtime::validate_output(&output.to_string(), &evidence).is_ok(),
                    "unusable source hypothesis: {output}"
                );
            }
        }
    }

    #[test]
    fn merged_model_input_keeps_all_corners_and_source_qualified_physics_facts() {
        use crate::{
            merging::{self, MergeInfo, MergeSource, SourceRef},
            telemetry::{self, Session},
        };
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data");
        let recordings = [
            "yash dalal_59_PURDUE GP IN_Warm-up_a_0361.xrk",
            "yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk",
        ]
        .iter()
        .map(|p| telemetry::parse_session(&root.join(p)).unwrap())
        .collect::<Vec<_>>();
        let refs = recordings
            .iter()
            .map(|s| SourceRef {
                session_id: s.id.clone(),
                content_version: "a".repeat(64),
            })
            .collect::<Vec<_>>();
        let preview =
            merging::preview_sources(&recordings.iter().collect::<Vec<_>>(), &refs).unwrap();
        let session = Session {
            id: "input-test".into(),
            source: String::new(),
            name: "Merged".into(),
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
        };
        let report = super::super::analysis::analyze(&session, None, None).unwrap();
        let (evidence, context) = model_input(&report, None).unwrap();
        assert_eq!(evidence.len(), 3);
        assert_eq!(evidence.len(), report.primary_opportunity_ids.len());
        assert!(evidence
            .iter()
            .all(|e| e.summary.len() <= runtime::MAX_EVIDENCE_SUMMARY));
        assert!(context.len() + serde_json::to_vec(&evidence).unwrap().len() <= 14000);
        for item in evidence {
            let source: serde_json::Value = serde_json::from_str(&item.summary).unwrap();
            let facts = source["facts"].as_array().unwrap();
            for metric in ["postMinimumSpeedDip"] {
                assert!(facts.iter().any(|f| f[0] == metric), "missing {metric}");
            }
            assert!(matches!(
                runtime::generate(
                    std::path::Path::new("missing-merged-test.gguf"),
                    std::slice::from_ref(&item),
                    &AtomicBool::new(false),
                    true
                ),
                Err(runtime::RuntimeError::MissingModel)
            ));
            let original = report
                .opportunities
                .iter()
                .find(|o| model_evidence_id(&o.id) == item.evidence_id)
                .unwrap();
            for metric in ["rpmAtMinimum", "rpmAtExit", "largestRecoveryRpmFall"] {
                if original.evidence.iter().any(|f| f.metric == metric) {
                    assert!(
                        facts.iter().any(|f| f[0] == metric),
                        "missing available {metric}"
                    );
                }
            }
            for option in source["coaching"]["hypotheses"].as_array().unwrap() {
                let output = serde_json::json!([{"evidenceId":item.evidence_id,"interpretationId":option["id"],"hypothesis":option["hypothesis"],"experiment":option["experiment"],"validation":option["validation"],"relatedEvidenceIds":[]}]);
                assert!(
                    runtime::validate_output(&output.to_string(), std::slice::from_ref(&item))
                        .is_ok()
                );
            }
        }
    }

    #[test]
    fn compact_engineering_context_reserves_a_trace_for_each_primary_candidate() {
        let mut r = report();
        r.primary_opportunity_ids = vec!["a".into(), "b".into(), "c".into()];
        for id in ["a", "b", "c"] {
            for strategy in ["entry", "exit", "balanced"] {
                r.simulated_profiles.push(serde_json::from_value(serde_json::json!({
                "opportunityId":id,"strategy":strategy,"startMeters":0.,"endMeters":10.,
                "baselineSeconds":1.,"recordedSeconds":1.,"conservativeSeconds":0.99,"nominalSeconds":0.98,
                "points":[],"assumptions":[]
            })).unwrap());
            }
        }
        let value: serde_json::Value = serde_json::from_str(&engineering_context(&r, 5)).unwrap();
        let profiles = value["simulatedProfiles"].as_array().unwrap();
        assert_eq!(profiles.len(), 6);
        for id in ["a", "b", "c"] {
            assert!(
                profiles.iter().any(|p| p["evidenceId"] == id),
                "missing {id} trace"
            );
        }
    }

    #[test]
    fn oversized_model_context_preserves_computed_report_with_and_without_terms() {
        let mut report = report();
        report.performance_envelope = Some(super::super::types::VehicleEnvelope {
            valid_lap_count: 1,
            speed_bands: vec![],
            observed_lateral_mps2: 8.,
            conservative_lateral_mps2: 7.,
            nominal_lateral_mps2: 8.,
            max_observed_speed_mps: 20.,
            rpm_evidence: vec!["Large engineering evidence ".repeat(1000)],
            assumptions: vec![],
        });
        assert!(model_input(&report, None).is_err());
        for accepted in [false, true] {
            let service = CoachService::default();
            let job = service.begin("oversized").unwrap();
            let result = explain(
                report.clone(),
                std::path::Path::new("missing"),
                &job,
                accepted,
            )
            .unwrap();
            assert_eq!(result.mode, "deterministic");
            assert_eq!(result.report.best_lap_seconds, report.best_lap_seconds);
            assert!(result.notice.is_some());
        }
    }

    #[test]
    fn legacy_target_cannot_change_automatic_objective_or_cache() {
        let r = report();
        assert_eq!(
            model_input(&r, Some(19.5)).unwrap().1,
            model_input(&r, None).unwrap().1
        );
        assert_eq!(
            cache_key_for_target("x", None, None, true, Some(19.5)).unwrap(),
            cache_key_for_target("x", None, None, true, None).unwrap()
        );
        let service = CoachService::default();
        let job = service.begin("legacy-target").unwrap();
        let result =
            explain_for_target(r, std::path::Path::new("missing"), &job, false, Some(18.)).unwrap();
        assert_eq!(result.target_lap_seconds, None);
    }

    #[test]
    fn compact_context_includes_every_section_without_findings() {
        let mut report = report();
        report.section_assessments = (0..11).map(|i| serde_json::from_value(serde_json::json!({
            "sectionId":format!("section-{i}"), "label":format!("Corner {i}"), "kind":"corner",
            "startTime":i as f64,"endTime":i as f64+1.,"startMeters":i as f64*10.,"endMeters":(i+1) as f64*10.,
            "evidence":[{"id":format!("speed-{i}"),"metric":"entrySpeed","unit":"m/s","lapValue":12.123456,"referenceValue":null,"channelIds":[]}],"notes":[]
        })).unwrap()).collect();
        let (findings, context) = runtime_evidence(&report);
        assert!(findings.is_empty());
        let sections: Vec<serde_json::Value> = serde_json::from_str(&context).unwrap();
        assert_eq!(sections.len(), 11);
        assert!(context.len() < 2500);
        assert!(context.contains("12.123"));
        assert!(!context.contains("12.123456"));
    }
    #[test]
    fn dense_findings_and_sections_share_a_combined_prompt_budget() {
        let mut report = report();
        let facts = (0..10).map(|i| serde_json::json!({"id":format!("fact-{i}"),"metric":format!("speed-metric-{i}"),"unit":"m/s","lapValue":12.123456,"referenceValue":13.654321,"channelIds":[]})).collect::<Vec<_>>();
        report.section_assessments = (0..11).map(|i| serde_json::from_value(serde_json::json!({
            "sectionId":format!("section-{i}"),"label":"Corner","kind":"corner","startTime":0.,"endTime":1.,"startMeters":0.,"endMeters":10.,"evidence":facts,"notes":[]
        })).unwrap()).collect();
        report.opportunities = (0..12).map(|i| serde_json::from_value(serde_json::json!({
            "id":format!("opportunity-{i}"),"lapId":"a","referenceLapId":"b","sectionId":format!("section-{}", i%11),"label":"Review exit","kind":"entry-exit-tradeoff","startTime":0.,"endTime":1.,"startMeters":0.,"endMeters":10.,"observedLossSeconds":null,"estimatedGainSeconds":null,"fasterExampleCount":0,"confidence":"medium","status":"likely","priorityScore":1.,"evidence":facts,"observation":"Measured speed pattern","action":"Compare exit approach","uncertainty":"Missing throttle, brake and measured gear. ".repeat(10)
        })).unwrap()).collect();
        report.primary_opportunity_ids = (0..3).map(|i| format!("opportunity-{i}")).collect();
        let (evidence, context) = runtime_evidence(&report);
        assert_eq!(
            serde_json::from_str::<Vec<serde_json::Value>>(&context)
                .unwrap()
                .len(),
            11
        );
        assert_eq!(evidence.len(), 3);
        assert!(context.len() + serde_json::to_vec(&evidence).unwrap().len() <= 8500);
        assert!(evidence
            .iter()
            .all(|e| e.summary.len() <= runtime::MAX_EVIDENCE_SUMMARY));
    }
    #[test]
    fn model_availability_and_replacement_invalidate_cached_reasoning() {
        let path = std::env::temp_dir().join(format!("coach-model-state-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let missing = model_state_key("request", &path);
        std::fs::write(&path, b"model").unwrap();
        let present = model_state_key("request", &path);
        assert_ne!(missing, present);
        std::fs::write(&path, b"replacement").unwrap();
        assert_ne!(present, model_state_key("request", &path));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn cache_identity_changes_with_each_analysis_input() {
        let key = cache_key("content", Some("lap"), Some(&[20., 40.]), true).unwrap();
        for alternative in [
            cache_key("changed", Some("lap"), Some(&[20., 40.]), true),
            cache_key("content", Some("other"), Some(&[20., 40.]), true),
            cache_key("content", Some("lap"), Some(&[21., 40.]), true),
            cache_key("content", Some("lap"), Some(&[20., 40.]), false),
        ] {
            assert_ne!(key, alternative.unwrap());
        }
    }
    #[test]
    fn cache_is_bounded_and_retains_validated_facts() {
        let service = CoachService::default();
        let job = service.begin("report").unwrap();
        let result = explain(report(), std::path::Path::new("missing"), &job, false).unwrap();
        assert_eq!(result.mode, "deterministic");
        assert!(result
            .notice
            .as_ref()
            .unwrap()
            .contains("AI analysis is inactive"));
        assert!(result.inference_metrics.is_none());
        for n in 0..5 {
            service.remember(n.to_string(), result.clone());
        }
        assert!(service.cached("0").is_none());
        let hit = service.cached("4").unwrap();
        assert!(hit.cached);
        assert_eq!(hit.report.notes, vec!["Original measured facts"]);
        assert_eq!(hit.report.best_lap_seconds, 20.);
    }
    #[test]
    fn cancellation_only_affects_its_job_and_drop_releases_slot() {
        let service = CoachService::default();
        let first = service.begin("first").unwrap();
        assert!(service.begin("second").is_err());
        service.cancel("second");
        assert!(!first.cancelled());
        service.cancel("first");
        assert!(first.cancelled());
        drop(first);
        assert!(service.begin("third").is_ok());
    }
    #[test]
    fn cancel_before_start_cannot_race_into_live_inference() {
        let service = CoachService::default();
        service.cancel("early");
        assert!(service.begin("early").is_err());
    }
}
