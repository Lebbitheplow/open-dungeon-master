# Human-DM mode: phased implementation plan

Status: Phases 1 to 8 are built. Phase 1 is the DM seat, the mode switch and
the viewer model; Phase 2 is the adjudication façade, the catalog, the DM
console, roll modes, the damage tray, mob grouping, the party award and DM
floor control; Phase 3 is story capture, the drafter and the nudge; Phase 4
is the assist rail, property attribution, roll tables and the statblock
lookup; Phase 5 is the map studio, the terrain brush, exploration scenes,
prepared encounters and overworld authoring; Phase 6 is board handling,
ad-hoc and hidden tokens, initiative editing, the drag ruler, pings and
measured templates; Phase 7 is assisted mode, the delegation toggles, the
delegated monster turn, spoken beats and covering for a DM who steps away.
Both table rules from 3.4b are in too: ammunition, and encumbrance on real
item weights imported into the content pack. Phase 8 is the cross-cutting
engine work: active effects, the in-world clock, the party entity, coins in
more than one denomination, unidentified items, mounts and vehicles, scene
trackers, freeform attributes and the assistant DM seat. Sections 0 to 5 are the standing research and design
record.

Goal: let a table create a campaign where a person runs the game. The AI
writes no narration. The server keeps being the rules engine, players submit
intentions through their own menu, and the DM gets a console for
adjudicating, rolling, spawning, mapping and summarizing.

---

## 0. What we may reference, and what we may not

Three repositories were checked. The answers differ, and they shape the plan.

### Foundry Core: documentation yes, code no

`foundryvtt/foundryvtt` on GitHub contains no source code. It holds
`.github`, `README.md`, `articles` and `releases`. It is the public issue
tracker plus the **documentation source**. The core application is
proprietary; the EULA states you "may not separately sell, market,
distribute, lend, lease, rent, or sublicense the software," permits backup
copies but not their distribution, and allows packages that reference core
code only when they cannot "function in the absence of the base software."

So we cannot copy Foundry Core code, and there is no published code to copy
even if we wanted to. What we **can** do, and what Section 2 below does, is
read the public articles (`articles/combat.html`, `users.html`, `chat.html`,
`pings.html`, `roll-tables.html`, `tokens.html`, `journal.html`, and the
rest) as a specification of what a mature GM toolkit does. Feature sets,
workflows and UI affordances are not protected expression. This is the right
reference for "fully featured and up to spec," and it is where Section 2's
parity matrix comes from.

### foundryvtt/dnd5e: MIT, and the reference we actually wanted

This is the find that changes the plan. `foundryvtt/dnd5e` is the official
5th Edition system for Foundry, and its `LICENSE.txt` is plain MIT
(Copyright 2021 Andrew Clayton). 581 stars, 341 forks, roughly 340 MB, years
of production use at thousands of tables.

It is a better reference than Crucible in every way that matters here:

- It is **the same ruleset ODM implements**. Attack rolls, AC, saves, spell
  slots, CR, conditions, rests, concentration. Its edge cases are our edge
  cases.
- It is **MIT**, so we may read it, adapt it, and even copy portions with the
  copyright notice preserved. Any substantial borrowing gets an entry in
  `docs/LICENSES.md`, which already exists for exactly this purpose.
- Its **Activity system** (`module/data/activity/`) is the declarative
  "action as data" model this plan needs, already specialized to 5e:
  `attack`, `save`, `damage`, `heal`, `check`, `summon`, `utility`, `cast`,
  `enchant`, `transform`, `forward`, `order`. Every activity shares a base
  schema of activation, consumption targets, duration, range, target, uses,
  and applied effects. That is a proven shape for Phase 2's adjudication
  catalog, and we do not have to invent it.

### foundryvtt/crucible: cannot be used

Covered in the previous revision of this plan and unchanged. Its LICENSE
grants permission "only to install and use the game system within the Foundry
Virtual Tabletop software," with no permission to modify, distribute or
otherwise use the software or its data. It is also a different game (no d20,
no AC, no spell slots, no CR), so adopting it would mean discarding
`src/lib/srd/*`, the bestiary, the Open5e content DB and their tests. Its
design ideas remain instructive, but with dnd5e available under MIT there is
little reason to reach for it.

### foundryvtt/worldbuilding: MIT, small, useful

Unchanged from the previous revision. Freeform typed attributes with groups,
about 200 lines to reimplement. Phase 8.

---

## 1. The core insight this plan rests on

ODM already separates the rules engine from the narrator.
`src/lib/dm/engine-boundary.ts` says it outright:

> The server is the rules engine and you are its voice. It rolls the dice,
> adjudicates the attacks, and holds every number on every sheet and stat
> block.

The AI DM is a *voice plus a tool caller* bolted onto that engine by
`src/lib/dm/turn.ts`. Human-DM mode is not a parallel game system. It is
**swapping the caller**: a person picks the tools, a person writes the prose,
and every mechanical consequence still runs through the same handlers, still
writes `sheet_audit`, still publishes the same events.

That is why Phase 2 is the centerpiece. Extract one invocation façade both
callers share, and the console is mostly UI.

---

## 2. Deep dive, part one: the GM workflow surface

Read from the Foundry Core articles and the dnd5e system, then checked
against this codebase. This is the "up to spec" audit for GM tooling.
Section 3 audits the rules and data layers separately.

### 2.1 Encounter and turn management

| Capability | ODM today | Gap |
| --- | --- | --- |
| Create / end encounter | `start_encounter`, `end_encounter` tools | DM-facing UI only |
| Add combatants from the board | Enemies spawn with the encounter | **Built in Phase 6.** `dm/initiative` inserts a named slot and removes any entry |
| Roll initiative individually | `recordInitiativeRoll`, staged in `order_json` | DM-facing UI only |
| Roll all / roll all NPCs, leaving PCs to roll their own | Not separable | **Already the behaviour.** Enemy initiative rolls silently at spawn in `start_encounter` and `add_enemies`; players roll on request |
| Reset initiative | No | **Built in Phase 6.** `dm/initiative` with `op: "reset"` |
| Next turn / next round | `advanceAfterTurn`, `skipCurrentTurn` | DM-facing UI only |
| **Previous** turn / round (rewind) | No | **Built in Phase 6.** The pointer and the round only; the world stays where the fight left it, which is what `audit/revert-turn` is for |
| Hidden combatant (GM sees, players do not) | No | **Built in Phase 6.** One `battle_tokens.hidden` flag covering the map and the tracker |
| Mark defeated, skip defeated | `EnemyStatus 'dead'/'fled'` exists | Wire to turn skipping and expose |
| Multiple simultaneous encounters | `getActiveEncounter` returns one | Rare at a real table. Defer |
| Tracker shows a chosen resource | Health states only for players | DM view shows real HP (Phase 1) |
| Players end their own turn, GM ends NPC turns | `end-turn` route plus the initiative floor | Already correct |

### 2.2 Rolls and the chat log

| Capability | ODM today | Gap |
| --- | --- | --- |
| Public roll | Every roll | Fine |
| **GM roll** (GM and roller see it) | No | **Missing** |
| **Blind roll** (GM sees, roller does not) | No | **Missing, and important.** Secret perception, secret insight, secret saves. A human DM will ask for this within the first session |
| Self roll | No | Minor |
| Roll config at roll time (advantage, situational bonus) | `advantage` on the request; no ad-hoc bonus | Add a modifier field |
| Request a roll from a player | `request_roll`, `pending_rolls`, `PendingRollCard.tsx` | DM-facing UI only |
| Group check | `group_check` in `check-tools.ts` | DM-facing UI only |
| Passive scores | `check_notice` | Show the DM a passive column |
| Roll damage, then apply to chosen targets at full / half / double / none | Damage is applied by the tool that rolled it | **Missing as a workflow.** dnd5e's `damage-application.mjs` is the model: roll first, then the GM clicks who eats it and at what multiplier |
| Whisper to one or many, with `gm` and `players` aliases | `dm_whispers` one-to-one | Add multi-target |
| GM cannot read whispers they are not part of | `side_messages` are structurally invisible to the AI DM | Already correct, and worth preserving for the human DM too |
| Export / clear the log | `/export` exists | Fine |

