# Rules enforcement audit

An audit of whether ODM's D&D rules are held by the engine or only said, run
on 2026-09-27 against server 0.23.10, and the repair that followed on the
`rules-enforcement` branch. The audit added suites that state each rule; the
repair changed the engine until every one of them holds.

**Status after the repair: 81 suites, 1741 rules enforced, 1 open gap**, with
the content pack and without it. The open gap
(`starting-kit-from-training-not-class-table`) was found while looking at the
builder running after the repair: the free starting kit is derived from a
class's training rather than the SRD's class equipment tables. The ledger is empty; the per-area reports in
`rules-enforcement/` describe the state at the audit, before the repair.

- The list of open gaps: [`rules-enforcement-ledger.md`](rules-enforcement-ledger.md), generated.
- Root causes and fix notes per area: [`rules-enforcement/`](rules-enforcement/).
- What the engine is meant to enforce: [`rules-coverage.md`](rules-coverage.md).

## The ruleset ODM is held to

ODM implements **D&D 5e, SRD 5.1 (the 2014 rules)**. It is not a pure
implementation, and the suites treat each layer differently.

| Layer | What it is | How the suites treat it |
|---|---|---|
| Bundled data, `src/lib/srd/` | The twelve SRD classes, nine SRD races, the SRD spell slot and XP tables, weapons and armor | Compared with literal SRD 5.1 tables written into the tests |
| Content outside SRD 5.1, 2014 rules | Artificer, seven subraces, twelve PHB backgrounds, 105 authored subclasses, 52 authored feats | Checked for structure and for the 2014 rules they claim |
| ODM's own content | 36 genre classes, 36 setting backgrounds, the generated resource counters | Checked against ODM's own documented rules |
| The content pack, `data/content/open5e.sqlite` | Open5e v1, third party sources, and an SRD 5.2 (2024) backfill | 2014 rules only. A 2024 row that changes a 2014 mechanic is a gap |
| Variant rules | Seven toggles and the rest pace, in game settings | Must be inert when off and do what they say when on |

Documented deviations from SRD 5.1 are pinned as ODM's rule, with a comment
naming the difference. The ones the audit met:

- Multiclassing is capped at three classes.
- Conditions with a duration in rounds tick when the round wraps.
- Ammunition is assumed unless the variant rule is on.
- Unknown and homebrew spells take the caller's dice.
- Metamagic shaping and most reaction effects are narrated.

2024 rules that reached the 2014 engine, each recorded as a gap: the 2024 Orc
and Goliath species, 16 feats from the 2024 SRD (the only "Alert" carries 2024
text while the engine applies the 2014 bonus), 2024 archetypes and 20 spells.

## How the suites work

Every file is `scripts/test-enforce-<topic>.mjs` and runs under `npm test`.

- `test()` states a rule the engine holds. A failure fails the file.
- `gap()` states a rule the engine does not hold, written as the assertion
  that WOULD pass if it did. It fails today, is recorded, and the file stays
  green. Once the engine is fixed the file fails until the `gap()` is turned
  into a `test()`, so the ledger cannot fall behind the code.
- A check reads state: the stored sheet, the encounter row, the roll record,
  or a refusal. It never reads narration.
- The engine is reached the way a DM reaches it, through `dm/invoke.ts`, which
  dispatches to the same handlers the AI's tool calls reach. Player rules are
  tested through the routes a player's client calls.
- Dice are forced (`scripts/lib/enforce-world.mjs`), so nothing depends on luck.

```bash
npm test                                  # everything, the enforcement suites included
node scripts/test-enforce-death.mjs       # one suite
node scripts/enforce-report.mjs           # the ledger
node scripts/enforce-report.mjs --write   # and write docs/rules-enforcement-ledger.md
CONTENT_DB_PATH=/nonexistent node scripts/enforce-report.mjs   # as CI runs, without the pack
```

Three things a new suite must not do, each learned the hard way: post, import
or recruit a character without a portrait (it queues a real render), trust
where `start_encounter` puts tokens (placement is random), or assert on
wording.

## Result of the audit (before the repair)

78 suites. With the content pack: 1228 rules enforced, 373 gaps (77 high, 157
medium, 139 low). Without it: 1179 enforced, 363 gaps. Some gaps are one fault
seen from two areas; the repair plan below groups them by cause.

