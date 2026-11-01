# Ten Tenths Telemetry

Read the current code and `git status --short` before editing. Preserve unrelated
work, including untracked files. This guide describes the current source, which
may be ahead of published releases. Start setup with
[docs/codex/windows-setup.md](docs/codex/windows-setup.md).

## Working rules

- Use applicable installed skills automatically. The repository skill
  `.agents/skills/ttt-development/SKILL.md` covers development and verification.
  Use debugging skills for failures, review skills for reviews, and simplification
  skills when simplification is requested. Missing optional personal plugins must
  not prevent ordinary development.
- Inspect callers, tests, fixtures, exports, configuration and browser adapters
  before changing a contract. Follow the existing layers and naming conventions.
  Prefer existing code, then platform APIs or installed dependencies. Implement
  the smallest complete change; avoid speculative abstractions and dependencies.
- Fix bugs in their shared owner. Add a focused regression check for meaningful
  logic changes, run affected checks, and report what actually ran and what did
  not. UI changes also need visual verification at relevant window sizes.
- Use Context7 for current library/framework/SDK/API/CLI/cloud documentation:
  resolve the library ID first, select the relevant authoritative/version match,
  then query one concept at a time. Ordinary business logic, refactoring and code
  review do not need documentation retrieval. If unavailable, disclose that and
  use official documentation; never invent a successful tool lookup.
- Keep personal Codex config, credentials, trust decisions and plugins outside
  Git. Do not copy another machine's authentication, hook trust hashes or absolute
  paths. Do not upload private recordings, publish, push or tag without a request.

## Architecture and contracts

| Area | Owner and responsibilities |
| --- | --- |
| Desktop UI | `src/App.tsx`, React 19/TypeScript, Vite 6, uPlot, Motion. `workspace.ts`, `advancedState.ts`, `workspaceNavigation.ts` own view/state transitions. |
| IPC | `src/bridge.ts` calls commands registered by `src-tauri/src/lib.rs`. Keep Rust Serde camelCase payloads, frontend types and test/demo adapters consistent. Blocking parsing, hashing, disk work and inference belong off the WebView thread. |
| Library and storage | `library.rs`, `persistence.rs`: source references, content hashes/versions, session cache, workspace persistence and recoverable file replacement. Original recordings stay in place; removing a library entry must never delete an XRK. Preserve missing/changed/Locate/Refresh behavior. |
| Parsing and analysis | `telemetry/mod.rs` uses pinned `libxrk` revision from Cargo.toml. `spatial.rs` aligns GPS laps and computes section metrics; `advanced.rs` and `expressions.rs` own analysis/formula validation. |
| Merging | Rust `merging.rs` and frontend `merging.ts` compose recording references. Preserve source-qualified identities, channels, lap timing and saved-format compatibility. |
| Coaching UI | `src/coach/` renders Rust evidence, potential and hypotheses. Current coaching commands require an original recording rather than a merged recording. |
| Physics | Rust `coach/analysis.rs`, `modeled.rs`, `simulation.rs`, `full_lap.rs`, `prediction.rs`, `full_lap_coaching.rs`: deterministic evidence, observed capability, cyclic distance-domain speed profiles, scenarios and predictive validation. |
| Offline interpretation | `coach/runtime.rs`, `service.rs`, `commands.rs`: directly linked pinned llama.cpp binding and Gemma 3 1B Q4_K_M. Integrity-checked model, bounded validated output, cancellation, single active inference, cache and computed fallback. No cloud/Ollama service is required. |
| Video | `src/video/`: HTML/YouTube players, sync controller, mappings and segments. Rust `video.rs` authorizes media; `video_analysis/` decodes frames; `video_sync/` handles scan/matching/lap sequences/multi-recording assignment. |
| Download cache | Rust `youtube/` manages validated URLs, bundled subprocesses, cancellation, protected cache references and leases. `scripts/prepare-youtube-tools.mjs` provisions pinned yt-dlp, Deno and source-built FFmpeg/ffprobe on the build host. |
| Website | `website/`, `vite.website.config.ts`, `scripts/build-website.mjs`: static site and synthetic browser demo reusing the app with substituted bridge/plots/video. It does not exercise native IPC or inference. |