Roll modes are the highest value-per-line item in this whole document. The
`rolls` table already stores every roll; this is a `visibility` column plus a
filter in the events projection.

### 2.3 Permissions and roles

Foundry has two orthogonal layers, and the second is the one ODM lacks:

- **Roles**: None, Player, Trusted, Game Master, Assistant. "Assistant" is a
  co-GM with in-game powers but no world-settings access. Worth having: a
  second person running monsters while the DM runs story.
- **Per-document ownership**: None, Limited, Observer, Owner, set on each
  actor, item, journal entry and table. Visibility is a property of the
  object, not of the viewer's role.

ODM has `owner` / `player` membership plus an ad-hoc party-lead check, and
every feature invents its own visibility rule (`publicEncounter` strips
numbers, the battle-map GET fogs per character, `publicCampaign` strips the
arc, side chats are invisible by construction). Those rules are individually
good. The risk when a DM viewer appears is that each one grows a branch and
one of them gets it backwards.

**Recommendation**: do not build a full ownership matrix. Do introduce a
single `viewerRole` type (`player | lead | dm | ai`) threaded through every
projection function, so the decision lives in one place and is testable as a
pure function. This is Phase 1's main design constraint.

### 2.4 Content and improvisation aids

| Capability | ODM today | Gap |
| --- | --- | --- |
| Compendium browser with filters | Content DB plus pickers in the character builder | Reuse the picker for a DM-side monster/item/spell browser |
| **Roll tables** (random tables the GM rolls on) | **Built in Phase 4.** `roll_tables` plus the Tables tab in the console | It is where AI generation shines without touching narration: "generate a rumour table for this port town," DM edits, DM rolls on it forever after |
| Journal entries with per-page visibility | `campaign_notes`, `lore_entries` | Add DM-private pages and reveal-to-party |
| Map notes pinned to a scene | Overworld pins exist; no notes on battle maps | Small addition |
| Award XP and currency to the party | `award_xp`, `modify_gold` per character | dnd5e's `award.mjs` splits across the party in one dialog. Do that |
| **Property attribution** ("why is this AC 17") | `computeSheetDerived` computes it, never explains it | **Missing.** A human DM will not trust a number they cannot audit. This is a trust feature, not a nicety |
| In-world calendar and clock | Nothing | **Missing.** Rests, travel, spell durations and the world simulation all implicitly need a date. dnd5e ships `applications/calendar/` |

### 2.5 Board interaction

| Capability | ODM today | Gap |
| --- | --- | --- |
| GM sees the whole board unfogged | Per-character fog everywhere | **Built.** `buildPlayerMapView` with `fullVision`, granted by `caps.fullMap` |
| GM drags any token | Move route enforces ownership, turn and budget | **Built in Phase 6.** `dm/board` with `do: "place"`, which never writes `moved_this_round` |
| Neutral NPC and prop tokens | `battle_tokens.kind CHECK IN ('pc','enemy')` | **Built in Phase 6.** The table was rebuilt for `'npc'` and `'prop'` |
| Reveal / hide a token from players | No | **Built in Phase 6.** The same flag as the hidden combatant above |
| Drag ruler showing remaining movement | `battlemap/movement.ts` has path and budget math server-side | **Built in Phase 6.** The same `findPath` run client-side over the viewer's own projection |
| Token HUD (right-click: HP, conditions) | Conditions live in panels | **Built in Phase 6.** Opens on a click, so it works on a tablet |
| **Pings**, including a GM ping that pulls every camera to a spot | Nothing | **Built in Phase 6.** One ephemeral `map_ping` event; the focusing kind opens the board on every client |
| Measured templates (cone, sphere, line) | AoE resolved in `aoe_damage` without a visual | **Built in Phase 6.** `battlemap/template.ts`, stopping at walls, handing back the ids `aoe_damage` takes |

### 2.6 What ODM has that Foundry does not

Worth stating, because it is where this project should keep its identity and
should not be redesigned toward VTT convention:

- The server is authoritative and the client is never trusted with secrets.
  Foundry ships the whole world to the client and hides things in the UI
  layer. ODM's fogged projections are stronger, and the DM view must not
  weaken them.
- A complete audit trail (`sheet_audit`) with undo and per-turn revert.
- An AI that can take over any part of the job, which is Phase 7.
- Structured story memory (chapters, embeddings, facts, arcs) that no VTT
  has, and which Phase 3 exists to keep alive.

---

## 3. Deep dive, part two: what the earlier dnd5e pass did and did not cover

A previous pass already mined `foundryvtt/dnd5e` for rules mechanics, and it
went deep. `docs/rules-coverage.md` is the record: 225 lines, with
`scripts/test-feature-coverage.mjs` failing the build if a class feature or
racial trait reaches a sheet with no effect, resource, or acknowledgement.

The honest summary of where that leaves us: **the rules-mechanics layer is
well covered, and the two layers underneath and above it are not.** That is
not an oversight in the earlier work. A GM-workflow layer had no consumer
when there was no human GM, and a declarative action model had no consumer
when every adjudication was a hand-written AI tool. Both now have one.

### 3.1 Already covered (do not redo)

Verified present in the codebase, not merely claimed in the doc: attack
resolution with fighting styles, Extra Attack, Sneak Attack, Divine Smite and
maneuvers; crits including the Powerful Critical and Critical Damage Mods
variants; the full action economy (`dm/action-budget.ts`); opportunity
attacks both directions; cover and long-range disadvantage from real line of
sight; surprise; conditions with durations, save-ends and riders; exhaustion;
death saves; concentration on both PCs and enemies; spell slots with pact
magic, scaling, upcasting and structured per-spell mechanics; buff spells as
tracked conditions; 386 class-resource counters across SRD, genre and
authored layers; Wild Shape, Polymorph, familiars and companions;
multiclassing end to end; travel pace with forced-march exhaustion; traps,
hazards, falling, suffocation, extremes of temperature; object durability;
treasure by CR; NPC attitude with reaction rolls; group checks and passive
checks; magic items with attunement caps.

Two more things dnd5e does that ODM already does, which are easy to
mistakenly re-plan: difficult terrain costing double is implemented in
`battlemap/movement.ts moveCost`, and AC already explains itself through
`srd/armor.ts acBreakdownFor`.

### 3.2 Missing, and specifically needed by a human DM

| dnd5e reference | ODM today (verified) | Why the human DM needs it |
| --- | --- | --- |
| `documents/combatant-group.mjs` | `encounters.order_json` is a flat array; no grouping anywhere in `encounter-tools.ts` | **Mob initiative.** Eight goblins on one initiative entry is how a real DM runs a fight. Without it the tracker is unusable past about six enemies |
| `data/actor/encounter.mjs` | Encounters are built live only (`start_encounter`, `handleAddEnemies`) | **Prepared encounters.** Built in Phase 5: `encounter_templates` rows deploy through the same `start_encounter` façade call a typed roster makes |
| `applications/components/damage-application.mjs` | Damage is applied by whichever tool rolled it | Roll first, then choose who eats it at full / half / double / none. The single most repeated combat gesture |
| `applications/award.mjs` | `award_xp` and `modify_gold` are per character | Split a hoard and a fight's XP across the party in one action |
| `applications/property-attribution.mjs` | **Built in Phase 4.** `computeSheetDerived` returns the parts it summed, for saves, skills, initiative, passive Perception and the spell DC and attack | A DM will not trust an engine they cannot audit. `acBreakdownFor`'s pattern, generalized |
| `templates/identifiable.mjs` | `equipmentItemSchema` has `equipped` and `attuned`, no `identified` | Handing over "an unmarked wand" and revealing it later is core DM craft. One boolean plus a reveal action |
| `shared/currency.mjs`, `currency-manager.mjs` | `gold` is a single integer | "You find 340 silver" has no representation. Multi-denomination with conversion, or at minimum a display layer over copper |
| Roll modes (`chat.html`) | Every roll is public | Blind and GM-only rolls. See 2.2; this is the highest value-per-line item in the document |
| Hidden combatants and tokens | No concept | The ambusher who is not on the players' tracker yet |

