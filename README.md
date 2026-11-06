<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/readme/hero-static.svg" />
    <img src="docs/readme/hero.svg" width="1200" alt="Ten Tenths Telemetry — Every lap tells a story. Find your next tenth. Illustrative telemetry comparison." />
  </picture>
</p>

<h1 align="center">Your data. Your line. Your next tenth.</h1>

<p align="center">A local-first desktop workspace for AiM XRK telemetry.<br />Compare laps, follow the racing line, and connect every trace to the track.</p>

<p align="center">
  <a href="#download"><img src="docs/readme/platforms.svg" height="32" alt="macOS Apple Silicon; Windows x64 beta" /></a>
  <a href="https://github.com/dalal35/Ten-Tenths-Telemetry/releases/latest"><img src="https://img.shields.io/github/v/release/dalal35/Ten-Tenths-Telemetry?style=flat-square&amp;label=latest%20stable&amp;color=bd3442&amp;labelColor=20262e" alt="Latest stable GitHub release" /></a>
  <a href="https://github.com/dalal35/Ten-Tenths-Telemetry/actions/workflows/release.yml"><img src="https://github.com/dalal35/Ten-Tenths-Telemetry/actions/workflows/release.yml/badge.svg?branch=main" alt="Release build workflow status on main" /></a>
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#read-the-lap">Explore the workspace</a> ·
  <a href="#under-the-bodywork">Architecture</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

## Read the lap

One moment. Every channel. The same point on the circuit.

<a href="website/assets/telemetry.webp"><img src="website/assets/telemetry.webp" width="1440" alt="Actual Ten Tenths Telemetry interface with a session explorer, overlaid speed and RPM plots, time delta, GPS circuit map and corner comparison panel. Captured using synthetic demo data." /></a>

<sub>Actual application interface, captured from the browser demo with synthetic session data. Click to view at full resolution. The desktop app imports your local XRK recordings.</sub>

### From a whole lap to a single decision

| | |
| :--- | :--- |
| ![Lap comparison — illustrative overlaid traces](docs/readme/comparison.svg) | ![GPS track maps — illustrative circuit trace](docs/readme/track.svg) |
| **Find where the laps diverge.** Overlay speed, RPM and available channels. Compare time delta at aligned positions, with estimates clearly labeled. | **Put the trace on the track.** Follow the GPS racing line. Select a section to inspect corner differences; adjust automatic boundaries when needed. |
| ![Advanced analysis — illustrative distribution and traction plots](docs/readme/analysis.svg) | ![Video synchronization — illustrative linked video and trace](docs/readme/video.svg) |
| **Look beyond the stopwatch.** Explore G-G traction, shifts, RPM recovery and distributions. Create unit-checked custom channels and save analysis presets. | **See the moment behind the data.** Manually synchronize supported local MP4/MOV footage with telemetry. Automatic video synchronization is not implemented. |

<details>
<summary>View the Advanced workspace</summary>

![Actual Advanced workspace with G-G traction, distributions and linked GPS map; synthetic demo data](website/assets/advanced.webp)

<sub>Actual interface with synthetic demo data.</sub>

</details>

**AI coaching · in development.** Offline driving-coach work is underway separately. It is not included in the published v0.1.3 installers. Release notes remain the source of truth for download availability.

---

## Download

<p>
  <a href="https://github.com/dalal35/Ten-Tenths-Telemetry/releases"><img src="docs/readme/download.svg" width="220" height="32" alt="Download Ten Tenths Telemetry from GitHub Releases" /></a>
</p>