Keep telemetry precision and original units in calculations; mph conversion is
presentation. Preserve calibration, gaps, nonfinite/nonmonotonic rejection,
unknown-unit warnings, spatial uncertainty and unsupported-data fallbacks.
Physics estimates must retain coverage/support/extrapolation diagnostics,
feasible combined grip, compatible section boundaries and no double-counting.
Keep measured and modeled alternatives distinct. Rust owns numerical estimates;
model text must not invent sensors, numbers or causal certainty. Preserve model
terms acceptance and evidence validation.

Keep `com.dalal35.apextelemetry`, Rust package/binary `apex-telemetry`, crate
`apex_telemetry` and persistence keys stable despite the public product name.
Resolve application data with Tauri APIs. Preserve local-video authorization,
empty initial asset scope, CSP and source identity checks.

## Commands and verification

Run from the repository root. Lockfiles are authoritative; use `npm ci` and
Cargo `--locked`. CI uses Node 22 and stable Rust. There is no configured lint
script. Do not replace lockfiles merely to refresh dependencies.

```sh
npm ci
npm test
npm run build
npm run test:release
npx playwright install chromium
npm run test:branding
npm run test:sidebar
npm run test:workflow
npm run test:canvas
npm run test:video
npm run build:website
npm run test:website
```

Choose affected browser suites, rather than running all for every edit. Browser
tests use simulated IPC, local servers and Playwright Chromium (or installed
Chrome on macOS). Native validation, after platform provisioning:

```sh
node scripts/verify-native-video-tests.mjs
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --test persistence --test video --test video_analysis --test feature_parity
npm run tauri dev
```

Full `cargo test` includes integrations needing specific ignored `data/` XRKs;
`test:plots`, `test:advanced`, `test:coach` also need private recordings/native
examples. Inspect each test's inputs first. Missing private fixtures are not
proof of a code regression. Keep real recordings out of Git and hosted CI.
Synthetic parity fixtures and checked-in Windows media provide public coverage.

## Platform boundaries

- **Windows:** native x64 Windows, stable MSVC Rust, Visual Studio C++ tools and
  Windows SDK, CMake/libclang, WebView2; Windows N needs Media Feature Pack.
  Rust/app compilation uses MSVC; MSYS2 UCRT64 GCC is for FFmpeg provisioning.
  Python is required on the build host for safe archive extraction. Use
  `npm run build:windows` for the unsigned per-user NSIS installer.
- **macOS:** shipping build is Apple Silicon/macOS 13+, system WebKit and
  AVFoundation. Xcode command-line tools, CMake, Python 3, curl, make and clang
  are build prerequisites. Run `node scripts/prepare-opencv.mjs` before native
  development/tests. `npm run build:mac` builds/signs/verifies the app and DMG;
  the configured signature is ad hoc, not notarized.
- Provision media helpers before native development/builds with
  `node scripts/prepare-youtube-tools.mjs --download`. Before packaging or real
  inference, run `node scripts/prepare-coach-model.mjs --download`; it verifies
  the pinned ~806 MB model and notices. These are explicit network downloads,
  not runtime requirements. Do not commit weights, sidecars or `.tools/` caches.
- Windows decoding uses Media Foundation/COM; macOS uses AVFoundation/Objective-C.
  Preserve presentation timestamps, rotation, pixel stride, bounded delivery and
  cancellation. **Motion tracking and scene descriptors currently require Apple
  Silicon** (`video_analysis/motion.rs`); Windows automatic video-sync parity
  must not be claimed. Installing OpenCV on Windows does not enable that code.
- Build each native installer on its target OS. Keep platform implementations
  gated and portable shared logic outside platform modules; do not port Mac
  framework commands or Unix environment syntax into PowerShell.

`.github/workflows/windows-dev.yml` provides manual `runtime`, `native`,
`browser`, `full` suites. Its runtime/install harnesses refuse ordinary local
profiles and are hosted-runner-only. Do not bypass their guards. Use physical
Windows acceptance for dialogs/drop, codecs, DPI, network paths and upgrades.
Read [docs/windows-development.md](docs/windows-development.md) for the existing
Windows-only CI procedure; its push examples are not standing authorization.
Production release behavior lives in `.github/workflows/release.yml`; tags can
publish. Keep release/platform policy intact during routine development.
