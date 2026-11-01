# YouTube Download and Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download authorized YouTube videos through bundled tools, cache them safely, and play them locally with existing manual synchronization.

**Architecture:** A Rust cache service owns jobs, immutable entries and consumer leases independently of telemetry library operations. YouTube identity stays in workspace state; the service resolves an authorized local file and verifies durable media identity. Native builds bundle pinned yt-dlp, Deno and minimal FFmpeg/FFprobe.

**Tech Stack:** Existing Rust/Tauri 2 and React/TypeScript; yt-dlp 2026.10.26, Deno 2.9.8, FFmpeg 9.0.2.

**Spec:** `docs/superpowers/specs/2026-10-27-youtube-download-cache-design.md`

## Global Constraints

- User approved design and implementation. Execute with native workers and parent integration; preserve all unrelated dirty files.
- macOS Apple Silicon and Windows x64; installed app requires no separately installed Python or media tools.
- Authorized public access only; no cookies, authentication, DRM or access-control workarounds.
- H.264/AAC MP4 up to 1080p, stream copy; configurable default 10 GiB budget includes staging.
- No OpenCV synchronization or automatic anchor estimation.
- Do not commit unrelated existing changes. Test all newly introduced contracts and run existing regressions.

## Review Focus

- Cancel during remux must terminate descendants before deleting partial files.
- Cleanup cannot evict a file between download completion, workspace save and player attachment.
- Missing/replaced media keeps manual mappings pending identity confirmation.
- Saved references in merged workspaces must protect the same cache entry as original sessions.
- Installed helpers must run from bundle paths, including Deno after macOS signing; development PATH success is insufficient.

## File ownership and interfaces

- Backend worker: `src-tauri/src/youtube/`, `src-tauri/tests/youtube.rs`, relevant Cargo dependency hunks.
- Frontend worker: `src/video/YouTubeDownload.tsx` (if useful), `VideoWorkspace.tsx`, `model.ts`, `state.ts`, `src/bridge.ts`, `src/App.tsx`, affected frontend and browser tests. Do not edit packaging or Rust.
- Packaging worker: tool manifests/notices, provisioning/build scripts, Tauri bundle config, release workflows, `.gitignore`, distribution documentation and packaging tests. Do not edit frontend or Rust service.
- Parent: `src-tauri/src/lib.rs`, `Library::youtube_video_ids()`, cross-component integration, verification and corrections.

Native command contracts (camelCase arguments/results):

- `download_youtube_video(url: string, jobId: string): Promise<YouTubeAsset>`.
- `resolve_cached_youtube_video(videoId: string): Promise<YouTubeAsset|null>` (acquires lease on hit).
- `youtube_download_status(jobId: string): Promise<YouTubeDownloadStatus|null>`.
- `cancel_youtube_download(jobId: string): Promise<void>`.
- `release_youtube_video(leaseId: string): Promise<void>`.
- `youtube_cache_status(): Promise<YouTubeCacheStatus>`.
- `set_youtube_cache_limit(limitBytes: number): Promise<YouTubeCacheStatus>`.
- `clean_youtube_cache(): Promise<YouTubeCacheStatus>` (unused entries only).
- `remove_youtube_cache_entry(videoId: string): Promise<YouTubeCacheStatus>` (reject leased; explicit UI action may remove saved references).

`YouTubeAsset`: `{videoId,url,path,size,modifiedMs,sha256,durationSeconds,trackStartSeconds,leaseId,cached}`. `YouTubeDownloadStatus`: `{jobId,videoId,phase,downloadedBytes,totalBytes,speedBytesPerSecond,etaSeconds,error}`; unknown numeric values/error are null. Phases are `preparing|downloading|merging|validating|complete|cancelled|error`. `YouTubeCacheStatus`: `{limitBytes,usedBytes,entries:[{videoId,url,size,lastUsedMs,referenced,inUse}]}`. Source `cache` identity is `{sha256,size,durationSeconds,trackStartSeconds}`; no persistent arbitrary cache path.

`YouTubeService::default()` is registered as Tauri state; `shutdown(&self)` cancels active jobs. Commands initialize app paths and bundled helpers lazily so missing tools never prevent telemetry startup. `Library::youtube_video_ids(&self) -> Vec<String>` supplies protected IDs from original/merged workspace sources through a short `task` operation.

