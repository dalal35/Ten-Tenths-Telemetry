# Calibrated full-lap offline coach

Validated on the two local Purdue GP XRK recordings without external lap records or manual targets. The coach now solves one continuous periodic speed profile across all seven corners and four straights. Numerical estimates come from Rust; Gemma only receives structured results for qualitative interpretation.

## Real-recording results

Times are seconds. Modeled ranges are conditional calibration and geometry sensitivity, including leave-one-training-lap-out stability; they are not confidence intervals or guaranteed gains.

| Recording | Fastest recorded | Recorded theoretical best | Modeled lap | Conditional improvement | Simulation coverage |
|---|---:|---:|---:|---:|---:|
| 0361 | 26.676 | 26.676 | 25.315–26.305 | 0.371–1.361 | 100%, 11 sections |
| 0362 | 26.585 | 26.585 | 25.306–26.229 | 0.356–1.279 | 100%, 11 sections |

Both profiles pass every cell's acceleration, braking, lateral and friction-ellipse checks, including the lap seam. Each recording has 414 final scenario cells checked (207 cells × two scenarios), zero violations, and zero distance requiring outer-speed capability extrapolation. Independent review reproduced the results and continuous-ellipse regression. The actual-speed integration residual is +0.040 s for 0361 and +0.025 s for 0362; recorded section crossing times supply the actual gain baseline. Full analysis took about 1.0–1.1 seconds per recording in the local debug diagnostic, outside inference.

The former heuristic's conditional whole-lap budgets were 0.148–0.212 s and 0.056–0.126 s respectively. Its new-style interval solves supported only Corner 1 and its downstream interval. Those archived values remain in [physics-coach-validation.json](physics-coach-validation.json). The global physics scenario replaces the overlapping heuristic budget entirely; neither recorded sector savings nor the three visible cards are added to it.

## Per-corner attribution

These are signed local ranges from the same two continuous lap scenarios. Negative values mean a local cost. Each scenario's complete signed section changes, including straights, reconcile to its integrated lap gain. Selecting the best endpoint independently in each row does not create another feasible lap.

| Corner | 0361 signed change (s) | 0362 signed change (s) |
|---|---:|---:|
| 1 | +0.147 to +0.223 | +0.049 to +0.125 |
| 2 | −0.096 to +0.037 | −0.045 to +0.100 |
| 3 | +0.094 to +0.142 | +0.092 to +0.130 |
| 4 | +0.056 to +0.240 | +0.140 to +0.293 |
| 5 | −0.069 to +0.067 | −0.035 to +0.081 |
| 6 | +0.193 to +0.238 | +0.193 to +0.237 |
| 7 | +0.037 to +0.111 | −0.002 to +0.080 |

Top cards are Corners 4, 6 and 1 for 0361, and Corners 4, 6 and 3 for 0362. Actions identify the entry, minimum-speed transition or exit phase from the local speed deficit, then propose a controlled experiment and verification through the following section. Their prominent ranges describe simulated potential. Measured faster examples remain separately labeled. When a scenario can lose time, signed diagnostics retain that loss; a displayed zero lower potential establishes no minimum saving.

## Calibration and held-out validation

Each recording has ten complete eligible laps. Training uses `lap-1`, `lap-2`, `lap-4`, `lap-5`, `lap-7`, `lap-8`, `lap-10`; `lap-3`, `lap-6`, `lap-9` are withheld from capacity fitting and all refits. These are internal IDs; the UI displays lap numbers separately. Every lap's physical speed-integrated distance is reconstructed independently. Canonically warped comparison distance is used for measured spatial matching, never dynamics integration.

| Held-out metric | 0361 | 0362 |
|---|---:|---:|
| Optimal-bound versus recorded speed RMSE | 1.298 m/s | 1.207 m/s |
| Optimal-bound versus recorded section time MAE | 0.148 s | 0.151 s |
| Recorded speed above nominal bound by >0.5 m/s | 8.20% | 3.38% |
| 0.4 s ahead speed forecast RMSE | 0.821 m/s | 0.752 m/s |
| Persistence forecast RMSE | 0.968 m/s | 0.906 m/s |
| Forecast absolute speed error, 90th percentile | 1.416 m/s | 1.174 m/s |
| Covered-section forecast time MAE | 0.0214 s | 0.0206 s |
| Forecast windows / temporal coverage | 196 / 95.94% | 195 / 95.63% |

The first three metrics compare an optimized capability bound with human driving. They do not predict unknown driver controls and are not measured longitudinal-demand coverage. The distinct forecast uses only the preceding 0.4-second speed trend, projected onto training combined-grip capacity, to predict speed 0.4 seconds ahead. Its section timing is **teacher-forced over observed displacement windows**, grouped into sections; it is not an autonomous section or full-lap time prediction. Persistence simply holds the current speed. Endpoint curvature support excludes a small fraction of forecast windows, separately from the 100% periodic optimization coverage.

