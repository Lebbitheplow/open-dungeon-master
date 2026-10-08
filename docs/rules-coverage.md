# 5e Rules Coverage

What the server actually enforces, what it hands the DM as guidance, and what
is deliberately out of scope. This is the working checklist: when a rule feels
missing, look here first, and when you add a mechanic, update the row.

The guard test `scripts/test-feature-coverage.mjs` fails if a class feature or
racial trait reaches a sheet with no effect, resource, or acknowledgement, so
this table cannot silently fall behind the content.

Legend: **enforced** = the server computes/applies it; **guidance** = the model
is told the rule and narrates it, no server mechanic; **out of scope** = a
deliberate omission with a reason; **narrated by design** = SRD 5.1 leaves it to
the DM, or it is outside SRD 5.1, and the reason is written in the row.

The **Suite** column names the file under `scripts/` (without `.mjs`) that
states the rule and fails when it stops holding. A row marked "none yet" is a
claim no suite states; it is listed here so it is not mistaken for a tested
one. The state after the second audit and repair (2026-09-30) and how it was
measured are in [`rules-enforcement-audit.md`](rules-enforcement-audit.md).

One row is neither of the first two: the engine boundary. `dm/engine-boundary.ts`
states in a single prompt block which facts the runtime owns (dice, hit and
miss, damage, HP and death, slots and resources, conditions, XP, gold), and then
checks that the finished narration agrees with the outcomes the turn's tools
actually resolved, sending a contradiction back to the model for one rewrite.
The rewrite has one reserved model call of its own, outside the four-call turn
budget. Enforcement makes the numbers right; this makes the prose about them
right. It changes no mechanical state, is deliberately biased toward missing a
real contradiction over firing on flavor text, and a table can switch it off
with the `narrationGuard` game setting. Suites: `test-enforce-narration-guard`,
`test-enforce-narrator`, `test-engine-boundary`.

