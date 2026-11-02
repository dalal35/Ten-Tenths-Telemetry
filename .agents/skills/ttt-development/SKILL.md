---
name: ttt-development
description: Use when developing, debugging, testing or building Ten Tenths Telemetry desktop code or its browser demo, especially across Windows and macOS. Excludes unrelated personal Codex setup and document creation.
---

Read the repository root `AGENTS.md` for architecture, invariants and commands.
For machine setup, use `docs/codex/windows-setup.md`. Resolve these paths from
the repository root, not the skill directory.

Before editing, trace the request through its existing owner and callers. Check
the working tree and preserve unrelated work. For IPC changes, inspect all four
surfaces: registered Rust commands and Serde types, `src/bridge.ts`/frontend
types, simulated browser tests, and `website/demo/` substitutions. For persisted
changes, inspect existing compatibility tests and recovery behavior first.

Choose verification by the behavior changed:

| Change | Relevant proof |
| --- | --- |
| Frontend/state | Affected Vitest tests plus `npm run build`; relevant browser verifier and visual inspection for UI changes. |
| Telemetry/physics | Focused Rust tests and applicable existing examples; inspect fixture requirements before executing. Keep deterministic evidence separate from model hypotheses. |
| Video decoder | `verify-native-video-tests.mjs` plus `video_analysis` tests on the target OS. Simulated browser playback cannot prove native decoder behavior. |
| Offline model | Deterministic tests first; provision verified weights only for inference/packaging checks. Report CPU/GPU and measured results, not assumed acceleration. |
| Installer/helpers | Target-OS build and helper/release checks; use the existing hosted Windows workflow for its disposable runtime/install tests. |
| Website/demo | `npm run build:website` and `npm run test:website`; do not equate synthetic demo results with native coverage. |

Windows uses MSVC for the app and Media Foundation for decoding. Apple Silicon
uses AVFoundation. Automatic motion/scene matching lives on
`feature/auto-video-sync`; manual synchronization does not require OpenCV.

Reuse existing implementations and dependencies. Keep source authorization,
recording integrity, calibration, uncertainty, cancellation and persistence
recovery intact. Run the smallest meaningful affected checks and state missing
fixtures, unsupported platforms and untested native behavior in the handoff.
