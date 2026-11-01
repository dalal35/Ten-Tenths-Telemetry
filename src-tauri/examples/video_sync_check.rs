//! Read-only real-media verification, reusing the application's actual pipeline.
//! cargo run --offline --example video_sync_check -- <video> <start> <end> <xrk> [<xrk>...]
use apex_telemetry::{telemetry, video_analysis::CancellationToken, video_sync::pipeline};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 4 {
        return Err("Expected video, start seconds, end seconds and XRK paths".into());
    }
    let start = args[1].parse()?;
    let end = if args[2] == "all" {
        apex_telemetry::video_analysis::inspect(
            std::path::Path::new(&args[0]),
            &CancellationToken::default(),
        )?
        .duration_seconds
    } else {
        args[2].parse()?
    };
    let recordings: Vec<_> = args[3..]
        .iter()
        .map(|path| telemetry::parse_session(std::path::Path::new(path)))
        .collect::<Result<_, _>>()?;
    let cache = std::env::var_os("TTT_VIDEO_FEATURE_CACHE").map(std::path::PathBuf::from);
    let result = pipeline::analyze_path_cached(
        std::path::Path::new(&args[0]),
        &recordings,
        start,
        end,
        &CancellationToken::default(),
        |phase, progress| {
            eprintln!("{phase} {:.1}%", progress * 100.);
        },
        cache.as_deref(),
    )?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
