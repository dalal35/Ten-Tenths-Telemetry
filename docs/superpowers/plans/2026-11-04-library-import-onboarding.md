# Phase 7: Library, import and onboarding implementation plan

**Goal:** Finish the premium desktop first-run and recording-management experience on the exact Phase 6 Video baseline.

**Architecture:** Retain the production App, explorer, bridge, Rust library and persistence owners. Add presentation-only import observations to the sequential bridge loop, summarize results without retaining decoded sample arrays, and keep onboarding inline in the empty workspace. Use existing theme tokens and Motion. No dependencies or persisted schema changes.

**Spec:** User's Phase 7 brief in this chat. Implementation is authorized directly by that brief; routine design decisions remain with the coordinator.

## Constraints and design

- Branch `feature/library-import-onboarding-premium` starts directly at `8da9819d960141ec66e2d7482468fc178903fa37`.
- Preserve parser/import outcomes, duplicate hashing, source repair, selection/comparison, merge warnings, workspace queues and restoration. No Rust, AI, decoding, sync algorithm, website or cloud-account work.
- Retain Phase 3 explorer organization and only supported sort/group controls. Enrich existing recording metadata without inventing filters.
- The first-run screen answers “How do I start analysing my first recording?” One import action, local-processing reassurance, four concise workspace descriptions, contextual lap-comparison guidance. No carousel or onboarding gate.
- Import uses an accessible nonmodal receipt outside the inert workspace. Show choosing/reading/completion, actual completed files, source filename, lap/channel counts, parser warnings and failures. No fictional percentage. Existing ID means already in library; an unavailable pre-import entry means source reconnected. Preserve cancellation and partial-success contracts.
- Motorsport identity comes from TTT's existing mark, condensed display type, timing-sheet organization and a restrained racing-line motif. React Bits reveal ideas are adapted using installed Motion rather than adding GSAP.
- Existing checkout is clean; reuse it, create the requested branch, preserve ignored recordings/caches. C: free space checked before screenshots (~49 GB).

## Tasks

- [x] Audit Rust/frontend contracts, existing tests and 0361/0362 fixtures; capture before screenshots.
- [x] Polish explorer rows, recording details and merge surfaces (Terra owns sidebar/details/merge/library CSS).
- [x] Add bridge observation tests and summary tests; implement optional progress observation without changing return/error semantics.
- [x] Implement inline Welcome and import receipt; integrate App lifecycle and real native drop feedback.
- [x] Run focused regressions and iterative Playwright review at desktop and 600×500, both themes and reduced motion.
- [x] Review integrated diff, run Vitest, TypeScript/production build, affected browser suites, document evidence/limitations, commit locally without push/merge.

## Review focus

- Cancelled file picker leaves current recording/workspace intact.
- Mixed success/failure retains successful imports and identifies each failed filename.
- Duplicate/reconnected and repeated batch files retain existing workspaces and correct source identity.
- Nonmodal receipts do not trap focus, block explorer menus or hide focused controls; merge/details still manage modality and return focus.
- No decoded telemetry arrays retained by import summaries; narrow/short screens scroll within visible surfaces; reduced motion removes spatial reveals.

## Verification boundaries

Real local XRKs and cached diagnostics are present. Browser IPC checks remain simulated, even when using real recording data. No native app was running on CDP. Historical November 2 backend binaries were subsequently discovered and 22 management checks passed using real XRKs; their provenance does not establish current compilation or Phase 7 native UI acceptance. No Rust rebuild was performed. See docs/library-premium-delivery.md for final evidence and limitations.
