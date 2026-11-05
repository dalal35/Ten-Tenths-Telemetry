# Ember reference matching implementation plan

**Goal:** Match the supplied 1672×941 Telemetry reference while retaining real recording semantics and all workspace controls.

**Architecture:** Continue `ember/visual-motion` from `47a1eb0`; preserve Pass B.1. Add a desktop-only, Telemetry-scoped composition stylesheet after the existing shell. Retain React state owners, uPlot instances, IPC, backend and video behavior. The user's supplied implementation brief and image are the specification; no independent art direction is required.

**Tech stack:** Existing React 19, TypeScript, Vite 6, uPlot and Tauri 2. Locally bundled Geist; no additional production dependencies.

## Constraints and decisions

- No Rust, native configuration, marketing site or cinematic-motion changes.
- Use data-derived values; existing cached real 0361 diagnostics with simulated IPC for captures.
- CSS in-app glass: directional highlights, layered translucent graphite, focused-control blur with opaque/forced-color/reduced-transparency fallbacks. Charts remain unfiltered.
- Preserve compact access to chart settings, alignment details, section editing, warnings, sidebar resizing and comparison clearing.
- Honor the supplied reference over generic design-skill defaults. Keep native OS window decorations.

## Tasks

- [x] Record starting UI using existing real-data fixture; inspect component and CSS owners.
- [x] Match chrome/sidebar, title/timing header, chart card and right instruments. Scope changes to Telemetry and preserve other workspace presentation.
- [x] Capture and inspect at 1672×941, 1440×900, 1920×1080 and 600×500, in both themes. Refine after the first rendered pass. Create local side-by-side comparison.
- [x] Run unit checks, TypeScript/production build and focused browser checks; verify canvas identity, theme/cursor/zoom/section/channel controls, accessibility and effect fallbacks.
- [x] Review final diff, record measured results and remaining discrepancies, commit on the existing branch.

## Review focus

- Narrow-window control reachability and scroll containment.
- Hidden auxiliary controls remain accessible by keyboard.
- Cursor/theme/resize retain uPlot instances and data units.
- Glass must not blur canvases or obscure text and traces.
- Browser tests simulate IPC; native WebView2/macOS material rendering remains a separate platform limitation.
