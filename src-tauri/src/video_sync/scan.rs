//! One coarse decode, reusable compact features, and optional validated local caching.
use super::visual::{CutBracket, Feature, VisualAnalyzer, MAX_SCAN_FRAMES};
use crate::video_analysis::{
    self,
    motion::{MotionSample, MotionTracker},
    CancellationToken, PixelFormat, ResizeOptions, SamplingOptions,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{Instant, UNIX_EPOCH},
};

// Bump when visual extraction or cut-confirmation semantics change, not when matching changes.
const CACHE_VERSION: u32 = 1;
const MAX_CACHE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DURATION: f64 = 4.0 * 3600.0;
const INTERVAL: f64 = 0.4;
const RESIZE: ResizeOptions = ResizeOptions {
    max_width: 320,
    max_height: 180,
};
static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

pub struct ScannedVideo {
    pub analyzer: VisualAnalyzer,
    pub coarse_motion: Vec<MotionSample>,
    /// Frames decoded in this call, including cut confirmation; zero on a cache hit.
    pub sampled_frames: usize,
    pub cached_frames: usize,
    pub runtime_seconds: f64,
    pub cache_hit: bool,
    pub cache_note: Option<String>,
    source: SourceIdentity,
}
impl ScannedVideo {
    /// Recheck after later fine/motion decodes to reject mixed-source results.
    pub fn validate_source_unchanged(&self, path: &Path) -> Result<(), String> {
        if source_identity(path)? != self.source {
            return Err("Video source changed after feature extraction; rerun analysis".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct SourceIdentity {
    path: String,
    size: u64,
    modified_ns: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct CacheKey {
    version: u32,
    native_revision: String,
    source: SourceIdentity,
    start: f64,
    end: f64,
    interval: f64,
    width: u32,
    height: u32,
}
#[derive(Serialize, Deserialize)]
struct Header {
    key: CacheKey,
    count: usize,
    sampled_frames: usize,
    cuts: Vec<CutBracket>,
    possible_cuts: Vec<CutBracket>,
    incomplete: bool,
}
fn cancelled(cancel: &CancellationToken) -> Result<(), String> {
    if cancel.is_cancelled() {
        Err("Video analysis cancelled".into())
    } else {
        Ok(())
    }
}
fn source_identity(path: &Path) -> Result<SourceIdentity, String> {
    let info = crate::video::inspect_local_video(path)?;
    if info.status != "ready" {
        return Err("Local video is missing".into());
    }
    let metadata = fs::metadata(&info.path).map_err(|e| e.to_string())?;
    let modified_ns = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .try_into()
        .map_err(|_| "Video modification time is out of range")?;
    Ok(SourceIdentity {
        path: info.path,
        size: metadata.len(),
        modified_ns,
    })
}
fn cache_key(path: &Path, start: f64, end: f64) -> Result<CacheKey, String> {
    let mut revision = Sha256::new();
    revision.update(include_bytes!("../video_analysis/motion.cpp"));
    revision.update(include_bytes!("../video_analysis/motion.rs"));
    Ok(CacheKey {
        version: CACHE_VERSION,
        native_revision: format!("{:x}", revision.finalize()),
        source: source_identity(path)?,
        start,
        end,
        interval: INTERVAL,
        width: RESIZE.max_width,
        height: RESIZE.max_height,
    })
}
fn valid_cuts(cuts: &[CutBracket], key: &CacheKey) -> bool {
    cuts.iter().all(|c| {
        c.start_seconds.is_finite()
            && c.end_seconds.is_finite()
            && c.start_seconds >= key.start
            && c.end_seconds > c.start_seconds
            && c.end_seconds <= key.end
    }) && cuts
        .windows(2)
        .all(|w| w[0].start_seconds < w[1].start_seconds)
}
fn append_f64(bytes: &mut Vec<u8>, value: f64) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn save_cache(
    path: &Path,
    key: &CacheKey,
    analyzer: &VisualAnalyzer,
    motion: &[MotionSample],
    sampled_frames: usize,
    cancel: &CancellationToken,
) -> Result<(), String> {
    cancelled(cancel)?;
    if analyzer.features.len() != motion.len() {
        return Err("Mismatched coarse video features".into());
    }
    let header = serde_json::to_vec(&Header {
        key: key.clone(),
        count: motion.len(),
        sampled_frames,
        cuts: analyzer.cuts.clone(),
        possible_cuts: analyzer.possible_cuts.clone(),
        incomplete: analyzer.incomplete,
    })
    .map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(header.len() + motion.len() * 812 + 36);
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    for (feature, motion) in analyzer.features.iter().zip(motion) {
        cancelled(cancel)?;
        append_f64(&mut bytes, feature.time);
        append_f64(&mut bytes, feature.checker);
        bytes.extend_from_slice(&(feature.clip as u32).to_le_bytes());
        append_f64(&mut bytes, feature.tracking_support.unwrap_or(-1.0));
        append_f64(&mut bytes, motion.yaw.unwrap_or(f64::NAN));
        append_f64(&mut bytes, motion.quality);
        for value in feature.descriptor {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    let digest = Sha256::digest(&bytes);
    bytes.extend_from_slice(&digest);
    if bytes.len() as u64 > MAX_CACHE_BYTES {
        return Err("Video feature cache exceeds size limit".into());
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid cache filename")?;
    let temporary = path.with_file_name(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let mut created = false;
    let outcome = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        created = true;
        for chunk in bytes.chunks(65536) {
            cancelled(cancel)?;
            file.write_all(chunk).map_err(|e| e.to_string())?;
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        cancelled(cancel)?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if outcome.is_err() && created {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}
struct Reader<'a>(&'a [u8]);
impl<'a> Reader<'a> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let bytes = self.0.get(..N).ok_or("Truncated video feature cache")?;
        let output = bytes.try_into().unwrap();
        self.0 = &self.0[N..];
        Ok(output)
    }
    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(self.take()?))
    }
}
fn load_cache(
    path: &Path,
    key: &CacheKey,
    cancel: &CancellationToken,
) -> Result<(VisualAnalyzer, Vec<MotionSample>, usize), String> {
    cancelled(cancel)?;
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size < 36 || size > MAX_CACHE_BYTES {
        return Err("Invalid video feature cache size".into());
    }
    let mut bytes = Vec::with_capacity(size as usize);
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_CACHE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() < 36 || bytes.len() as u64 > MAX_CACHE_BYTES {
        return Err("Invalid video feature cache size".into());
    }
    let data = &bytes[..bytes.len() - 32];
    if Sha256::digest(data).as_slice() != &bytes[bytes.len() - 32..] {
        return Err("Video feature cache checksum mismatch".into());
    }
    let mut reader = Reader(data);
    let header_length = u32::from_le_bytes(reader.take()?) as usize;
    if header_length > 8 * 1024 * 1024 {
        return Err("Invalid cache header size".into());
    }
    let header: Header = serde_json::from_slice(
        reader
            .0
            .get(..header_length)
            .ok_or("Truncated cache header")?,
    )
    .map_err(|e| e.to_string())?;
    reader.0 = &reader.0[header_length..];
    if header.key != *key {
        return Err("Video feature cache identity or parameters changed".into());
    }
    if header.count > MAX_SCAN_FRAMES
        || header.cuts.len() > header.count
        || header.possible_cuts.len() > header.count
        || reader.0.len() != header.count * 812
        || !valid_cuts(&header.cuts, key)
        || !valid_cuts(&header.possible_cuts, key)
    {
        return Err("Invalid cached video bounds".into());
    }
    let mut analyzer = VisualAnalyzer::new();
    analyzer.cuts = header.cuts;
    analyzer.possible_cuts = header.possible_cuts;
    analyzer.incomplete = header.incomplete;
    let mut motion = Vec::with_capacity(header.count);
    for _ in 0..header.count {
        cancelled(cancel)?;
        let time = reader.f64()?;
        let checker = reader.f64()?;
        let clip = u32::from_le_bytes(reader.take()?) as usize;
        let support = reader.f64()?;
        let yaw = reader.f64()?;
        let quality = reader.f64()?;
        let mut descriptor = [0.0; 192];
        for value in &mut descriptor {
            *value = f32::from_le_bytes(reader.take()?);
        }
        if !time.is_finite()
            || time < key.start
            || time >= key.end
            || analyzer.features.last().is_some_and(|f| f.time >= time)
            || !checker.is_finite()
            || !(0.0..=1.0).contains(&checker)
            || !(support == -1.0 || support.is_finite() && (0.0..=1.0).contains(&support))
            || !(yaw.is_finite() || yaw.is_nan())
            || !quality.is_finite()
            || !(0.0..=1.0).contains(&quality)
            || descriptor.iter().any(|v| !v.is_finite())
            || clip
                != analyzer
                    .cuts
                    .iter()
                    .filter(|c| c.end_seconds <= time)
                    .count()
        {
            return Err("Invalid cached video feature".into());
        }
        analyzer.features.push(Feature {
            time,
            descriptor,
            checker,
            clip,
            tracking_support: (support >= 0.0).then_some(support),
        });
        motion.push(MotionSample {
            time,
            yaw: yaw.is_finite().then_some(yaw),
            quality,
        });
    }
    if !reader.0.is_empty() {
        return Err("Unexpected video feature cache data".into());
    }
    Ok((analyzer, motion, header.sampled_frames))
}

/// Authentication and source attachment checks remain the caller's responsibility.
pub fn scan_path(
    path: &Path,
    start: f64,
    end: f64,
    cancel: &CancellationToken,
    mut progress: impl FnMut(&str, f64),
    cache: Option<&Path>,
) -> Result<ScannedVideo, String> {
    let began = Instant::now();
    cancelled(cancel)?;
    if !start.is_finite()
        || !end.is_finite()
        || start < 0.0
        || end <= start
        || end - start > MAX_DURATION
    {
        return Err("Invalid scan interval; maximum scan duration is four hours".into());
    }
    let key = cache_key(path, start, end)?;
    if cache
        .and_then(|p| fs::canonicalize(p).ok())
        .is_some_and(|p| p.to_str() == Some(key.source.path.as_str()))
    {
        return Err("Feature cache must be separate from the video source".into());
    }
    let mut cache_note = None;
    if let Some(cache) = cache {
        if cache.exists() {
            match load_cache(cache, &key, cancel) {
                Ok((analyzer, coarse_motion, cached_frames)) => {
                    if source_identity(path)? != key.source {
                        return Err("Video source changed while loading analysis cache".into());
                    }
                    cancelled(cancel)?;
                    progress("sampling", 1.0);
                    return Ok(ScannedVideo {
                        analyzer,
                        coarse_motion,
                        sampled_frames: 0,
                        cached_frames,
                        runtime_seconds: began.elapsed().as_secs_f64(),
                        cache_hit: true,
                        cache_note: None,
                        source: key.source.clone(),
                    });
                }
                Err(e) => {
                    cancelled(cancel)?;
                    cache_note = Some(format!("Feature cache rejected; rescanning: {e}"));
                }
            }
        }
    }
    let metadata = video_analysis::inspect(path, cancel).map_err(|e| e.to_string())?;
    if end > metadata.duration_seconds {
        return Err("Scan extends beyond video duration".into());
    }
    let mut analyzer = VisualAnalyzer::new();
    let mut tracker = None;
    let mut coarse_motion = Vec::new();
    let mut sampled_frames = 0;
    video_analysis::sample_frames(
        path,
        SamplingOptions {
            start_seconds: start,
            end_seconds: Some(end),
            interval_seconds: INTERVAL,
            resize: RESIZE,
            pixel_format: PixelFormat::Gray8,
        },
        cancel,
        |frame| {
            if tracker.is_none() {
                tracker = Some(MotionTracker::new(frame.width, frame.height)?);
            }
            let tracker = tracker.as_mut().unwrap();
            coarse_motion.push(tracker.push(&frame)?);
            analyzer.push(&frame, tracker.tracking_support())?;
            sampled_frames += 1;
            Ok(())
        },
        |p| {
            progress(
                "sampling",
                p.current_video_timestamp
                    .map_or(0.0, |t| ((t - start) / (end - start) * 0.8).clamp(0.0, 0.8)),
            )
        },
    )
    .map_err(|e| e.to_string())?;
    let windows = analyzer.suspected_cut_windows();
    // Nearby proposals share a decoder seek; no full-resolution frames are retained.
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (a, b) in windows {
        let window = (a.max(start), b.min(end));
        if window.1 <= window.0 {
            continue;
        }
        if let Some(last) = merged.last_mut().filter(|last| window.0 <= last.1 + 0.1) {
            last.1 = last.1.max(window.1);
        } else {
            merged.push(window);
        }
    }
    for (i, &(a, b)) in merged.iter().enumerate() {
        cancelled(cancel)?;
        let mut tracker = None;
        video_analysis::sample_frames(
            path,
            SamplingOptions {
                start_seconds: a,
                end_seconds: Some(b),
                interval_seconds: 0.05,
                resize: RESIZE,
                pixel_format: PixelFormat::Gray8,
            },
            cancel,
            |frame| {
                if tracker.is_none() {
                    tracker = Some(MotionTracker::new(frame.width, frame.height)?);
                }
                let tracker = tracker.as_mut().unwrap();
                tracker.push(&frame)?;
                analyzer.confirm_cut(&frame, tracker.tracking_support())?;
                sampled_frames += 1;
                Ok(())
            },
            |_| {},
        )
        .map_err(|e| e.to_string())?;
        progress(
            "cuts",
            0.8 + 0.2 * (i + 1) as f64 / merged.len().max(1) as f64,
        );
    }
    cancelled(cancel)?;
    if source_identity(path)? != key.source {
        return Err("Video source changed during analysis".into());
    }
    if let Some(cache) = cache {
        if let Err(e) = save_cache(
            cache,
            &key,
            &analyzer,
            &coarse_motion,
            sampled_frames,
            cancel,
        ) {
            cancelled(cancel)?;
            cache_note = Some(match cache_note {
                Some(previous) => format!("{previous}; cache save failed: {e}"),
                None => format!("Feature cache was not saved: {e}"),
            });
        }
    }
    progress("sampling", 1.0);
    Ok(ScannedVideo {
        analyzer,
        coarse_motion,
        cached_frames: 0,
        sampled_frames,
        runtime_seconds: began.elapsed().as_secs_f64(),
        cache_hit: false,
        cache_note,
        source: key.source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "video-feature-cache-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn source(&self) -> std::path::PathBuf {
            let path = self.0.join("video.mp4");
            fs::write(&path, b"source identity fixture").unwrap();
            path
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn features() -> (VisualAnalyzer, Vec<MotionSample>) {
        let mut analyzer = VisualAnalyzer::new();
        analyzer.cuts.push(CutBracket {
            start_seconds: 0.6,
            end_seconds: 0.65,
        });
        analyzer.possible_cuts.push(CutBracket {
            start_seconds: 0.43,
            end_seconds: 0.83,
        });
        let mut motion = Vec::new();
        for (i, time) in [0.03, 0.43, 0.83].into_iter().enumerate() {
            analyzer.features.push(Feature {
                time,
                descriptor: [i as f32; 192],
                checker: 0.12,
                clip: usize::from(time >= 0.65),
                tracking_support: Some(0.9),
            });
            motion.push(MotionSample {
                time,
                yaw: (i > 0).then_some(2.0),
                quality: 0.8,
            });
        }
        (analyzer, motion)
    }
    #[test]
    fn cache_hit_reuses_compact_features_without_opening_a_decoder() {
        let scratch = Scratch::new();
        let source = scratch.source();
        let cache = scratch.0.join("features.bin");
        let key = cache_key(&source, 0.0, 2.0).unwrap();
        let (analyzer, motion) = features();
        let cancel = CancellationToken::default();
        save_cache(&cache, &key, &analyzer, &motion, 17, &cancel).unwrap();
        let loaded = scan_path(&source, 0.0, 2.0, &cancel, |_, _| {}, Some(&cache)).unwrap();
        assert!(scan_path(&source, 0.0, 2.0, &cancel, |_, _| {}, Some(&source)).is_err());
        assert!(loaded.cache_hit);
        assert_eq!(loaded.sampled_frames, 0);
        assert_eq!(loaded.cached_frames, 17);
        assert_eq!(loaded.analyzer.frame_count(), 3);
        assert_eq!(loaded.analyzer.features[2].clip, 1);
        assert_eq!(loaded.analyzer.features[2].tracking_support, Some(0.9));
        assert_eq!(loaded.coarse_motion[0].yaw, None);
        assert_eq!(loaded.analyzer.features[2].descriptor, [2.0; 192]);
    }
    #[test]
    fn late_scan_ranges_are_bounded_by_span_not_absolute_media_time() {
        let scratch = Scratch::new();
        let source = scratch.source();
        let cache = scratch.0.join("features.bin");
        let key = cache_key(&source, 50000.0, 50002.0).unwrap();
        let (mut analyzer, mut motion) = features();
        for f in &mut analyzer.features {
            f.time += 50000.0;
        }
        for m in &mut motion {
            m.time += 50000.0;
        }
        for c in analyzer
            .cuts
            .iter_mut()
            .chain(analyzer.possible_cuts.iter_mut())
        {
            c.start_seconds += 50000.0;
            c.end_seconds += 50000.0;
        }
        let cancel = CancellationToken::default();
        save_cache(&cache, &key, &analyzer, &motion, 17, &cancel).unwrap();
        assert!(
            scan_path(&source, 50000.0, 50002.0, &cancel, |_, _| {}, Some(&cache))
                .unwrap()
                .cache_hit
        );
    }
    #[test]
    fn cached_scan_rechecks_source_after_later_analysis_work() {
        let scratch = Scratch::new();
        let source = scratch.source();
        let cache = scratch.0.join("features.bin");
        let key = cache_key(&source, 0.0, 2.0).unwrap();
        let (analyzer, motion) = features();
        let cancel = CancellationToken::default();
        save_cache(&cache, &key, &analyzer, &motion, 17, &cancel).unwrap();
        let scanned = scan_path(&source, 0.0, 2.0, &cancel, |_, _| {}, Some(&cache)).unwrap();
        scanned.validate_source_unchanged(&source).unwrap();
        let file = fs::OpenOptions::new().write(true).open(&source).unwrap();
        file.set_times(
            fs::FileTimes::new()
                .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000)),
        )
        .unwrap();
        assert_eq!(fs::metadata(&source).unwrap().len(), key.source.size);
        assert!(scanned
            .validate_source_unchanged(&source)
            .err()
            .unwrap()
            .contains("changed after feature extraction"));
    }
    #[test]
    fn cache_rejects_changed_source_parameters_and_corruption() {
        let scratch = Scratch::new();
        let source = scratch.source();
        let cache = scratch.0.join("features.bin");
        let cancel = CancellationToken::default();
        let key = cache_key(&source, 0.0, 2.0).unwrap();
        let (analyzer, motion) = features();
        save_cache(&cache, &key, &analyzer, &motion, 17, &cancel).unwrap();
        let mut changed = key.clone();
        changed.width = 160;
        assert!(load_cache(&cache, &changed, &cancel).is_err());
        changed = key.clone();
        changed.version += 1;
        assert!(load_cache(&cache, &changed, &cancel).is_err());
        let file = fs::OpenOptions::new().write(true).open(&source).unwrap();
        file.set_times(
            fs::FileTimes::new()
                .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000)),
        )
        .unwrap();
        let modified_only = cache_key(&source, 0.0, 2.0).unwrap();
        assert_eq!(modified_only.source.size, key.source.size);
        assert!(load_cache(&cache, &modified_only, &cancel).is_err());
        fs::write(&source, b"changed source identity and byte length").unwrap();
        let changed = cache_key(&source, 0.0, 2.0).unwrap();
        assert!(load_cache(&cache, &changed, &cancel).is_err());
        let mut bytes = fs::read(&cache).unwrap();
        let index = bytes.len() - 40;
        bytes[index] ^= 1;
        fs::write(&cache, &bytes).unwrap();
        assert!(load_cache(&cache, &key, &cancel)
            .err()
            .unwrap()
            .contains("checksum"));
        fs::write(&cache, &bytes[..10]).unwrap();
        assert!(load_cache(&cache, &key, &cancel).is_err());
    }
    #[test]
    fn cancellation_never_replaces_a_completed_cache() {
        let scratch = Scratch::new();
        let source = scratch.source();
        let cache = scratch.0.join("features.bin");
        let key = cache_key(&source, 0.0, 2.0).unwrap();
        let (analyzer, motion) = features();
        save_cache(
            &cache,
            &key,
            &analyzer,
            &motion,
            17,
            &CancellationToken::default(),
        )
        .unwrap();
        let before = fs::read(&cache).unwrap();
        let cancel = CancellationToken::default();
        cancel.cancel();
        assert!(save_cache(&cache, &key, &analyzer, &motion, 17, &cancel).is_err());
        assert_eq!(before, fs::read(&cache).unwrap());
        assert!(scan_path(&source, 0.0, 2.0, &cancel, |_, _| {}, Some(&cache)).is_err());
        assert_eq!(fs::read_dir(&scratch.0).unwrap().count(), 2);
    }
    #[test]
    fn scan_limits_reject_unbounded_work_before_decoding() {
        let cancel = CancellationToken::default();
        assert!(scan_path(
            Path::new("missing.mp4"),
            0.0,
            f64::INFINITY,
            &cancel,
            |_, _| {},
            None
        )
        .is_err());
        assert!(scan_path(
            Path::new("missing.mp4"),
            0.0,
            MAX_DURATION + 1.0,
            &cancel,
            |_, _| {},
            None
        )
        .is_err());
    }
}
