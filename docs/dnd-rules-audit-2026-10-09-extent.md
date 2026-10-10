# D&D rules audit 2026-10-09: extent of each gap

Companion to [dnd-rules-audit-2026-10-09.md](dnd-rules-audit-2026-10-09.md). The audit names 29 findings, mostly from one reproduction each. This document maps how far each one reaches (every code path, spell, monster and route with the same defect), names the shared root causes a complete fix has to address, and lists related gaps the audit did not record.

Same head as the audit: **9af14897**, version 0.25.0. No application code, tests or configuration were changed. Evidence comes from three kinds of work:

- **Static tracing** of every call site of the functions each finding names (file:line references below).
- **Runtime probes**: three batches run against scratch databases through the same `scripts/lib/enforce-world.mjs` and `enforce-spell-kit.mjs` harness the enforcement suites use, with forced dice. AI-actor calls use `invokeAsAi` (a real AI DM turn). Items marked **probed** were reproduced this way.
- **Data scans** over the installed content pack: all 319 SRD spells (durations, mechanic blocks, priced materials) and all 322 SRD monster rows (trait names, attack riders, condition durations).

Probe and scan scripts were disposable (outside the repository). Each probed item below gives the call sequence, so it can become a `gap()` in the enforcement suites before its fix.

## Fix status (branch `rules-audit-fixes`, 2026-10-09)

All eleven workstreams below are implemented on the branch. Each is held by a suite that reads stored rows with forced dice; the full suite, lint and a production build pass.

| Workstream | Findings | What changed | Held by |
| --- | --- | --- | --- |
| 1. Saves (R1) | F01 to F04, N04, N09, N13, N14, N21 | Death, concentration and repeat saves use the shared save builder (Bless, Bane, exhaustion, Lucky, aura). A death save keeps its natural 1 and 20 apart from the total. Every stabilize route resets both counts. | `test-enforce-save-pipelines.mjs` |
| 2. Lifetimes (R2) | F05 to F07, F20, N01, N02, N08, N18 | Per-source condition instances, a duration kept alongside a repeat save, end-of-turn saves, turn-anchored expiry, a concentration clock, monster durations parsed from the block. | `test-enforce-condition-lifetimes.mjs`, `test-enforce-conditions-duration.mjs` |
| 3. Derived bonuses (R3) | F08, N03 | Aid's maximum HP follows the strongest active casting and leaves with it on every removal route. | `test-enforce-condition-lifetimes.mjs` |
| 4. Settlement (R4) | F14, F15 (settlement), F19, N11, N17 | Legendary Resistance settles the failed save it answers; Evasion applies through one helper, auto-fail included; the Arcane Ward absorbs before resistances. | `test-enforce-save-pipelines.mjs` |
| 5. Events (R6) | F15 (choice), F16, F26, F28, N06, N10, N16 | Shield and Absorb Elements need their trigger; Counterspell is a pending choice, monsters' included; legendary actions are one per completed turn; the lair acts at count 20 with its printed options, never the same one twice running. | `test-enforce-reaction-triggers.mjs`, `test-legendary.mjs` |
| 6. AI boundary (R5) | F17 | `ai-gate.ts`: damage and healing take server dice or an unspent server total; binding conditions only after a server save. The console keeps its free hand. | `test-enforce-ai-gates.mjs` |
| 7. Geometry (R9) | F13, N05 | `aoe-shape.ts`: one placement of the sphere, cube, cone or line, with its origin in range. | `test-enforce-area-shapes.mjs` |
| 8. Materials (R10) | F09, F10, N12, F18 (corpses) | `cast-materials.ts`: priced and per-unit components, a focus or pouch for unpriced ones, purchases from the purse only out of a fight. | `test-cast-rules.mjs` |
| 9. Monsters (R7) | F18 (control), F21, F22, N19 | `monster-traits.ts`: absorption, Immutable Form, Limited Magic Immunity, Martial Advantage, Life Drain; every unread trait is listed "By hand" for the DM; Animate Dead's control runs out or is reasserted. | `test-enforce-monster-trait-rules.mjs` |
| 10. Legality (R8) | F23 to F25, N15, N20 | Thieves'-tools expertise, the artificer's attunement slots, owed choices on the sheet, a subclass spell at its own class's DC. | `test-enforce-character-choices.mjs` |
| 11. Spells and labels | F11, F12, F27, F29, N07 | A ritual is cast only through a ritual caster's own hold or the ritual book, at that owner's DC. A reaction spell on the caster's own turn counts toward the bonus action spell rule. Quickened Spell is a `use_resource` spend (2 points) that charges the next one-action spell to the bonus action. `spell-support.ts` names what the server leaves to the DM for 28 spells, on the spell book's tiles and in the cast's result. `gap()` counts only a failed assertion as an open gap. | `test-cast-rules.mjs`, `test-enforce-casting-limits.mjs`, `test-enforce-character-choices.mjs` |

Corrections to this document found while fixing:

- The earthquake zone's fissures (`zone-quake`) are a DEX save to avoid falling, not save-for-half damage, so Evasion has nothing to halve there.
- The Projected Ward path already takes the raw damage before the warded creature's resistances.
- An enemy's end-of-turn save is rolled on the pointer move after the one that hands it its turn, because that turn is played in the DM turn between the two moves. The save count per round is still one.

