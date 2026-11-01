use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachReport {
    pub analysis_version: String,
    pub session_id: String,
    pub reference_lap_id: String,
    pub best_lap_id: String,
    pub best_lap_seconds: f64,
    pub theoretical_best_seconds: Option<f64>,
    pub theoretical_improvement_seconds: Option<f64>,
    #[serde(default)]
    pub enhanced_theoretical_best: Option<TimeRange>,
    #[serde(default)]
    pub improvement_potential: Option<GainRange>,
    #[serde(default)]
    pub primary_opportunity_ids: Vec<String>,
    #[serde(default)]
    pub enhancement_budget: Vec<SectionGain>,
    pub valid_lap_count: usize,
    pub excluded_laps: Vec<ExcludedLap>,
    pub consistency: Consistency,
    pub segments: Vec<BestSegment>,
    pub laps: Vec<LapSummary>,
    #[serde(default)]
    pub section_assessments: Vec<SectionAssessment>,
    #[serde(default)]
    pub performance_envelope: Option<VehicleEnvelope>,
    #[serde(default)]
    pub simulated_profiles: Vec<SimulatedProfile>,
    #[serde(default)]
    pub full_lap: Option<super::full_lap::FullLapDiagnostics>,
    pub opportunities: Vec<Opportunity>,
    /// Observed nonoverlapping faster-example differences on the best lap only.
    pub total_observed_opportunity_seconds: Option<f64>,
    pub opportunity_lap_id: Option<String>,
    pub notes: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedLap {
    pub lap_id: String,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Consistency {
    pub median_seconds: f64,
    pub median_absolute_deviation_seconds: f64,
    pub range_seconds: f64,
    pub sample_count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestSegment {
    pub section_id: String,
    pub label: String,
    pub kind: String,
    pub start_meters: f64,
    pub end_meters: f64,
    pub lap_id: String,
    pub elapsed_seconds: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapSummary {
    pub lap_id: String,
    pub duration_seconds: f64,
    pub spatial_comparison: bool,
    pub coverage: f64,
    pub timing_resolution_seconds: Option<f64>,
    pub total_observed_loss_seconds: Option<f64>,
    pub notes: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub metric: String,
    pub unit: String,
    pub lap_value: f64,
    pub reference_value: Option<f64>,
    pub channel_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opportunity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coaching: Option<CoachingEvidence>,
    pub id: String,
    pub lap_id: String,
    pub reference_lap_id: String,
    pub section_id: Option<String>,
    pub label: String,
    pub kind: String,
    /// Absolute recording times for synchronized telemetry/video navigation.
    pub start_time: f64,
    pub end_time: f64,
    pub start_meters: Option<f64>,
    pub end_meters: Option<f64>,
    pub observed_loss_seconds: Option<f64>,
    /// Conservative repeated segment difference, not a promised improvement.
    pub estimated_gain_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modeled_gain: Option<ModeledGain>,
    #[serde(default)]
    pub gain_range: Option<GainRange>,
    pub faster_example_count: usize,
    pub confidence: String,
    pub status: String,
    pub priority_score: f64,
    pub evidence: Vec<Evidence>,
    pub observation: String,
    pub action: String,
    pub uncertainty: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionAssessment {
    pub section_id: String,
    pub label: String,
    pub kind: String,
    pub start_time: f64,
    pub end_time: f64,
    pub start_meters: f64,
    pub end_meters: f64,
    pub evidence: Vec<Evidence>,
    pub notes: Vec<String>,
}

/// Explicit hypothetical scenario bounds; never counted as measured opportunity.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeledGain {
    pub lower_seconds: f64,
    pub upper_seconds: f64,
    pub assumption: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_lap_id: Option<String>,
}

/// Conditional scenario bounds, never a statistical confidence interval.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRange {
    pub lower_seconds: f64,
    pub upper_seconds: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GainRange {
    pub lower_seconds: f64,
    pub upper_seconds: f64,
    pub basis: String,
    pub assumption: String,
    pub method: String,
}

/// One chosen alternative per disjoint spatial interval, independent of card count.
/// section_id names the originating section; opportunity bounds may cover downstream sections.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionGain {
    pub section_id: String,
    pub source_lap_id: String,
    pub opportunity_id: Option<String>,
    pub gain_range: GainRange,
}

/// Robust sustained telemetry capabilities; scenarios are conditional, not limits.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleEnvelope {
    pub valid_lap_count: usize,
    pub speed_bands: Vec<SpeedBand>,
    pub observed_lateral_mps2: f64,
    pub conservative_lateral_mps2: f64,
    pub nominal_lateral_mps2: f64,
    pub max_observed_speed_mps: f64,
    pub rpm_evidence: Vec<String>,
    pub assumptions: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedBand {
    pub min_speed_mps: f64,
    pub max_speed_mps: f64,
    pub sample_count: usize,
    pub observed_acceleration_mps2: f64,
    pub observed_braking_mps2: f64,
    pub conservative_acceleration_mps2: f64,
    pub nominal_acceleration_mps2: f64,
    pub conservative_braking_mps2: f64,
    pub nominal_braking_mps2: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatedProfile {
    pub opportunity_id: String,
    pub strategy: String,
    pub start_meters: f64,
    pub end_meters: f64,
    pub baseline_seconds: f64,
    pub recorded_seconds: f64,
    pub conservative_seconds: f64,
    pub nominal_seconds: f64,
    pub points: Vec<SimulatedPoint>,
    pub assumptions: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatedPoint {
    pub meters: f64,
    pub baseline_speed_mps: f64,
    pub conservative_speed_mps: f64,
    pub nominal_speed_mps: f64,
    pub curvature_per_meter: f64,
}

/// Profile-grounded interventions; these describe experiments, not measured controls.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachingEvidence {
    pub mechanism: String,
    pub title: String,
    pub validation: String,
    pub hypotheses: Vec<CoachingHypothesis>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachingHypothesis {
    pub id: String,
    pub title: String,
    pub hypothesis: String,
    pub experiment: String,
    pub validation: String,
}
