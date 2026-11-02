# YouTube download/cache verification

Work continues from the approved 2026-10-27 design and implementation plan. Existing unrelated working-tree edits were preserved. The earlier baseline and diagnostic apps were stored in system temporary directories, which were cleared before the 2026-10-29 continuation; completed evidence and application artifacts under `.tools/youtube-acceptance/` remain available. No release has been published.

## Observed native backend behavior

- Authorized source: `https://www.youtube.com/watch?v=TySa_fqgccc` (supplied by the user).
- Real download completed through the Rust cache service and bundled helpers. Final H.264/AAC MP4: **1,867,985,613 bytes**, duration **2636.601179138322 s**, track start **0 s**.
- Content SHA-256: `5b6c9f8ad020f38ecffdbe2d3900f54bfdcd1690a7db2a738ebfd98c7a9695c7`.
- Native frame extraction returned actual presentation timestamps **0**, **1.001**, **10.01 s** for targets 0, 1 and 10 s. These are observed decoded PTS, not inferred from nominal frame rate.
- A fresh process resolved the completed cache with the same hash, duration and sampled PTS, without invoking the downloader.
- Progress bug reproduced in a real transfer. Missing output-template fields rendered bare `NA`, making the entire progress JSON invalid. The scalar template plus `--output-na-placeholder null` corrected it.
- A subsequent real transfer reported **1024 downloaded bytes**, **1,824,558,318 total video-stream bytes**, **179,143.57856100105 bytes/s**, and **10198 s ETA**, then successfully cancelled. Its disposable cache retained only the owner lock; no completed/partial media remained. Progress values are a momentary sample, not a throughput benchmark.

Raw test outputs are in ignored `.tools/youtube-acceptance/`. The source video and generated test files are not committed. Native decoding and the standalone downloader require execution outside this harness's sandbox; sandbox-only failures (`semctl: Operation not permitted` and AVFoundation `Cannot Decode`) were not treated as product failures.

## Checks so far

- Pre-feature frontend baseline: **29 files / 351 tests passed**.
- Backend cache/process/reference suite before review corrections: **13 tests passed**.
- Packaging worker: **8 packaging tests** and **28 existing release/policy tests passed**.
- Actual managed FFmpeg/FFprobe merge/decode smoke preserved VFR PTS **[2, 2.1, 2.4, 2.9]**, rejected corrupt MP4, and passed Deno JIT execution.
- Independent backend review identified Windows staged-file flushing, future-schema preservation, damaged-entry listing and changing saved-reference protection; correction and final regression evidence will be recorded below.

## Packaged inputs and release constraints

Apple Silicon input helper sizes, before application re-signing:

| Executable | Bytes |
| --- | ---: |
| yt-dlp 2026.10.26 | 37,466,304 |
| Deno 2.9.8 | 81,512,928 |
| Minimal LGPL FFmpeg 9.0.2 | 3,064,776 |
| FFprobe 9.0.2 | 2,904,472 |
| Total | 124,948,480 |

Pinned source archives add **55,095,816 bytes**. FFmpeg was built from authenticated upstream source with no GPL/nonfree components or network protocols. Helpers update through pinned application releases, not in-place self-updates.

Redistribution remains guarded by `resources/youtube/redistribution.json`: the exact corresponding-source closure for yt-dlp's official standalone GPL bundle and the complete Deno third-party notice inventory require audit before publication. Local development and build verification remain available; publication must not silently bypass this gate.

## Native black-video diagnosis and correction

This was a real playback failure, confirmed by the user, rather than a capture limitation. The original full download advanced its audio clock while WKWebView exposed **zero video dimensions, zero presented frames and black pixels**, even in a plain diagnostic player using the same backend, CSP and asset protocol.

The original local red/blue fixture rendered after its first video timestamp at 2 s. A 30-second stream-copy excerpt of the authorized footage also rendered immediately. A full conventional remux with the index at the end still failed. A full standard MP4 remux with **one-second interleaving**, stream copy and faststart rendered correctly. The video track index shrank from **2,282,488 to 775,404 bytes**; the complete MP4 index shrank from **3,191,739 to 1,245,207 bytes**. This isolates the failure to the original MP4 indexing/interleaving as delivered to WebKit. Tauri's 1,024,000-byte range cap is a plausible contributor, not a separately proven root cause.

