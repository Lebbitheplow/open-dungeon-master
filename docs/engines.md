# How it works: the engines

Back to the [README](../README.md).

## How it works

- **The engines own the rules.** The model narrates and makes creative calls, but
  it can only touch game state through server tools that are clamped, audit-logged,
  and published live to every player. It treats player messages as intent, not
  outcome.
- **The AI drives the table.** It asks the server for rolls (`request_roll`), starts
  and runs combat, plays NPCs and AI companions, moves the party, and decides when
  to spotlight specific players for input.
- **It follows a secret story arc.** Every campaign gets a hidden spine generated at
  start and refreshed with a small clamped delta each time a chapter closes, so the
  plot advances without the model rewriting history. Player-safe pieces surface as
  the quest log; DM-only hooks stay hidden.

The authoritative ledger of exactly what is enforced, what is guidance, and what is
out of scope is [docs/rules-coverage.md](rules-coverage.md).

## Systems and engines

The app is a stack of about fifty focused engines. The split is deliberate: pure
rules math lives in `src/lib/srd/` (database-free, each with its own test), and the
server-side enforcement and tool handlers live in `src/lib/dm/`. The model narrates
and makes creative calls, but it never adjudicates: every number below is computed
and clamped by code.

### Combat (server-enforced)

- **PC attack engine** - resolves player weapon and spell attacks: weapon pick, to-hit, damage, AC adjudication, and feature riders.
- **Enemy damage and enemy attack engines** - the single server path for damage landing on an enemy and for monster attacks rolled against PC AC; also owns encounter-finish.
- **Death and dying engine** - death-save state at 0 HP, auto-rolled saves on skipped turns, massive-damage instant death, and stabilize/heal clears.
- **Conditions engine** - the SRD condition table with round and save-ends durations and resistances, plus a named buff-condition registry (Bless, Shield of Faith, and the like).
- **Concentration engine** - casting sets and breaks it, incoming damage forces the CON save server-side, and dropping to 0 HP ends it.
- **Action economy and multiattack engine** - the per-turn action/bonus/reaction budget, Extra Attack, once-per-turn riders like Sneak Attack, Dash/Disengage, and Haste.
- **Opportunity attack engine** - fires when a token leaves an enemy's reach and resolves the reaction attack server-side.
- **Spell and cast engine** - derives save DC, half-on-save, damage type, and applied conditions from data; covers cast-at-enemy, cast-at-player, area-of-effect, and buffs.
- **Aura engine** - position-aware Aura of Protection reaching nearby allies on the battle map, non-stacking.
- **Initiative and encounter engine** - deterministic initiative order, enemy spawning, and the encounter turn pointer.

### Character sheet rules

- **Sheet derivation engine** - central compute of AC, saves, spell attack and DC, and passive scores from what the character actually is and wears.
- **Armor and AC engine** - the SRD armor table plus AC math (DEX caps, STR requirements, shields), shared by the server and the character builder.
- **Weapons engine** - the SRD weapon table with proficiency and the properties (finesse, thrown, reach, ammunition) the attack engine reads.
- **Class features engine** - grants SRD and genre-class features by level and subclass, including subclass always-prepared spells.
- **Feature effects engine** - turns feature names into typed mechanical riders (fighting styles, damage riders, defenses) and parses authored prose into them.
- **Class resource pools engine** - Rage, Ki, Channel Divinity, Second Wind, Lay on Hands, Bardic Inspiration and the rest: counts, recharge type, and effects.
- **Spell scaling engine** - cantrip tier scaling and per-slot damage and heal increases derived from SRD data rather than trusted to the model.
- **Class options engine** - invocations, maneuvers, metamagic, pact boons, infusions, runes, and disciplines stored as choice-sourced features.
- **ASI and point-buy engine** - ability-score-improvement thresholds (cap 20) and the standard 27-point point buy for creation.
- **Rest engine** - short and long rest math: hit-dice recovery, slot and resource refill, and condition pruning.
- **Multiclass engine** - ability prerequisites both ways, the shared multiclass slot table, per-class caster contribution, and a 3-class cap.

### Transformations, pets, and companions

