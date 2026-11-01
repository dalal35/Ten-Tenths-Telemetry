# Lap sequence synchronization implementation plan

Goal: implement the requested lap-sequence-first estimator within the existing candidate-only workspace.

Architecture: reuse authorized native decoding, compact recurrent visual landmarks and conservative cut brackets; match three or more consecutive XRK intervals per continuous clip, then refine only near the sequence offset with GPS/motion. Landmark phase is not independently calibrated trigger timing.

- [x] Add bounded visual extraction, cut/recurrence hypotheses and timestamp-preserving fine localization, with synthetic checks.
- [x] Add complete-lap sequence matching with skipped crossings, clip separation, competing hypotheses, invalid input and cancellation tests; compare the eleven approximate observations against both real recordings.
- [x] Integrate selected and competing imported recording evidence, retain manual segments and source/version protections, show sequence evidence and uncalibrated confidence without automatic application.
- [x] Reuse cached real footage for measured pipeline runs and negative intervals. Run focused native and existing frontend checks, obtain independent acceptance review, and append measured results and unresolved accuracy limits to verification.md.

Files: new video_sync/laps.rs, visual.rs and pipeline.rs; existing video_analysis/motion.{rs,cpp}, video_sync/{mod,service,matching}.rs, library.rs, bridge.ts and VideoWorkspace.tsx. No new dependency, downloads, installer build, or unrelated cleanup. Work in the existing dirty checkout because the prototype and required infrastructure are uncommitted; retain pre-edit snapshots in /tmp/video-sync-redesign-baseline.

Review focus: false landmark identity, missed/false cuts, equal lap sequences across recordings, incomplete/out/in continuity, missing GPS and unknown visual-to-trigger bias. Exact absolute error requires independent anchors not present in the retained evidence.
