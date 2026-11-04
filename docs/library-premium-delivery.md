# Phase 7 — Library, import and onboarding

Implemented directly in the production desktop App on
`feature/library-import-onboarding-premium`, branched at the exact Video commit
`8da9819d960141ec66e2d7482468fc178903fa37`.

## Experience

- The Phase 3 explorer keeps its sorting, grouping, resizing, collapsed modes,
  keyboard navigation and independent session/lap scrolling. Recording rows add
  lap/channel counts and source-filename suffixes so similarly named runs are
  distinguishable. Combined sessions show their source count.
- Details and merge surfaces use the existing theme tokens, source summaries,
  recording metadata and clearer preservation/warning copy. The compact merge
  dialog initially focuses its top without scrolling past the explanation.
- Import presents a nonmodal receipt with actual sequential file completion,
  filenames, lap/channel counts, parser data notes, individual failures, and
  actions to open a recording or import more. Existing recordings and reconnected
  unavailable sources have distinct feedback; duplicates keep their workspaces.
- The bridge retains the same return values, partial-failure warning format,
  cancellation, path handling and parser commands. Optional observations expose
  existing per-file work; no fabricated percentage or parser cancellation is added.
  Receipt state stores metadata only, never decoded sample arrays.
- Native drag enter/over/leave events now drive drop feedback. Ordinary text drags
  are ignored. Browser preview directs imports to the desktop app.
- First run is an inline workspace: one import action, local-processing and file
  preservation reassurance, a racing-line motif and expandable descriptions of
  Telemetry, Advanced, Video and AI Coach. It adds no account, modal tutorial,
  persisted onboarding flag or mandatory setup.
- Motion entrances and a restrained React Bits BlurText soft-focus adaptation use
  the installed Motion runtime. Reduced motion skips these effects. Receipts hide
  and become inert under modal explorer/merge surfaces, release input on exit,
  restore opener focus, and disable actions for removed/unavailable recordings.

No Rust, parser, calculation, AI backend, video decoding, synchronization algorithm,
workspace schema, marketing website or dependency changes.

## Audit findings retained

The native library owns hash-based identity, source repair and modified-file
rejection. Original recordings remain in place. Merge preserves qualified source
identities and original workspaces; previews require warning acknowledgement and
reject stale versions. Workspace restoration and queued saves keep their owners.

Ambiguous logger dates remain ambiguous rather than being guessed. For example,
the local 0361/0362 slash-date strings can still show “Unknown date” in grouping;
their original date strings and filenames remain available. No unsupported search,
metadata editing or filtering was added.

## Verification — November 4, 2026

| Check | Result and boundary |
| --- | --- |
| `npm test -- --configLoader runner` | 33 files, **348 tests passed**. Includes bridge observations/Windows paths, summary retention, target validation and recording identity. |
| `npm run build -- --configLoader runner` | TypeScript and production build passed. Existing large-chunk warning remains; main JS approximately 696 kB / 224 kB gzip. |
| `npm run test:library:premium` | Production Playwright passed with real 0361/0362 cached diagnostics and **simulated IPC/dialogs/native drag events**. |
| `npm run test:sidebar` | Passed 100-entry browsing, organization, keyboard, metadata Save/Cancel/error/reload/Escape, persisted explorer modes, independent scroll regions, 600×500–2560×1440 resizing and retained plot/canvas/player/state. IPC/media clock simulated. |
| `npm run test:workflow` | Passed selection switching, queued saves, merge/unmerge, original workspace restoration, library removal and bounded decoded-sample retention. IPC simulated. |
| `npm run test:video` | Both existing browser suites passed; attachment/download/cache/mapping, playback controller, race handling, navigation, semantic saves and stale callbacks. IPC/media clock simulated. |
| Playwright MCP | Inspected current production welcome/keyboard structure, scroll geometry and computed fonts at 600×500; import action fits above the status bar, no horizontal document overflow; reduced-motion load has zero running animations and no hero transform or blur. |
| Existing native backend test binaries | **10 library + 12 merge-management checks passed**, single-threaded, using genuine local 0361/0362 XRKs and test-owned temporary copies. Four unrelated coach/formula/corner-analysis tests filtered. See provenance below. |
| `git diff --check` | Passed. |

The production acceptance harness covers cancelled picker, sequential progress,
multi-file partial and complete failure, Import more cancellation with focus return,
duplicates across and within batches,
reconnection, active recording/comparison/axis restoration, stale receipt actions,
native-event feedback simulation, modal layering, focus return, compact merge
initial visibility and keyboard wrap, both themes and reduced motion.

Windows sandbox restrictions prevented Vite/esbuild from reading parent paths in
the default development test loader. Production/Vitest use the runner loader;
development browser suites were run with approved sandbox escalation. The sidebar
verifier also updates stale selectors for the completed Advanced canvas overlay,
Video attach action and new welcome CTA without dropping their behavior checks.

Disk space was checked before artifacts (~49 GB free); no user data or caches
were removed. Real recording hashes remained unchanged after native test runs.

## Screenshots

All screenshots are local and ignored under `.tools/library-ui/`; private recording
diagnostics and screenshots are not committed or published.

- Before: `before-first-run.png`, `before-library.png` and matching `*-compact.png`.
- After: `after-first-run.png`, `after-first-run-compact.png`,
  `after-first-run-light.png`, `after-first-run-light-compact.png`.
- Import: `after-import-progress.png`, `after-import-results.png`,
  `after-import-error.png`, `after-import-compact.png`.
- Management: `after-library.png`, `after-library-compact.png`,
  `after-details.png`, `after-merge-compact.png`, `after-light-compact.png`.

To regenerate the after screenshots, keep the local, ignored diagnostics at
`.tools/coach-ui/0361.json` and `0362.json`, build production, then run
`npm run test:library:premium`. The script never overwrites the baseline captures.

## Limits and provenance

The native binaries date from **November 2**, before the specified Video baseline;
their exact build provenance is unconfirmed. They exercise historical native
backend import/duplicates/metadata/merge/reopen/unmerge/workspace behavior with real
files. Merge tests change dates/checksums only in temporary copies. They do not
prove current-source compilation or current Phase 7 native UI behavior.

No current Rust rebuild, installer, native file-picker or physical drop acceptance,
WebView2/DPI/UNC-path UI check, macOS acceptance, real onboard-video matrix or AI
inference was run. Native Tauri UI acceptance remains required. Production browser
checks use genuine cached telemetry but simulated persistence and IPC.

## Design references

Retained the production Race Control/Hypercar shell and IBM Plex/Barlow tokens.
Consulted UI UX Pro Max focus/accessibility guidance, app-screen density guidance,
shadcn alert-dialog examples/checklist, Motion
[accessibility](https://motion.dev/docs/react-accessibility), and React Bits
[BlurText](https://reactbits.dev/textanimations/blurtext) and AnimatedContent patterns
through Context7. No 21st MCP was available. No component library, GSAP or other
runtime dependency was installed.
