# Workspace transition verification

The workspace shell stays stationary. A 220 ms compositor animation fades and subtly recedes an opaque outgoing viewport snapshot over the live incoming workspace. Motion owns the shared tab indicator; chart coordinates and live video are never transformed. Latest navigation wins, including deferred Coach inspections. Reduced motion commits immediately; unsupported engines use a short opacity settle.

The previous implementation scrolled the shell and animated only the incoming chart column. An initial replacement captured both incoming and outgoing content, but a strengthened test exposed a native View Transitions constraint: captured incoming elements leave hit-testing, losing the first click from a parked pointer. Capturing only the outgoing scene fixes that without replaying synthetic input.

## Focused checks

- TypeScript project check passed.
- 208 tests across 15 files passed: navigation/controller, Coach, Advanced integration, Video and workspace state.
- `node scripts/verify-workspace-transitions.mjs` passed all 12 ordered workspace pairs at 1440×1000 and 600×500. Captured frames at 0/55/110/165/219 ms confirm a stationary shell, no live transforms and interactive incoming content.
- First parked pointer click changes graph density; first parked wheel scrolls. Rapid switching, resize interruption, reduced motion and unsupported-engine fallback pass.
- Advanced retains its canvas and local zoom with no hidden draws or analysis requests. Video retains its node and playback position and pauses on departure. Hidden inference completes without cancellation and its result/card nodes survive. Initial saved Coach and hidden lap changes construct no telemetry plots. Superseded Coach inspections leave no stale selection, zoom or seek; latest same-destination inspection wins.
- The preceding session's Sidebar and Video integration browser checks passed after the bounded video-player/scroll fix. They were not needlessly repeated after the outgoing-snapshot-only correction.
- Independent final read-only review found no blocking issue; `git diff --check` passed.

## Native macOS WebKit

The existing debug app used real native IPC and a restored merged XRK session (24 laps, 54 channels, selected lap 21, four selected channels). All workspace pairs and rapid sequences of 24 requests spaced 35 ms apart ran in the actual WebKit application. The application window was also resized using native window controls.

Saved resize evidence contains 193 transitions across native app sizes 1440×888 and 961×494, plus constrained 600×500 and 600×494 surfaces: zero recorded shell shifts, stale final destinations or audit failures. Native paused frames at 0/110/165 ms were visually inspected, including a compact Video→Telemetry crossfade. Physical native input changed graph density and scrolled the incoming viewport while the outgoing snapshot was paused. The original Advanced workspace, density and window size were restored.

`test-results/workspace-transitions/native-audit-resize-runs.json` preserves those resize runs. Their performance tails are excluded from the final claim: the Vite audit server was scanning large build directories and later exhausted memory. Vite 6 discarded the inline `watch:null` during config merging. Both verification scripts now set it after the merge and assert the resolved configuration; the corrected server was responsive at 0% CPU and 86 MB RSS.

A fresh isolated run with the corrected server saved **95 transitions, zero audit failures and zero shell movement**, at 1440×888 and a constrained 600×500 surface. Each surface covered all twelve ordered pairs and 24 rapid requests spaced 35 ms apart. `test-results/workspace-transitions/native-audit.json` contains the raw intervals.

| Isolated native measurement | Result |
| --- | --- |
| Completed normal transitions (36 samples), median / p95 / max | 252 / 255 / 260 ms |
| Snapshot readiness, median / p95 / max | 20 / 26 / 28 ms |
| All transition frame intervals (559 samples), median / p95 / max | 17 / 19 / 37 ms |
| Idle frame intervals (60 samples), median / p95 / max | 17 / 19 / 38 ms |
| Event-loop lag proxy, median / p95 / max | 4 / 11 / 22 ms |

Skipped rapid transitions are included in frame sampling but excluded from completed normal-duration statistics. Durations measure the full API lifecycle, including capture scheduling, around the 220 ms CSS animation. Instrumentation reads shell geometry each frame; these are main-thread rAF intervals, not GPU presentation timestamps.

The earlier Chromium fixture run passed with median 16.7 ms and rapid-switching p95 49.9 ms, but its timings may also include the same watcher interference and are superseded by the isolated native measurement. Browser correctness checks remain valid; its native IPC and media clock are simulated.

## Limits and reproduction

WebKit does not expose the Long Tasks API here; event-loop lag is a proxy, not a count of long tasks. Occasional frame stalls remain, so consistent 60/120 FPS is not certified. Windows WebView2, simultaneous local model inference plus real video decoding, high-refresh GPU presentation, and native OS reduced-motion settings were not profiled. Automated reduced-motion behavior passed in Chromium. No release packaging or backend changes were performed for this follow-up.

Browser evidence: `test-results/workspace-transitions/metrics.json` and `frame-*.png`. Reproduce with `node scripts/verify-workspace-transitions.mjs`.

Native instrumentation is test-only: `node scripts/serve-workspace-transition-audit.mjs`, then use the existing development app. Alt+Shift+R runs all pairs and rapid switching, P arms a paused capture, Right steps it by 55 ms, M constrains the app surface, and S saves the report. This script imports the production app and does not mock native IPC.
