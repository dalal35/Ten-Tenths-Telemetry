# Premium UI validation

Completed 2026-11-03 on `integration/ttt-premium-ui`. Reference: approved exploration `1cfbc33`; production base: `d6451bb`.

## Implemented

- Local Plex and Barlow font roles, charcoal/cyan/amber tokens, light theme, control/surface/focus/loading/error foundations and reduced motion.
- Stationary workspace navigation, responsive lap/reference selectors, persistent session explorer with keyboard/pointer width control, and compact comparison context.
- Production uPlot channels with solid primary/dashed reference traces, separate readouts, signed delta/zero reference, synchronized keyboard cursor, retained zoom/pan and active-view identities.
- Measured GPS, speed/delta instruments, section-linked position slider, numbered section index and selected speed/channel evidence. GPS breaks, unavailable values and timing/boundary uncertainty stay explicit.
- Immediate workspace state commits with Motion selection continuity. Canvas/video snapshots and whole-viewport fades were removed.

The desktop entry explicitly opts into the premium shell. The website demo keeps its existing navigation placement; shared component markup has compatibility styling. No website or Rust/backend files, dependencies, lockfiles, telemetry calculations or automatic-video-sync code changed.

## Passed checks

| Check | Evidence |
| --- | --- |
| `npm test` | 29 files, 326 tests passed, including speed conversion, GPS/channel gaps, missing values and true zero delta. |
| `npm run build` | TypeScript project checks and Vite production build passed. |
| `npm run test:sidebar` | 100-recording organization; keyboard/drawer behavior; 600×500 through 2560×1440 resizing; plot/canvas/player identities; retained lap/channel/zoom/tab selections and manual video mappings. Native IPC/media clock simulated. |
| `npm run test:workflow` | Per-recording workspace switching, queued saves, reload, source refresh, safe library removal, merges and bounded sample retention passed. |
| `node scripts/verify-premium-ui.mjs` | Real 0361 and 0362 recordings parsed/analyzed by existing production Rust modules. Actual App rendered at 1440×920, 1024×768 and 600×500. GPS, cursor/readouts, lap/reference/axis changes, section range, reduced motion, mounted plot retention and internal overflow checks passed. Separate synthetic chart fixture verifies positive/negative/zero/unavailable delta. |
| Existing plot regression assertions | Passed with the already-built local diagnostic substituted for the script's Cargo extraction command, avoiding a Rust rebuild. Covered synchronized zoom/pan/reset/cursor, invalid restored ranges, delta-only/partial-channel zoom, track focus, boundary drag/keyboard and density zoom retention. The temporary runner stays ignored. |
| Explorer handle | Playwright keyboard check: 236 → 244 → 236 px; width saved locally; same uPlot element; analysis request count remained 1. |
| Patch review | `git diff --check` passed. |

The real-data harness simulates the IPC transport only. Its Rust diagnostic imports the unchanged production telemetry/spatial/merging modules and pinned libxrk. The browser status bar reads “Native” because the harness supplies Tauri IPC; this is **not** native WebView2 acceptance. No XRK, parsed samples or private screenshots are committed or uploaded.

The script accepts `PREMIUM_INSPECT_EXE` to reuse an existing diagnostic and `PREMIUM_OUTPUT_DIR` for local artifacts. `PREMIUM_PREPARE=1` is an optional initial diagnostic build, not needed for these final checks. `PREMIUM_BASELINE=1` renders the tracked source at HEAD for like-for-like before captures; after the implementation commit, use a checkout of the production base to reproduce those before captures.

## Rendered review and fixes

Reviewed actual telemetry in Playwright at desktop and minimum window dimensions, including the lower inspector after scrolling. Fixed the inspector/grid width conflict, compact section rows, narrow drawer positioning and the sticky video header blocking Sync Here in short workspaces. The outer app/shell now use clipping so focus/scroll-into-view moves only the workspace and cannot hide the stationary session controls. The harness asserts that regression.

Section details are intentionally disclosed on selection; workflow assertions now select the row before checking its mph values. Existing plot assertions distinguish the new position readout/slider from the harness cursor output and editable boundary handles.

Before/after captures use the same actual 0361 recording and lap pair. Local deliverables are in ignored `.tools/premium-ui/`: `before-desktop-cursor.png`, `after-desktop-cursor.png`, `after-compact.png`, and `0362-desktop.png`. At 600×500, charts and the inspector require vertical workspace scrolling; lap selection, workspace navigation and reset remain reachable.

UI UX Pro Max's focused keyboard, contrast, line-style and reduced-motion guidance was used during implementation; no new competing design was generated.

## Limits and skipped checks

- Native WebView2, real file dialogs/codecs and native manual video playback were not accepted. Earlier full native compilation exhausted disk/memory and was stopped. Final validation reused the small diagnostic and performed no full Rust rebuild, as requested.
- No installer, release, push, merge, macOS checks or broad backend suite. Auto-video-sync remains isolated.
- No marketing-site build/redesign/publication in this pass.
- Vite reports the existing large-chunk class of warning (about 651 kB uncompressed application JavaScript); build succeeds. Native performance/DPI acceptance remains outstanding.
- 21st source retrieval still requires a privately configured `API_KEY_21ST` and a Codex restart. No authenticated 21st component source was adopted.
