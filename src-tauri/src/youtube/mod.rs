//! Application-owned YouTube downloads. Media paths never come from downloader output.
mod cache;
mod process;
pub mod self_check;

use crate::video_analysis::{self, CancellationToken, PixelFormat, ResizeOptions};
use cache::{Cache, Entry};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};
use tauri::{Manager, State};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeAsset {
    pub video_id: String,
    pub url: String,
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
    pub sha256: String,
    pub duration_seconds: f64,
    pub track_start_seconds: f64,
    pub lease_id: String,
    pub cached: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeDownloadStatus {
    pub job_id: String,
    pub video_id: String,
    pub phase: String,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub error: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeCacheEntry {
    pub video_id: String,
    pub url: String,
    pub size: u64,
    pub last_used_ms: u64,
    pub referenced: bool,
    pub in_use: bool,
    pub issue: Option<String>,
    pub automatic_eviction_allowed: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeCacheStatus {
    pub limit_bytes: u64,
    pub used_bytes: u64,
    pub entries: Vec<YouTubeCacheEntry>,
}

#[derive(Clone)]
pub struct Toolchain {
    yt_dlp: PathBuf,
    deno: PathBuf,
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}
impl Toolchain {
    pub fn from_directory(directory: &Path) -> Result<Self, String> {
        Ok(Self::named(directory, ""))
    }
    fn named(directory: &Path, suffix: &str) -> Self {
        let path = |name: &str| {
            directory.join(format!(
                "{name}{suffix}{}",
                if cfg!(windows) { ".exe" } else { "" }
            ))
        };
        Self {
            yt_dlp: path("yt-dlp"),
            deno: path("deno"),
            ffmpeg: path("ffmpeg"),
            ffprobe: path("ffprobe"),
        }
    }
    pub fn bundled() -> Result<Self, String> {
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let adjacent = Self::named(
            executable
                .parent()
                .ok_or("Application directory unavailable")?,
            "",
        );
        if adjacent.yt_dlp.is_file() || !cfg!(debug_assertions) {
            return Ok(adjacent);
        }
        let triple = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else if cfg!(windows) && cfg!(target_arch = "x86_64") {
            "x86_64-pc-windows-msvc"
        } else {
            return Err("YouTube downloads support Apple Silicon macOS and Windows x64.".into());
        };
        Ok(Self::named(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"),
            &format!("-{triple}"),
        ))
    }
    fn verify(&self) -> Result<(), String> {
        for path in [&self.yt_dlp, &self.deno, &self.ffmpeg, &self.ffprobe] {
            cache::regular(path).map_err(|_| format!("Bundled download tools are missing or damaged ({}). Reinstall or update Ten Tenths Telemetry.", path.file_name().unwrap_or_default().to_string_lossy()))?;
        }
        Ok(())
    }
}

struct Configuration {
    cache: Cache,
    tools: Toolchain,
}
struct Job {
    status: YouTubeDownloadStatus,
    cancel: CancellationToken,
}
#[derive(Default)]
struct Jobs {
    active: Option<String>,
    entries: HashMap<String, Job>,
    order: VecDeque<String>,
    cancelled: VecDeque<String>,
    shutdown: bool,
}
#[derive(Clone, Default)]
pub struct YouTubeService {
    configuration: Arc<Mutex<Option<Configuration>>>,
    jobs: Arc<(Mutex<Jobs>, Condvar)>,
    references: Arc<Mutex<HashSet<String>>>,
}
struct JobGuard {
    jobs: Arc<(Mutex<Jobs>, Condvar)>,
    id: String,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        let (lock, wake) = &*self.jobs;
        if let Ok(mut jobs) = lock.lock() {
            if jobs.active.as_deref() == Some(&self.id) {
                jobs.active = None;
            }
            wake.notify_all();
        }
    }
}
impl YouTubeService {
    pub fn protect_refs(&self, ids: &[String]) {
        if let Ok(jobs) = self.jobs.0.lock() {
            if let Ok(mut references) = self.references.lock() {
                if jobs.active.is_none() {
                    references.clear();
                }
                references.extend(ids.iter().filter(|id| valid_id(id)).cloned());
            }
        }
    }
    fn with_protected_configuration<T>(
        &self,
        protected: &[String],
        operation: impl FnOnce(&mut Configuration, &[String]) -> Result<T, String>,
    ) -> Result<T, String> {
        // Hold reference publication through deletion; library callbacks never acquire the cache lock.
        let references = self
            .references
            .lock()
            .map_err(|_| "Video cache references unavailable")?;
        let mut protected = protected
            .iter()
            .chain(references.iter())
            .filter(|id| valid_id(id))
            .cloned()
            .collect::<Vec<_>>();
        protected.sort();
        protected.dedup();
        let mut guard = self
            .configuration
            .lock()
            .map_err(|_| "Video cache service unavailable")?;
        operation(
            guard
                .as_mut()
                .ok_or("Video cache service is not initialized")?,
            &protected,
        )
    }
    fn with_protected_cache<T>(
        &self,
        protected: &[String],
        operation: impl FnOnce(&mut Cache, &[String]) -> Result<T, String>,
    ) -> Result<T, String> {
        self.with_protected_configuration(protected, |config, protected| {
            operation(&mut config.cache, protected)
        })
    }
    pub fn at(root: PathBuf, settings: PathBuf, tools: Toolchain) -> Result<Self, String> {
        Ok(Self {
            configuration: Arc::new(Mutex::new(Some(Configuration {
                cache: Cache::open(root, settings)?,
                tools,
            }))),
            ..Self::default()
        })
    }
    fn initialize(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut guard = self
            .configuration
            .lock()
            .map_err(|_| "Video cache service unavailable")?;
        if guard.is_none() {
            let root = app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("youtube-v1");
            let settings = app
                .path()
                .app_local_data_dir()
                .map_err(|e| e.to_string())?
                .join("youtube-cache.json");
            *guard = Some(Configuration {
                cache: Cache::open(root, settings)?,
                tools: Toolchain::bundled()?,
            });
        }
        Ok(())
    }
    fn with_cache<T>(
        &self,
        operation: impl FnOnce(&mut Cache) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .configuration
            .lock()
            .map_err(|_| "Video cache service unavailable")?;
        operation(
            &mut guard
                .as_mut()
                .ok_or("Video cache service is not initialized")?
                .cache,
        )
    }
    pub fn status(&self, id: &str) -> Option<YouTubeDownloadStatus> {
        self.jobs
            .0
            .lock()
            .ok()?
            .entries
            .get(id)
            .map(|job| job.status.clone())
    }
    fn update(&self, id: &str, operation: impl FnOnce(&mut YouTubeDownloadStatus)) {
        if let Ok(mut jobs) = self.jobs.0.lock() {
            if let Some(job) = jobs.entries.get_mut(id) {
                operation(&mut job.status);
            }
        }
    }
    pub fn cancel(&self, id: &str) {
        if id.is_empty() || id.len() > 128 {
            return;
        }
        if let Ok(mut jobs) = self.jobs.0.lock() {
            if let Some(job) = jobs.entries.get_mut(id) {
                job.cancel.cancel();
                if job.status.phase != "complete" && job.status.phase != "error" {
                    job.status.phase = "cancelled".into();
                }
            } else {
                jobs.cancelled.push_back(id.into());
                while jobs.cancelled.len() > 32 {
                    jobs.cancelled.pop_front();
                }
            }
        }
    }
    pub fn shutdown(&self) {
        let (lock, wake) = &*self.jobs;
        if let Ok(mut jobs) = lock.lock() {
            jobs.shutdown = true;
            if let Some(job) = jobs.active.as_ref().and_then(|id| jobs.entries.get(id)) {
                job.cancel.cancel();
            }
            let _ = wake
                .wait_timeout_while(jobs, Duration::from_secs(20), |jobs| jobs.active.is_some());
        }
    }
    pub fn resolve(&self, id: &str) -> Result<Option<YouTubeAsset>, String> {
        self.with_cache(|cache| cache.resolve(id, &CancellationToken::default()))
    }
    pub(crate) fn resolve_cancellable(
        &self,
        id: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<YouTubeAsset>, String> {
        self.with_cache(|cache| cache.resolve(id, cancel))
    }
    pub fn release(&self, lease: &str) -> Result<(), String> {
        self.with_cache(|cache| {
            cache.release(lease);
            Ok(())
        })
    }
    pub fn cache_status(&self, protected: &[String]) -> Result<YouTubeCacheStatus, String> {
        self.with_protected_cache(protected, |cache, protected| cache.status(protected))
    }
    pub fn download(
        &self,
        url: &str,
        job_id: &str,
        protected: &[String],
    ) -> Result<YouTubeAsset, String> {
        let id = video_id(url)?;
        if job_id.is_empty()
            || job_id.len() > 128
            || !job_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err("Invalid video download request ID.".into());
        }
        let cancel = CancellationToken::default();
        {
            let mut jobs = self
                .jobs
                .0
                .lock()
                .map_err(|_| "Video job service unavailable")?;
            if jobs.shutdown {
                return Err("The video download service is shutting down.".into());
            }
            if jobs.active.is_some() {
                return Err(
                    "Another YouTube download is running. Cancel it or wait for it to finish."
                        .into(),
                );
            }
            if jobs.cancelled.iter().any(|previous| previous == job_id) {
                cancel.cancel();
                jobs.cancelled.retain(|previous| previous != job_id);
            }
            jobs.active = Some(job_id.into());
            jobs.order.retain(|previous| previous != job_id);
            jobs.order.push_back(job_id.into());
            jobs.entries.insert(
                job_id.into(),
                Job {
                    cancel: cancel.clone(),
                    status: YouTubeDownloadStatus {
                        job_id: job_id.into(),
                        video_id: id.clone(),
                        phase: "preparing".into(),
                        downloaded_bytes: None,
                        total_bytes: None,
                        speed_bytes_per_second: None,
                        eta_seconds: None,
                        error: None,
                    },
                },
            );
            while jobs.order.len() > 8 {
                if let Some(old) = jobs.order.pop_front() {
                    jobs.entries.remove(&old);
                }
            }
        }
        let _job = JobGuard {
            jobs: self.jobs.clone(),
            id: job_id.into(),
        };
        let result = self.download_inner(&id, job_id, protected, &cancel);
        self.update(job_id, |status| {
            status.phase = if result.is_ok() {
                "complete"
            } else if cancel.is_cancelled() {
                "cancelled"
            } else {
                "error"
            }
            .into();
            status.error = result.as_ref().err().cloned();
        });
        result
    }
    fn download_inner(
        &self,
        id: &str,
        job_id: &str,
        protected: &[String],
        cancel: &CancellationToken,
    ) -> Result<YouTubeAsset, String> {
        if cancel.is_cancelled() {
            return Err("Download cancelled.".into());
        }
        let existing = self.with_cache(|cache| {
            match cache.resolve(id, cancel) {
                Ok(asset) => return Ok(asset),
                Err(error) if cancel.is_cancelled() || error.contains("newer Ten Tenths") => {
                    return Err(error)
                }
                Err(_) => cache.remove(id)?,
            }
            Ok(None)
        })?;
        if let Some(asset) = existing {
            return Ok(asset);
        }
        let (stage, tools) =
            self.with_protected_configuration(protected, |config, protected| {
                config.tools.verify()?;
                config.cache.make_room(512 * 1024 * 1024, protected)?;
                Ok((config.cache.stage(id)?, config.tools.clone()))
            })?;
        let result = self.transfer(id, job_id, protected, cancel, &stage, &tools);
        if stage.exists() {
            let _ = cache::remove_owned(&stage);
        }
        result
    }
    fn transfer(
        &self,
        id: &str,
        job_id: &str,
        protected: &[String],
        cancel: &CancellationToken,
        stage: &Path,
        tools: &Toolchain,
    ) -> Result<YouTubeAsset, String> {
        let url = format!("https://www.youtube.com/watch?v={id}");
        let limit = self.with_cache(|cache| Ok(cache.limit))?;
        let mut args: Vec<OsString> = ["--ignore-config", "--no-plugin-dirs", "--no-exec", "--no-remote-components", "--no-update", "--no-cache-dir", "--no-playlist", "--no-mtime", "--no-overwrites", "--abort-on-unavailable-fragments", "--newline", "--progress", "--output-na-placeholder", "null", "--progress-delta", "0.25", "--socket-timeout", "20", "--retries", "3", "--fragment-retries", "3", "--match-filter", "!is_live & duration > 0", "--format", "bv[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[height<=1080][ext=mp4][vcodec^=avc1][acodec^=mp4a]", "--merge-output-format", "mp4", "--remux-video", "mp4", "--progress-template", "download:TTT_PROGRESS:{\"downloaded_bytes\":%(progress.downloaded_bytes)j,\"total_bytes\":%(progress.total_bytes)j,\"total_bytes_estimate\":%(progress.total_bytes_estimate)j,\"speed\":%(progress.speed)j,\"eta\":%(progress.eta)j}", "--progress-template", "postprocess:TTT_POST:%(progress.status)s", "--output", "source.%(ext)s", "--max-filesize"].into_iter().map(OsString::from).collect();
        args.push(OsString::from((limit / 2).to_string()));
        args.push("--js-runtimes".into());
        let mut runtime = OsString::from("deno:");
        runtime.push(&tools.deno);
        args.push(runtime);
        args.push("--ffmpeg-location".into());
        args.push(tools.ffmpeg.as_os_str().into());
        args.push("--".into());
        args.push(url.clone().into());
        self.update(job_id, |status| status.phase = "downloading".into());
        process::run(
            &tools.yt_dlp,
            &args,
            stage,
            cancel,
            Duration::from_secs(6 * 60 * 60),
            || {
                let stage_size = cache::bytes(stage)?;
                let merging = self
                    .status(job_id)
                    .is_some_and(|status| status.phase == "merging");
                self.with_protected_cache(protected, |cache, protected| {
                    cache.make_room(if merging { 0 } else { stage_size }, protected)
                })
            },
            |line, _| {
                if let Some(json) = line.strip_prefix("TTT_PROGRESS:") {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
                        self.update(job_id, |status| apply_progress(status, &value));
                    }
                } else if line.starts_with("TTT_POST:") || line.contains("[Merger]") {
                    self.update(job_id, |status| status.phase = "merging".into());
                }
            },
        )?;
        if cancel.is_cancelled() {
            return Err("Download cancelled.".into());
        }
        let source = stage.join("source.mp4");
        let source_size = cache::regular(&source).map_err(|_| "No compatible completed MP4 was produced. This video may be live, restricted, or unavailable in H.264/AAC. Try another authorized video.".to_string())?.len();
        self.with_protected_cache(protected, |cache, protected| {
            cache.make_room(source_size.saturating_add(65536), protected)
        })?;
        self.update(job_id, |status| status.phase = "merging".into());
        let media = stage.join("media.mp4");
        process::run(
            &tools.ffmpeg,
            &playback_remux_args(&source, &media),
            stage,
            cancel,
            Duration::from_secs(6 * 60 * 60),
            || {
                self.with_protected_cache(protected, |cache, protected| {
                    cache.make_room(0, protected)
                })
            },
            |_, _| {},
        )?;
        self.update(job_id, |status| status.phase = "validating".into());
        let size = cache::regular(&media).map_err(|_| "No compatible completed MP4 was produced. This video may be live, restricted, or unavailable in H.264/AAC. Try another authorized video.".to_string())?.len();
        if size == 0 {
            return Err("The download produced an empty video. Retry the download.".into());
        }
        let probe = process::run(
            &tools.ffprobe,
            &[
                "-v".into(),
                "error".into(),
                "-show_entries".into(),
                "stream=codec_type,codec_name,time_base,start_time:format=duration".into(),
                "-of".into(),
                "json".into(),
                media.as_os_str().into(),
            ],
            stage,
            cancel,
            Duration::from_secs(60),
            || Ok(()),
            |_, _| {},
        )?;
        validate_probe(&probe.stdout)?;
        let metadata = video_analysis::inspect(&media, cancel)
            .map_err(|e| format!("The downloaded video cannot be decoded: {e}"))?;
        let first = video_analysis::extract_frame(
            &media,
            0.0,
            ResizeOptions {
                max_width: 64,
                max_height: 64,
            },
            PixelFormat::Gray8,
            cancel,
        )
        .map_err(|e| format!("The downloaded video has no decodable first frame: {e}"))?;
        if !metadata.duration_seconds.is_finite()
            || metadata.duration_seconds <= 0.0
            || !first.timestamp_seconds.is_finite()
        {
            return Err("The downloaded video has invalid media timestamps.".into());
        }
        let sha256 = cache::hash_file(&media, cancel)?;
        let tool_versions = tool_versions(tools, stage, cancel)?;
        let entry = Entry {
            version: 1,
            playback_profile: cache::PLAYBACK_PROFILE.into(),
            video_id: id.into(),
            url,
            size,
            sha256,
            duration_seconds: metadata.duration_seconds,
            track_start_seconds: metadata.track_start_seconds,
            timebase_timescale: metadata.timebase_timescale,
            last_used_ms: cache::now(),
            tool_versions,
        };
        for file in fs::read_dir(stage).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            if file.file_name() != "media.mp4" {
                cache::regular(&file.path())?;
                fs::remove_file(file.path()).map_err(|e| e.to_string())?;
            }
        }
        self.with_protected_cache(protected, |cache, protected| {
            if cancel.is_cancelled() {
                return Err("Download cancelled.".into());
            }
            cache.make_room(65536, protected)?;
            cache.publish(id, stage, &entry)?;
            let mut asset = cache
                .resolve(id, cancel)?
                .ok_or("Completed download is missing")?;
            asset.cached = false;
            Ok(asset)
        })
    }
}

