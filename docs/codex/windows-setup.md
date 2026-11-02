# Windows Codex handoff

> Historical handoff for the mixed cache/auto-sync branch. On main, automatic
> synchronization and OpenCV tooling are isolated on `feature/auto-video-sync`.
> Skip OpenCV provisioning here; manual video sync and decoding remain supported.


Audited 2026-11-01 against the Mac's current working tree and local instruction,
skill, plugin and configuration files. This is a selective recreation, not a
home-directory migration. No global settings were changed by this audit.

## 1. Install native Windows development tools

Use Windows 10/11 x64 and PowerShell. Build the Windows app on Windows; a WSL
Linux build does not validate WebView2, Media Foundation or NSIS. Install only
missing tools. Check `winget list` and review publisher/package identity first.
These commands install software on the Windows machine; run them yourself as
needed, rather than pasting them into an unattended bootstrap script:

```powershell
winget install --exact --id Git.Git
winget install --exact --id OpenJS.NodeJS.22
winget install --exact --id Rustlang.Rustup
winget install --exact --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --exact --id Kitware.CMake
winget install --exact --id LLVM.LLVM
winget install --exact --id Python.Python.3.12
winget install --exact --id MSYS2.MSYS2
# Optional, for manually dispatched GitHub validation:
winget install --exact --id GitHub.cli
```

CI uses Node 22; match that major rather than the audited Mac's older Node 20.
Verify the Visual Studio Installer includes MSVC x64/x86 tools and a Windows
SDK. Install/repair Evergreen WebView2 from Microsoft's official download if
absent. Windows N additionally needs Media Feature Pack via Windows Optional
Features and a restart. Tauri's [prerequisites](https://v2.tauri.app/start/prerequisites/)
explain the native C++/WebView2 requirements.

