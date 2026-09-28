# Enforcement report: spells

Area: spell slots, spell data, casting legality, concentration, spell effects, learning spells.
Written by the continuing agent (the first agent on this area was cut off; its seven test files
and two helpers were kept, run, reviewed gap by gap, and extended with four new files).

All eleven files pass both ways (`node scripts/<file>` and `npx vitest run scripts/<file>`), with
the content pack and without it (`CONTENT_DB_PATH=/nonexistent`), and each was run five times in
a row under node with identical counts. No file is over 500 lines. No em dash or en dash in any
file. Nothing under src/ was touched, and neither shared helper was edited.

## Ruleset as implemented

What ODM supports for spells, and where it says so:

- Slot tables: full casters, half casters (paladin, ranger: none at 1st level), warlock Pact
  Magic, and the artificer (not SRD 5.1, shipped by ODM). `src/lib/srd/spell-slots.json` matches
  the SRD rows for every level 1 to 20. Multiclass casters share the full caster table by caster
  level; Pact Magic is kept apart.
- Spell lists per style (`src/lib/srd/spell-prep.ts` header): "known" (bard, sorcerer, warlock,
  ranger), "prepared" (cleric, druid, paladin, artificer), "spellbook" (wizard). Cantrips known,
  spells known, prepared = modifier + level (half level for a paladin, minimum 1), a wizard's
  starting book of six and two per level. These counts ARE enforced at creation, edit and
  level-up, at every level 1 to 20 (test-enforce-spell-counts.mjs, no gaps).
- Spell data in three layers: the Open5e content pack (SRD 5.1 rows, third party rows, an SRD
  5.2 backfill), `authored-spells.json` (ODM's own restatements), `manifest/spells.json` (name,
  level, school, class list for every official spell). Mechanics come from authored `mech`
  blocks, `MECH_OVERRIDES` in `spell-mechanics.ts`, then prose parsers in `spell-scaling.ts`.
- Casting tools: `use_spell_slot`, `cast_at_enemy`, `cast_buff`, `aoe_damage`, `pc_attack` with a
  `spell`, `heal` with a `spell`, `use_reaction` (the Shield spell only), `learn_spell`.
- Concentration is tracked on the sheet (`concentratingOn`) and on the enemy row.

Deliberate deviations from SRD 5.1, each pinned as a test() with a comment:

| ODM's rule | SRD 5.1 | Declared in |
|---|---|---|
| Durations count down once a round for everybody, at the round wrap. Shield therefore lasts until the round ends, not until the caster's next turn | per creature turn | `src/lib/dm/condition-tick.ts` header, `condition-logic.ts` ConditionMeta |
| Every spell attack has a range of 120 feet, touch spells included | each spell's own range | `src/lib/dm/attack-logic.ts` spellAttackProfile ("real per-spell ranges are not modeled") |
| With no battle map there are no spatial rules at all | n/a | `src/lib/dm/map-tools.ts` |
| A slot named without a spell still spends | no such thing | `src/lib/dm/mutations.ts` use_spell_slot ("weak tool calling must not break casting") |
| Arcane Recovery: the server picks the slots, lowest first | the wizard picks | `src/lib/dm/rest-tools.ts` applySlotRecovery |
| Unknown or homebrew spells resolve with the caller's numbers | n/a | docs/rules-coverage.md, "Unknown/homebrew spells: guidance" |
| A patron's and a domain's spells arrive on the sheet for free | patron spells only join the list to pick from | docs/rules-coverage.md, "Subclass spell lists" |
| Reactions other than Shield: the economy is enforced, the effect is guidance | n/a | docs/rules-coverage.md row "Reactions" (see limit-reaction-spells-unpaid: the slot is not part of "the effect") |

Owner decision applied: the player refill of spell slots through the usage route, which the
first agent had pinned as "ODM's rule", is now gap `usage-route-refills-spell-slots` (high).

## Files

