use super::{valid_id, YouTubeAsset, YouTubeCacheEntry, YouTubeCacheStatus};
use crate::video_analysis::CancellationToken;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const PLAYBACK_PROFILE: &str = "mp4-1s";
pub(super) const DEFAULT_LIMIT: u64 = 10 * 1024 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(0);
pub(super) fn nonce() -> String {
    format!(
        "{}-{}-{}",
        std::process::id(),
        now(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    pub version: u32,
    #[serde(default)]
    pub playback_profile: String,
    pub video_id: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub duration_seconds: f64,
    pub track_start_seconds: f64,
    pub timebase_timescale: i32,
    pub last_used_ms: u64,
    pub tool_versions: serde_json::Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    version: u32,
    limit_bytes: u64,
}
pub(super) struct Cache {
    pub root: PathBuf,
    settings: PathBuf,
    pub limit: u64,
    leases: HashMap<String, String>,
    _owner: File,
}

pub(super) fn regular(path: &Path) -> Result<fs::Metadata, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("Cannot read YouTube cache file: {e}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("The YouTube cache contains an unsafe file reference.".into());
    }
    Ok(metadata)
}
fn directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot read YouTube cache directory: {e}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("The YouTube cache contains an unsafe directory reference.".into());
    }
    Ok(())
}
fn tree_bytes(path: &Path, reject_links: bool) -> Result<u64, String> {
    fn visit(path: &Path, depth: usize, reject_links: bool) -> Result<u64, String> {
        let metadata =
            fs::symlink_metadata(path).map_err(|e| format!("Cannot inspect cache usage: {e}"))?;
        if metadata.file_type().is_symlink() {
            return if reject_links {
                Err("Unsafe file tree in YouTube cache.".into())
            } else {
                Ok(0)
            };
        }
        if depth > 8 {
            return Err("Unsafe file tree in YouTube cache.".into());
        }
        if metadata.is_file() {
            return Ok(metadata.len());
        }
        if !metadata.is_dir() {
            return Err("Unexpected file type in YouTube cache.".into());
        }
        let mut total = 0u64;
        for item in fs::read_dir(path).map_err(|e| e.to_string())? {
            total = total.saturating_add(visit(
                &item.map_err(|e| e.to_string())?.path(),
                depth + 1,
                reject_links,
            )?);
        }
        Ok(total)
    }
    visit(path, 0, reject_links)
}
pub(super) fn bytes(path: &Path) -> Result<u64, String> {
    tree_bytes(path, true)
}
pub(super) fn remove_owned(path: &Path) -> Result<(), String> {
    directory(path)?;
    // Validate before recursive deletion; a link is never followed into a user directory.
    bytes(path)?;
    fs::remove_dir_all(path).map_err(|e| format!("Cannot remove unused YouTube cache files: {e}"))
}
pub(super) fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if path.exists() {
        regular(path)?;
    }
    let parent = path.parent().ok_or("Invalid cache settings path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create cache settings folder: {e}"))?;
    let temp = parent.join(format!(".youtube-{}.tmp", nonce()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result.map_err(|e: String| format!("Cannot save YouTube cache metadata: {e}"))
}
pub(super) fn hash_file(path: &Path, cancel: &CancellationToken) -> Result<String, String> {
    regular(path)?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop {
        if cancel.is_cancelled() {
            return Err("Download cancelled.".into());
        }
        let count = file
            .read(&mut chunk)
            .map_err(|e| format!("Cannot verify cached video: {e}"))?;
        if count == 0 {
            break;
        }
        hash.update(&chunk[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

impl Cache {
    pub fn open(root: PathBuf, settings: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| format!("Cannot create YouTube cache: {e}"))?;
        directory(&root)?;
        let owner_path = root.join("owner.lock");
        if owner_path.exists() {
            regular(&owner_path)?;
        }
        let owner = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&owner_path)
            .map_err(|e| e.to_string())?;
        owner.try_lock().map_err(|_| "The YouTube cache is already open in another Ten Tenths Telemetry instance. Close that instance and retry.".to_string())?;
        let limit = if settings.exists() {
            regular(&settings)?;
            let raw = fs::read(&settings).map_err(|e| e.to_string())?;
            if raw.len() > 65536 {
                return Err("YouTube cache settings are damaged.".into());
            }
            let value: Settings = serde_json::from_slice(&raw)
                .map_err(|_| "YouTube cache settings are damaged.".to_string())?;
            if value.version != 1
                || !(1024 * 1024 * 1024..=1024 * DEFAULT_LIMIT).contains(&value.limit_bytes)
            {
                return Err("Unsupported YouTube cache settings.".into());
            }
            value.limit_bytes
        } else {
            DEFAULT_LIMIT
        };
        let cache = Self {
            root,
            settings,
            limit,
            leases: HashMap::new(),
            _owner: owner,
        };
        for item in fs::read_dir(&cache.root).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            if item
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(".stage-"))
            {
                remove_owned(&item.path())?;
            }
        }
        Ok(cache)
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("Invalid YouTube video ID.".into());
        }
        Ok(self.root.join(id))
    }
    fn read_entry(&self, id: &str) -> Result<Option<serde_json::Value>, String> {
        let dir = self.path(id)?;
        match fs::symlink_metadata(&dir) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
            Ok(_) => directory(&dir)?,
        }
        let path = dir.join("entry.json");
        regular(&path)?;
        let raw = fs::read(path).map_err(|e| e.to_string())?;
        if raw.len() > 65536 {
            return Err(
                "Cached video metadata is damaged. Remove this cache entry and retry.".into(),
            );
        }
        serde_json::from_slice(&raw).map(Some).map_err(|_| {
            "Cached video metadata is damaged. Remove this cache entry and retry.".to_string()
        })
    }
    fn decode_entry(value: serde_json::Value, id: &str) -> Result<Entry, String> {
        if value
            .get("version")
            .and_then(|v| v.as_u64())
            .is_some_and(|version| version > 1)
        {
            return Err("This cache entry needs a newer Ten Tenths Telemetry version.".into());
        }
        let entry: Entry = serde_json::from_value(value).map_err(|_| {
            "Cached video metadata is damaged. Remove this cache entry and retry.".to_string()
        })?;
        if entry.version != 1
            || entry.video_id != id
            || entry.url != format!("https://www.youtube.com/watch?v={id}")
            || entry.size == 0
            || entry.sha256.len() != 64
            || !entry.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || !entry.duration_seconds.is_finite()
            || entry.duration_seconds <= 0.0
            || !entry.track_start_seconds.is_finite()
            || entry.track_start_seconds < 0.0
            || entry.timebase_timescale <= 0
        {
            return Err(
                "Cached video metadata is invalid. Remove this cache entry and retry.".into(),
            );
        }
        if entry.playback_profile != PLAYBACK_PROFILE {
            return Err("The cached video needs a playback compatibility refresh. Download it again; saved sync mappings are preserved.".into());
        }
        Ok(entry)
    }
    pub fn entry(&self, id: &str) -> Result<Option<Entry>, String> {
        self.read_entry(id)?
            .map(|value| Self::decode_entry(value, id))
            .transpose()
    }
    pub fn resolve(
        &mut self,
        id: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<YouTubeAsset>, String> {
        let Some(mut entry) = self.entry(id)? else {
            return Ok(None);
        };
        let path = self.path(id)?.join("media.mp4");
        if regular(&path)?.len() != entry.size || hash_file(&path, cancel)? != entry.sha256 {
            return Err("The cached video is corrupt or changed. Remove this cache entry and download it again; saved sync mappings are preserved.".into());
        }
        entry.last_used_ms = now();
        write_json(&self.path(id)?.join("entry.json"), &entry)?;
        let info = crate::video::inspect_local_video(&path)?;
        let lease_id = nonce();
        self.leases.insert(lease_id.clone(), id.into());
        Ok(Some(YouTubeAsset {
            video_id: id.into(),
            url: entry.url,
            path: info.path,
            size: entry.size,
            modified_ms: info.modified_ms,
            sha256: entry.sha256,
            duration_seconds: entry.duration_seconds,
            track_start_seconds: entry.track_start_seconds,
            lease_id,
            cached: true,
        }))
    }
    pub fn release(&mut self, lease: &str) {
        self.leases.remove(lease);
    }
    pub fn stage(&self, id: &str) -> Result<PathBuf, String> {
        self.path(id)?;
        let path = self.root.join(format!(".stage-{id}-{}", nonce()));
        fs::create_dir(&path).map_err(|e| format!("Cannot reserve video download files: {e}"))?;
        Ok(path)
    }
    pub fn publish(&mut self, id: &str, stage: &Path, entry: &Entry) -> Result<(), String> {
        if stage.parent() != Some(self.root.as_path())
            || !stage
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with(".stage-")
        {
            return Err("Invalid download staging directory.".into());
        }
        directory(stage)?;
        regular(&stage.join("media.mp4"))?;
        let destination = self.path(id)?;
        if destination.exists() {
            return Err(
                "A cache entry already exists for this video; it was not overwritten.".into(),
            );
        }
        write_json(&stage.join("entry.json"), entry)?;
        OpenOptions::new()
            .write(true)
            .open(stage.join("media.mp4"))
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(stage)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(stage, &destination)
            .map_err(|e| format!("Cannot complete video cache entry: {e}"))?;
        #[cfg(unix)]
        File::open(&self.root)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn usage(&self) -> Result<u64, String> {
        tree_bytes(&self.root, false)
    }
    pub fn status(&self, protected: &[String]) -> Result<YouTubeCacheStatus, String> {
        let mut entries = Vec::new();
        for item in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let name = item.file_name();
            let Some(id) = name.to_str().filter(|id| valid_id(id)) else {
                continue;
            };
            let raw = self.read_entry(id);
            let future = raw
                .as_ref()
                .ok()
                .and_then(|value| value.as_ref())
                .and_then(|value| value.get("version"))
                .and_then(|value| value.as_u64())
                .is_some_and(|version| version > 1);
            let entry =
                raw.and_then(|value| value.map(|value| Self::decode_entry(value, id)).transpose());
            let issue = entry.as_ref().err().cloned();
            let owned = bytes(&item.path());
            entries.push(YouTubeCacheEntry {
                video_id: id.into(),
                url: format!("https://www.youtube.com/watch?v={id}"),
                size: tree_bytes(&item.path(), false)?,
                last_used_ms: entry
                    .as_ref()
                    .ok()
                    .and_then(|value| value.as_ref())
                    .map_or(0, |value| value.last_used_ms),
                referenced: protected.iter().any(|value| value == id),
                in_use: self.leases.values().any(|value| value == id),
                issue: issue.or_else(|| owned.as_ref().err().cloned()),
                automatic_eviction_allowed: !future
                    && owned.is_ok()
                    && directory(&item.path()).is_ok(),
            });
        }
        entries.sort_by_key(|entry| entry.last_used_ms);
        Ok(YouTubeCacheStatus {
            limit_bytes: self.limit,
            used_bytes: self.usage()?,
            entries,
        })
    }
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if self.leases.values().any(|value| value == id) {
            return Err(
                "This video is in use. Detach it or switch away before removing it from the cache."
                    .into(),
            );
        }
        let path = self.path(id)?;
        if path.exists() || fs::symlink_metadata(&path).is_ok() {
            remove_owned(&path)?;
        }
        Ok(())
    }
    pub fn clean(&mut self, protected: &[String]) -> Result<(), String> {
        for entry in self.status(protected)?.entries {
            if !entry.referenced && !entry.in_use && entry.automatic_eviction_allowed {
                self.remove(&entry.video_id)?;
            }
        }
        Ok(())
    }
    pub fn make_room(&mut self, reserve: u64, protected: &[String]) -> Result<(), String> {
        if reserve > self.limit {
            return Err(
                "This video exceeds the configured cache limit. Increase the limit and retry."
                    .into(),
            );
        }
        for entry in self.status(protected)?.entries {
            if self.usage()?.saturating_add(reserve) <= self.limit {
                return Ok(());
            }
            if !entry.referenced && !entry.in_use && entry.automatic_eviction_allowed {
                self.remove(&entry.video_id)?;
            }
        }
        if self.usage()?.saturating_add(reserve) > self.limit {
            return Err("The video cache is full of saved or active footage. Remove an unused entry or increase the cache limit.".into());
        }
        Ok(())
    }
    pub fn set_limit(&mut self, limit: u64) -> Result<(), String> {
        if !(1024 * 1024 * 1024..=1024 * DEFAULT_LIMIT).contains(&limit) {
            return Err("Choose a cache limit between 1 GiB and 10 TiB.".into());
        }
        write_json(
            &self.settings,
            &Settings {
                version: 1,
                limit_bytes: limit,
            },
        )?;
        self.limit = limit;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Sandbox(std::path::PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "ttt-youtube-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn open(&self) -> Cache {
            Cache::open(self.0.join("cache"), self.0.join("settings.json")).unwrap()
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn owns_cache_across_instances_and_removes_only_owned_staging() {
        let root = Sandbox::new();
        let cache = root.open();
        assert!(Cache::open(root.0.join("cache"), root.0.join("settings.json")).is_err());
        std::fs::create_dir(cache.root.join(".stage-abandoned")).unwrap();
        std::fs::write(cache.root.join(".stage-abandoned/partial"), b"partial").unwrap();
        std::fs::write(cache.root.join("keep.txt"), b"keep").unwrap();
        drop(cache);
        let cache = root.open();
        assert!(!cache.root.join(".stage-abandoned").exists());
        assert_eq!(std::fs::read(cache.root.join("keep.txt")).unwrap(), b"keep");
    }

    #[test]
    fn immutable_entry_survives_restart_and_rejects_corruption() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let stage = cache.stage("TySa_fqgccc").unwrap();
        std::fs::write(stage.join("media.mp4"), b"completed media").unwrap();
        let record = fixture_record(&stage);
        cache.publish("TySa_fqgccc", &stage, &record).unwrap();
        let asset = cache
            .resolve("TySa_fqgccc", &Default::default())
            .unwrap()
            .unwrap();
        assert_eq!(asset.size, 15);
        assert!(asset.cached);
        cache.release(&asset.lease_id);
        drop(cache);
        let mut cache = root.open();
        assert!(cache
            .resolve("TySa_fqgccc", &Default::default())
            .unwrap()
            .is_some());
        std::fs::write(cache.root.join("TySa_fqgccc/media.mp4"), b"corrupted media").unwrap();
        assert!(cache.resolve("TySa_fqgccc", &Default::default()).is_err());
    }

    #[test]
    fn cache_requires_the_verified_playback_profile_before_leasing() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let stage = cache.stage("TySa_fqgccc").unwrap();
        fs::write(stage.join("media.mp4"), b"completed media").unwrap();
        let record = fixture_record(&stage);
        cache.publish("TySa_fqgccc", &stage, &record).unwrap();
        let path = cache.root.join("TySa_fqgccc/entry.json");
        let mut entry = serde_json::to_value(record).unwrap();
        entry.as_object_mut().unwrap().remove("playbackProfile");
        write_json(&path, &entry).unwrap();
        assert!(cache
            .resolve("TySa_fqgccc", &Default::default())
            .unwrap_err()
            .contains("playback compatibility"));
        assert!(cache.leases.is_empty());
        assert!(cache.root.join("TySa_fqgccc/media.mp4").is_file());
    }

    #[test]
    fn leases_and_saved_references_prevent_automatic_cleanup() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let stage = cache.stage("TySa_fqgccc").unwrap();
        std::fs::write(stage.join("media.mp4"), b"completed media").unwrap();
        cache
            .publish("TySa_fqgccc", &stage, &fixture_record(&stage))
            .unwrap();
        let asset = cache
            .resolve("TySa_fqgccc", &Default::default())
            .unwrap()
            .unwrap();
        assert!(cache.remove("TySa_fqgccc").is_err());
        cache.clean(&[]).unwrap();
        assert!(cache.root.join("TySa_fqgccc").exists());
        cache.release(&asset.lease_id);
        cache.clean(&["TySa_fqgccc".into()]).unwrap();
        assert!(cache.root.join("TySa_fqgccc").exists());
        cache.clean(&[]).unwrap();
        assert!(!cache.root.join("TySa_fqgccc").exists());
    }

    #[test]
    fn limit_persists_and_protected_media_cannot_be_evicted_to_make_room() {
        let root = Sandbox::new();
        let mut cache = root.open();
        cache.set_limit(2 * 1024 * 1024 * 1024).unwrap();
        assert!(cache.set_limit(0).is_err());
        drop(cache);
        let mut cache = root.open();
        assert_eq!(cache.limit, 2 * 1024 * 1024 * 1024);
        let stage = cache.stage("TySa_fqgccc").unwrap();
        std::fs::write(stage.join("media.mp4"), b"completed media").unwrap();
        cache
            .publish("TySa_fqgccc", &stage, &fixture_record(&stage))
            .unwrap();
        cache.limit = cache.usage().unwrap();
        assert!(cache.make_room(1, &["TySa_fqgccc".into()]).is_err());
        assert!(cache.root.join("TySa_fqgccc/media.mp4").exists());
        cache.make_room(1, &[]).unwrap();
        assert!(!cache.root.join("TySa_fqgccc").exists());
    }

    #[test]
    fn future_cache_schema_is_preserved_instead_of_treated_as_a_partial() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let stage = cache.stage("TySa_fqgccc").unwrap();
        std::fs::write(stage.join("media.mp4"), b"completed media").unwrap();
        let mut entry = fixture_record(&stage);
        entry.version = 2;
        cache.publish("TySa_fqgccc", &stage, &entry).unwrap();
        assert!(cache
            .resolve("TySa_fqgccc", &Default::default())
            .unwrap_err()
            .contains("newer"));
        assert!(cache.root.join("TySa_fqgccc/media.mp4").exists());
    }

    #[test]
    fn future_schema_without_v1_fields_is_preserved_and_not_automatically_removed() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let directory = cache.root.join("TySa_fqgccc");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("media.mp4"), b"future media").unwrap();
        write_json(
            &directory.join("entry.json"),
            &serde_json::json!({"version":2,"newShape":{"asset":"future"}}),
        )
        .unwrap();
        assert!(cache.entry("TySa_fqgccc").unwrap_err().contains("newer"));
        let status = cache.status(&[]).unwrap();
        let value = serde_json::to_value(&status.entries[0]).unwrap();
        assert_eq!(value["automaticEvictionAllowed"], false);
        assert!(value["issue"].as_str().unwrap().contains("newer"));
        cache.clean(&[]).unwrap();
        assert!(directory.join("media.mp4").exists());
    }

    #[test]
    fn malformed_entry_metadata_does_not_block_usage_or_unrelated_cleanup() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let directory = cache.root.join("TySa_fqgccc");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("media.mp4"), b"partial media").unwrap();
        fs::write(directory.join("entry.json"), b"broken JSON").unwrap();
        let status = cache.status(&[]).unwrap();
        assert_eq!(status.entries.len(), 1);
        assert_eq!(status.entries[0].size, 24);
        assert_eq!(status.used_bytes, 24);
        let value = serde_json::to_value(&status.entries[0]).unwrap();
        assert_eq!(value["automaticEvictionAllowed"], true);
        assert!(value["issue"].is_string());
        cache.clean(&[]).unwrap();
        assert!(!directory.exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_entry_without_touching_target() {
        let root = Sandbox::new();
        let mut cache = root.open();
        let outside = root.0.join("user-video");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("original.mp4"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, cache.root.join("TySa_fqgccc")).unwrap();
        assert!(cache.remove("TySa_fqgccc").is_err());
        assert_eq!(
            std::fs::read(outside.join("original.mp4")).unwrap(),
            b"keep"
        );
    }

    fn fixture_record(stage: &std::path::Path) -> Entry {
        Entry {
            version: 1,
            playback_profile: PLAYBACK_PROFILE.into(),
            video_id: "TySa_fqgccc".into(),
            url: "https://www.youtube.com/watch?v=TySa_fqgccc".into(),
            size: 15,
            sha256: hash_file(&stage.join("media.mp4"), &Default::default()).unwrap(),
            duration_seconds: 12.0,
            track_start_seconds: 0.0,
            timebase_timescale: 30,
            last_used_ms: 1,
            tool_versions: serde_json::json!({}),
        }
    }
}
