use super::*;
use std::ffi::{c_char, c_void, CStr, CString};
#[repr(C)]
#[derive(Default)]
struct Metadata {
    duration: f64,
    fps: f64,
    start: f64,
    width: u32,
    height: u32,
    timescale: i32,
}
#[repr(C)]
#[derive(Default)]
struct Timestamp {
    seconds: f64,
    value: i64,
    timescale: i32,
}
extern "C" {
    fn apex_video_open(
        path: *const c_char,
        start: f64,
        meta: *mut Metadata,
        error: *mut c_char,
    ) -> *mut c_void;
    fn apex_video_next(
        handle: *mut c_void,
        minimum: f64,
        width: u32,
        height: u32,
        rgba: *mut u8,
        length: usize,
        timestamp: *mut Timestamp,
        error: *mut c_char,
    ) -> i32;
    fn apex_video_close(handle: *mut c_void);
}
fn native_error(error: &[c_char; 1024]) -> VideoAnalysisError {
    VideoAnalysisError::new(
        ErrorKind::Decode,
        unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy(),
    )
}
pub(super) struct Decoder {
    handle: *mut c_void,
    meta: VideoAnalysisMetadata,
}
impl Decoder {
    pub fn open(path: &Path, start: f64) -> Result<Self> {
        let path =
            CString::new(path.to_str().ok_or_else(|| {
                VideoAnalysisError::new(ErrorKind::InvalidInput, "Non-Unicode path")
            })?)
            .map_err(|_| VideoAnalysisError::new(ErrorKind::InvalidInput, "Path contains NUL"))?;
        let mut meta = Metadata::default();
        let mut error = [0; 1024];
        let handle =
            unsafe { apex_video_open(path.as_ptr(), start, &mut meta, error.as_mut_ptr()) };
        if handle.is_null() {
            return Err(native_error(&error));
        }
        Ok(Self {
            handle,
            meta: VideoAnalysisMetadata {
                duration_seconds: meta.duration,
                nominal_frame_rate: if meta.fps.is_finite() && meta.fps > 0.0 {
                    Some(meta.fps)
                } else {
                    None
                },
                width: meta.width,
                height: meta.height,
                track_start_seconds: meta.start,
                timebase_timescale: meta.timescale,
            },
        })
    }
    pub fn metadata(&self) -> VideoAnalysisMetadata {
        self.meta.clone()
    }
    pub fn next(
        &mut self,
        minimum: f64,
        (width, height): (u32, u32),
        format: PixelFormat,
        cancel: &CancellationToken,
    ) -> Result<Option<SampledVideoFrame>> {
        let mut rgba = vec![0; width as usize * height as usize * 4];
        loop {
            cancel.check()?;
            let mut timestamp = Timestamp::default();
            let mut error = [0; 1024];
            let status = unsafe {
                apex_video_next(
                    self.handle,
                    minimum,
                    width,
                    height,
                    rgba.as_mut_ptr(),
                    rgba.len(),
                    &mut timestamp,
                    error.as_mut_ptr(),
                )
            };
            cancel.check()?;
            match status {
                0 => return Ok(None),
                2 => continue,
                1 => {}
                _ => return Err(native_error(&error)),
            }
            let channels = match format {
                PixelFormat::Rgb8 => 3,
                PixelFormat::Gray8 => 1,
            };
            let mut pixels = Vec::with_capacity(width as usize * height as usize * channels);
            // Core Image bitmap rendering writes tightly packed top-down rows.
            for row in rgba.chunks_exact(width as usize * 4) {
                for p in row.chunks_exact(4) {
                    match format {
                        PixelFormat::Rgb8 => pixels.extend_from_slice(&p[..3]),
                        PixelFormat::Gray8 => pixels.push(
                            ((77 * p[0] as u32 + 150 * p[1] as u32 + 29 * p[2] as u32 + 128) >> 8)
                                as u8,
                        ),
                    }
                }
            }
            return Ok(Some(SampledVideoFrame {
                timestamp_seconds: timestamp.seconds,
                timestamp_value: timestamp.value,
                timestamp_timescale: timestamp.timescale,
                width,
                height,
                pixel_format: format,
                pixels,
            }));
        }
    }
}
impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { apex_video_close(self.handle) }
    }
}