## Character build

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Ability scores, modifiers, proficiency bonus | enforced | `srd/index.ts` | `test-enforce-abilities` |
| Armor Class from worn armor + shield + DEX cap + magic + features | enforced | `srd/armor.ts`, `srd/index.ts acBreakdownFor` | `test-enforce-armor`, `test-armor` |
| Unarmored Defense (barbarian CON, monk WIS), Draconic Resilience | enforced | `srd/armor.ts unarmoredFormulaFor` | `test-enforce-armor`, `test-armor` |
| Magic weapons and armor: the base item from the pack row's category or the name ("weapon (any sword)" is a longsword unless the name says otherwise), `+N`, Mithral with no Strength requirement or stealth penalty, Elven Chain worn as if trained | enforced | `srd/magic-gear.ts`, `srd/armor.ts armorOfRow`, `dm/gear-attack.ts`, `classes/magic-items.json` (generated, `base` / `weapon` / `armor`) | `test-enforce-magic-gear` |
| Magic weapon riders: typed extra dice, dice against creature types, natural-20 dice (on both dice paths), Adamantine Armor turning a critical hit, cursed items the wearer cannot unattune | enforced | `scripts/lib/magic-item-riders.mjs` (the authored table), `dm/gear-attack.ts`, `srd/armor.ts wornArmorTurnsCrits`, `dm/usage-rules.ts` | `test-enforce-magic-gear`, `test-enforce-tail-attacks` |
| Item charges: parsed for every pack row, spent by `use_item`, regained at each dawn the clock crosses, the last-charge d20; the SRD armor's and weapons' once-a-dawn powers are one charge | enforced | `dm/item-charges.ts`, `dm/item-use.ts`, `db/clock.ts advanceClock` | `test-enforce-magic-gear` |
| Attunement (3-slot cap on every write path, effects only while worn and attuned, one copy per item, class/race/alignment restrictions, none mid-fight); attuning takes a short rest (the item waits as `attuning`); ending it on purpose out of a fight takes one | enforced | `srd/magic-items.ts settleAttunement`, `dm/usage-rules.ts attunementRefusal`, `dm/rest-logic.ts settleAttuning`, `dm/don-doff.ts` | `test-enforce-attunement`, `test-enforce-explore-rules` |
| Magic item effects (AC, saves, ability-setting, resistances, CON items raising the hit point maximum) | enforced | `srd/magic-items.ts` (`classes/magic-items.json`, generated), `dm/condition-logic.ts effectiveMaxHp` | `test-enforce-magic-items`, `test-enforce-feature-saves`, `test-enforce-explore-defects` |
| Magic item check riders (Stone of Good Luck, Cloak and Boots of Elvenkind, Eyes of the Eagle, Robe of Eyes, Eyes of Minute Seeing, Gloves of Thievery) | enforced | `srd/item-check-riders.ts`, `dm/rolls.ts`, `dm/check-tools.ts` | `test-enforce-feature-saves` |
| Hit points, hit dice (Draconic Resilience's +1 per sorcerer level and Primal Champion included) | enforced | creation + `srd/hit-points.ts`, `srd/level-up.ts`, `dm/rest-logic.ts` | `test-enforce-class-tables`, `test-enforce-feature-uses` |
| Saves, skills, expertise, passive Perception, passive Investigation | enforced | `srd/index.ts computeSheetDerived` | `test-enforce-abilities`, `test-enforce-checks` |
| Builder picks re-checked when an earlier step changes (class skills against the background's and race's grants, expertise against proficiency and slots, subclass against its level, option picks against their slots, spells against the slot table, racial choices against the race) | enforced | `builder/reconcile.ts reconcilePicks`, run on every change and once more as the sheet is built | `test-builder-reconcile` |
| Racial languages from the content pack (the grant sentence only, "your choice of X or Y" as a pick from that list, subraces inherit the parent's) | enforced | `content/mechanics.ts parseRaceLanguages`, `content/race-options.ts packRaceOptions` | `test-race-languages` |
| Jack of All Trades / Remarkable Athlete (half proficiency on checks + initiative) | enforced | feature-effects `half_proficiency` -> `computeSheetDerived`, `dm/rolls.ts` | `test-enforce-checks`, `test-enforce-initiative` |
| Tool proficiency: a check that names a tool adds the proficiency bonus (twice with expertise in it) in place of Jack of All Trades' half | enforced | `dm/rolls.ts` `tool`, `dm/roll-riders.ts toolProficiencyBonus` | `test-enforce-feature-saves` |
| Inspiration: the DM awards it, the holder spends it for advantage on a check, save or attack roll | enforced | `resources.inspiration`, `dm/set-condition.ts awardInspiration`, `dm/rolls.ts`, `pc_attack useInspiration` | `test-enforce-feature-saves`, `test-enforce-tail-attacks`, `test-enforce-final-ui` |
| Armor stealth disadvantage (scale, plate...) | enforced | `srd/armor.ts` flag -> `dm/rolls.ts`, `take_action hide` | `test-enforce-armor` |
| Heavy armor below its STR requirement (speed -10) | enforced | `srd/index.ts speedFor` | `test-enforce-armor` |
| Armor worn without training (disadvantage on STR/DEX checks, saves and attacks; no spellcasting) | enforced | `srd/armor.ts wearsUntrainedArmor`, `dm/rolls.ts`, `dm/pc-attack.ts`, `dm/cast-guard.ts` | `test-enforce-armor`, `test-enforce-casting-limits` |
| Donning and doffing armor out of a fight moves the clock by the SRD times (light 1/1, medium 5/1, heavy 10/5 minutes, shield 1/1); in a fight it is refused | enforced | `dm/don-doff.ts`, the sheet usage route | `test-enforce-explore-rules` |
| Subraces (Mountain Dwarf, Wood Elf, Drow, Stout Halfling, Forest/Deep Gnome, Variant Human) | enforced | `srd/races.json` flattened entries, race armor/weapon training | `test-enforce-races` |
| Creature size (Small races vs heavy weapons, grapple/shove size cap) | enforced | `srd/index.ts sizeForRace`, `dm/pc-attack.ts`, `dm/action-tools.ts` | `test-enforce-races`, `test-enforce-weapons` |
| Racial and class save advantages (Brave, Gnome Cunning, Fey Ancestry, Dwarven and Stout Resilience, Danger Sense with its gate, Feral Instinct on initiative, Countercharm, Holy Nimbus against fiend and undead spells) on every save path, forced saves included | enforced | `srd/trait-rules.ts traitSaveAdvantages`, `dm/rolls.ts`, `dm/forced-save.ts` | `test-enforce-feature-saves`, `test-enforce-final-engine` |
| Condition and damage immunities from features (Aura of Courage and Aura of Devotion for allies in range, Mindless Rage while raging, Purity of Body, Divine Health, Nature's Ward, Purity of Spirit); `set_condition` refuses them | enforced | `srd/trait-rules.ts`, `dm/aura.ts allyConditionAura`, `dm/set-condition.ts conditionImmunity` | `test-enforce-feature-uses` |
| Save proficiencies from features (Diamond Soul, Slippery Mind) | enforced | `srd/trait-rules.ts featureSaveProficiencies` -> `computeSheetDerived` | `test-enforce-feature-uses` |
| Aura of Protection (+CHA to saves) | enforced | feature-effects `save_bonus` -> derived saves | `test-enforce-feature-saves`, `test-enforce-feature-uses` |
| Alert (+5 initiative), Observant (+5 passive Perception and Investigation) | enforced | feature-effects -> derived stats | `test-enforce-feats`, `test-enforce-initiative`, `test-enforce-feature-saves` |
| Feat grants read from the feat's text: languages, skills, expertise, weapons, tools, armor (Linguist, Skill Expert, Weapon Master, Heavily Armored, Tavern Brawler, Chef, Gunner's firearms), picked beside the feat and held to by the server | enforced | `srd/feat-grants.ts` (`featChoices`), `srd/sheet-legality.ts`, `srd/level-up.ts` | `test-feat-grants`, `test-enforce-feats` |
| Feat spells read from the feat's text: Fey Touched's and Shadow Touched's spells, Spell Sniper's attack cantrip, Magic Initiate's cantrips and spell from one list (ODM's own 2014 wording; the pack's 2024 row stays hidden), Ritual Caster's book; each free cast is a once-per-long-rest counter the cast tools spend instead of a slot; a character with no Spellcasting gets a slotless block for them | enforced | `srd/feat-spells.ts`, `srd/legality/spells.ts`, `srd/class-resources.ts` (`free_cast_*`), `dm/cast-guard.ts`, `dm/cast-rules.ts` (ritual book) | `test-feat-spells`, `test-enforce-feats` |
| Great Weapon Master and Sharpshooter's -5/+10 (`pc_attack` `powerAttack`), Great Weapon Master's bonus-action attack after a melee crit or kill (`bonusAttack` "feature") | enforced | `srd/feat-combat.ts`, `dm/pc-attack-plan.ts`, `dm/pc-attack-options.ts`, `dm/pc-attack-resolve.ts` | `test-feat-combat`, `test-enforce-feat-combat` |
| Sharpshooter (no long-range disadvantage, half and three-quarters cover ignored), Spell Sniper (attack spells' range doubled, cover ignored, the cantrip above), Crossbow Expert and Gunner (no disadvantage with a foe within 5 ft, loading ignored) | enforced | `srd/feat-combat.ts`, `dm/pc-attack-plan.ts`, `dm/pc-attack-situation.ts`, `dm/cast-reach.ts`, `dm/attack-rules.ts` | `test-feat-combat`, `test-enforce-feat-combat` |
| Elemental Adept (the chosen type ignores resistance, every 1 on its damage dice is a 2; the type is kept as the feature "Elemental Adept: fire") | enforced | `srd/feat-combat.ts`, `dm/cast-at-enemy-damage.ts`, `dm/aoe-damage.ts`, `dm/pc-attack-plan.ts`, `dm/enemy-damage.ts` | `test-feat-combat`, `test-enforce-feat-combat`, `test-enforce-feats` |
| Defensive Duelist (reaction: proficiency bonus to AC against the melee hit it answers, with a finesse weapon in hand) and Mage Slayer (reaction: a melee weapon attack on a caster within 5 ft; advantage on saves against a spell cast by a creature within 5 ft; a melee hit from within 5 ft puts the caster's concentration save at disadvantage) | enforced | `dm/feat-reactions.ts`, `dm/reaction-tools.ts`, `dm/cast-at-player.ts` | `test-enforce-feat-combat` |
| Dungeon Delver (advantage on a trap's save, resistance to trap damage through `apply_hazard`, +5 passive Perception and Investigation to notice a trap or a secret door through `check_notice`) | enforced | `dm/cast-at-player.ts` (`hazard`), `dm/hazard-tools.ts`, `dm/check-tools.ts` | `test-enforce-feat-combat` |
| Party spoils (XP each, a purse split evenly, an item to the finder) | enforced | `dm/mutations.ts party_award`, composing the single-target mutations so the audit trail is unchanged | `test-enforce-xp`, `test-enforce-currency` |
| Carrying capacity, standard rule (Strength x 15, doubled per size above Medium): a grant or purchase past it is refused, a character already past it moves at 5 feet | enforced | `dm/load-rules.ts capacityProblem`, `srd/index.ts speedFor` | `test-enforce-explore-rules`, `test-enforce-inventory` |
| Lift, push, drag (Strength x 30; past carrying capacity the mover's speed is 5 feet) | enforced | `lift` tool, `dm/explore-tools.ts`, `dm/load-rules.ts liftLimits` | `test-enforce-explore-rules` |
| Encumbrance (the two variant thresholds) | enforced when the `encumbrance` variant rule is on | `srd/encumbrance.ts`; item weights from the content pack, armor from `srd/armor.ts` | `test-encumbrance`, `test-enforce-variant-rules` |

## Where a sheet's rules are checked

Every door a character comes through (the builder's create and edit, the
campaign sheet routes, the library, import, companions, and level-up) runs one
server-side check, `srd/sheet-legality.ts` with `characters/admit.ts`. Hit
dice, spell slots, casting ability, saving throws, class training, speed, armor
class and hit points (by the table's `hpMethod`) are derived by the server, not
accepted; starting gold follows the table's `startingWealth`. A level-up is built
from the player's choices one level at a time and only with the XP for it
(`srd/level-up.ts`). A player spends their counters and never refills them; the
DM seats and the party lead correct (`dm/usage-rules.ts`). The AI's
`update_sheet` writes story fields only: level, XP, hit points, AC, gold and
conditions move through the tools that own them, and the human DM's console
keeps its correction power (`dm/update-sheet-ai.ts`, `test-enforce-narrator`).
The suites that hold all of this are `scripts/test-enforce-*.mjs`; see
`rules-enforcement-audit.md`.

## Combat

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Player attacks (to-hit, damage, crit) resolved server-side | enforced | `dm/pc-attack.ts` | `test-enforce-attacks` |
| Fighting styles (all six) | enforced | feature-effects -> `dm/attack-logic.ts` | `test-enforce-attacks`, `test-attack-rules` |
| Extra Attack (tracked and reminded) | enforced | `dm/action-budget.ts`, `dm/pc-attack.ts` | `test-enforce-action-economy` |
| Sneak Attack (advantage/ally trigger, once per turn; the ally beside the target must be able to act) | enforced | `dm/pc-attack.ts`, `dm/map-tools.ts allyAdjacentToEnemy` | `test-enforce-attack-riders`, `test-enforce-pc-attack-features` |
| Divine Smite (spends slot, scales, undead/fiend bonus) | enforced | `dm/pc-attack.ts` | `test-enforce-attack-riders` |
| Martial Arts: a monk weapon or unarmed strike uses DEX and the Martial Arts die only while the monk wears no armor and carries no shield; one bonus-action unarmed strike after taking the Attack action with one | enforced | `dm/attack-logic.ts weaponAttackProfile`, `dm/pc-attack-options.ts martialArtsApplies`, `pc_attack bonusAttack` | `test-enforce-pc-attack-features` |
| Two-weapon fighting, versatile two-handed | enforced | `dm/attack-logic.ts` | `test-enforce-attack-riders`, `test-enforce-action-economy` |
| Improved/Superior Critical (weapon attacks only), Brutal Critical, Savage Attacks | enforced | `dm/attack-logic.ts`, `dm/encounter-logic.ts`, `dm/pc-attack-resolve.ts` | `test-enforce-attack-riders`, `test-enforce-pc-attack-features` |
| Great Weapon Fighting reroll | enforced | `dice.ts rerollBelow` | `test-dice`, `test-enforce-attacks` |
| Rage (resistance, bonus damage, advantage; suppressed in heavy armor), Relentless Rage's climbing DC, Frenzy's bonus attack and its exhaustion | enforced | `srd/class-resources.ts`, `dm/condition-logic.ts`, `dm/pc-damage.ts relentlessRage`, `dm/frenzy.ts` | `test-enforce-feature-uses`, `test-enforce-pc-attack-features` |
| Reckless Attack (advantage for the barbarian, attacks against them at advantage until their next turn), Stunning Strike (1 ki on a hit, CON save, stunned to the end of the monk's next turn) | enforced | `pc_attack reckless`, `stunningStrike`; `dm/pc-attack-options.ts`, `dm/pc-attack-riders.ts` | `test-enforce-pc-attack-features`, `test-enforce-turn-end` |
| Knocking a creature out: a melee attack declared `nonlethal` leaves it alive at 0, unconscious and prone, counted as defeated; later damage kills it | enforced | `dm/knockout.ts`, `dm/enemy-damage.ts applyEnemyDamage` | `test-enforce-pc-attack-features` |
| Action economy (action / bonus / reaction / attacks) | enforced | `dm/action-budget.ts` | `test-enforce-action-economy`, `test-action-budget` |
| Bonus-action features: Cunning Action and Fast Hands, Step of the Wind, Patient Defense, Flurry of Blows (after the Attack action, unarmed strikes only), Expeditious Retreat's Dash; a Dash or Disengage is a bonus action only through a feature | enforced | `dm/bonus-actions.ts`, `dm/bonus-routes.ts`, `take_action bonus` | `test-enforce-bonus-actions`, `test-enforce-tail-features` |
| Dodge, Dash, Disengage, Hide, Help, Grapple, Shove, Ready (an attack or a spell, with a trigger), Search, Use an Object, Escape; a grapple or shove replaces one attack of the Attack action | enforced | `dm/action-tools.ts take_action`, `dm/object-actions.ts`, `dm/readied-spell.ts` | `test-enforce-actions`, `test-enforce-turn-actions`, `test-enforce-bonus-actions`, `test-enforce-tail-features` |
| Help: against the creature the helper named and within 5 feet of it, or for an ability check | enforced | `dm/help-logic.ts heldHelp` | `test-enforce-turn-actions` |
| Off-turn attacks: a character attacks off their turn only as an opportunity attack (rolled by the server) or a readied action (spending the reaction); Giant Killer answers the recorded attack | enforced | `dm/pc-attack-plan.ts`, `dm/reaction-attacks.ts` | `test-enforce-turn-actions`, `test-enforce-turn-order`, `test-enforce-tail-attacks` |
| Reactions that re-resolve the last attack against a character: Shield (+5 against the triggering attack), Uncanny Dodge (halves it), Deflect Missiles (and the throw back), Cutting Words, Protection (the attack re-rolled at disadvantage), Slow Fall, Retaliation, Stand Against the Tide; a replay undoes a drop to 0 and a broken concentration; only the feature's holder may use it | enforced | `dm/last-hit.ts` (table `last_hits`), `dm/reaction-refund.ts settleLastHit`, `dm/reaction-tools.ts`, `dm/srd-reactions.ts` | `test-enforce-reactions`, `test-enforce-final-features` |
| Reaction spells through `use_reaction`: Hellish Rebuke (the attacker from the record), Feather Fall (a fall's damage), Counterspell (before the enemy's spell; its level from the stat block) | enforced | `dm/reaction-spells.ts` | `test-enforce-reactions` |
| A reaction returns at the start of its owner's turn, and Dodge, Help, Shield, Protection and a readied action end there | enforced | `dm/condition-tick.ts startTurnConditions` | `test-enforce-action-economy`, `test-enforce-turn-actions` |
| Effects that last "until the end of" a creature's next turn end as that turn ends (`untilTurnEndOf`): Stunning Strike, Guiding Bolt, Menacing and Goading Attack, Intimidating Presence, Open Hand's no reactions, Hurl Through Hell, Chill Touch's undead dread | enforced | `dm/turn-end.ts`, `dm/encounter-tools.ts advancePointer` | `test-enforce-turn-end`, `test-enforce-maneuvers` |
| Opportunity attacks, both sides: an approaching or leaving enemy provokes along the path; the enemy's attack is its first melee attack at its own reach and lands through the same typed hit path as `enemy_attack` (resistances per type, on-hit riders, Magic Weapons, concentration, a beast form's hit points first); a character's carries its riders (magic weapon, Sneak Attack, marks); no opportunity attack at a creature the reactor cannot see; Escape the Horde puts them at disadvantage | enforced | `dm/opportunity.ts`, `dm/opportunity-strike.ts` | `test-enforce-movement`, `test-enforce-pc-attack-board`, `test-enforce-last-combat`, `test-enforce-tail-attacks` |
| Cover (half / three-quarters, and another creature on the line as half cover) and long-range disadvantage | enforced | `battlemap/los.ts coverBetween`, `dm/attack-spatial.ts creatureCover`, `dm/map-tools.ts` | `test-enforce-range`, `test-enforce-pc-attack-board`, `test-battlemap-los` |
| Light on attacks, mapped fights: from the board's own light (sky, lamps, carried lights, spell areas), darkvision, blindsight, tremorsense, truesight, Devil's Sight and magical darkness, an attacker that cannot see its target has disadvantage and one its target cannot see has advantage; dim light hides nobody. Off the map, conditions only | enforced | `dm/attack-light.ts`, `dm/pc-attack-situation.ts`, `dm/enemy-attack.ts` | `test-enforce-pc-attack-board`, `test-enforce-zones` |
| Unseen targets: a hidden or invisible target is attacked at disadvantage by both sides; Invisibility ends when its holder attacks or casts (Greater Invisibility does not) | enforced | `dm/condition-logic.ts attackContext`, `dm/attack-marks.ts` | `test-enforce-pc-attack-board`, `test-enforce-pc-attack-spells` |
| The AI's `advantage` on an attack counts only with a named circumstance the engine does not already decide; the human DM rules freely | enforced | `dm/pc-attack-options.ts claimedAdvantage`, `dm/enemy-attack.ts` | `test-enforce-pc-attack-features`, `test-enforce-pc-attack-board` |
| Surprise: an ambush rolls the hidden side's Stealth against each opponent's passive Perception (Keen senses included); the DM's explicit `surprised` stays as an override; an all-surprised party still locks the order | enforced | `dm/encounter-tools.ts`, `dm/encounter-open.ts` | `test-enforce-enemy-turns`, `test-enforce-last-combat`, `test-enforce-initiative` |
| Thief's Reflexes (a second turn in round 1 at initiative - 10) | enforced | `dm/encounter-logic.ts withReflexTurns` | `test-enforce-tail-features` |
| Conditions (durations, save-ends, advantage, auto-crit); timed conditions count down by round in combat and against the in-world clock outside it (travel, rests, pass_time), and set_condition takes rounds, minutes or hours | enforced | `dm/condition-logic.ts`, `dm/condition-tick.ts`, `db/clock.ts` | `test-enforce-conditions-attacks`, `test-enforce-conditions-actions`, `test-enforce-conditions-duration` |
| Blinded and deafened creatures fail checks that need the lost sense, rolled and passive | enforced | `srd/sense-checks.ts`, `dm/rolls.ts`, `dm/check-tools.ts` | `test-enforce-last-combat-board` |
| Exhaustion (1 to 6 table), on characters and on creatures | enforced | `dm/condition-logic.ts`, `dm/enemy-exhaustion.ts` | `test-enforce-exhaustion`, `test-enforce-monster-traits` |
| Death saves (incl. massive damage, crit-at-zero) | enforced | `dm/death-logic.ts` | `test-enforce-death`, `test-death-logic` |
| Concentration (damage CON save) | enforced | `dm/concentration.ts` | `test-enforce-concentration` |
| Evasion (and Superior Hunter's Defense's Evasion) on every save-for-half path: `aoe_damage`, `cast_at_player`, `apply_hazard` | enforced | `srd/trait-rules.ts saveDamageTaken` | `test-enforce-feature-uses`, `test-enforce-damage-types` |
| Enemy save-or-suffer on a PC | enforced | `dm/cast-at-player.ts` | `test-enforce-forced-saves` |
| Aura of Protection reaching allies (within 10/30 ft on a map, never stacking with the ally's own; off the map every conscious fielded paladin covers every ally) | enforced | `dm/aura.ts allySaveAura` -> every save path | `test-enforce-feature-uses`, `test-enforce-feature-saves` |
| Enemy concentration (tracked via casterEnemyId+spell, CON save on damage through the enemy's save roller, break ends the effect; an incapacitated enemy loses it) | enforced | `db/encounters.ts concentration`, `dm/enemy-damage.ts`, `dm/forced-save.ts rollEnemySave` | `test-enforce-last-combat`, `test-enforce-monster-actions` |
| Reliable Talent (proficient checks floor a low d20 at 10), on contests too | enforced | `dice.ts` `fN` floor suffix, `dm/rolls.ts resolveRollExpression`, `dm/contest-roll.ts` | `test-enforce-checks`, `test-enforce-turn-actions` |
| Effect conditions with real riders (Bless, Bane, Haste, Barkskin, Hex, Starry Form...) | enforced | `srd/condition-effects.ts`, consumed by the roll/AC/damage/speed/budget engines | `test-condition-effects`, `test-enforce-spell-effects` |
| Battle Master maneuvers (die spend, damage/to-hit, Trip/Menacing/Disarm/Goading rider saves) | enforced | `dm/pc-attack.ts` `maneuver` arg | `test-enforce-maneuvers` |
| Subclass damage riders (Divine Strike family with the domain's type, Improved Divine Smite, Divine Fury, Colossus Slayer, Horde Breaker, Foe Slayer) | enforced | `srd/feature-effects.ts` parsed + static riders -> `dm/pc-attack.ts` | `test-enforce-pc-attack-features`, `test-enforce-tail-attacks` |
| Magical attacks (Ki-Empowered Strikes on unarmed strikes, Primal Strike on natural attacks) | enforced | `srd/feature-effects.ts`, `dm/pc-attack-damage.ts magicalStrikeApplies` | `test-enforce-pc-attack-features` |
| Agonizing Blast (+CHA per Eldritch Blast beam) | enforced | `srd/feature-effects.ts` `cantrip_damage_ability` | `test-enforce-coverage-holes` |
| Haste's extra action / Slow's lost reactions | enforced | `dm/action-budget.ts` `extraActions`, `use_reaction` gate | `test-enforce-action-economy`, `test-condition-effects` |
| Grapples: escape with the better of Athletics and Acrobatics against the grappler's check or the printed escape DC; the grapple ends out of the grappler's reach, when it drops to 0 or is incapacitated, and the restraint it brought ends with it; grappling takes a free hand | enforced | `dm/grapple.ts`, `dm/enemy-hit.ts resolveOnHit`, `dm/combat-actions.ts` | `test-enforce-turn-actions`, `test-enforce-last-combat`, `test-enforce-monster-actions` |
| Dragging a grappled creature at half speed (a player's move with `drag`, an enemy's `move_token drag`) | enforced | `dm/drag.ts`, `dm/drag-move.ts` | `test-enforce-last-combat-board` |
| Movement through creatures: an ally's space and a hostile two sizes apart are walked through at double cost and never ended in; Halfling Nimbleness; squeezing (and its attack and save penalties); climbing `^` at double cost without a climb speed or Second-Story Work; a swimming speed crosses water at normal cost | enforced | `battlemap/movement.ts`, `battlemap/passage.ts`, `battlemap/types.ts moveCost` | `test-enforce-tail-movement`, `test-enforce-objects-terrain`, `test-enforce-movement` |
| Jumping: a long jump of the Strength score in feet after a 10-foot run (half standing), a high jump of 3 + the Strength modifier, a low wall cleared by a jump of 12 feet or more, landing in difficult terrain a DC 10 Acrobatics check or prone | enforced | `srd/jump.ts`, `dm/jump-move.ts`, the move route `jump` | `test-enforce-last-combat-board` |
| Underwater combat: melee weapon attacks without a swimming speed at disadvantage unless the weapon is one the SRD names, ranged attacks at disadvantage in normal range and missing past it, fire resistance while immersed | enforced | `dm/underwater.ts` | `test-enforce-last-combat-board` |
| Silvered and adamantine weapons pass resistance and immunity that exempt them | enforced | `dm/damage-logic.ts damageAdjust`, `weaponMaterial` | `test-enforce-last-combat-board` |
| Monster stat blocks: Multiattack routines (the listed attacks, not one repeated), typed riders and on-hit saves, reach and range per attack, two damage types landing apart, printed dice checked against the printed average, legendary actions and resistance parsed from the pack, spellcasting DC, attack bonus and list, recharge and per-day abilities with their DCs and dice from the text | enforced | `bestiary/statblock.ts`, `bestiary/attack-text.ts`, `bestiary/attack-parse.ts`, `dm/monster-abilities.ts`, `dm/enemy-profile.ts`, `dm/enemy-hit.ts` | `test-enforce-monster-blocks`, `test-enforce-monster-actions`, `test-enforce-last-combat`, `test-statblock` |
| Monster traits: Pack Tactics, Magic Resistance, Undead Fortitude, Regeneration (a troll lies at 0 until its turn unless acid or fire landed), Sunlight Sensitivity, Nimble Escape, Magic Weapons, Keen senses, Multiattack Defense, Parry | enforced | `dm/monster-abilities.ts`, `dm/regeneration.ts`, `dm/enemy-reactions.ts`, `dm/enemy-damage.ts` | `test-enforce-monster-traits`, `test-enforce-last-combat` |
| An enemy acts on its own turn: the AI's `enemy_attack`, `cast_at_player` and `aoe_damage` for a creature wait for its turn; one action a turn; recharge and legendary refills at its turn start; a prone creature stands for half its speed; a frightened one does not step closer to its fear | enforced | `dm/enemy-turn-order.ts`, `dm/enemy-casting.ts`, `dm/enemy-approach.ts` | `test-enforce-enemy-turns`, `test-enforce-monster-actions` |
| Falling on creatures (1d6 per 10 feet, 20d6 at most, prone) | enforced | `dm/enemy-fall.ts`, `damage_enemy fallFeet` | `test-enforce-monster-traits` |
| Narration cross-checked against the turn's real outcomes (a hit written on a miss or on a refused attack, a death the hit points deny, a damage figure no die rolled, a spell nothing paid for) | enforced (verification, one rewrite) | `dm/engine-boundary.ts`, `dm/narration-guard.ts`, setting `narrationGuard` | `test-enforce-narration-guard`, `test-enforce-narrator`, `test-engine-boundary` |
| Tool calls in one model reply resolve in the order the model sent them; errors the model reads say `retry` (its argument fault) or `refused` (the rules or a limit); prose sent beside an outcome-resolving tool is withheld | enforced | `dm/turn.ts`, `dm/tool-errors.ts` | `test-enforce-narrator` |
| A Hand card is stored on the message as structured intent, refused up front with the engine's reason when the engine would refuse it, and answered with one corrective call when the model resolves no tool for it | enforced | the actions route, `dm/intent-check.ts`, `dm/intent-logic.ts` | `test-enforce-narrator`, `test-enforce-ui-play` |
| Ammunition tracking (optional) | enforced when the `ammunition` variant rule is on | `srd/ammunition.ts`, spent in `dm/pc-attack.ts`, half recovered in `dm/enemy-damage.ts finishEncounter` | `test-ammunition` |
| Poison on a weapon (a vial of basic poison coats the next slashing or piercing hit: DC 10 CON or 1d4 poison) | enforced | `dm/attack-onhit.ts` | `test-enforce-tail-attacks` |
| One damage total split across targets at full/half/double/none | enforced | `dm/split-damage.ts split_damage`; each share then goes through the ordinary enemy and character damage paths, so resistances and temp HP still apply | `test-enforce-damage-types` |
| Hidden and blind rolls (a DM screen) | enforced | `rolls.visibility`, `dm/viewer.ts rollAccessFor`; the shared stream carries the redacted roll and the allowed seat re-fetches | `test-enforce-ai-rolls` |

## Spellcasting

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Spell slots (spend, level/cantrip/ritual validation) | enforced | `dm/mutations.ts use_spell_slot` | `test-enforce-spell-slots` |
| Structured spell mechanics: the real save ability, half-on-save, damage type, and condition for every SRD spell OVERRIDE the model's args; the parsed answers are baked into `srd/manifest/spell-mech.json`, so the engine answers the same for all 319 SRD spells with the content pack and without it | enforced | `srd/spell-mechanics.ts` (authored `mech` + overrides + prose parsers), `content spellMechanicsFor`, consumed by `cast_at_enemy`/`pc_attack`/`aoe_damage` | `test-enforce-spell-mechanics`, `test-enforce-spell-engine`, `test-spell-mechanics` |
| Buff spells (Bless, Mage Armor, Haste, Hunter's Mark, the smites, Shadow Blade, Aid, Magic Weapon, Protection from Energy, Death Ward, Protection from Evil and Good, Pass without Trace, Enhance Ability, Warding Bond, Beacon of Hope, Heroism, Mirror Image, Sanctuary...) as tracked conditions with enforced riders, slot spend, and duration | enforced | `dm/cast-tools.ts cast_buff` + `srd/condition-effects.ts` | `test-enforce-spell-rows`, `test-enforce-spell-effects` |
| A spell's condition records its spell, caster and slot level; a broken concentration ends only that casting's effects | enforced | `dm/spell-effects.ts`, `dm/concentration.ts clearSpellConditionsByName` | `test-enforce-spell-engine` |
| Touch spell attacks are melee spell attacks that reach only a creature beside the caster | enforced | `dm/pc-attack-profile.ts`, `dm/spell-attack-riders.ts` | `test-enforce-pc-attack-spells`, `test-enforce-casting-limits` |
| Riders on attack and save spells (Guiding Bolt, Shocking Grasp, Ray of Frost, Chill Touch, Vampiric Touch, Acid Arrow, Thunderwave and Gust of Wind pushes, Vicious Mockery, Harm, Chain Lightning...) | enforced | `dm/spell-attack-riders.ts`, `dm/spell-riders.ts` | `test-enforce-pc-attack-spells`, `test-enforce-spell-tail`, `test-enforce-spell-hooks` |
| Hunter's Mark and Hex ride hits on their quarry only; weapon-only riders never ride a spell attack; smites are spent by the hit, not the swing | enforced | `dm/attack-marks.ts`, `srd/condition-effects.ts weaponOnly` | `test-enforce-pc-attack-spells` |
| Wrong-tool casts redirected (a save spell through pc_attack, a buff through cast_at_enemy) | enforced | `dm/cast-tools.ts castRedirect` | `test-spell-mechanics` |
| Area spells by name (slot spend, scaled dice, save, DC from the caster's sheet, conditions on each failed save, range plus area checked per creature, target caps such as Slow's six, one pool per casting for Sleep and Color Spray, refused without a caster) | enforced | `dm/encounter-tools-extra.ts aoe_damage` `spell`, `dm/aoe-spell.ts`, `dm/spell-pool.ts` | `test-enforce-spell-engine`, `test-enforce-spell-rows` |
| Spell areas on the battle map: a zone record (squares, caster, spell, concentration or duration) for 28 SRD spells plus Wind Wall, Wall of Ice, Ice Storm, Earthquake, Forcecage, Antilife Shell and Antimagic Field: difficult terrain, light and heavy obscurement, magical darkness, Silence, walls to movement and sight, triggers on entering, starting and ending a turn and every 5 feet, Globe of Invulnerability; drawn on the board and listed in GAME STATE; off the map the spell resolves as before | enforced | `battlemap/zones*.ts`, `dm/zone-*.ts`, `BoardZoneLayer.tsx` | `test-enforce-zones`, `test-enforce-last-spells`, `test-enforce-zones-ui` |
| A concentration spell's later turns (Call Lightning, Heat Metal, Moonbeam moved) cost the turn and no slot, at the slot level it was cast at | enforced | `dm/cast-guard.ts repeatSpell` | `test-enforce-spell-engine`, `test-enforce-spell-rows` |
| Revivify, Raise Dead, Resurrection, True Resurrection through `heal`: the window from the recorded moment of death (1 minute, 10 days, 100 years, 200 years), refusal before the slot and the diamond, Raise Dead's -4 easing each long rest | enforced | `dm/heal-spell.ts revive`, `dm/revival.ts`, `dm/ordeal.ts` | `test-enforce-spell-engine`, `test-enforce-spell-riders` |
| Dispel Magic (ends spells of the slot's level or lower, a check for higher), Counterspell (see Combat) | enforced | `dm/dispel.ts`, `dm/reaction-spells.ts` | `test-enforce-spell-rows`, `test-enforce-reactions` |
| Summoning spells: the creature is an ally with its SRD stat block, a token, initiative and attacks through `pc_attack`, gone at 0 hit points or when the spell ends (Conjure Animals, Woodland Beings, Minor Elementals, Elemental, Fey, Celestial, Animate Dead, Create Undead, Giant Insect, Find Steed, Phantom Steed, Animate Objects, Arcane Hand, Unseen Servant, Faithful Hound, the Steel Defender); Find Familiar binds a pet | enforced | `srd/summon-spells.ts`, `srd/summon-forms.ts`, `dm/summon-*.ts`, `dm/familiar-cast.ts` (`sheets.summon`) | `test-enforce-summons` |
| Movement, sight and plane buffs (Freedom of Movement, Spider Climb, Water Walk, Jump, See Invisibility, True Seeing, Blink, Etherealness, Maze, Gaseous Form, Wind Walk), Feeblemind, Calm Emotions, Fear, Divine Word, Prismatic Spray, Contact Other Plane, Animal Shapes and Shapechange for beasts | enforced | `srd/spell-mech-last-rows.ts`, `srd/condition-effects-last.ts`, `dm/spell-planes.ts`, `dm/prismatic.ts`, `srd/shape-rules.ts` | `test-enforce-spell-last` |
| The Arcane Ward's hit points and Projected Ward | enforced | `dm/arcane-ward.ts`, `dm/authored-reactions.ts` | `test-enforce-last-spells` |
| Casting from a scroll or a wand's charge: no slot, the item's DC and attack bonus; a scroll off the reader's list is refused, one above their level needs the check | enforced | `srd/item-cast-credit.ts`, `dm/item-casts.ts`, `dm/consumables.ts` | `test-enforce-explore-defects`, `test-enforce-consumables` |
| A slot the player ticked by hand pays for the next cast at that level | enforced | `dm/manual-ticks.ts` | `test-enforce-narrator` |
| `set_condition` from an AI turn refuses a spell-only effect (cast the spell instead); the human console still may | enforced | `dm/spell-effects.ts spellEffectRefusal` | `test-enforce-spell-riders` |
| Unknown/homebrew spells | guidance (model-supplied args, validated dice) | deliberate fallback | |
| Combat Wild Shape (bonus-action slot-to-heal while shaped) | enforced | `dm/mutations.ts use_spell_slot`, spell="Combat Wild Shape" | `test-features` |
| Warlock pact slots refill on short rest | enforced | `dm/rest-logic.ts` (was a live bug) | `test-rest-logic`, `test-enforce-multiclass-slots` |
| Font of Magic (sorcery points <-> spell slots, created slots vanish on long rest) | enforced | `dm/resource-tools.ts parseFontOfMagic`, `dm/rest-logic.ts` clawback | `test-enforce-font-of-magic` |
| No casting while transformed (Wild Shape below 18 / Polymorph) | enforced | `dm/cast-guard.ts` | `test-enforce-casting-limits` |
| Cantrip level scaling, upcast scaling | enforced | `srd/spell-scaling.ts` | `test-spell-scaling`, `test-enforce-casting-numbers` |
| Save DC, spell attack bonus | enforced | `srd/index.ts` | `test-enforce-casting-numbers` |
| Healing spells rolled server-side (Heal's 70, the mass heals across six creatures, Mass Heal's pool, Disciple of Life, Supreme Healing, Blessed Healer, Beacon of Hope) | enforced | `dm/heal-spell.ts`, `dm/mutations.ts heal` | `test-enforce-spell-engine`, `test-enforce-spell-riders`, `test-enforce-final-features` |
| Caster features: Empowered Evocation, Elemental Affinity, Potent Cantrip, Spell Mastery, Signature Spells, Sculpt Spells, Overchannel | enforced | `dm/spell-damage-riders.ts`, `dm/cast-slot-choice.ts`, `dm/caster-features.ts` | `test-enforce-spell-riders`, `test-enforce-caster-features` |
| Spells known / prepared limits, cantrips known, a wizard's starting book, the top spell level the slots reach | enforced at creation, edit and level-up | `srd/spell-prep.ts spellListProblems` in `POST/PUT /api/characters`, the campaign sheet routes and `companions/create`; the builder shows the same counts (`builder/submit.ts spellsBlocker`) | `test-enforce-spell-counts`, `test-spell-list-problems` |
| Arcane/Natural Recovery, Song of Rest (only when a Hit Die was spent) | enforced | `dm/rest-tools.ts` | `test-enforce-short-rest`, `test-enforce-feature-uses` |
| Concentration on enemy spells | enforced | tracked when cast through the tools with casterEnemyId | `test-enforce-last-combat`, `test-enforce-monster-actions` |

## Class resources

| Subsystem | State | Where | Suite |
|---|---|---|---|
| SRD limited-use features (Ki, Second Wind, Channel Divinity, Relentless Rage, Wholeness of Body, Dark One's Own Luck, Hurl Through Hell, Eldritch Master, Holy Nimbus, Divine Intervention, Signature Spells, ...) | enforced | `srd/class-resources.ts`, `srd/combat-rows.ts` | `test-enforce-resource-tables`, `test-class-resources` |
| Custom genre-class limited-use features | enforced | `classes/resources.json` (235 counters, generated) | `test-enforce-resource-tables`, `test-enforce-genre-classes` |
| Subclass and lineage limited-use features (Superiority Dice, Portent, Psionic Energy, Stone's Endurance, ...) | enforced | `srd/authored-resources.json` (140 counters) | `test-enforce-resource-tables`, `test-enforce-authored` |
| Typed counter effects: healing, dice pools, temp HP, buffs with variants (Starry Form, Spirit Totem), enemy saves, teleports execute on spend | enforced | `fx` rows -> `srd/class-resources.ts effectFromFx` -> `dm/resource-tools.ts` (39 authored + 32 generated genre rows; the guard in `test-feature-coverage.mjs` stops mechanical wording landing without one) | `test-feature-coverage`, `test-enforce-resource-spend` |
| SRD feature spends with their rules: Channel Divinity's Turn and Destroy Undead, Sacred Weapon, Preserve Life, Turn the Unholy; the Ki variants (Patient Defense, Step of the Wind, Flurry of Blows, Empty Body, Diamond Soul); Indomitable; Stillness of Mind; Fiendish Resilience; Intimidating Presence; Peerless Skill, Quivering Palm, Draconic Presence, Hide in Plain Sight, Primeval Awareness's slot; capstone refills (Superior Inspiration, Perfect Self, Sorcerous Restoration) | enforced | `dm/feature-spends.ts`, `dm/feature-hooks.ts`, `dm/combat-features.ts`, `dm/srd-feature-spends.ts` | `test-enforce-feature-uses`, `test-enforce-bonus-actions`, `test-enforce-tail-features`, `test-enforce-final-features` |
| Font of Inspiration (Bardic Inspiration refills on a short rest from bard 5); a held die rides the holder's check, save, attack or contest and is spent by it | enforced | `srd/class-resources.ts rechargeFor`, `dm/pc-attack-situation.ts`, `dm/forced-save.ts spendRollCarriers` | `test-enforce-short-rest`, `test-enforce-pc-attack-features`, `test-enforce-roll-carriers` |
| Pick-lists: invocations, maneuvers, metamagic, pact boons, infusions, runes, elemental disciplines, Hunter's Prey, Defensive Tactics, the Hunter's Multiattack and Superior Hunter's Defense | enforced (choice + count); maneuvers, Agonizing Blast and the Hunter picks enforced in combat, metamagic spend via its counter, remaining effects guidance; picks the class, subclass or level no longer opens are dropped on regrant | `srd/options.ts`, `dm/pc-attack.ts`, `srd/features.ts pruneChoiceFeatures` | `test-builder-reconcile`, `test-enforce-pc-attack-features`, `test-enforce-final-features` |
| Subclass spell lists (domain, circle, oath, patron) | enforced | `srd/features.ts subclassSpellsFor`, granted at creation and level-up | `test-enforce-subclasses`, `test-enforce-spell-learning` |
| Wild Shape (full engine: authored beast table, CR/movement caps by druid level incl. Moon, stat swap, natural attacks, beast AC vs enemies, casting gate) | enforced | `srd/beast-forms.ts`, `dm/resource-tools.ts`, `srd/index.ts computeSheetDerived` | `test-enforce-wild-shape`, `test-beast-forms` |
| Polymorph (form via cast_buff variant, CR <= target level, concentration-linked, damage reverts); at a hostile creature (cast_at_enemy or cast_buff targetEnemyId): WIS save through the enemy save path (Magic Resistance, Legendary Resistance, conditions), no effect on a shapechanger or a creature at 0 HP, beast CR <= the creature's CR, the beast's stat block and HP in place of its own (alignment kept), revert at 0 with carry-over, own block restored exactly when concentration, the hour or Dispel Magic ends it; True Polymorph's creature-into-beast shares the path | enforced | `dm/cast-tools.ts`, `srd/beast-forms.ts`, `dm/condition-tick.ts`, `dm/enemy-polymorph.ts`, `dm/enemy-polymorph-logic.ts`, `db/enemy-form.ts`, `dm/enemy-damage.ts` | `test-enforce-coverage-holes` (CR cap, HP swap, revert with carry-over, casting refusal; at a creature: CR cap, shapechanger and 0 HP refusals, save, Magic Resistance, stat swap, revert with carry-over, concentration restore, enemy_attack with the beast's attacks, cast_buff refusing an enemy target it cannot honour), `test-enforce-casting-limits` (the casting gate) |
| Familiars, Beast Master companions, Drakewarden drakes, story pets; `pet_attack` costs the owner's action, bonus action or one attack by kind, on the owner's turn | enforced | `dm/pet-tools.ts` (summon validation, pet_attack dice, damage_pet pool, long-rest heal) | `test-pet-logic`, `test-enforce-turn-actions` |
| Relentless Endurance (auto-burn at 0 HP) | enforced | `dm/mutations.ts` | `test-enforce-death` |

## Exploration

The DM's second pillar.

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Passive Perception (computed on every sheet) | enforced | `srd/index.ts computeSheetDerived` | `test-enforce-abilities`, `test-enforce-checks` |
| Light and vision on the board (bright/dim/dark, darkvision, line of sight, fog of war, spell areas) and on attack rolls (see Combat) | enforced | `battlemap/los.ts`, `dm/attack-light.ts` | `test-battlemap-los`, `test-enforce-pc-attack-board`, `test-enforce-zones` |
| Light off the board: the place's light (underground and caves dark, a building lit, open air by the hour and the sky), a carried torch or lantern, darkvision one step; `check_notice` takes `light` and `by: "hearing"` | enforced | `dm/notice-logic.ts`, `dm/check-tools.ts` | `test-enforce-explore-rules`, `test-enforce-exploration` |
| Hiding vs the enemies' real passive Perception (Keen senses, obscurement, Naturally Stealthy and Mask of the Wild) | enforced | `dm/combat-actions.ts hide`, `dm/hide-traits.ts` | `test-enforce-turn-actions`, `test-enforce-feature-uses`, `test-enforce-zones` |
| Passive-check gating of hidden things (traps, secret doors, ambush, lies); the unconscious notice nothing | enforced | `dm/check-tools.ts check_notice` | `test-enforce-checks`, `test-enforce-exploration` |
| Contests against a creature: its own opposed check rolled from its stat block (Insight against Deception, Perception against Stealth), a tie keeps the status quo | enforced | `request_roll againstEnemyId / againstMonster`, `dm/contest-roll.ts`, `check_notice` | `test-enforce-explore-rules` |
| A skill with a different ability (a Constitution (Athletics) check) | enforced | `dm/rolls.ts` | `test-enforce-explore-rules` |
| Ability-check DCs from a consistent difficulty ladder | enforced | `srd/dc.ts`, `request_roll` `difficulty` | `test-dc` |
| Group checks (half the party must succeed) | enforced | `dm/check-tools.ts group_check` | `test-enforce-checks` |
| Traps (spot, spring, tiered damage) | enforced | `check_notice` spots, `dm/hazard-tools.ts apply_hazard` springs; disarm via `request_roll` | `test-enforce-hazards` |
| Travel pace effects (fast -5 to passive Perception while the march lasts, no stealth at a normal or fast pace), miles per day from the pace, terrain and weather; `travel` takes hours or miles | enforced | `srd/travel.ts`, `dm/world-tools.ts travel` | `test-enforce-exploration`, `test-enforce-explore-rules` |
| Forced march (one CON save an hour past 8, DC 10 + hours past 8, a level of exhaustion on each failure) | enforced | `dm/world-tools.ts travel`, `dm/endurance.ts` | `test-enforce-exploration`, `test-world` |
| Food and water (optional): a ration and water each dawn, 3 + CON modifier days without food, half water a DC 15 CON save, a level of exhaustion per failure (two when already exhausted), a long rest keeps exhaustion while going without | enforced when the `supplies` variant rule is on | `dm/supplies.ts`, `db/clock.ts advanceClock` | `test-enforce-supplies`, `test-enforce-explore-rules` |
| Short-rest hit dice: a character with a connected player chooses their own; the server default applies only to characters with nobody connected | enforced | `dm/hit-dice.ts`, `POST /sheet/hit-dice` | `test-enforce-rest-choice` |
| Lifestyle expenses (SRD 5.1 costs charged at each dawn) and downtime (crafting, a profession, recuperating, research, training) | enforced | `set_lifestyle`, `downtime`; `dm/lifestyle.ts`, `dm/between-state.ts` | `test-enforce-downtime`, `test-enforce-sheet-between` |
| Diseases (Sewer Plague, Cackle Fever, Sight Rot), the SRD poisons (injury poisons coat a weapon) and the three madness tables, with incubation and durations on the clock; lesser restoration ends a disease | enforced | `afflict`; `srd/afflictions.ts`, `dm/afflictions.ts`, `dm/affliction-poisons.ts` | `test-enforce-afflictions` |
| Foraging and navigation | narrated by design | DMG rules, not SRD 5.1 | |
| Chases | out of scope | niche subsystem; not modelled | |
| Encumbrance | enforced when the `encumbrance` variant rule is on | speed via `srd/index.ts speedFor`, disadvantage via `dm/rolls.ts` and `dm/pc-attack.ts` | `test-encumbrance` |

## Social interaction

The DM's third pillar. NPC disposition persists, and the checks that move it
are the engine's.

| Subsystem | State | Where | Suite |
|---|---|---|---|
| NPC attitude (hostile / indifferent / friendly), persisted | enforced | `db/npcs.ts`, surfaced in GAME STATE | `test-social` |
| Charisma checks that shift attitude one step | enforced | `dm/social-tools.ts social_check` (one shift per exchange) | `test-social` |
| Attitude-derived social-check DCs | enforced | `dm/social.ts socialCheckDc` | `test-social` |
| Reaction roll to seed a first meeting (2d6 + mods) | enforced | `dm/social-tools.ts npc_reaction` | `test-social` |
| Insight vs Deception | enforced when the creature is named | `request_roll` contest against its stat block (see Exploration); the model adjudicates only a creature the engine cannot roll for | `test-enforce-explore-rules` |

## Environment & hazards

| Subsystem | State | Where | Suite |
|---|---|---|---|
| A monster/trap forcing a save on one PC | enforced | `dm/cast-at-player.ts` | `test-enforce-forced-saves` |
| A hazard catching several PCs at once | enforced | `dm/encounter-tools-extra.ts aoe_damage` | `test-enforce-conditions-actions`, `test-enforce-damage-types` |
| Falling damage (1d6 per 10 ft, cap 20d6) | enforced | `srd/hazards.ts`, `dm/hazard-tools.ts apply_hazard` | `test-enforce-hazards`, `test-hazards` |
| Trap / generic hazard save + tiered damage | enforced | `dm/hazard-tools.ts apply_hazard` via `cast_at_player` | `test-enforce-hazards` |
| Suffocation / drowning | enforced | `dm/hazard-tools.ts apply_hazard` (CON-derived survival, drop to 0 HP) | `test-enforce-hazards` |
| Extreme cold / heat (one CON save an hour; heat's DC rising, disadvantage in medium or heavy armor; cold weather gear or the fitting resistance shrugs it off) | enforced | `dm/hazard-tools.ts apply_hazard` extreme_cold/extreme_heat `hours` | `test-enforce-hazards`, `test-enforce-exploration` |
| Object durability (object AC + HP by size; a named object keeps its damage between blows; a character's weapon blow rolls the attack; Wall of Ice sections) | enforced | `srd/objects.ts`, `dm/object-damage.ts`, `dm/world-tools.ts damage_object` | `test-enforce-objects-terrain`, `test-enforce-last-spells` |
| Treasure by CR (individual + hoard tables) | enforced | `srd/treasure.ts`, `dm/world-tools.ts roll_treasure` | `test-world` |

## The long tail

The SRD class and racial features with a numeric, state or action-economy
effect (181 of them, counted by the second audit; pure roleplay, subclass
markers and spell-list grants left out) are all held by the engine. Three are
held only partly, because what is left is the DM's to say: Natural Explorer's
travel benefits (pace, foraging, not getting lost), Primeval Awareness (the
slot is spent, the answer is the DM's), and Dragon Wings (the flying speed is
always there; sprouting them as a bonus action and the armor limit are the
DM's). The suites are `test-enforce-feature-saves`, `test-enforce-feature-uses`,
`test-enforce-final-features` and the combat suites above.

The authored subclass layer adds 105 subclasses and 533 more feature names on
top of that. Each one is in exactly one tier, counted by
`srd/authored-coverage.ts authoredCoverage`: a typed effect an engine reads
(189: parsed from the rules text by `feature-effects.ts parseFeatureEffects`,
or an entry in `srd/authored-effects-data*.ts` read by the hook the coverage
names), a counter in `src/lib/srd/authored-resources.json` (150 features),
narrated with a written reason (11: roleplay or information, a companion the DM
fields, or a table the DM narrates), or no mechanical wording at all (183). No
feature states a mechanical effect without a hook. `scripts/test-feature-coverage.mjs`
enforces all of it: the narrated list can only shrink (its ceiling is 15), a
counter whose wording states dice must execute something on spend, and every
acknowledged name must be a real granted name that the engine does not hold.
`scripts/test-enforce-authored.mjs` holds each effect kind to its reader.

- **Subclass markers** ("Arcane Tradition", "Divine Domain"): the pick has
  mechanics, the marker does not.
- **Spell-list grants** ("Magical Secrets", "Circle Spells"): the spells land
  on the sheet; the feature itself does nothing extra.
- **Passive / roleplay features** ("Druidic", "Timeless Body", "Thieves' Cant",
  "Tongue of the Sun and Moon"): narrated from the sheet.

The full acknowledged list lives in `scripts/test-feature-coverage.mjs`, which
also proves it does not rot (every acknowledged name is a real granted name).

## Narrated by design, and deliberate omissions

| Rule | Why |
|---|---|
| Ammunition (default off) | Assumed supplied unless a table asks for it. The `ammunition` variant rule turns on real tracking: a shot spends a round, an empty quiver refuses the attack, and half the spend comes back after the fight. |
| Food and water (default off) | Assumed supplied, like ammunition. The `supplies` variant rule turns on the daily upkeep and the SRD's exhaustion schedule. |
| Item weights the source never printed | The content pack carries a weight for every row Open5e gives one (all 68 weapons, 258 of 338 gear entries); armor comes from the SRD table in `srd/armor.ts` because Open5e ships it blank, and magic items have no weight anywhere. An item nothing can weigh is reported as UNWEIGHED rather than counted as zero, so a carried total with unknowns in it reads as a floor. |
| Magic items with no engine mechanic | 108 of the 237 SRD magic items and 577 of the 1618 pack rows now carry one (a base item, riders, charges, a mapped potion or scroll, a curse, or a parsed effect). The rest (Bag of Holding, Boots of Speed, Cloak of Displacement, Ring of Spell Storing and the like) are narrated: GAME STATE shows each carried magic item's one-line effect and its worn and attuned state so the model narrates it from the text (`dm/item-summary.ts magicItemLine`, `test-enforce-narrator`). |
| A character's opportunity attack that kills | The creature leaves the board and its concentration ends, but the fight stays open: the end and the XP wait for the DM's turn (`test-enforce-movement`, `test-enforce-pc-attack-board`). |
| Metamagic effects (Twinned targeting, Careful exclusions) | The sorcery-point spend is a real counter; the shaping is targeting logic the model narrates. |
| Free object interaction | ODM tracks what is equipped (the sheet's equip toggles, which the free-hand rule, two-weapon fighting and components read), not the one free interaction per turn; drawing or stowing is the sheet toggle. |
| A generic hazard's DC and dice | `apply_hazard` `generic` is for a hazard the SRD gives no numbers for; every SRD hazard with numbers is resolved by the engine. |
| Enemy target choice and morale | The DM's decision in the SRD itself. The engine's backstop picks the nearest seen, lowest-AC target, and `enemy_flees` records a rout. |
| An interrupted rest | `take_rest` is one atomic call: the model not calling it is the interruption. |
| The moment a character's air runs out off the board | A story event the engine cannot see; from the count the DM gives, the engine derives the rest from Constitution. |
| Spells whose effect changes the map or needs a contest no tool resolves | Time Stop, Telekinesis, Alter Self, Meld into Stone, Hallucinatory Terrain, Stone Shape and Move Earth: the slot and legality are held, the DM paints or narrates the effect. The 91 pure utility spells (Mending, Knock, Comprehend Languages, Teleport...) are narrated because narration is their resolution; 21 spells keep a named part narrated (for example Calm Emotions' suppression of charm and fear, Antimagic Field on magic items, Reverse Gravity's fall with no heights on the board). |

## Multiclassing (enforced)

| Rule | Where | Suite |
|---|---|---|
| Ability prerequisites, both directions (PHB), cap 3 classes | `src/lib/srd/multiclass.ts canMulticlassInto`, validated server-side in the sheet PATCH route | `test-multiclass`, `test-enforce-multiclass-levelup` |
| Custom-class prerequisites (13 in casting ability, else first save ability) | `multiclassPrereq` | `test-enforce-genre-classes`, `test-multiclass` |
| Second-class proficiency grants (never saves; custom classes cap at medium armor) | `multiclassGrantsFor`, applied server-side in `buildMulticlassLevelUp` | `test-enforce-multiclass-levelup` |
| Per-class feature grants at each class's own level, tagged with `classId` | `src/lib/srd/features.ts populateFeaturesForClasses` | `test-enforce-multiclass-features` |
| Level-scaled features read the granting class's level (Sneak Attack, Martial Arts, Brutal Critical...) | `src/lib/srd/feature-effects.ts combatRiders` | `test-enforce-multiclass-features` |
| Class resources sized by the owning class's level (Ki = monk level, Rage uses = barbarian level, recovery pools) | `src/lib/srd/class-resources.ts` (`classIds` on defs, `resourceLevel`) | `test-enforce-multiclass-features` |
| One Unarmored Defense: acquisition order picks the formula | `src/lib/srd/armor.ts unarmoredFormulaFor` | `test-armor` |
| Shared multiclass spell-slot table (full + half floor + artificer ceil; warlock excluded) | `src/lib/srd/multiclass.ts casterLevelFor/multiclassSlots/slotTableFor` | `test-enforce-multiclass-slots`, `test-multiclass` |
| Per-class casting: each caster keeps its own ability, lists, and save DC | `spellcasting.casters[]`; `src/lib/srd/index.ts spellSaveDcFor/spellAttackFor` | `test-enforce-multiclass-slots` |
| Pact Magic apart from the shared pool; short-rest refill of pact only | `spellcasting.pact`; `rest-logic.ts`, pact-first spend in `mutations.ts use_spell_slot` | `test-enforce-multiclass-slots`, `test-rest-logic` |
| Per-class hit-die pools; long-rest recovery and short-rest spends biggest die first | `hitDicePools`; `rest-logic.ts recoverPools/shortRestDicePlan`, mirror sync in `db/sheets.ts` | `test-enforce-multiclass-features`, `test-enforce-short-rest` |
| Level-up flow: class step with prereq gating, per-class HP die, subclass/expertise/spells at class levels | `LevelUpDialog.tsx` + server validation in the sheet PATCH route | `test-enforce-multiclass-levelup` |
| Library round-trip: multiclass sync-back, lower-level instantiation strips the last class first | `db/characters.ts` | `test-enforce-multiclass-library` |

Ability Score Improvements follow each class's own table by class level (the
fighter's seven, the rogue's six, five for the rest; `srd/asi.ts`), and a
character stored under the old single table is owed what the new one adds
(`srd/asi-ledger.ts`; `test-asi`, `test-sheet-legality`). Kept simplifications:
the lead edits multiclass sheets through the scalar class/subclass/level
fields, which fold into the primary class entry; characters are always created
single-class (multiclassing happens at level-up).

## Cross-cutting engines (Phase 8)

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Active effects: lasting modifiers with duration, source and save-to-end | enforced | `dm/effects-logic.ts`, `db/active-effects.ts` | `test-active-effects` |
| Effect stacking: adds sum, largest override wins, advantage never stacks | enforced | `dm/effects-logic.ts resolveField` | `test-active-effects` |
| Effects applied to AC | enforced | `dm/encounter-tools.ts acWithEffects` | `test-enforce-attacks` |
| Effects applied to saves, checks and initiative | enforced | `dm/rolls.ts` extras, `dm/effect-tools.ts rollEffectExtras` | `test-enforce-initiative`, `test-enforce-checks`, `test-enforce-forced-saves` |
| In-world calendar, date and time of day | enforced | `dm/calendar.ts`, `db/clock.ts` | `test-calendar` |
| Rest length by variant (standard, gritty realism, heroic) | enforced | `dm/calendar.ts restMinutes`, `dm/rest-tools.ts` | `test-calendar`, `test-enforce-short-rest`, `test-enforce-variant-rules` |
| Time advancing on travel, rests and `pass_time` | enforced | `db/clock.ts advanceClock` | `test-condition-clock` |
| Party entity: common purse, shared pack, banked XP, marching order | enforced | `dm/party-logic.ts`, `dm/party-tools.ts` | `test-party` |
| Multi-denomination currency (cp/sp/ep/gp/pp), parsing and formatting | enforced | `srd/currency.ts` | `test-currency`, `test-enforce-currency` |
| Prices outside a shop: list price to buy, half to sell, full value for gems, art and trade goods, the model's number only for an unpriced thing; an item's list price found by its exact name | enforced | `dm/trade-value.ts`, `dm/resource-tools.ts computePurchase` | `test-enforce-economy`, `test-enforce-explore-defects` |
| Unidentified items and the DM reveal | enforced | `schemas/sheet.ts`, `dm/mutation-math.ts revealItemMath` | `test-enforce-inventory`, `test-enforce-commerce` |
| Mounted combat: size rule, a mounted rider moves at the mount's speed on the board, mounting and dismounting cost half the rider's speed, the thrown rider's DEX save rolled by the server | enforced | `srd/mounts.ts`, `dm/mount-tools.ts`, `battlemap/view.ts pcMoveBudget` | `test-mounts`, `test-enforce-enemy-turns` |
| Vehicles: speed, capacity, crew, undercrewed penalty | guidance | `srd/mounts.ts` (the undercrewed halving is ODM's own, not SRD) | |
| Structured non-combat scenes: successes before failures, per-round checks | enforced | `dm/scene-tracker-logic.ts`, `dm/scene-tools.ts` | `test-scene-tracker` |
| Freeform typed attributes on NPCs, items, locations, factions and props | enforced | `dm/attributes-logic.ts`, `db/entity-attributes.ts` | `test-attributes` |
| Assistant DM seat: full in-game powers, cannot re-seat the DM | enforced | `dm/viewer.ts isPrimaryDm`, `/dm/seat` | `test-viewer-roles`, `test-enforce-permissions` |

## The stage and the binder (phases 16 to 21)

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Weather: rolled per climate with persistence, riders on Perception (passive -5 in fog and heavy rain), ranged attacks past six tiles in a gale, travel pace and exposure hazards | enforced | `srd/weather.ts`, `dm/sky.ts`, `dm/check-tools.ts`, `dm/world-tools.ts` | `test-weather` |
| Hour lights the map: outdoor ambient follows the clock and the sky; indoors keeps its own light | enforced | `battlemap/daylight.ts`, `battlemap/view.ts` | `test-ambient-by-hour` |
| Senses in the light model: darkvision, blindsight, tremorsense, truesight, Devil's Sight, magical darkness | enforced | `srd/senses.ts`, `battlemap/los.ts` | `test-senses`, `test-battlemap-los` |
| Terrain wall (low wall): blocks movement, half cover across it, a flier may hover over it | enforced | `battlemap/types.ts`, `battlemap/los.ts coverBetween`, `battlemap/movement.ts` | `test-terrain-wall` |
| Footprints and movement modes: large creatures occupy their squares, fliers and burrowers ignore what they should; only a creature with a flying speed takes to the air | enforced | `battlemap/footprint.ts`, `battlemap/movement.ts`, `dm/map-tools.ts` | `test-footprint-move`, `test-enforce-tail-features` |
| Teleport: range, walls, occupancy, the door and the effect that follow; the AI's teleport needs a spell and its caster (paid through the cast guard) or a hazard | enforced | `dm/map-tools.ts handleTeleportToken` | `test-teleport`, `test-enforce-enemy-turns` |
| Auras: Aura of Protection and effect auras drawn and applied within their radius | enforced | `dm/effects-logic.ts`, `battlemap/view.ts tokenAuras` | `test-enforce-feature-saves` |
| Lore audiences: an entry for some players opens only for them; secret blocks never cross the wire to a player | enforced | `dm/world-lore-logic.ts loreVisibleTo, stripSecretBlocks`, `/lore` | `test-lore-links` |
| Show this now: the model may show only party-readable entries; a person may show any | enforced | `dm/binder-tools.ts handleShowHandout` | `test-show-handout` |
| Sourcebook PDFs: a rules-tagged attachment is chunked into retrieval beside the house rules | enforced | `dm/lore-attachments.ts`, `pdf/text.ts`, `db/rules.ts replaceSourceChunks` | `test-pdf-attachment` |
| Quests by hand: objectives ticked by the DM or the model, arc sub-arcs mirrored, DM-only rows kept out of a player's log | enforced | `dm/quest-logic.ts`, `db/quests.ts`, `dm/binder-tools.ts` | `test-quests` |
| Inline rolls in handouts and house rules: `[[1d6]]` rolls through the public rolls route | enforced | `components/ui/Markdown.tsx RollChip`, `/rolls` | `test-inline-markdown` |

## Voices, tone, combat depth, factions and time (phases 22 to 25)

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Speech attribution: quoted lines are matched to the cast conservatively; unmatched lines stay the narrator's | enforced | `dm/speech.ts attributeSpeech`, `dm/tts-segments.ts` | `test-speech-attribution` |
| Per-NPC voices: a cast member's voice reads their lines, the narrator's voice the rest | enforced | `dm/tts.ts castVoices`, `db/npcs.ts voice_json` | `test-tts-segments` |
| Lines and veils: a line stops the model before it writes; a veil asks it to cut away; both feed the image negatives | enforced | `dm/safety-logic.ts lineViolations, boundaryNegativeTerms`, `dm/narration-guard.ts` | `test-safety` |
| X-card: the queue pauses, the last narration is withdrawn, rewound or rerolled | enforced | `dm/safety.ts`, `dm/queue.ts`, `/safety/x-card`, `/safety/resume` | `test-safety` |
| Strictness: lenient, by the book and harsh shift every difficulty DC by two steps; tone biases reactions and the ambience bed | enforced | `srd/dc.ts dcForDifficulty`, `dm/safety-logic.ts strictnessShift, reactionBias, toneBedBias` | `test-strictness` |
| Legendary actions: pools from the stat block's traits (parsed from the pack's legendary section), spent by the model or the DM at the end of another creature's turn, never on the creature's own, refilled at the start of its turn | enforced | `dm/legendary-logic.ts`, `dm/legendary-tools.ts`, `dm/encounter-tools.ts advancePointer` | `test-legendary`, `test-enforce-monster-blocks`, `test-enforce-monster-traits` |
| Legendary resistance: a failed save against a condition is turned automatically while charges remain | enforced | `dm/legendary-tools.ts autoLegendaryResistance`, `dm/cast-tools.ts` | `test-legendary`, `test-enforce-enemies` |
| Lair actions on initiative count 20 | enforced | `dm/encounter-tools.ts` (wrap note), `dm/legendary-tools.ts handleLairAction` | `test-legendary` |
| Fight summary: damage dealt and taken, kills, healing, the deciding roll, at the end of every fight | enforced | `dm/encounter-summary.ts`, `dm/enemy-damage.ts finishEncounter` | `test-encounter-summary` |
| Factions: the party's standing per faction bends a member's social DC one point per step; goals advance on the chapter tick and power drifts; an arc that names a faction moves its power | enforced | `dm/faction-logic.ts`, `dm/faction-tools.ts`, `dm/social-tools.ts`, `dm/chapter-close.ts`, `dm/world-tick.ts` | `test-factions` |
| Calendar: months, weekdays, moons and festivals written by hand or shipped by a world pack; the prompt says the day of the fair and the full moon | enforced | `dm/calendar.ts moonPhase, festivalsOn, describeInstant`, `dm/calendar-schema.ts`, `worlds/types.ts calendar` | `test-calendar` |
| Calendar events: a party event the clock crosses becomes a fact and a title card, a DM-only one a fact the DM seat reads; yearly and monthly repeats | enforced | `db/calendar-events.ts`, `dm/calendar-fire.ts`, `db/clock.ts advanceClock` | `test-calendar-events` |
| Torch timers: a torch burns an hour, a lantern six on a flask of lamp oil, everburning things do not; the clock puts them out, a guttered torch is used up, and the board gutters the light | enforced | `dm/light-timers.ts`, `db/battle-maps.ts expireBurntLights`, `battlemap/view.ts light` | `test-light-timers`, `test-enforce-explore-defects` |

## Commerce, generators, the room and the prompt (phases 26 to 30)

| Subsystem | State | Where | Suite |
|---|---|---|---|
| Shops: stock from the content pack's costs at the settlement's markup; the purse and the shelf clamp every purchase; the keeper buys at half, and at full value for gems, art and trade goods; restock comes due by the clock; a price for an unpriced thing is capped | enforced | `dm/shop-logic.ts`, `dm/shop-tools.ts`, `db/shops.ts`, `/shops` | `test-shops`, `test-enforce-commerce`, `test-enforce-economy`, `test-enforce-explore-defects` |
| Haggling: a Persuasion check against the settlement's DC moves every price in that shop one step, once per character | enforced | `dm/shop-logic.ts haggleStep, haggleDc`, `dm/shop-tools.ts handleHaggle` | `test-shops`, `test-enforce-roll-carriers` |
| Player-to-player trade: an offer is checked against both packs and purses when made and again when accepted; both sheets move in one transaction with an audit row each | enforced | `dm/trade-logic.ts`, `dm/trade.ts`, `/item-proposals` | `test-item-proposals`, `test-enforce-commerce` |
| Several characters per player: the seat marks the one in play; with one active at a time the others wait out fights and the map | enforced | `db/sheets.ts getSheetForUser`, `dm/roster.ts fieldedSheets`, `/sheet/switch` | `test-enforce-permissions`, `test-enforce-campaign-config` |
| Settlement generator: seeded people, shops, rumours and a hook for a place; fired by the DM tool, the places list, or arrival somewhere unwritten with the world simulation on | enforced | `overworld/settlement.ts`, `dm/settlement.ts`, `dm/settlement-tools.ts` | `test-settlement` |
| Watabou imports: a One Page Dungeon becomes walls, doors and DM labels; a city export becomes roads, a river and district names around its place | enforced | `battlemap/watabou.ts`, `dm/map-library.ts`, `/overworld/import` | `test-watabou-import` |
| Prepared worlds in the registry: a bundle listed beside the packs installs as a workshop of the installing admin's | enforced | `worlds/types.ts registryBundleSchema`, `worlds/install.ts installBundleFromUrl` | `test-world-install` |
| Transcription: each speaker's rings are written down with their name and both clocks; the beat drafter and the chapter close read them; the prompt never does | enforced | `voice/transcript.ts`, `db/voice-transcript.ts`, `stt.ts`, `dm/beats.ts`, `dm/chapter-close.ts` | `test-transcript` |
| Dual-track recap: the party's card from what the party may know; a human DM's whisper adds the secrets and the arcs | enforced | `dm/recap-logic.ts`, `dm/recap.ts` | `test-transcript` |
| Prompt sections with floors: the lines never drop, the sky, factions, quests and the open shop each hold their slice, and the engine boundary owns the weather, faction standing and shop prices | enforced | `dm/context-budget.ts SECTION_SHARES`, `dm/engine-boundary.ts`, `dm/prompt.ts` | `test-context-budget` |