| Area | Suites | Report |
|---|---|---|
| Creation, races, backgrounds | 6 | `rules-enforcement/creation.md` |
| Class tables, level-up, XP, subclasses, feats | 5 | `rules-enforcement/progression.md` |
| Multiclassing | 4 | `rules-enforcement/multiclass.md` |
| Weapons, armor, inventory, commerce, magic items | 8 | `rules-enforcement/equipment.md` |
| Spells and casting | 11 | `rules-enforcement/spells.md` |
| Combat | 14 | `rules-enforcement/combat.md` |
| Conditions, damage, death, hazards | 9 | `rules-enforcement/conditions.md` |
| Resources and rests | 8 | `rules-enforcement/resources.md` |
| Campaign, permissions, persistence, import, homebrew, sync, tool arguments | 12 | `rules-enforcement/campaign.md` |

The area reports were written as each area finished. Where one disagrees with
the ledger, the ledger is right: it is what the suites record today.

### What holds

- The class tables, the XP table, proficiency bonus, hit dice, spell slot
  ceilings, cantrips and spells known, and prepared counts, at all 20 levels.
- Multiclass prerequisites in both directions for all 132 class pairs, the
  shared slot table, and class level kept apart from character level.
- Attack arithmetic, critical hits, advantage and disadvantage cancelling,
  concentration save DCs, Font of Magic, death save counting.
- Every mutation and encounter tool refuses malformed arguments and ids from
  another campaign, with no throw and no state change.
- Fifty concurrent calls on one sheet lose no update, and event sequence
  numbers are strictly increasing.
- Trades and shop purchases conserve gold and items.

## Decisions taken

| Question | Decision |
|---|---|
| A player refilling their own counters, slots or hit dice | A bug. A player spends; only the DM or the party lead puts uses back, as a correction. The same holds for a player raising their own HP or clearing their own conditions. |
| Where the rules live | On the server. A value the server accepts unchecked is a gap even where a comment calls it player-adjustable. |
| Ability Score Improvements | The SRD's, per class: fighter 4, 6, 8, 12, 14, 16, 19; rogue 4, 8, 10, 12, 16, 19; the others 4, 8, 12, 16, 19; by class level when multiclassed. Existing characters keep what they hold and are owed what the table adds. |
| Hit points | A campaign setting, `hpMethod`: average (the default), rolled by the server, or maximum. Level 1 is the die's maximum plus Constitution. |
| Armor class | Always derived. The DM or lead may pin a correction. |
| Starting wealth | A campaign setting, `startingWealth`: equipment plus the background's coin (the default), or rolled by class. |
| When a reaction, Dodge, Help, Shield and Protection end | The start of the relevant combatant's own turn, as the SRD says. Done: `conditionMeta.untilTurnOf`, `condition-tick.ts startTurnConditions`, `encounter-tools.ts advancePointer`. |
| Flanking, critical fumbles, lingering injuries | Flanking gets its mechanic on mapped fights. Fumbles and lingering injuries stay narration guidance and say so. |

## Repair plan

Carried out in full; every workstream below ended with its `gap()` calls turned
into `test()`. Kept as the record of what changed and why. Ordered by how many
gaps one change closes and how much a player gains while it stays open.

### 1. One legality check for every door a sheet comes through

The largest single cause. Creation, edit, level-up and import validate
storage bounds (`createSheetSchema`, `patchSheetSchema`), and every rule lives
in the builder and the level-up dialog.

- Add `sheetProblems(sheet, level, campaign)` beside `spellListProblems` and
  call it from the sheet POST, PUT and PATCH routes, `/api/characters`,
  companion creation and `character-bundle.ts` import.
- Derive on the server, never accept: hit dice, spell slots, casting ability,
  saving throws, class training, speed, AC, HP, resources, the `classes` array
  at creation.
- Build a level-up from the player's CHOICES (class, HP roll or average, ASI
  or feat, subclass, spells, expertise), one level at a time, only with the
  XP for it. The single-class branch and `buildMulticlassLevelUp` must share
  this.
- Keep `story` and `feat` features a request carries only when the DM or lead
  sends them.
- Let a racial cantrip sit outside the class cap, which today refuses every
  high elf caster.

Closes most high gaps in creation, progression, multiclass, the `patch-` rows
and import.

### 2. Who may write engine state

- `/sheet/usage`: a player may raise `used`, never lower it. Lowering is the
  DM's or the lead's, in or out of a fight.
- The level-up PATCH stops carrying HP, temp HP, conditions, XP, gold and
  equipment.
- A roll parked for real dice records why it was parked; typed faces are
  accepted only for that reason.
- Homebrew counts in play only when the table's owner made it, and never
  ahead of a published name. `equipment[].gear` is not accepted from the wire.
- A public sheet projection that leaves `notes` out of events and snapshots.

### 3. One guard for "may this character act"

`pc_attack` refuses an incapacitated character; `take_action`, `use_reaction`
and the three cast paths each have a weaker check, and none reads
`deathSaves.dead`.

