# Design tooling: installed, verified and pending

Audited 2026-11-03 before installing. Existing application dependencies include React, Motion, uPlot and Playwright. The existing Codex tool surface supplied Context7, browser/computer-use tools and research connectors, but no 21st, shadcn or Playwright MCP. UI UX Pro Max was absent from the installed skill inventory.

## Current state

| Tool | What actually ran | State / limits |
|---|---|---|
| Context7 | Resolved shadcn/ui, Motion and Microsoft Playwright MCP IDs, then queried one setup/accessibility concept per call | Verified connected tool calls. Official source links returned by Context7 guided setup. |
| shadcn MCP 4.23.0 | Stdio initialization, `tools/list`, `search_items_in_registries` for native-select, `view_items_in_registries` for native-select/dialog/tabs | Verified. Search returned real registry items; view returned metadata. Complete native-select source was separately fetched from the official public registry and adapted. Public registry needs no key. |
| Microsoft Playwright MCP 0.0.84 | Stdio initialization, real tool discovery, navigation/screenshots and lap/corner clicks against each running prototype | Verified with installed Chromium. The configured Edge browser also launched successfully. Focused reproducible tests use existing `@playwright/test`; those are distinct from MCP calls. |
| UI UX Pro Max CLI 2.15.0 / skill | Installed from official CLI offline assets; read its SKILL.md; ran Python design-system generation three times and targeted style/chart queries | Verified Python execution and saved output. Installed in the personal `.agents/skills/ui-ux-pro-max` folder; not committed as a personal plugin. No server or API key is required. |
| 21st MCP | Added hosted endpoint with environment-backed Bearer token; attempted real SDK initialization | **Authentication blocked.** Server returned JSON-RPC `-32001`, “Not authenticated”; no key was present in the process. Do not treat configuration as successful source retrieval. Public component searches/pages were researched separately. |
| React Bits | Retrieved public AnimatedList and CountUp implementations and the upstream license | CountUp's lean Motion numeric-update/cleanup pattern was adapted. The full rolling-digit engine and extra icon dependencies were omitted. MIT + Commons Clause notice retained. No Pro subscription/source was used. |
| Motion for React | Existing locked dependency 14.4.0, shared selection layoutId, reduced-motion configuration and cancellable numeric summary transition | Reused; no new production animation framework. Documentation came through Context7. |
| Design skills | Repository development skill, frontend/taste app-screen guidance, motion guidance; app style draw and real-browser inspector | Applied. Generated taste sheets and raw measurement logs are in ignored local tooling storage. See validation for visual findings and remaining density caveats. |

Application lockfile versions used for final checks: React 19.3.0, Motion 14.4.0, Vite 6.4.4, Playwright Test 1.64.0. Package.json ranges differ from resolved versions; the lockfile was restored with `npm ci` and never edited. Host Node is 24; repository CI targets Node 22. This session did not claim Node 22 execution.

## Personal configuration

A backup of personal `config.toml` was made before adding the three MCP entries. Parsed TOML comparison confirmed all pre-existing settings, model/agent definitions and MCP entries preserved semantically. The CLI normalized away node_repl's explicit empty argument array; it was restored before the comparison passed. No model routing was changed. Configuration preservation does not establish the model or reasoning effort of a live chat.

New entries use the official forms:

```toml
[mcp_servers.shadcn]
command = "npx"
args = ["--yes", "shadcn@4.23.0", "mcp"]

[mcp_servers.playwright]
command = "npx"
args = ["--yes", "@playwright/mcp@0.0.84", "--headless", "--isolated", "--browser", "msedge"]

[mcp_servers.twenty_first]
url = "https://21st.dev/api/mcp"
bearer_token_env_var = "API_KEY_21ST"
```

These are documentation examples. Actual personal files and machine-specific executable locations stay outside Git. Codex loads newly registered tools on a fresh session/restart; this session exercised real local MCP server processes through the SDK instead of pretending the live tool inventory refreshed.

## Exact remaining 21st action

Sign in at [21st MCP setup](https://21st.dev/mcp) and obtain a current API key. Privately add `API_KEY_21ST` to the environment inherited by Codex (for example with Windows' user Environment Variables editor), then fully restart Codex and reopen this worktree. Do not paste the key into chat, repository files, screenshots or shell command history. The existing endpoint configuration reads that environment variable. Recheck initialization and perform a real component search/source retrieval before describing 21st as available. Free-account source retrieval limits may apply.

All other tools can be used independently. The missing authentication did not block these three prototypes. 21st source adoption remains deferred, and the research document marks the specific gated candidates.

## Reproducing tooling outside production dependencies

The local verification tools were installed in ignored `.tools/design-tooling/` with a separate private package and lockfile. To recreate a disposable tool area, create a private package there and install the recorded versions of `@modelcontextprotocol/sdk` (1.32.2), `@playwright/mcp` (0.0.84), `shadcn` (4.23.0) and `ui-ux-pro-max-cli` (2.15.0). Do not install them into the application's package.json. The prototype itself requires only the application's existing locked dependencies.

The local tooling install reported two low and four moderate dependency advisories; the unchanged application lock reported three moderate advisories. No automatic dependency upgrades or audit fixes were applied during this visual phase. The separate tool package is not part of the prototype build or production dependency manifest.

Upstream setup references: [shadcn MCP](https://ui.shadcn.com/docs/mcp), [Playwright MCP](https://github.com/microsoft/playwright-mcp), [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [21st MCP](https://21st.dev/mcp), [Codex MCP](https://developers.openai.com/codex/mcp), [Motion accessibility](https://motion.dev/docs/react-accessibility). No authentication or tool results were mocked.
