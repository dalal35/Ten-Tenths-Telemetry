use super::{motion::MotionTracker, PixelFormat, SampledVideoFrame};

fn frame(time: f64, shift: usize, textured: bool) -> SampledVideoFrame {
    let (width, height) = (128usize, 96usize);
    let mut pixels = vec![0; width * height];
    if textured {
        for y in 8..height - 8 {
            for x in 8..width - 8 {
                let source = x.saturating_sub(shift);
                pixels[y * width + x] = if ((source / 5) + (y / 5)) % 2 == 0 {
                    220
                } else {
                    30
                };
            }
        }
    }
    SampledVideoFrame {
        timestamp_seconds: time,
        timestamp_value: (time * 1000.0) as i64,
        timestamp_timescale: 1000,
        width: width as u32,
        height: height as u32,
        pixel_format: PixelFormat::Gray8,
        pixels,
    }
}

#[test]
fn tracks_translation_with_actual_pts() {
    let mut tracker = MotionTracker::new(128, 96).unwrap();
    assert!(tracker.push(&frame(0.03, 0, true)).unwrap().yaw.is_none());
    let sample = tracker.push(&frame(0.23, 3, true)).unwrap();
    assert_eq!(sample.time, 0.23);
    assert!((sample.yaw.unwrap() - 15.0).abs() < 1.0);
    let mut slower = MotionTracker::new(128, 96).unwrap();
    slower.push(&frame(0.03, 0, true)).unwrap();
    let sample = slower.push(&frame(0.43, 3, true)).unwrap();
    assert!((sample.yaw.unwrap() - 7.5).abs() < 0.5);
    assert!(sample.quality > 0.0);
}

#[test]
fn stationary_and_untextured_have_no_yaw() {
    let mut tracker = MotionTracker::new(128, 96).unwrap();
    tracker.push(&frame(0.0, 0, true)).unwrap();
    assert!(tracker.push(&frame(0.2, 0, true)).unwrap().yaw.is_none());
    tracker.push(&frame(1.0, 0, false)).unwrap();
    assert!(tracker.push(&frame(1.2, 0, false)).unwrap().yaw.is_none());
}

#[test]
fn rejects_bad_dimensions_and_nonmonotonic_pts_and_resets_after_gap() {
    assert!(MotionTracker::new(0, 96).is_err());
    let mut tracker = MotionTracker::new(128, 96).unwrap();
    let mut bad = frame(0.0, 0, true);
    bad.pixels.pop();
    assert!(tracker.push(&bad).is_err());
    tracker.push(&frame(0.0, 0, true)).unwrap();
    assert!(tracker.push(&frame(0.0, 1, true)).is_err());
    assert!(tracker.push(&frame(2.0, 3, true)).unwrap().yaw.is_none());
    drop(tracker);
}
