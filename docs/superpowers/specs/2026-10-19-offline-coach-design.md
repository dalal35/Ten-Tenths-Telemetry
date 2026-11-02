# Offline driving coach

The approved request is an integrated offline race-engineering workspace. Rust owns every measured value, confidence gate, section identity and gain estimate. Existing XRK parsing, GPS spatial alignment, corner overrides and advanced RPM events remain authoritative. Optional channels never become invented driver inputs.

## Boundaries

`coach/analysis.rs` produces a versioned serializable report from a session, reference lap and canonical boundaries. It compares valid complete laps in the reference frame, accounts for nonoverlapping partitions, and distinguishes observed losses, repeated demonstrations and theoretical best actual segments. Quality exclusions and timing resolution accompany findings.

`coach/runtime.rs` embeds llama.cpp through Rust bindings. Its output is constrained to evidence and supported interpretation/action identifiers; deterministic rendering owns wording and numerical fields. One background inference runs at a time, with bounded context, output, cancellation and per-request model release. No network calls occur in the application. Runtime/model failure leaves the measured report available.

The coach workspace uses the existing session selection and design language. Reference controls, ranked evidence cards, progress/cancellation and failure states sit alongside ordinary telemetry inspection. Inspecting a finding selects its lap and comparison reference, then focuses the corresponding recording interval in the synchronized telemetry workspace.

## Persistence and distribution

Cache identity includes content digest, reference, boundary definitions, analysis version and model identity. Source validation occurs before cache use. Analysis and inference release the library mutex before expensive computation. Cache size is bounded and ordinary workspace persistence remains small.

Bundle a pinned redistributable GGUF and license notices with an embedded runtime, contingent on real quality/resource measurements. Benchmark Gemma 3 1B and 4B rather than choosing from size alone. Packaging and native Windows validation must be reported as pending unless executed; no inferred platform success.

## Acceptance

Synthetic tests cover timing/accounting, invalid/missing/noisy data, outliers, evidence provenance, optional channels and cancellation. Local XRKs exercise the real parser. Frontend checks cover stale requests, session/reference changes, state restoration and navigation. Runtime validation rejects unknown references, unsupported actions, fabricated numerical text and unbounded output. Measure cold load, inference and resident memory with real weights. Preserve recordings and unrelated changes.
