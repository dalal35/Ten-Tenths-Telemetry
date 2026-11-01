# Offline Coach Implementation Plan

**Goal:** Installable offline, evidence-backed driving feedback integrated with telemetry inspection.

**Architecture:** Existing Rust spatial analysis supplies typed facts. Embedded bounded inference chooses validated explanation identifiers. React renders computed evidence and navigates existing charts.

**Spec:** ../specs/2026-10-19-offline-coach-design.md

## Global constraints

- No cloud inference, accounts, API keys, Python runtime or installed AI service.
- Preserve telemetry recordings, existing styling, existing workspaces and uncommitted changes.
- No fabricated metrics, unsupported controls or certain causal claims.
- Targeted development checks, then integration verification; report actual platform limits.

## Review focus

- Spatial coverage and resolution must gate numerical claims.
- Cross-lap or overlapping section losses must not become a summed promised gain.
- Changing session/reference/boundaries must invalidate cached reports and stale UI responses.
- Cancellation must release resources and never cancel a different request.
- Missing model/runtime must retain specific deterministic evidence.

## Tasks

- [x] Implement `coach::analysis::analyze_with_cancel` and serializable report types; synthetic timing, quality, RPM, partition and real-XRK tests.
- [x] Embed pinned llama.cpp bindings, structured evidence/action validation, inference bounds, cancellation and model release; test rejection paths and benchmark Gemma 3 1B/4B on real weights.
- [x] Add immutable library coach inputs, content/boundary/model cache identity and background commands with separately accessible cancellation/status; test cache and job ownership.
- [x] Add coach workspace, persisted reference and view, controls/cards and evidence-linked lap/time focus; test restoration, navigation and stale async work.
- [x] Integrate default model resources, runtime/model licenses and build-time verification; run native macOS checks and preserve Windows builds, explicitly recording unavailable native checks.
- [x] Independent acceptance review, bounded corrections and affected checks; document architecture, maintenance, actual benchmark results and outstanding release gates.

## Verification record

Completed on 2026-10-19: 110 Rust library tests, full frontend suite (289 tests before the final instantaneous-event regression), 20 focused frontend tests including that regression, real-XRK browser workflows with missing video and both themes, model 1B/4B evaluations, network-restricted CPU inference/cancellation, packaged native self-check and optimized ad hoc signed macOS DMG build. Independent review confirmed no remaining blockers in the reviewed corrections.

Remaining release limits: native Windows compilation/installer/GUI verification and physical desktop GUI acceptance were not run here. Cross-recording merged coaching is unsupported. Cancellation occurs between native operations and is not a hard process/RAM cap. See docs/offline-coach-runtime.md and docs/offline-coach-benchmarks.json.

Final packaging correction: the HFS DMG introduced FinderInfo signature detritus on this host. The macOS build helper now uses clean APFS staging, preserves the Applications shortcut, and verifies source/staged/mounted signatures. Final mounted-image verification and real-XRK offline self-check passed (10 valid laps, 2 findings, 2 model explanations, 9.103 s). Temporary image was detached.