The corrected full file showed real footage at 0 s, at a paused midpoint seek to **1318.300589569161 s**, near the end at **2517.9541260770975 s**, and after a reverse seek to 1 s. Duration remained **2636.601179138322 s**. Comparing every demuxed packet proved identical PTS, DTS, duration, size, flags and SHA-256 payloads for **158,038 video packets and 113,551 audio packets**. Evidence: `.tools/youtube-acceptance/compact-mp4-packet-comparison.json`.

The backend now performs a supervised final stream-copy remux for both separate-stream and progressive downloads. A cache playback profile prevents older incompatible files being reused silently. The HTML player rejects metadata that exposes no video dimensions, so an audio-only clock no longer masquerades as working video playback. No re-encoding, CSP relaxation or alternate media server was introduced.

## Regression evidence

- Existing Rust regressions: **241 passed** in the ordinary run, then all **7 native video-analysis tests passed** outside the sandbox (**248 total**). The sandbox's native decoder failures are documented in the retained logs. There are no Rust source doctest examples requiring a separate build.
- Frontend after the no-video-track guard: **360 unit tests passed**. The affected **video workspace, App video integration and sidebar browser checks passed** again after the guard and valid-video mock changes.
- Additional existing browser checks passed: **workflow, sidebar, plots, Advanced and canvas**. Their unchanged assertions ran serially using scratch-only watcher exclusions after Chokidar unnecessarily scanned large native build/cache trees. Production Vite configuration was not changed. Evidence: `.tools/youtube-acceptance/additional-regression-evidence.md`.
- Independent backend review corrections cover Windows write-capable file flushing, future-schema preservation, damaged-entry listing and live saved-reference protection. After the remux correction, **17 focused YouTube tests passed**, plus the explicitly run **managed-helper VFR/no-overwrite test**. The remux preserved decoded VFR PTS **[2, 2.1, 2.4, 2.9]** and packet PTS/DTS/durations.
- Independent frontend follow-up accepted the stale-state correction; no reachable defect was established for the questioned save barrier. New source commits read current state, preserving manual edits made during pending recovery.
- Independent targeted review accepted the final remux/profile and zero-dimension guard without blocking findings.

## Native workspace restart acceptance

The existing isolated verification app was reused to avoid recompiling an identical playback adapter. Its disposable cache was seeded with the full corrected, packet-verified media under an exclusive owner lock; the user library was not touched. Entering the authorized URL reused that cache and attached the local file. TTT visibly displayed the footage while paused at 0 s. **Sync Here** created the manual mapping, and the predicted lap-2 crossing sought to **video 10.00 s / telemetry 10.00 s** with visible footage.

After quitting and reopening that same isolated app, the cached footage, manual segment, lap selection and **paused 10.00 s position** returned automatically. The cache showed **referenced · in use**, the synchronization status returned **ready**, and the footage remained visibly rendered. No download was required during restart. This UI app predates the new error guard; the final guard is covered by the fresh unit/browser checks and final production build.

## Final packaging findings

The default Apple Silicon app compiled once after the fixes. Its signed image passed mounted signature verification, but a transient normal-detach failure left the completed image in the documented temporary directory. A later normal detach recovered the same image without rebuilding.

Installed-helper testing then caught a real signing defect: Tauri's hardened-runtime signing prevented the official standalone yt-dlp bootloader loading its embedded Python library with a different signing identity. The corrected signing script grants only yt-dlp the required library-validation exception, preserves the main app's entitlements exactly, retains Deno's separate JIT entitlement, and requires both helpers to execute successfully after signing. The corrected package passed those checks. Bounded normal-unmount retries handle transient busy volumes without forced detachment. The existing app was re-signed and re-imaged; Rust was not rebuilt again.

Final signed executable sizes:

