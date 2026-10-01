# Enforcement audit: conditions, exhaustion, damage, healing, death, hazards

The second audit and repair (2026-09-30) and the state after it are in [`../rules-enforcement-audit.md`](../rules-enforcement-audit.md); this report describes the first audit.

Area: `conditions`. Repo: `/home/lebbi/open-dungeon-master`. Ruleset: D&D 5e SRD 5.1 (2014).
Nothing under `src/` was edited. No existing test, `package.json` or `vitest.config.mts` was touched.

Totals: 9 test files, 379 `test()` enforced, 39 `gap()` findings (6 high, 14 medium, 19 low).
Every file passes both ways (`node scripts/test-enforce-x.mjs` and `npx vitest run scripts/test-enforce-x.mjs`),
was run five times in a row under node with identical results (45 runs, all exit 0), and also passes with
the content pack hidden (the CI case: 354 enforced, 36 gaps, the pack-only checks skip themselves).

## Verification pass (second agent, 2026-09-27)

The first agent was cut off while finishing. This pass changed no finding and removed none. What it did:

- Ran all nine files five times under node and once under Vitest, before and after its own edits, and
  once each with the pack hidden (a preload that answers "no" for `open5e.sqlite`; the file itself was
  not moved because other suites were running). Nothing was red or flaky.
- Read every gap's observed message from the harness report and the source line behind it. All 39 fail
  today for the stated reason. The gaps that loop over several conditions stop at the first failure, so
  each condition was probed on its own: all five incapacitating conditions let `take_action` (Dodge and
  Dash), `use_reaction`, `cast_at_enemy`, `cast_buff` and `use_spell_slot` through, and all four
  automatic-failure conditions let an enemy make its DEX save in both `aoe_damage` and `cast_at_enemy`.
- Corrected one claim: the move route does NOT answer for a character dead of exhaustion. Level 6 is past
  level 5, so the board refuses on speed 0. The note in `test-enforce-exhaustion.mjs` and the finding
  below now say so. Attack, action, reaction and the three cast paths were reproduced for a dead
  character holding hit points.
- Corrected three line references (see the findings) and softened the skeleton and zombie finding: the
  pack rows are as described, but whether Open5e or ODM's importer dropped the immunity was not traced.
