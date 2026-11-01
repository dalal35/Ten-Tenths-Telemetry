//! Explicit maintenance check using packaged resources, without opening the user's library.
use super::{
    analysis,
    service::{self, CoachService},
};
pub fn run(args: &[String]) -> Result<(), String> {
    if args.len() != 4 || args[3] != "--accept-gemma-terms" {
        return Err("Usage: --coach-self-check RECORDING.xrk --accept-gemma-terms".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let directory = executable
        .parent()
        .ok_or("Executable directory unavailable")?;
    #[cfg(target_os = "macos")]
    let resources = directory
        .parent()
        .ok_or("Bundle directory unavailable")?
        .join("Resources");
    #[cfg(not(target_os = "macos"))]
    let resources = directory.to_path_buf();
    let model = resources.join("resources/coach/model.gguf");
    let session = crate::telemetry::parse_session(std::path::Path::new(&args[2]))?;
    let report = analysis::analyze(&session, None, None)?;
    let service = CoachService::default();
    let job = service.begin("packaged-self-check")?;
    let result = service::explain(report, &model, &job, true)?;
    if result.mode != "localModel" && !result.report.opportunities.is_empty() {
        return Err(result
            .notice
            .unwrap_or_else(|| "Local model did not run".into()));
    }
    println!(
        "{}",
        serde_json::json!({"mode":result.mode,"modelVersion":result.model_version,"validLaps":result.report.valid_lap_count,"findings":result.report.opportunities.len(),"validatedExplanations":result.explanations.len(),"elapsedMs":result.elapsed_ms,"modelResourceFound":model.is_file()})
    );
    Ok(())
}
