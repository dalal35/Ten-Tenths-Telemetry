use super::{
    analysis, runtime,
    service::{CoachResult, CoachService, Status},
};
use crate::{task, Store};
use std::time::Instant;
use tauri::{Manager, State};

#[tauri::command]
pub fn cancel_driving_coach(job_id: String, service: State<'_, CoachService>) {
    service.cancel(&job_id);
}
#[tauri::command]
pub fn driving_coach_status(service: State<'_, CoachService>) -> Status {
    service.status()
}
#[tauri::command]
pub fn driving_coach_model_terms() -> serde_json::Value {
    serde_json::json!({"version":runtime::MODEL_VERSION,"terms":include_str!("../../resources/coach/GEMMA_TERMS.txt"),"policy":include_str!("../../resources/coach/GEMMA_PROHIBITED_USE_POLICY.txt")})
}
#[tauri::command]
pub async fn analyze_driving_coach(
    job_id: String,
    session_id: String,
    reference_id: Option<String>,
    regenerate: bool,
    model_terms_accepted: bool,
    target_lap_seconds: Option<f64>,
    state: State<'_, Store>,
    service: State<'_, CoachService>,
    app: tauri::AppHandle,
) -> Result<CoachResult, String> {
    let job = service.begin(&job_id)?;
    let _ = reference_id; // Accept legacy callers; the fastest valid lap is automatic.
    let (session, version, boundaries) = task(state.inner(), move |library| {
        library.coach_input(&session_id, None)
    })
    .await?;
    if job.cancelled() {
        return Err("Cancelled".into());
    }
    let model = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/coach/model.gguf");
    let key = super::service::cache_key_for_target(
        &version,
        None,
        boundaries.as_deref(),
        model_terms_accepted,
        target_lap_seconds,
    )?;
    let key = super::service::model_state_key(&key, &model);
    let cache_started = Instant::now();
    if !regenerate {
        if let Some(mut result) = service.cached(&key) {
            // A transient native/validation failure must not suppress future inference.
            if !model_terms_accepted || result.mode == "localModel" {
                result.service_metrics.cache_lookup_us = Some(cache_started.elapsed().as_micros());
                result.service_metrics.analysis_us = Some(0);
                result.service_metrics.evidence_build_us = 0;
                result.service_metrics.interpretation_mapping_us = 0;
                return Ok(result);
            }
        }
    }
    let previous = service.cached(&key);
    let cache_lookup_us = cache_started.elapsed().as_micros();
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        job.phase("Analyzing fastest lap and supporting sections");
        let analysis_started = Instant::now();
        let reused_report = previous.is_some();
        let report = if let Some(cached) = previous {
            cached.report
        } else {
            analysis::analyze_with_cancel(&session, None, boundaries.as_deref(), || {
                job.cancelled()
            })?
        };
        let analysis_us = if reused_report {
            0
        } else {
            analysis_started.elapsed().as_micros()
        };
        let mut result = super::service::explain_for_target(
            report,
            &model,
            &job,
            model_terms_accepted,
            target_lap_seconds,
        )?;
        result.service_metrics.analysis_us = Some(analysis_us);
        result.service_metrics.cache_lookup_us = Some(cache_lookup_us);
        service.remember(key, result.clone());
        Ok(result)
    })
    .await
    .map_err(|e| format!("Coach worker failed: {e}"))?
}
