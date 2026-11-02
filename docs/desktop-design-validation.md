# Desktop design and motion validation

Implemented on November 1, 2026. The application now uses a shared graphite/light
instrument system, local IBM Plex typography, quieter timing-sheet navigation,
readable secondary text, and consistent controls across Telemetry, Advanced,
Video, Coach, the library, and dialogs. Numerical analysis, IPC contracts,
recording formats, and playback clocks are unchanged.

## Design and motion sources

Installed personally, outside source control, and read during implementation:

- [taste-skill](https://github.com/Leonxlnx/taste-skill): app-screen inventory,
  framed-sheet direction, real-browser probes and screenshot review.
- [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design):
  deliberate typography, restrained color and subject-specific composition.
- [transitions.dev](https://github.com/Jakubantalik/transitions.dev): shared
  timing vocabulary and faster, quieter exits.
- [LottieFiles motion-design](https://github.com/LottieFiles/motion-design-skill):
  restrained amplitude, weight, staging and immediate interaction feedback.
- [motionmaxxing](https://github.com/Tejashmakwana/motionmaxxing): dedicated
  second pass reviewing continuity, timing, captured frames and actual behavior.

The [curated motion index](https://github.com/charetterat/awesome-agent-motion-skills)
was read as a reference, not installed. Motionmaxxing's current workflow targets
films; its film runtime/render gates were not presented as UI validation. The
compatible review principles were applied to the actual application. No second
animation library was added.

## Second-pass corrections

Rapid navigation originally requested 31 browser snapshots in a 32-click burst.
It now captures at most once and commits subsequent destinations immediately.
The existing controller still owns cancellation and rejects superseded updates.
Shared spring selections cover workspace, axis and analysis-tool controls.
Scrollable projection owners keep selection markers aligned; the focused
scroll test measured less than 0.04px deviation from the intended bounds.

Floating surfaces become inert as they exit. Native session details release
top-layer modality immediately, finish their visual exit nonmodally, and regain
native modality if reopened before the exit completes. Focus restoration,
keyboard handling and interrupted reopening have browser regression coverage.
Button spring feedback, old selection flashes, inherited button shadows,
remaining tiny evidence/video labels, and a shared SVG sizing issue in the
website demo were corrected during review.

Captured transition frames at 0, 55, 110, 165 and 219ms confirm a stationary shell
and interactive incoming content. Live chart and video coordinates remain
untransformed. Cursors, telemetry values and video scrubbing are immediate.
Reduced-motion checks cover navigation, selections and floating surfaces.

## Actual native measurements

The final production frontend ran locally inside the Windows Tauri/WebView2
desktop app, using real native IPC and a real XRK recording: 12 laps, 27 channels,
220,612 source samples. Measurements were taken after warm-up, separately from
other browser suites. These are observed requestAnimationFrame intervals, not a
guarantee of compositor or display frame delivery.

| Native scenario | Frames | Median | 95th percentile | Maximum | Frames over 25ms | JS long tasks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Idle recording | 71 | 16.6ms | 17.1ms | 17.2ms | 0 | 0 |
| Rapid navigation, 32 requests | 301 | 16.6ms | 17.1ms | 49.9ms | 6 | 0 |
| Local video plus telemetry cursor | 107 | 16.6ms | 17.1ms | 17.2ms | 0 | 0 |

The checked-in CC0 H.264 fixture actually decoded and advanced 1.82 seconds while
the chart cursor was exercised: 23 decoded frames, zero dropped frames. This is
a 128×64, 60-second fixture, not a high-resolution footage benchmark. The full
original saved workspace was restored and compared for equality after the audit
and the final UI save. Test injection first waits for the application's saved
signal and detaches the old UI so queued saves cannot overwrite restoration.

The development frontend was also profiled. React's development JSX validation
dominated its navigation cost, so development numbers were not substituted for
the production results above. Development-mode timing remains substantially
slower than the production build.

## Checks performed

- `npm test`: 28 files, 323 tests passed.
- `npm run build`: passed. The existing large-chunk advisory remains; the main
  JavaScript chunk is approximately 653kB before compression.
- `node scripts/verify-design.mjs`: four workspace screenshots, dark/light
  views, multiple sizes, rapid input, menu focus/reduced motion, and scrolled
  shared-element geometry passed. Its large-series fixture exercises 100,001
  samples per series, four compared series, 24 rapid requests, resize and
  retained plot identity: 400,004 samples total.
- `node scripts/verify-workspace-transitions.mjs`: all 24 ordered workspace/size
  combinations passed, including paused transition frames, interrupted input,
  no hidden Advanced work, retained chart/zoom/video identity, background coach
  completion, resize interruption, reduced motion and legacy fallback.
- `npm run test:sidebar`: 100 sessions; organization, keyboard/focus, merging,
  details editing, saved modes and 600×500–2560×1440 resizing passed. Focused
  details checks also passed after the native-modal review fixes.
- `npm run test:workflow`, `npm run test:canvas`, `npm run test:video` and
  `npm run test:branding`: passed.
- `npm run build:website` and `npm run test:website`: passed, including download
  fallbacks on six platform identities and the existing interactive demo.
- `node scripts/verify-native-design.mjs`: real recording, all four screens,
  real local playback, reduced motion, performance and full restoration passed.
- The installed taste skill's browser probes report zero **FAIL** findings
  across the four native workspaces. Retained warnings concern timing-sheet
  uppercase labels, technical figure typography, the varied type scale, and a
  native media element without a marketing-style poster. Its tiny-text warnings
  can include hidden workspace descendants; visible remaining labels were
  separately inspected and corrected.
- Independent code review completed; reported focus, interrupted re-entry,
  restoration, scroll-projection, SVG and CSS-specificity issues were fixed.
- `git diff --check`: passed. Unrelated Windows video work was preserved.

The browser harness now actually disables Vite watchers through a config hook;
Vite 6 had dropped the inline null override and scanned native build artifacts.
The website test server's containment check now handles Windows path separators.

## Artifacts and limits

Screenshots and machine-specific results stay under ignored `test-results/`:

- `design/before/`: baseline captures.
- `design/final/`: synthetic comparison views, themes, window sizes and stress.
- `design/native/`: final real-recording screenshots and `metrics.json`.
- `design/native/taste-inspection-all.json`: raw installed-skill findings.
- `workspace-transitions/`: interrupted transition frames and browser metrics.

Native OS-window resizing was not automated because the app deliberately lacks
`core:window:allow-set-size`; its capabilities were preserved. Browser resizing
was verified. macOS/WebKit, a 120Hz display, high-resolution footage, larger
private recordings, installer packaging, and the Rust suites were not run for
this frontend change. No perfectly locked 60 FPS or 120 FPS claim is made.
