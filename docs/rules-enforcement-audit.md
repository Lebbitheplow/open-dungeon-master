# Rules enforcement audit

An audit of whether ODM's D&D rules are held by the engine or only said, run
on 2026-09-27 against server 0.23.10, and the repair that followed on the
`rules-enforcement` branch. The audit added suites that state each rule; the
repair changed the engine until every one of them holds. A second audit and
repair followed on 2026-09-30 on `rules-enforcement-2`; its section comes
first below. Everything after it is the first audit's text, kept as the record
it is.

**Status after the second repair: 131 suites, 2607 rules enforced, 0 open
gaps** with the content pack; without it the same 131 suites hold 2540 rules
with 0 gaps (pack-only rules do not run). The first repair ended at 81 suites
and 1764 rules (1704 without the pack). The ledger is empty; the per-area
reports in `rules-enforcement/` describe the state at the first audit, before
its repair.

- The list of open gaps: [`rules-enforcement-ledger.md`](rules-enforcement-ledger.md), generated.
- Root causes and fix notes per area (first audit): [`rules-enforcement/`](rules-enforcement/).
- What the engine is meant to enforce, with the suite that holds each row: [`rules-coverage.md`](rules-coverage.md).

## Second audit and repair (2026-09-30)

### Why it was run

The first repair made every rule its suites stated hold, but the suites only
stated what the first audit thought to write down. The goal set for the
stabilization milestone (issue #37) is that the engine holds at least 90% of
SRD 5.1, and that the rules it holds work through the UI and the AI narrator
DM. The second audit measured that directly, on `rules-enforcement-2` at
main 475b2515 (server 0.23.11), and found the real figure well under it.

### How it was measured

- Six read-only inventories, one per area, listing the SRD 5.1 rules of the
  area row by row and marking each held, partial, narrated, or missing or
  wrong, with the code path and, for most verdicts, a probe run through
  `dm/invoke.ts` with forced dice: class and racial features (the 181 with a
  numeric, state or action-economy effect; pure roleplay, subclass markers and
  spell-list grants left out), spells (all 319 SRD rows in the pack, run
  through the resolvers with the pack and without it), combat (139 rows, turn
  structure to the monster side), exploration, checks, items, rests and
  economy (86 rows), the narrator seam (every place the prompt or a tool
  description says something the engine does not do), and the UI (the Hand,
  the builder, the sheet and the DM console against the server).
- Magic items were counted over the content pack: the 237 SRD rows and all
  1618 rows.
- The repair ran as four waves of workstreams in one checkout. Every finding
  was first written as a `gap()` and run against the unfixed engine, to see
  it fail on its rule, then fixed and turned into a `test()` with the
  assertion unchanged. An assertion that misread the rule was corrected and
  the correction written down; none was weakened.
- After the third wave, read-only recounts re-ran the combat and exploration
  inventories without trusting the repair reports: a row counted as held only
  with a passing test or a probe. They put combat at 123 of 139 and
  exploration at 70 of 86, and they found defects the repair itself had
  introduced: rider dice dropped when they matched the base dice, grapples
  from reach breaking on any move, printed escape DCs ignored, a restraint
  outliving its grapple, enemy opportunity attacks bypassing the typed hit
  path, the string `"false"` read as true for a boolean argument, an Amulet of
  Health's hit points clipped by exhaustion, and a Shield with no list price.
  The fourth wave fixed each with a test that failed on the code before the
  fix, closed the remaining rows, and re-ran the recounts.

### Before and after

| Area | Counted over | Before the repair | After |
|---|---|---|---|
| Class and racial features | 181 mechanical features | 75 held (41%) | 181 held (3 partly: Natural Explorer's travel benefits, Primeval Awareness, Dragon Wings) |
| Combat | 139 rules | 74 enforced (53%) | 135 enforced (97%), 4 narrated by design, 0 missing |
| Exploration, checks, items, rests, economy | 86 rules | 28 held (33%) | 86 held (100%) |
| Spells, the effect layer | 319 SRD spells | 29 held, 110 partial, 32 wrong, 148 narrated | 200 held, 21 partial, 0 wrong, 98 narrated (91 of them pure utility) |
| Spells without the content pack | 319 SRD spells | 18 held, 16 partial, 4 wrong, 281 narrated | identical to the pack: 0 of 319 differ |
| SRD magic items with an engine mechanic | 237 | 23 (9.7%) | 108 (45.6%) |
| All magic items in the pack with an engine mechanic | 1618 | 105 (6.5%) | 577 (35.7%) |
| Authored subclass features | 533 | 32 typed, 150 counters, 166 with mechanical wording and no hook | 189 typed, 150 counters, 11 narrated with a written reason, 0 with mechanical wording and no hook |

The casting layer (the caster holds the spell, slot level, ritual, casting
time, components, concentration, DC and range) was close to 100% at the audit
and is counted apart from the effect layer above. The authored figures are
`srd/authored-coverage.ts authoredCoverage` as it counts today; the repair
reports stopped at 184 typed and 15 narrated before the Arcane Ward,
Projected Ward and the summons landed.

### Decisions taken

Everything the first repair decided still stands. Added:

- SRD 5.1 (2014) is the rule wherever ODM and the SRD disagree and nothing below says otherwise.
- The engine resolves and the model narrates: a tool that lets the AI assert a mechanical outcome without its cost or its roll is closed or routed through the rules path; the human DM's console keeps its correction power.
- Grapple and shove replace one attack of the Attack action, not the whole action.
- A touch spell is a melee spell attack with touch reach (adjacent on a map).
- A character attacks off their turn only as an opportunity attack (automatic) or a readied action.
- Bonus-action features are real: Cunning Action, Step of the Wind, Patient Defense, Flurry of Blows, Martial Arts' bonus unarmed strike, Frenzy, and Nimble Escape for monsters spend the bonus action.
- Reaction features resolve in the engine, including after a hit, against a record of the last attack on each character; no tool text tells the model to heal the difference.
- Reckless Attack, Stunning Strike and knocking a creature out (`nonlethal`) are engine options on `pc_attack`.
- Revivify, Raise Dead, Resurrection and True Resurrection work through the engine, their time windows checked before anything is spent.
- Every SRD magic weapon and armor gets its base item from the pack row's category, with an authored rider table for the SRD items with numbers; charges are tracked and regained at dawn; a pack item the generator cannot parse stays narrated, with its one-line effect and its worn and attuned state in GAME STATE; attuning takes a short rest.
- Light on attacks: on a mapped fight, a creature that cannot perceive its target attacks at disadvantage and one that cannot be perceived attacks with advantage, from the board's own light and senses. Off the map, conditions only.
- Tool proficiency adds the proficiency bonus to checks that name the tool. Inspiration is real state.
- Food and water are a variant rule, `supplies`, off by default (assumed supplied, like ammunition).
- Hit dice on a short rest: the player chooses; the server's default applies only to a character with no connected player.
- Surprise can be decided by the engine (the hidden side's Stealth against each opponent's passive Perception); the DM's explicit `surprised` stays as an override.
- Tool calls in one model reply resolve in the order the model sent them.
- The narration guard's rewrite gets one reserved model call outside the four-call turn budget.
- Stored data is never broken: old sheets, encounters and campaigns load and play; new fields are optional with a default; new validation applies to new writes.

The first audit's deviation "Metamagic shaping and most reaction effects are
narrated" is now only half true: the reactions resolve in the engine, the
metamagic shaping is still narrated. Its "Ammunition is assumed unless the
variant rule is on" is joined by food and water under `supplies`.

### New mechanics

Each group names the suites that hold it. `rules-coverage.md` has a row, and
the suite, for each.

- **Reactions after a hit.** The engine records the last attack against each
  character (the d20 faces, total, AC met, damage and type, ranged, attacker,
  the character as they stood before it; table `last_hits`). Shield, Uncanny
  Dodge, Deflect Missiles (and the throw back), Cutting Words, Protection,
  Slow Fall, Retaliation, Stand Against the Tide and Giant Killer re-resolve
  it, undoing a drop to 0 or a broken concentration where the new result
  calls for it. Hellish Rebuke, Feather Fall and Counterspell resolve through
  `use_reaction`; monsters Parry. Suites `test-enforce-reactions`,
  `test-enforce-final-features`, `test-enforce-tail-attacks`,
  `test-enforce-last-combat`.
- **Bonus-action features and the rest of the action list.** Cunning Action
  and Fast Hands, Step of the Wind, Patient Defense, Flurry of Blows,
  Martial Arts' bonus strike, Frenzy, Expeditious Retreat and Nimble Escape
  spend the bonus action; Ready (an attack or a spell), Search, Use an Object
  and Escape are real actions; Help names its creature. Suites
  `test-enforce-bonus-actions`, `test-enforce-turn-actions`,
  `test-enforce-pc-attack-features`, `test-enforce-tail-features`.
- **End-of-turn durations.** `untilTurnEndOf` beside `untilTurnOf`: Stunning
  Strike, Guiding Bolt, Menacing and Goading Attack, Intimidating Presence,
  Open Hand's no reactions, Hurl Through Hell and Chill Touch's undead dread
  end as the named turn ends. Old rows tick as before. Suite
  `test-enforce-turn-end`.
- **Spell areas on the map.** A zone record on the battle map (squares,
  caster, spell, concentration or duration) that movement, sight, perception,
  casting and the turn loop read: difficult terrain, light and heavy
  obscurement, magical darkness, Silence, walls (Wall of Ice by 10-foot
  sections with hit points), damage and saves on entering, starting or ending
  a turn and every 5 feet, Globe of Invulnerability, Antimagic Field,
  Forcecage, Antilife Shell, Earthquake. Drawn on the board, listed in GAME
  STATE, ended with the concentration or the duration. Suites
  `test-enforce-zones`, `test-enforce-last-spells`, `test-enforce-zones-ui`.
- **Summons.** The conjuring and animating spells, Faithful Hound and the
  Steel Defender put an ally on the board with its SRD stat block, a token,
  initiative and attacks through `pc_attack`, gone at 0 hit points or when
  the spell ends; Find Familiar binds a pet. Suite `test-enforce-summons`.
- **Magic items.** Base items, riders (+N, typed dice, dice against creature
  types, natural-20 dice on both dice paths, Adamantine Armor, curses),
  charges with the dawn regain and the last-charge d20, potions beyond
  healing, scrolls (the class list, the check above the reader's level, the
  scroll's DC), casting from a wand or scroll with no slot, check riders, CON
  items and the hit point maximum, attuning over a short rest. Suites
  `test-enforce-magic-gear`, `test-enforce-consumables`,
  `test-enforce-attunement`, `test-enforce-feature-saves`,
  `test-enforce-explore-defects`.
- **Afflictions.** The SRD diseases, the poison table (injury poisons coat a
  weapon) and the three madness tables, with incubation and durations on the
  clock, through the new `afflict` tool; lesser restoration ends a disease.
  Suite `test-enforce-afflictions`.
- **Lifestyle and downtime.** `set_lifestyle` charges the SRD daily cost at
  each dawn; `downtime` runs crafting, a profession, recuperating, research
  and training, and the sheet and GAME STATE show the progress. Suites
  `test-enforce-downtime`, `test-enforce-sheet-between`.
- **The supplies variant.** Off by default. On: a ration and water each dawn,
  3 + CON modifier days without food, half water a DC 15 CON save, the SRD's
  exhaustion schedule, and a long rest that keeps exhaustion while going
  without. Suites `test-enforce-supplies`, `test-enforce-explore-rules`.
- **Inspiration.** The DM awards it; the holder spends it for advantage on a
  check, save or attack (`useInspiration`). Suites
  `test-enforce-feature-saves`, `test-enforce-tail-attacks`,
  `test-enforce-final-ui`.
- **Tool proficiency.** A check that names a tool adds the proficiency bonus,
  twice with expertise. Suite `test-enforce-feature-saves`.
- **Knockout.** A melee attack declared `nonlethal` leaves the creature alive
  at 0, unconscious and prone, counted as defeated; later damage kills it.
  Suite `test-enforce-pc-attack-features`.
- **Light on attacks.** On a mapped fight both sides' sight of each other
  comes from the board's light, spell areas and senses; opportunity attacks
  need a creature the reactor can see. Off the board, a check reads the
  place's light (a cave is dark, a building lit). Suites
  `test-enforce-pc-attack-board`, `test-enforce-zones`,
  `test-enforce-explore-rules`.
- **Movement through creatures.** An ally's space, a hostile two sizes apart
  and (for a halfling) any larger creature are walked through at double cost
  and never ended in; squeezing; climbing and swimming speeds. Suites
  `test-enforce-tail-movement`, `test-enforce-objects-terrain`.
- **Jumping.** The long jump (the Strength score in feet after a 10-foot run,
  half standing) and the high jump (3 + the Strength modifier) on the board
  with `jump`, low obstacles, landing in difficult terrain; the Jump spell
  triples them. Suites `test-enforce-last-combat-board`,
  `test-enforce-spell-last`.
- **Dragging.** A grappler drags the creature it holds at half speed (a
  player's move with `drag`, an enemy's `move_token drag`) and sets it down
  beside itself, so the grapple holds. Suite `test-enforce-last-combat-board`.
- **Underwater.** A creature in deep water fights underwater: the SRD's weapon
  exceptions, disadvantage and the missed shot past normal range, fire
  resistance while immersed. Suite `test-enforce-last-combat-board`.

Also in this repair, without a group of their own: the monster side (stat
blocks parsed into Multiattack routines, riders, reach and range, recharge,
spellcasting and legendary actions; the common traits; enemies acting on their
own turn), the narrator seam (the AI's `update_sheet` limited to story fields,
refusals marked for the model, Hand cards stored as intent and refused up front
with the engine's reason), and the spell riders, revival spells, Dispel Magic
and caster features listed in `rules-coverage.md`.

### What stays narrated, and why

- **Combat, 4 of 139 rows.** Free object interaction (ODM tracks what is
  equipped, not the one free interaction a turn); a generic hazard's DC and
  dice (the SRD gives none; every hazard with numbers is resolved); enemy
  target choice and morale (the DM's decision in the SRD itself; the backstop
  picks the nearest seen, lowest-AC target and `enemy_flees` records a rout).
- **Exploration.** Foraging and navigation (DMG, not SRD 5.1) and an
  interrupted rest (`take_rest` is atomic: not calling it is the
  interruption), counted as held by design.
- **Features, 3 partly.** Natural Explorer's travel benefits, Primeval
  Awareness's answer, and sprouting Dragon Wings (the flying speed is always
  there): the numbers are held, the rest is the DM's to say.
- **Spells.** 91 pure utility spells, where narration is the resolution
  (Mending, Knock, Comprehend Languages, Teleport...). Seven with a mechanic:
  Time Stop, Telekinesis, Alter Self, Meld into Stone, Hallucinatory Terrain,
  Stone Shape and Move Earth (they change the map or need a contest no tool
  resolves). The 21 partial spells each keep one named part narrated, for
  example Calm Emotions' suppression of charm and fear, Antimagic Field on
  magic items and summons, Reverse Gravity's fall (the board has no heights).
- **Magic items.** 129 SRD rows (Bag of Holding, Boots of Speed, Cloak of
  Displacement, Ring of Spell Storing and the like) and the non-SRD pack rows
  the generator cannot parse: GAME STATE carries each carried item's one-line
  effect so the model narrates it from the text.
- **Authored features, 11.** Roleplay or information (Master of Nature, Know
  Your Enemy, Weapon Bond, Storm Guide, Telepathic Speech, Moon Fire,
  Illusory Reality, Wizardly Quill), a position or companion the engine does
  not track (Manifest Echo, Ranger's Companion), and Unstable Backlash, which
  rerolls the narrated Wild Surge table. Each reason is written in
  `srd/authored-effects-data*.ts`.
- **Metamagic shaping**, as before: the sorcery points are spent, the
  targeting is narrated.

### New suites

Fifty suites were added, every one green with the content pack and without it:

- Actions, reactions and turns: `test-enforce-bonus-actions`,
  `test-enforce-reactions`, `test-enforce-turn-actions`,
  `test-enforce-turn-end`.
- Character attacks and movement: `test-enforce-pc-attack-features`,
  `test-enforce-pc-attack-spells`, `test-enforce-pc-attack-board`,
  `test-enforce-tail-attacks`, `test-enforce-tail-features`,
  `test-enforce-tail-movement`.
- Monsters and the board: `test-enforce-monster-blocks`,
  `test-enforce-monster-actions`, `test-enforce-monster-traits`,
  `test-enforce-enemy-turns`, `test-enforce-last-combat`,
  `test-enforce-last-combat-board`.
- Spells: `test-enforce-spell-engine`, `test-enforce-spell-rows`,
  `test-enforce-spell-riders`, `test-enforce-spell-tail`,
  `test-enforce-spell-hooks`, `test-enforce-spell-last`,
  `test-enforce-last-spells`, `test-enforce-caster-features`,
  `test-enforce-zones`, `test-enforce-summons`.
- Features: `test-enforce-feature-saves`, `test-enforce-feature-uses`,
  `test-enforce-authored`, `test-enforce-final-engine`,
  `test-enforce-final-features`.
- Gear, exploration and economy: `test-enforce-magic-gear`,
  `test-enforce-consumables`, `test-enforce-economy`,
  `test-enforce-exploration`, `test-enforce-objects-terrain`,
  `test-enforce-rest-choice`, `test-enforce-roll-carriers`,
  `test-enforce-supplies`, `test-enforce-explore-defects`,
  `test-enforce-explore-rules`, `test-enforce-downtime`,
  `test-enforce-afflictions`.
- The narrator and the screens: `test-enforce-narrator`,
  `test-enforce-ui-play`, `test-enforce-ui-dm`, `test-enforce-final-ui`,
  `test-enforce-zones-ui`, `test-enforce-board-moves`,
  `test-enforce-sheet-between`.

Beside them, `test-hand-area`, `test-hand-engine` and `test-hand-final` hold the
Hand's pure logic, and `test-feature-coverage` and `test-invoke-catalog` were
extended (the authored tiers; every console form offers every field its handler
takes).


## Third pass: the gap suites (2026-10-08)

### Why it was run

Two weeks of issues (#30 to #132) and the pull requests that closed them
clustered in four places: picks a character creator loses on the way to the
sheet (#111 to #128), a human DM's console and the fight it runs (#63, #69,
#108), narration and state drifting apart over time (#30, #31, #91), and
rolls the table never sees (#58, #61). Four suites were written to hunt in
those places rather than to re-prove the rows already held.

### The suites

- `test-enforce-console-reach`: every adjudication in the catalog, run as a
  person in the DM seat with the console's own field shapes (a hero or enemy
  for a picker, the first option of a select, the minimum of a number), at a
  table with a fight on and at a quiet one. A rules refusal is the engine
  answering; an argument fault or a throw is a door painted on a wall.
  `ODM_CONSOLE_OUTCOMES=<file>` writes every entry's answer for reading.
- `test-enforce-creator-doors`: a legal character from the builder with one
  thing added by hand (a racial skill on a race with no skill choice, a feat
  on a plain human, a fighting style on a wizard, a subclass at 1st level,
  a third language, tool, save or skill, a faster speed, experience and
  spent hit dice), posted through both creation doors.
- `test-enforce-between-fights`: what a spell or feature with a duration
  does when the in-world clock moves rather than the initiative order:
  Bless and Spiritual Weapon's minute, Rage's minute, Hunter's Mark across
  the end of a fight, Conjure Animals' hour, Mage Armor through a short rest
  and not past a long one, Aid's eight hours, rounds left at a fight's end
  becoming minutes.
- `test-enforce-settings-honored`: every key of the game-settings schema is
  read by something outside the schema and the panels that edit it, and
  the hit point method (average, max, rolled) through the level-up route.

### What they found, each fixed the same day

| Severity | Finding | Where it was |
|---|---|---|
| high | `set_effect` ("A lasting effect") could not be run by anyone since 0.12.0. The console's `field`, `mode` and `value` were folded into `modifiers` and the required `field` then reported missing; the model's `modifiers` alone failed the same check. The suites that used it passed only by sending both shapes at once. | `invoke.ts` normalizeArgs, `catalog-types.ts` checkArgs |
| medium | An NPC reaction with a penalty rolled `2d6+-3`, which no dice parser reads: a DM could not give a reaction roll a penalty from the console or the model. | `social-tools.ts` handleNpcReaction |
| medium | A conjuring spell's creatures faded on the clock or at the round wrap and the caster went on concentrating on the spell: the next concentration spell was told it replaced one that no longer existed. | `concentration-upkeep.ts` endConcentrationOnFadedSummons, called from `condition-tick.ts` and `encounter-tools.ts` |
| low | `aoe_damage` and `use_reaction` were offered at a quiet table and refused for want of a fight (`needsEncounter` unset). | `catalog-combat.ts` |
| low | Under `hpMethod: rolled` the hit die a level-up rolled left no dice card: the player saw a number arrive and no die. | `sheet/route.ts` (now `rollCard`) |

Everything else the four suites ask is held: 192 + 15 + 11 + 67 rules, no
known gaps. The character creator's doors refused or corrected every
smuggled pick; every duration on the clock ran out when the rulebook says;
every other console form reached the engine or a refusal in words.

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
