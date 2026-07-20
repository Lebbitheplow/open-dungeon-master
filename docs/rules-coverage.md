# 5e Rules Coverage

What the server actually enforces, what it hands the DM as guidance, and what
is deliberately out of scope. This is the working checklist: when a rule feels
missing, look here first, and when you add a mechanic, update the row.

The guard test `scripts/test-feature-coverage.mjs` fails if a class feature or
racial trait reaches a sheet with no effect, resource, or acknowledgement, so
this table cannot silently fall behind the content.

Legend: **enforced** = the server computes/applies it; **guidance** = the model
is told the rule and narrates it, no server mechanic; **out of scope** = a
deliberate omission with a reason.

## Character build

| Subsystem | State | Where |
|---|---|---|
| Ability scores, modifiers, proficiency bonus | enforced | `srd/index.ts` |
| Armor Class from worn armor + shield + DEX cap + magic + features | enforced | `srd/armor.ts`, `srd/index.ts acBreakdownFor` |
| Unarmored Defense (barbarian CON, monk WIS), Draconic Resilience | enforced | `srd/armor.ts unarmoredFormulaFor` |
| Magic weapon/armor `+N` (read from item name) | enforced | `srd/armor.ts magicItemBonus`, `dm/attack-logic.ts` |
| Attunement (3-slot cap, gates item effects) | enforced | `db/sheets.ts capAttunement`, `srd/magic-items.ts` |
| Magic item effects (AC, saves, ability-setting, resistances) | enforced | `srd/magic-items.ts` (`classes/magic-items.json`, generated) |
| Hit points, hit dice | enforced | creation + `dm/rest-logic.ts` |
| Saves, skills, expertise, passive Perception | enforced | `srd/index.ts computeSheetDerived` |
| Aura of Protection (+CHA to saves) | enforced | feature-effects `save_bonus` → derived saves |
| Alert (+5 initiative), Observant (+5 passive) | enforced | feature-effects → derived stats |
| Encumbrance | out of scope | item weights not modelled; parallels the ammunition call |

## Combat

| Subsystem | State | Where |
|---|---|---|
| Player attacks (to-hit, damage, crit) resolved server-side | enforced | `dm/pc-attack.ts` |
| Fighting styles (all six) | enforced | feature-effects → `dm/attack-logic.ts` |
| Extra Attack (tracked and reminded) | enforced | `dm/action-budget.ts`, `dm/pc-attack.ts` |
| Sneak Attack (advantage/ally trigger, once per turn) | enforced | `dm/pc-attack.ts`, `dm/map-tools.ts` |
| Divine Smite (spends slot, scales, undead/fiend bonus) | enforced | `dm/pc-attack.ts` |
| Martial Arts, two-weapon, versatile two-handed | enforced | `dm/attack-logic.ts` |
| Improved/Superior Critical, Brutal Critical, Savage Attacks | enforced | `dm/attack-logic.ts`, `dm/encounter-logic.ts` |
| Great Weapon Fighting reroll | enforced | `dice.ts rerollBelow` |
| Rage (resistance, bonus damage, advantage) | enforced | `srd/class-resources.ts`, `dm/condition-logic.ts` |
| Action economy (action / bonus / reaction / attacks) | enforced | `dm/action-budget.ts` |
| Dodge, Dash, Disengage, Hide, Help, Grapple, Shove | enforced | `dm/action-tools.ts take_action` |
| Reactions (Shield, Uncanny Dodge, Counterspell, ...) | enforced (economy) + guidance (effect) | `dm/action-tools.ts use_reaction` |
| Opportunity attacks, both sides | enforced | `dm/opportunity.ts` |
| Cover (half / three-quarters) and long-range disadvantage | enforced | `battlemap/los.ts coverBetween`, `dm/map-tools.ts` |
| Surprise round | enforced | `dm/encounter-tools.ts` |
| Conditions (durations, save-ends, advantage, auto-crit) | enforced | `dm/condition-logic.ts` |
| Exhaustion (1–6 table) | enforced | `dm/condition-logic.ts` |
| Death saves (incl. massive damage, crit-at-zero) | enforced | `dm/death-logic.ts` |
| Concentration (damage CON save) | enforced | `dm/concentration.ts` |
| Evasion | enforced | feature-effects → `dm/encounter-tools-extra.ts aoe_damage` |
| Enemy save-or-suffer on a PC | enforced | `dm/cast-tools.ts cast_at_player` |
| Reliable Talent | guidance | no floored-d20 expression form; recognized in the table |
| Ammunition tracking | out of scope | assumed supplied (`prompt.ts`) |

## Spellcasting

| Subsystem | State | Where |
|---|---|---|
| Spell slots (spend, level/cantrip/ritual validation) | enforced | `dm/mutations.ts use_spell_slot` |
| Warlock pact slots refill on short rest | enforced | `dm/rest-logic.ts` (was a live bug) |
| Cantrip level scaling, upcast scaling (from content pack) | enforced | `srd/spell-scaling.ts` |
| Save DC, spell attack bonus | enforced | `srd/index.ts` |
| Healing spells rolled server-side | enforced | `dm/mutations.ts heal` |
| Spells known / prepared limits | enforced | `dm/mutations.ts learn_spell`, level-up, PATCH route |
| Arcane/Natural Recovery, Song of Rest | enforced | `dm/rest-tools.ts` |
| Concentration on enemy spells | out of scope | enemies have no tracked spell state |

