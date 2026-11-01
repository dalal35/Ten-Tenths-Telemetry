# Automatic video-to-telemetry synchronization prototype — design

## Goal and constraints

Estimate an offset between locally available onboard video and real AiM XRK
telemetry, offline on macOS Apple Silicon. Show evidence and ambiguity, and
apply a segment only when a match is reliable. Preserve manual synchronization,
existing mappings, source authorization, cached-video leases and workspace
persistence. Do not invent accuracy measurements. Windows should have a clear
implementation path; native Windows behavior requires separate verification.

## Packaging choice

Use the user's selected option: a minimal bundled OpenCV library called by the Rust
backend. It keeps frame buffers in-process and reuses the existing timestamped
native decoder, but adds native build, licensing and signing work. An alternative
is a bundled OpenCV analysis executable; this isolates dependencies but adds
frame transport, process supervision and another packaged executable. The
packaging must include its license, reproducible provisioning and signing, with
no separately installed runtime. The executable option was not selected.

## Proposed analysis

Reuse the cancellable native video sampler, with actual presentation timestamps,
bounded grayscale frames and no pixel IPC. Use OpenCV feature tracking and
robust motion estimation to form a quality-weighted, smoothed visual turning
signal; discard tracking failures, large temporal gaps and stationary or
vibration-dominated intervals. Derive smoothed GPS heading, yaw rate, curvature,
speed and longitudinal acceleration from validated telemetry, respecting fix
quality and gaps and reusing existing spatial validity checks. Treat camera motion
as a proxy, not direct vehicle yaw; camera orientation can reverse its sign.
Speed and acceleration provide quality/context checks unless a defensible visual
counterpart is established; do not count them as independent corroboration.

Search offsets and both motion-sign hypotheses coarsely on a common time grid,
refine distinct peaks, and verify
at least three separated corner windows. Compare competing offsets across the
entire search range and both signs, including offsets one or more laps apart. Reject insufficient
motion, weak overlap, inconsistent corner evidence and close competing peaks.
Report supporting windows, alternative candidates and a clearly labeled
heuristic uncertainty, not an uncalibrated statistical confidence interval.

Only apply a result through the existing validated segment model if empirical
tests establish a conservative reliability threshold. Until that evidence exists,
show candidates without automatic application. Never silently replace an existing
manual segment, apply stale results after source/session/content or segment
revision changes, or infer that an edited video has a single mapping across cuts.
Limit an applied segment to an analyzed interval supported by evidence on each
side and adequate cut coverage; a failure to detect a cut alone does not establish
continuity. Require a valid lap anchor and nonoverlap. If safe boundaries cannot
be established, present the candidate without applying.
Retain manual sync throughout.

Resolve the local source through existing backend authorization or a held cache
lease rather than trusting an arbitrary frontend path; retain the lease until the
background task has stopped. Bound interval, memory and concurrency, expose
progress and cancellation, and report decoding, unsupported-platform and
insufficient-evidence errors without disturbing existing mappings.

## Validation and open evidence

Test timestamps, gaps, corner agreement, repeated-lap ties, vibration, stationary
footage, cancellation, stale results and preservation of manual mappings. Measure
processing time and actual offset error against independent, manually verified
anchors in matching footage and XRK recordings; report failures and uncertainty.
The user confirms that the cached authorized YouTube footage includes laps from
the two Purdue GP XRKs and is cut at pit stops. The previous 10-second alignment
used synthetic telemetry and is not ground truth. Independently verified anchors
are still needed for measured error and threshold calibration. Use held-out
windows and negative/near-tie cases; one camera and session cannot demonstrate
general reliability. Candidate-only behavior without validated thresholds is an
explicit limitation, not completion of automatic application.

## Non-goals

No cloud processing, user-installed Python, unrelated workspace changes, or
claims of verified Windows performance. Frame-level accuracy and reliable
alignment across arbitrary edited cuts are not assumed.
