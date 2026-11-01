# UI polish and motion verification — 2026-10-25

## Delivered

- Shared Motion spring tokens, traveling workspace selection surface and session/lap selection rails. Bounded surface transitions, menu/dialog reveals, control feedback and Coach insight reveals use transform/opacity where practical. CSS handles small interaction states; no second animation runtime was necessary.
- Global Motion reduced-motion policy plus CSS overrides. Native chart cursor updates remain immediate.
- Refined typography, control hit areas, lap summaries, legends, inspector cards, popovers, dialogs, Advanced controls, Video surfaces and Coach estimates/evidence. Compact layouts support the 600×500 minimum.
- Workspace scroll memory waits for asynchronous content height and yields to user input. Acquired context channels remain available across navigation while plot visibility follows selected channels.
- Advanced retains its local canvas view and suspends analysis/drawing while inactive. Video retains its attached player and pauses outside Video. Equivalent channel requests do not restart analysis. Event overlays paint without reconstructing plots or resetting their scales.
- Coach presentation and full-lap SVG output are memoized to avoid rebuilding unchanged evidence during unrelated telemetry interaction.

No native telemetry, physics, inference, persistence or media synchronization algorithms were changed. Existing uncommitted work was preserved.

## Checks

- TypeScript: `npx tsc -b --pretty false` passed.
- Targeted Vitest run: 208 tests across 15 files passed, covering motion navigation, Explorer, Coach, video, Advanced integration and workspace restoration.
- `npm run test:sidebar`: passed at 600×500 through 2560×1440, with 100 sessions, long content, independent scrolling, keyboard/drawer focus, persistence and chart/canvas/player identity during resizing. Added navigation checks confirm retained Advanced canvas/zoom, zero hidden Advanced draws/analysis requests, retained video element and pause on departure.
- `npm run test:advanced`: passed using native-derived XRK output, including event cursors, speed units, formulas, presets, asynchronous isolation and no-lap/no-channel states.
- Video component and App integration browser checks passed, including source replacement, mappings, hover/zoom/pan, delayed seeks, stale callbacks, semantic saves and sticky standalone player. Their media readiness/clock are simulated.
- `scripts/verify-polish.mjs`: passed against the production React entry point with recorded XRK results. It captures all four workspace surfaces at 1600×1000, 1024×640 and 600×500; checks overflow, mounted plot retention for equivalent visible channels, scroll restoration, interrupted switching, cursor inspection without new analysis or plot reconstruction, reduced motion and drawer focus.
- Native macOS WebKit development app was visually reviewed with an existing merged session: 24 laps, 54 channels, real telemetry plots, track map, Advanced acceleration analysis, Video empty state and completed deterministic Coach recommendations. Workspace saving was confirmed. The temporary review app was closed afterward; no release build was made.
- Independent read-only review found no remaining blocking issue in the final changes.

The older `verify-coach.mjs` harness has pre-existing provenance expectations inconsistent with the current Coach presentation (`Computed telemetry` versus `Deterministic telemetry`, plus model-prose fixture assumptions). It is not counted as passing. Targeted Coach tests and the current real-XRK visual checks passed.

## Measured performance

Final isolated Chromium development replay at 1600×1000: 12-lap/27-channel recording, two rendered series (533 RPM samples and 268 GPS-speed samples), 18 rapidly interrupted Coach/Telemetry switches.

| Measurement | Result |
| --- | --- |
| Frame intervals sampled | 569 |
| Median / p95 / maximum rAF interval | 33.3 / 33.4 / 33.5 ms |
| Empty-page idle median / p95 | 33.3 / 33.4 ms |
| Observed long tasks during switching | 11, ranging from 51 to 65 ms |
| Analysis requests / plot reconstruction during cursor inspection | 0 / 0 |

The host sampled idle and application frames at approximately 30 Hz. These measurements do **not** certify 60/120 FPS or GPU presentation timing. The remaining long tasks mean flawless navigation performance has not been established. Earlier concurrent test runs are excluded from the final measurement.

Raw measurements: `test-results/polish/metrics.json`. Reproduce with a local native `coach_check` JSON fixture:

```sh
COACH_UI_DATA=/path/to/coach-check.json node scripts/verify-polish.mjs
```

## Evidence and limits

Screenshots: `test-results/polish/` contains the integrated four-workspace captures and reduced-motion capture. `.tools/sidebar-*` contains large/minimum-window numerical Advanced and Video captures. Native screenshots were inspected through computer use.

Windows WebView2, high-refresh GPU profiling, simultaneous model inference and real video decoding were not measured. Native review used deterministic coaching with model terms unaccepted; no new model consent was granted. Browser IPC replay does not measure native computation latency. Reduced motion was automated in Chromium; native OS reduced-motion settings were not changed. There is no separate Settings workspace in the current app; existing theme, preset, Coach and session-detail controls were covered.