### Task 1: Rust managed cache and subprocess supervision

- [x] Add focused tests for URL inputs, identity, entry validation, atomic publish/restart, leases/references, quota and cancellation failures; observe meaningful failures before implementation.
- [x] Implement service, root ownership lock, safe cache paths, status and tool process tree supervision, structured bounded progress, SHA256/native frame validation and Tauri commands with the contracts above.
- [x] Register service/commands and app-exit cancellation; add protected-reference extraction to Library and tests covering original and merged workspaces.
- [x] Run focused Rust tests and fix failure paths, including cancel-before-spawn, descendant cleanup and symlink rejection.

### Task 2: Reproducible bundled tools

- [x] Add manifest/provisioning tests for pinned hashes, target naming, safe extraction and missing/corrupt tools; observe failures.
- [x] Provision official standalone yt-dlp/Deno and build minimal LGPL FFmpeg/FFprobe from authenticated pinned source; record exact sizes/hashes, flags and source/license materials.
- [x] Configure externalBin, both native build workflows and artifact inspection; verify helper architectures, no system-tool reliance and macOS Deno entitlements.
- [x] Run packaging policy tests and actual macOS helper version/merge/probe checks.

### Task 3: Download UX and durable identity

- [x] Add frontend tests for source identity validation/restore, bridge commands, progress/cancel, stale results and recovery preserving segments; observe failures.
- [x] Integrate native download/resolve/local adapter and leases in VideoWorkspace; keep current source until success, confirm replacements/changed recovered identity, show errors/retry and cache controls.
- [x] Extend App native compatibility gate and source persistence without breaking v1 sources, local-video import or browser/demo behavior.
- [x] Run targeted unit/browser tests, then all frontend regressions and production build.

### Task 4: Integrated acceptance and review

- [x] Download the user-authorized video using the actual backend. Confirm a second request avoids network, resolve across process restart, cancel removes staging/descendants and failures can retry.
- [x] Build/sign the macOS app and exercise installed-helper download, local playback/seek, timestamps and restart persistence. Compare actual decoded PTS with playback timeline.
- [x] Run existing Rust, frontend, release and applicable browser regression suites; document private-fixture/environment gaps and Windows tests not available locally.
- [x] Obtain independent read-only acceptance review of stable integrated changes, fix blockers, rerun affected checks and report architecture/files/dependencies/sizes/remaining risks.

Self-review: every approved requirement maps to tasks 1–4. The five review-focus conditions are owned by Tasks 1, 3 and 4; bundled helper execution is additionally owned by Task 2. No additional design approval is required after the user's explicit approval to implement.

## Resume evidence and remaining release work

- Real black-video failure isolated and corrected by a final standard MP4 stream-copy remux with one-second interleaving; all compressed packet payloads and timestamps matched. Zero-dimension metadata now reports an error.
- Corrected full footage renders in the native workspace; manual alignment, mapped seeking and restart at paused 10 s verified.
- Latest affected checks: 360 frontend unit tests, video/App/sidebar browser checks, 17 focused Rust YouTube tests and one explicit managed-helper VFR test passed. Previous full Rust and remaining browser regression evidence is retained; unaffected checks were not repeated.
- Final app compiled once. Packaging revealed transient image detach and helper hardened-runtime library-validation problems; recover/re-sign/re-image the existing artifact rather than recompiling.
- Redistribution audit remains explicitly blocked for the standalone yt-dlp source closure and complete Deno notices. Windows runtime and Developer ID notarization are unavailable on this host. See `docs/youtube-download-cache-verification.md`.

## 2026-10-29 acceptance completion

- Recovered the interrupted archive from the existing corrected DMG; final staging, signatures, helpers, resources, archive integrity and manifest hashes passed. No compilation or re-imaging.
- Continued the retained YouTube partial from byte 539,408,772 using the final installed helpers; exact backend remux output is byte-identical to previously validated playback media.
- Two fresh final installed Rust processes resolved a deliberately prepared verification cache with identical identity and actual PTS [0, 1.001, 10.01], without network access. The lost Rust job itself did not publish; standalone tool continuation and cache fixture boundaries are explicit in the verification report.
- Existing unit, native, browser and packaging results were reused. No new product edits or OpenCV work.
- Publication remains blocked by the documented yt-dlp/Deno redistribution audit; Windows runtime and Developer ID/notarization remain unverified.
