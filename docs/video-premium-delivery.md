# Phase 6 — Video workspace

Implemented on `feature/video-workspace-premium`, branched directly from `b4ec5b1`.

## Experience

- Cinema canvas with source identity, playback state, custom transport, ±5-second
  stepping, rates, and optional native volume/fullscreen controls.
- Analysis and focus layouts share the same mounted media element. Escape exits
  focus. K/Space and arrow shortcuts are scoped to the workspace and defer to
  editable fields, buttons, sliders and resize handles.
- Synchronized speed, RPM, elapsed lap percentage, track position and comparison
  delta use measured analysis and existing interpolation/projection helpers.
  Speed uses the app's display conversion. Unknown channels, gaps, stale analysis,
  pending/failed synchronization and missing comparison delta remain unavailable.
- Time ruler, mapped segment lane, playhead and predicted lap crossings. Accessible
  range seeking and crossing buttons retain the existing controller semantics.
- Alignment inspector includes manual anchors, cuts, coverage, corrections and a
  signed telemetry-minus-video offset. Attachment and managed-cache operations,
  identity confirmations, cancellation and save barriers retain their behavior.
- Dark/light themes, reduced motion, narrow stacking, short-window chrome and
  pointer/keyboard video height adjustment. Context feedback remains visible in focus.
- Motion handles the shared layout selector and replacement confirmation entrance.
  Media is never transformed or keyed by presentation state. React playback chrome
  is sampled at up to 12.5 Hz; controller and adapter delivery are unchanged.

No Rust, decoder, mapping calculation, persistence schema, dependency, Library or
website changes. Automatic synchronization remains isolated and absent from the UI.

## Validation — 2026-11-04

- `npm test -- --configLoader runner`: **32 files, 339 tests passed**.
- `npm run test:video`: both browser suites passed. Simulated IPC and media clock
  cover attachment/replacement/Locate, downloads/cache/leases, source restoration,
  anchors, cuts, correction, coverage/ambiguity, seeking, resizing, readiness/errors,
  sticky playback, graph/GPS sync, pending seeks, navigation and merged recordings.
- `npm run build -- --configLoader runner`: TypeScript and production Vite build
  passed. Vite reports its large JavaScript chunk warning (~686 kB before gzip).
- Production `verify-video-premium.mjs` passed for **0361 and 0362** diagnostics,
  desktop **1600×1100** and compact **600×500**, both themes and reduced motion.
  It checks genuine media play/pause/seek, retained node and position, overlay/native
  controls, scoped keyboard input, saved resize state and visible focus-mode errors.
- Playwright MCP inspected the actual App at both sizes: no document horizontal
  overflow; decoded media readyState 4; real 0361 speed/RPM/position readings.
- `git diff --check` passed. C: had approximately **53 GB free** before builds.

The runner loader avoids the default Vite/esbuild config bundler's Windows sandbox
directory-access failure. Existing integration assertions were updated to current
Track output, plot values and the Advanced interactive canvas introduced in earlier
UI phases; their behavioral assertions remain in place.

## Evidence and reproduction

Local screenshots are under ignored `.tools/video-ui/`:

- `before-desktop.png`, `before-compact.png`, `before-light.png`
- `final-0361-desktop.png`, `final-0361-studio.png`, `final-0361-focus.png`
- `final-0361-compact.png`, `final-0361-compact-controls.png`, `final-0361-light.png`
- Equivalent `final-0362-*` captures

Cached private telemetry stays ignored. To reproduce after generating local
`coach_check` diagnostics and running the frontend build:

```powershell
$env:VIDEO_UI_DATA='.tools/coach-ui/0361.json'
$env:VIDEO_PRODUCTION='1'
$env:VIDEO_SCREENSHOT_PREFIX='.tools/video-ui/final-0361'
node scripts/verify-video-premium.mjs
```

Set `VIDEO_PRODUCTION=0` and `VIDEO_INSPECT=1` for a development inspection server
and local `.tools/video-ui/inspect.html`. Do not publish this private fixture page.

## Limits

The 0361/0362 XRKs and cached diagnostics are real. No corresponding onboard video
was available. Genuine Chromium media checks use the checked-in **128×64, 60-second
H.264 codec fixture**, served with byte ranges. The red/blue imagery in screenshots
is this fixture, not racing footage. IPC, file dialogs, workspace storage and the
deliberate error event are simulated. This is not native Tauri/WebView2 acceptance.

Not run: Rust rebuild/tests, installer, native file dialogs, real managed download,
WebView2/Media Foundation playback, audio/codec matrix, high-resolution onboard
performance, DPI/UNC paths or macOS acceptance. Existing native behavior is preserved
by leaving the adapters/backend intact; those platform checks remain required.

## Design references

Retained the production Race Control/Hypercar tokens and shell. Consulted installed
UI UX Pro Max and app-screen guidance, shadcn's resizable example, Motion's
[accessibility](https://motion.dev/docs/react-accessibility) and
[shared layout](https://motion.dev/docs/react-layout-group) guidance, and
[React Bits](https://reactbits.dev/get-started/index). No 21st MCP was available.
No component library or visual-effect dependency was added.
