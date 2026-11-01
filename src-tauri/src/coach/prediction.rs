//! Held-out short-horizon forecasts; distinct from minimum-time bound residuals.
use super::{
    modeled::{at, curvature},
    types::VehicleEnvelope,
};
use crate::telemetry::{self, Session};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionValidation {
    pub horizon_seconds: f64,
    pub sample_count: usize,
    pub evaluated_lap_ids: Vec<String>,
    pub speed_rmse_mps: Option<f64>,
    pub persistence_speed_rmse_mps: Option<f64>,
    pub absolute_speed_error_p90_mps: Option<f64>,
    pub covered_section_time_mae_seconds: Option<f64>,
    pub temporal_coverage_fraction: f64,
    pub target: String,
}

fn directional_capacity(e: &VehicleEnvelope, a: f64, b: f64, braking: bool) -> f64 {
    let mut knots: Vec<_> = e
        .speed_bands
        .iter()
        .map(|band| {
            (
                (band.min_speed_mps + band.max_speed_mps) * 0.5,
                if braking {
                    band.nominal_braking_mps2
                } else {
                    band.nominal_acceleration_mps2
                },
            )
        })
        .collect();
    knots.sort_by(|a, b| a.0.total_cmp(&b.0));
    let at_speed = |v| {
        at(&knots, v).unwrap_or_else(|| {
            if v < knots[0].0 {
                knots[0].1
            } else {
                knots.last().unwrap().1
            }
        })
    };
    let (lo, hi) = (a.min(b), a.max(b));
    knots
        .iter()
        .filter(|p| p.0 > lo && p.0 < hi)
        .map(|p| p.1)
        .fold(at_speed(lo).min(at_speed(hi)), f64::min)
}

/// Forecast uses the preceding window only. A monotone projection clips the
/// constant-acceleration trend against training capacity over the whole step.
fn predict(previous: f64, current: f64, horizon: f64, k: f64, e: &VehicleEnvelope) -> f64 {
    if e.speed_bands.is_empty() || e.nominal_lateral_mps2 <= 0. {
        return current;
    }
    let desired = ((current - previous) / horizon).clamp(-20., 15.);
    let mut low = 0.;
    let mut high = desired.abs().min(if desired < 0. {
        (current - 0.5) / horizon
    } else {
        15.
    });
    for _ in 0..40 {
        let acceleration = (low + high) * 0.5;
        let future = current + desired.signum() * acceleration * horizon;
        let utilization = current.max(future).powi(2) * k / e.nominal_lateral_mps2;
        let allowed = directional_capacity(e, current, future, desired < 0.)
            * (1. - utilization.powi(2)).max(0.).sqrt();
        if acceleration <= allowed {
            low = acceleration;
        } else {
            high = acceleration;
        }
    }
    current + desired.signum() * low * horizon
}