- One `canAct(sheet, encounter, kind)`: not dead, above 0 HP, not
  incapacitated, their turn (or a reaction), the action kind still unspent.
- Casting adds: not raging, armor trained, not wild shaped, the spell on the
  sheet, components possible, the casting time charged to the turn budget.
- Off-turn calls are refused or charged as the reaction, never unbounded.
- Every refusal sits above every spend, so a refused attack costs no smite
  slot, Superiority Die or arrow.
- Death by exhaustion sets HP to 0; 0 HP sets unconscious and prone.

### 4. Casting that costs what it should

- A cast with no slot level uses the spell's own level, not the cantrip path.
- Spell attacks through `pc_attack` spend their slot.
- Healing and reaction spells spend their slot.
- A replaced concentration spell clears its effects from every target.
- Level, ritual and concentration flags fall back to the bundled spell data
  when there is no pack.
- The server owns the dice of every known spell (Magic Missile, Eldritch
  Blast beams, Sleep's pool).
- Buff durations longer than 100 rounds.
- The paladin's spell list, and slot tables for the third casters.

### 5. Combat corrections

- An all-surprised party still locks the order.
- Active effects reach initiative, skill checks, forced saves, attack rolls
  and enemy AC.
- Action Surge grants its action; a spell attack spends the whole action.
- Brutal Critical takes the highest tier instead of the sum; smite caps at 5d8.
- Enemies act once a round, not while surprised, and refill legendary actions.
- Opportunity attacks walk the path; an approaching enemy provokes.
- Cover for characters; disadvantage for a ranged attack with a hostile
  adjacent; Hide and Grapple read positions.
- Two-handed weapons and the versatile die need the free hand; loading limits
  attacks; an attack needs the weapon in the pack.

### 6. Damage, death and rests

- Resistance then vulnerability, rounded down, matched on whole words; magic
  weapons pass nonmagical resistance; petrified resists everything.
- Massive damage at 0 HP; Relentless Endurance not spent on it; stabilizing
  takes a check.
- Exhaustion level 4 halves the maximum.
- A long rest needs 1 HP and one per day; a gritty short rest is 8 hours
  (`test-calendar.mjs` pins 24 and changes with it).
- Wild Shape caps apply to forms outside the table, with a duration.
- Rollback snapshots the party stash, active effects and the clock.

### 7. Data

- Dwarven Combat Training, Elf Weapon Training, dragonborn ancestry, Infernal
  Legacy and Drow Magic by level.
- The 24 authored feats whose ability increase is never applied; Tough and
  Mobile; feat prerequisites; Elven Accuracy read from `feats`.
- Magic item name matching (a "Pouch" resolves to a magic item), Vorpal
  Sword, Defender, attunement restrictions, the cap of three at creation.
- Genre counters matched by exact name and granting class.
- The 2024 rows: hidden, or marked so the 2014 engine does not read them.
- The license line in `races.json`, which claims SRD for non-SRD lineages.

### 8. The human DM's console

Six forms do not reach their handler: Correct a sheet, Learn a spell, Use a
spell slot, Player attack, the cast forms, and End turn (which marks the turn
and never advances it). Fix the fields, and extend `test-invoke-catalog.mjs`
to compare every form's field names with its handler's schema.

### 9. Documentation

`rules-coverage.md` calls these enforced and the audit found otherwise:
untrained armor's attack disadvantage, the Wild Shape caps, the builder's
second reconcile, the reaction's reset. It also counts 29 SRD resource
counters where the file defines 14. Correct each row as its workstream lands.

## Client apps

The apps compile the server's screens, so workstreams 1 and 2 change what a
player's screen may send, and every refusal needs a message the screen shows.

| Server change | Carry-over to the clients |
|---|---|
| Level-up built from choices (1) | The level-up dialog sends choices, not a finished sheet; rebuild, and check the dialog on the phone shell |
| Creation derives HP, AC, gold (1) | The builder's review step shows derived numbers read-only, with the campaign's HP method |
| Usage route refuses refills (2) | The counters' minus button is hidden for a player and shown for the DM and lead |
| `canAct` refusals (3) | The hand's actions grey out with the engine's reason |
| New campaign settings | The settings screen, native and web |
| Console forms (8) | The DM console on the tablet layout |

Each is done when it has been seen running in the apps, not when the server
test passes.

## Not covered

- The AI turn loop and its per-turn caps, which need a model call.
- A full agent program turn through the MCP bridge (`test-harness-turn.mjs`
  covers it).
- Benched characters resting, torches burning across a rest, gale riders on a
  mapped fight, companion auto-act.
- The sheet PUT route, `PUT /api/characters/[characterId]`: read, and they
  share the schema the tested routes use, but no suite calls them.