| File | test() | gap() | Without the pack |
|---|---|---|---|
| scripts/lib/enforce-spells.mjs | helper | | slot tables, caster fixtures, fightDummies, layMap |
| scripts/lib/enforce-spell-table.mjs | helper | | 84 spells typed from SRD 5.1 |
| scripts/test-enforce-spell-slots.mjs | 21 | 6 | same |
| scripts/test-enforce-spell-counts.mjs (new) | 10 | 0 | same |
| scripts/test-enforce-spell-data.mjs | 12 | 8 | 6 and 3 |
| scripts/test-enforce-spell-mechanics.mjs | 10 | 4 | 4 and 0 |
| scripts/test-enforce-spell-effects.mjs (new) | 11 | 3 | same |
| scripts/test-enforce-spell-learning.mjs (new) | 7 | 14 | same |
| scripts/test-enforce-casting.mjs | 16 | 7 | 12 and 11 |
| scripts/test-enforce-casting-numbers.mjs | 12 | 7 | 6 and 5 |
| scripts/test-enforce-casting-limits.mjs | 9 | 12 | same |
| scripts/test-enforce-casting-components.mjs (new) | 3 | 5 | same |
| scripts/test-enforce-concentration.mjs | 12 | 7 | 10 and 9 |
| Total with the pack | 123 | 73 | 79 distinct gap ids counting the six that exist only without the pack |

Severity count over the 79 ids: 13 high, 40 medium, 26 low.

How to reproduce any finding: run its file; the gap's body is the reproduction, and
`ODM_ENFORCE_REPORT=/tmp/x.jsonl node scripts/<file>` writes the observed behaviour per gap.

## Findings

### High

| id | File | Rule | Observed | Root cause | Fix |
|---|---|---|---|---|---|
| usage-route-refills-spell-slots | spell-slots | Slots come back at a rest; a player cannot lower their own used count | POST `{slots:{3:0,1:0}}` by a plain member answers 200 and the slots are back | `src/app/api/campaigns/[campaignId]/sheet/usage/route.ts` POST: the recovery check (lines 74 to 94) runs only inside an active encounter | Refuse any `used` lower than the stored one for slots, hit dice and resources unless the caller is the DM or party lead |
| slots-creation-trusts-client | spell-slots | A new character's slots are the class table's | A 1st level wizard is stored with nine 1st level and four 9th level slots | sheet route POST: `spellListProblems` checks lists, nothing checks `slots`. Same finding as creation-spell-slots in the creation report | Derive slots server side from `slotTableFor` and ignore the client's |
| slots-levelup-trusts-client | spell-slots | A level-up cannot grant more slots than the new row | A wizard reaching 6th level writes itself four 9th level slots | sheet route PATCH, single class path, `patchSheet(sheet.id, parsed.data)` | As above, at level-up |
| cast-levelled-spell-without-a-slot | casting-components | A spell of 1st level or higher expends a slot | `cast_at_enemy` with Hold Person or Burning Hands and no `level` resolves in full, no slot, no concentration | `src/lib/dm/cast-tools.ts` handleCastAtEnemy line 295: `if (args.level) {spend} else {cantrip path}`; the spell's level is never asked | When `level` is missing use `resolvedMech.spellLevel` (as handleCastBuff does) or the checklist's `spellLevelOf`; take the cantrip path only for level 0 |
| cast-attack-spell-spends-no-slot | casting-numbers | Guiding Bolt costs a 1st level slot | `pc_attack` with `spell: "Guiding Bolt"` hits and no slot is spent; works with every slot used | `src/lib/dm/pc-attack.ts` handlePcAttack: the spell branch never calls use_spell_slot and the schema has no slot level | Add `level` to pc_attack, spend through use_spell_slot for a spell of level 1 or more, refuse when it fails |
| limit-incapacitated-casts | casting-limits | An incapacitated creature takes no actions | Paralyzed, stunned, unconscious, petrified and incapacitated casters all cast through use_spell_slot, cast_at_enemy, cast_buff and aoe_damage | none of the four asks `condition-logic.ts incapacitatedBy`; pc_attack does | One shared `canCast(sheet)` guard called first by every cast tool |
| limit-casting-spends-no-action | casting-limits | Casting takes the spell's casting time | Hold Person, then Fireball, in one turn; the turn budget shows the action unspent. Overlaps economy-save-spell-spends-no-action in the action economy suite | no cast tool touches `src/lib/dm/action-budget.ts` | Spend action, bonus action or reaction from the pack row's casting_time inside the shared guard |
| conc-replaced-spell-keeps-its-effects | concentration | A second concentration spell ends the first and its effects | The party stays blessed while the cleric concentrates on Hold Person | `src/lib/dm/mutations.ts` use_spell_slot: `setConcentration` returns `displaced` and nothing calls `clearSpellConditionsByName` for it (the enemy path does) | Call `clearSpellConditionsByName(campaign, displaced, userId)` in setConcentration |
| learning-levelup-off-list-spell | spell-learning | A spell learned is on the class's list | A sorcerer levels up knowing Cure Wounds; castable at once | sheet route PATCH and `spell-prep.ts spellListProblems`: counts and levels only, `checklistClassSpell` never asked | Check every newly added name against the class list (pack, then checklist); allow only names the user's homebrew defines |
| learning-levelup-wizard-prepares-outside-the-book | spell-learning | A wizard prepares from the book, two new spells a level | A wizard with a one spell book levels up with five new spells prepared, none written | sheet route PATCH lines 788 to 803: the two per level check counts `next.spellbook` only | Count new names across prepared, pending and spellbook together; require prepared to be inside the book |
| learning-levelup-known-caster-second-list | spell-learning | A sorcerer holds what Spells Known gives | known at the limit plus seven spells in `prepared` is stored; all castable | PATCH line 776 and `heldSpells`: a known caster's `prepared` is never counted | Count the union, or refuse a non empty `prepared` on a known caster |
| learning-levelup-casting-ability-chosen | spell-learning | A wizard casts with Intelligence | A wizard with INT 8 and CHA 20 levels up into a Charisma caster | PATCH stores `spellcasting.ability` as sent and sizes the prepared limit from it | Take the ability from the class definition, never from the request |
| learning-levelup-noncaster-gains-spellcasting | spell-learning | A class with no Spellcasting has no spells | A fighter levels up with Fire Bolt, Eldritch Blast, four 1st and two 9th level slots | PATCH: the allowance block needs `sheet.spellcasting`, and spellListProblems has no table for a fighter | Refuse `spellcasting` in a patch when no class on the sheet casts |

