# Ember workspace unification

Completed 2026-11-05 on `ember/visual-motion`, starting at `30ce7e6`; implementation commit `e91c7bf`. Telemetry remains the reference. No new motion, Rust/calculation/sync changes, dependencies, media replacement, marketing-page redesign, push or release.

## Before / after audit

| Severity | Surface / root cause | Final correction and result |
| --- | --- | --- |
| High | Telemetry-only CSS changed shared header height, branding width, tabs and import treatment | Approved header and responsive rules promoted to shared shell; maximum measured variation **0px**. |
| High | Reference palette/type lived on a workspace ancestor; other views and portals inherited older roles | Approved dark/light root tokens, consistent text aliases and portal-safe materials. Shared token comparisons pass. |
| High | Explorer refinement and row geometry depended on workspace | Stable premium explorer, selected rows and accessible source details across navigation. |
| Medium | Advanced had technical display typography, square controls, tiny labels and conflicting narrow tab grids | Shared glass controls/plots, three-column narrow tabs, readable labels, tabular figures and code face for expressions. Premium styling isolated from generic/demo CSS. |
| Medium | Video had small transport/instrument labels, redundant kicker and inconsistent control geometry | Shared studio/transport/inspector materials and type; removed decorative kicker, fitted GPS figures, prevented attachment button stretching to 99px. Media and sync handlers unchanged. |
| Medium | Coach had independent record-heading overrides and inconsistent evidence styling | Shared recording heading, raised padded overview and readable evidence/UI figures. Deliberately retained its omission of the redundant lap-summary row. |
| Medium | Library/onboarding/overlays had tiny metadata, mixed radii and oversized technical display type | Shared floating/input geometry, readable metadata and compact onboarding title keeping import visible. |
| High | Axe found visible-name mismatches and unfocusable coverage | Advanced names include visible labels; Coach names derive from visible evidence; Video step names include visible text; coverage is focusable; receipt name includes “Open recording”. |

## Quantified acceptance

| Requirement | Result | Evidence and limit |
| --- | --- | --- |
| Shared shell geometry, target ≤1px | **PASS: 0px** | Eight recording/theme/size groups; titlebar, brand, nav container, actions, import, sidebar and recording heading compared. |
| Shared styling | **PASS, sampled** | Identical computed shell-control type, padding, radii, colors, shadows and height; same semantic token values across four views per theme. |
| Horizontal document/body overflow | **PASS: 0/48** | Six surfaces, two recordings, two themes, two sizes. Intentional internal scrolling remains. |
| Critical clipping/occlusion | **PASS for selected controls: 0/198** | 24 focused cases scroll controls into view and test viewport containment/center occlusion. Exhaustive text/transient-state overlap is **unverified**. |
| Typography | **PASS for sampled 11px floor; body classification partial** | Positive-size visible text below 11px: **316 → 0 occurrences** across matrix. Body token 12px, secondary 11px; not every node is classified automatically. One deliberately hidden zero-size Video label excluded. |
| Normal text contrast ≥4.5:1 | **UNVERIFIED in full** | Ancestor-color estimates: minimum **5.94 dark / 4.92 light**. All sampled pairs are gradient/backdrop affected; axe color-contrast incomplete cases need manual review. |
| Essential non-text contrast ≥3:1 | **PARTIAL** | Primary/reference/delta tokens against opaque plot fill: **10.03/9.39/7.48 dark**, **6.51/6.85/7.05 light**. Shell SVG estimates ≥8.15/7.45. Full canvas/focus/selection pixel contrast unverified. |
| Accessibility | **PASS: zero serious/critical across 69 capture states** | 48 matrix, 18 menus/settings, 3 receipts; no rules disabled. Moderate/minor findings below. |
| Theme consistency | **PASS in sampled states** | Shared root roles/computed values agree per theme. Native/system-theme handling unverified. |
| Chart/video remounts | **PASS in browser** | Same three original chart canvases and decoded MP4 element across four views, themes and resize roundtrip; paused **7.000s** retained. |
| Functional regressions | **PASS in relevant suites** | Tests below; native behavior unverified. |
| New hardcoded colors/radii/shadows outside semantic declarations | **0 new distinct values** | Set comparison against starting HEAD, excluding token references. Existing literal occurrences and legacy generic styles remain. |

