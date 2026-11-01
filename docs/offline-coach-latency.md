# Offline coaching latency verification

Measured on October 25, 2026 using the real 0361 and 0362 XRK recordings and their merged session, on an Apple M3 MacBook Air (4 performance + 4 efficiency CPU cores, 10 GPU cores, 16 GiB memory). The final implementation produces the **same three validated recommendations**, with identical actions, hypotheses, validation instructions, source references, physics diagnostics and gain ranges. Full before/after report hashes and per-run metrics are in [the benchmark evidence](offline-coach-latency-benchmarks.json).

| Workload | Baseline CPU | Final CPU | Baseline Metal | Final Metal |
|---|---:|---:|---:|---:|
| 0361 | 23.919 s | 24.457 s | 5.793 s | **5.224 s** |
| 0362 | 27.990 s | 24.725 s | 5.935 s | **4.951 s** |
| Merged | 38.724 s | 25.450 s | 12.744 s | **5.195 s** |

These are explanation-stage wall times, including model integrity verification, backend/model/context initialization, prompt evaluation, decoding and output validation. The supplied historical CPU references were 37.663 / 37.244 / approximately 41.000 seconds; they are not the controlled before measurements above. CPU 0361 did not improve; timing noise and thermal conditions preclude a claim that every CPU case is faster. The largest repeatable mechanism is removing redundant generated identity text, especially the merged session's long hashed identifiers. On the same accessible Metal hardware, final code reduces observed latency by 10%, 17% and 59%, respectively. Baseline Metal was already fast for individual recordings: GPU availability itself must not be credited to this patch.

Runs were sequential, with no simultaneous native inference. These are single development measurements, not statistical latency guarantees; background builds/tests and laptop thermal state were not controlled. Baseline CPU ran in the restricted environment, where a Metal attempt failed and the existing CPU fallback ran; its wall time includes that unsuccessful attempt. Final CPU used explicit `--cpu`, which disables model, KV and operation offload. Per-phase CPU prefill/decoding metrics are more directly comparable than whole-request differences across those environments. Rust used the development profile; the actual native llama.cpp CMake configuration was optimized **RelWithDebInfo (-O2 -g -DNDEBUG)**, with Metal and embedded Metal shaders enabled. No full Rust release or packaging pipeline was run.

## Profiling and retained changes

Before optimization, CPU prefill consumed 18.366 / 21.389 / 26.286 seconds for 2384 / 2442 / 2590 prompt tokens. Decoding took 2.452 / 3.511 / 8.785 seconds for 74 / 74 / 229 generated tokens. Metal prefill took 1.498 / 1.918 / 1.714 seconds, while decoding the merged output still took 8.838 seconds. Output length was therefore an important merged-session bottleneck; CPU remained dominated by prompt evaluation.

The shipped optimization retains the original object output schema, prompt instructions and every telemetry fact and supported hypothesis. Fully coached inputs receive short request-local identities (`c0`, `c1`, `c2`) instead of verbose source IDs. Native output is restored to the original identities and revalidated against the original evidence before service mapping. This reduces both repeated prompt identity text and constrained output tokens without changing coaching prose or numerical calculations. Legacy qualitative inputs retain their original path. The reasoning/cache version is bumped so previous results are not reused under the new transport.

Final Metal phase measurements:

| Workload | Prompt tokens | Generated tokens | Model load | Context | Prefill | Generation | Generation tokens/s |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0361 | 2362 | 52 | 222 ms | 62 ms | 1552 ms | 1377 ms | 37.75 |
| 0362 | 2421 | 53 | 198 ms | 21 ms | 1576 ms | 1392 ms | 38.07 |
| Merged | 2416 | 55 | 200 ms | 22 ms | 1578 ms | 1452 ms | 37.87 |

Final CPU phase measurements:

| Workload | Model load | Context | Prefill | Generation | Generation tokens/s |
|---|---:|---:|---:|---:|---:|
| 0361 | 603 ms | 44 ms | 19999 ms | 1854 ms | 28.03 |
| 0362 | 612 ms | 34 ms | 19914 ms | 2310 ms | 22.94 |
| Merged | 716 ms | 36 ms | 20450 ms | 2138 ms | 25.72 |

Instrumentation additionally reports integrity, backend initialization, prompt construction, tokenization, sampler construction, validation time, output bytes, batch/context/thread settings, backend devices, requested GPU layers and failed GPU-attempt duration. Explicit context synchronization makes the final phase boundaries meaningful. Baseline phase timers predate that synchronization; end-to-end wall time remains authoritative.

Four inference threads, a 6144-token context, a 128-token batch, greedy decoding and the pinned Q4_K_M model remain unchanged. All three recommendations already use one inference pass. No new runtime, model download, network dependency or API is introduced. A loaded model/context is still released after each native request; measured Metal model loading is about 0.2 seconds, while retaining it would keep substantial laptop memory resident. Successful result caching remains the main repeated-request fast path. Full SHA256 verification is retained on every uncached production inference, taking about 1.8 seconds here. Alternative quantizations and quantized KV caches were not downloaded or benchmarked; the bundled model and KV precision were preserved.