| Platform | Availability | Download |
| :--- | :--- | :--- |
| **macOS 13+ · Apple Silicon** | Stable v0.1.3 · M1 or newer | [Download DMG](https://github.com/dalal35/Ten-Tenths-Telemetry/releases/download/v0.1.3/Ten-Tenths-Telemetry_0.1.3_aarch64.dmg) · [Release notes](https://github.com/dalal35/Ten-Tenths-Telemetry/releases/tag/v0.1.3) |
| **Windows 10/11 · x64** | Beta · physical GUI acceptance pending | [Windows beta](https://github.com/dalal35/Ten-Tenths-Telemetry/releases/tag/v0.1.3-windows-beta.1) · [Validation status](docs/windows-validation.md) |

[All releases](https://github.com/dalal35/Ten-Tenths-Telemetry/releases) · [Latest stable](https://github.com/dalal35/Ten-Tenths-Telemetry/releases/latest) · [macOS checksums](https://github.com/dalal35/Ten-Tenths-Telemetry/releases/download/v0.1.3/SHA256SUMS)

**First launch:** macOS builds are ad-hoc signed and not notarized; Windows builds are unsigned. Read the [macOS](#install-on-macos) or [Windows installation instructions](#install-on-windows) below for first-launch prompts, runtime requirements and platform limits. No automatic updater is configured.

**Keep your recordings local.** Telemetry and supported local video work offline. Original files stay in place; the library stores references and workspace preferences. No developer tools are required to run a released installer.

---

## Under the bodywork

![Local analysis architecture: XRK recordings to Rust and libxrk, through Tauri 2, to React and uPlot. Video uses system frameworks.](docs/readme/architecture.svg)

Rust handles decoding and full-precision calculations. React and TypeScript present the workspace; uPlot renders synchronized channel overlays. Tauri connects them in a desktop app, with AVFoundation on macOS and Media Foundation on Windows for local video. The MIT-licensed libxrk core is pinned to a reviewed revision.

**Engineering principle:** show uncertainty, missing data and platform limits where they matter. A telemetry tool should help you inspect the evidence.

## Documentation

[Release preflight](docs/release-preflight.md) · [macOS validation](docs/macos-release-validation.md) · [Windows feature parity](docs/windows-feature-parity.md) · [Progress & limitations](PROGRESS.md) · [Brand assets](docs/branding/README.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

<details>
<summary><strong>Installation, development & technical reference</strong></summary>

### Technical overview

A local-first telemetry workspace targeting Apple Silicon macOS and Windows 10/11 x64. Import AiM XRK sessions, select laps, compare speed and RPM, and follow the racing line alongside synchronized plots. Validated GPS geometry aligns laps by physical track position; approximate corner sections expose speed, time and channel differences with explicit resolution estimates. Click a track section to focus the whole comparison. When GPS cannot support spatial alignment, delta is clearly labeled estimated or withheld.

**Windows status:** native x64 decoding/persistence tests, NSIS extraction and hosted installation/update/uninstall pass in CI. Physical Windows GUI acceptance remains pending. See the [validation record](docs/windows-validation.md) for exact CI results and remaining physical Windows acceptance.

The macOS 0.1.3 release includes the complete implemented workspace, including the session explorer and responsive navigation. See [release notes](docs/release-notes-0.1.3.md) and [macOS validation](docs/macos-release-validation.md).

## Install on macOS

Requires an Apple Silicon Mac (M1 or newer) running macOS 13 Ventura or later. No Node, Rust, Xcode, or development server is needed to run the app.

1. Download the `Ten-Tenths-Telemetry_*_aarch64.dmg` installer from [GitHub Releases](https://github.com/dalal35/Ten-Tenths-Telemetry/releases).
2. Open the DMG and drag **Ten Tenths Telemetry** into **Applications**. Eject the disk image and open the app from Applications.
3. Import your local XRK recordings and optionally select local MP4/MOV footage. Local telemetry and video work offline, subject to system codec support. YouTube requires internet access and currently has a known native playback error 153; use local footage for synchronization (see [PROGRESS.md](PROGRESS.md)).

The app uses an ad-hoc signature, without Apple notarization or a paid Developer ID. macOS Gatekeeper can block the first launch. After attempting to open it, use **System Settings → Privacy & Security → Open Anyway**, then confirm Open, only if you trust the download. See [Apple's instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) and [Tauri's ad-hoc signing limitations](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing). Managed Macs may prohibit this override.

The existing bundle ID, `com.dalal35.apextelemetry`, is retained so upgrades keep the same library. Persistent session references and workspace settings live in `~/Library/Application Support/com.dalal35.apextelemetry/`. Keep original XRK and video files available; the app references them in place. There is no automatic updater. When upgrading from Apex Telemetry, quit it first, then move only `Apex Telemetry.app` out of Applications and install/open **Ten Tenths Telemetry.app**. Finder does not replace an app whose filename differs, so leaving the old bundle there would leave two app versions. Keep Application Support, your XRK recordings, videos, and datasets untouched; the new app uses the same library. For subsequent Ten Tenths Telemetry upgrades, replace the app in Applications.

## Install on Windows

The Windows build targets **Windows 10/11, x64**, using WebView2 and Media Foundation. Windows ARM64 and 32-bit builds are not provided. On Windows N, install Microsoft's [Media Feature Pack](https://support.microsoft.com/en-us/windows/experience/platform-variants/media-feature-pack-for-windows-10-11-n-february-2023) before launching: missing Media Foundation DLLs can prevent process startup. Available codecs still determine which MP4/MOV files can play or decode; an extension does not guarantee support.

1. Download the unsigned x64 NSIS installer from the [Windows beta release](https://github.com/dalal35/Ten-Tenths-Telemetry/releases/tag/v0.1.3-windows-beta.1). The beta release label is `0.1.3-windows-beta.1`; the verified installer retains application version `0.1.3`. Physical Windows 10/11 testing, mixed-DPI behavior and large private XRK performance remain unverified. See the [release limitations](docs/release-notes-0.1.3-windows-beta.1.md) and [feature-parity validation](docs/windows-feature-parity.md). The separate macOS v0.1.3 release is preserved.
2. Run the setup program for your current user. The NSIS installer is configured for per-user installation, Start Menu integration and the standard desktop-shortcut option. Hosted CI verifies installation, same-version update and uninstallation; physical GUI and legacy-upgrade checks remain pending.
3. If WebView2 is absent, setup downloads its bootstrapper and installs the runtime silently. That first installation requires internet; local telemetry and supported local video can operate offline afterward. End users do not need Node, Rust, Python, Visual Studio or FFmpeg.
4. Launch Ten Tenths Telemetry and select your existing XRK files and local video. Keep original files available; importing does not move or duplicate them.

Windows releases are **unsigned**. SmartScreen may show “Windows protected your PC” or an unknown-publisher prompt. If you trust the source and verified the download, use **More info → Run anyway** when Windows offers it. Organization policy may prevent that override. This project does not claim Windows code signing.

The application resolves its library through Tauri's app-data API, normally `%APPDATA%\com.dalal35.apextelemetry\`, including `library.json` and its recoverable backup. Writable data is separate from the install directory. Hosted CI verifies same-version update and uninstall preserve disposable app data. Legacy upgrades and real Windows profiles still need physical acceptance. Workspace formats and identifiers are unchanged. Moving a workspace between operating systems can require **Locate** because stored source paths are absolute. Simultaneous editing by multiple app processes is not guaranteed.

## Develop

For shared agent instructions and a clean Windows Codex setup, see [AGENTS.md](AGENTS.md) and the [Windows setup checklist](docs/codex/windows-setup.md).

Requires Node 22+ and stable Rust. Apple Silicon development also requires Apple's Command Line Tools (`xcode-select --install`), CMake and curl. Automatic video synchronization experiments are preserved on `feature/auto-video-sync`; this branch supports manual synchronization.

```sh
npm ci
npm run tauri dev
```

If using the project-local toolchain created during development:

```sh
export RUSTUP_HOME="$PWD/.toolchain/rustup"
export CARGO_HOME="$PWD/.toolchain/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
npm run tauri dev
```

```sh
npm test
npm run build
npm run test:plots # uses local real XRK fixtures and Chrome (or Playwright Chromium)
npm run test:workflow # browser workflow checks with simulated IPC
npm run test:advanced # real-XRK-backed advanced workflows and async races
npm run test:canvas # histogram inspection and canvas rendering regressions
npm run test:release # artifact/version checks and publication failure simulations; no network writes
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:mac
```

`npm run build:mac` embeds the production frontend and builds only Apple Silicon, using the existing icons. Artifacts are `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Ten Tenths Telemetry.app` and `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Ten Tenths Telemetry_0.1.3_aarch64.dmg` (the filename version follows the app version). Apple's Command Line Tools, CMake, curl and Node.js are build-time dependencies only; the app uses system WebKit and AVFoundation at runtime.
Telemetry belongs in ignored `data/`; it is never committed. Importing reads files locally without changing them. The session library stores references and workspace preferences on this computer, with atomic saves and a recoverable backup; parsed samples are cached in memory rather than duplicated on disk.

### Offline AI Driving Coach

Open **AI Driving Coach** in a recording for **How to Improve Your Fastest Lap**. The coach automatically targets the fastest complete valid lap, reviews its corners and straights, and uses other spatially aligned laps as supporting examples. No manual lap-time target is needed. The main view shows fastest lap, enhanced theoretical best and automatic improvement potential, with up to three concise experiments. Rust calculates demonstrated or defensible hypothetical gain ranges using timing uncertainty, recorded acceleration capacity, GPS geometry and compatible boundary states; unsupported ideas say “Gain not yet quantifiable.” The full-lap budget counts each section once, using a measured or modeled alternative rather than adding overlapping gains. Traditional sector stitching remains separately inspectable. Inspect a finding to focus the fastest lap in the synchronized plots and track; compatible attached video seeks to the same interval. Missing video never blocks telemetry inspection.

The bundled Gemma 3 1B model runs through embedded llama.cpp, without Ollama, Python, accounts, API keys or network access. Review and accept the bundled model terms in the coach to enable local explanations. All measurements, gain ranges and confidence classifications remain deterministic. Gemma compares and orders bounded telemetry-grounded interpretations; Rust supplies approved wording and all numerical estimates. These are coaching hypotheses, not validated causal diagnoses. Cancellation, progress, bounded caching and a computed-report fallback keep inspection available. Cross-recording merged coaching is currently unsupported; select an original recording.

Build hosts additionally need CMake, libclang and a C/C++ compiler. Provision the pinned model once using `node scripts/prepare-coach-model.mjs --download`; packaging verifies its digest and includes the model and redistribution terms. End users need none of these build tools and perform no model download. See [architecture, model distribution and benchmarks](docs/offline-coach-runtime.md) and run `npm run test:coach` for the real-recording-backed browser workflow.

### Windows development and production builds

Use a native Windows x64 environment with stable Rust's **MSVC** toolchain, Node 20+ (CI uses Node 22), Microsoft C++ Build Tools with **Desktop development with C++** and a Windows SDK, CMake/libclang, plus the Evergreen WebView2 runtime. Windows N also requires Media Feature Pack. Build hosts also need Python and MSYS2 UCRT64 tools to provision the pinned bundled media helpers; a separate FFmpeg installation is unnecessary. Follow the [Windows setup checklist](docs/codex/windows-setup.md) and [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
# First provision media helpers in MSYS2 UCRT64 as described in the setup guide.
npm run tauri dev
# In a separate terminal, or after stopping dev:
npm test
npm run test:release
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --test persistence --test video --test video_analysis
node scripts/prepare-coach-model.mjs --download
npm run build:windows
```

`build:windows` selects `x86_64-pc-windows-msvc` and NSIS explicitly; `tauri.windows.conf.json` supplies the Windows-only bundle settings and ICO. Installer output is `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Ten Tenths Telemetry_0.1.3_x64-setup.exe`. The app executable is `src-tauri/target/x86_64-pc-windows-msvc/release/apex-telemetry.exe`. Build these on Windows; the macOS bundler is not used to produce a Windows installer.

Browser verifiers use existing local Chrome on macOS or Playwright Chromium elsewhere. Run `npx playwright install chromium` before those checks. Real-XRK Rust integration suites and `test:plots`/`test:advanced` require the private ignored recordings in `data/`; do not upload those recordings to public CI. The Windows decoder tests copy pinned original H.264/AAC fixtures with checked SHA-256 hashes and inspected timestamps/B-pictures; no test encoder or FFmpeg is required on the runner. They must execute on Windows rather than being counted as passing when compiled out.

Hosted CI also runs `--test feature_parity` with deterministic synthetic XRKs through the real parser and library. The Windows release-app WebView2 harness uses disposable hosted-runner profiles and actual IPC/media playback. See the [feature-parity evidence and physical-machine limits](docs/windows-feature-parity.md). The harness deliberately refuses local machines and existing application profiles.

Speed displays use mph; source telemetry and internal calculations retain their original units. Reopening restores the active session, lap selections, channels, graph layout and compatible zoom. Missing files remain visible: use Locate to reconnect the same recording. Modified files require an explicit Refresh, which clears incompatible workspace state and corner edits. Removing a library entry never deletes its XRK file.

Use Edit boundaries on the circuit trace to adjust the automatic section boundaries, then drag a handle or use its arrow keys. Overrides belong to the selected primary lap and are stored in reference-track meters. Reset to automatic restores the detected sections; recorded telemetry and GPS alignment remain unchanged.

## Release

Follow the [release preflight and failure-handling checklist](docs/release-preflight.md) before tagging or publishing.

The [release workflow](.github/workflows/release.yml) defaults to Windows-only validation and publication. A new matching `v*` tag builds the x64 NSIS installer, runs the hosted install, update and uninstall checks, verifies the exact artifact set and checksums, uploads a draft, verifies uploaded assets, and publishes a stable release. macOS does not gate Windows releases. Set the repository variable `RELEASE_PLATFORMS` to `macos` or `all` to resume those tag releases; with `all`, both jobs must succeed. Manual dispatch supports Windows, macOS or all-platform build validation and never publishes.

Versions must match across package/lockfiles, Cargo and Tauri metadata. Existing releases and tags are never overwritten. The publisher requires assets from the same revision and workflow run. Build jobs have read-only contents access; only the gated publisher can write releases. Windows builds are unsigned; macOS builds use ad-hoc signing without Apple notarization. No automatic updater is configured.

Private XRK integration suites run locally; fixture-independent tests run in hosted CI. Browser IPC simulation and Rust media tests supplement packaged native acceptance. Release notes document exact coverage and remaining limits. macOS source, its native tests and packaging automation remain intact; a Windows-only release does not claim new macOS acceptance, and hosted Windows checks do not replace physical Windows GUI acceptance.

## Advanced analysis

Open Advanced beside Telemetry for G-G traction, shift events, RPM recovery, scatter plots, distributions, custom channels and saved analysis presets. Tools share lap selections, track sections, graph ranges and point cursors. Histogram bins describe aggregate occupancy and do not move the track cursor. Each tool retains its own channels and axis settings.

Choose accelerometer axes, signs and zero offsets before interpreting G-G plots. Logger calibration and mounting are not independently verified. Calculated gear and RPM-inferred shifts are labeled separately from measured gear changes. RPM recovery defaults to a configurable 8,200 RPM threshold; without throttle/gear evidence, low-RPM recoveries remain candidates.

Formulas use channel IDs in brackets, unit-bearing constants such as `8200{rpm}`, and explicit conversions such as `convert([channel-id], "mph")`. The Rust evaluator validates units and dependencies, rejects cycles, and leaves invalid or unsupported results as gaps. Saved formulas also appear in ordinary telemetry channels. Manage presets to save, rename, delete or choose a default; existing Milestone 4 workspaces remain compatible.

## Design

Rust owns decoding and full-precision numerical calculations; React owns presentation. The MIT-licensed libxrk core is pinned to a reviewed revision. uPlot renders synchronized channel overlays. Numerical limitations and missing data are shown in the workspace instead of inventing results. See [PROGRESS.md](PROGRESS.md) for observed validation and current limits.

Local frame analysis shares one Rust API: macOS retains AVFoundation/Core Image and its Objective-C bridge; Windows uses Media Foundation Source Reader through Windows-only Rust bindings. Frames retain actual presentation timestamps, with bounded RGB/gray output, resize, progress and cooperative cancellation on a blocking worker. Codec and color behavior depend on the system stack. Windows reports the first actual video-sample PTS as track start; macOS track metadata can include a leading empty edit. Native fixture tests verify Windows timing and rotation; codec diversity and physical playback acceptance remain separate from those tests.

Manual video synchronization and persisted segment mappings remain shared. YouTube playback is implemented but has a known macOS packaged error 153; packaged Windows availability is unverified. YouTube downloading and automatic visual synchronization are not implemented. The frame-processing backend is infrastructure for later visual analysis, not a claim that automatic crossing detection or synchronization is available.

## Branding and compatibility

The product is now **Ten Tenths Telemetry**. The original theme, bundle identifier, executable basename and persistence keys are retained. This release advances the package version to 0.1.3 without overwriting the existing v0.1.0 tag. Windows installer upgrade detection deliberately retains its legacy registry keys while presenting the new product name. Native Windows upgrade acceptance remains required; see [Windows rebrand compatibility](docs/branding/windows-compatibility.md).

Editable SVG assets, previews, exploration and icon inventory are in [the branding guide](docs/branding/README.md). Reproduce the icons with `node scripts/generate-brand-assets.mjs`; run branding checks with `npm run test:release` and `npm run test:branding`.

## Session explorer and responsive layout

The session explorer provides persisted expanded, compact and hidden navigation, independent session sorting/grouping and lap ordering, contextual Locate/Refresh/Remove actions, and a temporary merge selection mode. Merge previews preserve original recordings and source-specific lap/channel/video provenance; unmerging removes only the virtual session.

At narrow widths navigation becomes a keyboard-accessible modal drawer. Telemetry, Advanced and Video layouts adapt to available space down to the 600×500 native window minimum. Sidebar changes and resizing retain session/lap selections, chart zoom, channels, analysis settings and video mappings.

## Website live demo

Run `npm run build:website` to produce the GitHub Pages site in `dist-website/`; serve that directory with any static HTTP server. `npm run test:website` exercises the built site beneath a project subdirectory using Playwright. The homepage is static and its Download buttons scroll to the installer section. The standalone React demo remains available at `demo/index.html`, without an embedded homepage preview.

The demo reuses the desktop `App`, session explorer, uPlot charts, track map, Advanced workspace and styles. `vite.website.config.ts` substitutes browser-only bridge and video adapters from `website/demo/`; the desktop entry and native bridge are unchanged. Two synthetic sessions share deterministic channels, lap clocks, GPS, segments and analysis data. Video is a labeled animated illustration with synchronized playback rather than recorded footage. Native file/library operations and unsupported formula evaluation are unavailable; the demo does not import XRK files or persist a user library. The Pages workflow builds this artifact whenever the website or reused frontend changes.

</details>

---

## Managed YouTube downloads

Native YouTube downloads use bundled yt-dlp, Deno and narrow FFmpeg/FFprobe helpers;
users do not install media tools. Build hosts run `npm run prepare:youtube` before
native builds and `npm run test:youtube-tools` to verify them. See
[toolchain packaging, versions, sizes and redistribution status](docs/youtube-toolchain.md).
Local builds are supported; tagged publication remains gated on completion of
the standalone dependencies' corresponding-source and notice audit.

<p align="center"><sub>TEN TENTHS TELEMETRY · BUILT TO READ THE LAP</sub></p>
