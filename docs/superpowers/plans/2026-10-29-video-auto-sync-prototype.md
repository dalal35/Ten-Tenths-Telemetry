# Automatic video-to-telemetry synchronization prototype implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate and explain candidate video-to-XRK offsets offline, automatically applying only validated reliable matches.

**Architecture:** The backend reads actual video presentation timestamps through the existing native sampler and feeds bounded grayscale frames to a minimal in-process OpenCV tracker. It compares visual turning against validated telemetry yaw, returns evidence and competing hypotheses, and lets the existing workspace segment machinery apply only evidence-supported, nonoverlapping ranges. Independently labeled real footage determines whether the automatic-apply gate can be enabled.

**Tech Stack:** Rust, C++/OpenCV, AVFoundation, Tauri 2, React/TypeScript, existing AiM XRK parser.

**Spec:** `docs/superpowers/specs/2026-10-29-video-auto-sync-prototype-design.md`.

## Global constraints

- Target offline macOS Apple Silicon; no end-user Python, OpenCV install, network, or raw-frame IPC. Other platforms return an explicit unsupported result until built and verified.
- Keep the dirty working tree and existing manual segments intact; do not commit unrelated changes or source footage.
- Use existing validated GPS rules, actual media PTS, authorized local paths or backend-owned cache leases; never trust a path supplied solely for analysis.
- Video `TySa_fqgccc` contains laps from real `data/*0361.xrk` and `data/*0362.xrk`, with pit-stop edits, per user. The earlier synthetic 10-second anchor is not ground truth.
- Uncalibrated results are candidate-only; automatic application requires measured evidence and safe segment boundaries. No statistical confidence or timing accuracy claims without ground truth.

## Review focus

- Similar repeated laps or opposite visual sign: compare all distant offset/sign peaks, reject near ties (Task 3).
- An unseen cut can invalidate an otherwise strong alignment: no segment crosses footage without positive continuity evidence (Tasks 3 and 5).
- Missing/invalid GPS, stationary or shaking camera, sparse frames and variable PTS: omit invalid samples and abstain instead of fabricating a match (Tasks 1–3).
- Changing source/session/content/segments or releasing cached footage during analysis: reject stale completion and retain the lease until worker termination (Tasks 4–5).
- Missing dependency, cancellation, corrupt video and unsupported platform: report a recoverable failure, preserve manual mappings and avoid leaked resources (Tasks 1, 4–5).

## File structure and shared contracts

- `src-tauri/src/video_analysis/motion.cpp`, `motion.rs`: bounded OpenCV tracking over existing `SampledVideoFrame` pixels; no decoder or frontend buffers.
- `src-tauri/src/telemetry/spatial.rs`: expose validated smoothed per-lap fixes without duplicating validity rules.
- `src-tauri/src/video_sync/{mod.rs,telemetry.rs,matching.rs}`: signatures, pure matcher, result types, and background job ownership.
- `src-tauri/src/lib.rs`, `src-tauri/src/library.rs`, `src-tauri/src/youtube/mod.rs`: session snapshot, managed job commands and cache lease ownership.
- `src/bridge.ts`, `src/video/VideoWorkspace.tsx`, `src/video/model.ts`: typed commands, evidence display, existing segment validation and stale-result guards.
- `scripts/prepare-opencv.mjs`, `src-tauri/build.rs`, packaging config, `THIRD_PARTY_NOTICES.md`: pinned, reproducible OpenCV build and redistribution.
- Rust unit/integration tests adjacent to the modules; `src/video/*.test.ts`, `tests/video-integration.tsx`; `docs/video-auto-sync/verification.md` records observations and limits.

Shared Rust values: `MotionSample { time: f64, yaw: Option<f64>, quality: f64 }`, `TelemetrySample { time: f64, yaw: Option<f64>, curvature: Option<f64>, speed: Option<f64>, acceleration: Option<f64> }`, and `CornerEvidence { video_start: f64, video_end: f64, telemetry_start: f64, score: f64 }`. All times are seconds in their respective original playback/session timelines. `Candidate { offset_seconds: f64, sign: i8, score: f64, uncertainty_seconds: f64, corners: Vec<CornerEvidence> }` uses `telemetry = video + offset`; uncertainty is explicitly a heuristic peak width. `SyncResult { candidates: Vec<Candidate>, applicable: bool, reason: String }` defaults `applicable` to false unless Task 6 establishes a defensible gate and Task 5 verifies segment boundaries.