### 3.3 Missing, and worth having regardless of who runs the game

| dnd5e reference | ODM today | Note |
| --- | --- | --- |
| `data/activity/*` (attack, save, damage, heal, check, summon, utility, cast) | Adjudications are hand-written tools across ~15 modules | The declarative action model. Phase 2's catalog and Phase 8's cleanup both point here |
| `data/calendar/*` | **Nothing.** No date, no clock, no elapsed time anywhere in `src/lib` | `srd/travel.ts` counts hours inside a day and then discards them. Rests, spell durations, downtime and the world simulation all implicitly want a calendar |
| `data/actor/group.mjs`, `templates/group.mjs`, `travel-field.mjs` | No party-level entity; no party gold or shared inventory | A party actor would give travel, shared funds and party XP one home instead of N sheets |
| `data/item/container.mjs`, `mountable.mjs`, `data/actor/vehicle.mjs` | None | Containers, mounts and vehicles. Mounted combat is PHB; the rest is lower priority |
| `region-behavior/difficult-terrain.mjs` | Difficult terrain exists as a tile cost, but is generator-placed | Built in Phase 5: the map studio's brush paints any terrain char onto the live board, validated by `src/lib/battlemap/paint.ts` |
| `data/advancement/scale-value.mjs` | Handled per feature in `feature-effects.ts` | Working today; only worth revisiting if the long tail grows |

### 3.4 Deliberately not taking

- **Bastions** (`item/facility.mjs`, `documents/actor/bastion.mjs`,
  `activity/order-data.mjs`). A whole downtime-stronghold subsystem from one
  supplement. Out of scope. The generalizable piece, if downtime is ever
  wanted, is the *order* pattern: an instruction issued between sessions that
  resolves later with a roll.
- **Enchant, transform and summon activities.** ODM already covers this
  ground through `cast_buff`, the Wild Shape and Polymorph engines,
  `pet-tools.ts`, and the `summon` resolution in `srd/spell-mechanics.ts`.
- **Containers and item weight.** Containers stay out of scope. Weight does
  not: it is the blocker for encumbrance below.

### 3.4b Encumbrance and ammunition, as optional table rules

Both were recorded omissions. They are now table choices instead.

- **Ammunition: built.** `src/lib/srd/ammunition.ts` maps each weapon to what
  it fires, spends a round on every shot, refuses the attack on an empty
  quiver (a refused tool call, so the engine boundary makes it a shot that
  never happened), and hands back half the spend at the end of the fight.
  Gated on `variantRules.ammunition`, off by default, covered by
  `scripts/test-ammunition.mjs`.
- **Encumbrance: built.** The toggle existed and fed the DM prompt but
  enforced nothing, because no item carried a weight. The content pack now
  imports one (`weight REAL` on the items table, parsed by
  `scripts/lib/open5e-normalize.mjs`), `equipmentItemSchema` carries
  `weight`, and `db/sheets.ts` fills it on read from an in-memory name index
  so sheets written before the field are weighed too. `src/lib/srd/
  encumbrance.ts` does the arithmetic: capacity STR x 15, the two variant
  thresholds at 5x and 10x, coins at 50 to the pound, and ammunition weighed
  per round so it agrees with the ammunition rule as a quiver empties. Armor
  weights come from `srd/armor.ts` because Open5e ships every armor row
  blank, and anything nothing can weigh is reported as UNWEIGHED rather than
  counted as zero. Gated on `variantRules.encumbrance`, off by default,
  covered by `scripts/test-encumbrance.mjs`. It reaches speed through
  `srd/index.ts speedFor` and disadvantage through `dm/rolls.ts` and
  `dm/pc-attack.ts`.

### 3.5 Where these land in the phases

- Phase 1: no change.
- Phase 2 absorbs mob initiative, the damage-application tray, the party
  award action, and roll modes.
- Phase 4 absorbs property attribution generalized beyond AC.
- Phase 5 absorbs prepared encounters (they are prep artifacts, and they pair
  with the map studio) and DM-painted terrain regions.
- Phase 6 absorbs hidden combatants, which turned out to belong with hidden
  tokens rather than with the tracker: one flag serves both.
- Phase 8 absorbs the calendar, the party actor, multi-denomination currency,
  the `identified` flag, and mounts and vehicles.

---

## 4. Making it intuitive

"Fully featured" and "intuitive" fight each other. Foundry's own reputation
is that it is powerful and has a steep first hour. The design rules below are
what keep the console from going the same way.

1. **One primary loop, everything else secondary.** The DM's screen is the
   intent queue: what the players just tried to do, in order, each with the
   two or three adjudications that actually fit. Every other panel is a tab
   behind it. If the DM has to leave the queue for a common action, that
   action belongs in the queue.
2. **Suggest, never auto-apply.** Phase 4's assist rail proposes the check,
   the DC and the tool call, prefilled. The DM presses one key to accept, or
   edits, or ignores it. Nothing mechanical happens without a human press in
   human mode.
3. **Every number is auditable in one click.** Property attribution (2.4) is
   what makes a DM trust an engine they did not write. If the console says
   DC 15, hovering says why.
4. **The board is the noun, the console is the verb.** Selecting a token
   should scope the console: select a goblin, and damage / condition / move /
   remove are right there. This is the affordance Foundry gets right and it
   costs little.
5. **Keyboard first for the hot path.** Roll request, damage, next turn,
   whisper. A DM running a fight is typing, not hunting.
6. **Progressive disclosure by mode.** In `dmMode: "human"` the AI controls
   vanish rather than sitting greyed out; in `"assisted"` they appear as
   delegation toggles. Never show a control that the current mode forbids.
7. **The nudge is never a modal.** Phase 3's story reminder escalates from a
   dot, to a banner, and always arrives with the AI-draft button attached, so
   the interruption carries its own remedy.

---

## 5. Terms

- **DM seat**: the user running the game. Distinct from **party lead**
  (`campaigns.party_lead_user_id`), which stays as-is for AI campaigns.
- **Intent**: a player's submitted action awaiting adjudication. An ordinary
  `campaign_messages` row; what changes is that it wakes the DM's queue
  rather than `requestDmTurn`.
- **Beat**: a DM-authored summary of story that happened out loud and was
  never typed.
- **Adjudication**: one DM-invoked engine call. Modeled on dnd5e's Activity.

---

## Phase 1: The DM seat, the mode switch, and the viewer model (BUILT)

Ship target: a human-DM campaign that runs as a rules-aware chat. The DM
types narration, players type actions, the AI stays silent.

**Schema** (additive, via the `addColumns` helper in `src/lib/db/core.ts`;
SQLite cannot alter CHECK constraints in place):

- `campaigns.human_dm_user_id TEXT` (NULL means AI-run), mirroring how
  `party_lead_user_id` was added.
- `campaigns.assistant_dm_user_id TEXT` (the co-DM from 2.3). Cheap now,
  expensive to retrofit.
- `game-settings.ts`: `dmMode: z.enum(["ai", "human", "assisted"]).default("ai")`.

`campaign_messages.author_type` already permits `'dm'`, so human narration
reuses it with `user_id` set. `sheet_audit.actor` is free-form TEXT, so
adjudications record `'human_dm'`.

