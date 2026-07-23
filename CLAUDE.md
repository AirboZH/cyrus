# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Project Overview

Cyrus (Linear Claude Agent) is a pnpm/TypeScript monorepo that integrates Linear issue tracking with Anthropic's Claude Code to automate software development. It is transitioning to an edge-proxy architecture separating OAuth/webhook handling (proxy) from Claude processing (edge workers).

**Key capabilities:** monitors Linear issues assigned to a user; creates isolated Git worktrees per issue; runs Claude Code sessions; posts responses back to Linear as comments; maintains conversation continuity via `--continue`; supports edge worker mode for distributed processing.

## How Cyrus Works

1. **Routing**: EdgeWorker receives a Linear webhook and routes the issue to a repository by configured patterns or workspace catch-all rules.
2. **Workspace isolation**: A Git worktree is created per issue (e.g. `worktrees/DEF-1/`) with a sanitized branch name.
3. **AI classification**: Issue content is classified (`code`, `question`, `research`, ...) and a procedure selected (e.g. `full-development`).
4. **Subroutines**: Development tasks run `coding-activity` → `verifications` (tests/typecheck/lint) → `git-gh` (commit + PR) → `concise-summary`.
5. **Mid-implementation prompting**: New Linear comments are streamed into the active session as real-time guidance.
6. **Activity tracking**: Every thought/action is posted back to Linear as activities.

### Test Drives

The F1 testing framework (`apps/f1/test-drives/`) provides a controlled environment to test Cyrus without touching production Linear workspaces.

CRITICAL: you must use the f1 test drive protocol during the 'testing and validation' stage of any major work undertaking. You CAN also use it to test drive the version of the product you're working on.

## Linear Webhooks Reference

Schemas (Apollo Studio):
- EntityWebhookPayload: https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects/EntityWebhookPayload
- DataWebhookPayload: https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/unions/DataWebhookPayload
- IssueWebhookPayload: https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects/IssueWebhookPayload

Key webhook types: `AgentSessionEvent` (created/prompted — assignment or user prompt), `AppUserNotification` (issueUnassignedFromYou), `Issue` (title/description updates). `EntityWebhookPayload.updatedFrom` holds previous values, enabling old-vs-new comparison.

## Working with SDKs

`pnpm install` first, then examine the SDK under `node_modules` (structure, types, docs) before coding against it.

## Shared Skills Across Harnesses

Keep canonical skills in `skills/<skill-name>/SKILL.md` and symlink into `.claude/skills/`, `.codex/skills/`, `.opencode/skills/` via `./scripts/symlink-skills.sh`. Rules: subagent files stay thin wrappers; 95%+ of workflow logic lives in the shared skill; update the shared skill first, never duplicate protocol text across harnesses.

## Checklist For New Agent CLI Harnesses

Before shipping a new runner/harness (Codex, Gemini, OpenCode, etc.):

