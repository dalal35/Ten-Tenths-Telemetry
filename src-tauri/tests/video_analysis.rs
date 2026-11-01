#![cfg(any(target_os = "macos", target_os = "windows"))]
use apex_telemetry::video_analysis::*;
use std::path::PathBuf;
#[path = "support/video_fixtures.rs"]
mod video_fixtures;
use video_fixtures::{fixture, fixture_mode};
// MJPEG permits tiny macOS fixtures; Windows H.264 requires at least 48x48.
#[cfg(target_os = "macos")]
const SOURCE_SIZE: (u32, u32) = (64, 32);
#[cfg(windows)]
const SOURCE_SIZE: (u32, u32) = (128, 64);
#[test]
fn real_vfr_metadata_frames_sampling_and_cleanup() {
    let path = fixture();
    let cancel = CancellationToken::default();
    let metadata = inspect(&path, &cancel).unwrap();
    assert_eq!((metadata.width, metadata.height), SOURCE_SIZE);
    assert!(
        metadata.duration_seconds >= 3.3 && metadata.duration_seconds <= 3.5,
        "{metadata:?}"
    );
    #[cfg(target_os = "macos")]
    assert!(metadata.track_start_seconds.abs() < 0.001, "{metadata:?}");
    #[cfg(windows)]
    assert!(
        (metadata.track_start_seconds - 2.0).abs() < 0.001,
        "{metadata:?}"
    );
    for _ in 0..12 {
        let frame = extract_frame(
            &path,
            2.11,
            ResizeOptions {
                max_width: 32,
                max_height: 32,
            },
            PixelFormat::Rgb8,
            &cancel,
        )
        .unwrap();
        assert!((frame.timestamp_seconds - 2.4).abs() < 0.001);
        assert_eq!(
            (frame.width, frame.height, frame.pixels.len()),
            (32, 16, 1536)
        );
        assert!(
            frame.pixels[0] < 50 && frame.pixels[1] < 50 && frame.pixels[2] > 210,
            "{:?}",
            &frame.pixels[..3]
        );
    }
    let mut times = vec![];
    let mut progress = vec![];
    sample_frames(
        &path,
        SamplingOptions {
            start_seconds: 2.0,
            end_seconds: Some(3.0),
            interval_seconds: 0.2,
            resize: ResizeOptions::default(),
            pixel_format: PixelFormat::Gray8,
        },
        &cancel,
        |frame| {
            assert_eq!(frame.pixels.len(), (frame.width * frame.height) as usize);
            times.push(frame.timestamp_seconds);
            Ok(())
        },
        |p| progress.push(p),
    )
    .unwrap();
    assert_eq!(times.len(), 3);
    for (a, b) in times.iter().zip([2.0, 2.4, 2.9]) {
        assert!((*a - b).abs() < 0.001);
    }
    assert_eq!(progress.last().unwrap().status, ProcessingStatus::Completed);
    assert_eq!(progress.last().unwrap().processed_frames, 3);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn invalid_inputs_and_cancellation_are_structured() {
    let path = fixture();
    let cancel = CancellationToken::default();
    assert_eq!(
        extract_frame(
            &path,
            f64::NAN,
            ResizeOptions::default(),
            PixelFormat::Rgb8,
            &cancel
        )
        .unwrap_err()
        .kind,
        ErrorKind::InvalidOptions
    );
    assert_eq!(
        extract_frame(
            &path,
            5.0,
            ResizeOptions::default(),
            PixelFormat::Rgb8,
            &cancel
        )
        .unwrap_err()
        .kind,
        ErrorKind::FrameUnavailable
    );
    assert_eq!(
        extract_frame(
            &path,
            0.0,
            ResizeOptions {
                max_width: 0,
                max_height: 10
            },
            PixelFormat::Rgb8,
            &cancel
        )
        .unwrap_err()
        .kind,
        ErrorKind::InvalidOptions
    );
    assert_eq!(
        sample_frames(
            &path,
            SamplingOptions {
                interval_seconds: 0.0,
                ..Default::default()
            },
            &cancel,
            |_| Ok(()),
            |_| {}
        )
        .unwrap_err()
        .kind,
        ErrorKind::InvalidOptions
    );
    assert_eq!(
        inspect(&PathBuf::from("/does-not-exist.mp4"), &cancel)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
    let bad = path.with_file_name(format!("bad-{}.mp4", std::process::id()));
    std::fs::write(&bad, b"not a movie").unwrap();
    assert_eq!(inspect(&bad, &cancel).unwrap_err().kind, ErrorKind::Decode);
    std::fs::remove_file(bad).unwrap();
    cancel.cancel();
    assert_eq!(
        inspect(&path, &cancel).unwrap_err().kind,
        ErrorKind::Cancelled
    );
    let cancel = CancellationToken::default();
    let mut count = 0;
    assert_eq!(
        sample_frames(
            &path,
            SamplingOptions {
                interval_seconds: 0.01,
                ..Default::default()
            },
            &cancel,
            |_| {
                count += 1;
                cancel.cancel();
                Ok(())
            },
            |_| {}
        )
        .unwrap_err()
        .kind,
        ErrorKind::Cancelled
    );
    assert_eq!(count, 1);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn rotated_pixels_are_top_down_and_consumer_error_finishes_progress() {
    let path = fixture_mode("rotate");
    let token = CancellationToken::default();
    let meta = inspect(&path, &token).unwrap();
    assert_eq!((meta.width, meta.height), (SOURCE_SIZE.1, SOURCE_SIZE.0));
    let frame = extract_frame(
        &path,
        2.0,
        ResizeOptions::default(),
        PixelFormat::Rgb8,
        &token,
    )
    .unwrap();
    // A clockwise quarter turn maps the source lower half to the left side.
    assert!(
        frame.pixels[2] > 210 && frame.pixels[0] < 50,
        "left {:?}",
        &frame.pixels[..3]
    );
    let right = (frame.width as usize - 1) * 3;
    assert!(
        frame.pixels[right] > 210 && frame.pixels[right + 2] < 50,
        "right {:?}",
        &frame.pixels[right..right + 3]
    );
    let mut progress = vec![];
    let error = sample_frames(
        &path,
        SamplingOptions::default(),
        &token,
        |_| {
            Err(VideoAnalysisError::new(
                ErrorKind::Consumer,
                "stop consumer",
            ))
        },
        |p| progress.push(p),
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Consumer);
    assert_eq!(progress.last().unwrap().status, ProcessingStatus::Failed);
    // The file can be reopened and removed after an early consumer exit.
    inspect(&path, &token).unwrap();
    std::fs::remove_file(path).unwrap();
}

#[test]
fn async_worker_preserves_pts_and_owned_frames() {
    let path = fixture();
    let timestamps = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
    let captured = timestamps.clone();
    tauri::async_runtime::block_on(sample_frames_async(
        path.clone(),
        SamplingOptions {
            start_seconds: 2.0,
            end_seconds: Some(3.0),
            ..Default::default()
        },
        CancellationToken::default(),
        move |frame| {
            captured.lock().unwrap().push((
                frame.timestamp_seconds,
                frame.timestamp_value as f64 / frame.timestamp_timescale as f64,
            ));
            Ok(())
        },
        |_| {},
    ))
    .unwrap();
    let values = timestamps.lock().unwrap();
    assert_eq!(values.len(), 3);
    assert!(values
        .iter()
        .all(|(seconds, rational)| (seconds - rational).abs() < 1e-12));
    std::fs::remove_file(path).unwrap();
}

#[test]
fn no_video_track_and_truncated_file_fail_without_panics() {
    let audio = fixture_mode("audio");
    let token = CancellationToken::default();
    assert_eq!(inspect(&audio, &token).unwrap_err().kind, ErrorKind::Decode);
    std::fs::remove_file(audio).unwrap();
    let path = fixture();
    let bytes = std::fs::read(&path).unwrap();
    std::fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();
    let result = sample_frames(
        &path,
        SamplingOptions::default(),
        &token,
        |_| Ok(()),
        |_| {},
    );
    assert_eq!(result.unwrap_err().kind, ErrorKind::Decode);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn top_down_layout_and_imprecise_interval_rejection() {
    let path = fixture_mode("pattern");
    let token = CancellationToken::default();
    let frame = extract_frame(
        &path,
        2.0,
        ResizeOptions::default(),
        PixelFormat::Rgb8,
        &token,
    )
    .unwrap();
    assert!(
        frame.pixels[0] > 210 && frame.pixels[2] < 50,
        "top {:?}",
        &frame.pixels[..3]
    );
    let bottom = ((frame.height - 1) * frame.width * 3) as usize;
    assert!(
        frame.pixels[bottom + 2] > 210 && frame.pixels[bottom] < 50,
        "bottom {:?}",
        &frame.pixels[bottom..bottom + 3]
    );
    assert_eq!(
        sample_frames(
            &path,
            SamplingOptions {
                interval_seconds: f64::MIN_POSITIVE,
                ..Default::default()
            },
            &token,
            |_| Ok(()),
            |_| {}
        )
        .unwrap_err()
        .kind,
        ErrorKind::InvalidOptions
    );
    std::fs::remove_file(path).unwrap();
}

#[test]
fn decimal_sampling_grid_preserves_every_exact_cfr_sample() {
    let path = fixture_mode("cfr");
    let token = CancellationToken::default();
    let mut times = vec![];
    sample_frames(
        &path,
        SamplingOptions {
            interval_seconds: 0.1,
            end_seconds: Some(0.8),
            ..Default::default()
        },
        &token,
        |frame| {
            times.push(frame.timestamp_seconds);
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(times, (0..8).map(|i| i as f64 / 10.0).collect::<Vec<_>>());
    let strict = extract_frame(
        &path,
        0.1 + 0.2,
        ResizeOptions::default(),
        PixelFormat::Rgb8,
        &token,
    )
    .unwrap();
    assert_eq!(strict.timestamp_seconds, 0.4);
    let mut times = vec![];
    sample_frames(
        &path,
        SamplingOptions {
            start_seconds: 0.1 + 0.2,
            interval_seconds: 0.1,
            end_seconds: Some(0.5),
            ..Default::default()
        },
        &token,
        |frame| {
            times.push(frame.timestamp_seconds);
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(times, vec![0.4]);
    std::fs::remove_file(path).unwrap();
}

#[cfg(windows)]
#[test]
fn native_windows_decoder_contract_runs() {
    let path = fixture();
    let metadata = inspect(&path, &CancellationToken::default()).unwrap();
    assert_eq!(metadata.timebase_timescale, 10_000_000);
    let renamed = path.with_extension("renamed.mp4");
    std::fs::rename(&path, &renamed).unwrap();
    std::fs::remove_file(renamed).unwrap();
}
#[cfg(windows)]
#[test]
fn canonical_unicode_local_path_decodes_and_releases_file() {
    let source = fixture();
    let directory = source.with_extension("local folder 雪");
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("recording café 雪.mp4");
    std::fs::rename(source, &path).unwrap();
    let canonical = std::fs::canonicalize(&path).unwrap();
    assert!(canonical.to_str().unwrap().starts_with(r"\\?\"));
    let metadata = inspect(&canonical, &CancellationToken::default()).unwrap();
    assert_eq!((metadata.width, metadata.height), SOURCE_SIZE);
    let frame = extract_frame(
        &canonical,
        2.11,
        ResizeOptions {
            max_width: 32,
            max_height: 32,
        },
        PixelFormat::Rgb8,
        &CancellationToken::default(),
    )
    .unwrap();
    assert!((frame.timestamp_seconds - 2.4).abs() < 0.001);
    assert_eq!(
        (frame.width, frame.height, frame.pixels.len()),
        (32, 16, 1536)
    );
    assert!(frame.pixels[0] < 50 && frame.pixels[1] < 50 && frame.pixels[2] > 210);
    let renamed = path.with_extension("renamed.mp4");
    std::fs::rename(path, &renamed).unwrap();
    std::fs::remove_file(renamed).unwrap();
    std::fs::remove_dir(directory).unwrap();
}
#[cfg(windows)]
#[test]
fn h264_b_frames_keep_actual_ordered_presentation_timestamps() {
    let path = fixture_mode("bframes");
    let mut times = vec![];
    sample_frames(
        &path,
        SamplingOptions {
            interval_seconds: 0.1,
            ..Default::default()
        },
        &CancellationToken::default(),
        |frame| {
            assert_eq!(frame.timestamp_timescale, 10_000_000);
            assert_eq!(
                frame.timestamp_seconds,
                frame.timestamp_value as f64 / 10_000_000.
            );
            times.push(frame.timestamp_seconds);
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(times, (0..30).map(|i| i as f64 / 10.).collect::<Vec<_>>());
    std::fs::remove_file(path).unwrap();
}
#[cfg(windows)]
#[test]
fn cancellation_during_skipped_scan_releases_reader() {
    let path = fixture_mode("long");
    let cancel = CancellationToken::default();
    let signalled = cancel.clone();
    let (send, receive) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        receive.recv().unwrap();
        signalled.cancel();
    });
    let mut send = Some(send);
    let error = sample_frames(
        &path,
        SamplingOptions {
            start_seconds: 59.,
            ..Default::default()
        },
        &cancel,
        |_| Ok(()),
        |_| {
            if let Some(send) = send.take() {
                send.send(()).unwrap();
            }
        },
    )
    .unwrap_err();
    thread.join().unwrap();
    assert_eq!(error.kind, ErrorKind::Cancelled);
    std::fs::remove_file(path).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn late_seek_matches_sequential_frames_for_vfr_and_h264() {
    for mode in ["seek-vfr", "seek-bframes"] {
        let path = fixture_mode(mode);
        let cancel = CancellationToken::default();
        let mut baseline = vec![];
        sample_frames(
            &path,
            SamplingOptions {
                interval_seconds: 0.001,
                ..Default::default()
            },
            &cancel,
            |frame| {
                baseline.push(frame);
                Ok(())
            },
            |_| {},
        )
        .unwrap();
        assert!(baseline.len() >= 290, "{mode}: {}", baseline.len());
        for target in [
            20.0,
            baseline[200].timestamp_seconds,
            baseline[200].timestamp_seconds + 0.001,
            baseline[baseline.len() - 2].timestamp_seconds + 0.001,
            baseline.last().unwrap().timestamp_seconds,
        ] {
            let expected = baseline
                .iter()
                .find(|frame| frame.timestamp_seconds >= target)
                .unwrap();
            let actual = extract_frame(
                &path,
                target,
                ResizeOptions::default(),
                PixelFormat::Rgb8,
                &cancel,
            )
            .unwrap();
            assert_eq!(
                (actual.timestamp_value, actual.timestamp_timescale),
                (expected.timestamp_value, expected.timestamp_timescale),
                "{mode} target {target}"
            );
            assert_eq!(actual.pixels, expected.pixels, "{mode} target {target}");
        }
        let start = baseline[200].timestamp_seconds + 0.001;
        let end = baseline[220].timestamp_seconds;
        let mut sampled = vec![];
        sample_frames(
            &path,
            SamplingOptions {
                start_seconds: start,
                end_seconds: Some(end),
                interval_seconds: 0.001,
                ..Default::default()
            },
            &cancel,
            |frame| {
                sampled.push((
                    frame.timestamp_value,
                    frame.timestamp_timescale,
                    frame.pixels,
                ));
                Ok(())
            },
            |_| {},
        )
        .unwrap();
        let expected: Vec<_> = baseline
            .iter()
            .filter(|frame| frame.timestamp_seconds >= start && frame.timestamp_seconds < end)
            .map(|frame| {
                (
                    frame.timestamp_value,
                    frame.timestamp_timescale,
                    frame.pixels.clone(),
                )
            })
            .collect();
        assert_eq!(sampled, expected, "{mode}");
        let cancelled = CancellationToken::default();
        let result = sample_frames(
            &path,
            SamplingOptions {
                start_seconds: start,
                ..Default::default()
            },
            &cancelled,
            |_| {
                cancelled.cancel();
                Ok(())
            },
            |_| {},
        );
        assert_eq!(result.unwrap_err().kind, ErrorKind::Cancelled);
        assert_eq!(
            extract_frame(
                &path,
                1000.0,
                ResizeOptions::default(),
                PixelFormat::Rgb8,
                &cancel
            )
            .unwrap_err()
            .kind,
            ErrorKind::FrameUnavailable
        );
        std::fs::remove_file(path).unwrap();
    }
}

#[cfg(target_os = "macos")]
#[test]
fn seek_on_subsecond_clip_matches_sequential_frames() {
    let path = fixture_mode("cfr");
    let cancel = CancellationToken::default();
    assert!(inspect(&path, &cancel).unwrap().duration_seconds < 1.0);
    let mut baseline = vec![];
    sample_frames(
        &path,
        SamplingOptions {
            interval_seconds: 0.001,
            ..Default::default()
        },
        &cancel,
        |frame| {
            baseline.push(frame);
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(baseline.len(), 8);
    for target in [0.0, 0.3, 0.301, 0.7] {
        let expected = baseline
            .iter()
            .find(|frame| frame.timestamp_seconds >= target)
            .unwrap();
        let actual = extract_frame(
            &path,
            target,
            ResizeOptions::default(),
            PixelFormat::Rgb8,
            &cancel,
        )
        .unwrap();
        assert_eq!(
            (
                actual.timestamp_value,
                actual.timestamp_timescale,
                actual.pixels
            ),
            (
                expected.timestamp_value,
                expected.timestamp_timescale,
                expected.pixels.clone()
            ),
            "target {target}"
        );
    }
    assert_eq!(
        extract_frame(
            &path,
            0.8,
            ResizeOptions::default(),
            PixelFormat::Rgb8,
            &cancel
        )
        .unwrap_err()
        .kind,
        ErrorKind::FrameUnavailable
    );
    std::fs::remove_file(path).unwrap();
}