**The viewer model** (the phase's main design work). New pure module
`src/lib/dm/viewer.ts`:

```ts
export type ViewerRole = "player" | "lead" | "dm" | "ai";
export function viewerFor(campaign, userId): ViewerRole;
```

Then thread `ViewerRole` through `publicCampaign`, `publicEncounter`, the
battle-map projection, `publicPendingRoll` and the events filter. One place
decides, one test script covers it. Getting this wrong leaks the secret arc
to players or hides enemy HP from the DM, so it is worth doing before any
console UI exists.

**Server**: `isDm` / `requireDm` in `campaign-api.ts`; DM excluded from
`max_players`; `POST /actions` publishes `dm_intent_queued` instead of
calling `requestDmTurn` when `dmMode !== "ai"`; `runStorySetup` and the
kickoff narration skipped; new `POST /dm/narrate` that posts a `dm` message
and runs the non-model downstream (TTS, chapter accumulation, scene chunking)
while bypassing the model, the narration guard and the tool loop.

**Client**: mode picker in `CreateCampaignDialog.tsx` (with the overworld
description field from Phase 5); `CharacterGate.tsx` bypass for the DM; a
`dm` tab gated in `SessionTabs.tsx`; DM composer modes (narrate / whisper /
ooc); real numbers in `PartyPanel.tsx` and `EncounterPanel.tsx` for the DM.

**Tests**: `scripts/test-viewer-roles.mjs` over `viewer.ts`, asserting every
projection for every role, following the existing pure-logic convention.

---

## Phase 2: The adjudication façade and the DM console (built)

Ship target, met: the DM can do through UI everything the AI DM can do
through tools, and the server rules on all of it either way.

**The façade.** `src/lib/dm/invoke.ts` is `invokeEngine(campaign, actor,
call)`, with `actor` either the model's turn or a person's user id. It
normalizes the arguments a form produces into the arguments a tool call
produces ("goblin x4" into an array, a comma list into a list, "enemy:id
half" into a damage share), pre-checks them against the catalog, and hands
off to `invoke-dispatch.ts`, whose every arm calls exactly what `turn.ts`
calls for the same tool. The per-turn caps the AI works under
(`MUTATION_CAP_PER_TURN` and friends) are rails on a model that might loop,
not rules of the game, so a person is not subject to them; that is stated in
the module rather than left to be discovered.

*Where this differed from the proposal:* `turn.ts` was NOT shrunk to "build
prompt, call model, dispatch". Its tool loop does three things beyond
dispatch (echoing each result into the model's conversation, enforcing the
caps, and parking calls for physical dice) and unpicking that is a
refactor with real risk and no user-visible payoff. The façade reaches the
same handlers; the guard test below is what keeps the two callers honest.

**The catalog** (`invoke-catalog.ts`, assembled from `catalog-combat`,
`catalog-party`, `catalog-world` and `catalog-types`). 64 entries, one per
tool, each with a label, a category, a one-line summary written for a person
running a table, and the fields the console renders.

*Where this differed:* the catalog describes arguments FOR RENDERING, not for
validation. Every handler already parses its own arguments with zod; a second
schema in the catalog would be exactly the drift the catalog exists to
prevent. `checkArgs` does a pre-flight (required fields present, numbers
numeric, selects in range) so a person gets "Damage a character needs
character" instead of a parse failure, and the handler's own zod remains the
single source of truth.

**Route**: `POST /api/campaigns/[id]/dm/invoke`, `requireDm`. A refusal from
the engine answers 409, so the console shows it as the rules talking rather
than as a broken request.

**Console**: `DmConsolePanel.tsx` and `DmActionForm.tsx`, a `dm` tab offered
only to `caps.adjudicates`. The queue of unanswered player actions
(`dm_intent_queued`) sits at the top, floor control under it, then every
adjudication by category. The form is generic and renders from the catalog,
so a tool added to the engine appears in the console with no UI change.

**Roll modes.** `rolls.visibility` is `public` (the default, and what every
roll ODM has ever made was) / `dm` / `blind` / `self`. `rollAccessFor` and
`redactRoll` in `viewer.ts` decide and apply it. The shared SSE stream
carries the redacted roll, because one payload serves every seat, and
whoever is allowed the number re-fetches it from `GET /rolls`, the same
ping-and-self-fetch the fogged battle map and the DM's enemy numbers use. A
blind roll is REDACTED rather than withheld: the table sees that the dice
went and what for, which is the tension a hidden roll is for, and a roll that
simply vanished would read as a bug.

**Human roll requests.** A person's `request_roll` opens a lightweight
`dm_turns` row with `actor='human_dm'` and no conversation, so
`pending_rolls.turn_id` stays `NOT NULL` and park/resume, `PendingRollCard`,
physical dice and the digital fallback all work unchanged. `resumeHumanTurn`
closes it; there is no model to hand the answer back to, because the roll
already published itself and applied whatever it applies.

**Damage tray**: `split_damage`, a real engine tool both callers get. One
rolled total, up to twenty targets, each at full, half, double or none. The
multiplier is all it adds; every share then lands through the existing enemy
and character damage paths, so resistances, temporary hit points, death saves
and concentration resolve exactly as they always do.

**Party award**: `party_award`, likewise a real tool. XP each, a purse split
evenly with the remainder on the first share so the party ends up with
exactly what the hoard held, and one item to the character who found it. It
composes the ordinary single-target mutations, so the audit trail, the
level-up hooks and the character events are the ones a run of separate calls
would have written.

**Mob grouping.** The encounter panel collapses every enemy from one stat
block into a single line the DM can open up, keyed on the enemy's slug
(`PublicEncounter.enemies[].groupKey`).

*Where this differed:* the proposal said `advanceAfterTurn` should treat a
group as one stop. It already does, for every enemy: `advanceOrder` never
rests the pointer on an enemy at all, it collects them into `enemiesPassed`
and walks on to the next PC. So the advancement change was already true and
the grouping that was actually missing is presentation, which is what was
built. Claiming otherwise would have been a change that did nothing.

**Floor control.** `POST /floor` takes an optional `set` of `open` / `hold` /
`spotlight`; without it the route keeps its original release-only behavior,
so every existing caller is unaffected. Initiative is refused: the encounter
owns the floor while a fight runs.

**Tests**: `scripts/test-invoke-catalog.mjs` reads the tool names out of the
source textually (importing those modules would open a database) and fails
when the AI's tool list and the catalog disagree in either direction. It
found a real gap the first time it ran. `scripts/test-viewer-roles.mjs`
covers the roll-visibility rules.

---

## Phase 3: Story capture and the nudge (built)

Ship target: a DM who narrates out loud still leaves the campaign's memory
engines fed.

This was never a nicety. Every memory engine is downstream of narration text:
`chapters` accumulate from messages, `scene_chunks` are embedded for
retrieval, `facts` and `lore_entries` are extracted at compaction,
`character_events` build the per-character story, and `arc.ts` advances
beats. A DM who narrates at the table and types only "roll perception"
starves all of them, and the recap, export, chapter summaries and Ask all
degrade.

**Schema**: `dm_beats` (id, campaign_id, seq, message_id, author_user_id,
kind, source, body, created_at), plus `beatReminder: { messages, rolls }` on
`gameSettings`.

**The wiring, which is the whole design**: a beat is published as an ordinary
DM message (`author_type` `'dm'`, `user_id` set) and `dm_beats` holds only the
provenance the transcript cannot carry. Chapters, compaction, scene-chunk
embedding, `context-retrieval.ts`, `recap.ts`, the export and Ask all read
`campaign_messages`, so none of them needed to learn what a beat is. The
upkeep tail from the narrate route runs on the campaign queue behind it.

**Three ways in, all built**:

1. *Typed beat*: a compact composer at the top of the DM console, under the
   floor control, with a kind (a scene, someone they met, something they
   learned, somewhere they went, a fight, downtime).
2. *AI-drafted beat*: `POST /dm/beats/draft` reads the uncaptured stretch
   (player messages, roll results with their DCs and outcomes, sheet audit
   entries) and returns prose. It writes nothing. The draft lands in the
   composer for the DM to edit, and recording it is a second, deliberate
   press. This is the only model call a pure human-DM campaign makes, and it
   is opt-in.
3. *Voice*: `PushToTalk.tsx` was already a `(text) => void` component, so it
   dropped straight into the composer. The transcript appends to whatever is
   in the box; the beat's `source` records that it was spoken.

**The reminder**: `src/lib/dm/beat-cadence.ts`, pure and import-free, so the
client recomputes it on every event with no request. It counts player
messages and rolls since the last time story text reached the log, and
escalates from nothing, to a dot on the DM tab, to a lit banner above the
composer at twice the threshold. Never a modal, and the remedy travels with
it: the banner's own button opens the console, and "Later" snoozes for twenty
minutes. Thresholds are per campaign and either unit can be set to 0 to
silence that half. 20 tests in `scripts/test-beat-cadence.mjs`.

**The arc in human mode**: the planner is off, the table stays. Chapters close
in human mode now (a beat or a typed narration gets them there), and that
close cascade ran `refreshStoryArc`, which would have quietly planned,
enriched and rewritten an arc the DM never asked for. Both `generateStoryArc`
and `refreshStoryArc` now return early unless the AI narrates, with `force`
still honoured so the DM can ask for a plan by hand from the arc panel.

*Where this differed from the proposal:*

- **The nudge measures rolls, not rounds.** The proposal said "2 rounds of
  table activity". Rounds are not something the client can count against a
  moving cutoff (rolls carry no seq, and the last capture is often a
  narration rather than a beat), and the honest proxy is the dice: twelve
  rolls is roughly two rounds of a four-person fight. Both signals compare ISO
  timestamps, which every row the client holds already carries.
- **A beat does not clear the console queue.** A typed narration answers the
  party and clears "waiting on you"; a beat records play that already
  happened and must not tick off actions nobody has ruled on. The distinction
  rides on the `message_added` event as a `beat` flag rather than on the row,
  because it is a fact about the event, not about the message.
- **Voice was scoped as a stretch and is in.** `PushToTalk` and the local
  faster-whisper service already existed and the component's contract was
  already the one the composer needed, so leaving it out would have been a
  choice rather than a saving.
- **`beatReminder` is not offered at campaign creation.** It joins `stages` in
  the documented-omission set of `scripts/test-create-campaign-options.mjs`:
  nobody has an opinion about how often to be nudged until the nudge has
  fired at them once, and the settings panel is what they are already looking
  at when it does.

---

## Phase 4: Statistical direction for the DM (built)

Ship target: the DM asks "what should this cost?" and gets a grounded answer
from engines that already exist. Read-only assist rail; nothing auto-applies.

The console gained two tabs that are not adjudications. **Assist** answers
questions and changes nothing. **Tables** is the DM's own reference shelf.
(Phase 5 added a third, **Maps**, which is the prep bench.)

**Assist** (`DmAssistPanel.tsx`, `DmOddsPanel.tsx`):

- **Intent to adjudication.** A player's words in, a shortlist of catalog
  entries out, with the model's own pick prefilled. Reachable from the queue:
  every unanswered action has a "What should I press?" that hands the player's
  own sentence to the suggester. `POST /dm/assist/suggest`.
- **Consequence preview.** `src/lib/srd/odds.ts`, pure: hit chance, crit
  chance, damage on a hit and on a crit, expected damage per round, rounds
  until a target drops. It models the two DIFFERENT d20 rules 5e has, which is
  the part that is easy to get wrong: an attack auto-hits on a 20 and
  auto-misses on a 1, so its odds are never 0% or 100%, while a check or save
  has no such rule and an out-of-reach DC is honestly impossible.
- **Encounter difficulty**, live off the board via `evaluateEncounter`, with
  the raw XP, the multiplier and all four thresholds shown rather than just a
  verdict.
- **DC suggestion**: the DMG ladder from `srd/dc.ts`.
- **Rules lookup**: Ask, with the scope pinned to `rules` and the answer kept
  private, in the console so the DM never leaves the panel (on a phone, never
  leaves the screen).

**Tables** (`DmTablesPanel.tsx`):

- **Roll tables.** `roll_tables` plus `src/lib/dm/roll-table-logic.ts`, whose
  whole design goal is that a table pasted out of a book works: numbered
  ranges ("1-5 A goblin patrol", en dash included), single numbers, and bare
  lines numbered in order. The die is the smallest that covers the rows, and
  holes and overlaps are reported rather than hidden. Rolling writes an
  ordinary `rolls` row, so it lands in the log and the dice tray like any
  other roll; the row's TEXT comes back to the DM alone. Optionally drafted by
  the model from a description and the party's current location, into the
  editor, saved only if the DM saves it.
- **Quick statblock.** Search the campaign's own genre catalog, then resolve
  one to exactly the numbers `start_encounter` would spawn. A CR with no match
  falls back to the DMG by-CR baseline, labelled as such.

**Property attribution**: `computeSheetDerived` now returns `parts` alongside
every number, and the totals are computed BY summing those parts, so the two
can never disagree. Saves, skills, initiative, passive Perception, spell save
DC and spell attack all explain themselves on hover in the sheet, the way AC
always has.

*Where this differed from the proposal:*

- **The suggester is keyword-first, model-second.** A pure pass over the
  catalog (`assist-logic.ts rankAdjudications`) produces the shortlist
  instantly, with no model at all; the model only reorders it and fills in
  arguments, and a pick naming anything outside the shortlist is discarded.
  That ordering is what keeps this usable on a slow local model and honest
  when there is none. The prefill is filtered per field too: a value whose
  shape does not match its field is dropped rather than coerced, because a
  half-wrong form the DM has to notice is worse than an empty one.
- **Ask needed no change to rank house rules first.** The plan asked for it;
  `ask.ts assembleEvidence` already pulls the table's own `rule_chunks`, sorts
  pinned ones ahead of scored ones, and tells the model they override the
  standard rules. The work was surfacing Ask in the console, not touching
  retrieval.
- **Loot needed nothing.** `roll_treasure` was already a catalog entry, so it
  was already a console form the moment Phase 2 shipped. What was actually
  missing next to it was the statblock lookup.
- **"Adjust" a statblock is deliberately absent.** The rail previews and
  applies nothing, which is the phase's own contract, and spawning takes a
  name and a count. Changing a particular enemy's numbers is done after it is
  on the board, through the enemy HP and condition tools that already exist.
- **A guard test caught four synonyms naming tools that do not exist.**
  `assist-logic.ts` maps table words ("stab", "sneak", "camp") onto tool
  names, and four of the names first written (`cast_spell`, `short_rest`,
  `long_rest`, `move_token`) were plausible and wrong. A renamed tool would
  drop out of the shortlist silently, which is worse than a missing button
  because nothing looks broken, so `scripts/test-assist.mjs` now asserts every
  synonym key against the live catalog.

### 4b. Every tool exists, and the guard that proves it

Chasing those four names turned up a bigger hole. The Phase 2 guard compared
the catalog against the AI's TOOL LISTS in both directions, and passed. It
never checked the third thing: whether the façade can actually dispatch what
the catalog offers.

Two entries could not be. `request_player_input` ("Give the floor") was in the
catalog and rendered as a console form, and pressing it could only ever return
"the engine has no action called request_player_input". `generate_image` was
in the same state behind a hidden flag. Both now have handlers:
`handleRequestPlayerInput` in `turn.ts`, beside the `parseSpotlightUserIds`
the AI path already used, so the two callers land on the identical floor
state; and `handleGenerateImage` in `dm/images.ts`, which hangs the request on
the DM's latest passage rather than inventing a caption-only message to carry
it.

`consoleHidden` is gone entirely. Four entries carried it (`move_token`,
`recall_story`, `search_lore`, `generate_image`) on the reasoning that a
person has a better route to each: drag the token, read the story panel, use
the lore panel, use the composer. That reasoning does not survive contact with
the promise the whole phase rests on. `invoke.ts` was also REFUSING those
four to a human caller, so the console was not merely quiet about them, the
server said no. All four now have fields and forms, and the catalog is 64 for
64.

`scripts/test-invoke-catalog.mjs` gained the missing direction: every catalog
entry must reach a dispatch arm, read textually out of `invoke-dispatch.ts`
and the name lists it routes on, so the check still opens no database. It
fails on the exact gap that shipped unnoticed.

### 4c. The odds module, corrected

Two things in `srd/odds.ts` were wrong in ways a DM would have trusted.

**Keep-highest was averaged as though every die counted.** "2d20kh1" came out
as 21 instead of 13.825. The fix is not a special case for `kh`: linearity is
now TESTED, by scoring the expression with every die at its floor and again at
its ceiling and checking the gap is exactly what the dice could contribute.
When it is not, the answer comes from enumerating the outcomes through the
engine's own `rollExpressionWithDice`, which is exact and deterministic (400
combinations for 2d20kh1, 1296 for 4d6kh3). Past 20,000 combinations, or on a
reroll expression whose dice COUNT is data-dependent, it reports that it does
not know and the panel shows nothing rather than a plausible number.

**The crit forecast ignored the table's own rules.** Powerful Critical
(maximized extra dice) and Critical Damage Mods (flat modifiers double) are
enforced by the server in `critDamageExpression`, and the preview was
hardcoding "double the dice, keep the modifier". It now calls that same
function, so the two cannot disagree about what a crit is, and Brutal
Critical's extra dice come along for free.

---

## Phase 5: Maps, locations and the overworld (built)

Ship target: the DM describes a place and gets a usable map; the DM places
the party and locations on the overworld.

Three systems exist and stay separate: the illustrated location map
(`locations.map_image_json`, ComfyUI, `dm/maps.ts`), the tactical grid
(`battle_maps`, procedural, `battlemap/generate.ts`), and the region map
(`overworld_maps`, procedural, `overworld/logic.ts`).

- *Location from description*: the console's "Move the party" and "Change the
  place" forms already reached `handleLocationCall`, and the ComfyUI render
  is enqueued inside that handler rather than by the AI's turn loop, so the
  illustrated map was already drawn for a human DM. One real defect turned
  up: `visionClear` is read as `args.visionClear === true`, and the console
  started every checkbox unticked, so a DM who did not think about it drew no
  map at all. `CatalogField` gained a `default`, and both location forms now
  start "They can see it" ticked.
- *Battle map from description*: `POST dm/map-studio` with `do: "preview"`
  generates a map and **writes nothing**, so the DM spins seeds privately and
  only `do: "apply"` puts one on the table. `GenerateInput` gained optional
  `theme` and `ambient`: the keyword reader is a guess made from a sentence,
  and when the DM says "cave, dark" outright their answer wins. Applying
  keeps the `battle_maps` row (tokens and the encounter link survive), stands
  everyone on the new spawns, resets the round's movement, and clears the fog
  memory, which is a memory of a map that no longer exists.
- *DM-painted terrain regions* (3.3): `src/lib/battlemap/paint.ts` is pure and
  is where the interesting work is. A stroke is a string edit; what the
  module adds is refusing pictures the engine cannot run on. The border stays
  walled, a wall cannot be painted over a token, every occupied tile must
  still reach every other, and nobody may be sealed in on all four sides. A
  sealed closet with nobody in it is allowed, because that is a room the DM
  meant to draw.
- *Prepared encounters* (3.2): `encounter_templates` holds text only. The
  difficulty readout is recomputed on every read from the party as it stands
  today, because the party levels up between the prep and the session and a
  stored verdict would go quietly stale. Deploying calls `invokeEngine` with
  `start_encounter`, so every refusal the engine already makes still happens
  and still says the same thing.
- *Standalone tactical maps*: shipped as the plan proposed, a zero-enemy
  encounter, with one addition that turned out to be load-bearing. See §5b.
- *Overworld authoring*: `overworld_maps` gained `party_xy_json`,
  `params_json` and `notes`. The panel gained three click modes (pin, place
  the party, move a place), rename, and the DM's own notes, which ride the
  GET payload only for whoever holds the story's secrets. Renaming repoints
  every connection that named the old name, because connections are stored as
  names and a rename that touched one row would cut the place out of the
  route graph.
- *Describing the overworld*: both halves shipped together, (a) and (b). See
  §5c.

### 5b. The scene: a board with nobody to fight on it

`battle_maps.encounter_id` is NOT NULL, so a standalone map means either an
FK change or a second lifecycle for tokens, fog and movement. The plan chose
a zero-enemy encounter, and that is right, but "zero enemies" is not a thing
the engine can read: `getActiveEncounter` is asked seventy-odd times across
twenty-five files, and every one of those callers means "is a fight
running?". An exploration board that answered yes would make rests illegal,
make `start_encounter` refuse, and put an empty initiative tracker on every
player's screen.

So the row is marked instead. `encounters.kind` is `'fight'` or `'scene'`,
`getActiveEncounter` filters to fights, and scenes are fetched by name
(`getActiveScene`). Not one of those seventy call sites changed, because none
of them can see a scene. Only the map layer asks `getActiveBoard`, which is
the fight if there is one and the scene otherwise.

Two rules keep the two from fighting over the board, both inside
`createEncounter` so no caller has to remember them: a fight closes any open
scene, and a scene asked for while a fight is running is refused. The fight
always wins, because a fight is not something to quietly clear off the table.

A scene has no rounds, so it rations no movement: `budgetLeft` is the whole
map and `moved_this_round` stays at zero, which is what stops a party
exploring a corridor from running out of feet halfway down it.

### 5c. Describing a region that is made of noise

The overworld is seeded value noise. A sentence cannot become terrain,
because there is nowhere in the generator for "a chain of islands off a storm
coast" to go. What a sentence can become is the five dials the classifier
reads, so the parameter layer came first and the model call second, which is
the order the plan asked for.

`OverworldParams` is sea level, mountains, forests, aridity and coastline,
each 0 to 1. Every threshold is written so that 0.5 evaluates to exactly the
constant it replaced: 0.34 water, 0.8 mountain, 0.66 hill, 0.66 swamp
moisture, 0.52 forest moisture. That is checked rather than asserted, by
hashing the terrain the pre-parameter generator produced for two seeds and
comparing (`scripts/test-overworld-params.mjs`). An existing campaign that
rerolls its map gets the world it always did.

On top of that, `POST overworld/describe` asks the utility model for those
five numbers plus up to six place names, and writes nothing. The DM previews
seeds against the dials (`POST overworld/preview`, also writing nothing),
rerolls until the coastline falls where they want it, and only then applies.
Accepted places become unvisited locations, which the map already draws as
ghost markers, so "the DM places locations on the overworld" is the existing
render path rather than a new one.

Image-generated overworlds stay out, for the reason the proposal gave: they
lose the tile grid that anchors, travel and pins depend on.

---

## Phase 6: Board interaction parity (built)

Ship target: during a fight the DM manipulates the board and the players move
their own tokens, with the DM deciding when.

- *DM view*: already true. `buildPlayerMapView` has taken a `fullVision`
  option since Phase 1, granted by `caps.fullMap`, and it already carried
  `tokenHp` for the seat allowed real numbers. Phase 6 spent that: the grid
  now draws a hit-point bar under every token in the DM's projection, so the
  numbers the server was already sending are visible without opening a panel.
- *Free placement*: `POST dm/board` with `do: "place"`. It ignores reach, the
  turn and the movement budget, and enforces only what the board cannot be
  wrong about: inside the map, not inside a wall, not on top of somebody.
  `placeToken` is deliberately not `moveToken`, because `moveToken` takes a
  `moved_this_round` and free placement must never write one.
- *Ad-hoc tokens*: the table was rebuilt, as the plan insisted. See 6b.
- *Hidden*: one `battle_tokens.hidden` flag, two surfaces. See 6c.
- *Initiative editing*: `src/lib/dm/initiative-edit.ts`, pure and tested,
  with `POST dm/initiative` applying it. Reorder, insert, delay, remove,
  rewind, hand the turn to a named player, correct a rolled count, and reset
  the whole order. `advanceAfterTurn` and `skipCurrentTurn` turned out to be
  the wrong extension points: both only walk forward, because the AI DM never
  needed to undo itself. See 6d.
- *Drag ruler and token HUD*: the ruler runs `findPath` from
  `battlemap/movement.ts` client-side over the projection the viewer already
  holds, so it is the server's own pathfinder measuring the walk and cannot
  promise a route the move route would refuse. Over budget it turns red
  rather than vanishing. The HUD opens on a click rather than only a right
  click, so it works on the tablet a DM actually runs a table from.
- *Pings*: `POST battle-map/ping`, one ephemeral `map_ping` event, an
  expanding ring. Anyone at the table may point, because "the door, the door"
  is the most-used sentence over a shared board; only whoever steers may send
  the focusing kind, which opens the board on every client.
- *Measured templates*: `src/lib/battlemap/template.ts`, pure and tested.
  See 6e.

### 6b. Rebuilding a table for two words

`battle_tokens.kind` carried `CHECK (kind IN ('pc','enemy'))`, and SQLite
cannot widen a CHECK with `ALTER TABLE`. This is the one place the schema
rebuilds a table rather than adding to it, and the plan was right that it is
worth it: filing a barrel as an enemy would have put it into encounter
difficulty maths and made it a legal target for every attack the engine can
resolve.

The rebuild is detected from the stored DDL rather than from a marker row, so
an interrupted run is safe to repeat. `hidden` and the two new kinds arrive
together, and existing tokens keep their position, their spent movement and
their carried light. Checked against a database aged back to the old shape.

`npc` and `prop` tokens carry a `"npc:"` or `"prop:"` ref id, so anything
reading a `ref_id` can tell at a glance there is no stat block behind it.
Only the DM may place or clear them, and only they can be cleared: a PC or
enemy token belongs to a sheet or a stat block, and deleting it here would
leave a combatant in the order with nowhere to stand.

### 6c. One flag, two surfaces

A hidden combatant should be absent from the players' map and absent from
their initiative tracker, and those are two different projections. Rather
than two flags that can disagree, `battle_tokens.hidden` feeds both:
`buildPlayerMapView` drops the token, and `publicEncounter` takes the hidden
ref ids and drops both the enemy row and the order entry.

Withholding rather than dimming is the point. A shape the players can see but
not identify is still a warning, and the DM hid the ambusher precisely so
there would not be one. The DM's own projection keeps every hidden piece,
marked.

A player's own character can never be hidden. The projection that would hide
them from the table is the same one they play from.

Nothing in this phase let the DM edit an initiative entry into existence
without a token, so the flag has exactly one home.

### 6d. Rewinding the pointer, and what a rewind is not

`OrderEntry` gained an `npc` kind: a named slot with no stat block, for the
guard captain who joined the brawl. `advanceOrder` walks past it exactly as
it walks past an enemy, because the pointer has only ever rested on player
characters and everything else is the DM's to narrate. Three call sites used
to spell out `entry.kind === "pc" ? entry.characterId : entry.enemyId`; they
now ask `orderEntryId`, so a fourth kind would not need finding them again.

Reordering keeps the pointer on the combatant it was on rather than the slot
number, so nudging somebody past the current turn does not hand the turn to a
different person.

Rewinding moves the pointer and the round counter and nothing else. It does
not give hit points back, un-tick a condition or refill a movement budget,
because undoing what happened is what `sheet_audit` and `audit/revert-turn`
are for, and a rewind that pretended otherwise would be worse than no rewind
at all. The panel says so on screen.

"Roll all NPCs, leaving the players to roll their own" was already the
behaviour: enemy initiative rolls silently at spawn in both `start_encounter`
and `add_enemies`, and players roll on request. So Phase 6 added the missing
half, which was reset.

### 6e. Templates that stop at walls

`templateTiles` resolves a sphere, cone, line or cube onto the grid. The
geometry is the approximation every table already uses, not exact Euclidean
area: distance counts in squares, which is the rule `chebyshev()` has always
followed here, and a cone is as wide at its end as it is long.

Walls are never covered and nothing is covered through one. That check is
line of sight from the origin, the same ray the attack and cover rules
already use, so a DM's template and the server's cover call cannot disagree
about what a wall does.

The preview is drawn client-side from the DM's own terrain; the tiles that
decide who is caught are recomputed server-side, because a projection is
fogged and a template is not a rules call to take on trust. What comes back
is the target list `aoe_damage` takes, and the enemy ids copy to the
clipboard in the shape its "Enemies caught" field wants, so placing the
fireball and resolving it are two steps rather than one form filled in by
eye.

Board handling is not an adjudication, so none of it is in the catalog and
the AI is never offered it: a person moving a figurine is not a rules call
the engine has to be able to make. Free placement, hiding and clearing are
recorded as `dm_board_action` campaign events rather than table notes, which
is the plan's "recorded in the audit rather than against the round" and keeps
a nudged goblin out of the transcript.

---

## Phase 7: Assisted mode (built)

The middle setting, where the human owns the story and the AI owns the
bookkeeping. `dmMode: "assisted"` plus three delegation toggles in
`gameSettings.dmAssist`, read through `delegated()` in
`src/lib/dm/delegation.ts`, which returns false outside assisted mode so a
table switching to "human" gets a silent DM back without unticking anything.
Every delegated action routes through `invokeEngine` with `actor.kind="ai"`.

Ask is deliberately not a toggle: it writes nothing to the campaign, so it is
available in every mode and there is nothing to delegate.

### 7a. AI runs the monsters

`playMonsterTurns` (`src/lib/dm/delegate.ts`) makes one small decision call
per living enemy against a four-option shortlist (`enemy_attack`,
`set_enemy_condition`, `enemy_flees`, hold), and routes the answer through
`invokeEngine`. The whole pass hangs on one AI `dm_turn`, so the engine's own
per-turn bookkeeping sees it as one turn and the skipped-enemy fallback in
`advanceAfterTurn` will not make the same goblin swing twice. A model that is
unreachable or answers with nonsense falls back to the nearest living target
and a plain attack, which is exactly what that fallback already does, so a
delegated monster's turn can never silently vanish.

It does not touch the initiative pointer. In this mode the pointer is the
DM's (Phase 6's `DmInitiativePanel`), and the server never moves it on their
behalf, so pressing the button twice makes the monsters act twice. That is
the same latitude a person already had clicking `enemy_attack` twice, and
pretending otherwise would mean the server deciding whose turn it is in the
one mode where it deliberately does not.

