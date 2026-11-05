# Ember global materials implementation plan

**Goal:** Unify the desktop application's materials without changing approved composition, typography, data colors, motion or behavior.

**Architecture:** Continue from `2b760e8` on `ember/visual-motion`. Centralize five semantic material tiers in a desktop-entry stylesheet, map existing component surfaces to those tiers, and replace Telemetry's local material values with shared aliases. One static SVG filter enhances a small allowlist of foreground controls on compatible Chromium engines. Large panels, chart/video ancestors and editable text remain unfiltered.

**Specification:** User-provided “TTT Project Ember — Global Liquid Glass Material Overhaul”.

## Constraints

- Preserve layout, text density, typography, chart dimensions, trace colors, state and video lifecycle.
- No production dependency, native-window/backend change, website change or Pass C animation.
- Native materials evaluated against current opaque Tauri window; no native rebuild.
- WebKit/Firefox, low-core devices, reduced transparency and forced colors have static/diffused fallbacks.
- No pointer-driven filter updates, observers on chart samples or extra render loop.

## Work

- [x] Inspect existing surface owners; evaluate package/native/CSS compatibility and license/size.
- [x] Capture baseline geometry/workspaces at the existing commit through local fixture tooling.
- [x] Test capability policy, add shared material tokens/primitives and bounded static refraction.
- [x] Review dark/light Telemetry, Advanced, Coach, Video, Library/onboarding and responsive captures. Preserve Telemetry geometry.
- [x] Verify frontend build/tests, accessibility deltas, effect fallbacks, interaction/instance stability and before/after browser performance.
- [x] Update `EMBER_NOTES.md`, review scope and commit locally with the requested message. Stop.
