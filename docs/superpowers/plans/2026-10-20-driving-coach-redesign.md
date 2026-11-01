# Driving coach evidence and target redesign

The driver needs actionable experiments for the fastest valid lap even when no faster complete lap proves a gain. Preserve offline Gemma packaging, cancellation, deterministic fallback, synchronized inspection, and existing platform paths. Existing uncommitted work is the baseline and must be preserved.

Implementation decisions:

- Keep spatial timing uncertainty and compatible boundary speeds as gates for numerical section gains and the stitched theoretical reference. Investigate their suppression on both local Purdue GP recordings rather than relaxing them until findings appear.
- Add distinct measured, likely, and investigate tiers. Supporting speed profiles can motivate entry/apex/exit tradeoff experiments below stopwatch resolution; fastest-only signal patterns remain qualified and unquantified. Calculated gear cannot establish mechanical shifts.
- Keep optional target state per recording separately from expensive analysis. Parse finite positive seconds or minute notation, persist/remove the selection, and derive the required, supported, and unexplained gaps without summing overlapping findings.
- Use only the compatible theoretical reference for recorded target support. Qualitative findings motivate experiments, never numerical budget allocations. A plausibility scale screen is a heuristic, explicitly disclosed, and cannot establish a route to an enormous target.
- Extend offline model output to bounded qualitative hypotheses, experiments, validation, and existing evidence references. Deterministic telemetry owns observations, numbers, gains, confidence, and target feasibility. Reject numerical claims and invalid references, and label causal interpretation as hypothetical.
- Show up to five prioritized insights, target strategy, experiments and uncertainty using existing styling; keep full evidence and section coverage expandable. Inspection continues to select the fastest lap and synchronize existing plots, GPS, and available video.

Verification: focused Rust coach tests (real recordings plus controlled synthetic cases), frontend unit tests and TypeScript build, browser workflow including target persistence/removal and no repeated analysis on target edits, and actual offline model quality comparisons on the available 1B and 4B quantizations. Obtain an independent read-only review of integrated behavior. Do not run full installer/platform pipelines for this change.
