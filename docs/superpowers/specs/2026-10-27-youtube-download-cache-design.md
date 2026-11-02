# YouTube download and local cache design

Status: approved by the user on 2026-10-27; implementation authorized.

## Intent and scope

Entering a supported YouTube URL in the desktop Video workspace downloads an authorized copy, reuses it across sessions and restarts, and plays it through the existing HTML video adapter. The installed macOS Apple Silicon and Windows x64 apps include their tools. Existing local imports, manual anchors, segment corrections and telemetry persistence continue working. OpenCV synchronization is outside this change; the cache exposes a local file and its actual playback timeline for a future analysis consumer.

The authorized end-to-end test video is `https://www.youtube.com/watch?v=TySa_fqgccc`, supplied by the user. Downloads use ordinary public video access. Authentication, cookies, DRM removal, access-control workarounds and private-video support are excluded.

## Approaches

1. **Bundle pinned standalone tools (recommended).** Official yt-dlp standalone executables bundle Python and EJS scripts. Bundle Deno for current YouTube support, plus FFmpeg and FFprobe. Build hosts provision and verify these inputs; the installed app runs only its packaged copies. This adds installer size and release maintenance but provides a self-contained, signable installation.
2. Download executable tools on first launch. This creates another executable update/trust path and makes the initial installation dependent on tool provisioning. It is not proposed.
3. Use system tools or retain the native IFrame player. System tools violate the installation requirement; the packaged native IFrame integration is already unavailable with error 153.

The bundled approach is the implementation proposal, pending approval. Defaults and technical choices below are builder proposals, not previously approved user preferences.

## Existing architecture and integration surface

- `src/video/model.ts` and `state.ts` hold YouTube identity, local references and manual segment mappings. Workspace JSON already persists video state for original and merged source sessions.
- `VideoWorkspace.tsx` owns source adapters and source replacement confirmation. Native downloaded YouTube footage will use `createHtmlPlayer`; the browser preview can retain its existing IFrame behavior.
- `src/bridge.ts` supplies native commands. `App.tsx` gates video navigation and binds the sync controller. The download must not replace a previous source until it succeeds or publish a late result into a different session.
- Rust `video.rs` validates and authorizes individual media files. `video_analysis` supplies native metadata and sampled frame presentation timestamps. Both will consume the final cached file.
- The telemetry `Library` serializes work behind a mutex. Network transfers and process supervision belong to a separate managed service, never that queue.
- Existing release workflows, macOS signing checks, Windows NSIS packaging, notices and artifact verification must include the tools. Current unrelated working-tree edits must be preserved.

## Backend service and trust boundaries

Add a focused Rust YouTube cache module and Tauri commands to start/resolve a download, query status, cancel, release a playback lease, inspect cache usage, change its limit and clean unused entries. Use the existing blocking-worker/status pattern, with short locks protecting job state. One download runs at a time; duplicate requests for a completed video reuse it, and conflicting requests return a clear busy state.

Validate URLs again in Rust: allow the same supported YouTube hosts and watch/share/shorts/embed forms as the frontend, require an eleven-character video ID, reject credentials, unsupported schemes, ports and malformed/ambiguous inputs, and reconstruct the canonical HTTPS watch URL. Pass arguments directly to `std::process::Command`; accept no executable path, output path, arbitrary URL, downloader options or shell text from the frontend.

Resolve executables only from verified development inputs or the installed app's own bundle. Disable user yt-dlp configuration, plugins, executable hooks, remote solver components and downloader updates. Supply absolute FFmpeg and Deno locations, bounded network retries/timeouts, a single-video format selector and a fixed app-owned output template. Do not import browser cookies or offer login. Keep ordinary TLS validation enabled. Private, age-restricted, geographic, DRM or authentication failures receive a useful unsupported/access message.

Read stdout and stderr concurrently, parse structured progress, and retain a bounded diagnostic tail. Report phase, downloaded/total bytes when known, bytes per second and ETA; unknown totals remain indeterminate. Sanitize control characters and avoid publishing stream URLs or credentials.

