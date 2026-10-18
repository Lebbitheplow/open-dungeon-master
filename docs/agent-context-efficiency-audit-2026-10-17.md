# Agent context, caching, and LLM performance audit

Date: 2026-10-17

Audited revision: `1b4d97d3fe619f3b1024c096337f49cf54d29698`

Scope: built-in DM turns, agent-program narration, connected-agent MCP responses, campaign memory/retrieval, utility calls, and model transports. Reference/workshop paths were spot-checked for related patterns.

Changes: this report only. Application code, configuration, and existing campaign data were left unchanged.

## Main findings

**The largest opportunity is to reduce the mandatory rules and tool catalogue, and enforce an actual request budget.** Shortening history alone cannot make the current default prompt fit small context windows.

The app already has useful context infrastructure, but its production prompt builder does not use the general block packer. It always includes the rules and game state, trims history around them, and can still send a request larger than the configured window. The current tool catalogue and instructions are large enough to make that happen even with very little game state.

The other major opportunities are token-triggered memory compaction, smaller task-specific utility prompts, reliable provider controls, and measurement of cache hits and individual model calls. Prefix caching can reduce repeated processing and input cost; it does **not** make an oversized prompt fit a smaller context window.

### Priority order

Priority means recommended implementation order, not a security severity rating. **Confirmed** means observed in source or a synthetic execution; estimated savings and proposed designs still need model evaluations.

| ID | Priority | Finding | Main benefit | Relative effort |
| --- | --- | --- | --- | --- |
| F01 | P1 | Production packing does not enforce the whole request limit | Prevent overflow and silent context loss | Medium |
| F02 | P1 | Tool schemas consume roughly 22K–33K tokens | Make small windows feasible; easier tool selection | Large |
| F03 | P1 | Always-on instructions are roughly 9K tokens before optional rules | Reduce fixed context and instruction load | Medium |
| F04 | P1 | Follow-up calls and output caps are not fitted to remaining context | Keep multi-step turns inside the window | Medium |
| F05 | P1 | Memory compaction and coverage are disconnected from what the prompt retains | Preserve continuity in smaller windows | Medium |
| F06 | P1 | Utility jobs lack a common input/output budget | Let genuinely smaller utility models work reliably | Medium |
| F07 | P2 | Game state needs task-specific projections | Reduce recurring state size without losing capabilities | Large |
| F08 | P2 | Cache-friendly layout exists, but volatile data still interrupts prefixes | Reduce repeated prefill and cached-input cost | Medium |
| F09 | P1 | Usage records omit cache/reasoning detail and per-call context growth | Make optimizations measurable | Medium |
| F10 | P2 | Reader calls, fallback calls, and background work add avoidable latency | Faster turns and better responsiveness under load | Medium |
| F11 | P2 | Request controls differ substantially between providers | Fewer failed/corrective calls; predictable reasoning | Medium |
| F12 | P2 | Retrieval repeats preparation and clips away some query intent | Faster retrieval and better selected context | Medium |
| F13 | P2 | Connected-agent replies are bounded, but still sized for large contexts | Smaller external-agent context consumption | Medium |
| F14 | P2 | Responses conversion discards provider reasoning continuity | Improve supported reasoning-model tool loops | Medium |

Implement F09 early enough to measure changes to the other findings. F02 and F03 are the largest prerequisites for a practical small-context profile.

## Measurements

All figures below are **estimates using the app's own `ceil(characters / 4)` convention**, not counts from a model tokenizer. Tool JSON is an approximation of the backend's rendered tool prompt. Synthetic runs used fresh temporary SQLite databases; they did not call a paid model or change live campaigns. Optional features and campaign content can make real prompts larger.

### Fixed prompt overhead

The tool fixture used normal campaign defaults, no picture tool, no story arc, and no prep cards. Harness figures use the deduplicated MCP catalogue, not a double count of shared exploration/combat tools.

| Component | Tools | Estimated tokens |
| --- | ---: | ---: |
| Base `DM_SYSTEM` | — | 9,131 |
| Additional encounter rules | — | 6,106 |
| Engine boundary, excluding its optional check sentence | — | 847 |
| Exploration tools | 75 | 22,323 |
| Combat tools | 69 | 27,279 |
| Agent-program catalogue, union of both modes | 97 | 32,859 |
| Lean exploration tools | 58 | 17,089 |
| Lean combat tools | 52 | 22,045 |
| Lean agent-program catalogue | 80 | 27,752 |

