//! Resolve recording-local telemetry without joining independent logger clocks.
use crate::telemetry::{self, Analysis, Lap, LapSource, Session};

pub(super) fn recording<'a>(session: &'a Session, lap: &Lap) -> Option<&'a Session> {
    let Some(merge) = &session.merge else {
        return Some(session);
    };
    let descriptor = merge.preview.laps.iter().find(|l| l.lap.id == lap.id)?;
    merge
        .sources
        .iter()
        .find(|s| s.reference.session_id == descriptor.source_session_id)
        .map(|s| &s.session)
}

pub(super) fn analyze(
    session: &Session,
    primary: &Lap,
    comparison: Option<&Lap>,
    boundaries: Option<&[f64]>,
) -> Result<Analysis, String> {
    let source =
        |lap| recording(session, lap).ok_or("Original recording is unavailable for coaching");
    telemetry::analyze_sources(
        LapSource {
            session: source(primary)?,
            lap: primary,
        },
        comparison
            .map(|lap| source(lap).map(|session| LapSource { session, lap }))
            .transpose()?,
        "time",
        &[],
        boundaries,
    )
}

pub(super) fn speed<'a>(session: &'a Session, lap: &Lap) -> Option<&'a telemetry::Channel> {
    recording(session, lap)?
        .channels
        .iter()
        .find(|c| c.id == "gps-speed" && c.unit == "m/s")
}
