# Full-lap physics implementation plan

**Goal:** Estimate conditional full-lap potential from the session itself, with physical constraints, inspectable uncertainty, and real-XRK validation.

**Design:** Extend the existing Rust telemetry and point-mass solver infrastructure. Calibrate propulsion and braking independently from sustained windows; derive robust GPS curvature and its uncertainty. Solve one continuous periodic lap under speed-dependent longitudinal and combined-grip constraints. Integrate time over physical distance; retain signed section costs in the single lap result. The absolute vehicle limit remains unknown.

The user's detailed task supplies requirements and explicitly requests execution without redundant approval gates. Preserve the existing dirty workspace and its offline coach implementation; no commits, packaging, or unrelated refactors are needed.

1. Capture baseline tests and the existing real-recording heuristic results. Obtain read-only advice on calibration, seam handling, and withheld validation.
2. Add `coach/full_lap.rs` with calibration, periodic geometry, cyclic forward/backward solve, physical feasibility checks, cancellation, exclusions, and synthetic tests. Validate on both Purdue XRK recordings.
3. Integrate diagnostics into `CoachReport`; use the global physical result as one alternative to the existing budget, never add overlapping heuristic gains. Keep measured sector comparisons distinct. Invalidate analysis/reasoning cache identities.
4. Preserve the compact dashboard and top-three recommendation ranges. Add actual versus modeled speed curves and inspectable coverage, signed section deltas, calibration assumptions, and held-out metrics.
5. Send deterministic structured results and alternatives to offline Gemma. Keep every calculation in Rust and preserve failure/cancellation fallback.
6. Run focused and full Rust checks, relevant frontend checks/build, real-recording diagnostic and browser workflow where available. Independently review the integrated artifact and correct material findings.
7. Save a reproducible report with actual/recorded-theoretical/modeled times, coverage, calibration/held-out membership, speed and section-time errors, feasibility checks, signed per-corner gains, exclusions, prior heuristic comparison, and actual Gemma contribution.

**Validation limits:** An optimal speed envelope is a bound, not a prediction of unobserved driver inputs. Held-out optimized-versus-recorded errors must be labeled accordingly; calibration demand exceedance is evaluated separately. Spatially warped comparison distance must not replace physical distance in time integration. Reject missing geometry, timing incoherence, unsupported capacity, or infeasible profiles explicitly. Do not tune to known records or desired gains.