fn playback_remux_args(source: &Path, media: &Path) -> Vec<OsString> {
    // One-second chunks keep long-video MP4 indexes usable by WKWebView's asset loader.
    let mut args: Vec<OsString> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-copyts",
        "-i",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    args.push(source.as_os_str().into());
    args.extend(
        [
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c",
            "copy",
            "-chunk_duration",
            "1000000",
            "-movflags",
            "+faststart",
        ]
        .into_iter()
        .map(OsString::from),
    );
    args.push(media.as_os_str().into());
    args
}

fn apply_progress(status: &mut YouTubeDownloadStatus, value: &serde_json::Value) {
    let finite = |key: &str| {
        value[key]
            .as_f64()
            .filter(|value| value.is_finite() && *value >= 0.0)
    };
    status.downloaded_bytes = value["downloaded_bytes"].as_u64();
    status.total_bytes = value["total_bytes"]
        .as_u64()
        .or_else(|| value["total_bytes_estimate"].as_u64());
    status.speed_bytes_per_second = finite("speed");
    status.eta_seconds = finite("eta");
}
fn validate_probe(input: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(input)
        .map_err(|_| "The downloaded video has damaged media metadata.".to_string())?;
    let streams = value["streams"]
        .as_array()
        .ok_or("The downloaded video has no streams.")?;
    if !streams
        .iter()
        .any(|stream| stream["codec_type"] == "video" && stream["codec_name"] == "h264")
        || streams
            .iter()
            .any(|stream| stream["codec_type"] == "audio" && stream["codec_name"] != "aac")
    {
        return Err(
            "The downloaded video does not contain playback-compatible H.264/AAC streams.".into(),
        );
    }
    Ok(())
}
fn tool_versions(
    tools: &Toolchain,
    cwd: &Path,
    cancel: &CancellationToken,
) -> Result<serde_json::Value, String> {
    let mut values = serde_json::Map::new();
    for (name, tool, argument) in [
        ("ytDlp", &tools.yt_dlp, "--version"),
        ("deno", &tools.deno, "--version"),
        ("ffmpeg", &tools.ffmpeg, "-version"),
    ] {
        let output = process::run(
            tool,
            &[argument.into()],
            cwd,
            cancel,
            Duration::from_secs(30),
            || Ok(()),
            |_, _| {},
        )?;
        values.insert(
            name.into(),
            serde_json::Value::String(
                output
                    .stdout
                    .lines()
                    .next()
                    .unwrap_or("unknown")
                    .chars()
                    .take(256)
                    .collect(),
            ),
        );
    }
    Ok(values.into())
}