- **Transformation and polymorph engine** - real beast stat blocks for Wild Shape and Polymorph, with overflow damage and form reversion.
- **Pet and familiar engine** - familiars, the Beast Master companion, the Drakewarden drake, and story pets, each validated against its source feature.
- **Companion engine** - full companion characters with their own sheet and bot user, added to initiative and the battle map and auto-leveled with the party.

### Items and anti-cheat

- **Magic item effects engine** - mechanical items (AC, save bonuses, resistances) gated by carried, equipped, and attuned state, feeding the same AC engine.
- **Consumables and items logic** - healing-potion tiers, generic consumable detection, and ammunition lookup.
- **Sheet mutation guard** - a server ceiling on DM-driven sheet edits that blocks illegitimate level, HP, gold, ability, and XP jumps no matter how the model is prompted.
- **Inventory approval engine** - an optional mode that turns DM inventory and gold changes into player-approved proposals instead of applying them immediately.

### Leveling and XP

- **XP and leveling engine** - the XP thresholds and level-for-XP math (the level-up itself is applied through the player's own in-app flow).
- **Milestone XP engine** - chapter-close awards, so roleplay-heavy campaigns still level.

### World simulation

- **Overworld and region map generation** - seeded value-noise terrain on a 96x72 grid with genre reskins, reconciling locations to anchors lazily as the party travels. A room or street the DM files under a bigger place (move_party's partOf, or a name that opens with the place's own) shares that place's dot; a new place lands at the direction and distance the DM gave; names on the map make way for each other (src/lib/overworld/places.ts, label-layout.ts).
- **Battle map generation** - seeded tactical maps (terrain, lighting, spawns, line of sight and cover, movement budgets, pathfinding), regenerable from the encounter.
- **Location persistence** - structured per-area layout, exits, and connections so narration stays spatially consistent, plus an illustrated top-down map image.
- **Living-world tick engine** - a zero-model-call heartbeat that advances world state on dice and computes encounter pressure after each narration.
- **World arcs** - one or two escalating off-screen storylines that advance whether or not the party engages them.
- **NPC agency** - once-per-chapter goal advancement for every tracked NPC with no model call, surfacing outcomes as rumors and world facts.
- **World facts register** - authoritative player-visible and DM-only facts extracted from play and fed to prompts as canon or rumor.
- **Social and NPC attitude system** - attitudes tracked across sessions and `social_check` rolls against attitude-derived DCs that can shift them.
- **NPC roster hygiene** - NPCs the party has ignored for chapters archive out of the prompt and restore on a name mention, and close name matches the engine refuses to merge on its own ("Aldric" and "Alaric") queue for the lead to merge, rename, or dismiss. Merging keeps the old spelling as an alias; it never rewrites past narration.
- **World utility engines** - CR-scaled treasure moved into real purses, object durability, and forced-march exhaustion via real CON saves.

### Narrative

- **Story arc and saga engine** - a three-tier secret spine (campaign-spanning saga, current-act beats, quest-scale sub-arcs) refreshed with clamped deltas and sequel chaining.
- **Chapter engine** - chapters close on completed story beats rather than message volume, triggering XP, fact extraction, NPC agency, memory indexing, and a snapshot.
- **Recap and compaction** - a rolling campaign summary and history compaction that keep prompts bounded.
- **Chapter rewind and snapshots** - a full world-state snapshot at each chapter open; a lead-confirmed rewind restores a boundary after taking a safety copy.
- **Narration reroll** - the lead rerolls a DM paragraph with optional guidance ("darker", "more dialogue") and browses the takes. Only the words change: the dice, the sheets and every resolved outcome stay byte-identical.
- **Continue scene** - extends a narration that stopped short, in place. Not a turn: no counters, no chapter close, no world tick.
- **Inline narration edit** - the lead fixes a typo or a wrong name directly, with every dice-roll marker preserved across the edit or the save refused.
- **Director controls** - a one-turn steer the lead arms from the Direct composer mode: a canned event type, or a free-text direction sent privately, consumed exactly once. Players see that something is armed, never what it says.
- **Arc beat editor** - reword, reorder, skip, set `[NOW]`, or add a single main beat instead of regenerating the whole spine. Beats that already played are immutable; they are a record, not a plan.
- **Story export** - finished campaigns and chapters exported to DOCX, ODT, or HTML.

### Memory and retrieval (RAG)

- **Semantic recall and memory index** - MiniLM by default (384-dim) two-phase recall over chapter summaries then verbatim scene chunks, behind the `recall_story` tool.
- **World lore builder** - lead-authored, embedded canon retrieved per turn, with `search_lore` searching lore, facts, notes, chapter memory and an imported storyboard's prep cards at once, answering with the passage nearest the query; `read_card` opens the whole card behind a beat or a planned event (docs/workshop-portability.md).
- **House rules and rules manager** - embedded house-rules text plus structured variant toggles, retrieved into the prompt's variant and house-rules blocks.
- **Per-turn context retrieval** - embeds the current moment once and rides only the most relevant rule chunks into the prompt; world lore keeps every entry that matches closely (the players naming it, the scene naming it, its words, or its meaning read against both the moment and the players' words), up to six, inside a budget measured from the prompt window, shortening excerpts before leaving any out and naming what it left out. The lead's Context panel lists each entry kept or held back and why (issue #305, `src/lib/dm/lore-selection.ts`).
- **Lore check** - a player-flagged consistency verifier that returns a verdict, citations, and a suggested rewrite.
- **Pinned memories** - select a passage in any DM message and pin it; pins ride in every prompt under a hard token cap, and a pin that would blow the cap is refused rather than silently evicting an older one.
- **Token-aware context budget** - per-section allocation with floors against the model's real context window, replacing a flat character count, with stable blocks ordered before volatile ones for prefix-cache hits.
- **Context inspector** - a lead-only panel showing exactly what the DM was sent last turn, block by block, with token cost and the reason anything was dropped.
- **Importance-tiered chapter LOD** - sealed chapters render as a full summary or a one-line synopsis by recency and importance, and degrade by tiering down before anything is dropped, so an old but pivotal chapter outlives a recent forgettable one.
- **House-rule trigger keywords** - a rule reachable only by a word the party rarely uses no longer has to out-score everything else for one of three retrieval slots; a keyword hit admits it outright. Small enough rules documents skip retrieval entirely and ride whole.

### AI and LLM integration

- **Model client (dual provider)** - streaming against an OpenAI-compatible `/chat/completions` server (llama.cpp, LM Studio, vLLM, OpenAI, OpenRouter) or a local Ollama.
- **Agent programs as the DM** - Claude Code, Codex, opencode or Grok Build, signed in on the server's computer, narrate on their own subscription. The program is started with none of its own tools; its only tools are the turn's DM tools over the server's MCP endpoint, so the same engines roll and clamp ([docs/agent-harness.md](agent-harness.md)).
- **Connected agents** - your own Claude Code, Codex or other MCP client connects to the server as you, scoped by a revocable token, to read campaigns, play your character or run a table from the DM seat.
- **DM turn engine** - a persisted park/resume state machine and tool-calling loop (up to four rounds) that salvages malformed tool calls and streams filtered narration.
- **DM prompt and tool families** - a rules-as-tools system prompt covering rolls, checks, encounters, casts, resources, rests, conditions, items, hazards, NPCs, notes, maps, and world.
- **Engine boundary contract** - one explicit block naming the eight classes of fact the engine owns, so the model writes the prose and never the math.
- **Halted-turn retry** - a crashed turn no longer wedges the table. The lead sends it back in and it resumes from the persisted conversation, so nothing is re-rolled and no context is lost.
- **Context-window detection** - the real window is read from the server (llama.cpp `/props`, including the `--models-preset` router) rather than assumed, and cached per base URL and model.
- **Per-role sampling** - separate story and utility sampling with named profiles, and a cloud-safe versus local-only parameter split so a local-only key never reaches a strict endpoint.
- **Per-stage engine toggles** - every optional pipeline stage (compaction, recall, retrieval, chapter summary) is switchable per campaign with an engine-versus-model cost badge.
- **Background-work visibility** - compaction, chapter seals, world ticks, lore checks and Asks surface as labelled chips with elapsed time instead of an opaque wait.
- **TTS narration** - local Kokoro renders each DM message on the serial media queue, autoplayed latest-only with per-user mute.
- **STT push-to-talk** - proxies audio to a local faster-whisper service, kept off the network.
- **Portrait generation** - a one-shot ComfyUI character portrait at creation, with an icon fallback.
- **Table language** - each campaign plays in one of 15 languages (English, Danish, Dutch, Finnish, French, German, Hungarian, Indonesian, Irish, Italian, Norwegian, Portuguese, Russian, Spanish, Swedish). The DM narrates and every prose call writes in it; nothing reads story text through English word lists: one utility call per narrated reply reads its claims (a hit, a kill, a spell, a roll asked in words, a sentence where the DM talks to itself about its next steps instead of telling the story) for the engine to check or keep off the table, word matching stems with each language's Snowball stemmer and stop list, and a place's kind of scene is picked from a list rather than read from its name. Rules names, the interface and the SRD rulebook stay English, image prompts are rewritten into English, and a non-English table needs a multilingual embedding model (below).

### Human DM and the workshop

- **Viewer roles and caps** - one pure decision for who sees the secret arc, real enemy numbers, and the unfogged map: the lead at an AI table, the DM seat at a human one.
- **Adjudication facade** - a catalog of 64 engine adjudications the human DM invokes from the console, the same handlers the AI reaches through tools.
- **Assisted-mode delegation** - the DM hands the AI the monsters' turns, beat read-alouds, or a counted cover stretch while they step away; the AI spends one answer per turn it takes.
- **Story-beat capture** - a cadence nudge reminds the DM to jot beats between voice narration, and beats feed the same chapter summaries, recaps and exports an AI table gets.
- **DM console panels** - initiative editing, bestiary and NPC forges, a map studio and map library, roll tables, encounter prep with live difficulty, odds, effects and scene tracking.
- **Roll visibility** - public, DM-only, blind and self rolls, redacted rather than hidden so a secret roll still visibly happened.
- **Workshop kind** - a campaign row that never plays: same content tables, same editors, no AI turns, measured against a stand-in target party.
- **Content import** - a transactional planner/executor pair copies lore, locations, maps, NPCs, encounters, tables, storyboards and house rules from a workshop or campaign into a new campaign, renumbering collisions.
- **Cloning** - whole workshops and campaigns clone (prep travels, transcript does not), library characters duplicate, and individual assets copy in place.

### Live table audio and dice

- **Voice SFU** - in-process mediasoup with floor-aware turn taking, side rooms, hand raising, and optional proximity, whisper/shout range, wall attenuation and downed-deafness rules.
- **Ambience engine** - a 65-cue catalog in three layers (bed, music, sting) driven by the AI's tools, the DM's hand, or scene inference, with per-listener volume and TTS ducking.
- **Dice sources** - per die shape, each player picks typed physical entry, a server roll, or a paired Pixels Bluetooth die; rolls auto-submit when no die needs typing.

### Platform and multiplayer

- **Event bus (SSE)** - per-campaign publish/subscribe, the real-time multiplayer backbone.
- **Media queue** - a global serial GPU queue (one ComfyUI or TTS job at a time) since the iGPU shares memory with the DM model.
- **Whispers and side-chat** - one-way DM-to-player whispers and private player-to-player threads that never enter the DM prompt or the shared stream.
- **Ask, and the note back** - out-of-character questions answered from the campaign record without moving the story, plus a one-turn note a player can hand the DM. The note is drafted from your own thread, shown in an editable box, and only sent once you confirm the exact text.
- **Turn, lead, and pending-roll flow** - lead controls, turn coalescing, and parked physical-dice roll requests.
- **Auth** - session cookies with scrypt hashing, optional Discord OAuth, and reverse-proxy-aware origin resolution.
- **Login throttle** - a per-username-and-IP lockout with backoff.
- **Admin panel and global config** - admin-gated settings with database-over-env-over-default precedence and a sign-ups toggle.
- **Encrypted storage** - single-writer SQLite encrypted at rest (ChaCha20) alongside the read-only Open5e content pack.
