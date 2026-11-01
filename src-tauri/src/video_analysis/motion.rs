use super::{ErrorKind, PixelFormat, SampledVideoFrame, VideoAnalysisError};

#[derive(Debug, Clone, Copy)]
pub struct MotionSample {
    pub time: f64,
    pub yaw: Option<f64>,
    pub quality: f64,
}

pub struct MotionTracker {
    width: u32,
    height: u32,
    previous_time: Option<f64>,
    tracking_support: Option<f64>,
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    handle: std::ptr::NonNull<std::ffi::c_void>,
}
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" {
    fn motion_create() -> *mut std::ffi::c_void;
    fn motion_destroy(p: *mut std::ffi::c_void);
    fn motion_push(
        p: *mut std::ffi::c_void,
        pixels: *const u8,
        width: i32,
        height: i32,
        reset: i32,
        yaw: *mut f64,
        quality: *mut f64,
        support: *mut f64,
    ) -> i32;
}
impl MotionTracker {
    pub fn new(width: u32, height: u32) -> Result<Self, VideoAnalysisError> {
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidOptions,
                "Invalid tracker dimensions",
            ));
        }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            let handle = std::ptr::NonNull::new(unsafe { motion_create() }).ok_or_else(|| {
                VideoAnalysisError::new(ErrorKind::Consumer, "Could not create motion tracker")
            })?;
            Ok(Self {
                width,
                height,
                previous_time: None,
                tracking_support: None,
                handle,
            })
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            Err(VideoAnalysisError::new(
                ErrorKind::UnsupportedPlatform,
                "Motion tracking requires Apple Silicon macOS",
            ))
        }
    }
    pub fn tracking_support(&self) -> Option<f64> {
        self.tracking_support
    }
    pub fn push(&mut self, frame: &SampledVideoFrame) -> Result<MotionSample, VideoAnalysisError> {
        if frame.width != self.width
            || frame.height != self.height
            || !matches!(frame.pixel_format, PixelFormat::Gray8)
            || frame.pixels.len() != self.width as usize * self.height as usize
            || !frame.timestamp_seconds.is_finite()
            || frame.timestamp_seconds < 0.0
            || self
                .previous_time
                .is_some_and(|time| frame.timestamp_seconds <= time)
        {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidInput,
                "Invalid motion frame or timestamp",
            ));
        }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            let reset = self
                .previous_time
                .is_none_or(|time| frame.timestamp_seconds - time > 0.5);
            let (mut yaw, mut quality, mut support) = (0.0, 0.0, -1.0);
            if unsafe {
                motion_push(
                    self.handle.as_ptr(),
                    frame.pixels.as_ptr(),
                    self.width as i32,
                    self.height as i32,
                    reset as i32,
                    &mut yaw,
                    &mut quality,
                    &mut support,
                )
            } != 0
            {
                return Err(VideoAnalysisError::new(
                    ErrorKind::Consumer,
                    "OpenCV motion tracking failed",
                ));
            }
            let elapsed = self
                .previous_time
                .map(|time| frame.timestamp_seconds - time);
            self.previous_time = Some(frame.timestamp_seconds);
            self.tracking_support = (support >= 0.0).then_some(support);
            Ok(MotionSample {
                time: frame.timestamp_seconds,
                yaw: elapsed.filter(|_| quality > 0.0).map(|dt| yaw / dt),
                quality,
            })
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            Err(VideoAnalysisError::new(
                ErrorKind::UnsupportedPlatform,
                "Motion tracking requires Apple Silicon macOS",
            ))
        }
    }
}
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
impl Drop for MotionTracker {
    fn drop(&mut self) {
        unsafe { motion_destroy(self.handle.as_ptr()) }
    }
}

