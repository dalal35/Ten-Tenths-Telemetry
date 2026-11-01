# Offline inference latency implementation plan

Goal: reduce real 0361, 0362 and merged XRK coaching latency while keeping offline operation, deterministic physics, validated grounded interventions, provenance, cancellation and fallback.

The user's detailed task authorizes implementation and explicitly excludes redundant approval gates. Work stays in the existing dirty workspace so current coaching and recordings remain available. No packaging or commits are required.

1. Instrument the current native runtime before optimizing: integrity, backend/model/context initialization, tokenization, prefill, decoding, validation, tokens/sec and counts. Capture baseline real-recording results and external CPU/peak RSS measurements.
2. Verify pinned llama.cpp capabilities, enable Metal only for supported macOS targets, retain explicit CPU fallback, and benchmark thread/batch/context settings. Prefer unchanged model/quantization/grounded recommendation options. Consider bounded warm model reuse only with integrity invalidation and cancellation preserved.
3. Add service timings for evidence building, interpretation mapping, analysis and cache lookup. Measure serialization in benchmark tooling rather than duplicating serialization on production requests.
4. Compare before/after reports and intervention selections on all three real workloads. Reject unsupported quality claims and report unavailable GPU instrumentation honestly.
5. Run targeted Rust/native and frontend tests, obtain independent integrated review, correct blockers, and publish reproducible timings and platform limits in docs.

Ownership: runtime worker owns runtime.rs/Cargo.toml, benchmark worker owns examples/latency evidence and report, parent owns service.rs/commands.rs/frontend metrics contract and integration. Advisor reviews optimization risks read-only. Avoid concurrent inference benchmarking.

## Acceptance decisions

- Metal was already compiled and working on Apple Silicon; sandbox GPU initialization failures caused CPU fallback in earlier measurements. Verify offload outside that restriction rather than add redundant Cargo features.
- Reject positional hypothesis-only arrays: despite valid schemas, all three recordings lost the specific third experiment to a generic calibration check.
- Keep the original object grammar and instruction text. Use short request-local evidence aliases only for coached inputs, preserve every summary byte, restore original identities and rerun full validation. Actual real-recording reports and explanations must match baseline exactly.
- Retain batch 128: batch 512 improved prefill slightly but did not demonstrate a consistent total-latency benefit and increased context initialization/memory/cancellation intervals.
- Keep fresh model/context lifecycle and pinned quantization/KV precision. Model load was approximately 0.2–0.3 s on Metal; retaining idle model memory is unnecessary for the observed sub-10-second target. Existing validated result caching remains available.
- Final validation includes CPU and actual Metal recordings, independent source/artifact review, Rust coaching/integration tests, frontend coaching tests and TypeScript. Report the unrelated website test failures and unavailable Windows/GPU-utilization testing.