Calibration uses nonoverlapping 0.4-second windows, separate propulsion/braking bands, median/MAD upper-outlier filtering, supported interior interpolation, and a bounded combined-demand correction. There are 254 propulsion / 101 braking windows for 0361 and 251 / 104 for 0362. Both scenario sets include actual feasible leave-one-training-lap-out refits. Sessions above twelve training laps use twelve evenly spaced omissions to bound resampling work. Scenario quantiles and refit variation estimate sensitivity; unmeasured systematic errors remain.

## Physical assumptions and rejection behavior

The model is a 2D point mass following the recorded GPS path. It has speed-dependent longitudinal capacity and lateral demand `v²κ`, coupled by a friction ellipse. A cyclic forward/backward projection retains speed continuity and downstream braking costs. Within a cell, directional capacity uses the minimum across both endpoint speeds and every interior capacity knot; lateral utilization uses the maximum endpoint speed and curvature. Time is integrated as `2Δs/(v₀+v₁)`.

Primary-path curvature uses two chord scales (at least 10 m and three times position uncertainty), with scale disagreement entering scenario sensitivity. Full wrapped chord spans are checked for GPS gaps; seam position and heading closure are required. Geometry is never averaged at unaligned physical distances across laps. Missing speed, GPS gaps, unsupported closure, excessive extrapolation, incoherent timing, insufficient capacity, solver failure and excessive held-out speed-bound exceedance all produce explicit diagnostics. No sections were excluded in either intact recording. The synthetic checks exercise exclusions instead of silently bridging them.

The observed frontier does **not** establish the vehicle's absolute tire, engine or braking limit. No capability uplift, target gain floor, known lap record or external sector target is used. Banking, grade, tire state, aero, alternate lines and track width are unmeasured. RPM and gear evidence is insufficient to identify a reliable shift map here. There is no explicit shift interruption model; mandatory shifts and short interruption losses may be underrepresented by high-quantile acceleration capacity. No separate shifting gain is attributed. These limits do not justify adding a bicycle model yet.

The approach extends the repository's Rust solver. The [TUM FTM trajectory-planning helpers](https://github.com/TUMFTM/trajectory_planning_helpers) provide an independent reference for forward/backward velocity-profile planning; no new package or copied implementation was introduced.

## Offline Gemma contribution

The production model input contains the fastest lap, fixed gain ranges, capacity envelope, signed section times, full-lap profile and selected experiments. The model can prioritize the selected disjoint opportunities and author hypotheses, experiments and verification text. It cannot calculate, alter or add numerical gains. Existing inference isolation, model integrity checks, cancellation, cache provenance and deterministic fallback remain in place; analysis and reasoning versions invalidate old results.

A fresh local Gemma 3 1B run on 0362 completed in 55.0 seconds. It returned three rows, but its hypotheses omitted required uncertainty language and included an invented “Corner Nissan” label. The qualitative/schema guard rejected the output. **Gemma contributed no accepted recommendation text in this validation run.** The coach retains deterministic section-specific experiments and every computed range. The exact structured input, raw rejected output and error are preserved in [full-lap-gemma-validation.json](full-lap-gemma-validation.json). No inference-quality success is inferred from solver tests or simulated browser responses.

## Verification and reproduction

- Rust library suite: **162 passed**. After the final actual-overlay endpoint and complete speed-gap interval corrections, the affected coach subset passed **77 tests**.
- Focused frontend Coach/workspace/video tests: **189 passed**; production frontend build passed.
- Real-XRK browser workflow passed using simulated IPC backed by the real Rust report: speed overlay, per-card gains, synchronized telemetry/video navigation, cancellation, stale completion, cache/model provenance, and dark/light layouts at 1600, 760 and 600 px. This is not a native WebView test.
- Independent read-only acceptance review reproduced real results and dense cell feasibility and found no remaining blocker.
- The broad frontend suite has eight existing failures in `tests/website-download.test.ts`; these are outside this change. No native Windows host or installer/package pipeline was run. No platform-specific dependencies were added.

```sh
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
npm test -- --run src/coach src/workspace.test.ts src/video
npm run build
npm run test:coach
cargo run --offline --manifest-path src-tauri/Cargo.toml --example physics_validate -- \
  'data/yash dalal_59_PURDUE GP IN_Warm-up_a_0361.xrk' \
  'data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk'
```

Browser verification requires local loopback access. Recordings are read-only. [Machine-readable results](full-lap-physics-validation.json) retain exact times, support, held-out errors, all signed sections, selected opportunities and heuristic comparisons.
