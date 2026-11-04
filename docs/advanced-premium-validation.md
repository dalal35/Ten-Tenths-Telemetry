# Advanced premium workspace verification

Phase 4 continues `6333995` on `feature/advanced-telemetry-premium`.

## Delivered

The real application has an analysis studio with six keyboard-navigable tools, a collapsible channel/filter/calibration/axis setup panel, searchable native channel selectors, primary/comparison legends, aligned statistics, wide-screen traction readouts, denser event rows with expandable original evidence, a formula editor and searchable sensor bank, and accessible plot controls. Existing presets, units, formulas, exclusions and persistence remain in their original owners.

Motion animates the selected tool and short control surfaces; charts have no entrance/layout animation. Numerical results now survive changes to height, grid, logarithmic scales and manual display ranges. The cursor renders on a separate bitmap; the tested synchronized cursor path performs zero base-cloud clears. ResizeObserver ignores unchanged dimensions. Theme changes explicitly repaint both layers.

No production backend calculations, video synchronization, coaching, library or website files changed. The website demo shares the Advanced component and therefore inherits its presentation; its landing page was not redesigned. No dependencies added. shadcn command/resizable patterns were researched through its MCP; the existing controls were adapted to avoid a second interaction stack. Motion accessibility documentation was retrieved through Context7.

## Evidence

- `npm test`: **30 files, 328 tests passed**.
- `npm run build`: TypeScript and production Vite build passed. Existing large-bundle advisory remains; main JavaScript is approximately 660 kB uncompressed.
- `node scripts/verify-advanced-premium.mjs` with `ADVANCED_PRODUCTION=1`: passed separately for **0361 and 0362**, calling the original production parser, analysis and formula evaluator through a local telemetry-only diagnostic. Actual built application assets, simulated Tauri transport.
- Production acceptance covers all five computed tools, both selected laps and reference changes, formula validation/save/reload, preset reload, keyboard sample inspection and cursor sync, keyboard zoom/pan/reset, stable canvas identity across setup/workspace/viewport changes, no recomputation for grid/scales/ranges/height/viewport, preferred-height persistence, and no horizontal document overflow at **1440×920, 1024×768, 600×500**. Dark, light and reduced-motion captures were inspected.
- `ADVANCED_FIXTURE_JSON=<local 0361 diagnostic JSON> node scripts/verify-advanced.mjs`: passed. Existing full regression covers inverse mph filters/ranges/bin widths, histogram controls, event inspection/exclusions, formula invalid/save/edit/duplicate/delete, presets/defaults/reload, synchronized cursors, delayed operations and session/unmount isolation, unsupported and empty data. This suite uses saved real outputs plus simulated boundary conditions.
- Focused state/layout/integration/motion checks: **23 passed**. `git diff --check` and browser-runner syntax check passed.
- Source review identified explicit palette invalidation and original-App small-window prerequisites; both were repaired and verified.

Screenshots remain local and ignored under `.tools/advanced-ui/final/`. The complete production run produced ten screenshots per recording: five tools, math editor, three viewport sizes and light theme. Selected captures copied into this checkout include `0361-traction-workbench.png`, `0362-scatter-workbench.png`, `0361-formulas-desktop-top.png`, `0361-histogram-workbench.png`, `0362-light.png`, `events-final.png`, `compact-final.png`.

## Visual review

Direction: preserve the supplied Race Control + Hypercar system; no random direction draw or stock photography. The live object is a real two-lap sensor comparison.

ROUND 1
Seen in one second: a telemetry plot surrounded by too much equally weighted chrome.
Idea (one sentence): put the engineer's selected analysis at the center of the working surface.
Live thing: traction, scatter, distribution and event analysis from original recordings.
Layout words by section: tools=strip / setup=rail / plot=canvas / support=readouts.
Scores: design 7.2 · usability 7.4 · creativity 7.2 · content 8.5 → overall 7.4.
Caps applied: none; application conventions apply.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. The outside inspector squeezed the working plot (first-desktop); move it below Advanced.
2. Statistics were a difficult-to-scan paragraph (first-desktop); use labeled values and stacked lap readouts.
3. At 600×500, fixed chrome consumed working height (compact-review); condense the Advanced-specific shell and start setup closed on small windows.

