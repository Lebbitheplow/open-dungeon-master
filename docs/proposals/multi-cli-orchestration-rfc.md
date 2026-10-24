# RFC: Optional multi-CLI storyteller coordination

**Status:** Proposal for maintainer review; no runtime code has been implemented  
**Target:** Open Dungeon Master server (\`Lebbitheplow/open-dungeon-master\`)  
**Proposed contributor:** The Embertson Group  
**Date:** 2026-10-22

## Summary

Allow a server administrator to optionally coordinate **multiple locally installed, already-authenticated CLI agent programs** during an AI Dungeon Master turn. One existing harness remains the **sole primary narrator and sole agent with ODM's turn-scoped MCP game tools**. Additional eligible agents provide bounded, read-only recommendations (e.g., rules review or lore continuity), which the narrator may use when proposing actions; the ODM server remains authoritative for tools, rolls, state changes, and final turn lifecycle.

This is an RFC, **not an implementation PR**. It requests agreement on scope, integration points, security, and a smallest viable vertical slice before feature code or UI controls are added.

## Motivation / present behavior

ODM already supports Claude Code, Codex, OpenCode, and Grok Build through \`src/lib/harness/adapters/\`. \`src/lib/harness/bridge.ts\` selects one globally configured harness, launches its adapter, and translates its MCP calls back into the existing DM tool loop. ODM also has a separate permission-scoped MCP facility for people's connected agents. Neither is currently a live multi-CLI narrator coordinator.

An administrator who is already signed in to several supported CLI programs cannot currently assign, for example, Codex to narration and Claude Code to rules consultation for the **same** ODM turn, with explicit trust and scheduling rules. Making that a native optional orchestration capability could improve continuity and division of work without storing provider credentials or replacing the game's rules engine.

## Goals

1. Preserve existing single-harness behavior and campaign/administrator eligibility rules with the feature absent or inactive.
2. Use existing, supported and authenticated CLI adapters, not a new remote API-key broker.
3. Resolve explicit, administrator-approved assignments for a primary storyteller and bounded specialist roles.
4. Allow at most one live **tool-authorized** primary narrator for a turn. Specialists return **text-only advice**, with no ODM MCP token and no direct writes.
5. Bound total consultations per turn, concurrent subprocesses, runtime, prompt/context size, and usage; support stop/cancel.
6. Isolate campaign context by campaign, agent, role, and turn generation; reject stale responses.
7. Fail safely: a failed specialist does not become a DM, nor cause already-committed game actions to replay.
8. Present useful admin diagnostics and a reproducible end-to-end two-CLI test before enabling the feature in play.

## Non-goals (first implementation)

- Multiple AIs simultaneously holding the DM tool grant or independently applying game mutations.
- Remote A2A workers, arbitrary MCP federation, shared CLI credentials, or direct shell/file/browser access.
- A general agent marketplace, autonomous agent-to-agent delegation, agent voting on authoritative dice/rules, or automatic plan upgrades.
- Changes to the 5e combat, spell, character sheet, dice, campaign persistence, or mobile native game engines.
- A desktop/Android client repository change in the initial server-side PR.

## Existing source map / intended touchpoints

| Area | Existing file(s) | Proposed work |
| --- | --- | --- |
| Model/CLI bridge | \`src/lib/harness/bridge.ts\`, \`types.ts\`, \`status.ts\` | Reuse current adapters; introduce a **validated explicit agent selection** for tool-free completions while leaving the original primary narrator session contract intact |
| Harness security | \`src/lib/harness/child-env.ts\`, \`process.ts\`, \`policy.ts\` | Preserve the environment allowlist, subprocess lifecycle, and campaign eligibility; test safe cleanup for concurrent consultations |
| Turn/model entry points | \`src/lib/dm/turn.ts\`, \`src/lib/dm/model.ts\` | Add a single bounded consultation hook before the appropriate first model call, with accepted recommendations as clearly delimited untrusted guidance |
| Job lifecycle | \`src/lib/dm/job-control.ts\`, \`queue.ts\` | Reuse abort/deadline and one-job-per-campaign serialization; do not replace the queue |
| Context sizing | \`src/lib/dm/context-retrieval.ts\`, \`context-budget.ts\` | Build a minimal role-specific snapshot and reserve a bounded place for guidance in the narrator request |
| Configuration/API | \`src/lib/schemas/global-config.ts\`, \`src/lib/db/app-settings.ts\`, \`src/app/api/admin/settings/route.ts\`, \`src/app/api/admin/harness/route.ts\` | Design a backwards-compatible versioned orchestration config and admin-only read/test/save flow, only after the control is justified |
| Admin UI | \`src/app/admin/AdminHarnessSection.tsx\`, \`HarnessTestPanel.tsx\` | Proposed optional advanced configuration under the existing Agent Program section after design approval |
| MCP server | \`src/lib/agents/mcp-server.ts\`, \`src/app/api/mcp/route.ts\` | **No initial protocol modification**: specialists use \`mcp: null\`; current primary turn-grant security remains authoritative |
| Tests | \`scripts/test-harness-turn.mjs\`, \`test-harness-completion-slots.mjs\`, \`test-turn-watchdog.mjs\`, others | Add deterministic fake-agent orchestration, security and cancellation tests, plus real two-CLI smoke coverage |

The names \`src/lib/dm/coordination.ts\` and \`src/lib/db/coordination.ts\` already refer to **player-character coordination**, not AI-agent orchestration; avoid co-opting them. New implementation modules could live under \`src/lib/harness/orchestration/\`, subject to maintainer preference.

## Proposed execution contract

1. ODM begins a normal AI DM job, validating campaign state and existing paid-agent access.
2. If coordination is enabled and supported, a deterministic policy resolver selects configured, eligible specialists. Selection is **not** an unrestricted model-generated executable name.
3. The coordinator builds a **read-only, minimum-necessary, versioned snapshot**: role instructions, permitted campaign facts, current action question, and relevant rule evidence. Exclude provider credentials, internal file paths, secrets, hidden context irrelevant to the task, and other campaigns' data.
4. Each consultation uses the existing adapter's tool-free completion mode (\`mcp: null\`) and a separate, budgeted subprocess/slot. One consultation round is the initial default. The specialist is never given the primary session's MCP bearer token.
5. Results are validated for size and identity; only current-turn results enter a clearly separated, lower-trust guidance section of the primary narrator's input. The primary's existing MCP tool whitelist and ODM's game engine enforce actual actions.
6. If a consultation fails, times out, or arrives after the turn generation changes, ignore it, record an appropriately redacted diagnostic, and continue with the original narrator when safe.
7. Completion, parked physical dice, turn failure, cancellation, and server restart all close or orphan-invalidate outstanding consultations. A prior successful mutation must never be retried because a specialist failed.

### Proposed internal types (illustrative)

~~~ts
type SpecialistRole = "rules" | "lore" | "continuity" | "encounter";

type ConsultationTask = {
  id: string;
  campaignId: string;
  turnId: string;
  contextVersion: number;
  role: SpecialistRole;
  agent: "claude" | "codex" | "opencode" | "grok";
  question: string;
  context: string;
  deadlineMs: number;
};

type ConsultationResult = {
  taskId: string;
  status: "completed" | "failed" | "cancelled";
  recommendation?: string;
};
~~~

Types above are a proposal, not existing ODM public APIs. The first shipped slice should likely use only one specialist role and one configured agent.

## Coordination policy (proposal)

- **Default:** Existing single-agent behavior, zero extra CLI invocations.
- **Consult mode:** One primary storyteller plus one designated read-only specialist (first delivery).
- **Future:** Multiple independent read-only specialists, shadow review, custom agent/role presets; agent-initiated \`odm_delegate_task\` would require a separate reviewed MCP security proposal.
- **Authority:** Each specialist receives only proposals-only capability; it cannot operate the ODM model's tool session. Rules are validated by ODM, not by agent consensus.
- **Eligibility:** A consultation cannot run for a campaign the administrator has not authorized to consume an account's plan. Respect the current \`harnessOfferFor\` and shared-host rules.
- **Readiness:** Only explicitly enabled, installed, authenticated, adequately locked-down and tested agents may run.
- **Failure:** Bounded waiting and safe single-narrator continuation, or a clearly surfaced failure if the primary itself cannot run. No silent switch to a paid API.
- **Idempotency:** Tool-authorized primary actions continue through the existing validated DM loop. No multi-agent side effects occur outside that path.

### Security / privacy constraints

All agent output is untrusted input, including text that resembles tool calls, policy changes, instructions to disclose data, or requests to install extra software. Context should be formatted as data, not elevated to system instructions. The server must not load or expose user agent config, hooks, personal MCP servers, credentials or arbitrary repository files for specialist consultations. Retained transcript behavior varies by CLI; admin-facing disclosure must identify provider retention limitations. Deny a specialist whose lockdown cannot be verified.

Per-role usage and timing should be accounted for when available, with unspecified values remaining unknown rather than inferred. Ensure the total consultation budget is a subset of the enclosing DM job deadline and cannot starve other campaigns; guard against nested consultation deadlocks.

## UI proposal / AGENTS.md controls justification

**No new controls are included in this RFC.** Before adding any, follow \`AGENTS.md\`'s settings-control rules (necessity, good defaults, one control per idea, labels, keyboard/touch accessibility and a default-state screenshot).

If accepted, place an optional **Coordination** preset under **Admin > Agent program** rather than campaign creation. A read-only preview may show the existing primary CLI and eligible specialist status. Exact controls, copy, defaults, screenshots and accessibility review would be part of the **implementation** PR, not this one. Device-world desktop setup could be integrated separately in the client repository only after the server contract stabilizes. Android remains a remote client: no local multi-CLI host.

## Proposed implementation sequence

1. Agree on architecture and scope with the ODM maintainer.
2. Extract a testable, explicit tool-free \`runSpecialistCompletion(agent, context, signal)\` path from current harness logic, without changing how the primary storyteller receives MCP tools.
3. Add deterministic routing/policy and a single consultation hook in the DM turn. Keep the serializer, tool loop, narration guard and physical-dice parking untouched.
4. Add fake-harness tests (no added plan usage), negative security tests, cancellation/restart tests and a real two-program smoke case on a supported desktop/server installation.
5. Only then add justified administration controls and usage/error visibility. Consider wider role presets, more CLIs, remote A2A and an MCP delegation tool as separate follow-ups.

## Acceptance criteria for the first implementation PR

- [ ] Coordination absent/disabled leaves current single-agent turns and campaign restrictions unchanged.
- [ ] A Codex lead and Claude Code read-only specialist (or reverse assignment) can complete one turn with no specialist MCP token.
- [ ] Specialist output cannot call an ODM tool or mutate persistent state.
- [ ] Provider failure, login loss, timeout, rate limit, cancellation, and server restart have bounded safe outcomes.
- [ ] Turn generation checks prevent stale guidance from affecting newer turns.
- [ ] There is no secret/environment leakage to a specialist, no cross-campaign data access, and no accidental subscription fallback.
- [ ] Existing harness, DM job, policy, and turn tests continue to pass.
- [ ] Documentation and, if controls are introduced, screenshots/accessibility checks meet \`AGENTS.md\` requirements.

## Questions for maintainers

1. Is a **server-owned, read-only consultation** preferable to exposing an MCP \`odm_delegate_task\` tool to the primary storyteller at first?
2. Should orchestration attach before the first model call only, or to selected later turns as well? Which point best preserves the existing DM turn budget?
3. Is the global server harness configuration the right home for specialist selection, or should the feature remain internal until there is evidence a user-facing option is warranted?
4. What additional privacy limitations or usage warnings are required before calling multiple signed-in CLI programs?
5. Is this a welcome upstream direction, and what smallest vertical slice would make a good first implementation PR?

## Contribution boundaries

This proposed contribution is independent of, and introduces no code, credentials, assets, or confidential implementation from, any third-party proprietary project. It is intended for normal review and contribution under ODM's existing open-source licensing and contributor workflow.

**RFC scope:** one Markdown document; no feature code, settings, schema changes, migrations, runtime behavior changes, or test execution.