Open a new **Developer PowerShell for VS 2022** so MSVC and SDK environment
variables are initialized. Confirm `cmake`, `clang` and Python are on PATH;
disable the Microsoft Store Python alias if it intercepts `python`. If bindgen
cannot locate LLVM, set `LIBCLANG_PATH` to the directory containing your actual
`libclang.dll` for this session. Do not reuse a Mac library path.

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
rustup target add x86_64-pc-windows-msvc
git --version
node --version
npm --version
rustc -vV
cargo --version
cmake --version
clang --version
python --version
Get-Command cl, link, cmake, clang, python
```

Use normal user-owned Rust/Node installations; do not copy `.toolchain/`,
`.tools/`, `node_modules/` or `target/` from macOS. Preserve existing Git line
ending preferences; `.gitattributes` already pins NSIS/workflow files to LF.

## 2. Pull and prepare the project

Pull the complete handoff revision into your existing checkout, preserving
any Windows-local changes. The handoff includes the application sources,
`scripts/prepare-youtube-tools.mjs`, `scripts/prepare-coach-model.mjs` and the
corresponding Cargo/Tauri changes; do not cherry-pick only the Codex documentation
commit. See the [handoff verification](../windows-handoff.md) for checks and
outstanding target-platform validation. The [environment audit](environment-audit.md)
records the earlier, uncommitted snapshot.
Open the repository root in Codex. Repository
`AGENTS.md` and `.agents/skills/ttt-development/SKILL.md` arrive through Git;
there is no separate project-skill installer and no project Codex config to
overwrite your defaults.

```powershell
git status --short
npm ci
npx playwright install chromium
npm test
npm run build
npm run test:release
```

For native builds, provision the media helpers using **MSYS2 UCRT64**. In that
terminal, install the same build tools used by `.github/workflows/windows-dev.yml`:

```sh
pacman -S --needed make diffutils pkgconf mingw-w64-ucrt-x86_64-gcc
```

Then, from the repository root in that terminal, ensure Windows Node and Python
are available (`node --version`, `python --version`); add their actual install
directories to this session's PATH if needed. Do not substitute MSYS Node/Rust.
Run:

```sh
node scripts/prepare-youtube-tools.mjs --download
node --test scripts/youtube-tool-tests.mjs
node scripts/verify-youtube-tools.mjs
```

The provisioner uses Python for safe archive extraction and bash/make/GCC to
build the pinned FFmpeg source. It verifies pinned downloads; it does not need
a separately installed FFmpeg. MSYS2 GCC is for these helpers only. Return to
Developer PowerShell for Cargo/Tauri; do not put UCRT64 GCC ahead of MSVC there.

Before packaging or testing model inference, review the bundled Gemma terms and
provision its pinned 806,058,240-byte weights. The app separately asks for user
acceptance before enabling explanations; installation must not accept for you.

```powershell
node scripts/prepare-coach-model.mjs --download
node scripts/prepare-coach-model.mjs
node scripts/verify-native-video-tests.mjs
cargo check --locked --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --test persistence --test video --test video_analysis --test feature_parity
npm run tauri dev
# Stop dev before packaging:
npm run build:windows
```

The executable is under `src-tauri/target/x86_64-pc-windows-msvc/release/` and the
NSIS installer under its `bundle/nsis/`. The installer is unsigned and installs
per user. Build hooks verify the weights and sidecars before compiling the UI.
Weights are unnecessary for frontend-only work; helpers may be required even
for native dev because Tauri declares them as external binaries.

## 3. Configure Codex personally, without overwriting settings

Install the official Windows app, or install the official CLI through npm if
missing. Sign in anew on Windows; never copy Mac authentication files.

```powershell
npm install -g @openai/codex
codex --version
codex login
codex login status
```

Use the app's supported Windows sandbox setup. Native PowerShell is supported;
WSL is optional for Linux work, not the target environment for this desktop app.
See [Windows sandbox](https://developers.openai.com/codex/windows).

Determine your active Codex home and back up files that exist before editing:

```powershell
$codexDirectory = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$backupSuffix = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($name in 'config.toml', 'AGENTS.md', 'AGENTS.override.md') {
    $existing = Join-Path $codexDirectory $name
    if (Test-Path -LiteralPath $existing) {
        Copy-Item -LiteralPath $existing -Destination "$existing.$backupSuffix.bak" -ErrorAction Stop
    }
}
```

Review [config.example.toml](config.example.toml) and
[global-AGENTS.example.md](global-AGENTS.example.md), then merge only desired
settings into personal files. Add top-level TOML keys before table headers;
edit existing keys/tables instead of appending duplicates. Mac preferences were
`gpt-6.1-sol`, medium reasoning and pragmatic personality; select that model
only if offered to the Windows account. The examples deliberately omit a model
pin and optional priority service tier. Sandbox/approval defaults in the example
are conservative recommendations, not values found in the Mac config.

Global instructions live in `CODEX_HOME/AGENTS.md`; an `AGENTS.override.md` takes
precedence there. Check overrides if instructions seem missing. Repository and
more specific instructions layer on top. Personal defaults and trusted project
config have different precedence: see [configuration basics](https://developers.openai.com/codex/config-basic).
Trust only this checkout through the Windows client, not a copied list of Mac
paths. Keep managed policy and existing approval rules intact.

## 4. Restore documentation tools and useful optional skills

Prefer the connected Context7 plugin if Windows already exposes its
`resolve-library-id` and `query-docs` tools. Otherwise add the hosted MCP once,
after checking `codex mcp list` for an existing entry:

```powershell
codex mcp list
codex mcp add context7 --url https://mcp.context7.com/mcp
# Optional, useful for Codex/OpenAI product questions:
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
```

If Context7 requires a key, privately populate `CONTEXT7_API_KEY` in the
environment inherited by Codex and enable `bearer_token_env_var` in the example
table. Do not type the secret into a committed file or an agent transcript.
Do not add a second Context7 transport when the plugin already works. The
[upstream Context7 configuration](https://github.com/upstash/context7/blob/master/docs/clients/codex.mdx)
and [Codex MCP docs](https://developers.openai.com/codex/mcp) describe these transports.

The [inventory](skill-inventory.md) lists local skill names and cached versions;
[environment audit](environment-audit.md) separates useful tools from unrelated
personal integrations. Recommended order:

1. Use the checked-in `ttt-development` skill. Automatic selection is enabled by
   default for ordinary skills; explicit `$ttt-development` is a discovery check.
2. Preserve custom `search-first` and `simplify-codebase` as personal skills.
   A private ZIP was exported outside Git during this audit, including references,
   licenses and the optional renderer. Transfer it privately; verify SHA-256
   `9e6be9041d65a8cc49d21aefe8799fcfb3a56cde29adef996e087b0a2755bbb0`.
   Extract into a fresh staging folder, inspect it, then copy only absent skill
   folders to `$HOME/.agents/skills`. Also included: the instruction-only
   `context7-mcp` skill. That skill does not itself install an MCP server.
3. Optionally reinstall Ponytail 5.3.3, Codex Orchestrator 0.4.1 and
   code-simplifier 0.2.1 from the reviewed sources in the audit. Superpowers 7.0.1
   offers debugging/TDD/verification workflows but adds broad process hooks;
   install only if you want that process. Check available marketplace versions,
   review scripts/hooks, and record the selected version before enabling them.
   Do not copy the Mac plugin cache or trusted-hook hashes. Reapprove reviewed
   hooks on Windows. External CLI orchestration is optional and requires each
   selected executor installed/authenticated separately.

For the custom ZIP, use its actual transferred location outside the repository.
Extract under Windows TEMP so personal skills cannot accidentally be committed:

```powershell
$skillArchive = Join-Path $HOME 'Downloads/ttt-codex-personal-skills-2026-11-01.zip'
$expectedSkillHash = '9e6be9041d65a8cc49d21aefe8799fcfb3a56cde29adef996e087b0a2755bbb0'
if ((Get-FileHash -Algorithm SHA256 $skillArchive).Hash -ne $expectedSkillHash) {
    throw 'Skill archive checksum mismatch'
}
$skillStaging = Join-Path ([IO.Path]::GetTempPath()) ('ttt-skills-' + [guid]::NewGuid())
Expand-Archive -LiteralPath $skillArchive -DestinationPath $skillStaging
New-Item -ItemType Directory -Force (Join-Path $HOME '.agents/skills')
$skillDestination = Join-Path $HOME '.agents/skills/search-first'
if (Test-Path -LiteralPath $skillDestination) { throw 'Review existing search-first before merging' }
Copy-Item -Recurse -LiteralPath (Join-Path $skillStaging 'search-first') -Destination $skillDestination
```

Use the same absent-target check for `simplify-codebase` and `context7-mcp`.
These instruction skills need no Python package installation. The optional
simplification visualization has its own Node lockfile and Playwright setup;
install those only if using it, following its bundled instructions. Do not run
its installation scripts as part of ordinary project setup.

The official [skill discovery guide](https://developers.openai.com/codex/skills)
documents repository `.agents/skills` and user `~/.agents/skills` discovery.
Do not install duplicate copies under both `.codex/skills` and `.agents/skills`.
App-managed built-ins should be obtained from the Windows app, not copied.

## 5. Verification checklist

- [ ] New terminal resolves Git, Node 22, npm, stable MSVC Rust, CMake, LLVM,
  Python, VS C++ tools/SDK; UCRT64 resolves its helper build tools.
- [ ] WebView2 works; Windows N media support installed before starting the app.
- [ ] `codex --version`, `codex login status`, `codex mcp list` succeed. In a
  new Codex session, ask Context7 to resolve Tauri and query Windows prerequisites;
  configuration presence alone is not a successful tool call.
- [ ] `codex plugin list` matches the optional plugins you actually chose.
  Check the app's plugin UI as well: account connectors and CLI MCP entries are
  separate surfaces. Reconnect GitHub or other needed accounts individually.
- [ ] Open a new session at the repository root. Ask: “List the instruction files
  you loaded and the available ttt-development skill; make no edits.” Confirm
  root `AGENTS.md` and `$ttt-development` appear. Check `$search-first` and
  `$simplify-codebase` only if personally restored. Restart if discovery is stale.
- [ ] `npm test`, `npm run build`, `npm run test:release` pass. For UI work run
  relevant browser scripts; for website work run `build:website`/`test:website`.
- [ ] Helper/model verification and the native command subset above pass.
  Full private-data tests run only after privately supplying expected recordings.
- [ ] `npm run tauri dev` opens the native app; import a disposable recording,
  inspect telemetry, attach supported video and verify persistence after reopen.
  Test dialogs/drop, DPI, Unicode/UNC paths and codec errors on actual Windows.
- [ ] Build NSIS; inspect the output and perform deliberate disposable-profile
  acceptance. Do not run the hosted-only install/runtime scripts locally.
- [ ] Keep macOS verification separate. On Apple Silicon provision
  helpers and weights, then use `npm run build:mac` and native tests there.

For debugging, keep the Developer PowerShell/Tauri terminal output, reproduce
with a focused Rust test (`-- --nocapture` when useful), and use WebView devtools
in development. Preserve profile data before persistence experiments. Never
disable media authorization or hosted-harness guards to make a test pass.

Use [Windows development CI](../windows-development.md) when remote Windows
evidence is needed. Dispatch only when requested; no release tag is necessary.
Motion/scene auto-sync remains Apple Silicon-only. A green browser demo or Mac
test run cannot establish native Windows parity.