### Task 1: Embedded OpenCV motion tracking and packaging

**Files:** Create `scripts/prepare-opencv.mjs`, `src-tauri/src/video_analysis/motion.cpp`, `src-tauri/src/video_analysis/motion.rs`; modify `src-tauri/build.rs`, `src-tauri/src/video_analysis/mod.rs`, packaging configuration, `THIRD_PARTY_NOTICES.md`; test alongside `motion.rs`.

**Interfaces:** `MotionTracker::new(width: u32, height: u32) -> Result<Self, VideoAnalysisError>` and `MotionTracker::push(&mut self, frame: &SampledVideoFrame) -> Result<MotionSample, VideoAnalysisError>`; input is tightly packed grayscale with actual increasing PTS.

- [ ] Write tests for a translated textured grayscale fixture, stationary frames, bad dimensions, nonmonotonic/gapped PTS and tracker cleanup; assert valid motion follows input PTS and bad/insufficient tracks yield no yaw.
- [ ] Run the focused Rust test and observe failure because the tracker is absent.
- [ ] Pin an official OpenCV 4.13.0 source revision and verified source digest in the provisioning script, build only required `core`, `imgproc` and `video` modules as static Apple Silicon libraries, and link a small exception-safe C ABI wrapper using `goodFeaturesToTrack` and `calcOpticalFlowPyrLK`. Filter failed/forward-backward-inconsistent tracks and use robust median motion; expose no C++ exceptions across the ABI. Include exact licenses and source/build instructions. Do not use a system-installed runtime in the packaged app.
- [ ] Pass the focused tracker tests and verify clean provisioning and application link on Apple Silicon; on unsupported targets return an explicit error. Record dependency sizes, source identity and signing/redistribution requirements.

### Task 2: Validated XRK signatures

**Files:** Modify `src-tauri/src/telemetry/spatial.rs`, `src-tauri/src/telemetry/mod.rs`; create `src-tauri/src/video_sync/telemetry.rs` and module declaration; test adjacent to telemetry code.

**Interfaces:** `validated_lap_fixes(session: &Session, lap: &Lap) -> Result<Vec<(f64, f64, f64)>, String>` returns existing smoothed `(time, x, y)` fixes after current quality checks. `telemetry_signature(session: &Session) -> Result<Vec<TelemetrySample>, String>` preserves lap/session timestamps and gap boundaries.

- [ ] Add tests for known circular and straight paths, angle wrap, low speed, bad fix, GPS gap and speed units; assert signed yaw/curvature, acceleration, and invalid samples rather than interpolating across bad spans. Include both real XRKs in the existing real-fixture test path without modifying them.
- [ ] Run focused tests and observe failure for the missing functions.
- [ ] Expose the existing validated fix calculation and derive unwrapped, smoothed heading and rate; derive curvature from yaw/speed and longitudinal acceleration from speed. Reject low-speed and nonfinite derivatives, and retain breaks between laps and invalid spans. Speed/acceleration are context or quality checks, not independent visual correlations.
- [ ] Run focused and real telemetry tests; confirm valid timestamps, no interpolation across invalid gaps, and no regression of spatial validation.

### Task 3: Coarse-to-fine matching and evidence

**Files:** Create `src-tauri/src/video_sync/matching.rs` and tests; extend `src-tauri/src/video_sync/mod.rs` with shared types.

**Interfaces:** `match_signatures(video: &[MotionSample], telemetry: &[TelemetrySample]) -> SyncResult`; use a 0.2-second grid and normalized valid-sample yaw correlation to search all overlapping offsets and both signs, then refine distinct maxima on a 0.05-second grid. Values and bounds remain configurable internally for calibration, not presented as statistical guarantees.

- [ ] Write deterministic tests for a known offset with three separated turns, reverse camera sign, a one-lap-separated near tie, stationary/low-quality signals, missing spans, too little overlap and inconsistent individual corners. Assert the first cases return the expected candidate and ambiguous/insufficient cases never return `applicable = true`.
- [ ] Run focused tests and observe failure for the missing matcher.
- [ ] Implement bounded resampling and lag search without interpolation across invalid spans; compare distinct peaks across the full lag range and both signs, score at least three nonoverlapping corner windows independently, and return candidates plus peak-width heuristic and rejection reason. Return candidate-only until Task 6 supplies calibrated limits; a missing cut detection cannot certify continuity.
- [ ] Run the matcher tests, including a test that two lap-separated equally scoring candidates remain ambiguous and a test with a cut inside the proposed interval that is never applied.