## Class resources

| Subsystem | State | Where |
|---|---|---|
| SRD limited-use features (Ki, Second Wind, Channel Divinity, ...) | enforced | `srd/class-resources.ts` (29 counters) |
| Custom genre-class limited-use features | enforced | `classes/resources.json` (235 counters, generated) |
| Wild Shape (beast HP pool) | enforced | `dm/resource-tools.ts` |
| Relentless Endurance (auto-burn at 0 HP) | enforced | `dm/mutations.ts` |

## Exploration

The DM's second pillar. `planned: Phase N` in the Where column marks a row the
DM-rules roadmap (`.claude/plans`) flips to enforced; it is guidance until then.

| Subsystem | State | Where |
|---|---|---|
| Passive Perception (computed on every sheet) | enforced | `srd/index.ts computeSheetDerived` |
| Light & vision (bright/dim/dark, darkvision, line of sight, fog) | enforced | `battlemap/los.ts` |
| Hiding vs the enemies' real passive Perception | enforced | `dm/action-tools.ts take_action hide` |
| Passive-check gating of hidden things (traps, secret doors, ambush, lies) | enforced | `dm/check-tools.ts check_notice` |
| Ability-check DCs from a consistent difficulty ladder | enforced | `srd/dc.ts`, `request_roll` `difficulty` |
| Group checks (half the party must succeed) | enforced | `dm/check-tools.ts group_check` |
| Traps (spot, spring, tiered damage) | enforced | `check_notice` spots, `dm/hazard-tools.ts apply_hazard` springs; disarm via `request_roll` |
| Travel pace effects (fast/normal/slow) | enforced | `srd/travel.ts`, `dm/world-tools.ts travel` |
| Forced-march exhaustion (CON save) | enforced | `dm/world-tools.ts travel` via the exhaustion track |
| Chases | out of scope | niche subsystem; not modelled |
| Encumbrance | out of scope | item weights not on the schema (see below) |

## Social interaction

The DM's third pillar, wholly unenforced today: NPC disposition lives only in the
model's narration and does not persist.

| Subsystem | State | Where |
|---|---|---|
| NPC attitude (hostile / indifferent / friendly), persisted | enforced | `db/npcs.ts`, surfaced in GAME STATE |
| Charisma checks that shift attitude one step | enforced | `dm/social-tools.ts social_check` (one shift per exchange) |
| Attitude-derived social-check DCs | enforced | `dm/social.ts socialCheckDc` |
| Reaction roll to seed a first meeting (2d6 + mods) | enforced | `dm/social-tools.ts npc_reaction` |
| Insight vs Deception | guidance | model adjudicates from the roll |

## Environment & hazards

| Subsystem | State | Where |
|---|---|---|
| A monster/trap forcing a save on one PC | enforced | `dm/cast-tools.ts cast_at_player` |
| A hazard catching several PCs at once | enforced | `dm/encounter-tools-extra.ts aoe_damage` |
| Falling damage (1d6 per 10 ft, cap 20d6) | enforced | `srd/hazards.ts`, `dm/hazard-tools.ts apply_hazard` |
| Trap / generic hazard save + tiered damage | enforced | `dm/hazard-tools.ts apply_hazard` via `cast_at_player` |
| Suffocation / drowning | guidance | formulas in `srd/hazards.ts`; not yet stateful-tracked |
| Extreme cold / heat, frigid water | guidance | save/DC in `srd/hazards.ts`; not yet tool-applied |
| Object durability (object AC + HP by size) | enforced | `srd/objects.ts`, `dm/world-tools.ts damage_object` |
| Treasure by CR (individual + hoard tables) | enforced | `srd/treasure.ts`, `dm/world-tools.ts roll_treasure` |

## The long tail

Of 182 SRD class-feature names, 51 have real server mechanics (22 typed
effects + 29 resource counters); the rest are guidance-only by design:

- **Subclass markers** ("Arcane Tradition", "Divine Domain") — the pick has
  mechanics, the marker does not.
- **Spell-list grants** ("Magical Secrets", "Circle Spells") — the spells land
  on the sheet; the feature itself does nothing extra.
- **Passive / roleplay features** ("Druidic", "Timeless Body", "Thieves' Cant")
  — narrated from the sheet.

The full acknowledged list lives in `scripts/test-feature-coverage.mjs`, which
also proves it does not rot (every acknowledged name is a real granted name).

## Deliberate omissions

| Rule | Why |
|---|---|
| Ammunition | Assumed supplied; tracking it is tedious with no upside at this table. |
| Encumbrance | Item weights are not on the schema; adding a weight to every item is a poor trade. |
| Non-parseable magic items | Items whose effect is prose the generator cannot parse (roughly 1500 of 1618) stay narrative, exactly like the feature long tail. |
| Reliable Talent enforcement | A d20 floored at 10 has no dice-expression form; recognized and guidance-only until the dice engine grows the primitive. |
| Enemy concentration | Enemies carry no tracked spells. |
| PC opportunity attack ending an encounter | It applies damage directly (no DM turn to award XP); a killing blow is reported and the model ends the fight next turn. |
