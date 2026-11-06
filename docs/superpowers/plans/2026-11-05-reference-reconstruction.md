# Reference reconstruction implementation plan

**Goal:** Reconstruct the four desktop workspaces from the supplied visual references while preserving real telemetry, analysis, coaching and manual video synchronization.

**Architecture:** Retain App as the persistent shell and workspace state owner. Refine existing components and semantic tokens instead of adding a separate UI or changing native contracts. Use the current checkout as explicitly requested; preserve the existing dirty video synchronization changes.

**Tech stack:** React 19, TypeScript, existing CSS materials, uPlot, Tauri.

**Specification:** User-supplied “Ten Tenths Telemetry: Complete UI Reconstruction From Visual References”, November 5, 2026. The four attached images are the visual authority; ignore Parsec/window-streaming artifacts.

## Constraints and design

- Graphite surfaces, restrained material depth, system typography, tabular figures, cyan primary, amber comparison, semantic delta colors.
- Persistent navigation and sidebars; identical session metadata and lap-summary geometry across views. No major navigation animations.
- All figures/traces/results remain connected to existing data. Preserve errors, empty states, accessibility, saved settings, playback, manual alignment, model terms and evidence.
- No new packages, backend changes, automatic video sync, releases or external uploads.
- Desktop targets: 1648×928, 1280×800, 1440×900, 1920×1080.

## Tasks

- [ ] Shared shell and Telemetry (coordinator): inspect App/workspace/motion owners; consolidate shell, sidebar, summary and control styling; retain telemetry information architecture. Add focused regression coverage if state/navigation behavior changes.
- [ ] Advanced (Terra): own Advanced.tsx, advanced.css and related presentation tests; three-column configuration/traction/statistics workspace, common mode selector and toolbar; preserve all analysis modes and calculations.
- [ ] Video (Terra): own VideoWorkspace.tsx, SegmentEditor.tsx and video presentation CSS/components only; dominant player, compact instruments/timeline, dedicated manual alignment; preserve dirty controller/useVideoSync edits and all lifecycle behavior.
- [ ] Coach (Terra): own coach presentation components/CSS/tests; summary plus ranked list, recommendation and speed evidence; preserve computation, inference and evidence contracts.
- [ ] Integration and verification (coordinator): review each diff, run unit tests/build and affected browser verification; inspect and capture all four views using existing fixture adapters, check navigation selection and smaller window layouts. Clearly distinguish synthetic browser proof from native runtime proof.

## Review focus

1. Tab navigation after manually choosing primary/reference laps retains both selections.
2. Missing analysis/video/coaching data shows honest empty/error states.
3. Advanced tools remain reachable with filters/configuration intact.
4. Saved video position never silently replaces the chosen lap on tab entry.
5. 1280px window controls and graphs remain reachable without whole-page horizontal overflow.

## Progress and verification

Initial audit: active checkout `ten-tenths-telemetry`, branch `ember/visual-motion`. Existing dirty files: video/controller.ts, video/useVideoSync.ts, video/controller.test.ts, workspace.test.ts, scripts/verify-video-integration.mjs. Preserve these changes.