### Medium

| id | File | Rule | Observed | Root cause | Fix |
|---|---|---|---|---|---|
| slots-third-caster | spell-slots | Eldritch Knight and Arcane Trickster have third caster slots | `slotTableFor` answers `{}` | fighter and rogue are casterType none in `src/lib/srd/index.ts`; no third table in spell-slots.json | Add a third caster table keyed by subclass |
| slots-levelup-not-derived | spell-slots | A level gives the next slot row | A wizard at 6th level keeps 4/3/2 | single class PATCH stores what the client sent, nothing when it sent none | Size slots from the table in both level-up paths |
| data-paladin-list-missing | spell-data | Bless, Cure Wounds, Revivify and the rest are paladin spells | None is on the paladin list; through the spells route a paladin is refused Bless and Cure Wounds (reproduced) and offered only the smites and Find Steed | `manifest/spells.json` and the pack's `classes_csv`, both from Open5e's spell_lists (`scripts/import-open5e.mjs`) | Patch the importer with the SRD paladin list |
| data-srd-spell-shadowed | spell-data | An SRD name resolves to the SRD spell | Protection from Energy and Sleet Storm resolve to Level Up rows at 2nd level; Haste to a5e text | `src/lib/content/index.ts` searchSpells ORDER BY level, name with no document preference | Prefer `wotc-srd`, then `odm-expanded`, on a name tie |
| mech-no-upcast-line-no-dice | spell-mechanics | Harm 14d6, Chain Lightning 10d8, Meteor Swarm 40d6... | No dice derived, so the caller's are rolled | `spell-scaling.ts upcastDamage` returns null without a "damage increases by" line | Fall back to `baseDamageDice` when there is no upcast line |
| mech-second-damage-term-dropped | spell-mechanics | Ice Storm 2d8 + 4d6, Flame Strike 4d6 + 4d6, Disintegrate 10d6 + 40 | First term only, and it overrides the caller | `spell-scaling.ts baseDamageDice` | Parse every dice term and flat bonus in the damage sentence, or author `mech` rows |
| effects-bane-does-nothing-to-enemies | spell-effects | A baned creature subtracts a d4 from attacks and saves | The enemy carries `baned` and attacks and saves with no d4 | `conditionRollRiders` is asked only for sheets (pc-attack.ts, rolls.ts, aoe for characters); enemy d20s in encounter-tools.ts enemy_attack, cast-tools.ts and aoe use the stat block alone | Apply `conditionRollRiders(enemy.conditions, ...)` to enemy attack rolls and saves |
| effects-long-durations-end-after-ten-minutes | spell-effects | Mage Armor lasts 8 hours | Gone after ten minutes of `pass_time`; same for Hunter's Mark, Barkskin, Stoneskin, Invisibility | `cast-tools.ts` handleCastBuff `Math.min(100, buff.rounds)`; the comment assumes rounds tick only in encounters, but `tickClockConditions` ticks them on the clock | Drop the cap (set_condition already stores hours as rounds) |
| learning-levelup-cantrip-list-holds-spells | spell-learning | Cantrips known are cantrips | Fireball and Wish stored as cantrips | `spellListProblems` counts the cantrip list and never reads the names | Require `spellLevelOf(name) === 0` (or a pack row at level 0) |
| learning-levelup-swaps-unbounded | spell-learning | One known spell may be replaced per level | Six of six replaced | PATCH never compares the new list to the old | Allow at most one removal per level gained for known casters |
| learning-levelup-racial-cantrip-counted | spell-learning | A high elf's racial cantrip is on top of the class's | A high elf wizard cannot reach 4th level with an honest sheet. Level-up twin of creation-high-elf-cantrip | `spellListProblems` holds every cantrip against the class column | Add the race's granted cantrip count to the cap |
| learning-learn-spell-unchecked | spell-learning | A taught spell is one the class can cast | A 1st level wizard's book takes Wish and Cure Wounds, a fourth cantrip joins three | `mutations.ts` learn_spell checks the count only | Check level and class list; hold cantrips to the column |
| learning-console-spell-name-ignored | spell-learning | The console's Spend a spell slot checks the spell named | The form's field is `name`, the handler reads `spell`: every console cast is nameless | `src/lib/dm/catalog-party.ts` use_spell_slot | Rename the field to `spell` |
| cast-noncaster-cantrip-and-ritual | casting | A non caster casts nothing | A fighter's Fire Bolt and ritual Detect Magic return ok | use_spell_slot skips the list check when `spellcasting` is null and returns before any slot is looked for | Refuse when `sheet.spellcasting` is null |
| cast-aoe-noncaster | casting | as above | aoe_damage by a fighter with an unknown spell name resolves | `encounter-tools-extra.ts` handleAoeDamage consults the sheet only when the pack knows the spell | Require spellcasting on any `casterId` with a `spell` |
| cast-ritual-from-spellbook | casting | A wizard casts rituals from the book unprepared | Refused | the list check runs before the ritual branch | Let a spellbook caster's ritual pass the list check from the book |
| cast-ritual-without-ritual-casting | casting | Only bard, cleric, druid, wizard cast rituals | A sorcerer casts Detect Magic as a ritual, free | `args.ritual` is checked against the spell, never the caster | Check the class for Ritual Casting |
| cast-eldritch-blast-beams | casting-numbers | Two beams at 5th level, each its own roll | The second beam is refused as a second attack | pc_attack spends the Attack action per spell attack | Give cantrip beams their own count per cast |
| cast-magic-missile-dice | casting-numbers | 3d4 + 3 from a 1st level slot | The caller's 10d10 is rolled | override row has no dice | Author the dice and the upcast |
| cast-known-spell-callers-dice | casting-numbers | Harm is 14d6 | The caller's 20d12 is rolled | `scaled?.dice ?? args.damage` | Same fix as mech-no-upcast-line-no-dice |
| cast-sleep-rolls-a-save | casting-numbers | Sleep rolls 5d8 of hit points, no save | A 90 hit point creature falls asleep on a failed save | no mechanics row for Sleep | Author a hit point pool resolution |
| cast-bless-target-count | casting-numbers | Bless: three creatures, one more per slot level | Four blessed from a 1st level slot | handleCastBuff takes up to six | Carry `targets` and `targetsPerSlotLevel` on the buff row |
| cast-healing-spell-unpaid | casting-numbers | Cure Wounds needs the spell and a slot | A fighter heals 72 with a "9th level" Cure Wounds | `mutations.ts` heal: a named spell only picks the dice | Spend through use_spell_slot inside heal when `spell` is set |
| limit-dying-and-dead-casts | casting-limits | The dying and the dead cast nothing | use_spell_slot and aoe_damage go through | neither reads currentHp or deathSaves | shared guard |
| limit-raging-casts | casting-limits | No casting while raging | all four tools cast | no check | shared guard |
| limit-untrained-armor-casts | casting-limits | No casting in armor without proficiency | a wizard in plate casts | `acBreakdownFor` knows, the cast tools do not ask | shared guard |
| limit-wild-shape-cantrips | casting-limits | No spells in Wild Shape below 18th level | cantrips and spell attacks go through | the gate lives only in use_spell_slot | shared guard |
| limit-casting-out-of-turn | casting-limits | An action spell is cast on the caster's turn | cast on another's turn | no look at the pointer | shared guard |
| limit-reaction-spells-unpaid | casting-limits | Counterspell costs a slot and must be known | a cleric counterspells free | `action-tools.ts` handleUseReaction ties only Shield to the sheet | Route any reaction whose name is a spell through use_spell_slot |
| limit-costly-material-unpaid | casting-limits | Revivify needs 300 gp of diamonds | cast with nothing | material line never read | Parse the cost, check and consume from equipment or gold |
| limit-save-spells-ignore-the-map | casting-limits | Range and a clear path | Hold Person lands through a wall at 270 feet | positions are read to draw, never to refuse | Reuse checkPcAttackRange with the pack row's range |
| limit-bonus-action-spell-then-levelled-spell | casting-components | After a bonus action spell only a cantrip | Healing Word then Hold Person | same root as limit-casting-spends-no-action | same fix |
| cast-target-creature-type | casting-components | Hold Person targets a humanoid | a beast is paralyzed | no target restriction in MECH_OVERRIDES, `enemy.stats.type` never read | Add `targetTypes` to the rows that have one |
| components-verbal-while-silenced | casting-components | No verbal spells without a voice | a silenced wizard casts | components are read nowhere in src/lib/dm | Add a `silenced` condition that the shared guard checks against the row's components |
| conc-incapacitated-keeps-concentrating | concentration | Incapacitation ends concentration | kept under all five conditions | set_condition and cast_at_player never call breakConcentration | Call it when an incapacitating condition lands |
| conc-war-caster | concentration | Advantage on concentration saves | one d20 | concentrationDamageHook reads no feats | Roll with advantage when the sheet has the feat |
| Only without the pack: cast-aoe-unknown-spell-nopack, cast-slot-below-level-nopack, cast-ritual-untagged-nopack, conc-untracked-without-pack | casting, concentration | list check, slot level, ritual tag, concentration flag | each rule silently stops holding on a server with no pack | the engine reads level, ritual and concentration from the pack only; the bundled checklist knows every level | Fall back to `spellLevelOf` and carry ritual and concentration in the manifest |

