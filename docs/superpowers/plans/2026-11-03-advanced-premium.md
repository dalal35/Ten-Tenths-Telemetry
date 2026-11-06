# Advanced telemetry premium workspace

## Design and implementation plan

Continue 6333995 in the existing React/Motion/uPlot application. The screen answers: how do these laps differ in sensor behavior and measured events? Keep the Race Control neutral graphite surfaces, Plex typography, cyan primary and sand comparison data. Give the plot priority: compact six-tool navigation, a collapsible setup rail with channels/filters/axes, a plot header with honest support counts, aligned lap statistics, and synchronized telemetry beneath. Formula authoring gets an editor and searchable channel bank. Preserve all six tools and their controls, math validation, source labels, units, presets/defaults, exclusions, data notes, persistence and read-only recovery.

Alternatives considered: a cosmetic restyle would leave the current control sprawl; a third-party dashboard/panel stack would add dependencies and risk existing persistence. Reorganize the existing owners and adapt researched command/resizer interaction patterns. No dependencies, backend, video, coach, library or website changes.

- [x] Separate computation inputs from presentation preferences so resizing, grid and axis view edits preserve results and zoom. Pin with focused tests.
- [x] Recompose Advanced.tsx and advanced.css; add accessible tool navigation, searchable channel selection, structured statistics, setup disclosure and Motion feedback. Keep chart state outside animated surfaces.
- [x] Polish AnalysisCanvas: stable inspection callback, keyboard zoom/pan/inspection, canvas typography and controls. Preserve equal-G scales and original math.
- [x] Validate real 0361/0362 production outputs using a local telemetry-only diagnostic and actual premium App browser adapter; inspect desktop/1024/600×500, reduced motion/light theme, formulas/events/presets/persistence.
- [x] Run unit tests and production TypeScript/Vite build, inspect final screenshots, review the diff, document limits and commit. No push/merge, no full Rust rebuild.

Review focus: computation must not restart on presentation edits; tool changes retain their own ranges; readonly controls do not edit saved state; both comparison and primary retain correct identities and units; small windows scroll locally without page overflow. Existing native tests remain relevant but no full native build is required for UI changes.

Evidence and documented visual exceptions: `docs/advanced-premium-validation.md`. Final review repaired theme invalidation and nonpremium small-window prerequisites. No numerical backend changes.
