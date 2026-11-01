# Codex environment audit

Snapshot: 2026-11-01. Inspected the repository file inventory, entrypoints,
frontend/backend contracts, telemetry/coach/video implementations, build scripts,
tests, CI, existing platform docs, global instructions, sanitized config keys,
skill directories and plugin manifests/hooks. This is an environment/architecture
audit, not a line-by-line correctness or security audit of every source file.
Credentials, history, session databases, OAuth stores and private recordings were
not read. No global installation or configuration mutation was performed.

## Instruction and configuration findings

| Surface | Observed | Portable action |
| --- | --- | --- |
| Global `AGENTS.md` | Only the Context7 lookup policy supplied in this session. No global override found. | Preserve policy in the personal example and shared root instructions. |
| Ancestors/repository | No ancestor or repository AGENTS/override files found before this change; no project `.codex` or `.agents` configuration. | New root `AGENTS.md` and one discoverable project skill. |
| Defaults | Model `gpt-6.1-sol`, medium reasoning, pragmatic personality, optional service-tier preference. | Select an account-available model; carry reasoning/style selectively. |
| Permissions | No explicit global approval/sandbox keys found; this session has managed permissions. Several Mac project paths are trusted. | Use Windows client sandbox setup; trust the actual checkout independently. No blanket full-access migration. |
| Features | `js_repl = false`. | Leave client defaults unless that behavior is specifically needed. |
| Notifications/UI | A local notify command, desktop fonts/layout/editor preferences, UI onboarding state. | Recreate desired UI preferences in Windows; do not copy command paths/state. |
| Hooks | Trusted Orchestrator and Ponytail hook state. | Reinstall reviewed plugin, then authorize its Windows hooks independently. Never copy trust hashes. |
| Marketplace roots | OpenAI bundled/runtime sources are local Mac app/cache directories. Four other sources are Git repositories (below). | Obtain bundled plugins from the Windows client; use reviewed Git sources for optional plugins. |
| App permissions | Connector-specific tool approval preferences. | Review/reconnect separately; do not transfer connector IDs or relaxed approval rules. |

Audited CLI/tool versions: Codex CLI 0.162.1, Node 20.18.0, npm 10.8.2,
Rust/Cargo 1.99.0. `cmake` was absent from this shell's PATH, although local
build caches exist; cached outputs do not establish clean-host readiness. CI
uses Node 22/stable Rust. Mac-local toolchain exports in README are optional
historical setup, not paths to recreate on Windows.

## MCP and account integrations

| Configured MCP | Finding | Windows decision |
| --- | --- | --- |
| `context7` | `npx` stdio server with credential-bearing args (value deliberately omitted). Both connected and local Context7 tools are visible in this session. | Prefer one connected plugin or clean hosted transport with private environment authentication. Do not copy args. |
| `node_repl` | Mac ChatGPT app binary and app-managed environment/service paths. | Let Windows client provide supported tools. Do not port app internals or synthesize their configuration. |
| `computer-use` | Disabled Mac `.app` executable. | Omit; select supported Windows tooling only if needed. |
| `robinhood` | Enabled remote account MCP at `agent.robinhood.com`. | Unrelated to telemetry development; omit. |

This session also exposes account/app tools for GitHub, Context7, Firecrawl,
Google Drive/Gmail/Calendar/Contacts, Canva, Caliber, LinkedIn, SciSpace, Spotify,
Sites, creative production, data analytics, pets, writing style, plugin management,
document control and app safety utilities. Availability is not proof of granted
account scopes, and it is not all encoded in local `mcp_servers`. GitHub is useful
for project/CI work; Context7 for documentation; browser tools for UI validation.
Other connectors are optional task-specific integrations. Reauthenticate only
those actually needed; none is required by the app's embedded coach.

## Skills and plugin selection

The complete disk inventory is [skill-inventory.md](skill-inventory.md). It
distinguishes user skills from cached plugin versions. Cached files, enabled
config entries, and tools exposed to a session are different evidence.

