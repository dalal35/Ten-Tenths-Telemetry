# Validation and visual review

## Executed checks

| Check | Result | Boundary |
|---|---|---|
| `npx tsc -p prototypes/premium-ui/tsconfig.json` | Passed | Isolated prototype types plus imported sample-data contracts |
| `npx vite build --config prototypes/premium-ui/vite.config.ts` | Passed | 444 transformed modules; JS approximately 406.65 kB / 130.67 kB gzip, before platform packaging |
| `node prototypes/premium-ui/scripts/verify.mjs` | Passed on the production bundle | 3 directions × 3 sizes, 12 captures, zero browser errors |
| `node prototypes/premium-ui/scripts/capture-baseline.mjs` | Passed | 8 actual-component screenshots using synthetic IPC, no real media/inference |
| shadcn MCP initialization/search/view | Passed | Real public registry results; official raw source retrieved separately |
| Playwright MCP navigation/screenshots | Passed for all three | Real server calls; configured Edge browser also launched successfully |
| 21st MCP initialization | Authentication blocked | Endpoint returned JSON-RPC -32001, no key present; no source lookup success claimed |
| Personal Codex config comparison | Passed | All original non-MCP settings, model/agent definitions and existing MCP entries preserved semantically |
| Production-bundle taste inspector at 1440/1024/600 widths | A: 0 failures / 1 warning; B: 0 / 1; C: 0 / 2 | Warnings are dense 11–12px text; C also flags instrument numbers with separate smaller unit typography |

The focused verifier builds and serves the prototype bundle, exercises selected/reference laps, same-lap zero handling, corner keyboard focus, constrained position range, linked cursor, command no-results/Escape, preserved state through navigation, reduced-motion numeric consistency and horizontal overflow. Desktop is 1440 × 920, medium 1024 × 768, compact 600 × 500. Exact viewport metadata is in [validation.json](validation.json). Inspectors use their own default 900px/768px heights; their width passes supplement, rather than replace, the exact-window screenshot checks.

An earlier development-server run failed its strict console check on Vite HMR's WebSocket connection and port-0 fallback. The verifier was changed to test the built bundle, removing the unrelated dev client. It then completed with zero page/console errors. No error was filtered to manufacture a pass.

## Look-and-fix record

Baseline and final screenshots were opened and inspected. The first pass showed shrinking SVG axis text, excessive right-column height and tiny summary typography. Charts now measure their real pixel dimensions, keep stable axis text and share scale definitions with their traces. A now fits its primary comparison frame at the normal desktop window, with a bounded scrollable corner index. B and C prioritize the analysis and instruments while secondary status content can require a small vertical scroll. At the 500px minimum height, analysis content necessarily continues below the fold; no horizontal overflow was observed.

A second review fixed low-contrast light-theme metadata, window-edge text, zero-delta copy and local pin semantics that conflicted with the global cursor. Corner focus now scopes the slider as well as the traces. SVG controls use a group with named keyboard buttons; cursor decoration cannot intercept their clicks. Reduced-motion JS reads the current device preference before starting numeric interpolation, including preference changes during a session.

The final inspector reports no hard failures on the production bundle. Its remaining density warnings are real: the studies use 11–12px metadata and dense rows. Critical lap figures were enlarged and tabular numerals restored after font shorthands. Readability at Windows scaling and long-session fatigue remain user/native validation questions, especially for Precision Lab's compact index. C's larger instrument and smaller unit face are deliberate automotive typography; they do not encode two conflicting numerical values.

## Final visual critique (app-screen rubric)

The page-only photography/marketing-hero criteria do not apply to these working app screens. Scores are candid coordinator judgments after rendering, not external awards, user acceptance or a performance benchmark.

### A — Race Control, round 3

Seen in one second: overlaid telemetry beside a lap explorer.

Idea: trace the lost tenth from a lap into a corner without leaving comparison context.

Live thing: linked lap/reference, chart and GPS selection.

Layout words: shell=explorer / analysis=stacked channels / context=track and corner index.

Scores: design 8 · usability 8 · creativity 7 · content 8 → overall 7.8.

Caps applied: app-screen scope; dense supporting labels remain a stated usability limitation.

Top problems: supporting metadata is still small in `race-desktop.png`; a larger text/density preference needs production exploration. The bounded corner list requires scrolling to turns 5–6, while all map corners remain available. The inherited synthetic circuit shape limits the emotional impression compared with a real recognizable circuit. No substitute geography is claimed.

### B — Precision Lab, round 3

Seen in one second: a calm white analysis sheet with a notebook index.

Idea: treat each comparison as an annotated engineering observation.

Live thing: lap and corner selection update the same evidence sheet.

Layout words: shell=notebook / overview=reading and map / analysis=sheet with marginal index.

Scores: design 8 · usability 8 · creativity 7 · content 8 → overall 7.8.

Caps applied: app-screen scope; small index text and extra framing remain tradeoffs.

Top problems: brand/motorsport character is quieter in `lab-desktop.png`; its compact lap table favors density. The notebook framing uses more vertical space at small windows, improved by dropping the redundant breadcrumb row in `lab-compact.png`. It is a strong light-mode study, with less distinctive first impression than C.

### C — Hypercar, round 3

Seen in one second: a speed instrument and a circuit on a continuous black field.

Idea: place the driver inside the comparison, with the selected track point as the center of the instrument panel.

Live thing: a point on the circuit drives the instruments and peer-channel readouts.

Layout words: shell=wide cockpit / instruments=triptych / evidence=corner strip and peer charts.

Scores: design 8 · usability 7 · creativity 8 · content 8 → overall 7.7.

Caps applied: app-screen scope; the 82px speed figure is an explicit instrument exception.

Top problems: the channels in `cockpit-desktop.png` are narrower than A, reducing sustained comparison utility. At 600 × 500, the instrument/track take the first view and the charts require scrolling. Native controls for selected/reference laps were made available at the top in `cockpit-compact.png`. The instrument personality is strongest when used selectively rather than throughout every production screen.

These studies meet the runnable exploration brief; an extraordinary shipping interface still needs real-driver feedback and native iteration. A's structural usefulness is the reason for the recommendation, not a claim that a compilation or automated meter establishes premium quality.

## Skipped checks and material limits

No broad repository unit/release suite was run: production source and contracts are unchanged, and this phase intentionally used focused prototype checks. No native Rust build, macOS WebKit, Windows WebView2, real XRK import, native playback/codec, local inference, installer, screen-reader audit or native performance benchmark was performed. Browser screenshots do not establish those properties. No marketing website migration or publishing was attempted. 21st source retrieval awaits private authentication.
