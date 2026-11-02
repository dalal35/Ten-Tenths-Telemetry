# Repository consolidation plan

**Goal:** Integrate completed coaching, library, cache, UI and Windows improvements onto latest main while preserving automatic synchronization separately.
**Authority:** User's audit/consolidation request, including commit, push and merge authorization.

- [x] Fetch all remote branches/tags; enumerate refs, worktrees, stashes, reflogs and unreachable objects. Compare ancestry and patch equivalence.
- [x] Preserve original main/cache refs and snapshot tracked/untracked Windows work without ignored data. Create feature/auto-video-sync at the complete snapshot.
- [x] Create integration/2026-11-02-consolidation from origin/main. Extract the complete non-auto tree; remove automatic scan/matching/assignment, exclusive motion/OpenCV tooling, estimator UI/IPC and auto-only tests/docs. Preserve manual mapping and cache coverage.
- [x] Verify frontend/TypeScript/release, browser manual synchronization/cache/workspaces, website, Windows native Rust/decoder/coaching/telemetry. Add a guard against auto-sync implementation returning.
- [x] Review the extracted tree against the preserved snapshot and enumerate every excluded file/hunk. Record platform and fixture limits.
- Final publication: commit/push integration and both experiment branches, fast-forward main after verification, then verify remote hashes. Preserve all original branches, stashes and worktrees; final tips are reported in the handoff.

## Verification boundaries

Run Node 22 and native MSVC on this Windows host. Browser IPC simulations prove UI behavior only. macOS packaging/WebKit must be reported unverified here. Preserve publication gates and hosted-runner guards. Do not install or run hosted lifecycle tests in a personal profile. Model weights and YouTube sidecars are ignored provisioned inputs. Missing private media is reported, never bypassed by weakening tests.

The archived cfg(test) interval investigation was found unfinished and preserved
separately with its unchanged failing regression. Private coaching acceptance
remains explicit and fail-fast; all 15 original test bodies were executed.