### Task 4: Safe asynchronous analysis service

**Files:** Modify `src-tauri/src/video_sync/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/library.rs`, `src-tauri/src/youtube/mod.rs`; add backend service tests.

**Interfaces:** Tauri commands `start_video_sync(session_id, content_version, source_identity, video_start, video_end) -> job_id`, `video_sync_status(job_id) -> { phase, progress, result?, error? }`, and `cancel_video_sync(job_id) -> ()`. The source identity is either saved local reference metadata or canonical YouTube ID/cache identity, never an arbitrary analysis path. One job at a time; validate finite interval inside media bounds before sampling.

- [ ] Test stale session/content identity, changed or missing local reference, invalid cached identity, conflicting active job, cancellation while decoding, failure and lease cleanup; no path supplied solely by IPC may grant access.
- [ ] Run tests to observe the missing service.
- [ ] Resolve a source against the saved, authorized workspace reference; for cached YouTube acquire a separate backend lease and hold it until the worker exits. Snapshot the validated session while holding the library lock, release the lock before decode, and run sampling/matching on the blocking pool with the existing cancellation token. Poll small progress/evidence values; release resources on success, failure, cancellation and shutdown.
- [ ] Pass focused service tests and confirm telemetry library operations remain responsive while analysis runs.

### Task 5: Workspace integration and segment safety

**Files:** Modify `src/bridge.ts`, `src/video/VideoWorkspace.tsx`, `src/video/model.ts` as needed; add `src/video` unit tests and extend `tests/video-integration.tsx`.

**Interfaces:** `startVideoSync`, `videoSyncStatus`, `cancelVideoSync` mirror Task 4; represent `SyncResult` and corner evidence in TypeScript. Route any segment insertion through existing `validateSegments` and `onChange`.

- [ ] Add tests that show progress/cancellation, offset/heuristic uncertainty and supporting corners/alternatives, handle failure and unsupported platform, and preserve manual sync. Test changes to source, session, content version and segments while a job runs; stale results must never apply.
- [ ] Run relevant unit/browser tests and observe missing controls.
- [ ] Add a bounded user-selected analysis interval, status, cancel action and result display. If and only if the backend calibrated gate and independently established continuity/bounds support automatic application, create a nonoverlapping segment with `anchorTelemetryTime = anchorVideoTime + offset`, zero correction and an anchor inside a recorded lap; otherwise display the candidate with the reason and retain manual fallback. Never overwrite a manual segment or extrapolate across an unverified cut.
- [ ] Run frontend unit and video browser integration tests, including existing manual local and cached YouTube flows.

### Task 6: Real-data calibration, regression and acceptance

**Files:** Create `docs/video-auto-sync/verification.md`; optional private scratch evidence under `.tools/`, never commit footage or XRK files.

- [ ] Independently identify multiple timestamped lap/corner anchors in the authorized video and the matching 0361/0362 telemetry, using frame/track evidence rather than the algorithm under evaluation. Record how each anchor was verified and its uncertainty; retain some anchors/windows for holdout and include pit-stop edits and unrelated/ambiguous windows as negatives. If independent anchors cannot be established, report that and leave `applicable` false.
- [ ] Run analysis against the actual cached video and both XRKs; record machine, sampled range, wall time, estimated versus manual offsets, absolute error per held-out anchor, candidate alternatives, failures and resource use. Do not infer accuracy from synthetic data or mark a negative as positive to tune a threshold.
- [ ] Only enable a fixed conservative automatic-apply gate if held-out positive and negative evidence supports it and segment continuity is independently established; otherwise ship the candidate-only prototype as an explicit unmet requirement. Document sample size and lack of generalization from one camera/session.
- [ ] Run affected Rust tests, `npm test`, `npm run build`, `npm run test:video`, and packaged macOS playback/analysis/cancellation verification. Obtain independent read-only review of the integrated diff, address material findings, and rerun affected checks. Record unverified Windows runtime and all observed failure cases. Preserve all preexisting changes; do not commit without a separate instruction.
