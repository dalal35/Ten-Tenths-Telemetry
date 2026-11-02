//! Explicit packaged-tool verification in a caller-selected disposable cache.
use super::{video_id, Toolchain, YouTubeAsset, YouTubeService};
use crate::video_analysis::{self, CancellationToken, PixelFormat, ResizeOptions};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

pub fn run(args: &[String]) -> Result<(), String> {
    if args.len() != 5 || !matches!(args[2].as_str(), "download" | "resolve" | "cancel") {
        return Err("Usage: --youtube-self-check download|resolve|cancel DISPOSABLE_CACHE_DIRECTORY YOUTUBE_URL".into());
    }
    let id = video_id(&args[4])?;
    let root = PathBuf::from(&args[3]);
    let tools = Toolchain::bundled()?;
    let service = Arc::new(YouTubeService::at(
        root.clone(),
        root.join("settings.json"),
        tools,
    )?);
    let asset = if args[2] == "resolve" {
        service.resolve(&id)?.ok_or("No completed cached video")?
    } else {
        let worker = service.clone();
        let url = args[4].clone();
        let download =
            std::thread::spawn(move || worker.download(&url, "packaged-self-check", &[]));
        let started = Instant::now();
        let mut cancelled = false;
        let mut previous = String::new();
        while !download.is_finished() {
            if let Some(status) = service.status("packaged-self-check") {
                let phase = serde_json::to_string(&status).map_err(|error| error.to_string())?;
                if phase != previous {
                    eprintln!("{phase}");
                    previous = phase;
                }
                if args[2] == "cancel"
                    && !cancelled
                    && status.downloaded_bytes.is_some_and(|bytes| bytes > 0)
                    && status
                        .speed_bytes_per_second
                        .is_some_and(|speed| speed > 0.0)
                {
                    service.cancel("packaged-self-check");
                    cancelled = true;
                }
            }
            if args[2] == "cancel" && started.elapsed() > Duration::from_secs(60) {
                service.cancel("packaged-self-check");
                service.shutdown();
                return Err(
                    "Live download progress or cancellation did not finish within 60 seconds"
                        .into(),
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let result = download.join().map_err(|_| "Download worker panicked")?;
        if args[2] == "cancel" {
            if let Ok(asset) = result {
                service.release(&asset.lease_id)?;
                return Err(
                    "Video completed before cancellation; use a fresh disposable cache".into(),
                );
            }
            if !cancelled || service.resolve(&id)?.is_some() {
                return Err("Cancellation left completed media or never reached the worker".into());
            }
            println!(
                "{}",
                serde_json::json!({"videoId":id,"cancelled":true,"completedMedia":false})
            );
            return Ok(());
        }
        result?
    };
    let result = verify_timestamps(&asset);
    service.release(&asset.lease_id)?;
    let timestamps = result?;
    println!(
        "{}",
        serde_json::json!({
            "videoId":asset.video_id,"path":asset.path,"bytes":asset.size,"sha256":asset.sha256,
            "durationSeconds":asset.duration_seconds,"trackStartSeconds":asset.track_start_seconds,
            "cached":asset.cached,"sampledTimestamps":timestamps
        })
    );
    Ok(())
}

fn verify_timestamps(asset: &YouTubeAsset) -> Result<Vec<f64>, String> {
    let mut timestamps = vec![];
    for target in [0.0_f64, 1.0, 10.0]
        .into_iter()
        .filter(|time| *time < asset.duration_seconds)
    {
        let frame = video_analysis::extract_frame(
            std::path::Path::new(&asset.path),
            target,
            ResizeOptions {
                max_width: 160,
                max_height: 90,
            },
            PixelFormat::Gray8,
            &CancellationToken::default(),
        )
        .map_err(|error| error.to_string())?;
        let pts = frame.timestamp_value as f64 / frame.timestamp_timescale as f64;
        if !pts.is_finite()
            || (pts - frame.timestamp_seconds).abs() > 1e-7
            || pts < target
            || pts > target + 1.0
        {
            return Err(format!(
                "Unexpected decoded timestamp {pts} for target {target}"
            ));
        }
        timestamps.push(pts);
    }
    Ok(timestamps)
}
