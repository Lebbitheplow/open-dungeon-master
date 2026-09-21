# Plan: agent harnesses as a story backend, and a proper MCP surface

Written 2026-09-20 against server 0.21.3 and client 0.12.9. It answers
[PR 10](https://github.com/Lebbitheplow/open-dungeon-master/pull/10)
("authenticated MCP game control plane") and the ask behind it: let an admin's
Claude Code, Codex, opencode or Grok Build install run the table on the plan
they already pay for, held to the same rules as the built-in DM, with pictures
optional, with no shell or file access, and working in the desktop app too.

Research behind it: the PR diff, four code surveys of this repo, a read of
[T3 Code](https://github.com/pingdotgg/t3code) at `a4bc7deb` (MIT), the vendor
docs for all four harnesses, and `claude --help` / the MCP SDK typings on this
machine. Anything marked **verify** was not proven and has a test in section 11.

## Status (2026-09-21): built, with three changes from the plan below

Built and tested in one pass (server, admin UI, Workbench, desktop app).
Where the build departed from this plan, the build is what stands:

- **No turn-executor extraction (3.3, 4.4).** The harness became the model
  *inside* the existing DM loop instead: `src/lib/harness/bridge.ts` holds
  each MCP tool call, hands it to `runAdvance` as an ordinary tool call, and
  answers it with the loop's own result. Every cap, parked roll, guard and
  audit applies unchanged, and `turn.ts` only gained `dmTurnTools()` (the
  tool list as a function, plus the full catalogue a program reads once at
  start) and a release in `advance()`'s `finally`. No second copy of the
  rules exists to drift.
- **Who may use it (decision 7, 13.3):** Kaleb's call, the whole server by
  default (`harness.campaigns: "all"`); "admins" limits it to campaigns an
  administrator leads.
- **The Workbench calls the web routes themselves** (7.2) over loopback, as
  the player, on a short-lived session per grant, so permissions cannot drift.

Proven on this machine: Claude Code 2.1.278 (lockdown from its init tool
list; two live turns, rolls and an encounter through the engine) and
opencode 1.18.30 on the local llama-server (lockdown proven: asked to list
files, it reported only the table's tool). Codex and Grok Build adapters are
written against their published protocols and marked untested until run
(Codex verification is deferred by Kaleb's call). Native pictures stay
locked until "Paint a test picture" succeeds. H8 (Docker host bridge) is not
built. User guide: [agent-harness.md](agent-harness.md).

## 0. Decisions made in this plan

1. **Two surfaces, one endpoint, one executor.** The harness as the DM's brain
   (ODM launches it, section 4) and a Workbench connection for a person's own
   agent session (section 7) are different jobs with different trust. Both speak
   MCP to one in-app route, and every game change from either goes through the
   engine code the built-in DM already uses.
2. **No sidecar, no shared secret.** PR 10 runs a second process with one
   god-mode token in an env var. `@modelcontextprotocol/server` 2.0.0 (the SDK
   the PR already pins) has a web-standard `createMcpHandler(factory).fetch(request,
   { authInfo })`, so the MCP server mounts as `src/app/api/mcp/route.ts` and
   every request carries an identity.
3. **The harness is a provider, not a new game mode.** `TextProvider` gains
   `"harness"`. `startDmTurn` still assembles the same prompt, the same tool
   list and the same turn row. Only the inner model loop changes.
4. **Launch the installed CLI, take no agent SDK dependency.** Claude is driven
   through `claude -p` with stream-json, Codex through `codex app-server`
   JSON-RPC, opencode through `opencode serve` over HTTP, Grok through ACP on
   stdio. T3 Code uses the Claude Agent SDK; ODM does not, because the SDK pulls
   a native binary per platform into the desktop payload and every flag needed
   exists on the CLI. The only new dependency is the MCP server package.
5. **Lockdown is mandatory, and graded honestly.** Player text reaches the
   model. A harness with a shell on the admin's machine is a prompt injection
   away from `rm -rf`. A harness runs only if its built-in tools are removed or
   contained, the probe proves it, and the admin page shows which of the two it
   got.
6. **Pictures are a separate choice from the storyteller.** Three sources: an
   ODM image backend (works today beside any harness), the harness's own image
   tool (Codex and Grok, unlocked only after a real test picture), or none
   (placeholder art, no image tool offered to the model). Nothing requires a
   picture backend today and nothing will.
7. **The plan being spent is the admin's.** The harness is configured only at
   server level. By default only campaigns the admin leads may use it.
8. **Order:** Claude first and opencode second (both installed here, both
   testable today), then Codex and Grok (neither installed here).

## 1. What PR 10 gets right, and what it gets wrong

Keep: fail closed when unconfigured; constant-time token compare; `Origin`
header denied unless allowlisted; `confirm: true` on deletes; masked story
settings on reads; strict zod on every action; the grouping of tools by noun;
the test that a stored key never reads back. The contributor gets credit on the
commits that reuse those (section 12, H7).

Replace:

| Problem in the PR | Why it matters | This plan |
| --- | --- | --- |
| One env token, no user behind it | Every call is admin of everything; nothing is attributable or revocable per agent | Per-user connection grants, hashed, scoped, revocable (3.2) |
| Calls `src/lib/db/*` directly | Skips `requireMember`, `requireLead`, `requireDm`, `requireStoryAuthority`; skips mute, floor, seat rules | Workbench tools call the same checks the HTTP routes call (7.2) |
| `sheets.patch`, `set_scene`, `set_quest_log` write raw state | Bypasses `invokeEngine`, the sheet audit, caps and the engine boundary; this is the opposite of "in line with the rules" | Game state changes only through `invokeEngine` / the turn executor |
| `customApiKey` writable over MCP | An agent can repoint the story model at a server it controls and read every prompt, secrets included | Keys and backend URLs are never writable over MCP |
| `dmOutline`, `storyArc` returned to any caller | Spoils the campaign for a player's agent | Secrets follow `capsFor` exactly as the web UI does |
| Sidecar, Dockerfile, second port | Two processes to deploy, and the desktop app would have to bundle and supervise both | In-app route; nothing new to run |
| Not a DM | It administers campaigns; it cannot run a turn | Section 4 |
| Undocumented `mcp_control` / `mcp_notice` events | Clients do not know them; the apps ignore them | Existing event types only |

## 2. Architecture

```text
 managed (section 4)                         workbench (section 7)
 ODM launches the harness                    a person's own agent session
 claude | codex | opencode | grok            any MCP client
        |  turn grant, loopback only                |  connection grant
        v                                           v
        +------------- POST /api/mcp ---------------+
                          |
              grant -> tool list for that grant
                 |                         |
        turn executor (3.3)        route-equivalent handlers (7.2)
        same handlers as turn.ts   same permission checks as the routes
                 \                         /
                  rules engine, events, audit
```

New code lives in two bounded contexts: `src/lib/agents/` (grants, MCP server
factory, tool registries, audit) and `src/lib/harness/` (discovery, adapters,
runner, prompt rendering, images). Public types in `types.ts` of each. Files
stay under 500 lines; `turn.ts` (2005 lines today) shrinks as part of 3.3.

## 3. Foundations

### 3.1 The MCP route

`src/app/api/mcp/route.ts`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
`POST` resolves the bearer token to a grant, then
`handler.fetch(request, { authInfo })`; the factory reads `ctx.authInfo` and
returns a low-level `Server` whose `tools/list` and `tools/call` handlers serve
that grant's registry. The low-level server is deliberate: the DM tools are
already JSON Schema (OpenAI function format), so they pass through unchanged
rather than being rewritten in zod. `legacy: "stateless"` so both 2025 and
2026-07-28 clients work; `GET` and `DELETE` answer 405.

Guards, in order: no grant store enabled means 404 (the route does not exist
for a server that never turned this on); `Origin` present and not allowlisted
means 403; missing or unknown token means 401 with `WWW-Authenticate`; a turn
grant whose `Host` is not loopback means 403 (so a tunnel or the public URL can
never carry one); per-grant rate limit (3.4); body cap 1 MB. `src/proxy.ts`
keeps `/api/mcp` out of the app-origin CORS matcher.

### 3.2 Grants

`src/lib/agents/grants.ts`. Raw token is `randomBytes(32)` base64url; only the
SHA-256 is kept, the pattern `mintSession` uses (`hashToken` in
`src/lib/auth.ts` becomes an export).

| | Turn grant | Connection grant |
| --- | --- | --- |
| Minted by | the harness runner, per run | a signed-in user, in Account settings |
| Stored | in memory on `globalThis`, never on disk | table `agent_grants` (hash, user, name, scopes, campaign, expires, last used, revoked) |
| Bound to | `{ campaignId, turnId, purpose: "dm" \| "probe" }` | the user; optionally one campaign |
| Lifetime | the run; revoked in `finally`; hard cap 15 minutes | 90 days by default, revocable, shown once |
| Reachable from | loopback only | anywhere the server is |
| Acts as | the AI DM of that turn (`AI_CAPS`) | that user, nothing more |

### 3.3 The turn executor

Today `runAdvance` (`src/lib/dm/turn.ts:588`) parses a reply, buckets its tool
calls by family, runs handlers, enforces caps and pushes `role: "tool"` results
onto `turn.conversation`, all inline. Extract that middle into
`src/lib/dm/turn-executor.ts`:

```ts
executeTurnCall(context: TurnContext, turn: DmTurn, call: { id: string; name: string; args: string })
  : Promise<{ result: Record<string, unknown>; parked: boolean }>
buildTurnTools(context: TurnContext, turn: DmTurn): readonly ToolDefinition[]   // turn.ts:620-666, moved
```

The built-in loop calls it per tool call; the MCP path calls it per `tools/call`.
Everything that makes the AI DM lawful moves with it, so neither caller can skip
it: `MUTATION_CAP_PER_TURN`, `ENCOUNTER_CAP_PER_TURN`, `WHISPER_CAP_PER_TURN`,
one note and one `complete_beat` per advance, `request_roll kind=attack` refused
in combat, parked physical dice, the sheet audit with its `turnId`. Pure
refactor, shipped alone, proven by the existing suites plus 11.1.

### 3.4 Audit and limits

Table `agent_activity` (grant id, user id or `ai`, harness id, campaign, tool,
ok or refusal, ms, created). Written for every `tools/call` on either surface.
`insertSheetAudit` gains actor labels `harness:<id>` and `agent:<grantName>` in
place of the bare `"dm"` default, so Undo and Revert turn in the audit panel say
who did it. Rate limits reuse the `login-throttle` store with synthetic keys:
turn grants 120 calls a minute and `HARNESS_MAX_TOOL_CALLS` (24) per run;
connection grants 60 calls a minute, 10 writes a minute.

## 4. Workstream A: the harness as the storyteller

### 4.1 Adapter contract

`src/lib/harness/types.ts`:

```ts
type HarnessId = "claude" | "codex" | "opencode" | "grok";
type Lockdown = "removed" | "contained";      // built-ins gone, or present but boxed in
interface HarnessStatus {
  id: HarnessId; installed: boolean; version?: string; path?: string;
  auth: { state: "ready" | "signed-out" | "unknown"; kind?: "subscription" | "api-key"; plan?: string; account?: string };
  models: { id: string; label: string; contextTokens?: number; cheap?: boolean }[];
  lockdown?: Lockdown; nativeImages: "no" | "untested" | "verified";
  availability: "ok" | "container" | "sandboxed-package" | "phone"; message?: string;
}
interface HarnessAdapter {
  probe(config: HarnessConfig): Promise<HarnessStatus>;
  run(request: HarnessRun): Promise<HarnessRunResult>;        // agentic, MCP attached
  complete(request: HarnessCompletion): Promise<{ text: string }>; // no tools: utility work, guard rewrite
  generateImage?(request: HarnessImageRequest): Promise<{ bytes: Buffer; mime: string }>;
}
```

`HarnessRun` carries `system`, `prompt`, `model`, `effort`, `mcp: { url, token }`,
`signal`, `onDelta`, `limits`. The shape follows T3 Code's
`ProviderAdapterShape` (start, send, stream, interrupt) cut down to what a
non-interactive table needs: there are no approval prompts because nothing a
harness could ask approval for is allowed.

### 4.2 Discovery

`src/lib/harness/discover.ts`. Order: the admin's explicit path, `PATH`, the
login shell's `PATH` (`$SHELL -ilc 'printf %s "$PATH"'`, 3 s timeout, cached),
then known homes (`~/.local/bin`, `~/.npm-global/bin`, `~/.bun/bin`,
`~/.opencode/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `%APPDATA%\npm`). The
login-shell step matters in two real places: Kaleb's server runs as a systemd
user unit and the desktop app is started from a launcher, and neither inherits
the shell's `PATH`. On Windows `.cmd` shims are resolved to their real entry
before spawning without a shell (T3's `resolveClaudeSdkExecutablePath` is the
precedent). Availability is `container` when `/.dockerenv` exists or the image
sets `ODM_IN_CONTAINER=1`, `sandboxed-package` under `FLATPAK_ID` or `SNAP`,
`phone` on an Android device world.

### 4.3 How each harness is launched, attached and locked down

The child environment is built from an allowlist (`HOME`, `PATH`, `USER`,
`LANG`, `TMPDIR`, `XDG_*`, `APPDATA` and the harness's own auth variables).
**`DB_ENCRYPTION_KEY`, `OPENAI_COMPAT_API_KEY` and every other ODM secret never
reach a harness process.** Every run gets an empty scratch directory as `cwd`,
deleted afterwards. The MCP token travels in the child's environment or a 0600
file in that directory, never on argv.

| | Launch and protocol | How ODM's MCP server is attached | Lockdown | Grade |
| --- | --- | --- | --- | --- |
| Claude Code | `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --model <id> --system-prompt <full replacement> --no-session-persistence`, one process per run | `--mcp-config <0600 file>` with `{ type: "http", url, headers, alwaysLoad: true }`, plus `--strict-mcp-config` | `--tools ""`, `--allowedTools "mcp__odm__*"`, `--permission-mode dontAsk`, `--setting-sources ""`, `--disable-slash-commands`, env `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `CLAUDE_CODE_AUTO_CONNECT_IDE=0`. The `init` message lists the tools; the runner aborts if any name lacks the `mcp__odm__` prefix | removed |
| opencode | `opencode serve --hostname=127.0.0.1 --port=<free> --pure` with `OPENCODE_SERVER_PASSWORD`; plain `fetch` against its HTTP API, SSE on `/event` | `mcp` block inside `OPENCODE_CONFIG_CONTENT` (`type: "remote"`, `oauth: false`, headers) | agent `odm-dm` with `permission: { "*": "deny", "odm_*": "allow" }` and the legacy `tools` map set false for every built-in; per-prompt `tools` map repeats it. **verify** that deny hides the tools and not just blocks them | removed if the probe proves it, else contained |
| Codex | `codex app-server` on stdio, JSON-RPC: `initialize`, `thread/start { ephemeral, baseInstructions, developerInstructions, sandbox: "read-only", approvalPolicy: "never" }`, `turn/start`, deltas from `item/agentMessage/delta` | `-c mcp_servers.odm.url=...` and `-c mcp_servers.odm.bearer_token_env_var="ODM_MCP_TOKEN"` (T3's exact mechanism) | `features.shell_tool=false`, `features.unified_exec=false`, `web_search="disabled"`, `tools.view_image=false`, `features.apps=false`, `features.multi_agent=false`, `features.image_generation=false` outside image runs; the client answers `decline` to every approval request. `apply_patch` has no off switch (openai/codex#8161, closed), so the read-only sandbox and the empty `cwd` are the barrier | contained |
| Grok Build | `grok --permission-mode dontAsk agent stdio`, ACP: `initialize`, `authenticate`, `session/new`, `session/prompt` | `mcpServers: [{ type: "http", name: "odm", url, headers }]` on `session/new` | `_meta.agentProfile` whose `tools:` lists only MCP tools, `_meta.systemPromptOverride`, deny rules for every built-in, allow `MCPTool(odm__*)`, `GROK_CLAUDE_MCPS_ENABLED=0`, `GROK_CURSOR_MCPS_ENABLED=0`. **verify**, none of this was run | contained until proven |

One small JSON-RPC-over-stdio helper (`src/lib/harness/jsonrpc-stdio.ts`) serves
both Codex and ACP. The local lockdown protects the admin's machine. The game
is protected separately and absolutely: whatever a harness does, the only thing
it can do to a campaign is call DM tools on its own turn.

### 4.4 One DM turn

1. `requestDmTurn` and `startDmTurn` run unchanged through prompt assembly.
2. `runAdvance` branches on `textProvider === "harness"` into
   `runHarnessAdvance` (`src/lib/harness/runner.ts`).
3. The runner mints a turn grant, builds the tool list once with
   `buildTurnTools`, and renders the prompt: the system message becomes the
   harness's full system prompt (replacing, never appending to, its coding
   persona); history becomes one transcript message, with earlier tool calls
   and results rendered as `[engine]` lines (`render.ts`, pure, tested). The
   combat tools are listed whenever an encounter could start, because a
   stateless MCP request cannot push `tools/list_changed`; handlers already
   refuse out-of-state calls.
4. `adapter.run`. Each `tools/call` takes a per-turn mutex (harnesses call in
   parallel, handlers assume order), goes through `executeTurnCall`, appends to
   `turn.conversation` exactly as the loop does, publishes the same events
   (`dm_status` rolling, `roll_result`, `encounter_updated`), and returns the
   engine's result as text.
5. **Narration is the text after the last tool result.** Text a harness writes
   before or between tool calls is dropped, which is stricter than today's
   `ATTACK_OUTCOME_TOOLS` rule: prose can never precede the outcome it
   describes. Deltas stream to the table as `dm_delta` and reset when a tool
   call arrives, the way the loop already treats a reply that turns out to
   carry calls.
6. A parked physical roll returns `{ parked: true, say: "stop now" }`, closes
   the grant to further calls and ends the run with the turn
   `awaiting_rolls`. `resumeDmTurn` starts a fresh run with the results in the
   transcript. Runs are stateless by design: ODM owns memory (history packing,
   chapters, compaction), so harness-side sessions, compaction and transcripts
   on disk are all off.
7. The tail is today's tail: `ensureWhisperReplies`, `enforceEngineBoundary`
   (its one rewrite goes through `adapter.complete`, no tools), `finalize`,
   chapter and compaction upkeep.
8. Budgets: 24 tool calls, harness `maxTurns` 12 where offered, 240 s wall
   clock (`HARNESS_TURN_TIMEOUT_MS`). Over budget, tools answer "narrate now";
   on timeout the run is aborted and the turn fails with `DM_HALTED_PREFIX`, so
   the existing Retry button works. A `harness` lane in `media-queue.ts` caps
   concurrent runs at 2 (`HARNESS_MAX_CONCURRENT`) to respect plan limits.

Rejected: keeping the four-call loop and using the harness as a one-step
completion with recorder tools. Harnesses cannot be stopped cleanly after one
tool round, results would not feed back, and four cold starts a turn is slow.

### 4.5 The pieces around the turn

- **Context window.** `storyContextTokens` gains a harness branch: the model's
  reported window, capped at 128K for the same reason OpenAI is
  (`openAiContextWindow`): history is the residual block and a plan's limits are
  counted in tokens. `HARNESS_CONTEXT` overrides.
- **Utility work** (compaction, chapter summaries, facts, arc ticks, Ask) goes
  through `adapter.complete` on the harness's cheapest model by default, picked
  in the admin selector. It falls back to the story model as
  `requestUtilityMessage` does today. `utilityProvider` also gains `"harness"`.
- **Assisted mode.** Delegated monster turns (`delegate.ts`) use
  `adapter.complete` for the JSON decision and `invokeEngine` as today.
- **Vision.** Image parts in the prompt are dropped in v1 and named in the
  status card; Codex `localImage` and Claude image blocks can follow.
- **Failure copy.** Signed out, plan limit reached, binary gone and lockdown
  failed each get their own halted message with the fix, not a stack trace.
  Codex `account/rateLimits/updated` and Claude's result usage feed a plan
  usage meter on the admin card.

## 5. Workstream B: pictures

| Source | When it is offered | How it works |
| --- | --- | --- |
| An ODM image backend | ComfyUI reachable, or an OpenAI image key | Unchanged. `generate_image` is ODM's own tool, exposed over MCP like the rest; it records an `imageRequest`, and `fulfillMessageImage` renders after `finalize`. A Claude table with ComfyUI gets pictures today's way |
| The harness's own image tool | `nativeImages: "verified"` for the chosen harness and sign-in | New `ImageBackend` value `"harness"`. `generateStoryImage` gains a branch to `generateHarnessImage`, so scene art, portraits, NPC faces, covers and location maps all work through the one dispatcher |
| None | Neither of the above | `imageProducerReady` is false, `buildTurnTools` leaves `generate_image` out, the prompt never mentions pictures, placeholder art shows, and every "paint" route keeps its existing 409 with "upload one instead" |

`generateHarnessImage` runs a dedicated short run on the `harness` lane: only
the native image tool enabled, no MCP, prompt "one image of: ...". Bytes come
from the event stream, never from the model's own output: Codex reports a
`ThreadItem` of type `imageGeneration` with `result` and `savedPath`; for Grok
the runner also scans the scratch directory for new image files, since its
headless event shape is undocumented. Validation before anything is written:
magic bytes for PNG, JPEG or WebP (the upload route trusts the declared type
today; this path must not), 8 MiB cap (`MAX_UPLOAD_BYTES`), header-read width
and height, then `public/generated` under the existing naming.

Honest limits, stated in the UI: Claude Code and opencode cannot make pictures.
Codex's tool needs a ChatGPT sign-in on a paid plan (API-key sessions reportedly
do not get it), counts against plan limits three to five times faster, and is
unproven headless. So the option stays locked until **Paint a test picture** in
the admin panel makes one real image and shows it; success stores
`harness.imagesVerifiedAt`. Known side issue to fix on the way: FLUX backends
fall through to ComfyUI in `generateStoryImage` for portraits and covers.

## 6. Workstream C: the admin selector and the campaign panel

**Config.** `globalConfigSchema` gains `text.provider: "harness"` and
`harness: { id, binaryPath, model, utilityModel, effort, images: "off" | "native", campaigns: "mine" | "all", maxConcurrent, turnTimeoutMs }`
(and the merged literal in `saveGlobalConfig`, or the keys silently reset).
`deviceBackend()` in `src/lib/db/settings.ts` overlays the harness fields, so on
a device world every campaign follows the device, as the OpenAI key does.
Routes: `GET /api/admin/harness` (statuses, cached 5 minutes, `?refresh=1`),
`POST /api/admin/harness-probe`, both `requireAdmin`.

**Admin page.** "Default provider" gains **An agent harness**. Choosing it
opens, in flow and never in a floating layer, a row of four cards. This is a
picker, not a form: each card shows the mark, name, a status pill (Ready, Sign
in needed, Not installed, Not available here), version, plan and masked
account, the lockdown grade and a pictures chip. Not installed shows the
install line; Sign in needed shows the command to run (`claude auth login`,
`codex login`, `grok login`). ODM never asks for, reads or stores a vendor
credential. Picking a card reveals a model picker filled from the probe, an
effort picker where the harness has one, the utility model picker, who may use
it, and an advanced "path to the program" text field. **Test the table**
extends `BackendProbe` with real stages: Found, Signed in, MCP handshake, A
tool call there and back, Locked down, Streaming, and Pictures when asked.

**Campaign panel.** `PROVIDER_LABELS` gains "The server's agent (Claude Code,
Sonnet)". A story authority can pick it only when the admin allows that
campaign; the model follows the admin. Device-managed rows read as text, as now.

**Presentation.** Everything moves, and only on facts. Status pills cross-fade
colour on `--ease-snap` over `--dur-quick`. The chosen card lifts and claims
its border on `--ease-spring`, `--dur-move`; the detail panel opens by height on
`--ease-settle`, `--dur-move`. Probe stages arrive with a 60 ms stagger, each
tick drawing its stroke over `--dur-quick` only when that stage's real result
lands; a failure shakes 6 px once and opens its reason. The test picture
develops from the placeholder over `--dur-scene`. The usage meter moves only
when the harness reports new numbers. At the table nothing new is invented: the
existing thinking, rolling and narrating line is driven by the real MCP calls.
Under `prefers-reduced-motion` every one of these is a plain fade. No new
canvases, so the phone budget is untouched. Audited with `getAnimations` per
control before review.

## 7. Workstream D: the Workbench connection

For a person driving their own Claude Code, Codex or any MCP client against a
server, including a Docker one. This is PR 10's use case, done as that user.

### 7.1 Connecting

Account settings gains **Connected agents**: name it, pick scopes, optionally
pin one campaign, get the token once, plus copyable setup lines
(`claude mcp add --transport http odm <url>/api/mcp --header "Authorization: Bearer ..."`,
the Codex `config.toml` block, the opencode `mcp` block). The list shows last
used and a Revoke button that slides the row out.

### 7.2 Tools by scope

Every handler calls the permission check its HTTP route calls, with the grant's
user, then the same `src/lib` function, and returns the same public shape
(`publicCampaign`, `publicEncounter`, `maskStorySettings`, `redactRoll`).
`scripts/test-mcp-workbench.mjs` fails the build if a tool and its route
disagree on who may call it.

| Scope | Tools | Guard |
| --- | --- | --- |
| `read` | my campaigns, a campaign, members, events since, my characters, sheets, quests, lore search | `requireMember`; secrets only where `capsFor` grants them |
| `characters` | create, update, delete (`confirm`), instantiate a library character | owner only, `createSheetSchema` |
| `campaigns` | create, update info, game settings, set status, cover prompt, invite, delete (`confirm`) | `requireLead`; story world and style via `requireStoryAuthority` |
| `dm` | the adjudication catalog and `narrate` | `requireDm`: only in a human or assisted campaign, only for the user in the DM seat. Calls go through `invokeEngine(campaign, { kind: "human", userId }, call)` and the `dm/narrate` path, so an agent here is exactly a person at the DM console |
| `admin` | list users, server status, harness status | `requireAdmin`; opt-in per grant |

Never over MCP, on any scope: API keys, backend URLs, provider choice, user
creation, password resets, backup and restore, raw sheet patches.

## 8. Threats and the rail that answers each

| Threat | Rail |
| --- | --- |
| A player writes instructions into chat to steer the harness | Built-in tools removed or contained (4.3), empty scratch `cwd`, secret-free child environment, no user settings, hooks, plugins or other MCP servers loaded; the probe refuses a harness that fails |
| A harness tries to cheat the game | It has only DM tools, on its own turn, through the executor with every cap; the narration guard still runs |
| A turn token leaks | Memory only, dies with the run, refused unless the request came to loopback, bound to one turn |
| A connection token leaks | Hashed at rest, scoped, revocable, rate limited, every call in `agent_activity` |
| DM secrets leak to a player's agent | Workbench reads use the same redaction as the web UI |
| Browser pages probing `/api/mcp` | `Origin` deny, no cookies accepted on this route, bearer only |
| Someone else's campaign spends the admin's plan | `harness.campaigns: "mine"` by default, concurrency lane, per-run budgets |
| Transcripts of secret story on disk | `--no-session-persistence`, `ephemeral: true`, scratch directory removed |

## 9. Where it runs

| Deployment | Managed harness | Workbench |
| --- | --- | --- |
| Bare host (`npm start`, systemd) | Yes; login-shell `PATH` discovery | Yes |
| Docker image | No: the container cannot start programs on the host. The card says so. Later: the host bridge (H8), the same adapters in a small host process that dials the server | Yes |
| Desktop app (AppImage, deb, rpm, dmg, NSIS) | Yes | Yes, over LAN or a share tunnel |
| Desktop app (Flatpak) | No in v1: spawning host programs needs `flatpak-spawn --host`, which opens the sandbox. The card names the other formats | Yes |
| Android app | No; hidden on a phone world | Yes |

## 10. Carrying every change into the client apps

Server UI is built once as client components with root-relative requests and
reaches the apps' native screens at their next bundle. Beyond that:

| Phase | Client change | Kind |
| --- | --- | --- |
| H0 | `@modelcontextprotocol/server` must survive `prune-server-payload.mjs` and the Turbopack external-alias step in `bundle-server.mjs`; `smoke-local-server.mjs` asserts `/api/mcp` answers `initialize` in the bundled server | payload rule |
| H1 | The admin harness section and the campaign label compile in unchanged. Check the card row and the in-flow detail panel at phone width, and that nothing uses a window dialog | verify |
| H1 | The bundled server is started by `src/main/local-server.ts` with `...process.env`; discovery is server-side, so no shell change is needed, but verify a launcher-started app on GNOME, macOS Finder and Windows finds `claude` | verify |
| H2 | Pictures picker and test picture are server UI; the test picture is a root-relative `/generated/...` path, so the media patch covers it | none |
| H3 | **The Story AI screen** (`src/renderer/local-ai.ts`): a fourth door beside Local AI, OpenAI key and human DM only: "Use an agent I already have". It reads the device world's `GET /api/admin/harness`, so the shell does no detection of its own. `src/shared/ai-setup.ts` gains `harnessPatch()` and `savedAiFrom` learns `provider: "harness"`; `src/shared/types.ts`, `src/main/ipc.ts` and the preload carry the new `AiSetup` arm. Same cards, same motion as section 6 | new shell screen |
| H3 | `NATIVE_MIN_SERVER` moves to the H1 server version | version gate |
| H3 | Flatpak build shows the not-available card; Android hides the door (`platform === "android"`) | payload rule |
| H3 | Windows: `.cmd` shim resolution proven on the windows-smoke runner, CRLF and EPERM safe | verify |
| H7 | Connected agents lives in Account settings, a server page, so it compiles in. Setup lines show the host's public or tunnel URL from `hostOrigin`, never `127.0.0.1` | verify |

Remote players on a desktop-hosted harness world see no difference. Done means
SEEN: the Electron rig (`electron-storyai.mjs`, `STEPS=`) drives the new door
end to end, and the mobile-www rig shows the door absent on Android.

## 11. Tests and acceptance

11.1 **The fake harness.** `scripts/lib/fake-harness.mjs` is an MCP client that
plays a scripted DM: it connects with the turn grant, calls scripted tools and
returns final text. Registered as adapter `fake` when `HARNESS_FAKE=1`. This is
also the first end-to-end `startDmTurn` test the repo has without a live model.

New suites under `scripts/test-*.mjs`: `test-turn-executor` (caps, parked
rolls, attack refusal, identical results from loop and MCP), `test-mcp-route`
(401, 403 on Origin, 403 on non-loopback turn grant, 404 when off, scope
filtering, a stored key never reads back, kept from the PR),
`test-agent-grants`, `test-harness-render`, `test-harness-args` (each adapter's
argument builder is pure; snapshot the lockdown flags so a refactor cannot drop
one), `test-harness-env` (no ODM secret in a child environment),
`test-harness-discover`, `test-harness-images` (sniffing, size cap),
`test-mcp-workbench` (tool and route permission parity), `test-harness-turn`
(fake harness: exploration turn, combat turn, parked roll and resume, over
budget, timeout and retry, interim text dropped).

Live smokes, outside `npm test`, because they spend a plan; run only with
Kaleb's go-ahead: `scripts/smoke-harness.mjs` with `HARNESS=claude|opencode|codex|grok`,
three turns including a fight, asserting the harness's own tool list has no
built-in, that a canary file in the scratch directory could not be read, and
the context trace limit.

Per phase, acceptance is: `npm test`, `npm run lint`, `npm run build` green; the
feature shown on the local service; animations audited; the client table's rows
for that phase seen running.

## 12. Phases

| Phase | Ships | Notes |
| --- | --- | --- |
| H0 | MCP route, grants, turn executor extraction, audit table, fake harness, tests | No visible change. The refactor lands alone |
| H1 | `"harness"` provider, runner, Claude adapter, discovery, admin selector and probe, campaign label, `docs/agent-harness.md` | Server 0.22.0. Testable here today |
| H2 | Pictures: the three-source model, "none" path polish, `"harness"` image backend behind verification, test picture, FLUX fallthrough fix | Native pictures stay locked until H5 proves one |
| H3 | Desktop app: Story AI door, payload, version gate, Flatpak and Android handling | Client 0.13.0 |
| H4 | opencode adapter | Testable here today |
| H5 | Codex adapter and native pictures | Needs Codex installed and a ChatGPT sign-in on a test machine |
| H6 | Grok Build adapter (ACP) and native pictures | Needs Grok Build installed; SuperGrok or X Premium Plus |
| H7 | Workbench connection, Connected agents, PR 10 closed with credit (`Co-authored-by` on the commits that reuse its schemas) | The reply on the PR is drafted for Kaleb to post |
| H8 | Host bridge for Docker | Optional; the adapter contract is transport-free so this is packaging, not redesign |

## 13. Calls for Kaleb

1. **Anthropic's terms.** The Agent SDK docs say: "Unless previously approved,
   Anthropic does not allow third party developers to offer claude.ai login or
   rate limits for their products, including agents built on the Claude Agent
   SDK." This plan never touches a login: it starts the official `claude`
   program the admin installed and signed into, on their own machine, which is
   what T3 Code does, and an API-key sign-in works identically. Recommendation:
   ship it, describe it as "use the Claude Code you already have", do not
   advertise "play on your Claude subscription" in store listings until
   Anthropic has been asked. OpenAI documents Codex with a ChatGPT plan as a
   supported sign-in; xAI's terms were not read.
2. **Native pictures are unproven.** Everything in section 5's second row is
   built against a schema, not a run. If Codex will not paint headless, that row
   ships disabled and nothing else changes.
3. **Default for who may spend the plan** is "only campaigns I lead". Say if
   friends' campaigns on the same server should be in by default.

## 14. Left out, on purpose

- An external agent as the AI DM of an AI-mode campaign over the Workbench
  (long-polling for turns). A chat session is not a service: it stops, fills
  its context and needs a person to keep it alive. The `dm` scope covers the
  honest version: an agent helping the person in the DM seat.
- Cursor and Antigravity. T3 Code supports both over ACP; the ACP helper makes
  them cheap later, but nobody asked.
- Pooling harness processes between turns. Per-run processes are simpler and
  isolate campaigns; revisit if cold starts hurt (Codex `thread/start.config`
  could carry per-thread MCP settings, unverified).
- OAuth for the MCP endpoint. Bearer grants are enough for self-hosted servers;
  the SDK supports adding it without reshaping anything here.