| Executable | Bytes |
| --- | ---: |
| yt-dlp | 37,215,280 |
| Deno | 81,022,944 |
| FFmpeg | 3,047,104 |
| FFprobe | 2,887,728 |
| Helpers total | 124,173,056 |
| Main application | 24,416,848 |

Packaging regressions after the fixes: **32 release/policy tests and 8 YouTube packaging tests passed**, including transient-detach success, retry, unrelated failure and exhaustion. Independent review found no blocking issue with helper-only entitlements or mount cleanup.

The final signed backend also passed a live cancellation test: it reported **523,264 downloaded bytes**, **8,033,647.721221705 bytes/s**, then cancelled with no completed media or partial files left. Evidence: `final-packaged-cancel.json` and `.log`.

## 2026-10-29 continuation

The previous session ended externally before its last full download and artifact archive completed. The download retained a **539,408,772-byte** partial; it was not recorded as a completed cache entry. The corrected DMG remained intact. The interrupted archive was preserved, then the existing staging script successfully generated a complete archive and manifest from that same DMG, without compilation or re-imaging. Installed helpers, signatures, bundled notices/source hashes and VFR smoke checks passed on the mounted image.

Artifact sizes: DMG **934,845,814 bytes**; app archive **925,754,397 bytes**. The final manifest is under `.tools/youtube-acceptance/final-artifacts/macos/manifest.json`.

The partial transfer was safely continued with the exact signed helpers extracted from the final DMG. It resumed at **539,408,772 bytes**, rather than restarting; a separate copy of the partial was preserved. The completed download received the backend's exact stream-copy remux arguments. Its **1,866,039,081-byte** output has SHA-256 **`9efd8d26a050c4278acac3fb233714e040b559555a64cb65216171e940f523ee`**, byte-for-byte identical to the file already verified for visible native playback, manual synchronization, beginning/midpoint/end seeks and every packet's timestamps/payloads. Repeating those checks would add no evidence. FFprobe confirmed H.264/AAC, original timebases, zero start times and unchanged durations. Evidence: `resumed-packaged-completion.json`, `resumed-packaged-probe.json` and the retained commands/logs.

The interrupted Rust job itself **did not finish or publish a cache entry**. Continuation ran outside that lost job, using its packaged tools; this is not claimed as a completed uninterrupted Rust transaction. A clearly labeled, separate verification cache was prepared from the completed media. **Two fresh processes of the final installed Rust executable** resolved that fixture successfully, returned `cached: true`, verified the same content identity, and extracted actual frame PTS **[0, 1.001, 10.01]** without network access. Evidence: `final-resolve-fixture.json`, `final-installed-resolve.json` and `final-installed-resolve-restart.json`. The original automatic Rust download/publish path, cancellation and cache behavior retain their earlier live and regression evidence.

Final staging completed with exit 0. Archive gzip integrity passed and both delivered artifact hashes matched the manifest:

- DMG: `b367ccd420dab560124edac642913849b8ee948f6789327f23209ef36d39bc4e`.
- App archive: `cc3fc40bad26d44672e7335a8f8fe920616d7cc855ff4894ac1f2c5eb1daee08`.

No additional product changes, recompilation, repeated full download, or repetition of completed regression suites was needed on 2026-10-29. Interrupted staging outputs and the partial backup were preserved. No test disk image remains mounted.

## Remaining release blockers and verification limits

- Publication is deliberately blocked pending the exact corresponding-source closure audit for the official yt-dlp standalone bundle and the complete Deno dependency-notice inventory. The publisher guard still rejects release; this was checked again on 2026-10-29.
- The macOS package uses ad-hoc signing. Developer ID signing, notarization and Gatekeeper acceptance were not verified without release credentials.
- Windows x64 provisioning/build configuration is implemented, but Windows helper execution, process-tree cancellation, installation, playback and executable sizes require a native Windows environment and remain unverified.
- No uninterrupted final Rust download transaction was repeated after the host interrupted its last job; the retained partial was continued and the resulting media/current Rust cache resolution were verified separately as described above.
- OpenCV synchronization has not been implemented.