ROUND 2
Seen in one second: primary and comparison samples in a dedicated engineering canvas.
Idea (one sentence): pair the shared plot with independently readable lap evidence.
Live thing: synchronized sample inspection and channel-specific analysis.
Layout words by section: tools=strip / setup=rail / traction=canvas+readouts / math=editor+bank.
Scores: design 8.0 · usability 8.1 · creativity 7.8 · content 8.7 → overall 8.1.
Caps applied: none.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Event evidence made each table row overly tall (shifts-workbench); retain the full evidence behind a row disclosure.
2. The canvas axes named units without naming sensors (traction-refined); add actual channel names.
3. Collapsing support notes hid the traction orientation qualification (traction-refined); keep a short qualification visible above the plot.

ROUND 3
Seen in one second: paired measured data, channel controls and evidence belong to the same workspace.
Idea (one sentence): a custom motorsport analysis workbench with disciplined visual hierarchy and immediate chart interaction.
Live thing: real 0361/0362 plots, formulas, filters and synchronized cursors.
Layout words by section: tools=strip / setup=rail / traction=canvas+readouts / events=timing sheet / math=editor+bank.
Scores: design 8.3 · usability 8.4 · creativity 8.0 · content 8.8 → overall 8.3 (internal visual assessment, not an external benchmark).
Caps applied: none.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Small windows still need workspace scrolling (compact-final); deliberate local scrolling preserves a useful 240px canvas.
2. Wide event tables require local horizontal scrolling (events-final); keep every original measurement available.
3. Dense labels follow the inherited system (production desktop/light); retain the supplied direction rather than redesign unrelated shell typography.

Taste app lint: **0 FAIL, 5 WARN**, all warning sites use the established Plex data/code face. Production inspector: **0 FAIL, 4 WARN** at widths 1440/1024/600 after explicit `edge-text,tiny-text` allowances. Unallowed results were 2 FAIL: inherited 15px sidebar text margins and dense labels under 11px. These are documented design-system exceptions, not undisclosed fixes. Remaining warnings concern the existing brand wordmark, uppercase brand subtitle, the three established UI/data/display faces and content below the fold. Advanced is an intentionally scrolling engineering workspace. Every final inspector image was opened; focused Playwright images also cover content inside the nested workspace scroller.

## Repeat locally

Use private recordings in ignored `data/`. Set `ADVANCED_BACKEND_EXE` to the diagnostic, `ADVANCED_PRODUCTION=1`, optionally `ADVANCED_XRK` and `ADVANCED_OUTPUT_DIR`, then run `node scripts/verify-advanced-premium.mjs` after `npm run build`. `ADVANCED_SERVE=1` keeps a local inspection server open; `?advanced=1` opens Advanced in a fresh test context.

If no diagnostic exists, explicitly set `ADVANCED_PREPARE=1` and `ADVANCED_TARGET_DIR` to a directory with sufficient free space. The tracked `scripts/diagnostics/advanced-inspect.rs` imports original production modules; the runner creates an ignored standalone crate with debug symbols/incremental compilation disabled. It does not build Tauri. Preparation is never implicit. Existing diagnostics were reused for final runs.

## Limits and skipped checks

Native Tauri/WebView2 execution, native dialogs, installer, full Rust suites, macOS and physical DPI were not run. Transport/persistence acceptance uses browser IPC simulation and localStorage, while calculations use original production Rust functions. No timing benchmark or universal frame-rate claim is made. The diagnostic was built once on a secondary volume; an initial attempt on C: ran out of disk. Its target was removed and no compiler process remained, but C: still had roughly 50 MB free at final checking; no unrelated files were deleted. Avoid further native builds until disk capacity is addressed. Website build/tests were not run because its files were outside scope; shared-component inheritance is noted above.
