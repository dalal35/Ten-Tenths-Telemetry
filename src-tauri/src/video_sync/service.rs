use super::SyncResult;
use crate::{task, video_analysis::CancellationToken, youtube::YouTubeService, Store};
use serde::Serialize;
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
};
use tauri::{Manager, State};

pub(crate) fn validate_source(saved: &Value, identity: &Value) -> Result<(), String> {
    if saved != identity
        || !matches!(
            saved.get("type").and_then(Value::as_str),
            Some("local" | "youtube")
        )
    {
        return Err("Video source does not match the saved workspace".into());
    }
    Ok(())
}
pub(crate) fn require_authorized_path(allowed: bool) -> Result<(), String> {
    if allowed {
        Ok(())
    } else {
        Err("Local video has not been authorized for playback".into())
    }
}
pub(crate) fn resolve_local(
    identity: &Value,
    allowed: impl FnOnce(&str) -> bool,
) -> Result<PathBuf, String> {
    let path = identity
        .get("path")
        .and_then(Value::as_str)
        .ok_or("Invalid local source")?;
    let info = crate::video::inspect_local_video(std::path::Path::new(path))?;
    if info.status != "ready"
        || info.path != path
        || identity.get("size").and_then(Value::as_u64) != Some(info.size)
        || identity.get("modifiedMs").and_then(Value::as_u64) != Some(info.modified_ms)
    {
        return Err("Local video is missing or changed".into());
    }
    require_authorized_path(allowed(&info.path))?;
    Ok(PathBuf::from(info.path))
}
pub(crate) fn validate_interval(start: f64, end: f64, duration: f64) -> Result<(), String> {
    if !start.is_finite()
        || !end.is_finite()
        || !duration.is_finite()
        || start < 0.0
        || end <= start
        || end > duration
        || end - start > 14400.0
    {
        return Err("Invalid video interval; maximum analysis duration is four hours".into());
    }
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: String,
    progress: f64,
    result: Option<SyncResult>,
    error: Option<String>,
}
struct Job {
    id: String,
    status: Status,
    cancel: CancellationToken,
    active: bool,
}
#[derive(Default)]
struct ServiceState {
    job: Option<Job>,
    shutting_down: bool,
}
#[derive(Clone, Default)]
pub struct Service(Arc<(Mutex<ServiceState>, Condvar)>);
static NEXT: AtomicU64 = AtomicU64::new(1);
impl Service {
    fn start(&self) -> Result<(String, CancellationToken), String> {
        let mut slot = self.0 .0.lock().map_err(|_| "Video sync unavailable")?;
        if slot.shutting_down {
            return Err("Video sync is shutting down".into());
        }
        if slot.job.as_ref().is_some_and(|j| j.active) {
            return Err("A video sync job is already active".into());
        }
        let id = NEXT.fetch_add(1, Ordering::Relaxed).to_string();
        let cancel = CancellationToken::default();
        slot.job = Some(Job {
            id: id.clone(),
            status: Status {
                phase: "preparing".into(),
                progress: 0.0,
                result: None,
                error: None,
            },
            cancel: cancel.clone(),
            active: true,
        });
        Ok((id, cancel))
    }
    fn update(&self, id: &str, f: impl FnOnce(&mut Job)) {
        if let Ok(mut slot) = self.0 .0.lock() {
            if let Some(job) = slot.job.as_mut().filter(|j| j.id == id) {
                f(job);
            }
        }
    }
    pub fn shutdown(&self) {
        if let Ok(mut slot) = self.0 .0.lock() {
            slot.shutting_down = true;
            if let Some(job) = slot.job.as_ref() {
                job.cancel.cancel();
            }
            let _ =
                self.0
                     .1
                    .wait_timeout_while(slot, std::time::Duration::from_secs(20), |slot| {
                        slot.job.as_ref().is_some_and(|job| job.active)
                    });
        }
    }
}
pub(crate) struct Lease {
    service: YouTubeService,
    id: String,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let _ = self.service.release(&self.id);
    }
}

