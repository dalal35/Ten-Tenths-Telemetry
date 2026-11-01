//! Read-only diagnostic: print analysis of the fastest two complete laps as JSON.
use apex_telemetry::telemetry::{analyze, parse_session};
fn main() -> Result<(), String> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Usage: cargo run --example inspect -- session.xrk")?;
    let session = parse_session(std::path::Path::new(&path))?;
    let mut laps: Vec<_> = session.laps.iter().filter(|lap| lap.complete).collect();
    laps.sort_by(|a, b| a.duration.total_cmp(&b.duration));
    let primary = laps.first().ok_or("No complete lap")?;
    let channels = session
        .channels
        .iter()
        .filter(|c| c.id == "gps-speed" || c.name.to_lowercase().contains("rpm"))
        .map(|c| c.id.clone())
        .collect::<Vec<_>>();
    let result = analyze(
        &session,
        &primary.id,
        laps.get(1).map(|l| l.id.as_str()),
        "distance",
        &channels,
    )?;
    println!(
        "{}",
        serde_json::to_string(&result).map_err(|e| e.to_string())?
    );
    Ok(())
}
