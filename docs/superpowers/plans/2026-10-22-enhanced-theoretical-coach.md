# Enhanced theoretical best and driving coach

The user authorizes implementation and verification of the supplied ten requirements without repeated approval gates. Existing uncommitted offline-coach work is the baseline.

Design: extend existing Rust telemetry/spatial analysis rather than add dependencies. Analyze the fastest valid lap and use other laps as supporting evidence. Deterministic code calculates all ranges and selects at most three compatible, distinct experiments. Gemma receives structured evidence and competing interpretations, can order that selected set and recommend experiments, and cannot generate numerical claims or promote inferred controls to measurements.

- [x] Inspect existing analysis, modeled scenarios, runtime, UI, diagnostics, and Purdue XRK fixtures.
- [x] Obtain read-only physics advice on scenario feasibility and boundary compatibility.
- [x] Add deterministic demonstrated/hypothesis gain ranges, compatibility selection, aggregate potential, and enhanced lap range. Test noise, gaps, endpoints, overlap and fastest-only scenarios against controlled and real recordings.
- [x] Replace manual target input with automatic fastest/enhanced/potential summary and at most three concise cards. Show gains prominently and preserve expandable evidence, cancellation, provenance and synchronized inspection.
- [x] Improve bounded Gemma interpretation using evidence and competing explanations. Verify numerical/control guards, cache/cancellation and actual offline inference.
- [x] Run focused Rust/frontend tests, TypeScript/Vite build, and real-XRK browser verification. Record actual local-model contribution and limitations.
- [x] Obtain independent read-only integrated acceptance review and address blocking findings.

Contracts: `Opportunity.gainRange` uses `lowerSeconds`, `upperSeconds`, `basis` (`demonstrated` or `hypothesis`), `assumption` and `method`. Report adds `primaryOpportunityIds`, `improvementPotential` with the same range shape, and `enhancedTheoreticalBest` with lap-time bounds. Traditional stitched theoretical best remains separate. Legacy optional target IPC arguments are ignored for compatibility. The complete budget considers all fixed disjoint sections independently of the three-card display limit, choosing one measured or modeled alternative per section, replacing a measured source only when the model dominates both bounds. Gains are never added to traditional sector support a second time.

Review focus: unmeasured driver inputs remain hypotheses; interpolation never bridges missing coverage; scenario start/end speeds preserve adjacent state; signed cross-lap losses are retained; report totals retain the complete section budget despite card/model reordering. No installer/package/platform pipeline changes are in scope.
