# Managed YouTube toolchain

The desktop app bundles pinned tools for macOS Apple Silicon and Windows x64.
Only build hosts need Node, Python (archive extraction), native C tools and network
access. Users install no Python, yt-dlp, Deno, FFmpeg or FFprobe separately. Runtime
code resolves helpers beside the installed app executable; no PATH fallback is used.

## Build and checks

```sh
npm run prepare:youtube
npm run test:youtube-tools
npm run build:mac
```

macOS builds use Apple clang. Windows native CI installs MSYS2 UCRT64 GCC, Make,
diffutils and pkgconf, and invokes provisioning from the MSYS2 shell before Rust
compilation or packaging. Run the same `prepare:youtube` command from that shell
locally, then `npm run build:windows`. Installed helpers remain ordinary native
Windows executables, with static FFmpeg runtime linking; no MSYS2 runtime ships.

Provisioning verifies exact SHA-256 inputs, rejects unsafe archive entries, builds
the narrow FFmpeg source, atomically replaces helper files using fresh inodes, and
writes `src-tauri/binaries/toolchain-<target>.json`. The ordinary build hook only
verifies the prepared files and notices; it never downloads tools. Changing the
pinned manifest requires explicit reprovisioning. Binaries and corresponding-source
archives are ignored release inputs; no user videos are part of this toolchain.

FFmpeg supports local H.264/AAC stream-copy operations, not video re-encoding or
network access. Actual final MP4 presentation timestamps are authoritative.
The smoke check uses original CC0 fixtures already in this repository, merges
H.264/AAC, verifies exact decoded VFR timestamps `[2,2.1,2.4,2.9]`, decodes video,
rejects a corrupt MP4 and executes Deno. It exercises packaged helpers during
artifact staging as well as development helpers during provisioning.

## Pins and measured macOS sizes

Versions and all download hashes are in
`src-tauri/resources/youtube/manifest.json`. The authenticated FFmpeg source release
is 9.0.2, commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`, SHA-256
`8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`.

| Executable | Local arm64 build bytes |
| --- | ---: |
| yt-dlp 2026.10.26 (official universal) | 37,466,304 |
| Deno 2.9.8 | 81,512,928 |
| FFmpeg 9.0.2 | 3,064,776 |
| FFprobe 9.0.2 | 2,904,472 |
| Total | 124,948,480 |

These are unsigned-input sizes before Tauri re-signing; installer compression and
the included source archives change the distribution size. Windows executable
sizes are recorded by native CI and are not inferred from macOS. FFmpeg links only
operating system libraries on macOS. Windows native CI must establish the same
absence of extra DLL dependencies.

## Signing and updates

`bundle.externalBin` places all four tools beside the executable. The macOS build
wrapper copies the intermediate Tauri app to a clean system temporary directory,
restores Deno's upstream JIT/runtime entitlements on that helper, then seals the app
again and checks that the main app's entitlements did not change. The yt-dlp helper
alone receives the library-validation exception needed to load its upstream-signed
embedded Python libraries after the outer executable is re-signed. Both signed
yt-dlp and Deno must execute before creating the DMG. Release staging inspects the final mounted DMG and
creates the app archive from it; the raw Tauri target app remains intermediate.
This avoids macOS File Provider injecting Finder metadata while signing in a
Documents workspace. The
main application is not granted Deno's permissions. Ad-hoc signing is the current
repository default; Developer ID signing and notarization require release
credentials. Notarize the final app/DMG **after** this signing pass, not an earlier
Tauri intermediate app. Do not publish a stale notarization ticket after re-signing.
Disk-image cleanup retries normal detach up to three times for transient resource
contention; it never forces unmounting. Persistent failures retain the mounted
image and temporary files for recovery instead of rebuilding or deleting them.

Update tools through reviewed manifest changes and tested application releases.
Do not run yt-dlp `-U` or Deno `upgrade` in an installed bundle. Upstream changes
can break extraction; diagnostics should include the recorded tool versions.

## Redistribution status

FFmpeg's exact authenticated source archive, LGPL license and build recipe ship
with the app. Top-level pinned yt-dlp and Deno source archives and license files
also ship. However, the official yt-dlp one-file releases do not supply a
complete, audited source closure for their bundled platform-specific components;
their source tarball omits the standalone build and dependency source closure.
The upstream aggregate notice includes GPL/LGPL dependencies such as mutagen and
Readline in addition to permissive components. Deno's full bundled-component
notice inventory also remains to be assembled and audited.

`redistribution.json` names these unresolved items. Both the actual publisher CLI
and its workflow check `scripts/check-youtube-redistribution.mjs`, which refuses
publication until that record is complete. Local builds, validation jobs and
artifact inspection remain available. No source-offer promise is created, and a
link to upstream is not treated as fulfilment. No publication is authorized by
the implementation task.

Next distribution work: obtain the exact corresponding source/build inputs for
the pinned official standalone packages (including their bundled libraries),
assemble matching license notices, include those materials with the distribution,
audit them, and update the redistribution record in a reviewed change.
