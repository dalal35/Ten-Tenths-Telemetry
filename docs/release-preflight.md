# Release preflight and failure handling

Release owner checks this list against the exact commit to be tagged. A branch
build is validation only; publication requires a matching `v<version>` tag and
successful selected-platform jobs from that tag's workflow run. The default release scope is Windows only; set `RELEASE_PLATFORMS` to `macos` or `all` to resume those releases.

## Preflight checklist

- [ ] Review the commit diff and tracked/history paths for secrets, private XRK
  recordings, videos, datasets and unintended changes. Keep user data local.
- [ ] Confirm repository visibility is authorized. Publishing a release from a
  private repository does not make its downloads public. Making the repository
  public also exposes its existing history and releases.
- [ ] Use a new version consistent across npm package/lockfile, Cargo package/
  lockfile and Tauri metadata. Check remote tags/releases; never overwrite one.
- [ ] Confirm Ten Tenths Telemetry names/icons appear in each selected installer while
  retaining the existing bundle identifier, executable and library identity.
- [ ] Run relevant local regressions and obtain independent acceptance review.
  Resolve critical findings before tagging. Record physical-device gaps honestly.
- [ ] For a Windows or all-platform release, confirm the exact branch revision passes native Windows MSVC compilation,
  persistence/media tests, browser tests, x64 NSIS generation/extraction, and
  disposable hosted install/update/uninstall with app-data retention.
- [ ] For a macOS or all-platform release, confirm the release revision passes macOS regressions, arm64 app/DMG creation,
  signature/resource inspection and browser tests.
- [ ] Inspect all selected-platform artifact manifests: version, revision, workflow run, expected
  names, nonempty sizes and SHA-256. Never mix artifacts from different runs.
- [ ] Push a new version tag only after validation. Require all selected tagged platform
  jobs to pass again before the publisher can run.
- [ ] Verify the draft has the Windows `.exe` plus `SHA256SUMS` (and the macOS `.dmg` and app
  archive only for macOS or all-platform releases, with no `.exe` for macOS-only); verify uploaded names/sizes before publishing.
- [ ] After publication, download assets without authentication and compare their
  SHA-256 hashes to the validated manifests. Confirm the public release URL.

The Windows build uses Tauri's `--no-binary-patching`: this application ships
only NSIS on Windows and has no updater plugin requiring a per-format bundle
marker. This keeps the raw, embedded and installed executables byte-identical,
which the artifact inspector and installer smoke test enforce. The pinned CLI
supports this flag; keep macOS bundling unchanged.

## Safe failure handling

| Failure | Required response |
|---|---|
| Native build, test or artifact inspection fails | Do not publish. Diagnose the failed step, retain its logs, fix source and repeat affected tests and selected-platform validation. Do not skip required assertions. |
| Transient runner/download failure with unchanged source | Retry the failed job/run; require a complete, same-run artifact set before publication. |
| Required artifact missing, corrupted or from another revision/run | Stop publication. Rebuild/stage a consistent set; never substitute an older installer. |
| New source fix needed after a release tag was pushed | Preserve that tag. Increment the patch version and validate a new tag; do not force-move tags. |
| Draft creation finds an existing release or draft | Fail safely. Inspect it deliberately; do not automatically overwrite or clobber its assets. Use a new version, or explicitly resolve an unpublished failed draft after checking provenance. |
| Upload or completeness verification fails | Keep the release as a draft. Inspect partial uploads and logs; do not publish until the complete verified set exists. |
| Public download or checksum verification fails | Report the failure and stop distribution claims. Diagnose access/CDN/assets; do not replace an installer silently under an existing successful version. |
| Critical defect found after publication | Document the affected version and publish a separately versioned correction after validation. Preserve provenance and existing tags. |

The automated publisher creates a draft, uploads and verifies the complete set,
then publishes. Build jobs have read-only contents permissions; only the gated
publisher can write a release. Native hosted tests do not replace standard-user
Windows 10/11 installation, upgrade/uninstall data retention, real dialogs,
WebView2 playback, mixed-monitor DPI or long-recording acceptance.
