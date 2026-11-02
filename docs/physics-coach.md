# Physics-informed offline driving coach

This document records the earlier interval engine. The current full-lap implementation and fresh XRK results are documented in [full-lap-physics.md](full-lap-physics.md).

The coach now investigates feasible speed profiles across a corner or connected corner complex and its following straight. It no longer depends on finding faster recorded sectors. On the two available Purdue Grand Prix recordings, conditional whole-lap potential increased from 0.005–0.012 s to 0.148–0.212 s (0361), and from 0.0005–0.0016 s to 0.056–0.126 s (0362). These are engineering sensitivity scenarios, not measured savings, guaranteed improvements, or confidence intervals.

## What changed

The former independent scenario compressed only the recovery from minimum speed to +1 m/s, over approximately 6–11 m, by at most 15%. It restored the recorded exit speed and used the fastest lap alone for acceleration capacity. This structurally excluded most entry, minimum-speed and downstream momentum gains.

The new engine gathers nonoverlapping sustained 0.4–0.65 s speed windows across spatially valid laps. Each 4 m/s speed band needs eight acceleration and eight deceleration windows; unsupported bands are not extrapolated. Propulsion/braking sensitivity uses the 75th and 90th percentiles. Lateral sensitivity uses median per-lap 90th/95th percentile sustained GPS-derived demand. Curvature uses two chord scales, at least 10 m and three times position uncertainty. These describe observed reusable capacity, not the absolute vehicle limit. RPM-conditioned acceleration associations supplement the existing shift/interruption evidence; they do not establish a torque curve or numerical shift saving.

Three competing strategies retain entry momentum, prioritize exit recovery, or balance the complete interval. A forward/backward distance-domain solver limits every cell using speed-dependent propulsion and braking, curvature, and an approximate combined-grip ellipse. It preserves the baseline entry and terminal speeds, including the braking required to merge back into the recording. Exact constant-acceleration cell traversal uses 2Δs/(v₀+v₁). Signed costs remain in the interval calculation; a faster apex alone cannot establish a gain. Losing alternatives remain inspectable and enter the model context.

Baseline integrated time must agree with recorded interval time within 4% or 50 ms. The actual residual is disclosed. Scenario sensitivity does not cover every source of model error. The recorded line, comparable grip and repeatable propulsion remain assumptions; track width, alternate geometric lines, tire behavior, brake/throttle inputs and the absolute vehicle limit are unmeasured. Speed is capped at the session 99th percentile. Lap-seam regions without supported curvature chords are trimmed. Fastest-lap-only sessions do not provide enough sustained capability evidence for new full-interval profiles and retain the prior small scenarios. Only one corner interval per full recording currently supports the new quantified model; other sections can retain observed comparisons or unquantified experiments.

Every selected simulated interval displaces every overlapping recorded or modeled section in the lap budget. Recommendations also exclude displaced alternatives. The complete budget is independent of the three displayed cards. A model replaces a recorded alternative only when both scenario bounds dominate the budget it would displace.

## Offline interpretation

Gemma receives compact fastest-lap traces, the vehicle envelope, competing simulated profiles, section/cross-lap facts and limitations. It authors qualitative hypotheses, experiments and validation text rather than selecting prewritten interpretation menus. Rust validates IDs and numerical boundaries and supplies every gain. A displayed range stays attached to its deterministic simulated experiment; a different model-authored experiment is labeled separately. Analysis and reasoning version changes invalidate the existing cache. Offline inference, terms acceptance, cancellation, deterministic fallback and synchronized telemetry inspection remain in place.

Fresh identical adversarial trials found both Gemma 3 1B and 4B unreliable: each passed schema checks but failed causal-quality review on both workloads. The stronger model still recommended shifts or RPM interruptions contradicted by the supplied evidence. Peak process memory was about 1.24 GB for 1B and 3.54 GB for 4B; the default weights remain unchanged. A full real-0362 CPU trial fit the context budget but hit the 90-second generation deadline with incomplete unsupported prose. No model explanation was accepted from that trial. Mechanically validated prose is not a proof of sound engineering judgment.

See [deterministic validation](physics-coach-validation.json) and [model benchmark inputs, actual outputs and assessments](physics-coach-reasoning-benchmarks.json).

## Verification

The final full Rust library suite passed 152 tests; its focused coach subset passed 66 tests. Focused frontend, workspace and video synchronization checks passed 187 tests; the production frontend build passed. The real-XRK browser workflow passed with simulated IPC, covering prominent ranges, recorded/theoretical separation, telemetry inspection, cancellation, stale completion, caching provenance, and responsive dark/light layouts. Synthetic checks cover exact timing, already-optimal/no-gain profiles, downstream braking costs, combined grip, performance sensitivity, sparse capacity and actual inferred-envelope gaps/outliers. Independent review reproduced the real gains and accepted the solver, statistical support and nonoverlapping aggregation.

The broad frontend suite had 319 passes and eight failures in unchanged tests/website-download.test.ts (homepage expectations and script evaluation). No native Windows host, installer, release pipeline or new package was built. Browser verification initially lacked loopback permission, then passed with local access; a run under concurrent inference stalled, a clean rerun passed, and subsequent reruns encountered intermittent Chrome locator/click timeouts. These automation failures are retained as a limitation; no native WebView GUI pass is claimed.

Reproduce with `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib`, `npm test -- --run src/coach src/workspace.test.ts src/video`, `npm run build`, and `npm run test:coach`. The browser check requires local XRK files and loopback access. Recordings are never modified.