### 7b. Saying a beat aloud

The plan said to reuse `dm/renarrate.ts` with the beat as the brief. That
does not work as written: `runRenarrate` hard-requires `message.dmTurnId` and
a stored `turn.conversation`, and a beat recorded by `recordBeat` has
neither. What IS reused is renarrate's variant machinery, which turns out to
be the better fit anyway.

`expandBeat` makes one narration call with `toolChoice: "none"` and no tools
array, on the same guarantee renarrate is built on: prose changes, mechanics
cannot. The prose is stored as a second TAKE on the beat's own message rather
than as a new message, so the DM's own line stays as take one, the table
reads the prose, and flipping back is the swipe control the chat already has.
Nothing new appears in the transcript, so chapters, compaction, retrieval and
the export still see one beat.

Per beat, not per campaign: a DM wants this on a scene transition and not on
"they took the left fork", so the composer carries a checkbox and the toggle
only decides whether the checkbox exists.

### 7c. Covering for a DM who steps away

`campaigns.dm_cover_json` holds `{turnsLeft, brief, byUserId, startedAt}`,
hydrated onto every `Campaign` as `dmCover`. While it is running, the branch
in `actions/route.ts` that queues a player's action for a person instead
wakes an AI turn, and `coverPromptBlock` appends a block to the DM system
prompt saying whose table this is on loan from, to follow the outline, and
not to spend the story: no chapter ends, no central question resolves, no
named NPC dies, no twist the outline does not already contain.

