# Workspace transition replacement

**Goal:** A stationary shell and navigation around a 220 ms workspace crossfade with subtle depth. Preserve the mounted data tree, inspection and inactive-workspace lifecycle.

**Diagnosis:** The prior hook changed `main.scrollTop` around the session heading and tabs; it then slid/scaled only the incoming chart column. Inspector geometry snapped separately, there was no outgoing visual layer, and the transform origin covered arbitrarily tall content.

**Approach:** Make the workspace its own bounded scroller. A single generation-guarded navigator uses native View Transitions to capture the outgoing viewport only, fading it over the fully interactive incoming scene, leaving live charts and chrome stationary. Motion owns the tab indicator. Legacy engines commit immediately with a shallow opacity settle. No DOM/canvas cloning, duplicate React trees, GSAP runtime, or release packaging.

- [x] Pin latest-navigation, interruption, reduced-motion and disposal behavior with failing controller tests, then implement the controller.
- [x] Replace the old incoming-slide hook, relocate scroll ownership, route navigation/Coach inspection, and coordinate outgoing/incoming snapshots.
- [x] Verify all twelve ordered workspace pairs, rapid interruptions, resize, reduced motion, state identity and hidden-workspace work with focused browser checks.
- [x] Inspect actual native WebKit transition frames and measure frame pacing/event-loop stalls; document engine and workload limits.
- [x] Independent final review and affected regression checks.
