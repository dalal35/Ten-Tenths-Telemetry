# Premium Video Workspace

**Goal:** Implement the user's Phase 6 brief directly on a branch from b4ec5b1.
**Architecture:** Keep VideoWorkspace's media lifecycle, authorization, cache leases,
manual alignment and persistence intact. Compose the cinema canvas, presentation-only
telemetry instruments and inspector around that stable player. Reuse Motion and tokens.

The brief supplies the design and authorizes implementation. A permanent side inspector
with responsive stacking is preferred to a modal workflow: alignment stays available
while viewing footage. Focus mode expands the same canvas without reparenting media.
No automatic synchronization, backend edits, new dependencies or invented channels.

- [x] Capture baseline desktop and 600×500 using the actual App with simulated IPC.
- [x] Add focused telemetry presentation tests for real series, gaps, stale lap context,
  missing data, position and delta. Run red, then implement using existing interpolation.
- [x] Redesign player chrome, source workflows, inspector and timeline. Preserve existing
  control names and behavior; add scoped shortcuts, focus mode and overlay toggles.
- [x] Verify stable media node/source through UI changes, resizing and navigation.
- [x] Exercise existing simulated video suites; real 0361/0362 diagnostics with genuine
  Chromium codec-fixture playback; light/dark/reduced-motion and 600×500 screenshots.
- [x] Check disk, run frontend tests, TypeScript/production build, review diff and commit.

Review focus: unknown duration; missing/changed media; ambiguous and out-of-lap mapping;
merged recording identities; unavailable channels and stale analysis; hidden retained
media on navigation; protected cache references; keyboard controls inside editable fields.

Native WebView2 playback, real onboard footage, OS dialogs, audio and codecs require
separate physical Windows acceptance. Browser IPC simulation cannot prove these.