One "answer" is one DM turn, and a DM turn reads every action that arrived
before it started, so the count is spent where the turn is REQUESTED rather
than per message; `requestDmTurn` now returns whether it actually enqueued,
which is what makes a burst of five actions cost the DM one answer instead of
five.

The banner is shown to every seat, not just the DM. A player owed an answer
is owed the knowledge that the person answering them stepped out.

### 7d. A bug this phase found

`invokeEngine` only persisted the turn for `actor.kind === "human"`, because
until now the only AI caller was `turn.ts`, which saves its own turn after
its loop. A turn reached through the façade has no loop behind it, so every
mutation the handlers wrote to it (which enemies acted, which characters were
resolved) was silently discarded. It now saves in both cases and closes only
the human's, since a delegated AI turn may still have more adjudications
coming on it.

---

## Phase 8: Cross-cutting engine upgrades (built)

Nine independently shippable items that improve AI mode as much as human
mode. Each is described below with what it actually does, and the one place
the shipped scope differs from the plan is called out rather than glossed.

### 8a. Active effects (the instance layer)

`active_effects` (`src/lib/dm/effects-logic.ts`, `src/lib/db/active-effects.ts`)
holds every modifier currently riding on a combatant: several modifiers, a
duration in rounds, in-world minutes, until the fight ends or until removed, a
source, and an optional save to shake it off. `set_effect` and `clear_effect`
reach it from both the console and the model. Stacking is resolved in one
place: adds sum, the largest override wins and bonuses ride on top of it, and
advantage follows 5e exactly (any number of each collapses to one, one of each
cancels). Effects fold into Armor Class through `acWithEffects`, and into every
save, check and initiative roll through `resolveRollExpression`'s `extras`,
which is the same seam the ally-aura already used.