## Shell and composition measurements

1440×900 dark, CSS pixels; both recordings and light theme share the geometry:

| Region | Before Telemetry | Before Advanced / Video / Coach | After all four |
| --- | --- | --- | --- |
| Titlebar height | 60 | 64 | **60** |
| Brand x / width | 24 / 260 | 20 / 210 | **24 / 260** |
| Nav container x / height | 308 / 59 | 250 / 63 | **308 / 59** |
| Recording heading x / y / height | 254 / 82 / 91 | 264 / 89 / 79.125 (Coach 63) | **254 / 82 / 91** |
| Sidebar x / y / width / height | 0 / 60 / 236 / 840 | 0 / 64 / 236 / 808 | **0 / 60 / 236 / 840** |

At 600×500 all four have a **52px titlebar**, brand x=8/width=28, nav x=42/height=51, sidebar y=52/width=40 and recording heading x=52/y=66/height=82. Onboarding uses the same chrome without session tabs; Library retains the underlying shell.

Internal composition deliberately differs. Telemetry's approved 1440 dark chart panel `(254,279,829.28,581.83)`, toolbar `(270,296,797.28,59)` and inspector `(1099.28,159,328.72,705)` are unchanged. Advanced/Video content starts at y=279; Coach starts at y=173 because its lap-summary row remains hidden. Raw results record all heading, summary, toolbar and panel bounds. Long workspaces intentionally scroll.

24 repeated switches in development Chromium: **median 167ms, p95 317ms**, including Playwright overhead and two animation frames. Buffered observation recorded **22 long tasks ≥50ms, max 183ms**, including startup tasks; this is not an isolated navigation-only or native smoothness claim.

The attached-media check decodes the bundled synthetic 128×64, 60s MP4 alongside real telemetry. Node/source/paused position survive switching/themes/resizing. Playback advances, pauses when leaving Video and retains its position on return, matching existing behavior. Native authorization and real camera codecs are not established.

## Verification

| Check | Result |
| --- | --- |
| Implementation unit suite | **353/353 passed**, 34 files |
| Final focused import/Coach tests | **7/7 passed**, 2 files |
| TypeScript and final production build | **Passed**; existing >500kB chunk advisory remains |
| Branding, sidebar, workflow | **Passed** |
| Canvas | **Passed**: hover/click, zoom/reset, circular G scaling and DPR 100/125/150/200%. Verifier now excludes overlay clears and requires repaint when dimensions change. |
| Video and integration | **Passed**, simulated IPC/media boundaries |
| Premium Library | **Passed** against final production build: import, unavailable target, restoration, dialogs, responsive behavior |
| Advanced, cached 0361 | **Passed**: tools, cursor, filters, events, formulas, presets and isolation |
| Premium Coach, cached 0361 | **Passed**: ranking, evidence, selection, navigation, retained state and responsive screenshots; tests visible accessible title rather than removed mismatching attribute |
| Unification matrix / menus / receipt / lifetime / layout | **Passed within stated coverage** |
| Source review / whitespace | Read-only review identified CSS scope, numeric/code font and test-instrumentation issues; corrected. `git diff --check` passed. |

No Rust rebuilds, native app acceptance, installer/release checks, website build or unrelated test expansion. Marketing files unchanged; generic Advanced/Video styling retained separately from premium overrides.

## Screenshot evidence

Private diagnostics and generated images remain ignored. Both real 0361/0362 caches drive simulated IPC at DPR 1 with fixed laps/channels/zoom/cursor, settled fonts and reduced motion. Before images were frozen before edits; receipt baseline was reconstructed from `30ce7e6` through an in-memory Vite transform. Only affected Advanced/Video cases were refreshed after final corrections.

