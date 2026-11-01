# Multi-recording video synchronization

Goal: locate independent recordings anywhere in one video, without assigning an order or forcing uncovered footage into a recording.

- [ ] Extract bounded compact full-video features once, with identity-validated reuse for verification. Analyze overlapping ≤599 s windows with global PTS/cut IDs.
- [ ] Deduplicate overlapping-window support and choose nonoverlapping recording spans with global alternative-schedule ambiguity checks. Bound spans by observed crossings; preserve gaps and repeated footage.
- [ ] Integrate full-video analysis, independent segment/recording evidence, existing session selection and unchanged manual mappings. Keep application disabled.
- [ ] Run synthetic ambiguity/pit/window/cancellation checks and the real full video with both XRKs, report independent evidence and unknown absolute error, and obtain read-only acceptance review.

Parent owns pipeline/service/UI/integration. Visual worker owns scan/cache/window extraction. Assignment worker owns interval scheduling and tests. No new dependencies, downloads, installer builds, or unrelated changes. Existing dirty work remains in place with pre-edit snapshots under /tmp/ttt-multirecording-baseline.