pub(super) fn validate(
    s: &Session,
    withheld: &[String],
    e: &VehicleEnvelope,
    cancelled: &impl Fn() -> bool,
) -> Result<PredictionValidation, String> {
    let horizon = 0.4;
    let mut result=PredictionValidation{horizon_seconds:horizon,sample_count:0,evaluated_lap_ids:vec![],speed_rmse_mps:None,persistence_speed_rmse_mps:None,absolute_speed_error_p90_mps:None,covered_section_time_mae_seconds:None,temporal_coverage_fraction:0.,target:"0.4 s forecast from preceding speed trend, projected onto training combined-grip capacity; no future control inputs. Section-time error uses teacher-forced windows over observed displacement, grouped by section, not an autonomous lap-time prediction. Persistence baseline holds current speed.".into()};
    let mut errors = Vec::new();
    let mut persistence = 0.;
    let mut section_errors = Vec::new();
    let mut total_duration = 0.;
    for id in withheld {
        if cancelled() {
            return Err("Coach analysis cancelled".into());
        }
        let Some(lap) = s.laps.iter().find(|l| &l.id == id) else {
            continue;
        };
        let Some(channel) = super::sources::speed(s, lap) else {
            continue;
        };
        let raw: Vec<_> = channel
            .times
            .iter()
            .copied()
            .zip(channel.values.iter().copied())
            .collect();
        let gaps = telemetry::source_gaps(channel);
        total_duration += lap.duration;
        let Ok(analysis) = super::sources::analyze(s, lap, None, None) else {
            continue;
        };
        let mapping: Vec<_> = analysis
            .primary
            .mapping
            .iter()
            .map(|p| (p.time, p.meters))
            .collect();
        let mut by_section = vec![(0., 0_usize); analysis.segments.len()];
        let before = result.sample_count;
        let mut t = lap.start + horizon;
        while t + horizon <= lap.end {
            if cancelled() {
                return Err("Coach analysis cancelled".into());
            }
            if !gaps
                .iter()
                .any(|g| t - horizon < g[1] && t + horizon > g[0])
            {
                if let (Some(previous), Some(current), Some(actual), Some(x), Some(end)) = (
                    at(&raw, t - horizon),
                    at(&raw, t),
                    at(&raw, t + horizon),
                    at(&mapping, t - lap.start),
                    at(&mapping, t + horizon - lap.start),
                ) {
                    if [previous, current, actual]
                        .iter()
                        .all(|v| v.is_finite() && *v > 0.5)
                        && end > x
                    {
                        if let Some(k) = curvature(&analysis.primary, x, 10.) {
                            let forecast = predict(previous, current, horizon, k, e);
                            errors.push((forecast - actual).abs());
                            persistence += (current - actual).powi(2);
                            result.sample_count += 1;
                            let predicted_time = 2. * (end - x) / (current + forecast);
                            // Assign by window midpoint; do not count the same
                            // forecast in two neighboring section totals.
                            if let Some((i, _)) =
                                analysis.segments.iter().enumerate().find(|(_, s)| {
                                    s.start_meters <= (x + end) * 0.5
                                        && s.end_meters >= (x + end) * 0.5
                                })
                            {
                                by_section[i].0 += predicted_time - horizon;
                                by_section[i].1 += 1;
                            }
                        }
                    }
                }
            }
            t += horizon;
        }
        if result.sample_count > before {
            result.evaluated_lap_ids.push(id.clone());
        }
        section_errors.extend(
            by_section
                .into_iter()
                .filter(|(_, n)| *n > 0)
                .map(|(error, _)| error.abs()),
        );
    }
    if !errors.is_empty() {
        result.speed_rmse_mps =
            Some((errors.iter().map(|e| e * e).sum::<f64>() / errors.len() as f64).sqrt());
        result.persistence_speed_rmse_mps = Some((persistence / errors.len() as f64).sqrt());
        errors.sort_by(f64::total_cmp);
        result.absolute_speed_error_p90_mps =
            Some(errors[((errors.len() - 1) as f64 * 0.9).round() as usize]);
    }
    if !section_errors.is_empty() {
        result.covered_section_time_mae_seconds =
            Some(section_errors.iter().sum::<f64>() / section_errors.len() as f64);
    }
    if total_duration > 0. {
        result.temporal_coverage_fraction =
            (result.sample_count as f64 * horizon / total_duration).min(1.);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn envelope() -> super::super::types::VehicleEnvelope {
        serde_json::from_value(serde_json::json!({"validLapCount":4,"speedBands":[{
            "minSpeedMps":0.,"maxSpeedMps":40.,"sampleCount":100,
            "observedAccelerationMps2":2.,"observedBrakingMps2":5.,
            "conservativeAccelerationMps2":1.,"nominalAccelerationMps2":2.,
            "conservativeBrakingMps2":4.,"nominalBrakingMps2":5.
        }],"observedLateralMps2":10.,"conservativeLateralMps2":9.,
        "nominalLateralMps2":10.,"maxObservedSpeedMps":30.,"rpmEvidence":[],"assumptions":[]}))
        .unwrap()
    }
    #[test]
    fn past_trend_predicts_constant_acceleration_without_future_input() {
        assert!((predict(10., 10.8, 0.4, 0., &envelope()) - 11.6).abs() < 1e-9);
    }
    #[test]
    fn prediction_projects_trend_onto_longitudinal_and_combined_grip() {
        let e = envelope();
        assert!((predict(8., 10., 0.4, 0., &e) - 10.8).abs() < 1e-8);
        let corner = predict(8., 10., 0.4, 0.095, &e);
        assert!(corner >= 10. && corner < 10.3);
        let a = (corner - 10.) / 0.4;
        assert!((a / 2.).powi(2) + (corner * corner * 0.095 / 10.).powi(2) <= 1. + 1e-8);
    }
}