Also fixed on the way: the content pack stores a spell's concentration and ritual flags as the words "yes" and "no", and `spellSummary` (`help/index.ts`) read both as true, so every spell's info line in the spell book said "concentration · ritual" (F29's overstated support information).

Still the DM's by design, and labelled as such: the spells in `spell-support.ts` (partly by hand or narrated) and the monster traits `manualTraits` lists.

## Shared root causes

Most findings are symptoms of ten structural causes. A fix that patches only the reproduced symptom leaves the siblings broken. Fixing at the root closes everything mapped to that root.

| Root | Cause | Findings it produces |
| --- | --- | --- |
| R1 | Saving throws are built in six places. Only `rollCharacterSave` / `resolveRollExpression` (PC) and `rollEnemySave` (enemy) apply the full rider set. | F02, F03, F04, N04, N09 |
| R2 | Condition storage is `conditions: string[]` plus **one** `conditionMeta` entry per name. Durations are a single `rounds` counter capped at 14,400 by the schema. `saveEnds` and `rounds` are mutually exclusive in `spellConditionMeta`, and every counter ticks at the round wrap. Concentration has no clock of its own. | F05, F06, F07, F20, N01, N08 |
| R3 | Effects write derived numbers into stored fields (Aid's +HP into `maxHp`). The give-back only runs on three of the removal routes. | F08 |
| R4 | Resolution order: a save outcome is settled after damage has landed, auto-fail branches return early, and the ward runs after the wizard's defenses. | F14, F15, F19 |
| R5 | The AI can reach raw state routes (damage, heal, conditions) that need no attack, spell or hazard record. | F17 and its extension |
| R6 | There is no pending-event model, so triggers are not validated: reactions, Counterspell, Legendary Resistance and legendary or lair opportunities. | F15, F16, F26, F28, N06, N10 |
| R7 | The monster parser keeps only what its regexes catch, and nothing marks the rest as manual. | F21, F22, N08 |
| R8 | Legality checks upper bounds only, and expertise is modelled as skills only. | F23, F24 |
| R9 | Area targeting checks range from the caster, not membership in one shape. | F13 |
| R10 | Material components are one gp number plus one consumed flag. | F09, F10 |

## Per-finding extent

Each entry gives the **audit's case**, the **full extent** found here, and what a **complete fix** must cover. "Probed" means reproduced this session; "static" means read from code.

### F01: stabilization keeps old death-save failures (R2-adjacent bookkeeping)

- **Audit's case:** third success via `applyDeathSaveRoll` keeps the failures.
- **Extent:** a second stabilization path has the same defect. `stabilize.ts:246` (Medicine check, Spare the Dying, a healer's kit without the Healer feat) writes `{ ...track, stable: true }`, keeping both counters. Only the Healer-feat branch (`stabilize.ts:230`) resets. `onDamageAtZero` then adds to the stale count. Static.
- **Complete fix:** every route that makes a creature stable writes `{ successes: 0, failures: 0, stable: true }`: death saves, `stabilize.ts` in all three methods, and any future feature. Test both stabilize paths followed by damage at 0.

### F02: death saves skip the save pipeline (R1)

- **Audit's case:** Bless's d4 is not added.
- **Extent (probed):** a halfling with Lucky who rolls a natural 1 on a death save takes two failures, and no reroll happens (`death.ts:271` builds `d20Expression(0, advantage)` alone). Also missing, static: Aura of Protection (`allySaveAura`), lasting save effects (`rollEffectExtras`), item save bonuses, Bardic Inspiration and other held dice, luck points, and the Bane penalty.
- **Precondition for the fix:** `applyDeathSaveRoll(track, natural)` receives `outcome.total` (`death.ts` after the roll). Today total equals natural only because no modifier exists. Once modifiers are added, natural 1, natural 20 and the 10+ threshold must read different numbers: pass both `natural` and `total`.
- **Complete fix:** route death saves through `resolveRollExpression` with a "death" ability that has no modifier, keeping exhaustion, Beacon of Hope and Diehard (already present).

### F03: concentration saves skip exhaustion (R1)

- **Audit's case:** exhaustion 3 disadvantage is missing.
- **Extent (probed):** Halfling Lucky is also missing; a natural 1 broke Fly concentration with no reroll. Static: `concentrationDamageHook` (`concentration.ts:280-291`) includes the aura, Bless/Bane riders, War Caster and the Starry Form floor. It omits exhaustion, lasting effects (`rollEffectExtras`), Bardic Inspiration and other held dice, luck points, Diamond Soul's reroll, and authored roll riders.
- **Complete fix:** one PC save builder used by `concentrationDamageHook`, with War Caster, Battle Caster and the d20 floor as inputs to it rather than a parallel expression.

### F04: condition repeat saves skip Bless (R1)

- **Audit's case:** Bless is missing.
- **Extent (probed):** Halfling Lucky is also missing (a natural 1 left poisoned in place). Static: `tickSheetConditions` (`condition-tick.ts:399-411`) includes the aura, trait advantages and exhaustion. It omits `conditionRollRiders` (Bless, Bane, Resistance), lasting effects, held dice, luck points, Diehard and Shield Master, `authoredSaveDieVs`, and the condition derivation itself (a restrained creature's DEX repeat save should be at disadvantage).
- **Complete fix:** repeat saves call `rollCharacterSave`. The enemy branch already calls `rollEnemySave` (`condition-tick.ts:317`).

### F05: Hold Person never expires (R2)

- **Audit's case:** Hold Person.
- **Extent (scan):** every SRD spell whose condition is save-ends and also has a duration loses its cap. That is six spells: **Blindness/Deafness, Confusion, Hideous Laughter, Hold Monster, Hold Person, Slow**. All four placement routes share the defect because they all build metadata through `spellConditionMeta` (`spell-effects.ts:46`): `cast_at_enemy` (`cast-at-enemy.ts:435`), `aoe_damage` (`aoe-damage.ts:339`), an enemy's spell on a PC (`cast-at-player.ts:124`) and the spell pool (`spell-pool.ts:114`). The concentration side never ends either (see N01), so the caster keeps concentrating.
- **Not affected:** monster riders on PCs keep both (`enemy-hit.ts:174-176` sends `rounds` and `saveAbility`).
- **Complete fix:** store a maximum lifetime independently of the repeat save (rounds plus saveEnds together), and give concentration its own expiry.

### F06: repeat saves happen at the round wrap (R2)

- **Audit's case:** ordinary save-ends conditions.
- **Extent (static):** `tickEncounterConditions` (`condition-tick.ts:58`, called once from `encounter-tools.ts:1288` at the wrap) ticks every timed counter as well as every save-ends condition, for enemies (`tickEnemyConditions`) and PCs (`tickSheetConditions`). So **plain durations** also end at the wrap rather than at the initiative point where they began: Bless, Haste, Shield of Faith, a monster's "poisoned for 1 minute". Only conditions with `untilTurnOf`/`untilTurnEndOf` and the `turnEnd` spells (`spell-turn-end.ts`) follow turns.
- **Complete fix:** an end-of-turn hook per creature for save-ends, and a "started on round R at initiative I" stamp so counters expire at the right turn. Out of combat, the one-save-per-clock-jump simplification (`condition-tick.ts:84-89`) should stay explicit and be bounded by the F05 maximum lifetime.

### F07: two sources of one condition collapse (R2)

- **Audit's case:** breaking A's concentration ends paralysis while B still concentrates.
- **Extent (probed, new consequence):** the collapse also **ends the second caster's spell immediately**. Two wizards cast Hold Person on one goblin and both slots are spent. The goblin records only A's metadata, so the next `endSpentConcentration` pass (`concentration-upkeep.ts`) finds nothing held by B and ends B's concentration: "Hero 2 is no longer concentrating on Hold Person (the spell has ended)." It runs after every tick that changes anything.
- **Every writer that keys one entry per name (static):** `laySpellConditionsOnEnemy` (skips names already held), `handleSetCondition` via `longerInstance` (`set-condition.ts:77`, keeps one), area conditions (`layAreaConditions`), monster riders through `set_condition`, `set_enemy_condition`, and grapples by two creatures. Removal is per name as well: `removeConditions`, `pruneMeta` and `clearSpellConditionsByName`.
- **Complete fix:** a per-instance condition model (name, source, spell, lifetime) with benefits de-duplicated at read time. Concentration upkeep and every remover must address instances, not names.

### F08: repeated Aid leaves permanent maximum HP (R3)

- **Audit's case:** two same-slot casts give 35, then 40.
- **Extent (probed):**
  - **Different slots stack.** Aid at 2nd then 3rd level: 30 → **45**, holding both `aided (+5)` and `aided (+10)`, because the amount is part of the condition name.
  - **`clear_condition` never gives the HP back.** Clearing "aided" removed both conditions and left max HP at **45 permanently** (`mutations.ts:1267-1269` prunes without `spellEndPatch`). `spellEndPatch` runs only from `condition-tick.ts:459`, `concentration.ts:197` and `dispel.ts:190`.
  - Heroes' Feast has the same shape: every casting rolls a new amount, giving a new name and a new stack (`cast-buff.ts:314`, `concentration.ts:240`).
- **Other removal routes to cover:** a full `update_sheet` replacement (`pruneMeta`), rest logic, and the lead's sheet edit.
- **Complete fix:** do not write the bonus into `maxHp`. Derive it at read time from the active instances, taking the strongest per spell, as `effectiveMaxHp` already does for exhaustion and an Amulet of Health. That removes the give-back problem from every route at once.

### F09: costly materials accept unpriced names and flatten components (R10)

- **Audit's case:** Revivify accepts an unpriced "Diamond"; Clone flattens.
- **Extent (scan of all 52 priced SRD materials through `materialCostFrom`):** nine parse wrong.

  | Spell | Parsed | Printed |
  | --- | --- | --- |
  | Clone | 3,000 gp, consumed | 1,000 gp consumed plus a 2,000 gp vessel kept |
  | Astral Projection | 1,100 gp | 1,100 gp **per creature** |
  | Create Undead | 150 gp | 150 gp **per corpse** (3 to 6 by slot) |
  | Imprisonment | 500 gp | 500 gp **per Hit Die** of the target |
  | Legend Lore | 50 gp, consumed | 250 gp incense consumed plus 4 × 50 gp ivory kept (the pack row also misprints "250 inches") |
  | Magnificent Mansion | 5 gp | three items of 5 gp each |
  | Warding Bond | 50 gp | a pair of rings, 50 gp **each** |
  | Secret Chest | 5,050 gp | a 5,000 gp chest plus a 50 gp replica (two items) |
  | Simulacrum | 1,500 gp, consumed | correct total; ruby dust consumed, snow and hair not priced |

- **Plus:** `materialPlan` (`cast-rules.ts:229`) treats any inventory line whose name contains a material word as worth the full price (`value === null ? words.length > 0`), and it substitutes a purse payment anywhere, including mid-fight.
- **Complete fix:** components as a list of `{ what, gp, per?: "creature" | "corpse" | "hit die", count, consumed }`, with a value read from the item (or the catalog), not its name. Decide and document where buying from the purse is allowed.

### F10: material access and War Caster (R10)

- **Extent (static):** `componentProblem` (`cast-rules.ts:170`) only refuses when both hands are full. No route checks for a focus, a component pouch, or zero-cost materials. The same helper serves the board's Hand UI (`battlemap/hand-spells.ts`, `hand-react.ts`), so the UI shares the gap. Item casts (scrolls, wands) are correctly exempt and should stay so.
- **Complete fix:** separate V, S and M checks. M needs a focus, a pouch or the item, and a hand (the same hand may do S and M). War Caster relaxes only S. Clerics and paladins keep the emblem rule.

### F11: ritual permission detached from the owning class

- **Extent (static):** `ritualProblem` asks `canCastRituals` (any class, Ritual Caster or Book of Ancient Secrets) while `spellHeldProblem` accepts the spell from **any** caster record (`cast-rules.ts:85-123`). Every multiclass combining a ritual caster (bard, cleric, druid, wizard) with a non-ritual caster (sorcerer, warlock without the invocation, paladin, ranger) can ritual-cast the second class's spells. Book of Ancient Secrets makes any warlock-known ritual castable as a ritual, though the invocation only covers the book.
- **Related, static:** `spellSaveDcFor` and `spellAttackFor` (`srd/index.ts:532-592`) find the owning class only among known, prepared and cantrip lists. Subclass always-prepared spells (domain, oath, circle) fall back to the sheet's primary ability on a multiclass sheet.
- **Complete fix:** resolve `{ class record, ritual rule }` together: a wizard's book, the cleric or druid prepared list, the bard known list, or the Ritual Caster book. Use the same owner for DC and attack.

### F12: own-turn reaction spells evade the bonus-action spell rule

- **Extent (static):** `turnCharge` returns `{ kind: "reaction" }` before any mark is written, and the bonus-spell checks only look at `LEVELLED_SPELL`/`BONUS_SPELL` (`cast-rules.ts:409-470`). Related: **Quickened Spell is not modelled** (no "quicken" anywhere in `src/lib/dm`). A quickened spell is charged as an action and never sets `BONUS_SPELL`, so the rule is both over-permissive (reaction route) and under-permissive (a legal quickened spell plus cantrip is refused).
- **Complete fix:** a per-turn spell ledger (casting time, levelled or not, how it was cast) consulted for bonus, action and own-turn reaction spells. Quickened Spell sets the bonus-action casting time.

### F13: area spells accept targets outside one shape (R9)

- **Audit's case:** Fireball (sphere) on targets 100 ft apart.
- **Extent (probed):** cones and lines fail the same way. Burning Hands (15-ft cone) hit creatures on **opposite sides** of the caster, and Lightning Bolt (100-ft line) hit creatures 20 ft away in **opposite directions**. `planAoeSpell` (`aoe-spell.ts:61`) checks reach per target only. Cubes and cylinders (Thunderwave, Flame Strike, Ice Storm) use the same planner. Enemy area abilities (breath weapons, through `aoe_damage` with `casterEnemyId`) are the same route.
- **Complete fix:** declare origin, center or direction and derive membership per shape. Theatre of mind stays an explicit abstraction.

### F14: automatic save failure skips Evasion (R4)

- **Extent (static):**
  - In the auto-fail branch, `aoe-characters.ts:63-96` applies full damage, skips Evasion, and **skips laying the spell's conditions** (an ally caught in a Slow while paralyzed is not slowed).
  - **Zone triggers never apply Evasion at all.** `zone-triggers.ts:180-196` (Wall of Fire, Incendiary Cloud, Flaming Sphere and other DEX-half zones) and `zone-quake.ts:103,192` (Earthquake fissures) halve on a success and deal full damage on a failure for rogues and monks too.
  - Correct today: `cast-at-player.ts:308` and `aoe-characters.ts:112`.
- **Complete fix:** one damage-from-save settlement used by aoe, cast_at_player, zones and hazards, taking `{ success, autoFailed }` and applying Evasion, conditions and riders in every branch.

### F15: Legendary Resistance does not correct a resolved save (R4, R6)

- **Extent (static count):** automatic Legendary Resistance is consulted in **2 of the 26 modules** that roll enemy saves (`cast-at-enemy.ts:426`, `enemy-polymorph.ts:146`). The other 24 never offer it: area conditions, zone triggers, spell riders, auras, Prismatic Spray/Wall, Stunning Strike and other on-hit riders, feature spends, authored features, condition repeat saves, Battle Master maneuvers.
- **Probed:**
  - **Area conditions ignore it.** Hypnotic Pattern laid charmed and incapacitated on a creature with three resistances; the pool stayed 3.
  - **Where it fires, damage is not undone and minor riders burn it.** Vicious Mockery: the save die was 1, the resistance was spent (3 → 2) and the save "became a success", yet the damage still landed (90 → 82). The cantrip deals nothing on a success. The condition branch runs after damage (`cast-at-enemy.ts:417-431`), and `binds` treats a one-turn disadvantage rider as worth a Legendary Resistance.
- **Manual tool (audit):** spends without a pending failed save, with no settlement.
- **Complete fix:** a pending failed-save record per enemy save. The creature (AI or DM) chooses to spend, the engine re-settles damage, conditions and riders as a success, and each record can be spent once.

### F16: Counterspell without a casting (R6)

- **Extent (static):** `checkCounterspell` (`reaction-spells.ts:210`) also:
  - falls back to a global spell lookup (`spellFactsFor`) when the monster lacks the spell;
  - never consumes the countered creature's slot or X/day use, although the spell is still expended;
  - always spends the creature's **action**, even when the countered spell was a bonus action or a legendary cantrip;
  - checks neither sight nor Subtle Spell;
  - uses the sheet's primary casting ability for the check rather than the class that holds Counterspell.
- **Symmetric gap (N06):** enemies cannot cast Counterspell or Shield as reactions at all. `enemy-reactions.ts` implements Parry only, so the SRD Mage, Archmage and Lich never use their printed reaction spells.
- **Complete fix:** enemy casts become pending events: declared, open for reactions, then resolved. Counterspell binds to one, consumes the enemy's slot or use, and charges the correct action type. The same event model lets monsters react to PC casts.

### F17: AI damage dispatch bypasses attack enforcement (R5)

- **Audit's case:** `split_damage`.
- **Extent (probed, all under a real AI DM turn, all accepted):**

  | Route | What the AI did |
  | --- | --- |
  | `apply_damage` | 7 damage to a PC "from a goblin's scimitar" with no attack: 30 → 23 |
  | `set_condition` | paralyzed a PC for 10 rounds with no save |
  | `clear_condition` | cleared an enemy's Hold Person paralysis from a PC with no save |
  | `set_enemy_condition` | stunned an enemy for 10 rounds with no save |
  | `heal` | +15 HP with no spell, potion or feature |
  | `damage_enemy` | 25 damage by labelling it `source: "hazard"` (the only gate is the label, `encounter-tools.ts:780`) |

- **Context:** these routes have legitimate AI uses (traps, falls, story poison, a potion). The fix is a required record, not a ban.
- **Complete fix:** AI-originated HP and condition changes must cite an engine record: a resolved attack, a spell cast, an `apply_hazard` roll, an item use or a rest. Free-form changes stay with the human DM and the party lead. `damage_enemy`'s hazard label needs the same record.

### F18: undead creation modelled as expiring summons

- **Extent (static):** Create Undead shares the row shape (`summon-spells.ts:99`, `rounds: DAY`), so its ghouls, ghasts, wights and mummies also vanish after 24 hours. Neither spell has a corpse input, reassertion of control (recasting to keep up to four, or more by slot), Create Undead's nighttime casting, or the per-corpse onyx (F09 table). Find Steed (`rounds: null`) and Faithful Hound, Unseen Servant and Phantom Steed (timed) are correct as disappearing summons.
- **Complete fix:** a "created creature" kind whose control expires to hostile or independent rather than deletion, with corpse and material inputs and a recast that renews control.

### F19: Arcane Ward uses the wizard's defenses (R4)

- **Extent (static):** `applyPcDamage` calls `damageAdjust` (resistance, **immunity and vulnerability**) before `absorbByWard` (`pc-damage.ts:118-122`). Vulnerability double-drains the ward and immunity means the ward never absorbs. Projected Ward onto an ally runs the same order.
- **Complete fix:** the ward absorbs the raw amount, then the protected creature's resistance, vulnerability and immunity apply to the overflow, then temporary HP, then form HP. The concentration check reads the HP actually lost.

### F20: multi-day durations truncated (R2)

- **Extent (scan and static):** the cap is in three places: the **schema** (`schemas/condition-meta.ts:15`, `rounds` max 14,400), `durationRounds` (`spell-mechanics.ts:148`), and `conditionRoundsFrom` plus `cast-buff.ts` (minutes capped at 1,440). Twenty-one SRD spells have durations beyond one day or "until dispelled". Those that place tracked state today:
  - **Antipathy/Sympathy** (10 days → 1 day)
  - **Contagion** (7 days)
  - **Geas** (30 days, condition with no countdown)
  - **Feebleminded** (Feeblemind: no duration, repeat save every 30 days, not modelled)
  - **Imprisonment** (until dispelled; no countdown is correct)

  The rest are utility today (Arcane Lock, Contingency, Glyph of Warding, Magic Mouth, Sequester, Simulacrum and others) and become affected once modelled.
- **Complete fix:** a lifetime type that holds days and "until dispelled", applied in the schema, set_condition, cast_buff and spell rows. Also slot-scaled durations (Geas at 7th/9th).

### F21: Rakshasa's Limited Magic Immunity (R7)

- **Extent (scan):** Rakshasa is the only SRD monster with spell-level immunity. The same scan found the trait set the engine never reads (see F22). The PC-side counterpart, Globe of Invulnerability, is enforced as a zone (`zone-rules.ts:206-254`), so the immunity model exists and could be shared.
- **Complete fix:** spell-level immunity checked at the target guard for every spell route (attack, save, area, auto, condition, detection), with the creature's opt-in.

### F22: monster snapshots lose rule clauses (R7)

- **Traits (scan):** of **192** distinct trait, reaction and legendary names in the 322 SRD rows, **102 are never named anywhere in `src/lib`**. That is a heuristic (a few such as "keen hearing and sight" are matched by prefix), but it isolates these mechanical ones:
  - **damage and HP:** Lightning/Fire/Acid Absorption (Flesh, Iron, Clay Golems heal instead of taking damage), Damage Transfer (Cloaker, Rug of Smothering), Rejuvenation (Lich, Mummy Lord, nagas), Misty Escape and Vampire Weaknesses, Sunlight Weakness (Shadow), Death Throes and Fire Aura (Balor), Elemental Demise, Heated Weapons/Body, Barbed Hide;
  - **attacks:** Martial Advantage (Hobgoblin), Surprise Attack (Bugbear, Doppelganger), Rampage, Blood Frenzy, Angelic/Hellish Weapons;
  - **saves and turning:** Turn Resistance (Lich), Turn Defiance (Ghast), Dark Devotion, Steadfast, Immutable Form (golems can be polymorphed);
  - **control and area:** Petrifying Gaze, Fear Aura (Pit Fiend), Incorporeal Movement, Amorphous, Web Walker, Antimagic Susceptibility, Reflective Carapace (Tarrasque), Reactive Heads and Multiple Heads (Hydra).
- **Attack riders (scan of 520 SRD attacks with a "Hit:" line):** clauses the parser drops and no other module models:
  - max-HP reduction (Specter, Wight, Wraith Life Drain; Vampire and Vampire Spawn Bite, plus the bite's healing);
  - curses and lycanthropy (Mummy, Mummy Lord, Rakshasa, Lamia, four lycanthropes);
  - disease (Aboleth, Death Dog, Diseased Giant Rat, Otyugh);
  - swallow (Kraken, Purple Worm);
  - the "stable but poisoned and paralyzed at 0 HP" clause (Giant Spider, Giant Centipede, Giant Wasp, Giant Wolf Spider, Phase Spider, Swarm of Centipedes);
  - restrained by web (Ettercap, Giant Spider) and petrification by stages (Cockatrice);
  - Strength drain (Shadow).
- **Durations (N08):** see below.
- **Complete fix:** keep the full source text on the snapshot, add structured models for the recurring families above, and mark unparsed clauses as "manual" in the DM view and the narrator context. Test against the real 322 rows.

### F23: rogue tool expertise refused

- **Extent (static):** also refused **at level-up**. `level-up.ts:428-445` takes skills only, so a rogue's 6th-level expertise in thieves' tools is refused as well. Feat-granted expertise (`feat-grant-text.ts:165`) is skills only, which matches its sources. `useBuilderDerived.ts` and `ClassChoices.tsx` filter the same way.
- **Complete fix:** expertise entries may name a proficient tool where the feature allows it (rogue at 1st and 6th; Artificer's Tool Expertise at 6th per F25), in the judge, level-up, builder, regrant and `toolProficiencyBonus`.

### F24: legality checks upper bounds only (R8)

- **Extent (static):**
  - Creation: `judgeProficiencies` requires tool picks only on the `table` and `library` doors (`sheet-legality.ts:479`). Missing class skill picks, background or race skill picks, expertise and bonus languages are never required on any door.
  - **Level-up has the same shape.** ASIs check `asked.choices.length > owed` (`level-up.ts:273`) with no lower bound, and subclass at the subclass level, expertise at rogue 6 and bard 3 and 10, and new skills are optional. Only spells track `pending` (`level-up.ts:182`).
- **Complete fix:** for every door and for level-up, either require each owed choice or persist it as an explicit pending choice the sheet shows. The `engine` and `stored` doors stay permissive by policy.

### F25: Artificer perks have no mechanics

- **Extent (static):** the three-attunement constant is enforced in three places: `magic-items.ts:311` (`attunementProblem`), `sheet-legality.ts`, and `patchSheet` (`db/sheets.ts`, "a fourth attuned item is held by patchSheet itself"). All three need the Artificer's 4/5/6. Tool Expertise needs F23's tool-expertise model.
- **Complete fix:** attunement capacity as a derived number per sheet, read by all three, plus the F23 model. Otherwise label these features as manual on the sheet.

### F26: Absorb Elements establishes nothing

- **Extent (probed, sibling):** **Shield also casts with no trigger.** `use_reaction` Shield with no attack recorded is accepted, spends a 1st-level slot and applies `shielded` (`reaction-spells.ts:147-168`). Hellish Rebuke and Feather Fall do validate a trigger (`freshLastHit`). The generic fallthrough (`reaction-spells.ts:194-200`) casts any other reaction spell with "its effect is the spell's text".
- **Complete fix:** every reaction spell names its trigger and refuses without one. Absorb Elements writes the resistance instance and a one-shot melee rider scaled by slot.

### F27: narrated spells with mechanical outcomes

- **Extent (scan through the pack-aware resolver, excluding zone and summon engines):**
  - **18 "utility" spells** whose text carries dice, saves, HP or conditions the engine does not apply: Alter Self, Contact Other Plane, Detect Thoughts, Dimension Door, Dream, Forbiddance, Glyph of Warding, Hallow, Light (DEX save on a hostile's object), Magic Circle, Magic Jar, Meld into Stone, Planar Binding, Scrying, Seeming, Teleport, Wish, Zone of Truth.
  - **No general block:** Astral Projection, Awaken, Control Weather, Project Image, Simulacrum, Speak with Plants, Telekinesis, Time Stop, plus Clone and Geas (audit).
  - **Have dedicated engines** (not gaps): Find Familiar, Goodberry, Shield, Spare the Dying.
- **Complete fix:** classify each as engine-resolved, partially manual (named manual parts), or descriptive, and show that label at the decision point (F29).

### F28: legendary and lair timing

- **Extent (static):** `handleLegendaryAction` (`legendary-tools.ts:168`) refuses only on the creature's own turn and on available points, so several legendary actions can be spent at the end of a single creature's turn. `handleLairAction` takes free text once per round (`lairUsedRound`), with no initiative-20 event and no resolution of the printed lair options. Regional effects are not modelled. Legendary Resistance belongs to the same event gap (F15).
- **Complete fix:** opportunities generated by turn advancement ("end of X's turn": one legendary option; "initiative 20": one lair option), each consumable once, with printed options resolved through the existing ability engine.

### F29: coverage labels overstate certainty

- **Extent:** confirmed by this document. The audit's full run passed all 461 suite files at this head, and every probed extension above reproduces on the same head. `gap()` registers only known holes, and the ledgers count rows, not clauses.
- **Complete fix:** as in the audit. In addition, each root cause above gets a cross-route test (the same scenario through every route that can produce it) rather than one test per route.

## Related gaps the audit did not record

| ID | Gap | Evidence | Root |
| --- | --- | --- | --- |
| N01 | **Concentration has no clock.** It ends only when its conditions or summons are gone (`concentration-upkeep.ts`). Detect Thoughts (1 minute) was still held after `pass_time` 3 hours. Every utility or zone concentration spell is affected. Enemy concentration (`encounter_enemies.concentration`) has no expiry either, and an enemy whose target saved keeps "concentrating" on nothing. | probed | R2 |
| N02 | A second caster of the same condition spell loses concentration at the next upkeep (see F07). | probed | R2 |
| N03 | `clear_condition` bypasses spell-end side effects: Aid's and Heroes' Feast's maximum HP (see F08). Check polymorph forms and other `spellEndPatch`-style effects on the same route. | probed | R3 |
| N04 | Halfling Lucky is missing from death, concentration and repeat saves. | probed | R1 |
| N05 | Cones and lines accept targets on opposite sides (see F13). | probed | R9 |
| N06 | Monsters cannot cast reaction spells (Shield, Counterspell). Only Parry exists. | static | R6 |
| N07 | Quickened Spell has no action-economy effect (see F12). | static | none |
| N08 | **Monster condition durations the parser cannot read become save-every-round.** `parseSaveEffect` reads only "1 minute", "end of next turn" and "N rounds" (`monster-abilities.ts:98-106`), and `layEnemyCondition` turns any condition without rounds into save-ends (`cast-at-player.ts`, `timing.saveEnds \|\| !timing.rounds`). The scan finds 17 SRD lines, among them Drow and Pseudodragon poison (1 hour), the giant spider family (1 hour), Couatl, Cockatrice, Ghast, Hezrou and Ghost Possession (24 hours), Succubus Charm (1 day), Medusa petrification and Erinyes poison (until cured), and Aboleth Enslave (until planes part). | scan | R2, R7 |
| N09 | Battle Master maneuver saves build their own enemy roll (`pc-attack-resolve.ts:476`), skipping `rollEnemySave`'s lasting effects, Bless/Bane on the enemy, exhaustion and authored saves. It is the only direct enemy-save builder left. | static | R1 |
| N10 | Shield casts with no trigger (see F26). | probed | R6 |
| N11 | Evasion is missing from zone triggers and Earthquake (see F14). | static | R4 |
| N12 | Nine priced SRD materials parse wrong (see F09). | scan | R10 |
| N13 | Death saves pass the total where the natural die is expected (see F02). | static | R1 |
| N14 | The Medicine, Spare the Dying and kit stabilize path keeps old failures (see F01). | static | none |
| N15 | Level-up checks upper bounds only and refuses thieves'-tools expertise (see F23, F24). | static | R8 |
| N16 | Counterspell never consumes the enemy's slot or use, and always spends its action (see F16). | static | R6 |
| N17 | Legendary Resistance is missing from 24 of the 26 enemy-save modules, does not undo damage where it fires, and burns on minor riders (see F15). | probed | R4, R6 |
| N18 | Timed conditions expire at the round wrap, not at their own initiative point (see F06). | static | R2 |
| N19 | 102 of 192 SRD monster trait names are never read, and the rider scan matched 49 dropped clauses across 520 attacks (heuristic; some attacks drop two) (see F22). | scan | R7 |
| N20 | Subclass always-prepared spells on a multiclass sheet use the primary class's DC (see F11). | static | none |
| N21 | **Same parallel-builder pattern for checks and initiative** (R1 applied to non-saves). The scene check (`scene-tools.ts:209`), opponent check (`roll-gates.ts:124`), Dispel Magic check (`dispel.ts:156`), late PC initiative (`encounter-tools.ts:707`), and companion and summon initiative (`companion-tools.ts:427`, `summon-store.ts:170`) each build their own d20, without the full rider set (exhaustion on checks, Halfling Lucky, Jack of All Trades, Feral Instinct, held dice). | static | R1 |

## Suggested workstreams for a complete fix

Ordered so that each root is fixed once and its findings close together. Every workstream starts by writing its probed cases as `gap()` tests, following the enforcement-suite rule that a gap is registered first and turned into a `test()` by the fix.

1. **One save and check builder (R1):** F02, F03, F04, N04, N09, N13, N21. Death, concentration, repeat and maneuver saves, plus the parallel check and initiative builders, all route through `resolveRollExpression` / `rollCharacterSave` / `rollEnemySave`. Acceptance: one scenario (blessed, exhausted 3, halfling, aura) gives the same modifiers through every route.
2. **Condition instances and lifetimes (R2):** F05, F06, F07, F20, N01, N02, N08, N18. Per-instance storage, a lifetime type (rounds, days, until dispelled), save-ends alongside a maximum, turn-anchored expiry, a concentration clock for PCs and enemies, and monster duration parsing. This is the largest change: it touches the schema, every writer and remover listed under F07, the upkeep, and the sheet and encounter views.
3. **Derived, not stored, bonuses (R3):** F08, N03. Maximum-HP bonuses read from active instances.
4. **Settlement order (R4):** F14, F15 (the settlement half), F19, N11, N17. One save-damage settlement used by aoe, cast_at_player, cast_at_enemy, zones and hazards; ward-first ordering.
5. **Event model for reactions and legendary timing (R6):** F15 (the choice half), F16, F26, F28, N06, N10, N16. Pending casts, pending failed saves and turn-end opportunities.
6. **AI actor boundary (R5):** F17 plus the five routes probed above.
7. **Geometry (R9):** F13, N05.
8. **Materials (R10):** F09, F10, N12, plus the F18 corpse inputs.
9. **Monster fidelity (R7):** F21, F22, N19, plus the F18 control model.
10. **Character legality (R8):** F23, F24, F25, N15, N20.
11. **Spell classification and support labels:** F11, F12, F27, F29, N07.

## Reproducing the probed items

All calls run through `scripts/lib/enforce-spell-kit.mjs` (`table`, `caster`, `invokeAsAi`) or `enforce-world.mjs` (`openWorld`, `world.invoke`, `dice`). Dice in parentheses are the forced d20 faces in order.

| Item | Setup and calls | Observed |
| --- | --- | --- |
| N04 death save | halfling with Lucky at 0 HP, fresh track; `rollDeathSave` (1, 18) | one d20 rolled, failures 2 |
| N04 repeat save | halfling, CON 10, poisoned `saveEnds con 10`; `pass_time 1 minute` (1, 15) | one d20, still poisoned |
| N04 concentration | halfling wizard concentrating on Fly; `apply_damage 4` (1, 15) | rolled 1, concentration broken |
| F08 | cleric `cast_buff Aid` at 2nd then 3rd; `clear_condition aided` | max HP 30 → 45, then still 45 |
| F17 | `invokeAsAi`: `apply_damage`, `set_condition paralyzed`, `clear_condition`, `set_enemy_condition stunned`, `heal 15`, `damage_enemy source hazard` | all accepted |
| N17 | pool `{ actions: 3, resistances: 3 }`; `aoe_damage Hypnotic Pattern` (1) | charmed and incapacitated, pool 3 |
| N17 | same pool; bard `cast_at_enemy Vicious Mockery` (1, 4) | pool 2, "saved", HP 90 → 82 |
| N01 | wizard `use_spell_slot Detect Thoughts` level 2; `pass_time 3 hours` | still concentrating |
| N05 | wizard at (10,2), goblins at (11,2) and (9,2); `aoe_damage Burning Hands`. Then goblins at (14,2) and (6,2); `Lightning Bolt` | both goblins hit in each |
| N02 | two wizards `cast_at_enemy Hold Person` on one goblin (1 each); `endSpentConcentration` | second caster's concentration ended |
| N10 | wizard `use_reaction feature Shield`, no attack | accepted, slot spent |