pub(crate) fn resolve_youtube(
    videos: &YouTubeService,
    source: &Value,
    cancel: &CancellationToken,
) -> Result<(PathBuf, Lease), String> {
    let vid = source
        .get("videoId")
        .and_then(Value::as_str)
        .ok_or("Invalid YouTube source")?;
    let cache = source.get("cache").ok_or("Cached identity is required")?;
    let asset = videos
        .resolve_cancellable(vid, cancel)?
        .ok_or("Cached video is missing")?;
    let lease = Lease {
        service: videos.clone(),
        id: asset.lease_id.clone(),
    };
    if cache.get("sha256").and_then(Value::as_str) != Some(asset.sha256.as_str())
        || cache.get("size").and_then(Value::as_u64) != Some(asset.size)
        || cache.get("durationSeconds").and_then(Value::as_f64) != Some(asset.duration_seconds)
        || cache.get("trackStartSeconds").and_then(Value::as_f64) != Some(asset.track_start_seconds)
    {
        return Err("Cached video identity changed".into());
    }
    Ok((PathBuf::from(asset.path), lease))
}

fn analyze(
    session: crate::telemetry::Session,
    comparisons: Vec<crate::library::LibraryEntry>,
    source_identity: Value,
    video_start: f64,
    video_end: f64,
    videos: YouTubeService,
    cancel: CancellationToken,
    svc: Service,
    wid: String,
    allowed: impl FnOnce(&str) -> bool,
) -> Result<SyncResult, String> {
    let mut lease = None;
    let path = match source_identity.get("type").and_then(Value::as_str) {
        Some("local") => resolve_local(&source_identity, |path| allowed(path))?,
        Some("youtube") => {
            let (path, held) = resolve_youtube(&videos, &source_identity, &cancel)?;
            lease = Some(held);
            path
        }
        _ => return Err("Invalid video source".into()),
    };
    let _lease = lease;
    let mut recordings = vec![session];
    let mut warnings = Vec::new();
    let incomplete = comparisons.len() > 31;
    for entry in comparisons.into_iter().take(31) {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let path = std::path::Path::new(&entry.source);
        let decoded: Result<crate::telemetry::Session, String> = (|| {
            if crate::library::fingerprint(path)? != entry.content_version {
                return Err("XRK content changed".into());
            }
            let mut session = crate::telemetry::parse_session(path)?;
            if crate::library::fingerprint(path)? != entry.content_version {
                return Err("XRK changed during analysis".into());
            }
            session.id = entry.id;
            session.name = entry.name.clone();
            Ok(session)
        })();
        match decoded {
            Ok(session) => recordings.push(session),
            Err(e) => warnings.push(format!("Comparison unavailable for {}: {e}", entry.name)),
        }
    }
    let mut result = super::pipeline::analyze_path(
        &path,
        &recordings,
        video_start,
        video_end,
        &cancel,
        |phase, progress| {
            svc.update(&wid, |j| {
                j.status.phase = phase.into();
                j.status.progress = progress;
            });
        },
    )?;
    if let Some(sequence) = result.sequence.as_mut() {
        sequence.comparison_incomplete |= incomplete || !warnings.is_empty();
        if sequence.comparison_incomplete {
            sequence.confidence =
                "Provisional multi-recording proposals; comparison incomplete".into();
            sequence.assignment.comparison_incomplete = true;
            for segment in &mut sequence.assignment.segments {
                segment.comparison_incomplete = true;
                if segment.status == super::assignment::AssignmentStatus::Selected {
                    segment.status = super::assignment::AssignmentStatus::Provisional;
                }
            }
        }
        sequence.warnings.extend(warnings);
        if incomplete {
            sequence.warnings.push(
                "Comparison limited to 32 imported recordings including the selected recording."
                    .into(),
            );
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn start_video_sync(
    session_id: String,
    content_version: String,
    source_identity: Value,
    video_start: f64,
    video_end: f64,
    state: State<'_, Store>,
    service: State<'_, Service>,
    videos: State<'_, YouTubeService>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    if !video_start.is_finite()
        || !video_end.is_finite()
        || video_start < 0.0
        || video_end <= video_start
        || video_end - video_start > 14400.0
    {
        return Err("Invalid video interval".into());
    }
    let service = service.inner().clone();
    let (id, cancel) = service.start()?;
    let worker_id = id.clone();
    let store = state.inner().clone();
    let videos = videos.inner().clone();
    tauri::async_runtime::spawn(async move {
        let session = task(&store, {
            let source = source_identity.clone();
            move |library| {
                let session = library.video_sync_input(&session_id, &content_version, &source)?;
                let comparisons = library.video_sync_comparisons(&session_id);
                Ok((session, comparisons))
            }
        })
        .await;
        let svc = service.clone();
        let wid = worker_id.clone();
        let outcome = match session {
            Err(e) => Err(e),
            Ok((session, comparisons)) => tauri::async_runtime::spawn_blocking(move || {
                analyze(
                    session,
                    comparisons,
                    source_identity,
                    video_start,
                    video_end,
                    videos,
                    cancel,
                    svc,
                    wid,
                    |path| app.asset_protocol_scope().is_allowed(path),
                )
            })
            .await
            .map_err(|e| format!("Video sync worker failed: {e}"))
            .and_then(|v| v),
        };
        service.update(&worker_id, |j| {
            j.active = false;
            if j.cancel.is_cancelled() {
                j.status.phase = "cancelled".into();
            } else {
                match outcome {
                    Ok(result) => {
                        j.status.phase = "complete".into();
                        j.status.progress = 1.0;
                        j.status.result = Some(result);
                    }
                    Err(e) => {
                        j.status.phase = "error".into();
                        j.status.error = Some(e);
                    }
                }
            }
        });
        service.0 .1.notify_all();
    });
    Ok(id)
}
#[tauri::command]
pub fn video_sync_status(job_id: String, service: State<'_, Service>) -> Result<Status, String> {
    let slot = service.0 .0.lock().map_err(|_| "Video sync unavailable")?;
    slot.job
        .as_ref()
        .filter(|j| j.id == job_id)
        .map(|j| j.status.clone())
        .ok_or("Unknown video sync job".into())
}
#[tauri::command]
pub fn cancel_video_sync(job_id: String, service: State<'_, Service>) -> Result<(), String> {
    let slot = service.0 .0.lock().map_err(|_| "Video sync unavailable")?;
    let job = slot
        .job
        .as_ref()
        .filter(|j| j.id == job_id)
        .ok_or("Unknown video sync job")?;
    job.cancel.cancel();
    Ok(())
}

#[cfg(test)]
mod job_tests {
    use super::*;
    #[cfg(target_os = "macos")]
    mod video_fixtures {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/support/video_fixtures.rs"
        ));
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[test]
    fn real_worker_cancels_during_sampling_without_locking_library() {
        let root = std::env::temp_dir().join(format!("sync-native-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut library = crate::library::Library::open(root.clone()).unwrap();
        let xrk = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0361.xrk");
        let session = library.import(&xrk).unwrap();
        let library = Arc::new(Mutex::new(library));
        let video = video_fixtures::fixture();
        let info = crate::video::inspect_local_video(&video).unwrap();
        let source = serde_json::json!({"type":"local","path":info.path,"size":info.size,"modifiedMs":info.modified_ms});
        let videos = YouTubeService::at(
            root.join("cache"),
            root.join("settings.json"),
            crate::youtube::Toolchain::from_directory(&root.join("tools")).unwrap(),
        )
        .unwrap();
        let service = Service::default();
        let (id, token) = service.start().unwrap();
        let worker_service = service.clone();
        let worker_token = token.clone();
        let worker_id = id.clone();
        let worker = std::thread::spawn(move || {
            analyze(
                session,
                vec![],
                source,
                0.0,
                3.0,
                videos,
                worker_token,
                worker_service,
                worker_id,
                |_| true,
            )
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let status = service
                .0
                 .0
                .lock()
                .unwrap()
                .job
                .as_ref()
                .unwrap()
                .status
                .clone();
            if status.phase == "sampling" && status.progress > 0.0 {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline && !worker.is_finished(),
                "worker ended before a decoded frame: {}",
                status.phase
            );
            std::thread::yield_now();
        }
        let mut guard = library.try_lock().unwrap();
        token.cancel();
        assert!(guard.snapshot().is_ok());
        drop(guard);
        assert!(worker.join().unwrap().is_err());
        std::fs::remove_file(video).unwrap();
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_job_blocks_another_and_shutdown_cancels_until_worker_exits() {
        let service = Service::default();
        let (id, token) = service.start().unwrap();
        assert!(service.start().is_err());
        let worker = service.clone();
        let handle = std::thread::spawn(move || {
            while !token.is_cancelled() {
                std::thread::yield_now();
            }
            worker.update(&id, |job| job.active = false);
            worker.0 .1.notify_all();
        });
        service.shutdown();
        handle.join().unwrap();
        assert!(service.start().is_err());
    }
    #[test]
    fn shutdown_rejects_new_job_after_worker_exits_while_waiting() {
        let service = Service::default();
        let (id, token) = service.start().unwrap();
        let shutting_down = service.clone();
        let handle = std::thread::spawn(move || shutting_down.shutdown());
        while !token.is_cancelled() {
            std::thread::yield_now();
        }
        service.update(&id, |job| job.active = false);
        assert!(service.start().is_err());
        service.0 .1.notify_all();
        handle.join().unwrap();
    }
}
