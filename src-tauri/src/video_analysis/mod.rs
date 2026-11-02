//! Bounded, local frame analysis. Timestamps use the asset playback timeline.
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    InvalidInput,
    InvalidOptions,
    Decode,
    FrameUnavailable,
    Cancelled,
    UnsupportedPlatform,
    Consumer,
    Background,
}
#[derive(Debug, Clone, Serialize)]
pub struct VideoAnalysisError {
    pub kind: ErrorKind,
    pub message: String,
}
impl std::fmt::Display for VideoAnalysisError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for VideoAnalysisError {}
impl VideoAnalysisError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}
type Result<T> = std::result::Result<T, VideoAnalysisError>;
#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);
impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
    fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(VideoAnalysisError::new(
                ErrorKind::Cancelled,
                "Video analysis cancelled",
            ))
        } else {
            Ok(())
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAnalysisMetadata {
    pub duration_seconds: f64,
    pub nominal_frame_rate: Option<f64>,
    pub width: u32,
    pub height: u32,
    pub track_start_seconds: f64,
    pub timebase_timescale: i32,
}
#[derive(Debug, Clone, Copy)]
pub enum PixelFormat {
    Rgb8,
    Gray8,
}
#[derive(Debug)]
/// Owned, tightly packed top-down sRGB RGB8 or luminance gray8 pixels.
/// Display orientation is applied; row stride equals width times channel count.
pub struct SampledVideoFrame {
    pub timestamp_seconds: f64,
    pub timestamp_value: i64,
    pub timestamp_timescale: i32,
    pub width: u32,
    pub height: u32,
    pub pixel_format: PixelFormat,
    pub pixels: Vec<u8>,
}
#[derive(Debug, Clone, Copy)]
pub struct ResizeOptions {
    pub max_width: u32,
    pub max_height: u32,
}
impl Default for ResizeOptions {
    fn default() -> Self {
        Self {
            max_width: 640,
            max_height: 360,
        }
    }
}
impl ResizeOptions {
    fn dimensions(self, meta: &VideoAnalysisMetadata) -> Result<(u32, u32)> {
        if self.max_width == 0
            || self.max_height == 0
            || self.max_width > 4096
            || self.max_height > 4096
        {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidOptions,
                "Resize bounds must be between 1 and 4096",
            ));
        }
        let scale = (self.max_width as f64 / meta.width as f64)
            .min(self.max_height as f64 / meta.height as f64)
            .min(1.0);
        Ok((
            (meta.width as f64 * scale).round().max(1.0) as u32,
            (meta.height as f64 * scale).round().max(1.0) as u32,
        ))
    }
}
#[derive(Debug, Clone, Copy)]
pub struct SamplingOptions {
    pub start_seconds: f64,
    pub end_seconds: Option<f64>,
    pub interval_seconds: f64,
    pub resize: ResizeOptions,
    pub pixel_format: PixelFormat,
}
impl Default for SamplingOptions {
    fn default() -> Self {
        Self {
            start_seconds: 0.0,
            end_seconds: None,
            interval_seconds: 0.2,
            resize: ResizeOptions::default(),
            pixel_format: PixelFormat::Rgb8,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessingStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAnalysisProgress {
    pub processed_frames: u64,
    pub estimated_total_frames: Option<u64>,
    pub current_video_timestamp: Option<f64>,
    pub status: ProcessingStatus,
}
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(windows, test))]
mod windows_pixels;
#[cfg(target_os = "macos")]
use macos::Decoder;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows::Decoder;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct Decoder;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl Decoder {
    fn open(_: &Path) -> Result<Self> {
        Err(VideoAnalysisError::new(
            ErrorKind::UnsupportedPlatform,
            "Local frame analysis requires macOS or Windows",
        ))
    }
    fn metadata(&self) -> VideoAnalysisMetadata {
        unreachable!()
    }
    fn next(
        &mut self,
        _: f64,
        _: (u32, u32),
        _: PixelFormat,
        _: &CancellationToken,
    ) -> Result<Option<SampledVideoFrame>> {
        unreachable!()
    }
}
fn open(path: &Path, start: f64, cancel: &CancellationToken) -> Result<Decoder> {
    cancel.check()?;
    let info = crate::video::inspect_local_video(path)
        .map_err(|e| VideoAnalysisError::new(ErrorKind::InvalidInput, e))?;
    if info.status != "ready" {
        return Err(VideoAnalysisError::new(
            ErrorKind::InvalidInput,
            "Local video is missing",
        ));
    }
    #[cfg(windows)]
    let decoder = Decoder::open(Path::new(&info.path), cancel)?;
    #[cfg(target_os = "macos")]
    let decoder = Decoder::open(Path::new(&info.path), start)?;
    #[cfg(not(any(windows, target_os = "macos")))]
    let decoder = Decoder::open(Path::new(&info.path))?;
    #[cfg(not(target_os = "macos"))]
    let _ = start;
    cancel.check()?;
    Ok(decoder)
}
pub fn inspect(path: &Path, cancel: &CancellationToken) -> Result<VideoAnalysisMetadata> {
    Ok(open(path, 0.0, cancel)?.metadata())
}
/// First presentation frame at or after `timestamp_seconds`, retaining its actual PTS.
/// Decodes forward from an earlier point to preserve exact frame selection.
pub fn extract_frame(
    path: &Path,
    timestamp_seconds: f64,
    resize: ResizeOptions,
    format: PixelFormat,
    cancel: &CancellationToken,
) -> Result<SampledVideoFrame> {
    if !timestamp_seconds.is_finite() || timestamp_seconds < 0.0 {
        return Err(VideoAnalysisError::new(
            ErrorKind::InvalidOptions,
            "Timestamp must be finite and nonnegative",
        ));
    }
    let mut decoder = open(path, timestamp_seconds, cancel)?;
    let dims = resize.dimensions(&decoder.metadata())?;
    decoder
        .next(timestamp_seconds, dims, format, cancel)?
        .ok_or_else(|| {
            VideoAnalysisError::new(
                ErrorKind::FrameUnavailable,
                "No frame at or after requested timestamp",
            )
        })
}
/// Visits unique frames at/after interval targets in one pass, over [start, end).
/// Consumers own each frame and must avoid retaining unbounded frames themselves.
pub fn sample_frames(
    path: &Path,
    options: SamplingOptions,
    cancel: &CancellationToken,
    mut consumer: impl FnMut(SampledVideoFrame) -> Result<()>,
    mut progress: impl FnMut(VideoAnalysisProgress),
) -> Result<()> {
    let mut state = VideoAnalysisProgress {
        processed_frames: 0,
        estimated_total_frames: None,
        current_video_timestamp: None,
        status: ProcessingStatus::Running,
    };
    let result = (|| {
        if !options.start_seconds.is_finite()
            || options.start_seconds < 0.0
            || !options.interval_seconds.is_finite()
            || options.interval_seconds <= 0.0
            || options
                .end_seconds
                .is_some_and(|end| !end.is_finite() || end <= options.start_seconds)
        {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidOptions,
                "Invalid sampling time range or interval",
            ));
        }
        let mut decoder = open(path, options.start_seconds, cancel)?;
        let meta = decoder.metadata();
        let dims = options.resize.dimensions(&meta)?;
        let end = options
            .end_seconds
            .unwrap_or(meta.duration_seconds)
            .min(meta.duration_seconds);
        let estimate = ((end - options.start_seconds).max(0.0) / options.interval_seconds).ceil();
        state.estimated_total_frames = if estimate.is_finite() && estimate < (u64::MAX as f64) {
            Some(estimate as u64)
        } else {
            None
        };
        progress(state.clone());
        let mut target = options.start_seconds;
        while target < end {
            cancel.check()?;
            // Only computed grid targets receive a two-ULP allowance for multiply/add
            // rounding. Explicit start/end and individual extraction stay strict.
            let minimum = if state.processed_frames == 0 {
                target
            } else {
                target.next_down().next_down()
            };
            let Some(frame) = decoder.next(minimum, dims, options.pixel_format, cancel)? else {
                break;
            };
            let pts = frame.timestamp_seconds;
            if pts >= end {
                break;
            }
            consumer(frame)?;
            state.processed_frames += 1;
            state.current_video_timestamp = Some(pts);
            progress(state.clone());
            cancel.check()?;
            if pts + options.interval_seconds <= pts {
                return Err(VideoAnalysisError::new(
                    ErrorKind::InvalidOptions,
                    "Sampling interval is below timestamp precision",
                ));
            }
            let mut next = options.start_seconds
                + (((pts - options.start_seconds) / options.interval_seconds)
                    .next_up()
                    .next_up()
                    .floor()
                    + 1.0)
                    * options.interval_seconds;
            if next <= pts {
                next += options.interval_seconds;
            }
            if !next.is_finite() || next <= pts {
                return Err(VideoAnalysisError::new(
                    ErrorKind::InvalidOptions,
                    "Sampling interval is below timestamp precision",
                ));
            }
            target = next;
        }
        cancel.check()?;
        Ok(())
    })();
    state.status = match &result {
        Ok(()) => ProcessingStatus::Completed,
        Err(e) if e.kind == ErrorKind::Cancelled => ProcessingStatus::Cancelled,
        Err(_) => ProcessingStatus::Failed,
    };
    progress(state);
    result
}
/// No library mutex or frontend IPC. A caller-held token cancels independently.
pub async fn sample_frames_async(
    path: PathBuf,
    options: SamplingOptions,
    cancel: CancellationToken,
    consumer: impl FnMut(SampledVideoFrame) -> Result<()> + Send + 'static,
    progress: impl FnMut(VideoAnalysisProgress) + Send + 'static,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        sample_frames(&path, options, &cancel, consumer, progress)
    })
    .await
    .map_err(|e| {
        VideoAnalysisError::new(
            ErrorKind::Background,
            format!("Video analysis worker failed: {e}"),
        )
    })?
}
