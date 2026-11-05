# Project Ember — Global Liquid Glass material pass

Continues `2b760e8` on `ember/visual-motion`. This is a desktop material pass only. The approved Telemetry layout, text density, typography, data rendering/colors, navigation, state owners, video lifecycle, backend and website are preserved. No Pass C animation, runtime package installation, native rebuild, merge, push or release.

## Material architecture

`src/glass-materials.css` owns five reusable tiers, with shared fills, borders, directional inset lighting, elevations and fallbacks. Existing component selectors map onto the same primitives; Telemetry's former local glass values now use the shared aliases.

| Tier | Role | Rendering budget |
| --- | --- | --- |
| `glass-base` | Stable graphite ground | Static tonal field, no filter |
| `glass-panel` | Explorer, Telemetry, Advanced, Coach, Video panels | Translucent fill, edges and soft shadow; no backdrop sampling |
| `glass-raised` | Instrument sheets, toolbars, evidence, sync controls | Brighter directional edge and elevation; no large blur |
| `glass-floating` | Menus, popovers, dialogs, import receipts | Readable high-opacity fill; bounded 14px diffusion where supported |
| `glass-interactive` | Selected controls, active rows, leaf buttons | Directional highlights and pressed/hover states; selected leaf controls use 9px diffusion |

A single stateless `GlassDefinitions` SVG supplies a fixed 3px edge-displacement field. Only active workspace, axis and video-view controls use it on capable Chromium engines. Foreground glyphs/icons are never filtered. There are no pointer-driven material updates, extra animation loops, WebGL contexts, chart sample observers or per-control canvases. Chart/video ancestors and editable text stay unfiltered; data surfaces are sufficiently opaque. Existing semantic selection rails and vermilion/cyan/amber/violet colors remain intact. Existing corner radii outside Telemetry are unified where appropriate with Ember's established radius tokens; panel rectangles and typography do not change.

`materialCapabilities.ts` selects refracted, diffused or static materials. WebKit/Firefox keep diffused CSS materials because parsing SVG filter syntax does not establish displacement support. Unsupported blur and devices reporting four or fewer logical cores use static materials. Reduced transparency and forced colors explicitly remove blur/refraction with precedence over all effect rules. Existing resize gestures temporarily suspend leaf sampling without new event listeners. CSS remains desktop-entry-only, including portal-safe dialog rules.

## Implementations evaluated

| Option | Evidence / cost | Decision |
| --- | --- | --- |
| `liquid-glass-react` 1.1.1 | MIT; 180,339 unpacked bytes; React/ReactDOM >=19 peers; no runtime dependencies. Registry publication/modified timestamps are June 11, 2025. README documents missing displacement on Safari/Firefox; current active maintenance was not established. | No installation; its displacement support cannot cover macOS WebKit and its shader mode adds map-generation work. |
| `@specy/liquid-glass-react` 1.0.2 | MIT; 6,831,498 unpacked bytes; React >=18 peers. Upstream describes Three.js/WebGL, DOM/background capture and synchronization. | Rejected for this telemetry rendering budget. Unpacked package sizes are not gzipped bundle costs. |
| Native vibrancy / Mica / Acrylic / Liquid Glass | Current Tauri window is opaque. Windows Mica is Windows 11; Acrylic Windows 10/11; Tauri Liquid Glass variants require macOS 26, above this app's macOS 13 floor. Whole-window effects require platform/configuration work and do not replace component materials. | Keep existing native window/decorations. Do not enable a window-wide effect during a material-only frontend pass. |
| Shared CSS + static SVG | No runtime dependency. Existing CSP permits the inline SVG's `data:` edge-map images. | Selected: one maintainable CSS owner with a small Chromium-only refraction enhancement and consistent static/diffused fallback. |