- Added five `test()` to `test-enforce-conditions-duration.mjs`: durations against the in-world clock
  (`pass_time`, and a short rest's hour), the one save per stretch of time, an untimed condition
  outlasting days, and stat block condition immunities stated on the encounter snapshot so they are
  checked without the pack (`set_enemy_condition`, and a won grapple or shove that still does not land).
  Added the stout halfling's poison resistance to the racial resistance table in
  `test-enforce-damage-types.mjs`.
- Owner decisions: no `test()` in these files pins a player changing their own hit points, temporary hit
  points, conditions or death state; every such attempt is asserted as a refusal, and the two ways
  through are gaps (`bypass-level-up-patch-carries-engine-state`,
  `bypass-dead-character-levels-up-and-fights`). The one sentence that read as table trust, the header of
  `test-enforce-player-bypass.mjs` on counters, now says recovery outside a fight is a gap, recorded in
  `test-enforce-usage-route.mjs` (another area's file) and not duplicated here. Each file calls
  `world.close()` once, at its end. No file POSTs, imports or recruits a character. Every fight is played
  off the board or with placement pinned.
- Not verified: that a failing file turns Vitest red. Vitest reports each file as "1 passed, no tests"
  because the suites are plain programs; the shared harness was taken as proven, as the brief states.
- Dash rule: no em dash or en dash in any of the ten files or in this report.

## Files written

| File | Lines | test() | gap() |
|---|---|---|---|
| `scripts/lib/enforce-conditions.mjs` (shared kit for these nine files) | 161 | | |
| `scripts/test-enforce-conditions-attacks.mjs` | 256 | 63 | 3 |
| `scripts/test-enforce-conditions-actions.mjs` | 484 | 42 | 9 |
| `scripts/test-enforce-conditions-duration.mjs` | 475 | 50 | 3 |
| `scripts/test-enforce-exhaustion.mjs` | 259 | 32 | 4 |
| `scripts/test-enforce-damage-types.mjs` | 449 | 89 | 7 |
| `scripts/test-enforce-temp-hp-healing.mjs` | 244 | 15 | 1 |
| `scripts/test-enforce-death.mjs` | 421 | 24 | 6 |
| `scripts/test-enforce-player-bypass.mjs` | 298 | 27 | 3 |
| `scripts/test-enforce-hazards.mjs` | 320 | 37 | 3 |

The kit (`kit(world)`) adds: `offBoard()` (removes the encounter's tokens so no attack depends on the
randomly generated board), `freshTurn()`, `reset(id, extra)`, `resetEnemy`, `setEnemyStats` (rewrites the
encounter's own stat snapshot so resistances can be stated without the content pack), `withDice`,
`swing`, `endOwnTurn`, `skipTurn`, `pointer`, and `stateFrom(dice, total, modifier)` which reads
advantage or disadvantage out of the dice actually rolled.

Determinism: every fight is played off the board (tokens deleted) except the movement checks, which
delete the enemy tokens, find an open neighbouring tile by walking to it, and measure the step's own
cost first because the generated terrain can be rough ground. No test POSTs a character.

## Ruleset as implemented

### Conditions
- The 14 SRD conditions are plain lowercase strings on `sheet.conditions` and `enemy.conditions`, with a
  parallel `conditionMeta` map for durations. Named effects (Bless, Haste, dodging, raging, hidden,
  helped...) share the same list; their riders live in `src/lib/srd/condition-effects.ts`.
- Mechanics are in `src/lib/dm/condition-logic.ts` and are read by both sides of a fight:
  attacker disadvantage (prone, restrained, poisoned, blinded, frightened), attacker advantage
  (invisible, hidden), target grants advantage (restrained, blinded, incapacitated, paralyzed, stunned,
  unconscious, petrified), target invisible or dodging gives disadvantage, prone target gives advantage
  to melee and disadvantage to ranged, automatic critical on a melee hit against paralyzed or
  unconscious, speed 0 for grappled, restrained and the five incapacitating conditions, automatic
  failure of STR and DEX saves for paralyzed, stunned, unconscious, petrified, disadvantage on DEX saves
  for restrained, disadvantage on ability checks for poisoned and frightened.
- Charmed, deafened and the sight half of blinded carry NO mechanics. Nothing stores who charmed or
  frightened a creature, or who holds a grapple.
- Enemy stat-block condition immunities are honoured by `set_enemy_condition`, `cast_at_enemy`
  (refused before the slot is spent) and grapple/shove. Characters have no condition immunities.
- `canonicalCondition` maps near misses to SRD names using the content pack's condition list; with no
  pack only exact names (any case) resolve. Unknown names are legal custom conditions with no mechanics.

Deliberate deviations (documented in code or docs, pinned by `test()`):
- Durations tick when the initiative order WRAPS, once a round for everyone, not at the end of the
  affected creature's turn (`condition-logic.ts` ConditionMeta comment, `condition-tick.ts` header).
- Save-ends conditions are re-saved at that same wrap ("re-saved at the end of each round",
  `set_condition` tool description). SRD: end of each of the creature's own turns.
- Outside combat the in-world clock counts rounds, ten to the minute, and there is one save per passage
  of time, not one per elapsed round (`condition-tick.ts tickClockConditions`). Pinned by `test()`.
- "Within 5 ft" is approximated as "melee attack", and "further" as "ranged attack"
  (`pc-attack.ts:474`, `encounter-tools.ts:878`); the board's real distance is not consulted.
- Frightened applies regardless of the source's line of sight.
- The pointer only ever stops on player characters; enemies are passed and act through the DM or the
  auto-act fallback. A PC who cannot act is passed too (`encounter-tools.ts entryAlive`).
- Reactions such as Uncanny Dodge are "enforced (economy) + guidance (effect)" per
  `docs/rules-coverage.md`: the reaction is spent, the halving is left to the caller.

### Exhaustion
- A number 0 to 6 on the sheet, never a condition string. `set_condition exhaustion` adds one level,
  `clear_condition exhaustion` removes one, a long rest removes one (food and drink not tracked).
- Enforced: level 1 disadvantage on ability checks, skill checks and initiative; level 2 and 5 speed
  (through `pcMoveBudget`, used by the move route and the board); level 3 disadvantage on attack rolls
  (`pc_attack`) and on saves rolled through `request_roll` and `cast_at_player`; level 6 writes
  `deathSaves.dead`.
- Not enforced: level 4 (see findings).

### Damage
- 13 SRD types accepted as free text, matched case-insensitively by substring against a resistance line.
- Characters: resistances only, from race (dwarf and stout halfling poison, tiefling fire), feature
  names containing "resistance" plus a type, Rage, condition effects (Stoneskin, Absorb Elements, Blade
  Ward), attuned magic items. No character immunity or vulnerability exists.
- Enemies: `resist`, `immune`, `vulnerable` strings from the stat block; immunity first, then
  resistance or vulnerability.
- Order: flat modifiers and critical dice, then resistance, then temporary hit points, then hit points.
  Multiple sources of one resistance halve once.
- `apply_damage`, `heal` and `damage_enemy` take 1 to 200 a call. `apply_damage` and `heal` clamp a larger
  number; `damage_enemy` refuses it.
- Documented in `test-condition-logic.mjs` but in no doc: resisted damage never drops below 1.

### Temporary hit points and healing
- `heal` with `temp: true`; higher value wins; absorbed first; untouched by healing; cleared by a long
  rest; no duration of their own; do not wake a character at 0.
- Healing caps at the maximum, refuses 0 and negatives, refuses the dead, and ends the dying state.
- A healing spell named to `heal` is rolled from the pack's dice plus the caster's modifier.

### Death and dying (`death.ts`, `death-logic.ts`)
- Dropping to 0 opens `{successes:0, failures:0, stable:false, dead:false}`; hit points never go below 0.
- Massive damage on the drop: overkill (after resistance and temporary hit points) >= max HP kills.
- Death saves are rolled by the SERVER, a bare 1d20, when the pointer passes the dying character.
  10 succeeds, 9 fails, 1 is two failures, 20 restores 1 HP and clears the track, three of either ends
  it, not necessarily consecutive. The stable and the dead roll nothing. Players never roll or submit
  a death save; the pending-rolls route has no death save path.
- Damage at 0: one failure, two on a critical, a stable character starts dying again.
- `stabilize` sets `stable`. Relentless Endurance is burned automatically once per long rest.
- Death is reversed only by whoever runs the story through `/sheets/[sheetId]` (audited). No
  resurrection spell is modelled. Rests skip the dead; a long rest wakes the stable and the dying.
- Every acting handler refuses a character at 0 hit points by the NUMBER. None reads `deathSaves.dead`.

### Player-facing routes
- `PATCH /sheet`: outside a level-up only portrait, notes and backstory; engine-only fields
  (deathSaves, exhaustion, conditionMeta, concentratingOn, resources, wildShape) are not in the player
  schema and are dropped. PUT, DELETE, POST are lobby-only.
- `POST /sheet/usage`: spend-side counters only, clamped to their maximum, no recovery during a fight.
- `POST /battle-map/move`: refused at 0 HP, at speed 0, and off turn.

### Hazards
- Falling 1d6 per 10 ft, cap 20d6, bludgeoning, each victim rolls separately, 0 to 1000 ft accepted.
- Suffocation and drowning: the caller states `roundsWithoutAir`; past max(1, CON mod) the character
  drops to exactly 0 and starts dying.
- Extreme cold DC 10 and heat DC 5 CON save (DMG rule, not SRD), failure is one exhaustion level,
  cold or fire resistance is immunity to the weather. The heat DC does not rise on its own; the caller
  passes `dc` for later hours.
- Traps: DEX save, one DC per severity (11, 13, 18), SRD damage table by level tier, half on a save.

## Findings

Reproduce any of them with `node scripts/<file>`; the gap's function is the reproduction.

### High

**bypass-level-up-patch-carries-engine-state** (`test-enforce-player-bypass.mjs`)
- Rule: hit points, temporary hit points and conditions are engine state (ODM's own rule, sheet route comment).
- Observed: a dying player (0 HP, 2 failures, unconscious and stunned, 0 XP) sends
  `PATCH {level: 6, currentHp: 40, tempHp: 200, conditions: []}` and gets 200: 40 HP, 200 temporary,
  no conditions. `maxHp` and `gold` go through the same way.
- Root cause: `src/app/api/campaigns/[campaignId]/sheet/route.ts` PATCH, line 725: `levelingUp` is only
  `level > sheet.level`; line 823 then hands the whole parsed body to `patchSheet`. No XP check, no
  field allow-list for the level-up path.
- Fix: on the level-up path accept only the level-up fields, derive the HP gain server-side, and
  require `levelForXp(sheet.xp) >= level`.

**bypass-dead-character-levels-up-and-fights** (`test-enforce-player-bypass.mjs`)
- Observed: a DEAD character's player uses the same PATCH to reach 40 HP; `deathSaves.dead` stays
  true, and `pc_attack` then rolls for them.
- Root cause: as above, plus `src/lib/dm/pc-attack.ts:208-214` gates on `currentHp` and conditions only.
- Fix: refuse the PATCH for a dead sheet, and add a `deathSaves?.dead` refusal to every acting handler.

**exhaustion-death-leaves-the-body-standing** (`test-enforce-exhaustion.mjs`)
- Rule: exhaustion level 6 is death.
- Observed: level 6 writes `deathSaves.dead` and leaves `currentHp` untouched, so `pc_attack`,
  `take_action`, `use_reaction`, `cast_at_enemy`, `cast_buff` and `use_spell_slot` still answer for the
  dead character (each reproduced). The move route refuses, but only for the speed of 0 that level 5
  brings.
- Root cause: `src/lib/dm/mutations.ts:1147-1152` (set_condition exhaustion) and the same missing
  `dead` gate as above.
- Fix: set `currentHp: 0` with the death, and gate on `deathSaves.dead`.

**conditions-take-action-incapacitated** (`test-enforce-conditions-actions.mjs`)
- Rule: an incapacitated creature takes no actions.
- Observed: a stunned, paralyzed, petrified, unconscious or incapacitated character Dodges (and can
  Dash, Hide, Help, Grapple, Shove); the action is spent and the effect applied.
- Root cause: `src/lib/dm/action-tools.ts:253` checks `currentHp <= 0` only.
- Fix: the same `incapacitatedBy(sheet.conditions)` refusal `pc_attack` has.

**conditions-use-reaction-incapacitated**
- Observed: the same five conditions still spend a reaction (Shield, opportunity attack...).
- Root cause: `src/lib/dm/action-tools.ts:501-509` asks `conditionBlocksReactions` (registry riders
  such as Slow) and never the SRD conditions.
- Fix: refuse when `incapacitatedBy` returns a name.

**conditions-cast-incapacitated**
- Observed: a stunned or paralyzed caster casts a cantrip through `cast_at_enemy` and spends a slot
  through `use_spell_slot`; `cast_buff` behaves the same.
- Root cause: `src/lib/dm/cast-tools.ts:211` and `:519`, `src/lib/dm/mutations.ts:1277` (no condition
  check at all in `use_spell_slot`). `aoe_damage` with a `casterId` has no caster check either.
- Fix: one shared `canAct(sheet)` guard (0 HP, dead, incapacitated) used by every acting handler.

### Medium

**conditions-incapacitated-grants-advantage** (`test-enforce-conditions-attacks.mjs`)
- Rule: bare incapacitated only removes actions and reactions.
- Observed: attacks against an incapacitated creature roll two d20s and keep the higher, both directions.
- Root cause: `src/lib/dm/condition-logic.ts:35` spreads `INCAPACITATING` into `TARGET_GRANTS_ADVANTAGE`.
- Fix: list stunned, paralyzed, unconscious, petrified explicitly.

**conditions-charmed-may-attack-charmer**
- Observed: a charmed character attacks the creature that charmed them. `set_condition` stores no source.
- Root cause: `src/lib/dm/mutations.ts:1140` (set_condition), `pc-attack.ts handlePcAttack`.
- Fix: an optional `sourceEnemyId` in `conditionMeta`, read by `pc_attack` and `cast_at_enemy`. The same
  field would serve frightened (cannot approach) and grappled (ends with the grappler).

**conditions-concentration-survives-incapacitated** (pack only)
- Observed: a caster concentrating on Bless is stunned and keeps concentrating; the party keeps Bless.
- Root cause: `set_condition` never calls `breakConcentration`; only damage and 0 HP do
  (`src/lib/dm/concentration.ts`).
- Fix: break concentration in `set_condition` when the new condition is incapacitating.

**conditions-contest-ignores-check-disadvantage**
- Observed: a poisoned grappler rolls one d20 for Athletics. Same for shove and for Hide's Stealth, and
  exhaustion is ignored there too.
- Root cause: `src/lib/dm/action-tools.ts:383` and `:309` build `d20Expression` from the skill modifier only.
- Fix: route the contest through `resolveRollExpression` like `request_roll`.

**conditions-enemy-autofails-no-save**
- Observed: a paralyzed enemy makes its DEX save against an area effect (rolled 20, saved).
- Root cause: `src/lib/dm/encounter-tools-extra.ts:514` and `src/lib/dm/cast-tools.ts:340` roll
  `saveModFor(enemy.stats, ability)` with no look at `enemy.conditions`.
  `condition-tick.ts:82` has the same shape.
- Fix: call `rollDerivation(enemy.conditions, "saving_throw", ability)` first, as the character side does.

**exhaustion-level-4-hit-point-maximum**
- Observed: at level 4 of a 40 HP maximum a heal fills to 40 and a long rest restores 40.
- Root cause: `src/lib/dm/condition-logic.ts:308 exhaustionMaxHp` has no caller anywhere in `src/`.
- Fix: an effective maximum used by `heal`, `longRestPatch`, short rest healing and the clamp in
  `patchSheet`, and a clamp of current HP when level 4 is reached.

**exhaustion-area-save-rolls-straight**
- Observed: at exhaustion 3 the save in `aoe_damage` rolls one d20.
- Root cause: `src/lib/dm/encounter-tools-extra.ts:595` (the character save in `handleAoeDamage`) builds
  its expression from `rollDerivation` and condition riders only.
  Danger Sense and the armor rules are skipped for the same reason.
- Fix: build the save through `resolveRollExpression`.

**damage-magic-weapon-meets-nonmagical-resistance**
- Observed: a Longsword +1 dealing 10 slashing lands 5 on "bludgeoning, piercing, and slashing from
  nonmagical attacks". With the pack: a werewolf takes 0 from any weapon, magical or not.
- Root cause: `src/lib/dm/condition-logic.ts:357` matches on the type word alone; `pc-attack.ts:906`
  passes no magical flag although `profile.magicBonus` and `riders.magicalAttacks` are known. Spell damage
  of a physical type is halved too.
- Fix: a `magical` argument to `applyEnemyDamage` and `damageAdjust` that skips any clause containing
  "nonmagical" (and honours "silvered" and "adamantine" by item name).

**damage-petrified-takes-full-damage**
- Observed: a petrified enemy and a petrified character both take 10 from 10.
- Root cause: neither `pcResistances` (`condition-logic.ts:378`) nor `applyEnemyDamage`
  (`enemy-damage.ts:202`) reads the condition.
- Fix: treat petrified as resistance to every type in both paths.

**healing-spell-through-heal-spends-nothing** (pack only)
- Observed: `heal {spell: "Cure Wounds", casterId: <a fighter>}` rolls 1d8 and heals. No slot, no spell list.
- Root cause: `src/lib/dm/mutations.ts:782-812` rolls the spell and relies on the caller to have spent a slot.
- Fix: when `spell` is given, spend the slot inside `heal` through `use_spell_slot` and refuse on its error.

**death-zero-hit-points-is-not-unconscious**
- Observed: an attack on a dying character rolls one d20 and a melee hit costs one failure. No
  unconscious or prone condition is written at 0 HP, and none is removed or left by healing.
- Root cause: `src/lib/dm/death.ts:88 applyDamageDeathHook` writes the track only;
  `encounter-tools.ts handleEnemyAttack` reads `target.conditions`.
- Fix: have `attackContext` callers add "unconscious" and "prone" for a target at 0 HP, or write and
  clear the conditions in the death hooks (leaving prone after a heal).

**death-massive-damage-at-zero**
- Observed: 40 damage to a character at 0 of 40 is one failure.
- Root cause: `src/lib/dm/death.ts:107-109`, the already-down branch never calls `isMassiveDamage`.
- Fix: check `isMassiveDamage(math.overkill, maxHp)` before `onDamageAtZero`.

**death-relentless-endurance-survives-massive-damage**
- Observed: 45 damage at 5 of 40 leaves the half-orc at 1 HP.
- Root cause: `src/lib/dm/mutations.ts:721-722` spends the feature on `math.dropped` before the
  overkill is looked at.
- Fix: skip it when `isMassiveDamage(math.overkill, sheet.maxHp)`.

**death-stabilize-needs-no-check**
- Observed: `stabilize {characterId}` succeeds with no healer, no roll, no kit.
- Root cause: `src/lib/dm/mutations.ts:874-893`.
- Fix: take `healerId`, roll their Medicine against DC 10 (or consume a healer's kit use), refuse otherwise.

### Low

| id | Observed | Root cause | Fix |
|---|---|---|---|
| conditions-unconscious-implies-prone | ranged attack on an unconscious target rolls at advantage, SRD says straight | `condition-logic.ts:80 attackContext` | treat unconscious as also prone |
| conditions-prone-moves-at-full-speed | a prone character's step costs what it costs standing, and they stay prone | `battlemap/view.ts:206 pcMoveBudget`, move route | charge half speed to stand, or double cost |
| conditions-enemy-restrained-dex-save | restrained enemy's DEX save rolls one d20 | `encounter-tools-extra.ts:514`, `cast-tools.ts:340` | same as the auto-fail fix |
| conditions-grapple-outlives-grappler | grappler stunned, enemy still grappled | `action-tools.ts:432` stores `grappled` with empty meta | store the grappler id, clear on incapacitation |
| conditions-second-source-loses-its-duration | 1-round poison then 10-round poison: gone after 1 round | `mutations.ts:1165` returns "already" | keep the longer duration |
| conditions-sixteenth-dropped-silently | 16th condition answered ok and not stored | `mutations.ts:1168` `slice(0, 15)` | refuse, or evict a custom mark |
| conditions-exhausted-is-not-exhaustion | "exhausted" stored as a custom condition, level stays 0 | `mutations.ts:401 canonicalCondition`, `:1147` | map "exhaust" prefix to the track |
| exhaustion-server-saves-roll-straight | save-ends re-save at exhaustion 3 rolls one d20 (the gap's assertion); death save and concentration save likewise (both reproduced by probe) | `condition-tick.ts:127`, `death.ts:164`, `concentration.ts:179` | shared save builder |
| damage-undead-poison-immunity-missing | skeleton halves poison, zombie takes it whole | pack rows `skeleton` (vulnerable bludgeoning, RESIST poison, no immunity) and `zombie` (no damage lines at all); not traced to Open5e or to the importer | correct the rows in the normalizer |
| damage-resistance-floors-at-one | 1 resisted damage costs 1 | `condition-logic.ts:367`, `split-damage.ts:111` | drop the floor or document it as a house rule (an existing unit test pins the floor) |
| damage-resistance-with-vulnerability-cancels | 25 becomes 25, SRD 24 | `condition-logic.ts:363` | halve then double |
| damage-type-matches-on-a-fragment | type "fir" halved by fire resistance | `condition-logic.ts:357` | match whole words |
| damage-rider-takes-the-weapon-type | 9 slashing + 4 radiant vs slashing resistance costs 6, SRD 8 | `pc-attack.ts` folds riders into one expression | apply typed riders separately |
| death-the-dead-earn-experience | dead character awarded 100 XP; `finishEncounter` shares XP with the dead | `mutations.ts:553`, `enemy-damage.ts:338` (shares across `listSheets`; reproduced: a dead character took a third of the goblins' XP) | filter dead sheets |
| death-the-dead-roll-checks | `request_roll` rolls for a dead character | `invoke-roll.ts handleRequestRoll` | refuse |
| bypass-the-dead-spend-counters | dead character's player spends Second Wind | `sheet/usage/route.ts POST` | refuse for dead sheets |
| hazards-fall-does-not-leave-prone | no prone after a damaging fall | `hazard-tools.ts:179` | add prone when damage > 0 |
| hazards-damage-above-200-is-cut | suffocation on 230 HP leaves 30; a 24d10 trap can roll 240 | `mutations.ts:635` clamp applied to internal callers | clamp only model-supplied amounts |
| hazards-suffocating-creature-is-healed | a drowning character at 0 is healed | nothing records "without air" | a "suffocating" condition that `heal` and `stabilize` refuse |

## Not modelled (no mechanic exists; no gap recorded because the player gains nothing)

- Blinded automatically failing sight checks; deafened failing hearing checks; any effect of deafened.
- Charmer's advantage on social checks; frightened "cannot willingly move closer" (no source stored).
- Unconscious dropping what it holds; paralyzed and petrified "cannot speak" as such.
- Petrified immunity to poison and disease, weight, ageing.
- Character condition immunities and save advantages from race: elf Fey Ancestry (charm advantage, magical
  sleep immunity), dwarf and stout halfling advantage on saves against poison (the damage resistance IS
  enforced). Halfling Brave is enforced for the save-ends re-save and for `request_roll` with `against`.
- Dragonborn Damage Resistance: the feature is granted as "Damage Resistance (ancestry type)" with no
  ancestry choice, so it resists nothing (reproduced: 10 of every type lands whole). The player loses
  here and gains nothing, so it is listed and not a gap.
- Bear totem resistance, Heavy Armor Master reduction, Uncanny Dodge halving (documented as guidance).
- Ring of Resistance and Dragon Scale Mail parse to the type "one" and resist nothing.
- Character vulnerabilities and immunities of any kind.
- A stable creature regaining 1 HP after 1d4 hours.
- Spare the Dying as its own path, healer's kit uses, resurrection spells (Revivify and the rest: only
  the story authority reverses a death).
- Knocking a creature out instead of killing it; monsters always die at 0 HP. Undead Fortitude.
- Exhaustion on enemies (stored as a plain condition with no effect).
- Food and drink for the long rest's exhaustion recovery; temporary hit point durations.
- Extreme heat's rising DC and its disadvantage for heavy armor; cold weather gear.
- Damage over time from a condition or effect: nothing ticks damage; only durations and saves tick.

## Could not test, and why

- Distance-dependent rules (a ranged attack from within 5 ft against a prone or paralyzed target, reach
  weapons and the automatic critical): the engine never consults distance for them, and the board is
  randomly generated, so there is nothing stable to assert beyond the melee/ranged proxy that is pinned.
- Death saves for a physical-dice player through `pending-rolls`: read the route and `rollDeathSave`;
  the save is always server-rolled and never parked, so there is no player path to drive.
- `update_sheet` as the AI DM calls it: the human console's catalog entry takes a different shape
  (field and value), so `world.invoke` cannot send the model's arguments. The handler was read, not driven.
- Travel's forced-march exhaustion and companions' death handling: outside this area's handlers.
- AI narration itself: these suites prove what the engine refuses, not what a model writes.

## Notes for other areas

- The human console's catalog names `pc_attack`'s target `enemyId` while the handler reads
  `targetEnemyId`, and `cast_at_player` requires `spell` and `characterIds` while the handler reads
  `characterId`, `saveAbility` and `dc`. The suites send both shapes.
- With both "Longsword" and "Longsword +1" carried, `pc_attack {weapon: "Longsword +1"}` resolved the
  plain sword (no +1 to hit or damage). Seen while building the magic weapon gap; belongs to equipment.
- `use_reaction` does not check that the character has the named feature (a fighter "used" Uncanny Dodge).
- Several generated magic item rows carry junk resistance types ("such", "that", "the", "a", "all",
  "nonmagical"), and unattuned rows such as potions resist while merely carried.
