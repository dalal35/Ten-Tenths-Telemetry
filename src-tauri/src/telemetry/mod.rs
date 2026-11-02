use serde::{Deserialize, Serialize};
pub mod advanced;
pub mod expressions;
mod spatial;
pub use spatial::{Alignment, ChannelMean, MappingPoint, Segment, SegmentMetrics};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Path,
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    #[serde(default)]
    pub gaps: Vec<[f64; 2]>,
    pub id: String,
    pub name: String,
    pub unit: String,
    pub times: Vec<f64>,
    pub values: Vec<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Lap {
    pub id: String,
    pub number: i32,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub complete: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge: Option<crate::merging::MergeInfo>,
    pub id: String,
    pub source: String,
    pub name: String,
    pub driver: String,
    pub track: String,
    pub recorded_at: String,
    pub channels: Vec<Channel>,
    pub laps: Vec<Lap>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub gaps: Vec<[f64; 2]>,
    pub channel_id: String,
    pub name: String,
    pub unit: String,
    pub x: Vec<f64>,
    pub values: Vec<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct TrackPoint {
    #[serde(rename = "breakBefore")]
    pub break_before: bool,
    pub x: f64,
    pub y: f64,
    pub position: f64,
    pub speed: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LapView {
    pub mapping: Vec<MappingPoint>,
    pub lap_id: String,
    pub duration: f64,
    pub length: Option<f64>,
    pub series: Vec<Series>,
    pub track: Vec<TrackPoint>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delta {
    pub method: String,
    pub uncertainty_seconds: Option<f64>,
    pub x: Vec<f64>,
    pub values: Vec<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Analysis {
    #[serde(rename = "cornerBoundaries")]
    pub corner_boundaries: Option<Vec<f64>>,
    pub alignment: Alignment,
    pub segments: Vec<Segment>,
    pub primary: LapView,
    pub comparison: Option<LapView>,
    pub delta: Option<Delta>,
    pub warnings: Vec<String>,
}

fn channel(
    id: String,
    name: String,
    unit: String,
    times: Vec<i64>,
    values: Vec<f64>,
    warnings: &mut Vec<String>,
) -> Channel {
    let mut c = Channel {
        gaps: vec![],
        id,
        name,
        unit,
        times: vec![],
        values: vec![],
    };
    let mut rejected = 0;
    let mut invalid_start = None;
    let mut invalid_end = 0.;
    for (t, v) in times.into_iter().zip(values) {
        let t = t as f64 / 1000.;
        if !v.is_finite() || c.times.last().is_some_and(|last| t <= *last) {
            if !v.is_finite() {
                invalid_start.get_or_insert(c.times.last().copied().unwrap_or(t));
                invalid_end = t;
            }
            rejected += 1;
            continue;
        }
        if let Some(left) = invalid_start.take() {
            if t > left {
                c.gaps.push([left, t]);
            }
        }
        c.times.push(t);
        c.values.push(v);
    }
    if let Some(left) = invalid_start {
        if invalid_end > left {
            c.gaps.push([left, invalid_end]);
        }
    }
    if rejected > 0 {
        warnings.push(format!(
            "{}: excluded {rejected} non-finite or non-increasing samples from analysis.",
            c.name
        ));
    }
    c
}
fn values(v: libxrk::ChannelValues) -> Vec<f64> {
    use libxrk::ChannelValues::*;
    macro_rules! cv {
        ($v:expr) => {
            $v.into_iter().map(|x| x as f64).collect()
        };
    }
    match v {
        UInt8(v) => cv!(v),
        UInt16(v) => cv!(v),
        Int16(v) => cv!(v),
        Int32(v) => cv!(v),
        UInt32(v) => cv!(v),
        Float32(v) => cv!(v),
        Float64(v) => v,
    }
}
pub fn parse_session(path: &Path) -> Result<Session, String> {
    let file = std::panic::catch_unwind(|| libxrk::read_xrk_file(path))
        .map_err(|_| "The XRK parser could not safely decode this file.".to_string())?
        .map_err(|e| format!("Cannot decode XRK: {e}"))?;
    let mut warnings = vec![];
    let mut channels = vec![];
    for calibration in &file.metadata.calibrations {
        if !matches!(calibration.cal_type, 1 | 20) {
            warnings.push(format!("{} uses unsupported calibration type {}; values are the parser's decoded stream without a guessed transform.",calibration.channel.as_deref().unwrap_or("A channel"),calibration.cal_type));
        }
    }
    for info in file.raw.channels.values() {
        if !libxrk::decoders::is_manual_decoder(&info.chs.long_name())
            && libxrk::decoders::sample_byte_size(info.chs.decoder_type).is_none()
        {
            warnings.push(format!(
                "{} uses an unsupported channel decoder and is unavailable.",
                info.chs.long_name()
            ));
        }
        if !libxrk::tables::is_known_unit(info.chs.unit_type_byte) {
            warnings.push(format!(
                "{} has an unknown unit; numerical conversions are disabled.",
                info.chs.long_name()
            ));
        }
    }

    for c in file.channels {
        channels.push(channel(
            format!("channel-{}", c.index),
            c.name,
            c.units,
            c.timecodes,
            values(c.values),
            &mut warnings,
        ));
    }
    if let Some(g) = file.gps {
        macro_rules! gps {
            ($id:expr,$name:expr,$unit:expr,$v:expr) => {
                channels.push(channel(
                    $id.into(),
                    $name.into(),
                    $unit.into(),
                    g.timecodes.clone(),
                    $v,
                    &mut warnings,
                ));
            };
        }
        gps!("gps-speed", "GPS Speed", "m/s", g.speed);
        gps!("gps-latitude", "GPS Latitude", "deg", g.latitude);
        gps!("gps-longitude", "GPS Longitude", "deg", g.longitude);
        gps!("gps-altitude", "GPS Altitude", "m", g.altitude);
        gps!(
            "gps-fix",
            "GPS Fix",
            "",
            g.fix.into_iter().map(f64::from).collect()
        );
        gps!(
            "gps-satellites",
            "GPS Satellites",
            "",
            g.satellites.into_iter().map(f64::from).collect()
        );
        gps!(
            "gps-accuracy",
            "GPS Position Accuracy",
            "m",
            g.position_accuracy.into_iter().map(f64::from).collect()
        );
    }
    channels.retain(|c| !c.times.is_empty());
    if channels.is_empty() {
        return Err("No supported telemetry samples were found in this file.".into());
    }
    let start = channels
        .iter()
        .filter_map(|c| c.times.first())
        .copied()
        .fold(f64::INFINITY, f64::min);
    let end = channels
        .iter()
        .filter_map(|c| c.times.last())
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let mut laps: Vec<Lap> = file
        .laps
        .into_iter()
        .filter(|l| l.end_time > l.start_time)
        .map(|l| {
            let a = l.start_time as f64 / 1000.;
            let b = l.end_time as f64 / 1000.;
            Lap {
                id: format!("lap-{}", l.num),
                number: l.num + 1,
                start: a,
                end: b,
                duration: b - a,
                complete: l.lap_type == "full" && a >= start && b <= end,
            }
        })
        .filter(|l| l.end > l.start)
        .collect();
    if let Some(first) = laps.first() {
        if first.start - start > 1. {
            laps.insert(
                0,
                Lap {
                    id: "partial-start".into(),
                    number: 0,
                    start,
                    end: first.start,
                    duration: first.start - start,
                    complete: false,
                },
            );
        }
    }
    let last = laps.last().map_or(start, |l| l.end);
    if end - last > 1. {
        laps.push(Lap {
            id: "partial-end".into(),
            number: laps.last().map_or(1, |l| l.number + 1),
            start: last,
            end,
            duration: end - last,
            complete: false,
        });
    }
    if laps.is_empty() {
        laps.push(Lap {
            id: "session".into(),
            number: 1,
            start,
            end,
            duration: end - start,
            complete: false,
        });
        warnings.push(
            "No trustworthy lap crossings found; showing the recording as a partial lap.".into(),
        );
    }
    // LAP durations that reach the recording boundary have no subsequent crossing to validate them.
    // Upstream also classifies explicit out/in laps using the file's start/finish marker.
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    std::fs::metadata(path)
        .map(|m| m.len())
        .unwrap_or(0)
        .hash(&mut hasher);
    Ok(Session {
        merge: None,
        id: format!("session-{:x}", hasher.finish()),
        source: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        name: file
            .metadata
            .session
            .unwrap_or_else(|| "Telemetry session".into()),
        driver: file.metadata.driver.unwrap_or_default(),
        track: file.metadata.venue.unwrap_or_default(),
        recorded_at: format!(
            "{} {}",
            file.metadata.log_date.unwrap_or_default(),
            file.metadata.log_time.unwrap_or_default()
        )
        .trim()
        .into(),
        channels,
        laps,
        warnings,
    })
}
fn interpolate(t: &[f64], v: &[f64], x: f64) -> Option<f64> {
    if t.is_empty() || x < t[0] || x > *t.last()? {
        return None;
    }
    let i = t.partition_point(|a| *a < x);
    if i == 0 {
        return v.first().copied();
    }
    if i == t.len() {
        return v.last().copied();
    }
    let f = (x - t[i - 1]) / (t[i] - t[i - 1]);
    Some(v[i - 1] + f * (v[i] - v[i - 1]))
}
// A median cadence needs several source intervals; sparse channels remain unclassified.
pub(crate) fn source_gaps(c: &Channel) -> Vec<[f64; 2]> {
    if c.times.len() < 5 {
        return c.gaps.clone();
    }
    let mut steps: Vec<f64> = c
        .times
        .windows(2)
        .map(|w| w[1] - w[0])
        .filter(|dt| *dt > 0.)
        .collect();
    steps.sort_by(f64::total_cmp);
    let Some(nominal) = steps.get(steps.len() / 2) else {
        return vec![];
    };
    let threshold = 5. * nominal;
    let mut gaps = c.gaps.clone();
    gaps.extend(
        c.times
            .windows(2)
            .filter(|w| w[1] - w[0] > threshold + 1e-9)
            .map(|w| [w[0], w[1]])
            .collect::<Vec<_>>(),
    );
    gaps
}
fn gap_overlaps(gap: &[f64; 2], lap: &Lap) -> bool {
    gap[0] < lap.end && gap[1] > lap.start
}
pub(crate) fn sample_without_gaps(c: &Channel, t: f64, gaps: &[[f64; 2]]) -> Option<f64> {
    if gaps.iter().any(|g| t > g[0] && t < g[1]) {
        None
    } else {
        interpolate(&c.times, &c.values, t).filter(|v| v.is_finite())
    }
}
fn clipped(c: &Channel, lap: &Lap) -> (Vec<f64>, Vec<f64>) {
    let gaps = source_gaps(c);
    let mut t = vec![];
    let mut v = vec![];
    if let Some(y) = sample_without_gaps(c, lap.start, &gaps) {
        t.push(lap.start);
        v.push(y);
    }
    for (&x, &y) in c.times.iter().zip(&c.values) {
        if x > lap.start && x < lap.end && y.is_finite() {
            t.push(x);
            v.push(y);
        }
    }
    if let Some(y) = sample_without_gaps(c, lap.end, &gaps) {
        t.push(lap.end);
        v.push(y);
    }
    (t, v)
}
pub(crate) fn speed(s: &Session) -> Option<(&Channel, f64)> {
    s.channels
        .iter()
        .filter(|c| c.id == "gps-speed")
        .chain(
            s.channels
                .iter()
                .filter(|c| c.id != "gps-speed" && c.name.to_lowercase().contains("speed")),
        )
        .find_map(|c| {
            let factor = match c.unit.to_lowercase().as_str() {
                "m/s" => 1.,
                "km/h" | "kph" => 1. / 3.6,
                "mph" => 0.44704,
                _ => return None,
            };
            Some((c, factor))
        })
}
#[derive(Clone)]
struct Distance {
    times: Vec<f64>,
    meters: Vec<f64>,
}
fn distance(s: &Session, l: &Lap) -> Option<Distance> {
    let (c, f) = speed(s)?;
    if source_gaps(c).iter().any(|gap| gap_overlaps(gap, l)) {
        return None;
    }
    let mut steps: Vec<f64> = c.times.windows(2).take(8192).map(|w| w[1] - w[0]).collect();
    steps.sort_by(f64::total_cmp);
    let allowed_gap = steps.get(steps.len() / 2).copied().unwrap_or(0.) * 5.;
    let allowed_gap = allowed_gap.min(1.0);
    if c.times
        .windows(2)
        .any(|w| w[0] < l.end && w[1] > l.start && w[1] - w[0] > allowed_gap + 1e-9)
    {
        return None;
    }
    let (t, v) = clipped(c, l);
    if t.len() < 2
        || t[0] > l.start
        || *t.last()? < l.end
        || v.iter().any(|v| *v < 0.)
        || t.windows(2).any(|w| w[1] - w[0] > 1.0)
    {
        return None;
    }
    let mut d = vec![0.];
    for i in 1..t.len() {
        d.push(d[i - 1] + (v[i] + v[i - 1]) * 0.5 * f * (t[i] - t[i - 1]));
    }
    if c.id == "gps-speed" {
        let fix = s.channels.iter().find(|c| c.id == "gps-fix");
        if let Some(fix) = fix {
            let (_, v) = clipped(fix, l);
            if v.is_empty() || v.iter().any(|v| *v < 3.) {
                return None;
            }
        }
    }
    if *d.last()? < 1. {
        return None;
    }
    Some(Distance {
        times: t,
        meters: d,
    })
}
fn lap_view(
    s: &Session,
    l: &Lap,
    axis: &str,
    ids: &[String],
    d: Option<&Distance>,
    reference_time: Option<&Distance>,
) -> LapView {
    let pos = |t: f64| {
        if axis == "time" {
            if let Some(reference) = reference_time {
                let meters = d.and_then(|d| interpolate(&d.times, &d.meters, t))?;
                interpolate(&reference.meters, &reference.times, meters)
                    .map(|t| t - reference.times[0])
            } else {
                Some(t - l.start)
            }
        } else {
            d.and_then(|d| interpolate(&d.times, &d.meters, t))
        }
    };
    let mut warnings = vec![];
    let series = s
        .channels
        .iter()
        .filter(|c| ids.contains(&c.id))
        .map(|c| {
            let source_gaps: Vec<_> = source_gaps(c)
                .into_iter()
                .filter(|g| gap_overlaps(g, l))
                .collect();
            if !source_gaps.is_empty() {
                warnings.push(format!(
                    "{}: {} source timestamp gap(s); values inside gaps are unavailable.",
                    c.name,
                    source_gaps.len()
                ));
            }
            let gaps = source_gaps
                .iter()
                .filter_map(|g| Some([pos(g[0].max(l.start))?, pos(g[1].min(l.end))?]))
                .collect();
            let (t, v) = clipped(c, l);
            let pairs: Vec<_> = t
                .into_iter()
                .zip(v)
                .filter_map(|(t, v)| Some((pos(t)?, v)))
                .collect();
            Series {
                gaps,
                channel_id: c.id.clone(),
                name: c.name.clone(),
                unit: c.unit.clone(),
                x: pairs.iter().map(|p| p.0).collect(),
                values: pairs.iter().map(|p| p.1).collect(),
            }
        })
        .collect();
    let mut track = vec![];
    let lat = s.channels.iter().find(|c| c.id == "gps-latitude");
    let lon = s.channels.iter().find(|c| c.id == "gps-longitude");
    if let (Some(lat), Some(lon)) = (lat, lon) {
        if [lat, lon]
            .iter()
            .any(|c| source_gaps(c).iter().any(|g| gap_overlaps(g, l)))
        {
            warnings.push("GPS source timestamp gaps: racing line segments across missing positions are uncertain.".into());
        }
        let origin = lat
            .times
            .iter()
            .zip(&lat.values)
            .find_map(|(&t, &a)| {
                let b = interpolate(&lon.times, &lon.values, t)?;
                let fix = s
                    .channels
                    .iter()
                    .find(|c| c.id == "gps-fix")
                    .and_then(|c| interpolate(&c.times, &c.values, t))
                    .unwrap_or(3.);
                if a.abs() <= 90. && b.abs() <= 180. && a != 0. && b != 0. && fix >= 3. {
                    Some((a, b))
                } else {
                    None
                }
            })
            .unwrap_or((0., 0.));
        let (t, v) = clipped(lat, l);
        let mut previous: Option<(f64, f64, f64)> = None;
        let mut broken = false;
        let lon_gaps = source_gaps(lon);
        for (t, lat) in t.into_iter().zip(v) {
            let Some(lon) = sample_without_gaps(lon, t, &lon_gaps) else {
                broken = true;
                continue;
            };
            if lat.abs() > 90. || lon.abs() > 180. || lat == 0. || lon == 0. {
                broken = true;
                continue;
            }
            if let Some(fix) = s.channels.iter().find(|c| c.id == "gps-fix") {
                if !spatial::bracket(fix, t).is_some_and(|(a, b)| a >= 3. && b >= 3.) {
                    broken = true;
                    continue;
                }
            }
            if let Some(position) = pos(t) {
                let x = (lon - origin.1).to_radians() * 6371000. * origin.0.to_radians().cos();
                let y = (lat - origin.0).to_radians() * 6371000.;
                if previous
                    .is_some_and(|(pt, px, py)| (x - px).hypot(y - py) > 80. * (t - pt) + 15.)
                {
                    broken = true;
                    continue;
                }
                let break_before = broken || previous.is_some_and(|(pt, _, _)| t - pt > 0.35);
                previous = Some((t, x, y));
                broken = false;
                track.push(TrackPoint {
                    break_before,
                    x,
                    y,
                    position,
                    speed: speed(s)
                        .and_then(|(c, f)| interpolate(&c.times, &c.values, t).map(|v| v * f)),
                });
            }
        }
    }
    if track.len() < 2 {
        track.clear();
        warnings.push("GPS racing line unavailable for this lap.".into());
    }
    if d.is_none() {
        warnings.push(
            "Reliable speed coverage unavailable; distance and delta cannot be calculated.".into(),
        );
    }
    if !l.complete {
        warnings.push("Partial lap: excluded from fastest-lap ranking.".into());
    }
    LapView {
        mapping: reference_time
            .and(d)
            .map(|d| {
                d.times
                    .iter()
                    .zip(&d.meters)
                    .map(|(&t, &meters)| MappingPoint {
                        meters,
                        time: t - l.start,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        lap_id: l.id.clone(),
        duration: l.duration,
        length: d.and_then(|d| d.meters.last().copied()),
        series,
        track,
        warnings,
    }
}
pub fn analyze(
    s: &Session,
    primary_id: &str,
    comparison_id: Option<&str>,
    axis: &str,
    channel_ids: &[String],
) -> Result<Analysis, String> {
    analyze_with_boundaries(s, primary_id, comparison_id, axis, channel_ids, None)
}

pub fn analyze_with_boundaries(
    s: &Session,
    primary_id: &str,
    comparison_id: Option<&str>,
    axis: &str,
    channel_ids: &[String],
    boundaries: Option<&[f64]>,
) -> Result<Analysis, String> {
    let p = s
        .laps
        .iter()
        .find(|l| l.id == primary_id)
        .ok_or("Lap not found")?;
    let c = comparison_id
        .map(|id| {
            s.laps
                .iter()
                .find(|l| l.id == id)
                .ok_or("Comparison lap not found")
        })
        .transpose()?;
    let bindings: Vec<_> = channel_ids
        .iter()
        .map(|id| ChannelBinding {
            output_id: id.clone(),
            primary_id: Some(id.clone()),
            comparison_id: Some(id.clone()),
        })
        .collect();
    analyze_sources(
        LapSource { session: s, lap: p },
        c.map(|lap| LapSource { session: s, lap }),
        axis,
        &bindings,
        boundaries,
    )
}

#[derive(Clone, Copy)]
pub struct LapSource<'a> {
    pub session: &'a Session,
    pub lap: &'a Lap,
}
#[derive(Clone, Debug)]
pub struct ChannelBinding {
    pub output_id: String,
    pub primary_id: Option<String>,
    pub comparison_id: Option<String>,
}
pub fn analyze_sources(
    primary: LapSource<'_>,
    comparison: Option<LapSource<'_>>,
    axis: &str,
    channels: &[ChannelBinding],
    boundaries: Option<&[f64]>,
) -> Result<Analysis, String> {
    let s = primary.session;
    let p = primary.lap;
    let cs = comparison.map(|c| c.session).unwrap_or(s);
    let c = comparison.map(|c| c.lap);
    let primary_ids: Vec<_> = channels
        .iter()
        .filter_map(|b| b.primary_id.clone())
        .collect();
    let comparison_ids: Vec<_> = channels
        .iter()
        .filter_map(|b| b.comparison_id.clone())
        .collect();
    let channel_ids = &primary_ids;
    if !matches!(axis, "distance" | "time") {
        return Err("Choose time or distance for the horizontal axis.".into());
    }
    let spatial = spatial::align_sources(primary, comparison);
    let (mut alignment, geometry) = match spatial {
        Ok(g) => (g.alignment(), Some(g)),
        Err(note) => (Alignment::unavailable(note), None),
    };
    let pd = geometry
        .as_ref()
        .map(|g| g.primary.clone())
        .or_else(|| distance(s, p));
    let cd = geometry
        .as_ref()
        .and_then(|g| g.comparison.clone())
        .or_else(|| c.and_then(|l| distance(cs, l)));
    if axis == "distance" && (pd.is_none() || (c.is_some() && cd.is_none())) {
        return Err("Distance view needs validated GPS alignment or continuous speed data in known units. Switch to time.".into());
    }
    let mut warnings = vec![];
    let delta = if let (Some(c), Some(pd), Some(cd)) = (c, pd.as_ref(), cd.as_ref()) {
        let pl = *pd.meters.last().unwrap();
        let cl = *cd.meters.last().unwrap();
        if !p.complete || !c.complete || (pl - cl).abs() / pl > 0.05 {
            warnings.push("Delta unavailable: laps are partial or their measured lengths differ by more than 5%.".into());
            None
        } else {
            let precise = geometry.is_some();
            if !precise {
                alignment.method = "estimated".into();
                warnings.push("Estimated delta compares equal normalized distance, not physical position; positive values mean the selected lap is slower.".into());
            }
            let mut x = vec![];
            let mut values = vec![];
            for i in 0..=500 {
                let f = i as f64 / 500.;
                if let (Some(pt), Some(ct)) = (
                    interpolate(&pd.meters, &pd.times, pl * f),
                    interpolate(&cd.meters, &cd.times, cl * f),
                ) {
                    x.push(if axis == "distance" {
                        pl * f
                    } else {
                        pt - p.start
                    });
                    values.push((pt - p.start) - (ct - c.start));
                }
            }
            // Spatial endpoints use validated start/finish positions; fallback
            // endpoints verify only recorded durations, never physical correspondence.
            if values
                .last()
                .is_some_and(|v| (*v - (p.duration - c.duration)).abs() > 0.002)
            {
                warnings.push(
                    "Delta withheld: aligned endpoint disagrees with recorded lap durations."
                        .into(),
                );
                None
            } else {
                Some(Delta {
                    x,
                    values,
                    method: if precise { "spatial" } else { "estimated" }.into(),
                    uncertainty_seconds: alignment.timing_uncertainty_s,
                })
            }
        }
    } else {
        None
    };
    if boundaries.is_some() && geometry.is_none() {
        if c.is_none() {
            return Err(
                "Manual boundaries require validated GPS geometry for the reference lap.".into(),
            );
        }
        warnings.push("Manual boundaries are saved but temporarily omitted: this comparison does not support validated spatial sections. Choose a compatible complete lap to use them.".into());
    }
    let segments = geometry
        .as_ref()
        .map(|g| g.segments_sources(s, cs, p, c, axis, channel_ids, &comparison_ids, boundaries))
        .transpose()?
        .unwrap_or_default();
    warnings.extend(alignment.notes.clone());
    let reference_time = geometry.as_ref().map(|g| &g.primary);
    let mut primary = lap_view(s, p, axis, channel_ids, pd.as_ref(), reference_time);
    let mut comparison =
        c.map(|c| lap_view(cs, c, axis, &comparison_ids, cd.as_ref(), reference_time));
    if let Some(g) = &geometry {
        primary.track = g.track(s, p, false, axis);
        if let (Some(view), Some(lap)) = (&mut comparison, c) {
            view.track = g.track(cs, lap, true, axis);
        }
    }
    fn remap_series(view: &mut LapView, bindings: &[ChannelBinding], comparison: bool) {
        let originals = std::mem::take(&mut view.series);
        view.series = bindings
            .iter()
            .filter_map(|b| {
                let id = if comparison {
                    b.comparison_id.as_ref()
                } else {
                    b.primary_id.as_ref()
                }?;
                let mut series = originals.iter().find(|s| s.channel_id == *id)?.clone();
                series.channel_id = b.output_id.clone();
                Some(series)
            })
            .collect();
    }
    remap_series(&mut primary, channels, false);
    if let Some(view) = &mut comparison {
        remap_series(view, channels, true);
    }
    let mut segments = segments;
    fn remap_means(metrics: &mut SegmentMetrics, bindings: &[ChannelBinding], comparison: bool) {
        let originals = std::mem::take(&mut metrics.channels);
        metrics.channels = bindings
            .iter()
            .filter_map(|b| {
                let id = if comparison {
                    b.comparison_id.as_ref()
                } else {
                    b.primary_id.as_ref()
                }?;
                let mut mean = originals.iter().find(|m| m.channel_id == *id)?.clone();
                mean.channel_id = b.output_id.clone();
                Some(mean)
            })
            .collect();
    }
    for segment in &mut segments {
        remap_means(&mut segment.primary, channels, false);
        if let Some(metrics) = &mut segment.comparison {
            remap_means(metrics, channels, true);
        }
    }
    if channels
        .iter()
        .any(|b| b.primary_id.is_none() || (c.is_some() && b.comparison_id.is_none()))
    {
        warnings.push("Some selected channels are unavailable or ambiguous in a source; no samples were substituted.".into());
    }
    let conflict = s.id != cs.id
        && !s.track.trim().is_empty()
        && !cs.track.trim().is_empty()
        && !s.track.trim().eq_ignore_ascii_case(cs.track.trim());
    let delta = if conflict && geometry.is_none() {
        warnings.push("Conflicting track metadata without validated spatial compatibility: cross-source delta and corner comparisons are unavailable.".into());
        for segment in &mut segments {
            segment.comparison = None;
            segment.delta_seconds = None;
        }
        None
    } else {
        delta
    };
    Ok(Analysis {
        corner_boundaries: boundaries.map(|b| b.to_vec()),
        primary,
        comparison,
        delta,
        alignment,
        segments,
        warnings,
    })
}
// Short-lived calculation buffers contain only selected lap windows plus two neighboring
// samples for boundary/derivative calculations; originals remain shared in the library cache.
pub fn selected_session(source: &Session, ids: &[&str]) -> Session {
    let mut result = crate::merging::descriptor(source);
    result.laps.retain(|l| ids.contains(&l.id.as_str()));
    result.channels = source
        .channels
        .iter()
        .map(|c| {
            let mut ranges: Vec<_> = result
                .laps
                .iter()
                .map(|l| {
                    (
                        c.times.partition_point(|t| *t < l.start).saturating_sub(2),
                        (c.times.partition_point(|t| *t <= l.end) + 2).min(c.times.len()),
                    )
                })
                .collect();
            ranges.sort_unstable();
            let mut indices = Vec::new();
            for (start, end) in ranges {
                let from = indices
                    .last()
                    .map_or(start, |last: &usize| start.max(*last + 1));
                indices.extend(from..end);
            }
            Channel {
                id: c.id.clone(),
                name: c.name.clone(),
                unit: c.unit.clone(),
                gaps: source_gaps(c),
                times: indices.iter().map(|i| c.times[*i]).collect(),
                values: indices.iter().map(|i| c.values[*i]).collect(),
            }
        })
        .collect();
    result
}
#[cfg(test)]
mod tests;