### Low

| id | File | Observed and root cause | Fix |
|---|---|---|---|
| slots-rest-does-not-restore-table | spell-slots | A long rest clamps slot maxima down to the table, never up (`rest-logic.ts longRestPatch`) | Set maxima to the table |
| data-class-not-a-caster | spell-data | Ceremony filed under "herald", Gift of Gab under "rogue" | Fix the two rows |
| data-subclass-spells-on-class-lists | spell-data | Domain and patron grants folded into parent class lists (Stoneskin for every cleric) | Filter in the importer |
| data-material-unnamed | spell-data | Water Walk has M and no material | Fix the row |
| data-school-outside-the-eight | spell-data | a5e Haste has school "transformation" | Normalize on import |
| data-2024-rows-unstructured | spell-data | srd-2024 rows keep Open5e v2 shape; the only rows for Hex and Chromatic Orb | Normalize on import |
| data-table-mismatches | spell-data | Haste, Hex, Chromatic Orb differ from the book (same two causes) | as above |
| mech-wall-of-fire-no-dice | spell-mechanics | no dice derived | author a row |
| mech-utility-spells-deal-damage | spell-mechanics | Dimension Door, Teleport, Wish resolve as automatic damage from their mishap clause | require the damage to be the spell's effect, or author rows |
| effects-haste-no-lethargy | spell-effects | Haste ends with no lost turn; the rule is a note string | apply a one round `lethargic` condition when hasted is removed |
| learning-levelup-cantrips-replaced | spell-learning | all cantrips replaced at a level-up | refuse removals from the cantrip list |
| learning-copying-costs-nothing | spell-learning | learn_spell writes the book, no gold, no time | charge 50 gp and 2 hours per spell level |
| learning-book-spell-above-level-prepared | spell-learning | a 1st level wizard queues Fireball to prepare (`changePreparation` checks only the book) | check `maxSpellLevelOf` for a wizard too |
| learning-console-learn-spell-unusable | spell-learning | the console form sends `name` and no `action`; the handler needs `spell` and `action`, so the form always fails | fix the catalog entry |
| cast-cantrip-substring-match | casting | "Bolt" passes the list check (substring both ways) | compare whole names |
| cast-ritual-unnamed | casting | `ritual: true` with no spell returns ok | require a name |
| cast-ritual-takes-no-time | casting | a ritual is cast mid fight and the clock does not move | advance the clock, refuse in an encounter |
| cast-cantrip-spends-slot-nopack | casting | only without the pack | use `isCantripName` |
| limit-long-casting-time-in-combat | casting-limits | Identify cast mid fight | read casting_time |
| limit-spell-attack-long-range | casting-limits | Fire Bolt hits at 235 feet at disadvantage (a spell is treated as a ranged weapon with a long range) | no long range for spells |
| components-consumed-material-stays | casting-components | the diamond stays after Revivify | see limit-costly-material-unpaid |
| conc-rage-keeps-concentrating | concentration | Rage leaves concentratingOn | break it in the Rage effect |
| conc-outlives-the-duration | concentration | after Bless expires the cleric is still concentrating on it | clear concentratingOn when the last condition of the spell expires |
| conc-save-ignores-bless | concentration | no d4 on the concentration save | apply conditionRollRiders in the hook |
| conc-beast-form-takes-no-save | concentration | damage absorbed by a beast form rolls no save | call the hook before the early return |
| conc-enemy-untracked-without-pack | concentration | only without the pack | carry the flag in the overrides |