Sources: [package registry](https://registry.npmjs.org/liquid-glass-react/latest), [publication timestamps](https://registry.npmjs.org/liquid-glass-react), [rdev README](https://github.com/rdev/liquid-glass-react), [Specy registry](https://registry.npmjs.org/@specy/liquid-glass-react/latest), [Specy architecture](https://github.com/specy/liquid-glass), [Tauri window effects](https://docs.rs/tauri/latest/tauri/window/enum.Effect.html), [Tauri configuration](https://v2.tauri.app/reference/config/), [CSS backdrop filters](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter). Context7 resolved the relevant library IDs before querying their documentation. No upstream code/assets were copied.

## Visual and accessibility evidence

Sixteen baseline/final cases use cached native 0361/coach diagnostics and simulated IPC: Telemetry, Advanced, Coach, Video, library details and onboarding at 1440×900 in both themes, plus Telemetry at 1672×941 and 600×500. Baseline sources are served from `2b760e8` in memory, without resetting the checkout. Matching panel/plot rectangles stay within 1 CSS pixel; no horizontal document overflow or page errors. Menus/popovers also have inspected local captures. Generated images/reports are ignored; recordings and raw diagnostic data are never committed.

| Local screenshots | Dark | Light |
| --- | --- | --- |
| Telemetry, reference dimensions | [1672×941](docs/ember/screenshots/glass/final-telemetry-1672x941-dark.png) | [1672×941](docs/ember/screenshots/glass/final-telemetry-1672x941-light.png) |
| Advanced | [1440×900](docs/ember/screenshots/glass/final-advanced-1440x900-dark.png) | [1440×900](docs/ember/screenshots/glass/final-advanced-1440x900-light.png) |
| AI Coach | [1440×900](docs/ember/screenshots/glass/final-coach-1440x900-dark.png) | [1440×900](docs/ember/screenshots/glass/final-coach-1440x900-light.png) |
| Video | [1440×900](docs/ember/screenshots/glass/final-video-1440x900-dark.png) | [1440×900](docs/ember/screenshots/glass/final-video-1440x900-light.png) |
| Library details | [1440×900](docs/ember/screenshots/glass/final-library-1440x900-dark.png) | [1440×900](docs/ember/screenshots/glass/final-library-1440x900-light.png) |
| Onboarding | [1440×900](docs/ember/screenshots/glass/final-onboarding-1440x900-dark.png) | [1440×900](docs/ember/screenshots/glass/final-onboarding-1440x900-light.png) |

[Approved/new Telemetry side-by-side](docs/ember/screenshots/glass/telemetry-comparison-1672x941-dark.png). Responsive captures and menu images are in the same folder. Baseline/final images plus diagnostics total approximately 12 MiB.

No new axe A/AA violations. Telemetry, library, onboarding and checked menus have zero. A pre-existing Video shortcut contrast failure was fixed by restoring full-opacity secondary text. Pre-existing accessible-name mismatches remain: three each in Advanced/Coach; Video has two transport-label mismatches and one scrollable-region focusability issue. These were present before the material pass and are recorded per view/theme. Sampled Telemetry text/trace contrast minima: dark 7.48:1, light 6.51:1. Compositing calculations do not model directional gradients/backdrop sampling; axe cannot inspect canvas content.

The real active workspace control over a test-only checkerboard changes 71 of 4,588 pixels between refracted/diffused states; with blur/background disabled only for diagnosis, 29 pixels still differ. This verifies actual SVG displacement rather than only CSS parser support. Reduced-transparency and forced-color media queries both resolve to `backdrop-filter: none`. Protected canvases/media and their ancestors remain filter-free.

## Performance, tests and limits

One instrumented development Chromium comparison used 60 identical pointer moves at 1440×900. Baseline/final mean frame intervals: 31.8 / 30.8 ms; script time: 1208 / 1037 ms. Both had 60 React commits, 60 Plots updates and retained canvas identity. No regression was observed in this controlled run. Automation and development instrumentation affect these numbers; they are not native GPU/video timings or a 60 fps guarantee.

- 353 frontend tests passed across 34 files, including five capability/fallback policy checks; TypeScript and production build passed. Existing Vite large-chunk advisory remains.
- Glass harness: all 16 cases, menu/keyboard/Escape focus, theme/navigation/resize, geometry, contrast/effect checks and SVG pixel proof passed. Reports: `.tools/ember-glass/{baseline,final,performance}.json`.
- Existing video integration passed: retained player, manual synchronization/seeks, source/cut/coverage reconciliation and semantic persistence, with simulated source readiness/clock.
- Focused workflow and sidebar suites passed, covering persisted state, compact menus, resize/canvas/player stability across 600×500–2560×1440.
- Native Windows smoke check passed: the existing debug executable loaded the current Vite frontend and restored real telemetry through native IPC. Its initial dark view showed clear material surfaces, controls and telemetry traces. No navigation or settings were changed, and the started app/server were closed. This visual check does not establish native SVG engagement, codecs or GPU performance; macOS WebKit rendering remains untested. SVG refraction intentionally falls back on WebKit/Firefox and low-core devices.

Reproduce with `node tools/ember/glass.mjs --baseline`, `node tools/ember/glass.mjs --final`, and `node tools/ember/glass.mjs --performance`. No additional artifact/dependency installation is required beyond the existing Ember verification tooling. Stop after this material pass.

---

# Project Ember — Pass B.1 checkpoint

Branch: `ember/visual-motion`, from `72786c8c9708c9bcb84ccfbe66001e606418bdd6`. Pass 0: `8a09193`; Pass A: `d5b3d7a`; Pass B: `da64955`; Pass B.1: this commit (`ember: refine typography simplicity and depth`). Stop here. No Pass C/D, Rust, website, video lifecycle, calculation, push, merge or release work.

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

## Pass B.1 — typography, simplicity and depth
Started at clean `da64955` with ~43.4 GiB free. Reused the existing 0361 fixture, frozen images and pixelmatch tooling. Three capture rounds maximum were used; the final correction changed accessibility descriptions only. A subsequent tooltip hover-gap correction changes only revealed help, not resting screenshots. No baseline images were recreated. All six final Telemetry captures and six diagnostic diffs are local at `docs/ember/screenshots/after/pass-b1/telemetry-{1440x900,1920x1080,600x500}-{dark,light}{,-diff}.png` and remain ignored.

Geist variable Latin WOFF2 (29,400 bytes) replaces Plex Sans for desktop UI; bundled Plex Mono remains for timing and instruments, reusing its existing 10,052-byte Latin asset. One additional family, local OFL licenses, swap loading and fallbacks; provenance in `public/fonts/README.md`. Canvas axes resolve the new font through the existing theme path and redraw after fonts settle without remounting. Body is 13px, legends/readouts ≥12px, secondary labels/axes ≥11px; changing figures are tabular. Sentence case replaces UI uppercase labels while recording identities and channel names are preserved.

Radii: panels 18px, controls 10px, floating menus/dialogs 20px, pill indicators. Base/raised/focused tokens supply tonal lift and edge highlights, restrained dark shadows and soft light shadows. Depth is reserved for selected laps, key readouts and controls; the unified plot stack has no floating shadow and its rectangular canvases/axes remain unclipped.

### Measured copy audit
At 1440×900 in both themes: **149 → 135 visible text owners (−9.4%)**. The fixed repeated/supporting-copy subset fell **25 → 3 (−88%)**. The total is below the aspirational 30–50% reduction: reclaimed sidebar space exposes another lap's essential values, and useful values/units were retained. Count direct-text owners once, clipped against the viewport and scrolling ancestors, excluding visually hidden content, closed menus and canvas ticks. Counts, generic examples and exact selectors are in `tools/ember/pass-b1-{before-,}measurements.json`. Additional pre-edit region boxes were measured using `git show da64955` through Vite without touching disk sources or recapturing images; the original 149 count matched independently.

| Before | B.1 treatment |
| --- | --- |
| Fastest lap repeated in sidebar, heading and selection | Selection marks fastest; separate fastest readout remains when needed |
| Primary/reference text on every channel | One stack legend; solid/dashed swatches and accessible names stay |
| Drag/pan/GPS captions and map hint | Focus/hover help; arrow/Shift/Enter controls and delta meaning included |
| Active recording driver/count metadata repeated | Main identity retains details; source suffixes remain on every recording; accessible descriptions retain detail |
| Lap table headings, section indices and processing metadata | Clear timing rows, named sections and concise status; warnings remain visible |

### Geometry and verification
Both themes have identical geometry. Sidebar/plot/inspector x positions and widths match Pass B exactly; desktop plot/inspector top moves +9px. Inspector content is shorter after duplicate guidance removal. At 600×500, the inspector moves up 33.3px through removed guidance, with vertical scrolling retained. Essential timings have no ellipsis; long source names keep suffixes and full-path focus/hover help with Escape dismissal.

| Viewport | Pass B → B.1 utilization | Plot panel / canvas B.1 | Panel height change |
| --- | --- | --- | --- |
| 1440×900 | 73.8% → 74.9% | 147 / 120px | 0% |
| 1920×1080 | 72.0% → 72.0% | 184.5 / 157.5px | −1.16% |
| 600×500 | scrolling; ratio not targeted | 147 / 120px | 0% |

Loaded Geist and actual uPlot canvas families are checked separately from font floors. Text contrast minima remain dark 6.06:1 / light 5.30:1; tested controls/focus/traces ≥4.49:1 / ≥4.09:1. Axe, tooltip focus/hover/Escape, zoom/pan/reset, narrow menu/control access and theme redraw checks are recorded in `tools/ember/pass-b1-verification.json`. Two cursor keys retain 2 React development commits / 2 Plots updates, matching Pass B. Sidebar regression passed at 600×500–2560×1440 with chart/canvas/video identities and saved mappings intact; workflow regression passed in isolation. 100 focused tests (10 files), final sidebar tests, TypeScript and production build passed. Vite retains its existing >500kB chunk advisory. Vite's runner config loader avoids sandbox package-root scanning for unit/build commands; browser suites needing dependency optimization ran with approved filesystem access.

Final verification evidence is in the dedicated B.1 JSON; previous Pass 0/A/B evidence remains unchanged. CVD recapture was skipped because trace/delta colors did not change. No native/Rust rebuild or native media/DPI acceptance was attempted.

## Remaining visual issues and limits
1. 900px-tall composition uses fewer vertical speed/RPM ticks to preserve readable 120px canvases.
2. 600×500 needs vertical scrolling between channels and GPS/section evidence.
3. Long recording source names retain suffixes, with full paths available on keyboard focus or hover.
4. Total visible text reduction is 9.4%, below the aspirational range, while repeated supporting copy is substantially reduced.

Native Tauri/WebView2, codecs, dialogs, filesystem behavior and physical DPI were not verified. An existing debug binary was found, but no matching native acceptance session was run; no Rust rebuild was triggered. Browser IPC/media simulation is not native verification. Cross-workspace baseline images are evidence only; Pass D composition and Pass C motion remain deferred.
