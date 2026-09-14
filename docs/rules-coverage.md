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

One row is neither of the first two: the engine boundary. `dm/engine-boundary.ts`
states in a single prompt block which facts the runtime owns (dice, hit and
miss, damage, HP and death, slots and resources, conditions, XP, gold), and then
checks that the finished narration agrees with the outcomes the turn's tools
actually resolved, sending a contradiction back to the model for one rewrite
inside the existing call budget. Enforcement makes the numbers right; this makes
the prose about them right. It changes no mechanical state, is deliberately
biased toward missing a real contradiction over firing on flavor text, and a
table can switch it off with the `narrationGuard` game setting.

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
| Jack of All Trades / Remarkable Athlete (half proficiency on checks + initiative) | enforced | feature-effects `half_proficiency` -> `computeSheetDerived`, `dm/rolls.ts` |
| Armor stealth disadvantage (scale, plate...) | enforced | `srd/armor.ts` flag -> `dm/rolls.ts`, `take_action hide` |
| Heavy armor below its STR requirement (speed -10) | enforced | `srd/index.ts speedFor` |
| Armor worn without training (disadvantage on STR/DEX rolls) | enforced | `dm/rolls.ts` via `acBreakdownFor` |
| Subraces (Mountain Dwarf, Wood Elf, Drow, Stout Halfling, Forest/Deep Gnome, Variant Human) | enforced | `srd/races.json` flattened entries, race armor/weapon training |
| Creature size (Small races vs heavy weapons, grapple/shove size cap) | enforced | `srd/index.ts sizeForRace`, `dm/pc-attack.ts`, `dm/action-tools.ts` |
| Aura of Protection (+CHA to saves) | enforced | feature-effects `save_bonus` → derived saves |
| Alert (+5 initiative), Observant (+5 passive) | enforced | feature-effects → derived stats |
| Party spoils (XP each, a purse split evenly, an item to the finder) | enforced | `dm/mutations.ts party_award`, composing the single-target mutations so the audit trail is unchanged |
| Encumbrance (carrying capacity, the two variant thresholds) | enforced when the `encumbrance` variant rule is on | `srd/encumbrance.ts`; item weights from the content pack, armor from `srd/armor.ts` |

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
| Aura of Protection reaching allies (within 10/30 ft, mapped encounters) | enforced | `dm/aura.ts allySaveAura` -> every save path; guidance outside maps |
| Enemy concentration (tracked via casterEnemyId+spell, CON save on damage, break ends the effect) | enforced (best effort) | `db/encounters.ts concentration`, `dm/cast-tools.ts trackEnemyConcentration`, `dm/enemy-damage.ts` |
| Reliable Talent (proficient checks floor a low d20 at 10) | enforced | `dice.ts` `fN` floor suffix, `dm/rolls.ts resolveRollExpression` |
| Effect conditions with real riders (Bless, Bane, Haste, Barkskin, Hex, Starry Form...) | enforced | `srd/condition-effects.ts`, consumed by the roll/AC/damage/speed/budget engines |
| Battle Master maneuvers (die spend, damage/to-hit, Trip/Menacing/Disarm/Goading rider saves) | enforced | `dm/pc-attack.ts` `maneuver` arg |
| Subclass damage riders (Divine Strike family, Improved Divine Smite, Divine Fury) | enforced | `srd/feature-effects.ts` parsed + static riders -> `dm/pc-attack.ts` |
| Magical attacks (Primal Strike, Ki-Empowered Strikes) | enforced (noted to the model) | `srd/feature-effects.ts` |
| Agonizing Blast (+CHA per Eldritch Blast beam) | enforced | `srd/feature-effects.ts` `cantrip_damage_ability` |
| Haste's extra action / Slow's lost reactions | enforced | `dm/action-budget.ts` `extraActions`, `use_reaction` gate |
| Shield spell / Protection style reactions (real AC and disadvantage) | enforced | `dm/action-tools.ts use_reaction` -> registry conditions |
| Narration cross-checked against the turn's real outcomes (a hit written on a miss, a death the hit points deny, a damage figure no die rolled, a spell nothing paid for) | enforced (verification, one rewrite) | `dm/engine-boundary.ts`, `dm/narration-guard.ts`, setting `narrationGuard` |
| Ammunition tracking (optional) | enforced when the `ammunition` variant rule is on | `srd/ammunition.ts`, spent in `dm/pc-attack.ts`, half recovered in `dm/enemy-damage.ts finishEncounter` |
| One damage total split across targets at full/half/double/none | enforced | `dm/split-damage.ts split_damage`; each share then goes through the ordinary enemy and character damage paths, so resistances and temp HP still apply |
| Hidden and blind rolls (a DM screen) | enforced | `rolls.visibility`, `dm/viewer.ts rollAccessFor`; the shared stream carries the redacted roll and the allowed seat re-fetches |