#[cfg(all(test, not(all(target_os = "macos", target_arch = "aarch64"))))]
mod unsupported_tests {
    use super::*;
    #[test]
    fn tracker_reports_unsupported_platform() {
        let error = match MotionTracker::new(128, 96) {
            Ok(_) => panic!("tracker must reject unsupported platforms"),
            Err(error) => error,
        };
        assert_eq!(error.kind, ErrorKind::UnsupportedPlatform);
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" {
    fn scene_descriptor(
        pixels: *const u8,
        width: i32,
        height: i32,
        output: *mut f32,
        checker: *mut f64,
    ) -> i32;
}

pub fn appearance_descriptor(frame: &SampledVideoFrame) -> Result<[f32; 192], VideoAnalysisError> {
    scene_features(frame, false).map(|(descriptor, _)| descriptor)
}
pub fn appearance_features(
    frame: &SampledVideoFrame,
) -> Result<([f32; 192], f64), VideoAnalysisError> {
    scene_features(frame, true)
}
fn scene_features(
    frame: &SampledVideoFrame,
    checker_needed: bool,
) -> Result<([f32; 192], f64), VideoAnalysisError> {
    if frame.width < 16
        || frame.height < 12
        || frame.width > 4096
        || frame.height > 4096
        || !matches!(frame.pixel_format, PixelFormat::Gray8)
        || frame.pixels.len() != frame.width as usize * frame.height as usize
        || !frame.timestamp_seconds.is_finite()
        || frame.timestamp_seconds < 0.0
    {
        return Err(VideoAnalysisError::new(
            ErrorKind::InvalidInput,
            "Invalid scene frame",
        ));
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let mut output = [0.0; 192];
        let mut checker = 0.0;
        if unsafe {
            scene_descriptor(
                frame.pixels.as_ptr(),
                frame.width as i32,
                frame.height as i32,
                output.as_mut_ptr(),
                if checker_needed {
                    &mut checker
                } else {
                    std::ptr::null_mut()
                },
            )
        } != 0
        {
            return Err(VideoAnalysisError::new(
                ErrorKind::Consumer,
                "OpenCV scene descriptor failed",
            ));
        }
        Ok((output, checker))
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    Err(VideoAnalysisError::new(
        ErrorKind::UnsupportedPlatform,
        "Scene descriptors require Apple Silicon macOS",
    ))
}

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod scene_tests {
    use super::*;
    fn scene(brighter: bool) -> SampledVideoFrame {
        SampledVideoFrame {
            timestamp_seconds: 0.03,
            timestamp_value: 3,
            timestamp_timescale: 100,
            width: 64,
            height: 48,
            pixel_format: PixelFormat::Gray8,
            pixels: (0..64 * 48)
                .map(|i| {
                    let v = ((i * 31 + i / 64 * 47) % 120 + 20) as u8;
                    if brighter {
                        v + 50
                    } else {
                        v
                    }
                })
                .collect(),
        }
    }
    #[test]
    fn checker_salience_rejects_edges_and_noise_and_survives_lighting_and_occlusion() {
        let pattern = |kind: u8, dim: bool, occlude: bool| {
            let mut frame = scene(false);
            frame.width = 320;
            frame.height = 180;
            frame.pixels = (0..320 * 180)
                .map(|i| {
                    let (x, y) = (i % 320, i / 320);
                    let bright = match kind {
                        0 => false,
                        1 => x > 160,
                        2 => ((x / 24) + (y / 12)) % 2 == 0,
                        _ => ((i * 1103515245_u64 + 12345) >> 16) % 2 == 0,
                    };
                    if occlude && x > 90 {
                        100
                    } else if dim {
                        if bright {
                            150
                        } else {
                            50
                        }
                    } else if bright {
                        230
                    } else {
                        20
                    }
                })
                .collect();
            frame
        };
        let checker = appearance_features(&pattern(2, false, false)).unwrap().1;
        assert!(checker > 0.5, "checker score {checker}");
        for kind in [0, 1, 3] {
            let score = appearance_features(&pattern(kind, false, false)).unwrap().1;
            assert!(score < 0.15, "negative kind {kind} score {score}");
        }
        assert!(appearance_features(&pattern(2, true, false)).unwrap().1 > 0.25);
        assert!(appearance_features(&pattern(2, false, true)).unwrap().1 > 0.2);
    }
    #[test]
    fn fixed_central_helmet_alone_does_not_certify_road_geometry() {
        let frame = |time: f64, changed: bool| {
            let mut frame = scene(false);
            frame.width = 320;
            frame.height = 180;
            frame.timestamp_seconds = time;
            frame.pixels = (0..320 * 180)
                .map(|i| {
                    let (x, y) = (i % 320, i / 320);
                    if y >= 117 && x >= 90 && x < 272 {
                        (((i as u64 * 1103515245 + 12345) >> 16) % 220 + 20) as u8
                    } else if changed {
                        41
                    } else {
                        40
                    }
                })
                .collect();
            frame
        };
        let mut tracker = MotionTracker::new(320, 180).unwrap();
        tracker.push(&frame(0., false)).unwrap();
        tracker.push(&frame(0.05, true)).unwrap();
        assert!(
            tracker
                .tracking_support()
                .is_none_or(|support| support < 0.1),
            "fixed helmet support: {:?}",
            tracker.tracking_support()
        );
    }
    #[test]
    fn appearance_normalization_and_stationary_geometry_are_independent_of_yaw() {
        let a = scene(false);
        let mut b = scene(true);
        let da = appearance_descriptor(&a).unwrap();
        let db = appearance_descriptor(&b).unwrap();
        assert!(da.iter().zip(db).all(|(a, b)| (a - b).abs() < 0.00001));
        let mut tracker = MotionTracker::new(64, 48).unwrap();
        tracker.push(&a).unwrap();
        assert!(tracker.tracking_support().is_none());
        b.pixels = a.pixels.clone();
        b.timestamp_seconds = 0.43;
        assert!(tracker.push(&b).unwrap().yaw.is_none());
        assert!(tracker.tracking_support().unwrap() > 0.9);
        b.width = 1;
        assert!(appearance_descriptor(&b).is_err());
    }
}
