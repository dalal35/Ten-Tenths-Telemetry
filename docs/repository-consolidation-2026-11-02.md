# Repository consolidation audit — 2026-11-02

## Scope and original inventory

Origin was fetched with all configured heads and tags before changes. Its full-head
fetch refspec exposed exactly two original branches. Local and tracking tips agreed:

| Original branch/ref | Tip | Contents and relationship to main |
| --- | --- | --- |
| `main`, `origin/main`, `origin/HEAD` | `abd7498e4647790f08471d2c787170e51bc1a48b` | Released telemetry/advanced analysis, reversible merging, manual local/YouTube video synchronization and playback, Windows decoder/packaging, website. Includes auto-sync architecture/planning documents, but no automatic matcher implementation. |
| `codex/youtube-download-cache`, tracking branch | `fa37e6e76837d345e6add853c98ff0ca039b6b91` | Four descendant commits mixing offline coach, library correctness/performance, managed YouTube download/cache, retained workspace UI, automatic matching, and handoff documentation. Branch name understated its scope. |
| Windows working tree | Snapshot `da72330e335e5e4a83be4318af5abea5a57e0a1f` | 25 modified tracked files plus 11 untracked source/doc/font files: desktop design/motion/dialog fixes, Windows browser harness portability, Media Foundation display aperture handling and optional private-video regression, Windows subprocess type fix, atomic helper replacement. |

The four unique commits were:

- `6797394d6612a5636126eb17e367fcc041177e58`: backend coaching, managed cache/helpers, library/persistence/merge/telemetry fixes, and automatic video matching/toolchain.
- `59ec5d1415d6ea20a6778fe1f3621b01d5ca0e27`: coaching/cache UI, retained workspaces/navigation, library details, source-qualified plotting/video fixes, browser tests, estimator UI/IPC.
- `5abb0e4c548c37adbfd8eb925645cfe47a8fc459`: design and historical validation documentation for coaching, UI, cache and auto-sync.
- `fa37e6e76837d345e6add853c98ff0ca039b6b91`: portable project instructions/skill and Mac-to-Windows development handoff.

`git cherry -v main HEAD` classified all four as new patches. The graph was linear;
there were no divergent/rebased/cherry-picked duplicates among the available heads.
All original tags (`v0.1.0`, `v0.1.1`, `v0.1.2`, `v0.1.3`,
`v0.1.3-windows-beta.1`) were on main's ancestry and were left unchanged. There
were no stashes, additional worktrees, local-only commits, or unreachable objects
reported by `git fsck --full --no-reflogs --unreachable`. The one checkout's
reflog began with its Windows clone and checkout on November 1.

Commit metadata alone does not identify the machine that produced a commit. The
committed handoff describes the Mac source/export and validation. The source
changes and local Windows documentation identify target-platform work. This audit
cannot inspect unpublished refs, stashes or dirty files on the physical Mac;
those remain an explicitly unverified inventory boundary.

## Preservation and integration strategy

Backup branches retain original main/cache and the complete Windows snapshot:
`backup/2026-11-02-main`, `backup/2026-11-02-youtube-cache`,
`backup/2026-11-02-windows-work`. Original branches, tags and worktrees were not
deleted. The snapshot includes only reviewed source, tests, documents and licensed
fonts; ignored recordings, caches, executables, weights and artifacts were excluded.

`integration/2026-11-02-consolidation` starts at fetched `origin/main`. Changes
were extracted at file/hunk level from the preserved snapshot rather than merging
mixed commits wholesale. This avoids putting the automatic implementation in
main's commit ancestry while preserving its full original history on the separate
feature branch. No patch was silently dropped based on its branch name.

Included: all coaching/physics/offline runtime code and notices, library/persistence
and telemetry correctness fixes, merging/source provenance fixes, managed download
cache and cancellation/protection/lease behavior, manual source attachment and
segment editing, cached/local playback, retained chart/workspace UI and coaching,
Windows decoder/subprocess/helper/browser fixes, local typography/design/motion,
relevant tests, build/release safeguards and portable development guidance.

The existing workflow memory-retention assertion reproduced a disposed-plot leak.
Heap inspection traced a custom disposer to detached UI and initial recording
props. Disposal now removes that closure; the original assertion is retained.

## Automatic synchronization isolation

`feature/auto-video-sync` preserves the complete mixed source history and Windows
snapshot. The following stay out of integration/main:

- Rust `video_sync/`: scan/cache, motion matching, visual/lap sequences,
  multi-recording assignment, service/jobs, telemetry signatures and tests.
- `video_analysis/motion.rs`, `motion.cpp`, motion tests and auto-sync examples.
- Exclusive OpenCV provisioner/test/licenses, native build/linking and packaging.
- Estimator state/polling/cancellation/candidate UI, automatic IPC/types/registration,
  library snapshot adapters and auto-only cross-module tests.
- Automatic signature-only spatial adapters. Existing spatial analysis is retained
  byte-equivalent to original main; the independent speed-gap bugfix remains.
- Auto-sync design/experiment/validation documents, including older planning-only
  documents previously on main.

