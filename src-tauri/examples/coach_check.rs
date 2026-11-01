//! Read-only real-XRK coach/UI diagnostic. No recording or application library writes.
use apex_telemetry::{
    coach::{analysis, runtime, service},
    merging, telemetry,
};
fn main() -> Result<(), String> {
    let path = std::env::args_os().nth(1).ok_or("Provide XRK path")?;
    let options: Vec<_> = std::env::args().skip(2).collect();
    if options.iter().any(|arg| {
        !matches!(
            arg.as_str(),
            "--best-only" | "--explain" | "--accept-gemma-terms"
        )
    }) {
        return Err("Options: --best-only --explain --accept-gemma-terms".into());
    }
    let mut session = telemetry::parse_session(std::path::Path::new(&path))?;
    let mut report = analysis::analyze(&session, None, None)?;
    if options.iter().any(|arg| arg == "--best-only") {
        session.laps.retain(|lap| lap.id == report.best_lap_id);
        report = analysis::analyze(&session, None, None)?;
    }
    if std::env::var_os("COACH_DIAGNOSTIC").is_some() {
        if !options.iter().any(|arg| arg == "--accept-gemma-terms") {
            return Err("Diagnostic requires --accept-gemma-terms".into());
        }
        let target = std::env::var("COACH_TARGET_SECONDS")
            .ok()
            .map(|v| v.parse::<f64>().map_err(|_| "Invalid target"))
            .transpose()?;
        let (evidence, context) = service::model_input(&report, target)?;
        let model =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/coach/model.gguf");
        let start = std::time::Instant::now();
        let result = match runtime::generate_with_context(
            &model,
            &evidence,
            &context,
            &std::sync::atomic::AtomicBool::new(false),
            false,
        ) {
            Ok((rows, metrics)) => serde_json::json!({"outputs":rows,"metrics":metrics}),
            Err(error) => {
                let raw = match &error {
                    runtime::RuntimeError::RejectedOutput { output, .. } => Some(output),
                    _ => None,
                };
                serde_json::json!({"error":error.to_string(),"rawRejectedOutput":raw})
            }
        };
        println!(
            "{}",
            serde_json::json!({"recording":path.to_string_lossy(),"targetLapSeconds":target,"inputEvidence":evidence,"context":context,"result":result,"wallMs":start.elapsed().as_millis()})
        );
        return Ok(());
    }
    let explanation = if options.iter().any(|arg| arg == "--explain") {
        if !options.iter().any(|arg| arg == "--accept-gemma-terms") {
            return Err("Local model smoke check requires explicit --accept-gemma-terms; no acceptance is persisted.".into());
        }
        let model =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/coach/model.gguf");
        let coach = service::CoachService::default();
        let job = coach.begin("real-xrk-diagnostic")?;
        let target = std::env::var("COACH_TARGET_SECONDS")
            .ok()
            .map(|value| {
                value
                    .parse::<f64>()
                    .map_err(|_| "Invalid COACH_TARGET_SECONDS")
            })
            .transpose()?;
        Some(service::explain_for_target(
            report.clone(),
            &model,
            &job,
            true,
            target,
        )?)
    } else {
        None
    };
    let channels: Vec<_> = session
        .channels
        .iter()
        .filter(|c| c.id == "gps-speed" || c.name.to_lowercase().contains("rpm"))
        .map(|c| c.id.clone())
        .collect();
    let mut analyses = serde_json::Map::new();
    for lap in session.laps.iter().filter(|l| l.complete) {
        for axis in ["distance", "time"] {
            let comparison = if lap.id == report.reference_lap_id {
                None
            } else {
                Some(report.reference_lap_id.as_str())
            };
            let view = telemetry::analyze(&session, &lap.id, comparison, axis, &channels)?;
            analyses.insert(
                format!("{}:{axis}", lap.id),
                serde_json::to_value(view).map_err(|e| e.to_string())?,
            );
        }
    }
    println!(
        "{}",
        serde_json::json!({"session":merging::descriptor(&session),"report":report,"analyses":analyses,"explanation":explanation})
    );
    Ok(())
}