**Where this differs from the plan.** The plan asked for one table that
`srd/condition-effects.ts` and `srd/feature-effects.ts` both resolve THROUGH,
and called it the largest item in the phase. Those two modules are not
duplicated logic that has drifted: they are two static CATALOGS, one of the 14
conditions and one of the class and racial features, about a thousand lines
each and each covered by its own tests. Rewiring them to read their own
contents out of a runtime table is a demolition with no user-visible gain. All
three benefits the plan named (ad-hoc effects for the DM, one place to reason
about stacking, no drift between parallel systems) come from the instance
layer, which is what was actually missing; the catalogs keep resolving as they
do and an active effect is a third source the same resolvers add in. The
plan's own note to scope the full merge separately still stands.

### 8b. In-world calendar and clock

`src/lib/dm/calendar.ts`: a generic model plus three presets, after dnd5e's
`data/calendar/`. A moment is one integer of minutes since the epoch, so every
operation is arithmetic on it. Travel, both rests and the new `pass_time`
adjudication move it; the DM prompt carries the date, the time of day, the
season and whether it is dark. The gritty and heroic rest variants finally
mean something: they were a line in the prompt with nothing counting the week,
and `restMinutes` now makes a gritty long rest take seven days on the clock.
Minute-scoped active effects expire against it.