Cancellation owns all descendants: use a process group on macOS and a Windows Job Object with kill-on-close. Windows must assign a suspended child before it runs to close the child-spawn race. Cancel on explicit request and app exit, await process termination, then remove only the owned staging directory. UI/source/session changes cannot attach a stale result.

## Cache layout, integrity and ownership

Use `app_cache_dir()/youtube-v1/` for media, with entries derived solely from validated video IDs. Keep settings in app-local data storage. Hold an exclusive cross-process owner lock for the service lifetime; another TTT instance cannot download, publish or clean the same cache. A lock failure is recoverable and does not block telemetry or local video use.

Download into a unique staging directory under that same cache root. It contains all component streams, `.part` files and remux outputs. Reject symlinks and unexpected entry types; never follow metadata paths or delete user-selected files. On startup, the exclusive owner removes stale owned staging directories. An interrupted transfer is never a completed cache hit.

Before publication, require downloader success, a regular nonempty MP4, supported codecs, finite duration, native metadata/first-frame validation, and a SHA-256 content identity. Record schema version, video ID, canonical URL, byte length, hash, codec/timing metadata, tool versions and last use. Flush files and publish the complete entry directory with a same-filesystem atomic rename. A failed transfer or validation does not overwrite a completed valid entry.

Resolving a completed entry returns an authorized local path and acquires a backend lease. Player disposal releases the lease. Cleanup cannot remove leased files; a future analysis consumer must acquire the same lease. Protect references saved in original and merged workspaces, including the gap between completion and workspace save. Cleanup uses known root-derived entry paths only and excludes active staging and live consumers.

Proposed default limit: **10 GiB**, configurable in the Video workspace and persisted globally. Account for completed media and staging/merge growth. Reject an oversized single asset; reserve merge headroom, monitor actual growth and stop at the available budget. Evict least recently used completed entries that are neither referenced nor leased. If protected files fill the limit, report that condition and offer explicit cache removal controls; never silently destroy active footage. A user can explicitly remove an unleased referenced entry while retaining its URL and sync mappings for recovery. Disk-full and permission errors must remain actionable.

Cache hits verify the entry and media identity before use. Missing, malformed or corrupt entries are recoverable and never passed to playback. Preserve URL and mappings and offer redownload. Unknown future cache schemas are reported, not destructively rewritten.

## Media format and timestamps

Prefer available H.264 video and AAC audio in MP4, capped at 1080p as the proposed cache-size/playback default. Select compatible source streams and remux with stream copy; do not re-encode. If a compatible rendition is unavailable, fail clearly rather than attach a format the native player cannot use. Do not download live streams or unbounded broadcasts.

FFmpeg/FFprobe should be a minimal LGPL build from pinned upstream source, with the formats, protocols and H.264/AAC decoding needed for local merge/probe/validation, no GPL/nonfree components and no network protocols. The final MP4's actual presentation timeline is authoritative for both playback and future frame analysis. Record stream time base/start and duration; never derive frame PTS from nominal FPS or assume the original uploaded recording has a wall-clock timestamp.

Native frame sampling already preserves actual PTS. Validate the completed file through that interface and compare it with local player times/seeks in acceptance. A first-frame/probe check does not claim that every frame in a long video was decoded successfully.

## Frontend and persistence

Retain `type: 'youtube'`, canonical URL and video ID as the durable source identity. Add a validated optional cache identity (content hash and media metadata), not an arbitrary cache path. Rust derives the current local path by ID. Existing v1 source records without cache identity remain readable; future fields are bounded by the existing 64 KiB workspace limit.

Submitting a URL starts the backend operation and shows phase/progress/speed and Cancel. Existing attached footage stays intact until success. A successful new attachment stores the completed cache identity and uses the local adapter automatically. Replacing another source retains the existing explicit mapping-reset confirmation. Opening a saved downloaded source resolves the cache without network; a missing entry offers redownload while preserving mappings.