| Skills/plugins | Relevance and dependencies |
| --- | --- |
| `ttt-development` (new, repository) | Shared architecture/validation routing; Markdown only; works after Git pull. |
| Custom `search-first` | Useful reuse-first policy. Exact personal snapshot exported with licenses and UI metadata; no executable dependency. |
| Custom `simplify-codebase` | Useful for explicit simplification audits/changes, not every edit. Full references/renderer preserved privately. Optional visualization uses its own Node/Playwright dependencies; no need to install for text audits. |
| `context7-mcp` | User instruction skill, no binary. Requires separately configured live Context7 tool. |
| `find-skills` | Discovery helper; optional. Lock metadata names `vercel-labs/skills`, upstream path `skills/find-skills/SKILL.md` and a folder hash, not a verified immutable Git commit. Don't treat that hash as an install ref. |
| Ponytail 5.3.3 | Useful small-change preference and reviews/audits. Node hooks present; review/test Windows activation. Its cached root and `skills/` contain duplicate skill names. Install once. |
| Codex Orchestrator 0.4.1 | Optional native delegation workflow. Has Windows PowerShell hook commands; Unix hooks use Python/sh. Windows execution not verified in this audit. |
| code-simplifier 0.2.1 | Optional cleanup of recent changes; retain behavior and run affected checks. |
| Agent Orchestrator 0.7.1 | Optional external CLI teams; each executor, shell/runtime and authentication needs separate Windows setup. Not a prerequisite. |
| Superpowers 7.0.1 | Debugging, TDD, review, planning and verification useful when wanted. Broad automatic process instructions can add planning/approval/delegation overhead; install deliberately, not solely to match cache contents. |
| Built-in OpenAI docs, skill creator/installer, review, image generation | Obtain supported versions from Codex. Image generation is optional; no need to copy built-in `.system` files. |
| Firecrawl read-docs/design/SEO; browser/visualize | Optional docs or website work. Context7 remains preferred for library docs; app browser runtime is platform managed. |
| Documents/PDF/Sheets/Slides/templates, data, creative, Sites | Optional artifact workflows; not dependencies of this repository. Native rendering/package requirements must be evaluated separately when used. |
| Music/fitness/finance/contacts/mail/pets and prospecting skills | Personal or unrelated workflows; omit from the development migration. |

Explicitly enabled local plugin entries were: `codex-app-tools`, `visualize`,
`documents`, `pdf`, `spreadsheets`, `presentations`, `template-creator`,
`code-simplifier`, `agent-orchestrator`, `codex-orchestrator`, `browser`,
`unified-computer-use`, `computer-use`, `ponytail`. Other cached/connected plugins
are listed in the inventory or account integration section; their presence is
not a reason to enable them on Windows.

Observed optional marketplace sources (source identity, not an endorsement or
instruction to install the latest remote code):

| Marketplace | Source | Audited plugin version |
| --- | --- | --- |
| ponytail | `https://github.com/DietrichGebert/ponytail.git` | 5.3.3 |
| codex-orchestrator | `https://github.com/guilhem/codex-orchestrator.git` | 0.4.1 |
| codex-simplify | `https://github.com/ukint-vs/codex-simplify.git` | 0.2.1 |
| agent-orchestrator | `https://github.com/Augani/agent-orchestrator.git` | 0.7.1 |

For reproducible optional installation, obtain and review an immutable commit
containing the desired version first. The Mac config did not pin those Git
sources to commits, so it cannot supply that missing guarantee. With the reviewed
commit substituted, CLI 0.162.1 supports:

```powershell
codex plugin marketplace add https://github.com/DietrichGebert/ponytail.git --ref REVIEWED_COMMIT
codex plugin list
codex plugin add ponytail@ponytail
```

Repeat only for selected sources using their own reviewed commit/marketplace
name, or use the client plugin UI. Check the installed client's `--help` if its
commands differ. Do not substitute `main` for a missing pin and claim exact
reproducibility. The custom skill ZIP is an exact snapshot with a recorded hash;
marketplace/account availability remains a separate Windows setup step.

## Deliberately not migrated

Do not copy `auth.json`, OAuth/keychain data, `.codex-global-state.json`,
session/history/log SQLite databases, shell snapshots, memories, cached browser
profiles, `.hook-trust`, hook trust state, sandbox secrets, automation runtime
state, app IPC/service paths, signing secrets, or `.env` files. Personal custom
skills are separate from Git; their private export includes supporting files and
licenses rather than only `SKILL.md`. No whole-home config export was made.

The working tree already contained extensive modified/untracked app work. This
audit documents that current code without committing or staging it. A Windows
pull receives only committed files: ensure the corresponding application changes
are included in your intended handoff revision before expecting every documented
new coach/video command to exist. This task did not authorize publishing or
silently committing all unrelated work.

## Evidence and remaining verification

Architecture and commands derive from `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/build.rs`, both Tauri configs, `src/bridge.ts`, Rust command/service
implementations and `.github/workflows/`. In particular, current source requires
Python/MSYS2 for helper provisioning and restricts motion/scene extraction to
Apple Silicon. Existing release notes and old acceptance artifacts are historical
evidence, not current Windows acceptance.

The Windows checklist is [windows-setup.md](windows-setup.md). Documentation
and skill validation on Mac cannot prove Windows installation, hook activation,
MCP authentication, native media or installer success. Those require a new
Windows session and the target-machine checks listed there.
