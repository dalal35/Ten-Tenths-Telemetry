# Actionable driving coach verification

The coach now extracts driving experiments from actual versus optimized speed profiles. The full-lap optimizer and its numerical gain calculations are unchanged. All recommendations remain conditional experiments; speed and RPM do not establish driver pedal, steering or gear behavior.

## Pipeline diagnosis

- Without consent, native inference is bypassed and every card is deterministic telemetry advice.
- Previously, physics card titles were hardcoded to “Test connected section momentum”, and the UI ignored the model's experiment on modeled cards.
- A reproduced pre-change Gemma run on 0362 was rejected for invented names and unsupported prose. A saved merged run failed before loading because source-qualified opportunity IDs violated the native model ID whitelist.
- Production inference selects corner-specific supported intervention/reason pairs. Rust supplies and validates the experiment, competing explanation and success metric. The UI labels this **Gemma-selected experiment**. It labels fallback **Deterministic telemetry**.
- Compact, opaque model-facing IDs preserve strict validation while mapping selections back to original opportunity and telemetry identities.
- Consent, analysis/reasoning versions and model file state affect the result cache. A transient model failure does not prevent a subsequent inference attempt.

## Real-recording deterministic results

Before: all physics cards had the same generic headline, despite different modeled profiles.

After, 0362:

| Section | Specific experiment | Success metric | Existing gain range |
| --- | --- | --- | --- |
| Corner 4 | Hold approach speed repeatable and open the exit arc earlier; build acceleration smoothly. | Recovery distance, exit speed, corner plus following-section time. | 0.140–0.293 s |
| Corner 6 | Complete the slowdown earlier so speed can build before the recorded late trough near 351 m. | Minimum-speed location and recovery onset, with no downstream time or exit-speed loss. | 0.193–0.237 s |
| Corner 3 | Test a smoother arc through the minimum-speed region near 188 m while preserving the exit. | Minimum speed/location, exit speed and combined time. | 0.092–0.130 s |

0361 selects Corner 4 exit recovery (0.056–0.240 s), Corner 6 minimum-speed tradeoff (0.193–0.238 s), and Straight 4 preceding-exit carry (0.017–0.090 s). Selection avoids repeating the same physical intervention, so its third card differs from the previous Corner 1 card. All candidates retain their original ranges.

Merged 0361 + 0362 selects Corner 4 exit recovery (0.142–0.343 s), Corner 6 late minimum (0.194–0.255 s), and Corner 1 deceleration placement (0.047–0.153 s). Merged calibration legitimately uses both recordings; its ranges differ from individual analysis.

The entire serialized full-lap physics diagnostics, modeled lap ranges and gain ranges compare exactly equal to the captured pre-change baseline for both individual recordings. Modeled laps remain 25.315–26.305 s (0361) and 25.306–26.229 s (0362). Merged modeled lap: 25.043–26.231 s.

See `actionable-coach-before.json` and `actionable-coach-validation.json` for full facts and exact navigation intervals. Native Gemma results and timings are recorded separately in `actionable-coach-gemma-validation.json`.

## Reproduction

Run targeted checks:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib coach:: -- --test-threads=2
cargo test --manifest-path src-tauri/Cargo.toml --test merging merged_coach
npx vitest run src/coach
npx tsc -b
```

The `coach_recordings` example accepts individual XRK paths or `--merged` followed by both paths. Add `--explain --accept-gemma-terms` to invoke the pinned bundled Gemma model. Diagnostic consent is ephemeral; it does not modify the user's app consent or recordings.

## Interpretation limits

Gemma chooses among supported interventions and an investigation alternative. This verifies real inference and grounded integration; it does not demonstrate superior driving outcomes over fallback. Rust owns displayed factual wording and numbers. These remain experiments to verify on track, rather than established causal diagnoses or guaranteed savings.

No packaging or cross-platform release build is required for these changes. Synchronized navigation is checked through interval/source identity tests; actual platform video decoding is outside this verification.

## Targeted checks on resumed implementation

- `cargo test --manifest-path src-tauri/Cargo.toml --lib coach:: -- --test-threads=2`: **88 passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml --test merging merged_coach`: **2 passed**.
- `npx vitest run src/coach`: **50 passed**.
- `npx tsc -b`: passed.
- Exact comparison of both real individual recordings against the captured baseline: full physics diagnostics, modeled lap ranges and improvement ranges unchanged.

The resumed verification deliberately excludes website tests, packaging, and platform video fixture generation. The earlier broad run encountered unrelated website expectations and AVFoundation fixture-generation failures; those files were not changed for this task.

## Fresh native Gemma results

All three final runs returned `localModel`, no notice, fresh results, and three validated `modelSelectedInterpretation` explanations. The model was the pinned bundled Gemma 3 1B Q4_K_M, running offline on CPU.

| Workload | Total local explanation time | Native inference | Generated tokens | Selected mechanisms |
| --- | --- | --- | --- | --- |
| 0361 | 37.663 s | 32.582 s | 74 | Exit recovery; minimum-speed tradeoff; preceding-exit carry. |
| 0362 | 37.244 s | 31.890 s | 74 | Exit recovery; late minimum; minimum-speed tradeoff. |
| Merged | 40.976 s | 37.310 s | 229 | Exit recovery; late minimum; deceleration placement. |

All nine selections matched the main deterministic intervention for that corner. Each adds the selected supported rationale and alternative explanation in the UI. No performance or advice-quality superiority is claimed. Model initialization, integrity checking, and loading account for part of the total time; these are measurements on this host, not cross-platform latency guarantees.

The merged run restored all three source-qualified opportunity IDs correctly. Every displayed action, hypothesis and success metric matched the selected source hypothesis exactly; numerical ranges and telemetry intervals remained attached to their original opportunities. Full evidence is in `actionable-coach-gemma-validation.json`.
