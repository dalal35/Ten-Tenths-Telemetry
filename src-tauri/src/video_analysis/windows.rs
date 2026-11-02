//! Thread-confined synchronous Media Foundation reader. No COM object crosses a worker.
use super::windows_pixels;
use super::*;
use ::windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Media::MediaFoundation::*,
        System::Com::{
            CoInitializeEx, CoUninitialize,
            StructuredStorage::{PropVariantClear, PropVariantToUInt64},
            COINIT_MULTITHREADED,
        },
    },
};
use std::{marker::PhantomData, os::windows::ffi::OsStrExt, rc::Rc};
const VIDEO: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
const TICKS: i32 = 10_000_000;
fn native<T>(operation: &str, result: ::windows::core::Result<T>) -> Result<T> {
    result.map_err(|e| VideoAnalysisError::new(ErrorKind::Decode, format!("{operation}: {e} (HRESULT 0x{:08X}). Check Windows media components and codec support.", e.code().0 as u32)))
}
fn invalid(message: &str) -> VideoAnalysisError {
    VideoAnalysisError::new(ErrorKind::Decode, message)
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() }
    }
}
struct Runtime {
    _apartment: Apartment,
    _thread: PhantomData<Rc<()>>,
}
impl Runtime {
    fn new() -> Result<Self> {
        unsafe {
            native(
                "Initialize COM",
                CoInitializeEx(None, COINIT_MULTITHREADED).ok(),
            )?;
            let apartment = Apartment;
            native(
                "Start Media Foundation",
                MFStartup(MF_VERSION, MFSTARTUP_FULL),
            )?;
            Ok(Self {
                _apartment: apartment,
                _thread: PhantomData,
            })
        }
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
        }
    }
}
#[derive(Clone, Copy)]
struct Layout {
    height: u32,
    stride: i32,
    visible: (u32, u32, u32, u32),
    rotation: u32,
}
impl Layout {
    fn read(reader: &IMFSourceReader) -> Result<Self> {
        unsafe {
            let media = native("Read decoded media type", reader.GetCurrentMediaType(VIDEO))?;
            if native("Read decoded subtype", media.GetGUID(&MF_MT_SUBTYPE))? != MFVideoFormat_RGB32
            {
                return Err(invalid("Decoder changed to an unsupported pixel format"));
            }
            let packed = native("Read frame dimensions", media.GetUINT64(&MF_MT_FRAME_SIZE))?;
            let (width, height) = ((packed >> 32) as u32, packed as u32);
            if width == 0
                || height == 0
                || width > 65536
                || height > 65536
                || width as u64 * height as u64 * 4 > 512 * 1024 * 1024
            {
                return Err(invalid("Invalid or excessive decoded frame dimensions"));
            }
            let rotation = reader
                .GetNativeMediaType(VIDEO, 0)
                .ok()
                .and_then(|m| m.GetUINT32(&MF_MT_VIDEO_ROTATION).ok())
                .unwrap_or(0);
            if ![0, 90, 180, 270].contains(&rotation) {
                return Err(invalid("Unsupported video rotation"));
            }
            let stride = media
                .GetUINT32(&MF_MT_DEFAULT_STRIDE)
                .map(|n| n as i32)
                .unwrap_or((width * 4) as i32);
            if (stride as i64).abs() < width as i64 * 4 {
                return Err(invalid("Invalid decoded row stride"));
            }
            // The decoded surface can include alignment rows outside the display aperture.
            // MFVideoArea uses two 16.16 offsets followed by signed dimensions.
            let mut visible = (0, 0, width, height);
            for key in [&MF_MT_MINIMUM_DISPLAY_APERTURE, &MF_MT_GEOMETRIC_APERTURE] {
                let mut data = [0u8; 16];
                let mut size = 0;
                match media.GetBlob(key, &mut data, Some(&mut size)) {
                    Ok(()) => {
                        if size != 16 {
                            return Err(invalid("Invalid video aperture"));
                        }
                        let frac_x = u16::from_le_bytes([data[0], data[1]]);
                        let x = i16::from_le_bytes([data[2], data[3]]);
                        let frac_y = u16::from_le_bytes([data[4], data[5]]);
                        let y = i16::from_le_bytes([data[6], data[7]]);
                        let w = i32::from_le_bytes(data[8..12].try_into().unwrap());
                        let h = i32::from_le_bytes(data[12..16].try_into().unwrap());
                        if frac_x != 0
                            || frac_y != 0
                            || x < 0
                            || y < 0
                            || w <= 0
                            || h <= 0
                            || x as u64 + w as u64 > width as u64
                            || y as u64 + h as u64 > height as u64
                        {
                            return Err(invalid("Unsupported or invalid video aperture"));
                        }
                        visible = (x as u32, y as u32, w as u32, h as u32);
                        break;
                    }
                    Err(e) if e.code() == MF_E_ATTRIBUTENOTFOUND => {}
                    Err(e) => {
                        return Err(VideoAnalysisError::new(
                            ErrorKind::Decode,
                            format!("Read video aperture: {e}"),
                        ))
                    }
                }
            }
            Ok(Self {
                height,
                stride,
                visible,
                rotation,
            })
        }
    }
    fn display(self) -> (u32, u32) {
        if self.rotation == 90 || self.rotation == 270 {
            (self.visible.3, self.visible.2)
        } else {
            (self.visible.2, self.visible.3)
        }
    }
}
pub(super) struct Decoder {
    // Rust drops fields in declaration order. Native interfaces precede runtime teardown.
    pending: Option<(IMFSample, i64)>,
    reader: IMFSourceReader,
    _stream: IMFByteStream,
    meta: VideoAnalysisMetadata,
    layout: Layout,
    eof: bool,
    last: Option<i64>,
    _runtime: Runtime,
}
impl Decoder {
    pub fn open(path: &Path, cancel: &CancellationToken) -> Result<Self> {
        unsafe {
            let runtime = Runtime::new()?;
            // Setup interfaces must release while this scope still owns the runtime.
            // In particular, first-sample failure must not shut down MF/COM before
            // releasing the temporary attributes and media types.
            let (reader, stream, layout, duration_seconds, rate) = {
                let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
                if wide.contains(&0) {
                    return Err(VideoAnalysisError::new(
                        ErrorKind::InvalidInput,
                        "Path contains NUL",
                    ));
                }
                wide.push(0);
                let mut attributes = None;
                native(
                    "Create reader attributes",
                    MFCreateAttributes(&mut attributes, 2),
                )?;
                let attributes =
                    attributes.ok_or_else(|| invalid("Reader attributes unavailable"))?;
                native(
                    "Enable RGB video conversion",
                    attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1),
                )?;
                native(
                    "Disable hardware transforms",
                    attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 0),
                )?;
                // canonicalize yields extended-length Windows paths (\\?\...).
                // Open the filename directly: the URL resolver interprets that
                // prefix as a network URL instead of a local filesystem path.
                let stream = native(
                    "Open local video",
                    MFCreateFile(
                        MF_ACCESSMODE_READ,
                        MF_OPENMODE_FAIL_IF_NOT_EXIST,
                        MF_FILEFLAGS_NONE,
                        PCWSTR(wide.as_ptr()),
                    ),
                )?;
                let reader = native(
                    "Create local video reader",
                    MFCreateSourceReaderFromByteStream(&stream, &attributes),
                )?;
                native(
                    "Deselect unrelated streams",
                    reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false),
                )?;
                native(
                    "Select video stream",
                    reader.SetStreamSelection(VIDEO, true),
                )?;
                let media = native("Create output media type", MFCreateMediaType())?;
                native(
                    "Set video output",
                    media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video),
                )?;
                native(
                    "Set RGB32 output",
                    media.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32),
                )?;
                native(
                    "Configure video decoder",
                    reader.SetCurrentMediaType(VIDEO, None, &media),
                )?;
                let layout = Layout::read(&reader)?;
                let mut duration = native(
                    "Read video duration",
                    reader.GetPresentationAttribute(
                        MF_SOURCE_READER_MEDIASOURCE.0 as u32,
                        &MF_PD_DURATION,
                    ),
                )?;
                let ticks = PropVariantToUInt64(&duration);
                let _ = PropVariantClear(&mut duration);
                let duration_seconds =
                    native("Convert video duration", ticks)? as f64 / TICKS as f64;
                if !duration_seconds.is_finite() || duration_seconds <= 0. {
                    return Err(invalid("Invalid video duration"));
                }
                let current = native("Read video timing", reader.GetCurrentMediaType(VIDEO))?;
                let rate = current.GetUINT64(&MF_MT_FRAME_RATE).ok().and_then(|r| {
                    let (n, d) = ((r >> 32) as u32, r as u32);
                    if n > 0 && d > 0 {
                        Some(n as f64 / d as f64)
                    } else {
                        None
                    }
                });
                (reader, stream, layout, duration_seconds, rate)
            };
            let (width, height) = layout.display();
            let mut decoder = Self {
                pending: None,
                reader,
                _stream: stream,
                meta: VideoAnalysisMetadata {
                    duration_seconds,
                    nominal_frame_rate: rate,
                    width,
                    height,
                    track_start_seconds: 0.,
                    timebase_timescale: TICKS,
                },
                layout,
                eof: false,
                last: None,
                _runtime: runtime,
            };
            // The first source PTS describes track start; retain its sample for extraction.
            let first = decoder
                .read(cancel)?
                .ok_or_else(|| invalid("Video track has no decoded frames"))?;
            decoder.meta.track_start_seconds = first.1 as f64 / TICKS as f64;
            decoder.pending = Some(first);
            Ok(decoder)
        }
    }
    pub fn metadata(&self) -> VideoAnalysisMetadata {
        self.meta.clone()
    }
    fn read(&mut self, cancel: &CancellationToken) -> Result<Option<(IMFSample, i64)>> {
        unsafe {
            while !self.eof {
                cancel.check()?;
                let (mut flags, mut time, mut sample) = (0, 0, None);
                native(
                    "Read video sample",
                    self.reader.ReadSample(
                        VIDEO,
                        0,
                        None,
                        Some(&mut flags),
                        Some(&mut time),
                        Some(&mut sample),
                    ),
                )?;
                cancel.check()?;
                if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 {
                    return Err(invalid("Media Foundation reported a decode error"));
                }
                if flags
                    & (MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED.0
                        | MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED.0) as u32
                    != 0
                {
                    let next = Layout::read(&self.reader)?;
                    if next.display() != self.layout.display() {
                        return Err(invalid("Video display dimensions changed during analysis"));
                    }
                    self.layout = next;
                }
                self.eof = flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0;
                if let Some(sample) = sample {
                    let pts = native("Read sample presentation timestamp", sample.GetSampleTime())?;
                    if self.last.is_some_and(|last| pts < last) {
                        return Err(invalid("Video presentation timestamps are not ordered"));
                    }
                    self.last = Some(pts);
                    return Ok(Some((sample, pts)));
                }
                // Stream ticks and null samples carry no pixels. Continue, polling cancel.
            }
            Ok(None)
        }
    }
    pub fn next(
        &mut self,
        minimum: f64,
        dimensions: (u32, u32),
        format: PixelFormat,
        cancel: &CancellationToken,
    ) -> Result<Option<SampledVideoFrame>> {
        loop {
            cancel.check()?;
            let next = match self.pending.take() {
                Some(s) => Some(s),
                None => self.read(cancel)?,
            };
            let Some((sample, ticks)) = next else {
                return Ok(None);
            };
            let timestamp_seconds = ticks as f64 / TICKS as f64;
            if timestamp_seconds < minimum {
                continue;
            }
            let buffer = unsafe {
                native(
                    "Get decoded image buffer",
                    sample.ConvertToContiguousBuffer(),
                )?
            };
            let locked = Locked::new(buffer, self.layout)?;
            let (x, y, width, height) = self.layout.visible;
            let top = locked.top as i128 + y as i128 * locked.stride as i128 + x as i128 * 4;
            let top =
                usize::try_from(top).map_err(|_| invalid("Invalid decoded aperture offset"))?;
            let pixels = windows_pixels::convert(
                locked.bytes(),
                top,
                locked.stride,
                (width, height),
                self.layout.rotation,
                dimensions,
                format,
            )?;
            cancel.check()?;
            return Ok(Some(SampledVideoFrame {
                timestamp_seconds,
                timestamp_value: ticks,
                timestamp_timescale: TICKS,
                width: dimensions.0,
                height: dimensions.1,
                pixel_format: format,
                pixels,
            }));
        }
    }
}
// Lock guards guarantee release on pixel-validation errors and cancellation.
enum LockOwner {
    TwoD(IMF2DBuffer2),
    Linear(IMFMediaBuffer),
}
struct Locked {
    owner: LockOwner,
    base: *mut u8,
    length: usize,
    top: usize,
    stride: i32,
}
impl Locked {
    fn new(buffer: IMFMediaBuffer, layout: Layout) -> Result<Self> {
        unsafe {
            if let Ok(two_d) = buffer.cast::<IMF2DBuffer2>() {
                let (mut top, mut base, mut stride, mut length) =
                    (std::ptr::null_mut(), std::ptr::null_mut(), 0, 0);
                native(
                    "Lock decoded 2D pixels",
                    two_d.Lock2DSize(
                        MF2DBuffer_LockFlags_Read,
                        &mut top,
                        &mut stride,
                        &mut base,
                        &mut length,
                    ),
                )?;
                let offset = (top as usize).checked_sub(base as usize);
                let locked = Self {
                    owner: LockOwner::TwoD(two_d),
                    base,
                    length: length as usize,
                    top: offset.unwrap_or(usize::MAX),
                    stride,
                };
                locked.validate()?;
                Ok(locked)
            } else {
                let (mut base, mut length) = (std::ptr::null_mut(), 0);
                native(
                    "Lock decoded pixels",
                    buffer.Lock(&mut base, None, Some(&mut length)),
                )?;
                let top = if layout.stride < 0 {
                    (layout.height - 1) as usize * (layout.stride as i64).unsigned_abs() as usize
                } else {
                    0
                };
                let locked = Self {
                    owner: LockOwner::Linear(buffer),
                    base,
                    length: length as usize,
                    top,
                    stride: layout.stride,
                };
                locked.validate()?;
                Ok(locked)
            }
        }
    }
    fn validate(&self) -> Result<()> {
        if self.base.is_null()
            || self.length == 0
            || self.length > 512 * 1024 * 1024
            || self.top >= self.length
            || (self.base as usize).checked_add(self.length).is_none()
        {
            return Err(invalid("Invalid native decoded buffer"));
        }
        Ok(())
    }
    fn bytes(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.base, self.length) }
    }
}
impl Drop for Locked {
    fn drop(&mut self) {
        unsafe {
            match &self.owner {
                LockOwner::TwoD(buffer) => {
                    let _ = buffer.Unlock2D();
                }
                LockOwner::Linear(buffer) => {
                    let _ = buffer.Unlock();
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "../../tests/fixtures/windows_generate.rs"]
mod first_sample_fixture;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_reaches_initial_sample_discovery() {
        let path =
            std::env::temp_dir().join(format!("apex-initial-cancel-{}.mp4", std::process::id()));
        first_sample_fixture::generate(&path, "").unwrap();
        let cancel = CancellationToken::default();
        cancel.cancel();
        // Exercise Decoder directly: the shared pre-open check cannot hide a lost token.
        let error = match Decoder::open(&path, &cancel) {
            Ok(_) => panic!("initial read ignored cancellation"),
            Err(e) => e,
        };
        assert_eq!(error.kind, ErrorKind::Cancelled);
        std::fs::remove_file(path).unwrap();
    }
}