### Suggested order of repair

1. One `canCast(sheet, spell, encounter)` guard shared by use_spell_slot, cast_at_enemy, cast_buff,
   aoe_damage, pc_attack (spell) and heal (spell). It closes about twenty of the gaps above.
2. `cast-levelled-spell-without-a-slot` and `cast-attack-spell-spends-no-slot`: two one place
   fixes that stop free casting.
3. A `spellcastingProblems` beside `spellListProblems` that checks slots, ability, class list,
   cantrip names and the book, run by every sheet route. It closes the slots and learning highs.
4. The usage route refill.

## What is enforced (the 123 tests, in short)

Slot tables for every class and level; slots handed out on joining at a level; spending one at a
time with 0 <= used <= max through 120 random casts and rests; long and short rest recovery;
Arcane Recovery limits; Font of Magic claw back. Cantrips known, spells known, prepared counts
and the top spell level at every level 1 to 20, on stored sheets and through the level-up route,
with refusals that leave the sheet unchanged. Structure of every bundled spell; 81 of 84 table
spells match the book field by field. Cantrip tiers at 5, 11, 17; upcast dice for every slot.
Save DC and spell attack from the sheet for 8 classes x 10 levels x 6 scores, and the caller's
DC, save, dice and type ignored for known spells. Unknown, unprepared, pending and book only
spells refused by every cast tool; slot below level, missing slot and last slot; cantrips free;
warlock pact slot level. Healing bounds, dying and dead. Wild Shape and Polymorph block slots.
Shield as a reaction, once a round, slot required. Line of sight and reach for spell attacks.
Concentration DC at damage 1, 19, 20, 21, 22, 23, 40 with the die one below and on the DC; real
CON save with proficiency; resistance and temporary hit points; every target freed on a failed
save; 0 hit points; ending by choice; persistence past the fight; enemy concentration. Bless,
Bane on a character, Haste, Mage Armor, Shield: dice, AC, advantage, expiry by rounds and clock.

