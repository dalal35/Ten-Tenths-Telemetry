//! Read-only, reproducible real-recording validation. Never loads a library or model.
use apex_telemetry::{coach::analysis, telemetry};

fn main() -> Result<(), String> {
    let paths: Vec<_> = std::env::args_os().skip(1).collect();
    if paths.is_empty() {
        return Err("Provide one or more real XRK recordings".into());
    }
    let legacy: serde_json::Value =
        serde_json::from_str(include_str!("../../docs/physics-coach-validation.json"))
            .map_err(|e| e.to_string())?;
    let mut recordings = Vec::new();
    for path in paths {
        let session = telemetry::parse_session(std::path::Path::new(&path))?;
        let start = std::time::Instant::now();
        let report = analysis::analyze(&session, None, None)?;
        let elapsed = start.elapsed().as_millis();
        let name = std::path::Path::new(&path)
            .file_name()
            .unwrap()
            .to_string_lossy();
        let previous = legacy["recordings"].as_array().and_then(|rows| {
            rows.iter().find(|r| {
                r["file"]
                    .as_str()
                    .is_some_and(|suffix| name.contains(suffix))
            })
        });
        recordings.push(serde_json::json!({
            "recording":name,
            "bestLapId":report.best_lap_id,
            "actualLapSeconds":report.best_lap_seconds,
            "recordedTheoreticalBestSeconds":report.theoretical_best_seconds,
            "modeledLapSeconds":report.enhanced_theoretical_best,
            "gainRange":report.improvement_potential,
            "analysisMilliseconds":elapsed,
            "physics":report.full_lap,
            "calibration":report.performance_envelope,
            "primaryOpportunityIds":report.primary_opportunity_ids,
            "opportunities":report.opportunities.iter().filter(|o|
                report.primary_opportunity_ids.contains(&o.id)).collect::<Vec<_>>(),
            "profiles":report.simulated_profiles.iter().map(|p|serde_json::json!({
                "strategy":p.strategy,"pointCount":p.points.len(),
                "startMeters":p.start_meters,"endMeters":p.end_meters,
                "baselineSeconds":p.baseline_seconds,"conservativeSeconds":p.conservative_seconds,
                "nominalSeconds":p.nominal_seconds,
                "seamConservativeSpeedDifferenceMps":p.points.first().zip(p.points.last())
                    .map(|(a,b)|(a.conservative_speed_mps-b.conservative_speed_mps).abs()),
                "seamNominalSpeedDifferenceMps":p.points.first().zip(p.points.last())
                    .map(|(a,b)|(a.nominal_speed_mps-b.nominal_speed_mps).abs()),
            })).collect::<Vec<_>>(),
            "previousHeuristicGainRange":previous.map(|p|&p["wholeLapGainRange"]),
            "previousHeuristicProfileCount":previous.and_then(|p|p["alternatives"].as_array()).map(Vec::len),
        }));
    }
    println!("{}",serde_json::to_string_pretty(&serde_json::json!({
        "analysisVersion":analysis::ANALYSIS_VERSION,
        "method":"One continuous calibrated point-mass lap; signed section attribution; no external lap record or desired gain target.",
        "recordings":recordings,
        "gemmaContribution":"This deterministic diagnostic does not invoke Gemma. Runtime receives structured profiles and authors qualitative experiments only; all calculations remain in Rust.",
    })).map_err(|e|e.to_string())?);
    Ok(())
}
