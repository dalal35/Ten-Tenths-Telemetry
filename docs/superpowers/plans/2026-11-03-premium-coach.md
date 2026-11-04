# Premium AI Driving Coach implementation plan

**Goal:** Turn the existing production Coach into a race engineer's debrief, preserving every solver, inference and evidence contract.

**Direction:** Race Control + Hypercar, informed by the design-taste Data terminal sheet (seed 1649751969), retaining the production palette and fonts. The signature is a circuit and distance-linked opportunity navigator beside a focused driving experiment. The largest figure answers “what can I test next?” using supported ranges only. No chat bubbles or decorative effects.

**Data:** Existing CoachReport, validated explanations, real section intervals, measured evidence, deterministic speed scenarios, coverage and rejection diagnostics. Missing inputs remain unavailable. Scenarios are explicitly conditional, never confidence intervals. Braking/acceleration/line labels describe only supplied evidence; unavailable direct sensors are disclosed.

**Architecture:** Keep Coach's queue, lifecycle, consent and memoized inactive presentation. Extract a selected-insight debrief and real-section navigator. Reuse supportedGain/Range/Model and cardCoaching. Inspect real intervals through App's existing telemetry navigation. Scope visual styling to the production premium app. No backend, Video, Library or website changes.

- [x] Inspect pipeline, callers, numerical gates and real-recording verifier.
- [x] Build ranked opportunity selection, focused coaching/evidence, circuit/section navigator and honest sensor coverage.
- [x] Enhance actual/scenario profile with sampled-point inspection and selected interval emphasis.
- [x] Verify existing output, consent, cancellation, state retention, evidence navigation and malformed/missing data with focused tests.
- [x] Use real 0361/0362 outputs in Playwright; inspect desktop and 600×500, both themes and reduced motion. Refine visible issues.
- [x] Review final diff, run build/regressions, commit implementation. Do not push or merge.

**Verification limits:** Avoid full Rust rebuilds and unrelated expensive suites. Reuse genuine locally cached diagnostics or existing binaries; disclose native inference not rerun if unavailable. Keep private recordings/diagnostic payloads out of Git. Disk checked before artifacts: about 49.6 GiB free.
