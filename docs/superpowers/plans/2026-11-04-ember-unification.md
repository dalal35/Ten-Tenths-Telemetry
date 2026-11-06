# Ember UI Unification Implementation Plan

**Goal:** Extend the approved Telemetry visual system across the desktop application, preserving behavior and media lifetime.

**Architecture:** Keep the existing shared React shell and retained workspace tree. Promote Telemetry's shared tokens, shell and explorer rules to shared owners; retain workspace composition in its existing CSS. Reuse glass materials and semantic geometry rather than introducing wrappers or effects.

**Tech stack:** React 19, TypeScript, Vite 6, existing uPlot/media, Playwright and axe.

**Spec:** User's Project Ember Complete UI Unification brief (2026-11-04), summarized in `docs/ember/UNIFICATION_REPORT.md`.

## Constraints

- Continue from clean `ember/visual-motion` HEAD `30ce7e6`.
- Preserve approved Telemetry, data, navigation, persistence and retained chart/video tree.
- No Rust, calculations, synchronization algorithms, marketing site, dependencies or new animations.
- Baseline before production changes; private diagnostics and screenshots remain ignored.
- Local focused commits only; no merge, push, deploy or release.

## Review focus

- Both themes and top-layer dialog tokens must match the app.
- 600×500 must preserve reachable controls through intentional scrolling.
- Shared shell bounds must remain within 1px across workspace switches.
- Larger readable text must not obscure analytical evidence or video transport.
- Hidden retained workspaces must not affect selectors or media/chart identity.

## Tasks

- [x] A: Capture baseline for 0361/0362, six surfaces, both themes and sizes. Record shell/panel/control styles, axe and layout issues in an audit matrix.
- [x] B: Promote approved root tokens, header/explorer styles and responsive variants. Remove conflicting view-specific shared-header overrides. Keep one shell and unchanged component keys. Verify computed geometry and identity.
- [x] C: Refine Advanced plots/setup, Video transport/inspector, Coach evidence, Library dialogs and onboarding with existing primitives and readable type. Render and inspect after each pass.
- [x] D: Run final matrix, navigation timing/lifetime checks, axe and overflow checks; inspect screenshots and fix material defects. Run TypeScript, production build, frontend tests and affected browser suites.
- [x] E: Write concise report with pass/fail/unverified evidence, limitations, screenshots and test results. Review the whole diff and commit in focused stages.

## Progress / decisions

- Initial audit: one shared header exists; divergent Telemetry-only CSS is the root cause. Existing `VideoWorkspace`/Advanced retention and keys will remain intact.
- Baseline harness is being extended before production changes. Browser IPC uses cached real diagnostics, not native Tauri validation.
- Applicable frontend skill: use existing-brand app-screen inspection; preserve approved glass/palette, and follow the user's explicit no-new-motion requirement.

- Completed: measured shared geometry 0px; 48 workspace plus 21 contextual/receipt final captures. Final scope, figure/code typography, attachment reachability and test corrections verified; see report for contrast/native coverage limits.
