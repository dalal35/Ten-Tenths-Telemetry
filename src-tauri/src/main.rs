#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|v| v == "--youtube-self-check") {
        if let Err(error) = apex_telemetry::youtube::self_check::run(&args) {
            eprintln!("YouTube self-check failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).is_some_and(|v| v == "--coach-self-check") {
        if let Err(error) = apex_telemetry::coach::self_check::run(&args) {
            eprintln!("Coach self-check failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    apex_telemetry::run();
}