async fn protected_ids(
    store: &crate::Store,
    service: &YouTubeService,
) -> Result<Vec<String>, String> {
    let service = service.clone();
    crate::task(store, move |library| {
        let ids = library.youtube_video_ids();
        service.protect_refs(&ids);
        Ok(ids)
    })
    .await
}
fn authorize(app: &tauri::AppHandle, asset: &YouTubeAsset) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(Path::new(&asset.path))
        .map_err(|e| format!("Cannot authorize cached video playback: {e}"))
}

#[tauri::command]
pub async fn download_youtube_video(
    url: String,
    job_id: String,
    app: tauri::AppHandle,
    service: State<'_, YouTubeService>,
    state: State<'_, crate::Store>,
) -> Result<YouTubeAsset, String> {
    let protected = protected_ids(state.inner(), &service).await?;
    let service = service.inner().clone();
    let auth_app = app.clone();
    let asset = tauri::async_runtime::spawn_blocking(move || {
        service.initialize(&app)?;
        service.download(&url, &job_id, &protected)
    })
    .await
    .map_err(|e| format!("Video download worker failed: {e}"))??;
    if let Err(error) = authorize(&auth_app, &asset) {
        let _ = service_release(&auth_app, &asset.lease_id);
        return Err(error);
    }
    Ok(asset)
}
fn service_release(app: &tauri::AppHandle, lease: &str) -> Result<(), String> {
    app.state::<YouTubeService>().release(lease)
}
#[tauri::command]
pub async fn resolve_cached_youtube_video(
    video_id: String,
    app: tauri::AppHandle,
    service: State<'_, YouTubeService>,
) -> Result<Option<YouTubeAsset>, String> {
    let service = service.inner().clone();
    let auth_app = app.clone();
    let asset = tauri::async_runtime::spawn_blocking(move || {
        service.initialize(&app)?;
        service.resolve(&video_id)
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Some(asset) = &asset {
        if let Err(error) = authorize(&auth_app, asset) {
            let _ = service_release(&auth_app, &asset.lease_id);
            return Err(error);
        }
    }
    Ok(asset)
}
#[tauri::command]
pub fn youtube_download_status(
    job_id: String,
    service: State<'_, YouTubeService>,
) -> Option<YouTubeDownloadStatus> {
    service.status(&job_id)
}
#[tauri::command]
pub fn cancel_youtube_download(job_id: String, service: State<'_, YouTubeService>) {
    service.cancel(&job_id);
}
#[tauri::command]
pub async fn release_youtube_video(
    lease_id: String,
    service: State<'_, YouTubeService>,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.release(&lease_id))
        .await
        .map_err(|e| e.to_string())?
}
async fn cache_operation(
    app: tauri::AppHandle,
    service: &YouTubeService,
    store: &crate::Store,
    operation: impl FnOnce(&mut Cache, &[String]) -> Result<(), String> + Send + 'static,
) -> Result<YouTubeCacheStatus, String> {
    let protected = protected_ids(store, service).await?;
    let service = service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.initialize(&app)?;
        service.with_protected_cache(&protected, |cache, protected| {
            operation(cache, protected)?;
            cache.status(protected)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn youtube_cache_status(
    app: tauri::AppHandle,
    service: State<'_, YouTubeService>,
    state: State<'_, crate::Store>,
) -> Result<YouTubeCacheStatus, String> {
    cache_operation(app, &service, state.inner(), |_, _| Ok(())).await
}
#[tauri::command]
pub async fn set_youtube_cache_limit(
    limit_bytes: u64,
    app: tauri::AppHandle,
    service: State<'_, YouTubeService>,
    state: State<'_, crate::Store>,
) -> Result<YouTubeCacheStatus, String> {
    cache_operation(app, &service, state.inner(), move |cache, protected| {
        cache.set_limit(limit_bytes)?;
        cache.make_room(0, protected)
    })
    .await
}
#[tauri::command]
pub async fn clean_youtube_cache(
    app: tauri::AppHandle,
    service: State<'_, YouTubeService>,
    state: State<'_, crate::Store>,
) -> Result<YouTubeCacheStatus, String> {
    cache_operation(app, &service, state.inner(), |cache, protected| {
        cache.clean(protected)
    })
    .await
}
#[tauri::command]
pub async fn remove_youtube_cache_entry(
    video_id: String,
    app: tauri::AppHandle,
    service: State<'_, YouTubeService>,
    state: State<'_, crate::Store>,
) -> Result<YouTubeCacheStatus, String> {
    cache_operation(app, &service, state.inner(), move |cache, _| {
        cache.remove(&video_id)
    })
    .await
}

pub fn video_id(input: &str) -> Result<String, String> {
    let invalid = || "Enter a supported YouTube watch, share, shorts or embed URL.".to_string();
    if input.len() > 2048 {
        return Err(invalid());
    }
    let url = url::Url::parse(input.trim()).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(invalid());
    }
    let path: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    let id = match url.host_str().unwrap_or("") {
        "youtu.be" if path.len() == 2 => Some(path[1].to_string()),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" if url.path() == "/watch" => {
            let ids: Vec<_> = url.query_pairs().filter(|(key, _)| key == "v").collect();
            (ids.len() == 1).then(|| ids[0].1.to_string())
        }
        "youtube.com" | "www.youtube.com" | "m.youtube.com"
            if path.len() == 3 && matches!(path[1], "shorts" | "embed") =>
        {
            Some(path[2].to_string())
        }
        "youtube-nocookie.com" | "www.youtube-nocookie.com"
            if path.len() == 3 && path[1] == "embed" =>
        {
            Some(path[2].to_string())
        }
        _ => None,
    }
    .ok_or_else(invalid)?;
    if valid_id(&id) {
        Ok(id)
    } else {
        Err(invalid())
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_saved_after_a_job_snapshot_still_block_cleanup() {
        let root = std::env::temp_dir().join(format!("ttt-youtube-ref-race-{}", cache::nonce()));
        let service = YouTubeService::at(
            root.join("cache"),
            root.join("settings.json"),
            Toolchain::from_directory(&root.join("missing-tools")).unwrap(),
        )
        .unwrap();
        let stage = service
            .with_cache(|cache| cache.stage("TySa_fqgccc"))
            .unwrap();
        fs::write(stage.join("media.mp4"), b"media").unwrap();
        let entry = Entry {
            version: 1,
            playback_profile: cache::PLAYBACK_PROFILE.into(),
            video_id: "TySa_fqgccc".into(),
            url: "https://www.youtube.com/watch?v=TySa_fqgccc".into(),
            size: 5,
            sha256: cache::hash_file(&stage.join("media.mp4"), &Default::default()).unwrap(),
            duration_seconds: 1.0,
            track_start_seconds: 0.0,
            timebase_timescale: 30,
            last_used_ms: 1,
            tool_versions: serde_json::json!({}),
        };
        service
            .with_cache(|cache| cache.publish("TySa_fqgccc", &stage, &entry))
            .unwrap();
        service.jobs.0.lock().unwrap().active = Some("other-job".into());
        service.protect_refs(&["TySa_fqgccc".into()]);
        service.protect_refs(&[]);
        assert!(service.cache_status(&[]).unwrap().entries[0].referenced);
        service
            .with_protected_cache(&[], |cache, protected| cache.clean(protected))
            .unwrap();
        assert!(root.join("cache/TySa_fqgccc/media.mp4").exists());
        drop(service);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sync_cache_identity_and_lease_cleanup() {
        let root = std::env::temp_dir().join(format!("sync-cache-{}", cache::nonce()));
        let service = YouTubeService::at(
            root.join("cache"),
            root.join("settings.json"),
            Toolchain::from_directory(&root.join("tools")).unwrap(),
        )
        .unwrap();
        let stage = service
            .with_cache(|cache| cache.stage("TySa_fqgccc"))
            .unwrap();
        fs::write(stage.join("media.mp4"), b"media").unwrap();
        let hash = cache::hash_file(&stage.join("media.mp4"), &Default::default()).unwrap();
        let entry = Entry {
            version: 1,
            playback_profile: cache::PLAYBACK_PROFILE.into(),
            video_id: "TySa_fqgccc".into(),
            url: "https://www.youtube.com/watch?v=TySa_fqgccc".into(),
            size: 5,
            sha256: hash.clone(),
            duration_seconds: 1.0,
            track_start_seconds: 0.0,
            timebase_timescale: 30,
            last_used_ms: 1,
            tool_versions: serde_json::json!({}),
        };
        service
            .with_cache(|cache| cache.publish("TySa_fqgccc", &stage, &entry))
            .unwrap();
        let mut source = serde_json::json!({"videoId":"TySa_fqgccc","cache":{"sha256":hash,"size":5,"durationSeconds":1.0,"trackStartSeconds":0.0}});
        source["cache"]["size"] = 6.into();
        assert!(crate::video_sync::service::resolve_youtube(
            &service,
            &source,
            &Default::default()
        )
        .is_err());
        assert!(!service.cache_status(&[]).unwrap().entries[0].in_use);
        source["cache"]["size"] = 5.into();
        let (_, lease) =
            crate::video_sync::service::resolve_youtube(&service, &source, &Default::default())
                .unwrap();
        assert!(service.cache_status(&[]).unwrap().entries[0].in_use);
        let (send, receive) = std::sync::mpsc::channel();
        let token = CancellationToken::default();
        let worker_token = token.clone();
        let worker = std::thread::spawn(move || {
            let _lease = lease;
            receive.recv().unwrap();
            assert!(worker_token.is_cancelled());
        });
        token.cancel();
        assert!(service.cache_status(&[]).unwrap().entries[0].in_use);
        send.send(()).unwrap();
        worker.join().unwrap();
        assert!(!service.cache_status(&[]).unwrap().entries[0].in_use);
        drop(service);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn early_cancellation_is_remembered_before_download_worker_starts() {
        let root = std::env::temp_dir().join(format!("ttt-youtube-early-{}", cache::nonce()));
        let service = YouTubeService::at(
            root.join("cache"),
            root.join("settings.json"),
            Toolchain::from_directory(&root.join("missing-tools")).unwrap(),
        )
        .unwrap();
        service.cancel("early-job");
        assert_eq!(
            service
                .download("https://youtu.be/TySa_fqgccc", "early-job", &[])
                .unwrap_err(),
            "Download cancelled."
        );
        assert_eq!(service.status("early-job").unwrap().phase, "cancelled");
        assert!(service.resolve("TySa_fqgccc").unwrap().is_none());
        drop(service);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_managed_tools_fail_without_leaving_partial_entries() {
        let root = std::env::temp_dir().join(format!("ttt-youtube-tools-{}", cache::nonce()));
        let service = YouTubeService::at(
            root.join("cache"),
            root.join("settings.json"),
            Toolchain::from_directory(&root.join("missing-tools")).unwrap(),
        )
        .unwrap();
        assert!(service
            .download("https://youtu.be/TySa_fqgccc", "missing-tools", &[])
            .unwrap_err()
            .contains("Bundled download tools are missing"));
        assert_eq!(service.status("missing-tools").unwrap().phase, "error");
        assert_eq!(fs::read_dir(root.join("cache")).unwrap().count(), 1);
        drop(service);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn playback_remux_copies_streams_with_bounded_chunks_without_overwriting() {
        let args = playback_remux_args(Path::new("source.mp4"), Path::new("media.mp4"));
        let args: Vec<_> = args
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        for expected in [
            ["-c", "copy"],
            ["-chunk_duration", "1000000"],
            ["-movflags", "+faststart"],
            ["-map", "0:v:0"],
            ["-map", "0:a:0?"],
        ] {
            assert!(args.windows(2).any(|pair| pair == expected));
        }
        assert!(args.iter().any(|value| value == "-copyts"));
        assert!(args.iter().any(|value| value == "-n"));
        assert_eq!(args.last().unwrap(), "media.mp4");
    }

    #[test]
    #[ignore = "requires prepared native download helpers; run explicitly for packaging acceptance"]
    fn managed_playback_remux_preserves_variable_frame_timestamps() {
        let root = std::env::temp_dir().join(format!("ttt-youtube-remux-{}", cache::nonce()));
        fs::create_dir(&root).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/windows/vfr.mp4");
        let output = root.join("media.mp4");
        let tools = Toolchain::bundled().unwrap();
        tools.verify().unwrap();
        let cancel = CancellationToken::default();
        let run = |tool: &Path, args: &[OsString]| {
            process::run(
                tool,
                args,
                &root,
                &cancel,
                Duration::from_secs(60),
                || Ok(()),
                |_, _| {},
            )
        };
        run(&tools.ffmpeg, &playback_remux_args(&source, &output)).unwrap();
        let packets = |path: &Path| {
            let result = run(
                &tools.ffprobe,
                &[
                    "-v".into(),
                    "error".into(),
                    "-select_streams".into(),
                    "v:0".into(),
                    "-show_packets".into(),
                    "-show_entries".into(),
                    "packet=pts_time,dts_time,duration_time".into(),
                    "-of".into(),
                    "json".into(),
                    path.as_os_str().into(),
                ],
            )
            .unwrap();
            serde_json::from_str::<serde_json::Value>(&result.stdout).unwrap()["packets"].clone()
        };
        assert_eq!(packets(&source), packets(&output));
        let times: Vec<_> = packets(&output)
            .as_array()
            .unwrap()
            .iter()
            .map(|packet| packet["pts_time"].as_str().unwrap().parse::<f64>().unwrap())
            .collect();
        assert_eq!(times, [2.0, 2.1, 2.4, 2.9]);
        let hash = cache::hash_file(&output, &cancel).unwrap();
        // FFmpeg may exit successfully when -n skips an existing output.
        let _ = run(&tools.ffmpeg, &playback_remux_args(&source, &output));
        assert_eq!(cache::hash_file(&output, &cancel).unwrap(), hash);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_only_compatible_media_probe_and_numeric_progress() {
        assert!(validate_probe(r#"{"streams":[{"codec_type":"video","codec_name":"h264"},{"codec_type":"audio","codec_name":"aac"}]}"#).is_ok());
        for input in [
            r#"{"streams":[{"codec_type":"video","codec_name":"vp9"}]}"#,
            r#"{"streams":[{"codec_type":"audio","codec_name":"aac"}]}"#,
            "truncated",
        ] {
            assert!(validate_probe(input).is_err());
        }
        let mut status = YouTubeDownloadStatus {
            job_id: "test".into(),
            video_id: "TySa_fqgccc".into(),
            phase: "downloading".into(),
            downloaded_bytes: None,
            total_bytes: None,
            speed_bytes_per_second: None,
            eta_seconds: None,
            error: None,
        };
        apply_progress(
            &mut status,
            &serde_json::json!({"downloaded_bytes":512,"total_bytes_estimate":1024,"speed":256.0,"eta":2.0}),
        );
        assert_eq!(
            (
                status.downloaded_bytes,
                status.total_bytes,
                status.speed_bytes_per_second,
                status.eta_seconds
            ),
            (Some(512), Some(1024), Some(256.0), Some(2.0))
        );
        apply_progress(
            &mut status,
            &serde_json::json!({"downloaded_bytes":"invalid","total_bytes":-1,"speed":-2,"eta":"NA"}),
        );
        assert_eq!(
            (
                status.downloaded_bytes,
                status.total_bytes,
                status.speed_bytes_per_second,
                status.eta_seconds
            ),
            (None, None, None, None)
        );
    }

    #[test]
    fn canonicalizes_supported_urls_without_accepting_downloader_inputs() {
        for input in [
            "https://youtu.be/TySa_fqgccc?si=share",
            "https://www.youtube.com/watch?v=TySa_fqgccc&t=100",
            "https://youtube.com/shorts/TySa_fqgccc",
            "https://www.youtube-nocookie.com/embed/TySa_fqgccc",
        ] {
            assert_eq!(video_id(input).unwrap(), "TySa_fqgccc", "{input}");
        }
        for input in [
            "TySa_fqgccc",
            "--exec=bad",
            "https://evil.example/watch?v=TySa_fqgccc",
            "https://youtube.com.evil.example/watch?v=TySa_fqgccc",
            "https://user:pass@youtube.com/watch?v=TySa_fqgccc",
            "ftp://youtube.com/watch?v=TySa_fqgccc",
            "https://youtube.com:444/watch?v=TySa_fqgccc",
            "https://youtube.com/watch?v=TySa_fqgccc&v=abcdefghijk",
            "https://youtu.be/TySa_fqgccc/another",
            "https://youtu.be/../../etc/passwd",
        ] {
            assert!(video_id(input).is_err(), "{input}");
        }
    }
}
