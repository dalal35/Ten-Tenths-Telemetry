# Merged-session coaching implementation plan

Goal: analyze merged recordings through the existing coaching UI, using all valid laps and original source telemetry without joining recording clocks.

Architecture: retain the virtual merged session and qualified identities; supply validated original source snapshots to coaching. Resolve each lap to its original recording for alignment and dynamics. Reuse current spatial comparison, feasibility validation, deterministic explanation fallback, and cache persistence.

Constraints: preserve existing uncommitted work and single-recording behavior; no new dependencies or app bundle builds. The user explicitly authorized end-to-end implementation without approval. Work in place because the required coaching implementation is currently untracked in this checkout.

- [x] Reproduce the existing ignored 24-lap regression.
- [x] Connect source-aware snapshot, comparison, and physics calibration; add focused backend tests for alignment, provenance, missing data, and compatibility.
- [x] Enable merged Analyze and automatic analysis; test merged coaching presentation and navigation.
- [x] Activate and strengthen the 24-lap regression, including merge/unmerge persistence.
- [x] Run focused Rust and frontend checks, obtain independent review, address material findings, and report exact lap counts and limitations.

Verification: 13 merge integration tests passed; strengthened 24-lap regression passed with 20 valid spatial comparisons and 4 incomplete laps excluded. 80 coaching unit tests and 36 frontend tests passed; TypeScript check passed. Independent read-only review found no blocking defects. Fastest actual 26.585 s; recorded theoretical best 26.585 s; conditional full-lap physics range 25.285577–26.204883 s. Both recordings contribute calibration; feasibility violations: zero. No app bundle build or local model inference rerun.
