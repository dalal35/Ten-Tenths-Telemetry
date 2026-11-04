# Ember visual refinement — execution notes

Scope: execute Pass 0, A, B from 72786c8; stop for visual review. No Rust, website, video lifecycle, motion implementation, push, merge or release.

## Plan and ownership
- Pass 0: tools/ember reusable actual-0361 simulated IPC fixture; freeze full before matrix, measure geometry/fonts/contrast/rendering, commit baseline. Production UI untouched.
- Pass A: extend src/design-system.css semantic elevations, text, brand, trace/delta roles, typography floors and shared primitives; update Plots.tsx theme in place and remove theme key in App.tsx; capture only 1440 dark/light; commit foundation.
- Pass B: telemetry-local shell/plots/inspector composition; adaptive bounded plot heights, readable comparison and numerical hierarchy; same full fixture matrix plus axe, contrast, CVD, identity/render/interaction checks; focused tests + TypeScript/build; commit and stop.

Design: carbon instrument surfaces, vermilion for action/selection, blue primary and amber dashed reference, teal ahead and magenta behind. Existing IBM Plex Sans UI and IBM Plex Mono numerical fonts (bundled OFL licenses). Preserve current three-column desktop layout; short/narrow layouts scroll.

## Pass 0 (in progress)
- Clean primary checkout at requested starting commit; created ember/visual-motion there. Other exploration worktree preserved.
- Disk: approximately 43.5 GiB free before work. Generated image budget <200 MB.
- Existing private .tools parsed 0361 JSON reused, never committed. All browser IPC is simulated; data values are real parsed telemetry. No Rust rebuild.
- Baseline production files remain unchanged until screenshots and measurements are frozen.

## Verification limitations
Browser simulated IPC does not establish native Tauri, WebView2, codec, dialog, DPI or filesystem behavior. Native inspection depends on an existing binary; do not rebuild Rust for it.

### Pass 0 result
All 14 before PNGs are frozen in docs/ember/screenshots/before/ (never recreate). Manifest and measurements in tools/ember/. Canonical utilization denominator: .workspace-viewport (central scrollable analysis area); main.main ratio is also reported to expose geometry.

| Telemetry viewport | Chart utilization | Plot panel height |
| --- | --- | --- |
| 1440×900 dark/light | 90.0% | 188px |
| 1920×1080 dark/light | 72.3% | 188px |
| 600×500 dark/light | 80.9% visible; scrolling | 188px |

Baseline: UI/legend 12px; canvas axes 12px system font. No document horizontal overflow. Cursor keyboard pair: 2 development React commits / 2 Plots updates, canvases retained. Theme switch replaces canvases (existing theme key). Approximate DevTools fiber update counts are available, not React Profiler timings. Axe: dark 3 prohibited aria attributes + 13 label/name mismatches; light additionally 4 contrast nodes. Shared fixture and capture/contrast syntax checks passed; helper black/white contrast 21:1.

Remaining baseline weaknesses (5): crowded 900px chart stack; understated timing hierarchy; tiny shell/legend key labels; low-contrast light-mode elements; theme-triggered chart remount.

Focused baseline frontend checks: 72 tests passed across workspace, navigation, motion, session explorer, telemetry. Vitest configLoader runner avoids sandbox ancestor-directory access errors. No production UI changes in Pass 0.

## Pass A — foundation
Baseline commit: 8a09193. Added authoritative Ember elevations, text/control/action roles, independent lap and ahead/behind/delta trace roles, aliases for existing callers, spacing/radii/elevation and existing timing tokens. Reused bundled OFL IBM Plex Sans/Mono; no added font/dependency in production. Shared labels now ≥11px. Canvas axes explicitly 11px IBM Plex Mono; custom chart readouts remain 12px.

Only foundation and theme behavior changed: removed theme React key; canvas palette snapshots refresh with root theme mutation and redraw existing charts. Pass A screenshots: docs/ember/screenshots/after/pass-a/telemetry-1440x900-{dark,light}.png. Layout untouched (188px rows). Two cursor keys still 2 commits / 2 Plots updates; theme change now retains canvases. WCAG helper: all resolved text/surface pairs ≥4.5 and meaningful trace/control pairs ≥3 in both themes; axe light contrast failures eliminated. Production build (tsc -b + Vite) passed; existing >500kB chunk advisory remains.

Remaining weaknesses (5): crowded 900px stack; timing hierarchy; wider mono axes need more gutter (RPM digits clipped); existing 13 accessible-name mismatches; narrow composition needs final visual/overflow verification. Those screen-specific changes belong to Pass B.