### 8c. Party entity

`src/lib/dm/party-logic.ts` plus `campaigns.party_json`: the common purse, the
shared pack, banked XP, where the party is, what they are doing and the
marching order. Modelled on dnd5e's `data/actor/group.mjs`: a container, not a
sixth character. `party_stash` moves an item or coin between one character and
the party in one write that cannot half-fail; the DM-only `/dm/party` route
owns the marching order, the activity and handing out banked XP.

### 8d. Multi-denomination currency

`src/lib/srd/currency.ts`. The plan offered two shapes and preferred the cheap
one: store copper and present denominations. That is what this is, with one
concession to the twenty-odd modules that read `sheet.gold`: the stored pair is
`(gold, copper)` where `gold` keeps meaning whole gold pieces and `copper` is
the 0 to 99 remainder. `modify_gold` and `party_stash` both take a `coins`
string ("340 silver", "2 pp 5 sp"), which wins over a plain gold delta when
both are sent.

### 8e. Unidentified items

One `identified` flag on `equipmentItemSchema`, absent reading as true so no
sheet needed backfilling, plus `grant_item`'s `unidentified` and the new
`reveal_item`. There is no second "true name" field on purpose: while an item
is unidentified its stored `name` IS the description the party uses, so no
projection has to strip anything and the secret was never written where they
can read it. An unidentified item never merges with a known one of the same
name.

### 8f. Mounts and vehicles

`src/lib/srd/mounts.ts` plus `mount_up` and `dismount`. Deliberately the whole
of the PHB p.198 rule and no more: the size rule, the mount's speed replacing
the rider's, mounting costing half their movement, and the DC 10 Dexterity
save when something throws them. Vehicles are thinner, matching where the SRD
leaves them: a speed, a capacity, a crew requirement, and an undercrewed
vessel that slows rather than being refused.

### 8g. Exploration and social encounter trackers

`src/lib/dm/scene-tracker-logic.ts` plus `start_scene`, `scene_check` and
`end_scene`. A chase, a negotiation, a crossing and a ritual are the same
object: a clock of N successes before M failures, counted in rounds, with each
check recorded. Combat had all of this and the scenes that are not fights had
none of it. The DM writes down what winning and losing mean when the scene
starts, so the outcome is not renegotiated at the end, and the prompt carries
both along with what has already been tried.

### 8h. Freeform entity attributes

`src/lib/dm/attributes-logic.ts` plus the `entity_attributes` table: typed
key/value facts with groups on NPCs, items, locations, factions, props and the
campaign itself, including rollable formula attributes. Reimplemented from the
MIT-licensed Simple Worldbuilding system's idea and shape; no code is copied.
DM-only and deliberately not an adjudication: a model handed a "make up a new
field" tool would reach for it instead of the specific ones that exist.

### 8i. Assistant DM role

The powers landed in Phase 1, because `isDmSeat` counts both seats and every
guard reads it. What was missing was any way to APPOINT one, which left the
column dead weight. `/dm/seat` fills it, gated by the new `isPrimaryDm`: a
co-DM holds every in-game power and not this one, because handing the game to
someone else is the DM's call and not a deputy's. Promoting the co-DM empties
the co-DM seat rather than being refused.

---

## Sequencing and effort

| Phase | Depends on | Size | Value if we stop here |
| --- | --- | --- | --- |
| 1. Seat, mode, viewer model | none | S/M | Human-DM chat that respects sheets and rules |
| 2. Façade and console | 1 | L | The real feature: full enforcement under a human DM |
| 3. Story capture | 1 | M | Memory, recap, chapters and export keep working |
| 4. Statistical direction | 2 | M | The DM gets numbers instead of guesses |
| 5. Maps and overworld | 2 | M | Maps on demand, DM-placed party and locations |
| 6. Board parity | 2, 5 | M | Combat feels like a VTT |
| 7. Assisted mode | 2, 3 | S | The mode most tables want |
| 8. Engine upgrades | independent | L | Better AI mode too |

Phases 1 to 3 are the coherent first release. Phase 2 is the one to resource
properly; the rest is comparatively mechanical.

Five items are worth pulling forward out of order because they are small and
disproportionately visible to a human DM: **roll modes** (2.2), **pings**
(2.5), **roll-all-NPCs** (2.1), **grouped combatants** (3.2) and the
**`identified` flag** (3.2). None of them is more than a day's work, and a
DM notices all five in the first session.

## Conventions this plan commits to

- New logic goes in a pure module with no `@/` imports plus a
  `scripts/test-*.mjs` script, matching `engine-boundary.ts`,
  `overworld/logic.ts`, `encounter-logic.ts` and the rest.
- Files stay under 500 lines. `turn.ts` is already at 1,775; Phase 2 should
  reduce it, not add to it.
- Additive columns through the `addColumns` helper, except where a CHECK
  constraint genuinely must change (Phase 6 token kinds), which gets a
  deliberate one-off migration.
- Nothing player-visible reads DM-secret state. Every projection takes a
  `ViewerRole` rather than branching on `isDm` at the call site.
- Code or schema adapted from `foundryvtt/dnd5e` keeps its MIT copyright
  notice and gets an entry in `docs/LICENSES.md`.
- Any row in Section 3 that moves from missing to enforced gets its row in
  `docs/rules-coverage.md`, which is the standing record and is guarded by
  `scripts/test-feature-coverage.mjs`.
- No Crucible code, data or assets, and no Foundry Core code, in this
  repository.
