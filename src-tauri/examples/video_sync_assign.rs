//! Replay global assignment from extracted candidate evidence without decoding video.
//! <candidate-result.json> <start> <end> <xrk> [<xrk>...]
use apex_telemetry::{
    telemetry,
    video_analysis::CancellationToken,
    video_sync::{assignment, pipeline::SequenceCandidate},
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 4 {
        return Err("Expected candidate JSON, video start/end and XRK paths".into());
    }
    let mut data: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[0])?)?;
    let sequence = data
        .get_mut("sequence")
        .ok_or("Candidate evidence is missing")?;
    let candidates: Vec<SequenceCandidate> = serde_json::from_value(
        sequence
            .get("candidates")
            .ok_or("Candidates are missing")?
            .clone(),
    )?;
    let incomplete = sequence
        .get("comparisonIncomplete")
        .and_then(|v| v.as_bool())
        .ok_or("Comparison completeness is missing")?;
    let mut recordings: Vec<_> = args[3..]
        .iter()
        .map(|p| telemetry::parse_session(std::path::Path::new(p)))
        .collect::<Result<_, _>>()?;
    let token = CancellationToken::default();
    let start = args[1].parse()?;
    let end = args[2].parse()?;
    let began = std::time::Instant::now();
    let result =
        assignment::assign_recordings(&candidates, start, end, incomplete, &recordings, &token)?;
    let runtime = began.elapsed().as_secs_f64();
    let signature = |a: &assignment::Assignment| {
        a.segments
            .iter()
            .filter(|s| s.is_proposed())
            .map(|s| {
                (
                    s.recording_id.clone(),
                    s.video_start_seconds.to_bits(),
                    s.video_end_seconds.to_bits(),
                    s.offset_seconds.to_bits(),
                )
            })
            .collect::<Vec<_>>()
    };
    recordings.reverse();
    let reverse =
        assignment::assign_recordings(&candidates, start, end, incomplete, &recordings, &token)?;
    assert_eq!(
        signature(&result),
        signature(&reverse),
        "Recording input order changed assignment"
    );
    let proposed: Vec<_> = result.segments.iter().filter(|s| s.is_proposed()).collect();
    assert!(
        proposed
            .windows(2)
            .all(|w| w[0].video_end_seconds <= w[1].video_start_seconds),
        "Proposed spans overlap"
    );
    sequence["assignment"] = serde_json::to_value(result)?;
    sequence["assignmentReplaySeconds"] = serde_json::json!(runtime);
    sequence["assignmentOrderInvariant"] = serde_json::json!(true);
    data["applicable"] = serde_json::json!(false);
    println!("{}", serde_json::to_string_pretty(&data)?);
    Ok(())
}
