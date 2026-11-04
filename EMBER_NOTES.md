# Project Ember — Pass 0/A/B checkpoint

Branch: `ember/visual-motion`, from `72786c8c9708c9bcb84ccfbe66001e606418bdd6`. Pass 0: `8a09193`; Pass A: `d5b3d7a`; Pass B: this commit (`ember: refine telemetry composition and charts`). Stop for review here. No Pass C/D, Rust, website, video lifecycle, calculation, push, merge or release work.

## Execution and artifacts
Reused the clean primary checkout; preserved the separate exploration worktree. Started with ~43.5 GiB free. Local generated screenshots/diffs total ~3.6 MiB, below 200 MB. No generated PNG/video/trace is committed.

Pass 0 changed only test tooling, ignore rules and these notes. Fourteen baseline PNGs were captured and frozen before any production changes. Real parsed 0361 diagnostic caches supply lap 9/10, GPS speed/RPM, spatial delta, distance 30–350 m and keyboard-set cursor 158 m. All IPC is explicitly simulated; unsupported analysis combinations reject. Fixtures remain private/ignored. No recording values were fabricated.

- Before: `docs/ember/screenshots/before/` (14 PNGs, full requested workspace matrix; Library is its existing session-details dialog).
- Pass A: `docs/ember/screenshots/after/pass-a/` (only 1440×900 dark/light).
- Pass B: `docs/ember/screenshots/after/` (six matching Telemetry PNGs, two CVD captures, six diagnostic pixel diffs).
- Reproduction, frozen manifest, measurements and checks: `tools/ember/README.md`, `before-manifest.json`, `{before,pass-a,after}-measurements.json`, `verification.json`.

All captures: DPR 1, exact viewport, fonts/data/charts settled, reduced motion, animations disabled and caret hidden. Before images were never recreated.

## What changed
Pass A centralized Ember elevations 0–4, text, dividers/control borders, vermilion action states, independent primary/reference and ahead/behind/delta colors, spacing/radii/elevation and existing timing tokens. Reused local IBM Plex Sans/Mono, verified SIL OFL 1.1 notices. No production dependency or additional font. Removed theme chart key; resolved canvas palette redraws in place.

Pass B preserves the three desktop columns, strengthens lap timing/selection hierarchy, adds explicit Primary/Reference and Ahead/Behind labels, solid/dashed traces, restrained grids, wider numerical axes, readable GPS corner numbers and a bounded short-window channel menu. Container-driven sizes use ResizeObserver/setSize, without React sizing state. The review-found stationary cursor-dot theme issue is fixed through a guarded post-redraw cursor refresh with hooks suppressed. Independent review has no remaining important findings.

## Measurements (both themes)
Canonical ratio is summed visible plot-row height / `.workspace-viewport` height (central scrollable analysis area, below recording/lap chrome). `mainWorkspace` ratios are also retained in JSON, not substituted for this denominator.

| Viewport | Before → after utilization | After plot panel / canvas |
| --- | --- | --- |
| 1440×900 | 90.0% → 73.8% | 147 / 120 px |
| 1920×1080 | 72.3% → 72.0% | 186.6 / 159.6 px |
| 600×500 | ratio not targeted; vertical scrolling | 147 / 120 px |

No document horizontal overflow. At 600×500, 17 representative controls are reachable, all canvases are 120px high, and the last channel is focusable within the scrolling menu. Body text is ≥12px; secondary labels and canvas axes ≥11px; chart legends/readouts ≥12px, tabular numerical figures.

Text-tier/surface contrast minima: dark 6.06:1, light 5.30:1. Tested essential control/focus/meaningful trace pairs: dark ≥4.49:1, light ≥4.09:1. Axe cannot inspect canvas: resolved colors and actual canvas paints were checked independently, including both theme directions. Axe has zero violations in dark/light at desktop and 600×500. Keyboard graph focus is visible. CDP protanopia/deuteranopia captures retain labels, signs and solid/dashed identification. Pixel differences are diagnostic only; inspected screenshots show no unintended clipping.

## Stability and tests
Two cursor keys: baseline and after both 2 development React commits / 2 Plots updates. These are approximate DevTools fiber counts, not Profiler timing or a complete performance profile. uPlot canvases retain identity through cursor/zoom/pan/reset/theme; actual axis, solid/dashed trace and stationary cursor-dot colors update correctly. Broader explorer suite retains chart/canvas/player identities during resizing and checks saved lap/channel/zoom/video mappings.

- 132 focused frontend tests passed (10 files).
- Explorer browser regression passed, 600×500–2560×1440 (simulated IPC/media).
- Workflow browser regression passed in isolation. One earlier concurrent run failed a timing-sensitive boundary assertion; starting-source control and updated-source isolated reruns passed.
- Final Ember axe/contrast/CVD/interaction/narrow checks passed; TypeScript and production build passed. Existing >500kB Vite chunk advisory remains.
- Contrast helper black/white self-check: 21:1. Script syntax and `git diff --check` passed.

## Remaining visual issues and limits
1. 900px-tall composition uses fewer vertical speed/RPM ticks to preserve readable 120px canvases.
2. 600×500 needs vertical scrolling between channels and GPS/section evidence.
3. Long recording source names remain ellipsized with full-path hover information.

Native Tauri/WebView2, codecs, dialogs, filesystem behavior and physical DPI were not verified. An existing debug binary was found, but no matching native acceptance session was run; no Rust rebuild was triggered. Browser IPC/media simulation is not native verification. Cross-workspace baseline images are evidence only; Pass D composition and Pass C motion remain deferred.