A YouTube ID can survive edits or yield different downloaded bytes. If recovery changes the stored media identity, retain the old anchors but disable synchronized playback until the user confirms that the mappings still apply. Never silently update the expected hash. Downloading does not calculate or change synchronization offsets.

Show cache usage, limit and safe removal controls in the Video workspace. Preserve local MP4/MOV selection, Locate, decoder errors, manual Sync Here, cut editing and timing nudges. Update `App`'s native YouTube compatibility gate to allow resolved local playback. Browser/demo tests must explicitly simulate native downloads; ordinary website demos remain unable to download.

## Tool provisioning, releases and maintenance

Use `bundle.externalBin` with the `aarch64-apple-darwin` and `x86_64-pc-windows-msvc` filename suffixes. The macOS bundle signs helpers along with the app; preserve and verify Deno's required JIT entitlements on that helper without adding them to the main application. Windows packages each helper beside the application, uses no console window, and verifies required files in NSIS/artifact checks. Packaging must fail when helpers, hashes or notices are absent.

Current research candidates: official yt-dlp `2026.10.26` (`yt-dlp_macos`, universal, about 35.7 MB; `yt-dlp.exe`, x64, about 22.5 MB), Deno `2.9.8` (compressed downloads about 37 MB macOS arm64 / 40.9 MB Windows x64), and FFmpeg `9.0.2`, upstream commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`. Exact unpacked/stripped sizes must be measured during provisioning. Verify release checksums and pin them in a manifest; do not invent a source hash that has not been fetched and verified.

Build-time preparation follows the existing managed model-input pattern. It downloads only fixed upstream artifacts, verifies hashes, extracts safely, verifies architecture/version and produces correctly named binaries. Build minimal FFmpeg/FFprobe natively with Apple clang and Windows MinGW through MSYS2. Include source versions/configure flags, license texts and corresponding source distribution/offer materials. Official yt-dlp standalone bundles are GPLv3+ combined works; its source project's Unlicense alone is insufficient. Deno and bundled third-party notices must also ship. Review final redistribution materials before release.

Update helpers through tested application releases and explicit manifest updates. Do not self-update executables inside a signed installed bundle. Surface tool version information in diagnostic errors so upstream breakages can be addressed by an app update.

Primary research: [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [EJS runtime requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS), [FFmpeg release/signatures](https://ffmpeg.org/download.html), [FFmpeg platform builds](https://ffmpeg.org/platform.html).

## Verification and acceptance

Backend tests cover URL rejection/canonical identity, cache hits without a subprocess/network, partial/corrupt entries, atomic publication, cross-process ownership, protected/leased cleanup, path/symlink escapes, quota/disk failures, bounded diagnostics, restart recovery and changed-identity confirmation. Controlled helper processes cover progress, cancellation before spawn/during download/during merge, failure, and no surviving descendants.

Frontend/bridge tests cover native URL submission, progress, cancellation, late session/source results, automatic local adapter selection, compatible v1 restore, missing cache recovery, changed-identity confirmation and preserved manual mappings. Browser integration exercises play/pause, seeks, download cancellation/retry and restart state using simulated IPC where native behavior is not available.

Run the authorized video through the real backend and packaged macOS app. Verify a second request is a cache hit, restart resolution is offline, player/decoder PTS and seek behavior agree, cancellation cleans partial files, and interrupted/failing transfers recover. Run existing frontend, Rust, release and applicable browser regressions. Build and inspect the Apple Silicon bundle and signing. Verify Windows compilation, installer/process-tree behavior and native playback only in an available Windows environment; otherwise document those checks as unverified. Do not present simulated IPC as native acceptance.

Report changed files, Rust/build dependencies, measured executable and installer sizes, exact checks/results and remaining platform gaps. No unrelated changes are committed or reverted as part of this work.

## Design review

An independent builder check found no important unanswered planning questions. Read-only architecture advice has been incorporated for cross-process ownership, playback/analysis leases, immutable atomic publication, changed-media identity, staging quota accounting, symlink-safe cleanup and full subprocess cancellation.
