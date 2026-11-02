# Actionable Driving Coach Implementation Plan

> **For agentic workers:** Implement and verify each assigned component within its ownership; parent integrates and reviews.

**Goal:** Turn full-lap modeled gains into distinct, evidence-specific driving experiments with honest inference provenance.

**Architecture:** Preserve the existing full-lap solver, gain attribution, primary selection and navigation bounds. Extract phase-level speed-profile evidence in Rust; construct supported competing interventions for each opportunity. Gemma selects a supported intervention and explains it within validated factual boundaries. Deterministic advice uses the same source evidence.

**Tech Stack:** Existing Rust telemetry/llama.cpp backend and React/TypeScript UI; no new dependencies.

**Spec:** User request in this session, “Fix AI Driving Coach: Turn Simulated Gains Into Real Driving Advice”.

## Global Constraints

- Offline operation, cancellation, lightweight performance and cross-platform compatibility.
- Preserve three recommendation cards, individual gain ranges and modeled lap range.
- Preserve synchronized telemetry/map/video interval identity.
- Do not label fallback as AI reasoning or infer unavailable measured controls.
- Preserve unrelated pre-existing workspace changes; no packaging pipeline or commits requested.

## Review Focus

- Consent changes and model availability changes must not reuse stale inference results.
- A speed minimum is not a measured geometric apex or proof of brake/throttle misuse.
- Missing RPM/control channels must not lead to causal diagnoses.
- Section savings may contain entry costs and downstream compromises.
- Sparse/noisy profiles need investigation language, rather than invented mechanisms.

### Task 1: Physics evidence and fallback

**Files:** `src-tauri/src/coach/full_lap.rs`, `types.rs`, focused evidence module if useful.

- [x] Pin distinct physical mechanisms with failing synthetic tests.
- [x] Extract actual versus optimized entry/deceleration/minimum/recovery and connected-section metrics, including sensor limits.
- [x] Populate concise title, observation, experiment, validation and supported hypotheses without changing solver/ranges.
- [x] Verify individual and merged 0361/0362 recordings and compare numerical ranges with baseline.

### Task 2: Inference and cache boundary

**Files:** `src-tauri/src/coach/runtime.rs`, `service.rs`, `commands.rs`.

- [x] Pin unsupported selection/claims, consent and model-state caching with failing tests.
- [x] Supply structured evidence and competing hypotheses; validate selection and factual/sensor boundaries.
- [x] Keep provenance explicit and avoid caching transient inference failures as successful AI results.
- [x] Run actual local Gemma on the same real-recording workload and compare with deterministic output.

### Task 3: Compact UI

**Files:** `src/coach/*`.

- [x] Pin specific physics titles, source badges and correct use of validated model explanation with failing UI tests.
- [x] Render distinct concise evidence/try/verify advice and preserve gains and navigation.
- [x] Verify consent transitions clear stale result state.

### Task 4: Integrated acceptance

- [x] Run targeted Rust and frontend tests and frontend compilation.
- [x] Review actual recording recommendations, numeric invariance and correct bounds.
- [x] Obtain independent read-only acceptance review; fix blocking findings.
- [x] Write reproducible before/after results and report provenance and verification limits.
