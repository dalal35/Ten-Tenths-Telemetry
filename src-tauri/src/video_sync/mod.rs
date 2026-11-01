pub mod laps;
pub mod pipeline;
pub mod assignment;
pub mod scan;
pub mod service;
pub mod telemetry;
pub mod visual;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySample {
    pub time: f64,
    pub yaw: Option<f64>,
    pub curvature: Option<f64>,
    pub speed: Option<f64>,
    pub acceleration: Option<f64>,
}

#[cfg(test)]
mod matching_tests;

pub mod matching;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CornerEvidence {
    pub video_start_seconds: f64,
    pub video_end_seconds: f64,
    pub correlation: f64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCandidate {
    /// Telemetry time = video time + offset.
    pub offset_seconds: f64,
    pub sign: i8,
    pub correlation: f64,
    pub overlap_seconds: f64,
    pub peak_width_seconds: f64,
    pub windows: Vec<CornerEvidence>,
    pub consistent: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub candidates: Vec<SyncCandidate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<pipeline::SequenceEvidence>,
    pub ambiguous: bool,
    pub applicable: bool,
    pub rejection_reason: Option<String>,
}

#[cfg(test)]
mod service_tests;
