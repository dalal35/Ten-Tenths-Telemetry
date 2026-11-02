# Desktop visual and motion overhaul

The user's implementation brief is the specification and authorization to proceed. Work in the current checkout, preserving the four unrelated Windows video changes. Do not change numerical analysis, IPC, persisted formats, playback clocks, or release behavior.

## Audit and design

The app already has Motion 14, shared selection indicators, interruptible View Transitions, stable mounted charts/video, reduced-motion configuration, and saved workspace scroll positions. Preserve those strengths. Current weaknesses include 7–10px labels, scattered hardcoded visual values, a large marketing-style empty state, saturated chrome, selection flashes, and entrance-only floating surfaces.

The concept is a pit-wall instrument: the Ten Tenths mark, time-column alignment, cyan primary/amber comparison traces, and precise lap readouts supply its identity. Neutral graphite chrome frames a slightly brighter analysis sheet. IBM Plex Sans is the interface face; IBM Plex Mono is for measured values. Bundle fonts locally. Use deliberate 4/8px spacing, 11px minimum secondary text, small control corners, and neutral navigation. Light mode uses the same hierarchy.

The taste-skill app draw produced the framed-sheet direction. Adapt its frame to this product's established dark/light palette, its existing multi-channel chart layout, and its desktop window constraints. Do not replace real telemetry with the draw's generic analytics examples. Use one sheet, not nested generic cards.

Motion identity: immediate feedback, restrained spring settling, zero decorative idle motion. Keep live charts/video untransformed. Shared selections use the existing Motion layout infrastructure. Floaters use short, interruptible entries and faster exits. Native sliders update without interpolation. Chart cursors and telemetry values remain immediate. Reduced motion removes spatial animation.

Installed and read: taste-skill, anthropics frontend-design, transitions-dev, transitions-polish, LottieFiles motion-design, motionmaxxing. Read the awesome-agent-motion-skills reference index without installing it. Motionmaxxing currently targets films: apply its staging, continuity, pacing, and honest frame-review principles to the requested second pass; do not install GSAP or create a film.

## Implementation steps

- [x] Capture baseline production React screens with the existing controlled IPC fixture.
- [x] Establish shared design tokens, bundled typography, shell composition, legible hierarchy, and consistent controls across Telemetry, Advanced, Video, Coach, dialogs, and empty/error states.
- [x] Extend the existing motion owner with reusable surface presence, tuned selections, native CSS spring feedback, and complete reduced-motion behavior. Add focused regression checks for behavioral changes.
- [x] Apply the motionmaxxing second pass: review mid-animation frames, interrupted input, over-animation, idle work, and entry/exit asymmetry.
- [x] Run unit tests, production build, affected browser suites, transition/profile audit, screenshots at multiple sizes/themes, and native desktop checks with real recordings/media where available.
- [x] Record measured performance and clearly distinguish native playback/recording evidence from simulated browser evidence. Do not claim 120 FPS on a 60 Hz machine.

## Review focus

Rapid repeated navigation must end on the latest requested view. Switching views must preserve primary/comparison laps, zoom, channels, coach work, video attachments and paused playback position. Resizing must cancel stale transitions without moving chart coordinates. Exiting surfaces must release focus/pointer interception immediately. Reduced motion must apply to shared layout, CSS, WAAPI, and presence effects. Long names and narrow windows must retain usable controls without horizontal overflow.

## Verification record

Implemented and verified. See [the validation record](../../desktop-design-validation.md)
for actual native measurements, passing checks, review fixes and explicit limits.
Screenshots and profiler artifacts are under ignored test-results/; personal skill
installations remain outside Git.
