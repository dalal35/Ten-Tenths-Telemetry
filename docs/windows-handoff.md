# Windows development handoff

Reviewed 2026-11-01. Development source handoff only; native Windows acceptance
is still required. No push, tag, publication, or remote workflow dispatch was
performed.

## Commit organization and source completeness

The handoff separates native services/build tooling, frontend integration,
application design/validation documentation, and Codex instructions/examples.
Pull the complete sequence, rather than cherry-picking its documentation commit.
Existing modified and untracked application work is retained. Historical benchmark
reports remain historical evidence, not fresh Windows results.

The source includes the coach, YouTube cache, video-sync and motion modules;
their callers, IPC registrations, frontend/demo adapters and regression checks;
Cargo dependencies/lockfile; provisioning and packaging scripts; pinned model/tool
manifests; redistribution notices/licenses/signatures; and public media fixtures.
The npm dependency declarations match the existing lockfile. Both Windows
workflows inherit the installed Node/Python PATH inside the UCRT64 helper step;
a release-policy regression check covers that requirement.

A source-only export of the Git index, without local caches, weights, sidecars,
private recordings or node_modules, installed locked npm dependencies offline
with lifecycle scripts disabled and built both the app and website successfully.
Native generated inputs are deliberately provisioned on the target host, not
copied from this Mac or committed.

## Windows dependencies

- Node 22, Git, stable `x86_64-pc-windows-msvc` Rust, Visual Studio C++ tools and
  Windows SDK, CMake, LLVM/libclang, and Python.
- Evergreen WebView2; Windows N also needs Media Feature Pack.
- MSYS2 UCRT64 Make, diffutils, pkgconf and GCC for the pinned FFmpeg build.
  Cargo/Tauri uses MSVC in Developer PowerShell.
- Run `scripts/prepare-youtube-tools.mjs --download` on Windows to create the
  ignored target executables, receipt and source archives. Run
  `scripts/prepare-coach-model.mjs --download` before inference or packaging to
  provision the SHA-256-verified 806,058,240-byte model. All required manifests,
  terms and provisioners travel through Git. Downloads require network access.
- Personal Codex authentication, optional plugins and custom personal skills are
  separate setup. They are not application build dependencies.

Follow [the Windows setup checklist](codex/windows-setup.md) for commands and
[the Windows CI procedure](windows-development.md) for explicitly requested
remote verification. Do not run hosted-only install/runtime harnesses locally.

## Fresh verification

- Source-only export: 322 unit tests, 33 release tests, 8 YouTube provisioner
  tests, and app/website production builds passed. The working checkout's 360
  unit-test total additionally includes an ignored historical baseline test.
- Release policy/branding: 33 tests, including the Windows helper PATH check.
- Provisioners: 9 tests; local model/helper digest and resource verification;
  Apple Silicon helper smoke tests covering merge, VFR timestamps, decode,
  corrupt media rejection and Deno JIT.
- Browser: branding, sidebar, workflow, canvas, both video suites, workspace
  transitions, website, and wide/narrow visual inspection. One website rerun
  failed an unchanged motion-restoration timing assertion; an isolated rerun
  passed. Simulated IPC is not native Windows evidence.
- Whitespace checks pass outside the verbatim upstream yt-dlp license aggregate,
  whose existing trailing whitespace is preserved.

## Outstanding acceptance and limitations

The native test preflight and Rust subset were attempted on this Mac, but Tauri
build metadata still points at the checkout's former location. They failed before
tests ran. The old cache was preserved; CMake is also absent from this shell, so
a fresh native build has not been established here. Use a fresh, provisioned
target build directory on Windows; do not transfer `target/` from macOS.
The Apple Silicon OpenCV provisioner test also requires the previously downloaded
archive: it passed in the provisioned checkout and failed with a missing archive
in the deliberately cache-free export. Run the documented Mac provisioning step
before that Mac-only test; Windows skips it.

Windows helper compilation, MSVC build/tests, WebView2 runtime, inference,
unsigned per-user NSIS installation/upgrade, dialogs/drop, DPI, Unicode/UNC
paths and codec behavior remain unverified on the target OS. Private-recording
suites and fresh real-recording inference were not run during this handoff.
Motion/scene automatic video synchronization remains Apple Silicon-only;
installing OpenCV on Windows does not enable it. Coaching merged recordings is
unsupported; select an original recording.

Public release publication remains intentionally blocked by
`src-tauri/resources/youtube/redistribution.json` (`releaseReady: false`) until the yt-dlp
corresponding-source closure and Deno component notices are audited. This does
not prevent a local development build. Keep the publication guard intact.
