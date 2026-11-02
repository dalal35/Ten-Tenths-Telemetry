//! Emit inspectable coach evidence for individual or merged real recordings, with optional explicit, ephemeral model consent.
//! Add `--cpu` for true CPU inference and `--repeat=N` for uncached repeated requests.
//! Native diagnostics require `--explain --accept-gemma-terms`; acceptance is never persisted.
use apex_telemetry::{
    coach::{analysis, runtime, service, CoachReport},
    merging::{self, MergeInfo, MergeSource, SourceRef},
    telemetry::{self, Session},
};
fn main() -> Result<(), String> {
    let mut recordings = Vec::new();
    let mut merged = false;
    let mut explain = false;
    let mut accepted = false;
    let mut cpu = false;
    let mut repeat = 1;
    for arg in std::env::args().skip(1) {
        if arg == "--merged" {
            merged = true;
        } else if arg == "--explain" {
            explain = true;
        } else if arg == "--accept-gemma-terms" {
            accepted = true;
        } else if arg == "--cpu" {
            cpu = true;
        } else if let Some(value) = arg.strip_prefix("--repeat=") {
            repeat = value.parse::<usize>().map_err(|_| "Invalid repeat count")?;
            if !(1..=10).contains(&repeat) {
                return Err("Repeat count must be between one and ten".into());
            }
        } else {
            recordings.push(telemetry::parse_session(std::path::Path::new(&arg))?);
        }
    }
    if explain && !accepted {
        return Err(
            "Use --accept-gemma-terms for this offline benchmark; consent is not persisted.".into(),
        );
    }
    if recordings.is_empty() {
        return Err("Provide XRK paths, optionally --merged".into());
    }
    if cpu && !explain {
        return Err("--cpu requires --explain".into());
    }
    if merged {
        let refs: Vec<_> = recordings
            .iter()
            .map(|s| SourceRef {
                session_id: s.id.clone(),
                content_version: "a".repeat(64),
            })
            .collect();
        let preview = merging::preview_sources(&recordings.iter().collect::<Vec<_>>(), &refs)?;
        let session = Session {
            id: "coach-validation-merged".into(),
            source: String::new(),
            name: "Merged coach validation".into(),
            driver: String::new(),
            track: String::new(),
            recorded_at: preview.day.clone(),
            channels: preview.channels.iter().map(|c| c.channel.clone()).collect(),
            laps: preview.laps.iter().map(|l| l.lap.clone()).collect(),
            warnings: vec![],
            merge: Some(MergeInfo {
                preview,
                sources: recordings
                    .into_iter()
                    .zip(refs)
                    .map(|(session, reference)| MergeSource { session, reference })
                    .collect(),
            }),
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&render_session(&session, explain, cpu, repeat)?)
                .map_err(|e| e.to_string())?
        );
    } else {
        let reports: Vec<_> = recordings
            .iter()
            .map(|s| render_session(s, explain, cpu, repeat))
            .collect::<Result<_, _>>()?;
        println!(
            "{}",
            serde_json::to_string_pretty(&reports).map_err(|e| e.to_string())?
        );
    }
    Ok(())
}

fn render_session(
    session: &Session,
    explain: bool,
    cpu: bool,
    repeat: usize,
) -> Result<serde_json::Value, String> {
    let start = std::time::Instant::now();
    let report = analysis::analyze(session, None, None)?;
    let analysis_us = start.elapsed().as_micros();
    let mut value = render(report, explain, cpu, repeat)?;
    if explain {
        value["benchmarkAnalysisUs"] = serde_json::json!(analysis_us);
    }
    Ok(value)
}

fn render(
    report: CoachReport,
    explain: bool,
    cpu: bool,
    repeat: usize,
) -> Result<serde_json::Value, String> {
    if !explain {
        return serde_json::to_value(report).map_err(|e| e.to_string());
    }
    let model = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/coach/model.gguf");
    if cpu || repeat > 1 {
        // Direct calls deliberately bypass the result cache, measuring repeated native
        // requests rather than cache-hit latency. Runtime metrics identify reused state.
        // The complete deterministic report accompanies every run for numerical comparison.
        let (evidence, context) = service::model_input(&report, None)?;
        let mut runs = Vec::new();
        for _ in 0..repeat {
            let start = std::time::Instant::now();
            let (rows, metrics) = runtime::generate_with_context(
                &model,
                &evidence,
                &context,
                &std::sync::atomic::AtomicBool::new(false),
                cpu,
            )
            .map_err(|error| error.to_string())?;
            let validated = runtime::validate_output(
                &serde_json::to_string(&rows).map_err(|error| error.to_string())?,
                &evidence,
            )
            .map_err(|error| error.to_string())?;
            runs.push(serde_json::json!({"outputs":validated,"metrics":metrics,"wallMs":start.elapsed().as_millis()}));
        }
        return Ok(serde_json::json!({"report":report,"forceCpu":cpu,"runs":runs}));
    }
    let coach = service::CoachService::default();
    let job = coach.begin("recording-benchmark")?;
    let result = service::explain(report, &model, &job, true)?;
    let start = std::time::Instant::now();
    coach.remember("recording-benchmark".into(), result.clone());
    let cache_write_us = start.elapsed().as_micros();
    let start = std::time::Instant::now();
    let cached = coach.cached("recording-benchmark").ok_or("Cache miss")?;
    let cache_read_us = start.elapsed().as_micros();
    let start = std::time::Instant::now();
    let wire_bytes = serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len();
    let serialization_us = start.elapsed().as_micros();
    let mut value = serde_json::to_value(result).map_err(|e| e.to_string())?;
    value["benchmarkMetrics"] = serde_json::json!({
        "cacheWriteUs":cache_write_us,"cacheReadUs":cache_read_us,
        "cacheHit":cached.cached,"serializationUs":serialization_us,"wireBytes":wire_bytes
    });
    Ok(value)
}