Manual `useVideoSync`, the player controller, `Sync Here`, lap anchors, correction,
segments, source selection/Locate/replace, playback and persisted mappings remain.
Auto-only test cases were isolated; manual/cache assertions were preserved.
Release checks now include `scripts/consolidation-tests.mjs`, which verifies the
manual contracts and rejects accidental automatic estimator/backend inclusion.

Current setup instructions no longer require OpenCV on main. Historical handoff
results remain explicitly labeled historical. Verbatim font licenses were changed
only to remove trailing whitespace; license text is preserved.

## Additional unfinished experiment and private acceptance

The ignored Windows setup report documented a failing archived interval-coaching
experiment on recording 0361. Its `simulation::investigate` entry point is gated
by `cfg(test)` and has only one caller: its real-recording experiment regression.
Production coaching uses `full_lap::analyze` and retains the active
`simulation::envelope` fallback. The experiment and its unchanged failing test
are preserved separately on `feature/legacy-coach-interval-experiment`. Main
retains the useful solver/math tests and active production coaching. No physical
constraints or gain assertions were relaxed to force a result.

Fifteen coaching acceptance tests require the two private XRKs deliberately absent
from hosted CI. They now have explicit private-recording names/ignore reasons;
every test body/assertion is unchanged. `npm run test:native:recordings` fails if
either recording is absent or discovery does not find all 15 tests, then executes
all 15 with `--ignored`. Public CI retains synthetic/native coverage. This is an
explicit fixture boundary, not a claimed pass from skipping local acceptance.

## Verification

Observed on native x64 Windows with Node 22.23.4 and MSVC Rust 1.99.1:

| Check | Result |
| --- | --- |
| Fresh lockfile install | `npm ci` passed; lockfile unchanged |
| Frontend Vitest | 28 files, 323 tests passed |
| Desktop and website TypeScript/production builds | Passed; existing large-chunk advisory retained |
| Release/branding/policy and no-auto guard | 34 passed |
| Download-tool unit tests | 8 passed |
| Pinned Windows helper verification/smoke | Passed, including H.264/AAC merge, VFR PTS, decode, corrupt-media rejection, Deno JIT |
| Coach model input | 806,058,240-byte pinned model, checksum and notices verified |
| Native cargo check | Passed |
| Full Rust suite | 237 passed, 17 explicitly ignored in default invocation |
| Explicit private coaching acceptance | All 15 discovered and passed, none ignored |
| Explicit native managed-video VFR acceptance | 1 passed |
| Native video test-discovery preflight | 12 enabled tests; actual decoder suite 11 passed, private padded-video test unrun |
| Browser suites | Branding, sidebar, workflow, canvas, manual video/integration, workspace transitions, desktop design, website passed |
| Real-XRK browser suites | Plots, Advanced and Coach passed using native diagnostic output and simulated IPC |
| Windows release packaging | Unsigned per-user x64 NSIS installer built successfully; not installed or published |
| Review and source hygiene | Independent extraction/leak/private-fixture review found no remaining blockers; no secret or machine-path matches found; no downloaded recordings/weights/helpers/cache/build outputs staged |

The workflow sample-retention assertion failed before the plot-disposer fix and
passed unchanged afterward. The baseline native library run had 200 passing tests,
one ignored helper test and only the unfinished interval experiment failing.
After separating that experiment, all retained assertions passed. An initial
parallel full build hit E0463 crate discovery; a standalone archive probe and a
serialized complete rebuild passed; the normal full Cargo command then passed again. Disk exhaustion interrupted an earlier build;
generated artifacts were preserved on a larger drive and native validation resumed
with a separate fresh target. No build paths or machine configuration were committed.
The three real-recording browser harnesses now reuse the existing no-watch helper:
a runtime probe confirmed Vite discarded their inline null watch override.

`git diff --check` is clean except the verbatim upstream yt-dlp license aggregate's
pre-existing trailing spaces, preserved byte-for-byte from the source branch.
Public release publication remains intentionally blocked by the existing yt-dlp
corresponding-source/Deno notice audit (`releaseReady: false`). The gate was
executed and correctly rejected publication; no release tag or publication was attempted.

### Final branches

- `main` receives `integration/2026-11-02-consolidation` by fast-forward, with no
  mixed automatic-implementation commits in its ancestry.
- `feature/auto-video-sync` retains the original mixed history/snapshot and the
  automatic implementation, with the consolidated main changes incorporated.
- `feature/legacy-coach-interval-experiment` retains only the unfinished interval
  workflow and unchanged real-recording regression on top of integration.
- Original `codex/youtube-download-cache` and all three backup refs remain.
  No branches, stashes, tags or worktrees are deleted. Exact final tips are
  verified against origin and reported in the final handoff.

### Unverified boundaries

The private padded 640x360 recording test requires `TTT_PADDED_VIDEO` and was not
run in this audit. Native generative model inference/terms acceptance, installer
execution/upgrade, physical dialogs/drop/DPI/UNC behavior, macOS/WebKit and DMG
packaging were not exercised. Browser IPC simulations do not establish those
properties. The fresh npm install reports three existing moderate dependency
advisories; dependencies/lockfile were preserved rather than auto-upgraded.
Unpublished state on the physical Mac remains inaccessible.
No test assertion is relaxed to make consolidation pass. Browser IPC/media mocks
are distinguished from native Windows execution. macOS runtime/WebKit and DMG
verification require a separate Apple Silicon host.