Representative 0361 images below; equivalent 0362 and both narrow themes use the same filename scheme:

| Surface | Before dark 1440 | After dark 1440 | After light 1440 | After 600×500 |
| --- | --- | --- | --- | --- |
| Telemetry | [image](screenshots/unification/before/0361-telemetry-1440x900-dark.png) | [image](screenshots/unification/after/0361-telemetry-1440x900-dark.png) | [image](screenshots/unification/after/0361-telemetry-1440x900-light.png) | [image](screenshots/unification/after/0361-telemetry-600x500-light.png) |
| Advanced | [image](screenshots/unification/before/0361-advanced-1440x900-dark.png) | [image](screenshots/unification/after/0361-advanced-1440x900-dark.png) | [image](screenshots/unification/after/0361-advanced-1440x900-light.png) | [image](screenshots/unification/after/0361-advanced-600x500-light.png) |
| Video | [image](screenshots/unification/before/0361-video-1440x900-dark.png) | [image](screenshots/unification/after/0361-video-1440x900-dark.png) | [image](screenshots/unification/after/0361-video-1440x900-light.png) | [image](screenshots/unification/after/0361-video-600x500-light.png) |
| Coach | [image](screenshots/unification/before/0361-coach-1440x900-dark.png) | [image](screenshots/unification/after/0361-coach-1440x900-dark.png) | [image](screenshots/unification/after/0361-coach-1440x900-light.png) | [image](screenshots/unification/after/0361-coach-600x500-light.png) |
| Library details | [image](screenshots/unification/before/0361-library-1440x900-dark.png) | [image](screenshots/unification/after/0361-library-1440x900-dark.png) | [image](screenshots/unification/after/0361-library-1440x900-light.png) | [image](screenshots/unification/after/0361-library-600x500-light.png) |
| Onboarding | [image](screenshots/unification/before/0361-onboarding-1440x900-dark.png) | [image](screenshots/unification/after/0361-onboarding-1440x900-dark.png) | [image](screenshots/unification/after/0361-onboarding-1440x900-light.png) | [image](screenshots/unification/after/0361-onboarding-600x500-light.png) |

Additional images include channel/chart/track menus, explorer actions/organization, Coach settings, import receipt and `video-attached-synthetic-*`.
Raw local evidence: `.tools/ember-unification/{before,after,after-menus,after-receipt,interactions,layout}.json`, with computed styles, axe nodes/incomplete cases, coordinates and timing samples.

Reproduce from the repository root with existing private caches and dependencies:

```text
node tools/ember/unification.mjs after
node tools/ember/unification.mjs after --refresh=advanced,video
node tools/ember/unification-menus.mjs after
node tools/ember/unification-menus.mjs after --receipt-only
node tools/ember/unification-interactions.mjs
node tools/ember/unification-layout.mjs
```

Do not rerun `before` after edits. `--only=...` and `--quick` write previews and cannot count as complete acceptance.

## Remaining issues and limitations

1. **Medium verification gap:** Full rendered-pixel contrast over directional glass, canvas labels and all focus/selection states remains unverified. Estimates and axe do not certify WCAG compliance.
2. **Moderate existing axe landmark issue:** `region` on the explorer resizer remains in 20 matrix, 12 menu and 2 receipt capture occurrences. These are repeated states of the same control.
3. **Minor existing drawer semantics:** Two narrow contextual captures report `aria-allowed-role` for the explorer aside's dialog role. No serious/critical findings remain in captured states.
4. **Low coverage limit:** Selected critical controls pass reachability; exhaustive text overlap, every transient/error/dialog state, native window controls/DPI and real media codecs are unverified. Small windows intentionally scroll. No Tauri/WebView2/Rust/installer claim.
5. **Low performance limit:** Development timings include automation/instrumentation and buffered startup long tasks; native performance is unverified. No new motion implemented.