## Spellcasting

| Subsystem | State | Where |
|---|---|---|
| Spell slots (spend, level/cantrip/ritual validation) | enforced | `dm/mutations.ts use_spell_slot` |
| Structured spell mechanics: the real save ability, half-on-save, damage type, and condition for every pack spell OVERRIDE the model's args | enforced | `srd/spell-mechanics.ts` (authored `mech` + overrides + prose parsers), `content spellMechanicsFor`, consumed by `cast_at_enemy`/`pc_attack`/`aoe_damage` |
| Buff spells (Bless, Mage Armor, Haste, Hunter's Mark, the smites, Shadow Blade...) as tracked conditions with enforced riders, slot spend, and duration | enforced | `dm/cast-tools.ts cast_buff` + `srd/condition-effects.ts` |
| Wrong-tool casts redirected (a save spell through pc_attack, a buff through cast_at_enemy) | enforced | `dm/cast-tools.ts castRedirect` |
| Area spells by name (slot spend, scaled dice, save, DC from the caster's sheet) | enforced | `dm/encounter-tools-extra.ts aoe_damage` `spell` arg |
| Unknown/homebrew spells | guidance (model-supplied args, validated dice) | deliberate fallback |
| Combat Wild Shape (bonus-action slot-to-heal while shaped) | enforced | `dm/mutations.ts use_spell_slot`, spell="Combat Wild Shape" |
| Warlock pact slots refill on short rest | enforced | `dm/rest-logic.ts` (was a live bug) |
| Font of Magic (sorcery points <-> spell slots, created slots vanish on long rest) | enforced | `dm/resource-tools.ts parseFontOfMagic`, `dm/rest-logic.ts` clawback |
| No casting while transformed (Wild Shape below 18 / Polymorph) | enforced | `dm/mutations.ts use_spell_slot` |
| Concentration break clears the spell's lingering conditions (PCs and enemies) and reverts Polymorph | enforced | `dm/concentration.ts clearSpellConditions` |
| Cantrip level scaling, upcast scaling (from content pack) | enforced | `srd/spell-scaling.ts` |
| Save DC, spell attack bonus | enforced | `srd/index.ts` |
| Healing spells rolled server-side | enforced | `dm/mutations.ts heal` |
| Spells known / prepared limits | enforced | `dm/mutations.ts learn_spell`, level-up, PATCH route |
| Arcane/Natural Recovery, Song of Rest | enforced | `dm/rest-tools.ts` |
| Concentration on enemy spells | enforced (best effort) | tracked when cast through the tools with casterEnemyId |

## Class resources

| Subsystem | State | Where |
|---|---|---|
| SRD limited-use features (Ki, Second Wind, Channel Divinity, ...) | enforced | `srd/class-resources.ts` (29 counters) |
| Custom genre-class limited-use features | enforced | `classes/resources.json` (235 counters, generated) |
| Subclass and lineage limited-use features (Superiority Dice, Portent, Psionic Energy, Stone's Endurance, ...) | enforced | `srd/authored-resources.json` (122 counters) |
| Typed counter effects: healing, dice pools, temp HP, buffs with variants (Starry Form, Spirit Totem), enemy saves, teleports execute on spend | enforced | `fx` rows -> `srd/class-resources.ts effectFromFx` -> `dm/resource-tools.ts` (39 authored + 32 generated genre rows; the guard in `test-feature-coverage.mjs` stops mechanical wording landing without one) |
| Pick-lists: invocations, maneuvers, metamagic, pact boons, infusions, runes, elemental disciplines | enforced (choice + count); maneuvers and Agonizing Blast enforced in combat, metamagic spend via its counter, remaining effects guidance | `srd/options.ts`, `dm/pc-attack.ts` |
| Subclass spell lists (domain, circle, oath, patron) | enforced | `srd/features.ts subclassSpellsFor`, granted at creation and level-up |
| Wild Shape (full engine: authored beast table, CR/movement caps by druid level incl. Moon, stat swap, natural attacks, beast AC vs enemies, casting gate) | enforced | `srd/beast-forms.ts`, `dm/resource-tools.ts`, `srd/index.ts computeSheetDerived` |
| Polymorph (form via cast_buff variant, CR <= target level, concentration-linked, damage reverts) | enforced | `dm/cast-tools.ts`, `srd/beast-forms.ts`, `dm/condition-tick.ts` |
| Familiars, Beast Master companions, Drakewarden drakes, story pets | enforced | `dm/pet-tools.ts` (summon validation, pet_attack dice, damage_pet pool, long-rest heal) |
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
| Encumbrance | enforced when the `encumbrance` variant rule is on | speed via `srd/index.ts speedFor`, disadvantage via `dm/rolls.ts` and `dm/pc-attack.ts` |

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
| Suffocation / drowning | enforced | `dm/hazard-tools.ts apply_hazard` (CON-derived survival, drop to 0 HP) |
| Extreme cold / heat (hourly CON save or exhaustion; fitting resistance negates) | enforced | `dm/hazard-tools.ts apply_hazard` extreme_cold/extreme_heat |
| Object durability (object AC + HP by size) | enforced | `srd/objects.ts`, `dm/world-tools.ts damage_object` |
| Treasure by CR (individual + hoard tables) | enforced | `srd/treasure.ts`, `dm/world-tools.ts roll_treasure` |

## The long tail

Of 182 SRD class-feature names, 51 have real server mechanics (22 typed
effects + 29 resource counters); the rest are guidance-only by design:

The authored subclass layer adds 105 subclasses and 533 more feature names on
top of that. Their coverage now has three tiers: typed effects parsed straight
from the rules text at load (`feature-effects.ts parseFeatureEffects`: the
Divine Strike family's riders, always-on resistances, magical attacks), a
counter in `src/lib/srd/authored-resources.json` (122 rows, 39 with typed
`fx` payloads the spend executes), or a line of rules text the DM prompt
appends to the sheet, so the model is never handed a feature name it has to
guess at. `scripts/test-feature-coverage.mjs` enforces all of it, including
the ratchet that refuses a counter whose wording states dice but whose spend
executes nothing.

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
| Ammunition (default off) | Assumed supplied unless a table asks for it. The `ammunition` variant rule turns on real tracking: a shot spends a round, an empty quiver refuses the attack, and half the spend comes back after the fight. |
| Item weights the source never printed | The content pack carries a weight for every row Open5e gives one (all 68 weapons, 258 of 338 gear entries); armor comes from the SRD table in `srd/armor.ts` because Open5e ships it blank, and magic items have no weight anywhere. An item nothing can weigh is reported as UNWEIGHED rather than counted as zero, so a carried total with unknowns in it reads as a floor. |
| Non-parseable magic items | Items whose effect is prose the generator cannot parse (roughly 1500 of 1618) stay narrative, exactly like the feature long tail. |
| PC opportunity attack ending an encounter | It applies damage directly (no DM turn to award XP); a killing blow is reported and the model ends the fight next turn. |
| Metamagic effects (Twinned targeting, Careful exclusions) | The sorcery-point spend is a real counter; the shaping is targeting logic the model narrates. |

## Multiclassing (enforced)

| Rule | Where |
|---|---|
| Ability prerequisites, both directions (PHB), cap 3 classes | `src/lib/srd/multiclass.ts canMulticlassInto`, validated server-side in the sheet PATCH route |
| Custom-class prerequisites (13 in casting ability, else first save ability) | `multiclassPrereq` |
| Second-class proficiency grants (never saves; custom classes cap at medium armor) | `multiclassGrantsFor`, applied server-side in `buildMulticlassLevelUp` |
| Per-class feature grants at each class's own level, tagged with `classId` | `src/lib/srd/features.ts populateFeaturesForClasses` |
| Level-scaled features read the granting class's level (Sneak Attack, Martial Arts, Brutal Critical...) | `src/lib/srd/feature-effects.ts combatRiders` |
| Class resources sized by the owning class's level (Ki = monk level, Rage uses = barbarian level, recovery pools) | `src/lib/srd/class-resources.ts` (`classIds` on defs, `resourceLevel`) |
| One Unarmored Defense: acquisition order picks the formula | `src/lib/srd/armor.ts unarmoredFormulaFor` |
| Shared multiclass spell-slot table (full + half floor + artificer ceil; warlock excluded) | `src/lib/srd/multiclass.ts casterLevelFor/multiclassSlots/slotTableFor` |
| Per-class casting: each caster keeps its own ability, lists, and save DC | `spellcasting.casters[]`; `src/lib/srd/index.ts spellSaveDcFor/spellAttackFor` |
| Pact Magic apart from the shared pool; short-rest refill of pact only | `spellcasting.pact`; `rest-logic.ts`, pact-first spend in `mutations.ts use_spell_slot` |
| Per-class hit-die pools; long-rest recovery and short-rest spends biggest die first | `hitDicePools`; `rest-logic.ts recoverPools/shortRestDicePlan`, mirror sync in `db/sheets.ts` |
| Level-up flow: class step with prereq gating, per-class HP die, subclass/expertise/spells at class levels | `LevelUpDialog.tsx` + server validation in the sheet PATCH route |
| Library round-trip: multiclass sync-back, lower-level instantiation strips the last class first | `db/characters.ts` |

Kept simplifications: ASIs stay at character-level thresholds (4/8/12/16/19, the
pre-existing simplification); the lead edits multiclass sheets through the
scalar class/subclass/level fields, which fold into the primary class entry;
characters are always created single-class (multiclassing happens at level-up).

## Cross-cutting engines (Phase 8)

| Subsystem | State | Where |
|---|---|---|
| Active effects: lasting modifiers with duration, source and save-to-end | enforced | `dm/effects-logic.ts`, `db/active-effects.ts` |
| Effect stacking: adds sum, largest override wins, advantage never stacks | enforced | `dm/effects-logic.ts resolveField` |
| Effects applied to AC | enforced | `dm/encounter-tools.ts acWithEffects` |
| Effects applied to saves, checks and initiative | enforced | `dm/rolls.ts` extras, `dm/effect-tools.ts rollEffectExtras` |
| In-world calendar, date and time of day | enforced | `dm/calendar.ts`, `db/clock.ts` |
| Rest length by variant (standard, gritty realism, heroic) | enforced | `dm/calendar.ts restMinutes`, `dm/rest-tools.ts` |
| Time advancing on travel, rests and `pass_time` | enforced | `db/clock.ts advanceClock` |
| Party entity: common purse, shared pack, banked XP, marching order | enforced | `dm/party-logic.ts`, `dm/party-tools.ts` |
| Multi-denomination currency (cp/sp/ep/gp/pp), parsing and formatting | enforced | `srd/currency.ts` |
| Unidentified items and the DM reveal | enforced | `schemas/sheet.ts`, `dm/mutation-math.ts revealItemMath` |
| Mounted combat: size rule, mount speed, mounting cost, thrown-rider save | enforced | `srd/mounts.ts`, `dm/mount-tools.ts` |
| Vehicles: speed, capacity, crew, undercrewed penalty | guidance | `srd/mounts.ts` (the undercrewed halving is ODM's own, not SRD) |
| Structured non-combat scenes: successes before failures, per-round checks | enforced | `dm/scene-tracker-logic.ts`, `dm/scene-tools.ts` |
| Freeform typed attributes on NPCs, items, locations, factions and props | enforced | `dm/attributes-logic.ts`, `db/entity-attributes.ts` |
| Assistant DM seat: full in-game powers, cannot re-seat the DM | enforced | `dm/viewer.ts isPrimaryDm`, `/dm/seat` |

## The stage and the binder (phases 16 to 21)

| Subsystem | State | Where |
|---|---|---|
| Weather: rolled per climate with persistence, riders on Perception (passive -5 in fog and heavy rain), ranged attacks past six tiles in a gale, travel pace and exposure hazards | enforced | `srd/weather.ts`, `dm/sky.ts`, `dm/check-tools.ts`, `dm/world-tools.ts` |
| Hour lights the map: outdoor ambient follows the clock and the sky; indoors keeps its own light | enforced | `battlemap/daylight.ts`, `battlemap/view.ts` |
| Senses in the light model: darkvision, blindsight, tremorsense, truesight, Devil's Sight, magical darkness | enforced | `srd/senses.ts`, `battlemap/los.ts` |
| Terrain wall (low wall): blocks movement, half cover across it, a flier may hover over it | enforced | `battlemap/types.ts`, `battlemap/los.ts coverBetween`, `battlemap/movement.ts` |
| Footprints and movement modes: large creatures occupy their squares, fliers and burrowers ignore what they should | enforced | `battlemap/footprint.ts`, `battlemap/movement.ts`, `dm/map-tools.ts` |
| Teleport: range, walls, occupancy, the door and the effect that follow | enforced | `dm/map-tools.ts handleTeleportToken` |
| Auras: Aura of Protection and effect auras drawn and applied within their radius | enforced | `dm/effects-logic.ts`, `battlemap/view.ts tokenAuras` |
| Lore audiences: an entry for some players opens only for them; secret blocks never cross the wire to a player | enforced | `dm/world-lore-logic.ts loreVisibleTo, stripSecretBlocks`, `/lore` |
| Show this now: the model may show only party-readable entries; a person may show any | enforced | `dm/binder-tools.ts handleShowHandout` |
| Sourcebook PDFs: a rules-tagged attachment is chunked into retrieval beside the house rules | enforced | `dm/lore-attachments.ts`, `pdf/text.ts`, `db/rules.ts replaceSourceChunks` |
| Quests by hand: objectives ticked by the DM or the model, arc sub-arcs mirrored, DM-only rows kept out of a player's log | enforced | `dm/quest-logic.ts`, `db/quests.ts`, `dm/binder-tools.ts` |
| Inline rolls in handouts and house rules: `[[1d6]]` rolls through the public rolls route | enforced | `components/ui/Markdown.tsx RollChip`, `/rolls` |

## Voices, tone, combat depth, factions and time (phases 22 to 25)

| Subsystem | State | Where |
|---|---|---|
| Speech attribution: quoted lines are matched to the cast conservatively; unmatched lines stay the narrator's | enforced | `dm/speech.ts attributeSpeech`, `dm/tts-segments.ts` |
| Per-NPC voices: a cast member's voice reads their lines, the narrator's voice the rest | enforced | `dm/tts.ts castVoices`, `db/npcs.ts voice_json` |
| Lines and veils: a line stops the model before it writes; a veil asks it to cut away; both feed the image negatives | enforced | `dm/safety-logic.ts lineViolations, boundaryNegativeTerms`, `dm/narration-guard.ts` |
| X-card: the queue pauses, the last narration is withdrawn, rewound or rerolled | enforced | `dm/safety.ts`, `dm/queue.ts`, `/safety/x-card`, `/safety/resume` |
| Strictness: lenient, by the book and harsh shift every difficulty DC by two steps; tone biases reactions and the ambience bed | enforced | `srd/dc.ts dcForDifficulty`, `dm/safety-logic.ts strictnessShift, reactionBias, toneBedBias` |
| Legendary actions: pools from the stat block's traits, spent by the model or the DM, refilled at the start of the creature's turn | enforced | `dm/legendary-logic.ts`, `dm/legendary-tools.ts`, `dm/encounter-tools.ts advancePointer` |
| Legendary resistance: a failed save against a condition is turned automatically while charges remain | enforced | `dm/legendary-tools.ts autoLegendaryResistance`, `dm/cast-tools.ts` |
| Lair actions on initiative count 20 | enforced | `dm/encounter-tools.ts` (wrap note), `dm/legendary-tools.ts handleLairAction` |
| Fight summary: damage dealt and taken, kills, healing, the deciding roll, at the end of every fight | enforced | `dm/encounter-summary.ts`, `dm/enemy-damage.ts finishEncounter` |
| Factions: the party's standing per faction bends a member's social DC one point per step; goals advance on the chapter tick and power drifts; an arc that names a faction moves its power | enforced | `dm/faction-logic.ts`, `dm/faction-tools.ts`, `dm/social-tools.ts`, `dm/chapter-close.ts`, `dm/world-tick.ts` |
| Calendar: months, weekdays, moons and festivals written by hand or shipped by a world pack; the prompt says the day of the fair and the full moon | enforced | `dm/calendar.ts moonPhase, festivalsOn, describeInstant`, `dm/calendar-schema.ts`, `worlds/types.ts calendar` |
| Calendar events: a party event the clock crosses becomes a fact and a title card, a DM-only one a fact the DM seat reads; yearly and monthly repeats | enforced | `db/calendar-events.ts`, `dm/calendar-fire.ts`, `db/clock.ts advanceClock` |
| Torch timers: a torch burns an hour, a lantern six, everburning things do not; the clock puts them out and the board gutters the light | enforced | `dm/light-timers.ts`, `db/battle-maps.ts expireBurntLights`, `battlemap/view.ts light` |

## Commerce, generators, the room and the prompt (phases 26 to 30)

| Subsystem | State | Where |
|---|---|---|
| Shops: stock from the content pack's costs at the settlement's markup; the purse and the shelf clamp every purchase; the keeper buys at half; restock comes due by the clock | enforced | `dm/shop-logic.ts`, `dm/shop-tools.ts`, `db/shops.ts`, `/shops` |
| Haggling: a Persuasion check against the settlement's DC moves every price in that shop one step, once per character | enforced | `dm/shop-logic.ts haggleStep, haggleDc`, `dm/shop-tools.ts handleHaggle` |
| Player-to-player trade: an offer is checked against both packs and purses when made and again when accepted; both sheets move in one transaction with an audit row each | enforced | `dm/trade-logic.ts`, `dm/trade.ts`, `/item-proposals` |
| Several characters per player: the seat marks the one in play; with one active at a time the others wait out fights and the map | enforced | `db/sheets.ts getSheetForUser`, `dm/roster.ts fieldedSheets`, `/sheet/switch` |
| Settlement generator: seeded people, shops, rumours and a hook for a place; fired by the DM tool, the places list, or arrival somewhere unwritten with the world simulation on | enforced | `overworld/settlement.ts`, `dm/settlement.ts`, `dm/settlement-tools.ts` |
| Watabou imports: a One Page Dungeon becomes walls, doors and DM labels; a city export becomes roads, a river and district names around its place | enforced | `battlemap/watabou.ts`, `dm/map-library.ts`, `/overworld/import` |
| Prepared worlds in the registry: a bundle listed beside the packs installs as a workshop of the installing admin's | enforced | `worlds/types.ts registryBundleSchema`, `worlds/install.ts installBundleFromUrl` |
| Transcription: each speaker's rings are written down with their name and both clocks; the beat drafter and the chapter close read them; the prompt never does | enforced | `voice/transcript.ts`, `db/voice-transcript.ts`, `stt.ts`, `dm/beats.ts`, `dm/chapter-close.ts` |
| Dual-track recap: the party's card from what the party may know; a human DM's whisper adds the secrets and the arcs | enforced | `dm/recap-logic.ts`, `dm/recap.ts` |
| Prompt sections with floors: the lines never drop, the sky, factions, quests and the open shop each hold their slice, and the engine boundary owns the weather, faction standing and shop prices | enforced | `dm/context-budget.ts SECTION_SHARES`, `dm/engine-boundary.ts`, `dm/prompt.ts` |