`DM_LEAN_TOOLS=1` saves approximately 5,234 estimated schema tokens on the chat sets in this fixture, about 19% of the larger set. It removes the mutation tools; it does not produce a small-context tool catalogue. The live chat budget charges the larger of the exploration/combat sets because a fight can begin during a turn.

Sources: [tool assembly and charging](../src/lib/dm/turn.ts#L723), [base and encounter instructions](../src/lib/dm/prompt-rules.ts#L12), [engine boundary](../src/lib/dm/engine-boundary.ts#L34), [MCP catalogue deduplication](../src/lib/harness/render.ts#L22).

### Full prompt behavior at small windows

This fixture used four simple level-one human fighter sheets, a short premise, no archive/lore/encounter, and 60 alternating player/DM messages. Each message contained `Message N: ` followed by ten repetitions of `The party asks the guard about the locked door. `. The production `buildDmMessages` function built every request.

“Serialized exploration estimate” measures the resulting messages and the exploration schemas. “Trace prompt” uses the prompt builder's conservative charge for the larger combat schemas. Neither includes a backend's hidden instructions or exact chat-template overhead.

| Configured window | Window minus response reserve | Serialized exploration estimate | Trace prompt / trace limit | History messages retained |
| ---: | ---: | ---: | ---: | ---: |
| 8,192 | 6,144 | 35,456 | 40,349 / 28,303 | 1 |
| 16,384 | 14,336 | 35,456 | 40,349 / 28,303 | 1 |
| 32,768 | 28,672 | 35,456 | 40,349 / 28,672 | 1 |
| 65,536 | 57,344 | 41,193 | 45,748 / 57,344 | 44 |

At 8K and 16K, even the **displayed trace limit exceeds the configured window**. The floor in `promptWindowTokens` creates a nominal minimum message allowance when the schemas already exceed the window. At 32K, the actual exploration estimate still exceeds the entire context, even before allowing an answer. The 64K example fits this estimate, but it is a simple exploration fixture rather than a worst case.

The default campaign's assembled standing rules measured approximately 11,969 tokens, larger than the 9,131-token base because the normal settings add other instructions. These are separate measurements, not contradictory totals.

## Findings and recommendations

### F01 — Enforce the actual request budget

**Confirmed.** [buildDmMessages](../src/lib/dm/prompt.ts#L1470) always admits the rules and game-state blocks. Only history is trimmed. [packBlocks](../src/lib/dm/context-budget.ts#L250), which supports ordered admission and donated budgets, has tests but no production caller under `src/`. The NPC floor helper is similarly not used to allocate an actual NPC block.

This is particularly relevant to unknown compatible endpoints, whose [fallback context is 16,384 tokens](../src/lib/model-client.ts#L208). Three additional behaviors undermine a hard limit:

- [promptWindowTokens](../src/lib/dm/context-budget.ts#L57) floors the message window at 3,072 tokens even when tools already consume the real window.
- [fitHistory](../src/lib/dm/context-budget.ts#L346) always retains the newest message even when its allowance is zero or smaller than that message.
- The token proxy does not count exact tool rendering, message framing, or provider-added instructions. It should not be treated as a conservative guarantee for every language or structured payload.

**Recommendation:** introduce a final request-sizing step shared by all text transports. Charge the actual selected tool set, mandatory rules, selected state, retained conversation, framing margin, and a task-specific generation allowance. Fit optional blocks before sending. If the irreducible request cannot fit, choose an authorized compact profile or return an actionable capacity error instead of relying on backend truncation. Keep player text intact in storage; use a clearly marked bounded view or request a shorter input when necessary.

Prefer a model/backend tokenizer where available, with cached counts for unchanged text. Otherwise calibrate the fallback against reported usage by model, language, and payload type, and keep explicit headroom. A token-counting network request on every turn could itself add latency; cache static counts or use it for calibration/preflight where appropriate.

The live builder also caps history at its preassigned share rather than using all unspent space. Fix allocation semantics, but do not automatically fill every large window: a smaller deliberate prompt can be the better latency choice.

**Acceptance:** exercise the real builder and every transport at 8K/16K/32K/64K with long accepted input, large state, and changing tool sets. Every emitted request fits, or fails before the model call with a clear capacity reason. Mandatory safety and engine rules remain present.

### F02 — Replace the large default tool surface with compact task profiles

**Confirmed.** The [tool list](../src/lib/dm/turn.ts#L729) is reduced for some modes/features, but still includes many unrelated operations. Exploration can include downtime, mounts, hazards, commerce, factions, pets, resource use, and raw sheet mutations on the same request. Some individual schemas are large: `request_roll` measured about 1,215 estimated tokens and `downtime` about 1,080.

The harness deliberately receives the full [97-tool union](../src/lib/dm/turn.ts#L804), since its clients read the catalogue once. Simply changing the current chat list will not solve the agent-program path.

**Recommendation:** design a small stable core plus deterministic profiles such as exploration, combat, commerce, and downtime. Select the profile from server state and structured player intent, avoiding an extra LLM classifier on every turn. Keep a bounded discovery/detail path for uncommon actions so trimming the list does not remove game capabilities. The existing connected-agent `odm_dm_tools` / `odm_dm_invoke` design is a useful precedent, though a single loosely typed catch-all can hurt small-model argument accuracy.

For the harness, use a stable compact dispatcher or a client-supported discovery mechanism, with server validation still deciding what is allowed now. For chat models, retain stable ordering within each profile and benchmark whether profile changes outweigh cache reuse on that backend.

Shorten repetitive schema descriptions and move unusual argument combinations into on-demand help. Preserve the details that prevent double spending, wrong targeting, or unintended player choices. Few-shot examples should be small and specific to the chosen profile.

**Acceptance:** common roll, attack, cast, movement, and social turns expose a small relevant set; rare actions remain reachable; malformed arguments and missed tool calls do not increase. Measure schema tokens, successful actions per turn, and total calls rather than only tool count.

### F03 — Modularize the instructions instead of carrying the whole rules manual

**Confirmed.** [dmSystemText](../src/lib/dm/prompt-rules.ts#L12) includes detailed instructions for summoning, class variants, dying, diseases, madness, downtime, shopping, and many spell paths on every turn. [encounterRulesText](../src/lib/dm/prompt-rules.ts#L70) adds another substantial block in fights. The [engine boundary](../src/lib/dm/engine-boundary.ts#L22) explicitly documents that overlapping instructions remain in the other blocks.

**Recommendation:** keep a concise permanent contract covering player agency, server authority, secrecy, refusal handling, and required tool use. Add mechanics guidance only when its tool profile, character capability, or current situation makes it relevant. Maintain one canonical source for each instruction so system text, schemas, and error messages do not repeat entire explanations.

Make the model choose what happens in the fiction and which engine action to request; keep arithmetic and mechanical validation in the existing engine. Retain counterexamples that evaluations show are necessary, rather than removing all examples to minimize characters.

**Acceptance:** compare the compact prompt against the current one on real game scenarios, including physical dice, reaction timing, concentration changes, unavailable capabilities, and private information. Token reduction counts as a win only if adjudication and player agency remain correct.

### F04 — Budget every continuation and align output caps with the available space

**Confirmed.** The prompt is sized once before [createDmTurn](../src/lib/dm/turn.ts#L587). The [model loop](../src/lib/dm/turn.ts#L900) subsequently appends assistant messages and [serialized tool results](../src/lib/dm/turn.ts#L1486), and resumes can append dice results and map updates. There is no request-wide refit before each call. Guard rewrites, whisper completion, and an empty-reply retry can add calls beyond the nominal four-call loop.

The response reserve starts at 2,048 and caps at 8,192 tokens, while the custom transport defaults to a [16,384-token output cap](../src/lib/model-client.ts#L54) and the local transport to 4,096. These caps are not clamped to the actual remaining window. A reserve is neither a bound on accumulated tool output nor a per-call reasoning budget.

**Recommendation:** recalculate remaining room before every continuation, resume, recovery, and rewrite. Give tool results compact model-facing projections, with handles for large details. Preserve original results in the audit trail. Never remove a tool result while leaving its assistant call unanswered, and keep the exact mechanical outcomes needed by the narration guard.

Add per-request `maxOutputTokens` and reasoning controls to `ChatRequestOptions`, then derive them from task requirements and available context. A short classification, JSON extraction, narration, and complex tool decision should not all inherit the same ceiling. Test a no-tools narration payload where supported; removing schemas can save room, but may also change the cached prefix, so compare total turn latency.

**Acceptance:** a turn that starts an encounter, retrieves memory, resolves several actions, parks for dice, and requires a rewrite fits at every call, with all call/result pairs and authoritative outcomes preserved.

### F05 — Compact before history falls out, and separate summary coverage from chapter closure

**Confirmed.** [Rolling compaction](../src/lib/dm/compaction.ts#L144) starts after 120 uncovered messages by default and folds 40 at a time. The prompt can discard much earlier messages before that threshold, especially on small windows. Before a chapter closes, those discarded messages may have neither an injected summary nor a closed-chapter scene index available to `recall_story`.

There is another continuity risk: [chapter-close](../src/lib/dm/chapter-close.ts#L335) proceeds with an empty summary when summarization is disabled or fails, then [advances the coverage watermark](../src/lib/dm/chapter-close.ts#L425). [cutCoveredHistory](../src/lib/dm/context-budget.ts#L339) subsequently removes covered text except for a six-message seam. The stored transcript remains available, but the ordinary next-turn prompt can lose continuity without a usable replacement summary. A long chapter's summarizer also sees only the [last 24,000 characters](../src/lib/dm/chapter-close.ts#L154), despite the watermark covering the whole chapter.

**Recommendation:** trigger compaction from tokens about to be evicted, leaving enough raw history for a coherent recent exchange. Track chapter closure separately from validated summary coverage. On failure, retain the previous memory plus a bounded extractive fallback, or leave coverage pending and retry in the background. Summarize long spans in budgeted batches before producing a chapter-level summary.

Preserve unresolved decisions, promises, named entities, and server-recorded milestones as structured memory with source sequence references. Do not repeatedly summarize authoritative HP, inventory, and spell slots into prose; read those from the live state. Protect early chapter events as well as the recent tail.

**Acceptance:** place a promise early in a long first chapter, use a 16K/32K profile, let raw history fall out, fail a summary call, and close the chapter. The next turn still has the promise or can retrieve its source; it does not rely on a successful model summary that never existed.

### F06 — Apply the same budgeting discipline to utility jobs

**Confirmed.** `utilityContextTokens` exists, but only Ask and lore-check currently call it. [Compaction](../src/lib/dm/compaction.ts#L155) sends a fixed 40-message batch plus the previous summary without checking the utility model's context. [Chapter summaries](../src/lib/dm/chapter-close.ts#L337) use fixed character limits plus previous chapters and facts. Other helpers likewise construct their own prompts and use the shared transport without a common budget.

Selecting a smaller utility model therefore does not ensure that its work will fit. [Utility fallback](../src/lib/dm/model.ts#L121) retries the same messages on the story model, which can hide the mismatch while spending more time and story capacity.

**Recommendation:** define a small task envelope for each utility job: stable instruction, essential input, input budget, expected output schema, output ceiling, and fallback policy. Use token-bounded batches for summarization and extraction. Fit against the chosen utility model and any fallback destination. For short read-only judgments, consider routing helpers that still use the story model—such as the [beat judge](../src/lib/dm/arc.ts#L482)—to the utility path after accuracy checks.

Capability-gated JSON Schema or grammar constraints can reduce unusable structured replies. Keep application validation and refusal/incomplete handling. The current options have no structured-response schema field, and the Responses tool converter sets `strict: false`. Official OpenAI documentation distinguishes schema-constrained output from basic JSON validity. [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

**Acceptance:** run compaction, chapter close, claims reading, Ask, and a beat judgment with a deliberately smaller utility window. Each job either batches/fits successfully or reports a capacity issue before generation.

### F07 — Build compact state views for the current task

**Confirmed.** [describeSheet](../src/lib/dm/prompt.ts#L396) includes complete capabilities, feature descriptions, feats, spell lists, equipment, and backstory. [Game state](../src/lib/dm/prompt.ts#L629) combines this with world background, party notes, NPC agency, relationships, chapters, and other state. Some sections have useful bounds, but there is no shared state budget that determines the minimum needed for this turn.

The NPC prompt takes the [first 20 unarchived entries](../src/lib/dm/prompt.ts#L931), without first ranking the roster by current location or current mention. Tactical context includes a [whole ASCII map plus PC-to-enemy and PC-to-PC distances](../src/lib/battlemap/serialize.ts#L67). That is useful grounding, but its size grows with the map and number of combatants.

**Recommendation:** introduce typed projections for an acting character, other party members, present NPCs, combat participants, and relevant world facts. Keep identifiers, current status, available actions, and important constraints in the compact view. Load detailed feature text, large inventories, distant NPCs, or the full map on demand. For combat, test an actor-centered view of legal targets, reach, cover, visibility, movement, and nearby hazards instead of making every model parse the whole grid.

Avoid a dangerous shortcut: do not hide most spells or items and continue labeling the displayed subset “complete.” Either retain a concise complete capability index or say that details are partial and expose a reliable lookup. Likewise, preserve precomputed distances or legal-action facts; pushing arithmetic back onto small models would undo an existing strength.

**Acceptance:** relevant actors always survive state pressure; unavailable spells/items remain unavailable; legal tactics and custom capabilities are discoverable; map and sheet tokens scale with the task rather than every stored detail.

### F08 — Make cache layout deterministic and model-specific

**Confirmed structure; savings need measurement.** The app already separates standing and moment state, and Claude Code has an explicit cache boundary plus settled transcript chunks. Chat-model movement of moment state after history is [opt-in](../src/lib/dm/turn.ts#L516), because the repository records worse tool calling on the default local model with that ordering.

Even with the split, the standing portion contains [date/time, relevance-selected arc text, shared party state, ambience, mounts, scene, location, NPC attitudes, and relationships](../src/lib/dm/prompt.ts#L665). Changes there occur before older transcript chunks and can invalidate reuse of everything after the first changed token. Sliding history and changing tool sets introduce additional prefix changes.

**Recommendation:** retain a stable versioned contract and stable profile schemas first. Separate campaign-static background, established memory, recent transcript, and live state by how often they change. Use deterministic sorting and formatting. Compare a few layouts per model instead of globally enabling `DM_MOMENT_AFTER_HISTORY=1`; retain the current layout where it is measurably more reliable.

Provider caching requires a matching eligible prefix; merely keeping similar meaning is insufficient. OpenAI enables caching on supported models, so the absence of a cache option does not mean caching is absent. Add provider-specific routing/retention/breakpoint options only when supported and useful for the selected model. [Official prompt-caching guidance](https://developers.openai.com/api/docs/guides/prompt-caching).

**Acceptance:** measure shared-prefix length and actual cached tokens over a recorded multi-turn session, including a scene change and chapter compaction. Compare total latency and correct tool-use rates, not cache-hit rate alone.

### F09 — Record the metrics needed to evaluate these changes

**Confirmed.** [TokenUsage](../src/lib/usage/parse.ts#L6) preserves only total input/output tokens. It omits cached tokens, cache writes where reported, reasoning tokens, and Ollama timing fields. The [ledger](../src/lib/usage/ledger.ts#L18) stores duration but lacks time to first visible token, queue time, and task/turn/call linkage. [ContextTrace](../src/lib/dm/prompt.ts#L1499) captures the initial planned prompt, not subsequent request growth.

The trace can also be mistaken for an exact wire count: it charges the larger chat tool set even on exploration calls, and its safety row is separately displayed although safety text is already within the first rules block. Adding all visible row costs therefore double counts safety. Utility work without a separate model is [metered through the story path](../src/lib/dm/model.ts#L103), making task attribution less clear.

**Recommendation:** record one metadata event for every model attempt: turn/call/task, actual model and endpoint class, planned and reported input, actual tool-set hash, cached input, cache writes if supplied, reasoning/output tokens, queue/start/first-visible/end times, finish reason, retry/fallback reason, and parse/tool success. Keep cache accounting distinct by provider rather than forcing all cache formats into “input tokens.” Mark unavailable measurements as unknown.

Extend the context inspector to show the actual selected blocks and per-call growth. Distinguish a conservative reservation from actual schema cost. No transcript logging is required for these metrics.

**Acceptance:** a slow turn can be attributed to queueing, model startup, prefill, reasoning, output generation, a tool, a reader, or a retry; cached input and initial-vs-final prompt size can be inspected independently.

### F10 — Reduce serial helper calls and prioritize interactive work

**Confirmed opportunities; latency impact unmeasured.** Claims reading uses a [utility model call](../src/lib/dm/claims.ts#L170), and the narration guard can add a [rewrite followed by another read](../src/lib/dm/narration-guard.ts#L113). Existing gates and `partReads` reuse already avoid some redundant reads. These calls are outside a simple count of the four main model-loop iterations.

Background compaction runs outside the campaign queue, which avoids directly holding that queue, but does not reserve inference capacity. [Queues](../src/lib/dm/queue.ts#L81) serialize by campaign key, not shared backend. The reference desk's separate key does not itself give a live game priority. [Utility fallback](../src/lib/dm/model.ts#L121) has no cooldown for an unhealthy configured utility endpoint, so each later helper can pay the same failure before falling back.

**Recommendation:** keep the existing targeted reader gates, then measure which read types dominate. Cache exact repeated reader requests with all relevant inputs in the key; reuse within a turn when the passage, requested claim kinds, and grounding are unchanged. Test combined structured helper outputs where one call can safely do related work. Keep outcome validation intact.

Use a bounded scheduler per inference backend, with interactive narration/required readers ahead of compaction, backfills, and optional generation. Limit queued work and preserve dependent mutation ordering. Add a temporary circuit breaker and a background health probe for repeated utility failures. A small utility model on the same memory-constrained GPU can still evict or compete with the story model; measure residency rather than assuming a second model is always faster.

OpenAI's latency guidance supports reducing generated tokens, serial requests, and unnecessary LLM work. Those are useful principles here, not evidence of a particular speedup on this app's local hardware. [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).

**Acceptance:** measure complete turns with concurrent tables and background work, including a failing utility backend. Foreground latency remains bounded and guard correctness does not regress.

### F11 — Make reasoning, sampling, and final narration controls consistent

**Confirmed.** The custom transport maps `thinking` into supported template arguments, but the [native Ollama transport](../src/lib/model-client.ts#L1139) uses the separate `disableThinking` option, defaulting to true, and does not map the loop's `thinking` setting. It also does not transmit `toolChoice`, even though the loop uses `toolChoice: "none"` to force its last narration call. Native-local requests use their own temperature path rather than the custom transport's per-role sampling resolver.

The harness likewise passes the same [configured effort](../src/lib/harness/bridge.ts#L713) to story and [utility completions](../src/lib/harness/bridge.ts#L779), despite having separate models for those roles. A claim reader's `thinking: false` is not equivalent to a provider-specific low-effort setting on that path.

**Recommendation:** define explicit model capabilities and map task intent to supported request controls. For example: bounded reasoning for tool decisions, low/no reasoning where supported for simple extraction, and a reliable tools-closed narration path. Offer separate utility effort where the harness supports it. Keep provider-specific defaults that evaluations justify; “disable all thinking” is not a safe general speed optimization for this app.

**Acceptance:** fake-backend transport checks verify the actual payload for each provider, then live evaluations verify tool fidelity, response length, and reasoning cost. Do not treat a shared option name as proof that every provider honors it.

### F12 — Cache retrieval preparation and retain the important end of the request

**Confirmed.** [buildMoment](../src/lib/dm/context-retrieval.ts#L47) clips each player message to its first 400 characters and the combined query to 1,200. A permitted 2,000-character action can put the actual question or named person near the end, outside retrieval. The WorldForge prompt path already [keeps both ends of recent messages](../src/lib/dm/turn.ts#L469), providing a useful local precedent.

Retrieval also [reads the full rules/lore corpus](../src/lib/dm/context-retrieval.ts#L119), builds IDF information, tokenizes text, and may embed the query again on later requests. The [embedder](../src/lib/embeddings.ts#L166) caches its loaded pipeline, but has no content-hash vector cache or coalescing for identical in-flight text. Foreground priority exists, but a large background batch already running cannot be interrupted.

**Recommendation:** preserve the newest complete intent within a bound, or use head/tail clipping plus referenced entities. Cache query vectors by embedding model/dtype and exact text, with bounded storage and shared in-flight promises. Cache parsed corpus text/IDF by campaign corpus revision and language. Invalidate on edits, deletes, pin/enabled changes, publication/visibility changes where relevant, and embedding-model changes.

Skip semantic work when all relevant rules are already forced/verbatim and no lore needs ranking. Use bounded background embedding batches so foreground queries wait for at most one small batch. Keep lexical fallback and rank fusion. Profile before adding a vector database: avoiding repeated corpus preparation may be enough at the current scale.

House-rule selection and rendering also use different budgets. The selector decides whether the whole document fits using the computed retrieval token allowance, but [the call to renderHouseRules](../src/lib/dm/context-retrieval.ts#L170) omits its budget argument, leaving a [fixed 1,200-character cap](../src/lib/dm/rules-logic.ts#L209). A synthetic five-chunk document was selected whole under a 1,000-token retrieval allowance, but only two chunks were rendered. Rendering stops at the first chunk that does not fit, even for a pinned/triggered chunk, without trying later shorter chunks or reporting the omission. The lore budget separately has an [800-character floor](../src/lib/dm/lore-selection.ts#L61), even when the retrieval share has been spent. Align selection, rendering, and final request accounting, and trace which rules were actually included.

**Acceptance:** an entity mentioned only near the end of a long move is retrieved; identical queries avoid duplicate embedding work; edits take effect immediately; background indexing does not create long foreground waits.

### F13 — Give connected agents compact and incremental read APIs

**Confirmed.** [agent-results.ts](../src/lib/agents/agent-results.ts#L10) already removes browser-only fields, summarizes other players' sheets, prioritizes current state, bounds JSON without breaking it, and supports transcript pagination. Those are valuable existing optimizations.

However, the normal cap is 60,000 characters—about 15,000 tokens by the app's proxy—for a single response. [odm_get_campaign](../src/lib/agents/workbench.ts#L90) has no requested view, result budget, or “changes since sequence” argument. Repeated reads can resend the same campaign, sheets, encounter, notes, and history. [workbenchTools](../src/lib/agents/workbench.ts#L423) filters tool exposure by grant scope, but otherwise sends every tool in each granted scope.

**Recommendation:** add small agent-oriented views such as status, active character, encounter, and recent messages, plus a requested maximum output budget. Add incremental reads tied to the existing sequence/version machinery, with a full refresh when a cursor is stale or has a gap. Retain safety pause, current floor, pending decisions, permissions, and action constraints in every actionable response.

Offer narrowly scoped connection presets and discoverable specialist tools. Do not remove needed permissions merely to reduce schema size. Cache read-only rule answers only with appropriate user/content/rules revisions in the key; never reuse a cached action result to execute a mutation.

**Acceptance:** a small-model player agent can learn whether it may act, read its latest decision, and fetch the details it needs without repeatedly consuming a 15K-token snapshot. Pagination and incomplete-view markers remain explicit.

### F14 — Preserve provider-native continuation items where supported

**Confirmed data loss; performance benefit needs a provider-specific evaluation.** [fromResponsesOutput](../src/lib/openai-responses.ts#L141) converts only message text and function calls into the generic chat shape. Other output items, including reasoning items, are discarded. [responsesPayload](../src/lib/openai-responses.ts#L186) reconstructs input from that shape with `store: false`, so those items cannot be replayed on the next tool step.

**Recommendation:** allow the Responses adapter to retain opaque provider continuation items separately from displayed narration. Replay the applicable items through a supported stateless continuation mechanism, preserving tool-call identifiers and bounding their lifetime to the relevant turn. Keep them separate from human-readable summaries and generic cross-provider fallback payloads.

Official OpenAI documentation describes preserving encrypted reasoning items with stateless responses. This is compatible with keeping server-side response storage off; using `previous_response_id` or enabling storage is not required merely to investigate the opportunity. It can improve continuity, but it is not automatically a context reduction: retained reasoning must also be budgeted according to the chosen model's behavior. [Reasoning and stateless continuity](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses).

**Acceptance:** a reasoning-model tool loop can round-trip its applicable provider items, survives pause/resume, does not expose them as narration, and is compared against the current conversion for quality, tokens, and total latency.

## Additional opportunities

These are smaller follow-ups or experiments, rather than prerequisites for the first compact profile.

1. **Invalidate context capability caches after backend changes.** [probeCustomContextWindow](../src/lib/model-client.ts#L279) caches both successes and misses for the process lifetime. A temporary startup failure or independent external-server restart can leave an outdated packing window until ODM restarts. Use a bounded TTL, explicit admin refresh, and refresh on context-related refusals; coalesce simultaneous probes. Keep explicit operator overrides authoritative.

2. **Connect chapter importance to prompt selection.** [renderChapterLod](../src/lib/dm/chapter-lod.ts#L81) accepts chapter importance, but [startDmTurn's chapter projection](../src/lib/dm/turn.ts#L546) does not populate it and the stored Chapter type has no such field. Scene importance already exists in the archive. Aggregate it for chapter selection, and test whether relevance to the current request should outrank keeping seven recent chapters in full. This can preserve better memory for the same token budget.

3. **Make pins and fixed-size allowances aware of small profiles.** Explicit memory pins are [capped at 3,000 estimated tokens](../src/lib/dm/pin-logic.ts#L19), already a substantial portion of an 8K window. Pinned facts [bypass the normal fact budget](../src/lib/dm/fact-logic.ts#L156). Keep the promise that accepted pins are retained; show their budget cost when selecting a smaller context and refuse an incompatible configuration instead of silently evicting them.

4. **Avoid repeated harness discovery startup.** A new harness run builds an isolated directory and starts a program. The Codex adapter runs [`debug models` on every start](../src/lib/harness/adapters/codex.ts#L199). Cache immutable parsed catalogue data for a short period, keyed by binary/version and relevant configuration, while retaining per-run isolation and lockdown checks. Measure this first. Sharing a long-lived campaign conversation or unisolated process is a much larger lifecycle change and should not be treated as a simple cache fix.

5. **Use short unambiguous references where repeated IDs dominate.** Compact server-issued actor references could reduce UUID-heavy tool arguments, map descriptions, and tool results. Resolve them to canonical IDs on the server and persist the mapping with the turn. Benchmark argument accuracy; collision-prone names or unexplained abbreviations can cost more repair calls than they save.

6. **Experiment with distillation after the interface is stable.** A compact tool surface and recorded successful action/result examples could support a small decision model or fine-tuned utility model. First establish an evaluation set and preserve the same server validation. This is a later experiment, not evidence that a smaller model can already run the current prompt reliably.

7. **Measure backend settings before changing them.** The documented llama-server setup already includes flash attention and quantized KV cache; native Ollama already requests a 30-minute keep-alive. These are not missing optimizations. Compare supported quantization, concurrency, residency, and speculative decoding only on the actual deployment/model, with quality and memory measurements. Increasing context allocation can increase memory/prefill costs; a larger window is a compatibility workaround, not the intended endpoint of this audit. [Existing backend setup](text-backends.md#the-recommended-dm-model-qwen36-35b-on-llamacpp).

## Suggested delivery sequence

### 1. Establish reliable sizing and measurements

- Add F09 metadata and per-call size accounting.
- Enforce F01/F04 across initial turns, tool continuations, resumes, and rewrites.
- Add input/output envelopes for utility jobs and a utility-failure cooldown.
- Keep the current full prompt as a comparison profile.

### 2. Build a usable small-context profile

- Implement the compact instruction contract and task-specific tool sets.
- Add compact actor/world state and reliable detail lookup.
- Trigger summaries before token eviction, with validated coverage and failure fallback.
- Route model selection by both capability and available context; parameter count alone is not a context-window measure.

A **proposed**, unvalidated 16K design target is about 1.5K tokens of core instructions, 2K of selected schemas, 2.5K of actor/live state, 1K of durable memory, 2K of recent dialogue, and 1K of retrieved context. That totals approximately 10K input tokens before framing, leaving roughly 6K for framing, reasoning, tool-result growth, and generation. This is an engineering target, not a claim that current behavior can be preserved at those sizes. An 8K profile would need further restriction and more lookup.

### 3. Optimize cache reuse and end-to-end latency

- Evaluate prompt layouts per provider/model, including tool-list stability.
- Cache retrieval preparation and repeated pure helper work with explicit invalidation.
- Schedule background inference behind interactive turns.
- Add compact/incremental external-agent reads and provider-native continuation support.

## Evaluation and completion criteria

Use repeatable game fixtures and a small representative set of actual models. Mock endpoints establish packing and request behavior; they cannot establish whether a small model understands the compact prompt.

Include exploration, combat, a mid-turn encounter start, custom features, long inventories, several companions/summons, physical dice pause/resume, private messages, shopping, a failed utility model, a failed chapter summary, and a long first chapter. Include at least one non-English table and structured/identifier-heavy payloads when calibrating token estimates.

Track:

- Initial and largest per-call input; schemas, rules, state, memory, and history separately.
- Actual cached input and cache writes where supplied; shared-prefix length as a diagnostic.
- Queue time, startup time, time to first visible narration, and complete-turn latency at p50/p95.
- Output/reasoning tokens and total model/helper calls per completed player action.
- Tool-selection accuracy, malformed/refused calls, corrective retries, empty replies, and guard rewrites.
- Memory recall, private-information handling, and player-agency correctness.

Compare equal game scenarios, not just prompts with equal message counts. Report quality alongside context savings. Do not weaken the deterministic rules engine, remove safety/secret boundaries, or bypass outcome checks to achieve a token target.

## Verification performed for this audit

- Read the repository instructions and relevant installed Next.js route/fetch guidance.
- Traced the production turn, prompt, budget, retrieval, compaction, harness, connected-agent, usage, and transport paths referenced above.
- Ran `node scripts/test-context-budget.mjs`: **25 checks passed**.
- Ran `node scripts/test-prompt-window.mjs`: **passed** its existing 48K mocked-backend checks, output-cap diagnostic check, and harness catalogue accounting check. It reported a handled claims-reader failure; these checks validate sizing/control flow, not narration quality.
- Executed temporary synthetic fixtures through the actual tool builders and `buildDmMessages`, including the four-character window sweep shown above. Temporary databases were removed.
- Reproduced the house-rule budget mismatch with the real selector and renderer: five chunks selected for verbatim inclusion, two rendered.
- Consulted official OpenAI documentation for caching, structured outputs, latency, and reasoning continuation; external links above support provider-specific recommendations.

No live model-quality benchmark, production timing study, or measured cache-hit comparison was performed. Speedups are therefore recommendations to test, not claimed results. Existing passing budget tests do not contradict F01: they largely exercise the standalone packer or a sufficiently large 48K fixture, rather than the small-window production cases reproduced here.