1. **Session lifecycle**: verify turn limits (`maxTurns`/`maxSessionTurns`), the error/result payload on limit exceeded, explicit deterministic stop behavior.
2. **Prompt model**: how the base system prompt is applied; whether appended instructions extend or replace defaults; provider-specific instruction fields (e.g. `developer_instructions`) and precedence.
3. **Streaming events**: capture real JSON streams, document item types, determine full objects vs deltas needing aggregation; add replay tests from real transcripts.
4. **Final message semantics**: final answer lives in a `result` payload (Claude-style), last assistant message (Gemini-style), or mixed; always post a final `response` activity on success.
5. **Tools & permissions**: validate `tools`/`allowedTools`/`disallowedTools` semantics; approval/sandbox behavior; tool calls produce both start and completion signals. For config-file-driven providers (e.g. Cursor CLI), implement a permission translation layer from Cyrus/Claude tool names to provider-native tokens, written before session start and updated between subroutines. Pre-enable Cursor MCP servers (`agent mcp list` + `agent mcp enable <server>`). Only `.cursor/mcp.json` counts as Cursor project MCP config (see https://cursor.com/docs/context/mcp#configuration-locations). Map `Read(**)`/`Write(**)` to workspace-scoped `Read(./**)`/`Write(./**)` (see https://cursor.com/docs/cli/reference/permissions).
6. **Prompt streaming input**: set `supportsStreamingInput` correctly and gate behavior in runner adapters.
7. **MCP/custom tools**: verify MCP config format and merge behavior, custom tool registration, and map MCP/custom-tool events into consistent runner message shapes.
8. **Runner selection**: keep agent label and model label separate (`codex` vs `gpt-5-codex`); support description selectors `[agent=...]`, `[model=...]`, `[repo=...]`; test precedence of labels vs selectors vs repo defaults.
9. **Activity formatting**: timeline-ready AgentActivity content; tool lifecycle events visible as activities (never dropped); Markdown checklists (`- [ ]` / `- [x]`).
10. **Usage/typing**: map usage/cost/stop-reason fields to shared types; fill required compatibility fields the provider omits; strict TS compatibility for cross-runner contracts.
11. **Config schema**: provider-specific defaults (`claudeDefaultModel`, `geminiDefaultModel`, `codexDefaultModel`); migration logic for renamed/legacy fields.
12. **Validation before merge**: unit tests for adapters/formatters; replay tests from real transcripts; F1 end-to-end for label-based and selector-based runner/model selection, visible tool/file-edit activities, and final response posting.

**Codex lesson**: tool activity at `item.started`/`item.completed` was initially not mapped to `tool_use`/`tool_result`, losing action/file-edit visibility in Linear. Treat tool lifecycle mapping as a first-class acceptance criterion, not a formatter-only concern.

**Cursor lesson**: Cursor CLI enforces permissions from config (`~/.cursor/cli-config.json` or `<project>/.cursor/cli.json`), not dynamic allowlists. Add a translation layer (`mcp__server__tool` → `Mcp(server:tool)`, `Bash(...)` → `Shell(...)`), sync project permissions before each run and between subroutines, and pre-enable MCP servers for headless sessions.

## Navigating GitHub Repositories

When GitHub auth blocks navigation, replace `github.com` with `uuithub.com` in any GitHub URL for unauthenticated read access to files, trees, and schemas.

## Architecture Overview

```
cyrus/
├── apps/
│   ├── cli/          # Main CLI application
│   ├── electron/     # Future Electron GUI (in development)
│   └── proxy/        # Edge proxy server for OAuth/webhooks
└── packages/
    ├── core/         # Shared types and session management
    ├── claude-parser/# Claude stdout parsing with jq
    ├── claude-runner/# Claude CLI execution wrapper
    ├── edge-worker/  # Edge worker client implementation
    └── ndjson-client/# NDJSON streaming client
```

See @architecture.md for a visual map of how components interact and map Claude Code sessions to Linear comment threads.

## Testing Best Practices

### Prompt Assembly Tests

For `packages/edge-worker/test/prompt-assembly*.test.ts`: **CRITICAL — always assert the ENTIRE prompt, never `.toContain()` partial checks.** Use `.expectUserPrompt()` / `.expectSystemPrompt()` with complete strings, `.expectComponents()`, `.expectPromptType()`, then `.verify()`. Partial assertions are too weak and miss regressions in prompt structure, formatting, and content.

## Common Commands

Monorepo-wide (from root): `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm test:packages:run` (recommended), `pnpm typecheck`, `pnpm dev` (watch).

CLI app (`apps/cli/`): `pnpm start`, `pnpm dev`, `pnpm test` / `pnpm test:watch`. Link dev version globally:
```bash
pnpm build && pnpm uninstall cyrus-ai -g
cd apps/cli && pnpm install -g . && pnpm link -g .
```

Electron app (`apps/electron/`): `pnpm dev`, `pnpm build:all`, `pnpm electron:dev`.

Proxy app (`apps/proxy/`): `pnpm start`, `pnpm dev`, `pnpm test`.

Any package: `pnpm build`, `pnpm typecheck`, `pnpm test` (watch) / `pnpm test:run`, `pnpm dev`.

## Linear State Management

Assigned issues auto-transition to a state with `type === 'started'`. Standard types: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`. Reference: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/enums/ProjectStatusType

## Important Development Notes

1. **Edge-proxy architecture**: OAuth/webhook handling is being separated from Claude processing.
2. **Dependencies**: claude-parser requires system `jq`; pnpm v10.11.0; TypeScript for all new packages.
3. **Git worktrees**: a root `cyrus-setup.sh` runs in new worktrees for project-specific init; a root `cyrus-teardown.sh` runs in the worktree immediately before removal at a terminal state (completed/canceled/deleted).
4. **Testing**: Vitest everywhere; run tests before committing.
5. **Sandbox egress proxy & CA certs**: with sandbox enabled, the egress proxy generates a CA at `~/.cyrus/certs/cyrus-egress-ca.pem` for TLS interception. `RunnerConfigBuilder.buildSandboxConfig()` sets per-session env vars: `NODE_EXTRA_CA_CERTS`, `GIT_SSL_CAINFO`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`/`PIP_CERT`, `CURL_CA_BUNDLE`, `CARGO_HTTP_CAINFO`, `AWS_CA_BUNDLE`, `DENO_CERT`.
   - `sandbox.systemWideCert: true` skips all per-session CA env vars (OS cert store handles trust). Trust system-wide first: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.cyrus/certs/cyrus-egress-ca.pem` (macOS) or `sudo cp ~/.cyrus/certs/cyrus-egress-ca.pem /usr/local/share/ca-certificates/cyrus-egress-ca.crt && sudo update-ca-certificates` (Linux).
   - Tools that ignore env vars and always need system trust: Bun, .NET/nuget, macOS curl (SecureTransport default).
   - If `GIT_SSL_CAINFO`/`SSL_CERT_FILE`/`CURL_CA_BUNDLE` are set in the Cyrus parent env, they break git push/fetch from Cyrus itself (parent doesn't route through the proxy) — don't set them in `~/.cyrus/.env`.
   - Pre-existing `NODE_EXTRA_CA_CERTS` is merged via `EgressProxy.buildCACertBundle()`.
6. **Two permission systems — tool vs. sandbox**:
   - **A. Tool permissions** (`allowedTools`/`disallowedTools` CLI flags): checked by Claude Code's permission layer, not OS-level. `Read(~/**)` never matches — `~` is not expanded. `disallowedTools` is instant deny, takes precedence over `allowedTools`. Absolute paths need a double leading slash: `Read(//Users/alice/.ssh/**)` (added in code as `/${fullPath}`). Solution: `buildHomeDirectoryDisallowedTools(cwd, allowedDirectories)` in `packages/claude-runner/src/home-directory-restrictions.ts` enumerates home-dir siblings with double-slash absolute paths, excluding `allowedDirectories`; wired into `ClaudeRunner.ts` automatically.
   - **B. Sandbox filesystem permissions** (`sandbox.filesystem.allowRead`/`denyRead`/`allowWrite`): OS-level (bubblewrap/macOS sandbox). True deny+whitelist works: `denyRead: ["~/"]` + `allowRead: ["."]` (`.` = primary working cwd). Configured in `buildSandboxConfig()` in `packages/edge-worker/src/RunnerConfigBuilder.ts`.
   - **Key invariant**: if sandbox is enabled, both systems restrict home reads; if disabled (local dev), only tool permissions apply — requiring explicit enumeration via `buildHomeDirectoryDisallowedTools`.
7. **Updating `@anthropic-ai/claude-agent-sdk`**: must refresh tool allowance lists in `packages/claude-runner/src/config.ts`. Run `./scripts/extract-claude-tools.sh` (extracts tool names from the `init` block), compare against `availableTools` in `config.ts`, and review `readOnlyTools`/`writeTools`/helpers. Otherwise sessions silently miss new tools or reference removed ones.
8. **Routing & self-describing prompts**: when changing routing behavior (description-tag syntax, label routing, base branch overrides, multi-repo), also update the prompts describing these to Cyrus itself:
   - `packages/edge-worker/src/PromptBuilder.ts` — `<repository_routing_context>` XML block
   - `packages/edge-worker/src/SlackChatAdapter.ts` — Slack chat system prompt orchestration notes
   - `packages/edge-worker/src/ActivityPoster.ts` — routing activities on the Linear timeline
9. **New top-level `EdgeWorkerConfig` field**: adding to the Zod schema in `packages/core/src/config-schemas.ts` is not enough. `ConfigManager.loadConfigSafely()` (`packages/edge-worker/src/ConfigManager.ts`) merges only a hardcoded whitelist of fields on reload; `detectGlobalConfigChanges()` fires only for a hardcoded `globalKeys` list. Update both: add `<newField>: parsedConfig.<newField> || this.config.<newField>` to the merge (~line 200) and the field name to `globalKeys`. Symptom if forgotten: field in `~/.cyrus/config.json` is silently ignored / hot-reloads never propagate (bit us in CYHOST-967).
10. **Changing `cyrus-tools` MCP tools**: when adding/removing a tool on the inline `cyrus-tools` MCP server (`McpConfigService.buildMcpConfig`), also update the cyrus-hosted catalog for the `/settings/tools` UI: `KNOWN_MCP_TOOLS` (`"mcp__cyrus-tools"` key) in `apps/app/src/lib/cyrus-config/builder.ts`, plus `packages/core/src/allowed-tools-defaults.ts` if the tool should be on by default. Symptom if forgotten: tool works at runtime but is invisible/untoggleable in the settings UI.
11. **New path-bearing `EdgeWorkerConfig` field**: cyrus-hosted emits literal `~/` paths; `fs.readFileSync` doesn't expand `~`, so paths must go through `resolvePath` from `cyrus-core`. Repo-scoped paths are normalized in `EdgeWorker.ts` (constructor, `addNewRepositories`, `updateModifiedRepositories`). Top-level path fields bypass that loop — normalize them in `EdgeWorker.normalizeConfigPaths()` alongside `slackMcpConfigs`/`linearMcpConfigs`/`githubMcpConfigs`. Symptom if forgotten: self-host sessions crash with `ENOENT ... open '~/.cyrus/...'` while cloud sessions work (CYHOST-967 / v0.2.53).

## Dependency Security Policy (MANDATE)

1. **Prefer direct-dep bumps** in the owning `packages/*` or `apps/*` `package.json` (not root) to a version whose graph includes the patched transitive; regenerate the lockfile.
2. **Root `pnpm.overrides` only when a direct-dep bump can't reach the transitive** (deep transitives with no patched upstream release). Document the reason inline.
3. **Remove overrides when a dep bump makes them redundant** — verify with `pnpm install && pnpm audit` in the same change.
4. **`pnpm audit` must report zero advisories** after any dependency change; commit the regenerated `pnpm-lock.yaml` alongside.

Why: overrides hide the real dep source and rot; direct-dep bumps are precise and Dependabot-visible.

## Development Workflow

1. **Pull requests**: update `CHANGELOG.md` under `## [Unreleased]` (`### Added`/`Changed`/`Fixed`/`Removed`) with what changed and why; include the PR link (create the PR first if needed). Run `pnpm test:packages`, `pnpm typecheck`, and consider `pnpm build`.
2. **Internal changes** (refactors, tooling, non-user-facing): update `CHANGELOG.internal.md` instead, same format.
3. **Changelog format**: Keep a Changelog; write from the perspective of users running the `cyrus` CLI binary — user impact only, no package names or internals. Example: "New comments now feed into existing sessions" NOT "Implemented AsyncIterable<SDKUserMessage> for ClaudeRunner".

## Key Code Paths

- **Linear Integration**: `apps/cli/services/LinearIssueService.mjs`
- **Claude Execution**: `packages/claude-runner/src/ClaudeRunner.ts`
- **Session Management**: `packages/core/src/session/`
- **Edge Worker**: `packages/edge-worker/src/EdgeWorker.ts`
- **GitHub Token Resolution**: `EdgeWorker.resolveGitHubToken()` — three-tier fallback: proxy-forwarded installation token → self-minted GitHub App token (`GitHubAppTokenProvider`) → `GITHUB_TOKEN` PAT.
- **GitHub App Token Minting**: `packages/github-event-transport/src/GitHubAppTokenProvider.ts` — JWT signed with the App's private key, exchanged for short-lived installation tokens; cached, refreshed 5 min before expiry.
- **OAuth Flow**: `apps/proxy/src/services/OAuthService.mjs`

## Testing MCP Linear Integration

```bash
cd packages/claude-runner
echo "LINEAR_API_TOKEN=your_linear_token_here" > .env
pnpm build
node test-scripts/simple-claude-runner-test.js
```

The script verifies MCP server connectivity, lists Linear tools, and fetches user info/issues. In production, EdgeWorker auto-configures the official Linear MCP server per repository.

## Publishing

Use the `/release` skill (Claude Code / Claude Agent SDK) for publishing all packages to npm in dependency order.

## Gemini CLI for Testing

Install the pinned version for GeminiRunner integration tests:
```bash
npm install -g @google/gemini-cli@0.17.0
```

Config reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md

GeminiRunner auto-generates `~/.gemini/settings.json` with single-turn model aliases and preview features if none exists.
