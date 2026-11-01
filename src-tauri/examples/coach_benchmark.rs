//! Offline qualitative coaching-quality suite. Compare identical workloads across model paths.
//! Build once, then run under `/usr/bin/time -l` with MODEL.gguf [cpu].
#[path = "../src/coach/runtime.rs"]
mod runtime;
use runtime::RuntimeEvidence;
use std::{
    path::Path,
    sync::{atomic::AtomicBool, Arc},
    time::Instant,
};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let path = Path::new(args.get(1).expect("model path required"));
    let cpu = args.get(2).is_some_and(|a| a == "cpu");
    let suite = [
        ("tradeoffs_and_uncertain_signals", "Fastest lap 26.585s. Requested target 25.500s. Measured nonoverlapping support 0.300s; unexplained gap 0.785s. Target feasibility and arithmetic are computed outside model. Section alpha corner feeds long straight beta. Section gamma is normal hairpin braking. Section delta has GPS-derived gear only, no measured gear. All controls absent.", vec![
            ("exit", "Likely improvement. Alpha: reference has slower entry but higher exit speed and shorter combined alpha-beta time. Investigate entry-exit compromise; do not suggest raising all speeds."),
            ("normal_braking", "Area to investigate only. Gamma: smooth speed reduction before apex and consistent acceleration after apex. No reference advantage, no anomalous deceleration. Normal braking is not evidence of wasted time."),
            ("calculated_gear", "Area to investigate only. Delta: inferred gears oscillate while raw RPM and speed remain smooth. Calculated gear unreliable. No actual shift event is established."),
            ("rpm", "Likely improvement. Alpha exit: lower RPM with slow speed recovery. Engine powerband, gear, throttle and clutch are unknown. Low RPM cannot establish engine bogging or a missed shift."),
            ("repeatable", "Measured opportunity. Beta: repeated spatially aligned faster section examples, higher entry speed from alpha exit. The section difference overlaps exit finding: do not add separate gains. Repeat exit approach and compare combined sections.")
        ], vec!["Prioritize combined exit/straight over normal braking", "Explain entry-exit compromise rather than raise every speed", "Do not assert gear changes or engine faults", "No fabricated target allocation or numerical claims", "Specific experiment and validation tied to evidence"]),
        ("counterevidence_and_limited_session", "Single valid lap. Every section examined. No aligned faster section, no defensible gain or theoretical best. Target far beyond recorded evidence. No throttle, brake, clutch or measured gear. GPS line uncertainty substantial.", vec![
            ("entry", "Area to investigate. Higher entry speed coincides with lower exit speed and slow following-straight recovery; cannot determine best compromise from single lap. Compare combined corner and straight, not minimum speed alone."),
            ("line", "Area to investigate. Apparent apex position changes within estimated GPS uncertainty; precise line differences are unresolved. Do not prescribe moving apex as established fix."),
            ("rpm", "Area to investigate. RPM and speed recover smoothly after apex without repeated RPM drops. Engine fault or shift interruption not supported. Additional measured controls needed for causal attribution.")
        ], vec!["Acknowledge insufficient evidence", "Do not invent faster reference", "No precise GPS prescription", "No fault/shift diagnosis", "Validate combined corner/straight tradeoff"])
    ];
    for (name, context, cases, criteria) in suite {
        let evidence: Vec<_> = cases
            .into_iter()
            .map(|(id, summary)| RuntimeEvidence {
                evidence_id: id.into(),
                summary: summary.into(),
            })
            .collect();
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(ms) = std::env::var("COACH_BENCH_CANCEL_MS") {
            if let Ok(ms) = ms.parse::<u64>() {
                let flag = cancel.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(ms));
                    flag.store(true, std::sync::atomic::Ordering::Relaxed);
                });
            }
        }
        let started = Instant::now();
        let result = match runtime::generate_with_context(path, &evidence, context, &cancel, cpu) {
            Ok((rows, metrics)) => {
                serde_json::json!({"schemaAndNumericBoundaryPass":true,"outputs":rows,"metrics":metrics})
            }
            Err(error) => {
                let raw = match &error {
                    runtime::RuntimeError::RejectedOutput { output, .. } => Some(output),
                    _ => None,
                };
                serde_json::json!({"schemaAndNumericBoundaryPass":false,"error":error.to_string(),"outputs":null,"rawRejectedOutput":raw})
            }
        };
        println!(
            "{}",
            serde_json::json!({"model":path,"suite":name,"inputEvidence":evidence,"sectionContext":context,"reviewCriteria":criteria,"result":result,"wallMs":started.elapsed().as_millis(),"qualityAssessment":"Requires qualitative review; schema validity alone is not a coaching quality score."})
        );
    }
}
