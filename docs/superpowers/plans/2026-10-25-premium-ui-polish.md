# Premium UI polish implementation plan

**Goal:** Refine Ten Tenths Telemetry's existing cyan/amber engineering interface with cohesive motion, readable controls and reliable small-window behavior.

**Architecture:** Reuse Motion already installed for shared navigation and coach reveals; use native Web Animations for interruptible surface settling and CSS for control feedback. Keep chart cursor feedback immediate. Avoid a second animation runtime where there is no coordinated timeline requiring it.

**Scope:** Frontend presentation and navigation only. Preserve existing uncommitted work and all native computation, persistence, inference and media synchronization.

- [x] Audit shell, explorer, chart toolbar, Advanced, Video, coach and dialogs; extend current styles rather than replace the design.
- [x] Add shared motion tokens and global reduced-motion policy; shared workspace selection and per-workspace scroll memory.
- [x] Refine responsive shared controls, bounded popovers/dialogs, chart inspection and secondary surfaces.
- [x] Refine coach progress and recommendation hierarchy; reveal existing cards with bounded motion, preserve evidence semantics.
- [x] Verify real rendered application at 600×500 through large desktop sizes, themes and reduced motion; exercise interrupted transitions, keyboard navigation and chart interaction.
- [x] Measure browser frame timing with real XRK-derived analysis, distinguishing replay/IPC fixtures from concurrent native inference and real video decoding.
- [x] Independent integrated review, affected regression checks and documented limitations. See `docs/ui-polish-verification.md`; 60/120 FPS is not certified by this host.

**Review focus:** State and scroll retention on rapid view changes; compact-window control clipping; reduced-motion transforms; dialog/drawer focus; animation-related analysis or chart reconstruction.

The user explicitly requested implementation without redundant approval gates. Work proceeds directly within that authorization. No release build or backend changes are required.
