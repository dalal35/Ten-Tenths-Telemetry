# Initial design-system specification

## Intent and concept

**Follow the tenth.** The distinctive object is a comparison between two laps, not a row of dashboard totals. A selected point connects the aligned channels, GPS position and corner evidence. The interface should make the engineer's next question obvious: where was time lost, and what do the measured channels show there?

These are disposable visual explorations explicitly requested for this phase. They are separate from production state and calculations. Coordinator choices: reuse React, Motion, existing font assets and safe demo generators; use small SVG traces for inspectable prototype graphics; keep production uPlot and state ownership during migration. No native behavior is being redesigned here.

## Three coherent directions

| System | A — Race Control | B — Precision Lab | C — Hypercar Digital Cockpit |
|---|---|---|---|
| Composition | Session explorer / wide channels / contextual inspector | Notebook navigation / inset white sheet / right-hand lap index | Instruments / central track / timing tower; peer channels below |
| Type | IBM Plex Sans, IBM Plex Mono figures | Manrope, tabular figures | Barlow Condensed instruments and timing, Plex labels |
| Ground / surface | `#141618` / `#101214` | `#e9eceb` / `#ffffff` | `#101112` / `#121415` |
| Text / supporting text | `#e6ebee` / `#a1aab2` | `#24322d` / `#52615a` | `#eaece9` / `#adb4b0` |
| Primary / reference trace | `#75c7e9` / `#e3c49c` | `#24705e` / `#77877f` | `#e5b879` / `#b7c3cd` |
| Surface treatment | Compact panel boundaries, 4px radii | One 10px inset sheet, quiet dividers | Broad continuous field, instrument zones |
| Motion emphasis | Shared workspace selection, corner focus | Quiet selection movement, command disclosure | User-selected timing emphasis, spatial track review |

UI UX Pro Max was installed and run for each direction; complete candidate output is saved in `research/`. It suggested useful data-density, contrast and interaction guidance but also unrelated marketing patterns, luxury serif type and Liquid Glass. Those recommendations were checked against the brief and rejected where unsuitable. Targeted style/chart queries supplement the broad engine output. The taste skill's data-terminal, framed-sheet and true-black sheets informed structure; subject-specific type, data colors and cockpit instruments deliberately override generic sheet defaults.

## Recommended production foundation

### Typography

- IBM Plex Sans: body and controls 13px / 1.45, section labels 13px / 500, page title 24–27px / 500. Supporting metadata and axes may use 11–12px, never smaller.
- IBM Plex Mono: lap times, delta and aligned numerical columns, 13px in rows and 24–28px in summaries. Explicit tabular numerals after any CSS `font` shorthand.
- Barlow Condensed: optional 32–64px speed/time instruments inside an explicit track-focus view. This is a subject-specific instrument exception, not a reason to enlarge ordinary KPI summaries.
- All fonts load locally. Manrope and Barlow licenses are bundled beside the prototype font files. Reuse existing Plex licensing. No remote font request is needed at runtime.

### Color and surfaces

Use A's charcoal surfaces and established cyan selected lap / warm amber reference relationship as the default. Keep those identities stable on charts, map, lap rows and video overlays. Use signed text and dashed reference strokes as redundant encodings; color alone never explains a gain/loss. The prototype directions intentionally explore alternative hues; production must settle on one mapping.

Elevation comes from lightness and boundaries: canvas `#141618`, recessed analysis `#101214`, panel `#191c1f`, selected neutral `#232a2f`, separators `#2b3034`. Menus/dialogs may cast shadows; resting analysis panels do not. Radii: 4px controls/panels, 8px floating surfaces. No blur, glass, ornamental gradients, neon or continuous ambient animation.

### Spacing, layout and navigation

Use 4/8/12/16/24/32px steps. Standard controls 32–36px, compact row actions at least 24px with keyboard access. A's explorer is approximately 220px and inspector 280–320px; channels take remaining width with a zero-minimum grid column. Primary workspace tabs remain stationary. Local actions belong to the selected object or panel.

At narrow desktop sizes, turn the explorer into an explicit session/lap control and keep reference selection reachable. At the real 600 × 500 minimum, use one principal analysis column with vertical scrolling and a reachable reset action. Never compress numeric axes by scaling the entire chart SVG. Native DPI and user text scaling need separate acceptance before these measurements become final.

### Charts, GPS and numerical truth

- Preserve production uPlot for large recordings. Prototype SVG uses only 601 samples; it is not a proposed replacement renderer or native performance benchmark.
- Use straight 1.5–2px selected traces, thinner dashed reference traces, faint horizontal grids, units on every chart, and stable domains for a comparison. Ticks, cursor ordinate and path must share one scale definition.
- A positive delta means time lost against the explicitly named reference. Zero, unavailable and negative values have different honest text states. Comparing a lap with itself says it is the reference.
- One immediate cursor connects GPS, charts and the position slider. Corner focus scopes both charts and slider, with a visible reset. Show uncertainty and gaps from existing backend responses in production; never smooth them away.
- The schematic GPS map is explicitly illustrative here. A production map must render the existing measured spatial data and alignment diagnostics. Do not repurpose this generated track as real geography.
- Map controls need accessible names and keyboard alternatives. Cursor decoration must not intercept corner clicks. Provide selected-sample textual values and retain table-based section evidence.

### Icons and interaction foundations

Use the existing outline workspace icon language, 16–18px with a consistent stroke. No new icon library is needed for the prototype. shadcn's NativeSelect wrapper/option structure was retrieved and adapted with native select semantics and local styling. Native `dialog` handles focus trapping and Escape in the command prototype. Production may retain existing reviewed menus/surfaces rather than installing a new kit throughout.

21st sidebar/command examples informed the search, but their implementation source was account-gated; no unverified source is claimed as adopted. React Bits CountUp's narrow Motion `animate`/cleanup pattern was adapted for user-selected summary timing only, with the full upstream notice preserved. No independent React Bits component bundle or animation dependency was added.

### Motion and performance

Reuse existing Motion and `src/motion.tsx` concepts: 140ms feedback, 180–220ms surface disclosure, spring stiffness 520 / damping 42 for selection continuity. Exit should finish faster than entry. Numeric summary interpolation in this study is 280ms, cancellable, and disabled under reduced motion; evaluate removing it from precision-critical production readouts.

Cursor, plots, playback synchronization and sampled values remain immediate. Never animate thousands of chart points, re-run inference on navigation, remount video on a tab swap, or capture large canvases for decorative transitions. Respect `prefers-reduced-motion` in JS as well as CSS. No perpetual effects run in an idle analysis workspace. Actual CPU/GPU/frame-time budgets must be measured on native target machines in the next phase.

### Loading, empty and error language

| State | Treatment |
|---|---|
| No session | Keep the workspace frame; one clear Import recording action and supported-file guidance |
| Missing/changed source | Preserve current Locate/Refresh distinctions; describe the affected recording locally |
| Analysis loading | Keep existing evidence visible when safe; local progress with cancellation for expensive work |
| No video | Explain attachment choices before exposing full synchronization controls |
| Missing channel / unit | Grey dash and reason; preserve existing warnings, units and unsupported-data fallbacks |
| Inference unavailable | Measured evidence remains useful; preserve model terms, cancellation and computed fallback |
| Command search empty | Specific no-match text with an example and an Escape route |

The static comparison prototypes do not invent import or inference jobs. Their other workspace destinations disclose the scope of the preview. Production error and loading flows require owner-specific design and integration tests in their migration phases.
