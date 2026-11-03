# Ten Tenths premium UI explorations

Three disposable React prototypes; production source, Rust, manual video sync and telemetry calculations are unchanged. The Telemetry workspace is interactive. Other workspace tabs demonstrate navigation and explicitly disclose that their full flows remain in production. No imports, persistence or inference run here.

From the repository root:

```sh
npm ci
npx vite --config prototypes/premium-ui/vite.config.ts
```

Open [Race Control](http://127.0.0.1:4310/?direction=race), [Precision Lab](http://127.0.0.1:4310/?direction=lab), or [Hypercar](http://127.0.0.1:4310/?direction=cockpit). The study bar switches direction without losing comparison state.

Select a lap, choose its reference with +, select a corner in the map or list, hover a channel or use the position slider with arrow keys. Corner focus scopes both the plots and slider. Reset with the focus notice. Ctrl/Cmd K opens a keyboard-accessible workspace finder. Reduced-motion settings disable layout motion and numeric interpolation.

Data reuses `website/demo/data.ts`: all laps, GPS, sensors and section differences are representative synthetic values, never real driver evidence. Traces are precomputed and memoized; the slider/GPS update immediately. SVG rendering is for 601-point design exploration; retain production uPlot for real recordings.

```sh
npx tsc -p prototypes/premium-ui/tsconfig.json
npx vite build --config prototypes/premium-ui/vite.config.ts
node prototypes/premium-ui/scripts/verify.mjs
node prototypes/premium-ui/scripts/capture-baseline.mjs
```

The verifier uses installed Playwright Chromium. If needed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` privately to an installed Chromium executable. Captures and validation results go in `docs/ui-exploration/`. The prototype build goes in ignored `.tools/premium-ui-dist/`. Review the source/license record in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