## Not modelled (no gap recorded)

- Somatic components and free hands: no hand state exists on a sheet.
- Spell areas (cone, line, sphere): the caller names the enemies caught.
- Half and three quarters cover adding to Dexterity saves against spells.
- Counterspell and Dispel Magic ability checks; identifying a spell being cast.
- Scrolls and casting from items (the magic items suites own those).
- Metamagic shaping (declared in "Deliberate omissions").
- Racial innate spells arriving at 3rd and 5th level (creation-innate-spells in the creation report).

## Could not test, and why

- The AI DM's own turn loop (turn.ts) and its narration guard: needs a model. The handlers were
  reached through invokeEngine, which is the same dispatch.
- The Hand (src/lib/battlemap/hand-spells.ts) greys out cards for several rules above; it is
  client side guidance and not an enforcement point, so it was not tested.
- Multiclass level-up spell picks: covered by the multiclass suite (multiclass-spell-above-class-level,
  multiclass-spell-off-class-list), not repeated.
- Preparing through the spells route: covered by test-enforce-player-patch.mjs, not repeated.

## Notes on the shared helpers

No bug found in either. One thing to know: a table seats six, so a suite that needs hundreds of
sheets must rewrite one hero in place (`world.patch`) or open a world per hero;
test-enforce-spell-counts.mjs does the former.
