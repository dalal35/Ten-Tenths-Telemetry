# Premium production UI — implementation record

Implements the user-approved Race Control structure with restrained Hypercar instrument typography from exploration commit `1cfbc33`. The exploration is a reference, not a branch to merge. Work lives on `integration/ttt-premium-ui`, based on clean `main` at `d6451bb`.

## Scope and invariants

Deliver production design tokens, the complete application shell and Telemetry comparison. Keep existing uPlot, measured GPS, analysis contracts, serialized workspace state, recording imports and manual video synchronization. Do not redesign Video, Advanced, Coach, Library workflows or the marketing site. No backend changes, automatic sync integration, publishing, push or merge.

## Implementation sequence

1. Review the handoff, runnable prototypes, research, before captures and existing owners/callers.
2. Add local typography, semantic tokens, controls, surfaces, focus/error/loading states and reduced-motion foundations.
3. Adapt the stationary workspace navigation, explorer, contextual heading and comparison strip. Preserve view identities and persisted preferences.
4. Restyle real uPlot channels, signed delta, readouts and accessible cursor interactions. Keep sample/gap/zoom synchronization behavior.
5. Refine measured GPS, linked instrument readouts, lap position control and compact section evidence with explicit selected details.
6. Inspect and iterate in Playwright at 1440×920, 1024×768 and 600×500. Use private 0361/0362 recordings through the existing Rust parser/analyzer, never synthetic production data.
7. Run focused unit/sidebar/workflow/plot checks and TypeScript/build. Attempt native WebView2 where provisioning allows. Review the complete diff, document evidence and limitations, then commit locally.

## Review focus

- Narrow/short windows: controls, primary/reference lap selection and reset remain reachable without horizontal page overflow.
- Hidden views: navigation retains chart/video/canvas identities and selection/zoom without repeated analysis or decorative canvas capture.
- Gaps/unavailable data: no invented sample, unit, delta or GPS point; display honest missing states.
- Keyboard/reduced motion: visible focus, map/section selection and cursor alternatives; no continuous ambient animation.
- Local source/persistence: real source-qualified identities and existing Locate/Refresh/Remove/manual-video contracts remain untouched.

## Environment record

The first native diagnostic build exhausted an already nearly-full system drive. It was stopped, and only its verified new `src-tauri/target` output was removed. Large task-generated native validation files will use separate temporary scratch storage, without changing global machine configuration or committing private recordings.

21st source retrieval is unavailable without `API_KEY_21ST` in Codex's inherited environment. The existing public research, local tools and existing dependencies remain usable.

Verification results and rendered review findings will be recorded in `validation.md`.