## Rejected experiments

A positional array containing only hypothesis IDs reached 4.1–4.5 seconds on Metal, but changed the third recommendation in every workload to generic calibration investigation. It passed schema validation yet materially weakened actionable coaching. It was rejected and removed. This is why exact coaching comparison accompanies structural validation.

A 512-token logical/physical batch reduced one merged prefill from 1.600 to 1.497 seconds, but increased context setup and did not improve total request latency (5.584 seconds versus 5.302 seconds for the 128-token ablation). Final verification with batch 128 reached 5.195 seconds. The larger batch was rejected; CPU also showed no consistent benefit. The original batch size remains on both platforms, preserving smaller cancellation intervals and allocations. Prompt facts were not pruned after the quality-sensitive encoding experiment.

## Quality, overhead and resources

All nine final recommendations on each of CPU and Metal match their corresponding baseline action, hypothesis, validation text and interpretation ID. CPU identity comparison normalizes the existing source-qualified ID hash; Metal service outputs match the entire original explanation objects exactly. Complete reports match before/after, including physics calculations, corner intervals, numerical gain ranges and merged source provenance. Every workload contains three distinct source opportunities with specific driving experiments. These checks establish preservation for these recordings, not proof of driving outcomes or general model reasoning ability.

Measured final Metal evidence construction takes 0.812–0.937 ms, interpretation mapping 0.009–0.033 ms, and native output validation about 2–4 ms. Diagnostic cache insertion including cloning takes 0.099–0.115 ms; successful cache lookup and cloning takes 0.080–0.087 ms. Serialization of the complete 171–214 kB result takes 3.976–5.024 ms. These timings are additive diagnostic probes after inference, not changes to the application cache policy. Deterministic analysis takes 1.03 / 1.13 / 1.93 seconds separately; analysis plus coaching totals 6.26 / 6.08 / 7.13 seconds, excluding parsing. The final merged process, including XRK parsing, analysis and output, completed in 7.22 seconds.

Native logs verify **27/27 model layers offloaded to the Apple M3 Metal device** for every final Metal workload, with no CPU fallback. Final explicit CPU logs verify 0/27 layers and disabled KV/operation offload. A separate final-source automatic-fallback smoke test inside the restricted environment requested Metal, failed device initialization, then returned the exact same three 0361 recommendations on CPU; the failed GPU attempt took 643 ms. That smoke is a quality check, not a controlled performance result. Maximum process RSS is 1.19 GB for Metal and 1.59–1.62 GB for CPU; peak memory footprint is about 390–393 MB and 832–833 MB respectively. RSS includes mapped model pages; footprint is a different macOS accounting measure. Individual recordings share one benchmark process, so their peak memory figure is shared. Process-average CPU usage, including parsing and analysis, is 64–70% with Metal versus 322–326% with four-thread CPU inference. GPU utilization percentages require privileged platform counters and were not captured; device/layer logs verify actual GPU offload independently.

Each measured request verifies and reloads the model, with OS file/shader caches already populated. An earlier observed Metal initialization took **7.755 seconds by itself**, so first-ever shader initialization can exceed the ten-second target. These results do not promise under ten seconds after reboot or on all Apple Silicon devices. CPU-only inference still takes about 24–25 seconds on this laptop. Windows execution was not available; its existing CPU configuration and fallback path are retained.

Native cancellation requested after 3000 ms returned `Cancelled` at 3026 and 3035 ms in the existing two-case benchmark, without accepting partial output. Targeted Rust coaching tests passed (89 tests); frontend coaching tests passed (50 tests) and TypeScript compilation passed. The broad frontend suite had 336 passes and eight pre-existing website-download test failures unrelated to inference. The full native Rust suite passed 226 tests (177 unit and 49 integration) outside the restricted environment, including all seven AVFoundation video fixtures. Those seven fixtures initially failed only in the restricted environment.

## Reproduction

Build the diagnostic example only:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --example coach_recordings --locked --offline
```

Run the real individual recordings, then repeat with `--merged`. Use native hardware access to measure Metal; a restricted environment can expose the GPU backend but prevent opening the device.

```sh
src-tauri/target/debug/examples/coach_recordings \
  'data/yash dalal_59_PURDUE GP IN_Warm-up_a_0361.xrk' \
  'data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk' \
  --explain --accept-gemma-terms
```

Add `--cpu` to force CPU model/KV/operation execution. `--repeat=2` bypasses result caching for repeated native requests and reports every run; it does not claim loaded-model retention. Default service diagnostics additionally probe cache insertion/lookup and wire serialization. Consent flags are ephemeral and never persist application terms acceptance. `COACH_NATIVE_LOGS=1` enables native diagnostics in a release Rust build; normal development builds already emit them.
