# Premium driving debrief — Phase 5

Branch: `feature/ai-coach-premium`, created directly from `9169248`.

The production Coach now combines backend-ranked opportunities with a selected driving experiment, conditional gain visualization, measured GPS circuit selection, sampled actual/scenario speed inspection, per-section evidence and measured-versus-modeled section times. Individual measurements open their real telemetry interval and channel IDs. Existing inspection can still open mapped footage through its established navigation.

The Coach owns no new numerical estimates. Rust algorithms, model weights, inference, evidence validation, ranking, consent, cancellation and persistence contracts are unchanged. The selected experiment and independently reviewed section are explicitly identified when they differ. Missing brake/throttle sensors are disclosed; GPS speed alone never establishes a racing line. Recorded composite time uses compatible measured sections, while physics ranges remain conditional predictions.

## Verification

- 90 focused Vitest tests pass across Coach, workspace navigation/state, advanced integration and bridge contracts. New coverage includes missing/invalid profiles, selected intervals, unavailable evidence, and preventing GPS-speed/brake-pedal names from implying line/throttle support, and keeping premium controls out of the legacy profile.
- TypeScript and the production Vite build pass. In this Windows sandbox the default esbuild config loader cannot read an ancestor directory; `--configLoader runner` works. The existing Coach browser verifier now uses that loader too.
- Read-only cached native `coach_check` diagnostics were executed on both local 0361/0362 XRKs, without Cargo or a rebuild. Their report version is `coach-10-physics-coaching`, matching the current Rust source. Private payloads stay under ignored `.tools/coach-ui/`.
- The existing Coach workflow passes on both recordings: automatic fastest-lap target, original results, non-overlapping potential, evidence, mapped-video inspection, cancellation/queued retry, stale result ownership, consent and per-finding model provenance.
- The premium verifier passes on both recordings using the production entry and built production assets: ranked selections, measurement-to-channel navigation, sampled speeds, keyboard circuit/range controls, real section focus, retained selection/open evidence, unaccepted model settings, normal/reduced motion, dark/light themes and no document overflow at desktop and 600×500.
- Screenshots from production assets are generated locally as `0361-*` and `0362-*` under `.tools/coach-ui/`: desktop, detail, compact, compact-insight, compact-profile, light, corners and light-compact. They are not committed because they expose private session data.

To reproduce with a genuine cached diagnostic:

```powershell
$env:COACH_UI_DATA='.tools/coach-ui/0361.json' # repeat for 0362
npm run test:coach
npm run test:coach:premium
npx tsc -b
npx vite build --configLoader runner
$env:COACH_PRODUCTION='1'
npm run test:coach:premium
```

## Visual review

Direction: Data terminal, seed 1649751969, adapted to the established Race Control + Hypercar fonts and palette. The circuit-to-evidence relationship is the distinctive element; no new image assets, dependencies or invented demo metrics were introduced. shadcn and React Bits patterns were researched, with custom SVG and installed Motion preferred for the actual data. 21st MCP was unavailable.

The initial review found excessive repeated summary space, a tiny fixed-viewBox profile, and poor compact density. The final layout reduces the Coach-only session summary, makes the plot responsive, exposes the speed comparison beside the experiment on wide screens, and uses compact opportunity selection at 600×500. Light/dark evidence views, missing signals, active selection and keyboard focus remain legible. Rank order and monospace timing deliberately retain the production motorsport conventions; design-taste lint reports zero failures with those convention warnings.

## Limits

Browser tests simulate IPC using genuine native diagnostic results; they do not prove WebView2 behavior or execute Gemma inference. Native inference, packaging, full Rust suites, website builds and unrelated expensive tests were not rerun. Video, Library and marketing source interfaces were not redesigned. The production bundle still reports Vite's large-chunk warning. C: had about 49.6 GiB free before artifact generation; no user data or caches were deleted.
