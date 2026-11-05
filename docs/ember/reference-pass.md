# Ember Telemetry reference pass

Continues `ember/visual-motion` from `47a1eb0`, preserving Pass B.1, the existing state owners, uPlot, IPC, video and backend. The desktop-only stylesheet follows the supplied reference; controls absent from the sketch live in keyboard-accessible chart and track disclosures. Data warnings retain a visible indicator and severity. Long channel stacks and the right inspector scroll within the desktop viewport.

## Verification

- 348 unit tests passed across 33 files.
- Final `tsc -b` and `npm run build` passed. Vite retains its large-chunk advisory.
- Focused workflow and sidebar Playwright suites passed: session switching, save/reload, boundary editing, axis/density restoration, library actions, resizing and mounted canvas/player identity.
- Final reference harness passed eight captures: dark/light at 1672×941, 1440×900, 1920×1080 and 600×500, using cached native 0361 diagnostics with simulated IPC.
- Channel selection, synchronized cursor, zoom/pan/reset, section selection, compact controls, Escape/focus return, warning disclosure, touch discoverability, theme switching and narrow drawer/channel-menu reachability passed.
- Zero axe WCAG A/AA violations in the checked 1440 layouts. Sampled text/trace contrast ratios were at least 7.48:1 dark and 6.51:1 light. Color calculations composite background colors; they do not model directional gradients or backdrop sampling.
- Canvas identity survived cursor/theme checks. No canvas filters; forced-color and reduced-transparency control fallbacks passed. The final instrumented development-browser run measured mean frame intervals of 31.6 ms dark and 27.0 ms light during 60 automated pointer moves. These include automation/instrumentation overhead and are not a native GPU benchmark or evidence of 60 fps.

## Materials

Layered CSS graphite surfaces, restrained directional highlights and shadows provide depth. Small selected controls and menus progressively use `backdrop-filter`; charts and video remain unfiltered. Unsupported browsers use the base material, and reduced transparency/forced colors remove blur. No production dependency was added.

Native window effects require a transparent, platform-tested window and would affect the entire application. They are outside this frontend pass. Mica is a wallpaper-tinted base rather than a live lens; current Liquid Glass effects have a newer macOS floor. The evaluated React displacement library lacks its main displacement effect on Safari/WebKit.

References: [Tauri configuration](https://v2.tauri.app/reference/config/), [window effects](https://docs.rs/tauri/latest/tauri/window/enum.Effect.html), [Microsoft Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica), [Liquid Glass React](https://github.com/rdev/liquid-glass-react), [CSS backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter).

## Local review artifacts and limits

Run `node tools/ember/reference.mjs --reference <reference-image>` to reproduce. Final screenshots and the side-by-side comparison are ignored under `docs/ember/screenshots/reference/`; measurements are ignored under `.tools/ember-reference/report.json`.

The reference-sized implementation matches the main panel positions within a few pixels. Windows uses existing branding/native window conventions. Geist glyphs, material highlights and real measured traces/metadata differ from the supplied sketch. Smaller windows use scrolling rather than shrinking plots into unreadability. Native WebView2/macOS rendering, OS window effects and native performance were not tested. No Rust rebuild, merge or push was performed.
