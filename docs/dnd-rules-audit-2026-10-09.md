# D&D rules audit — 2026-10-09

Audited commit: **9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6**, application version **0.25.0**. Starting point: [issue #37](https://github.com/Lebbitheplow/open-dungeon-master/issues/37), including its subsequent claims about closing rules gaps.

**The implementation has broad rules coverage, but it does not fully enforce the rules it includes.** This audit identifies **29 findings**: 24 supported by independent engine, helper, or parser probes, and five supported by static inspection. They include incorrect death, duration, stacking, saving-throw, spell-targeting, monster, and resource behavior. Passing the existing suites and having a rulebook entry do not establish complete rules fidelity.

This is a documentation-only audit. No application code, existing tests, dependencies, or configuration were changed. Campaign mutations used temporary test databases; the installed content pack was read-only. No GitHub comments or issues were posted. The pre-existing untracked `docs/workshop-rulebook-audit-pr169.md` was left untouched; it concerns a different audited head and is not substituted for current evidence.

## Scope, baseline, and evidence

The baseline is the project's stated **2014 D&D 5e / SRD 5.1** rules. The bundled [SRD reader data](../src/lib/rulebook/srd-5.1.json) is the reference used for individual rule and spell comparisons. Its provenance is the official [SRD 5.1, CC BY 4.0](https://www.dndbeyond.com/attachments/39j2li89/SRD5.1-CCBY4.0License.pdf). Selected clarifications were checked against the official [2014 Basic Rules](https://www.dndbeyond.com/sources/dnd/basic-rules-2014) and [2014 Sage Advice Compendium](https://www.dndbeyond.com/sources/dnd/sac/sage-advice-compendium). This is not a 2024/SRD 5.2 audit. Additional authored options such as Artificer and Absorb Elements are reviewed separately from the SRD baseline.

The review followed character creation and legality, derived statistics, rolls, attacks and action economy, damage and death, conditions and concentration, spell guards and effects, monsters, summons, gear and attunement, rests, exploration, and player-facing rule descriptions. Every bundled entry was inventoried. Selected transitions were independently exercised rather than accepting the existing tests' definitions of coverage.

| Verification | Result | What it establishes |
| --- | --- | --- |
| `npm test`, installed pack | **461 files passed**, 286.53 seconds | Existing script assertions pass at this head. Vitest prints “Tests: no tests” because these suites assert during module evaluation; 461 is a file count, not a count of rules. |
| Focused fallback run, `CONTENT_DB_PATH=/nonexistent` | **10 files passed**, 12.70 seconds | Builder reconciliation, sheet legality, cast rules, race languages, descriptions, rulebook, spell effects, spell engine, summons, and final features pass their existing fallback assertions. |
| Independent probes | Findings labeled **reproduced** below | Production handlers, pure rule helpers, or the real stat-block parser returned the documented results with controlled dice and scratch state. |
| Full spell metadata inventory, with and without pack | Identical resolution totals; all **319** SRD titles have casting facts | Metadata and fallback availability, not complete effects. |
| UI representation | Source inspection and existing script checks | Collaborative preview opened, but navigation to the running local server failed on retry. No complete live browser journey is certified. |

The companion [inventory](dnd-rules-audit-2026-10-09-inventory.md) lists all SRD spells, item entries, monster entries, classes, races, rules pages, and the current authored-feature classifications. The [evidence JSON](dnd-rules-audit-2026-10-09-evidence.json) preserves probe outputs and verification metadata. Probe programs were disposable files outside the repository, not additions to the test suite. The steps below describe how to reconstruct the relevant cases using [scripts/lib/enforce-world.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/lib/enforce-world.mjs), [enforce-spell-kit.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/lib/enforce-spell-kit.mjs), and [enforce-combat.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/lib/enforce-combat.mjs).

Probe sheets sometimes set isolated preconditions directly—for example, exhaustion, an Arcane Ward pool, or a failed condition save. They test those runtime states, not whether the builder can produce every fixture. `table()` supplies fresh caster turns between calls; the bonus-action/reaction finding instead invokes the production cast guard twice on the same stored turn. Unless identified as an AI probe, engine invocations use the human-DM test harness; expected correction privileges are not themselves defects.

## Issue #37's original four complaints

| Original complaint | Current evidence | Assessment |
| --- | --- | --- |
| “Add recommended” exceeds spell limits | [SpellsGearStep.tsx](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/app/characters/builder/steps/SpellsGearStep.tsx) computes remaining cantrip, spellbook, and prepared-spell room and slices suggested additions; server spell-list legality also rejects over-picks. | Addressed in inspected paths. No live click-flow certification; F11 and F24 show remaining legality gaps in different paths. |
| Dependent choices survive changing race/class/background/level | [builder/reconcile.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/app/characters/builder/reconcile.ts), regrant/pruning paths, and [test-builder-reconcile.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/test-builder-reconcile.mjs) cover removal and explanations for dropped choices. | Broadly addressed. F23 shows a legal expertise choice that the representation cannot retain. |
| Race flavor text grants bogus languages | [test-race-languages.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/test-race-languages.mjs) explicitly checks humans' flavor language names, Dwarvish script mentions, selectable languages, and inherited subrace mechanics. | Addressed for tested sources and parsing patterns. This is not a guarantee about every future third-party prose format. |
| Missing descriptions in pickers | [test-option-descriptions.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/test-option-descriptions.mjs), content-description adapters, and builder option components supply descriptions and distinguish placeholders. | Broadly addressed. F22 and F29 concern fidelity/support representation beyond simply supplying text. |

The issue's later “zero gaps” and approximately 96% coverage claims are broader than this evidence warrants. The September audit records a selected rule set and acknowledges partial/narrated mechanics; it is not a certification of every clause in the SRD or every combination of effects.

## Findings index

**P1:** material changes to survival, persistent state, legality, or encounter resolution. **P2:** narrower incorrect mechanics or substantial omissions. **P3:** misleading coverage/support representation. These are audit priorities, not security severity labels. **Reproduced** includes helper/parser probes, which are explicitly distinguished from full runtime calls in each entry. Findings are grouped by behavior, not claimed to be regressions introduced by issue #37's fixes.

| ID | Priority | Evidence | Finding |
| --- | --- | --- | --- |
| F01 | P1 | Reproduced: helper | Stabilizing does not reset death-save counters. |
| F02 | P2 | Reproduced: runtime | Death saves ignore Bless and the general save pipeline. |
| F03 | P2 | Reproduced: runtime | Concentration saves miss exhaustion disadvantage. |
| F04 | P2 | Reproduced: runtime | Condition repeat saves ignore Bless. |
| F05 | P1 | Reproduced: runtime | Hold Person outlives its maximum duration. |
| F06 | P2 | Static | Repeat saves run at round wrap instead of the target's turn end. |
| F07 | P1 | Reproduced: runtime | Independent sources of the same condition collapse into one. |
| F08 | P1 | Reproduced: runtime | Recasting Aid stacks maximum HP and leaves a permanent increase. |
| F09 | P1 | Reproduced: helper | Costly materials accept unpriced names and flatten distinct components. |
| F10 | P2 | Reproduced: helper | Ordinary material access and War Caster's material-hand requirement are not enforced. |
| F11 | P2 | Reproduced: helper | Ritual permission is detached from the spell's owning class. |
| F12 | P2 | Reproduced: cast guard | Bonus-action spell restrictions omit own-turn reaction spells. |
| F13 | P1 | Reproduced: runtime | Area spells accept targets outside any single legal area. |
| F14 | P2 | Reproduced: runtime | Automatic failed saves bypass Evasion. |
| F15 | P1 | Reproduced: runtime | Legendary Resistance spends a use and announces success without correcting damage. |
| F16 | P1 | Reproduced: runtime | Counterspell can suppress a noncaster's action without a casting trigger. |
| F17 | P1 | Reproduced: AI runtime | `split_damage` bypasses attack resolution and action costs. |
| F18 | P1 | Reproduced: runtime; additional static gaps | Animate Dead creates creatures without corpse inputs and deletes them when control expires. |
| F19 | P2 | Reproduced: runtime | Arcane Ward benefits from the wizard's damage resistance. |
| F20 | P2 | Reproduced: helper/final metadata | Long spell durations are clamped to one day. |
| F21 | P1 | Reproduced: parser/runtime | Rakshasa's Limited Magic Immunity is not enforced. |
| F22 | P2 | Reproduced: parser | Monster snapshots lose significant rule clauses and effects. |
| F23 | P2 | Reproduced: helper; UI inspection | Rogue expertise in thieves' tools is rejected and filtered out. |
| F24 | P2 | Reproduced: helper | Server proficiency legality accepts missing required selections. |
| F25 | P2 | Static; acknowledged in existing tests | Artificer attunement and tool perks are presented without their mechanics. |
| F26 | P2 | Reproduced: runtime | Absorb Elements does not establish its lasting resistance or attack rider. |
| F27 | P2 | Static/final metadata | “Utility” and narrated spells include unimplemented mechanical outcomes. |
| F28 | P2 | Static | Legendary/lair timing is incompletely enforced; lair actions are text. |
| F29 | P3 | Static | Coverage classifications and player-facing support information overstate certainty. |

## Death, saves, and condition lifecycle

### F01 — Stabilization retains previous death-save failures

**Expected:** Becoming stable resets both success and failure counters. Subsequent noncritical damage at 0 HP starts the new failure count at one. Reference: bundled Combat, “Death Saving Throws” and “Stabilizing a Creature.”

**Observed:** `applyDeathSaveRoll({successes:2, failures:2, stable:false, dead:false}, 10)` returns a stable track with **3 successes and 2 failures**. Passing that track to `onDamageAtZero(..., false)` marks the creature dead with **3 failures**. This combines two real production bookkeeping functions; the death-save handler persists the returned track. A character can die from old failures after stabilization.

**Location:** [dm/death-logic.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/death-logic.ts) (`applyDeathSaveRoll`, `onDamageAtZero`), [dm/death.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/death.ts) (`rollDeathSave`). **Acceptance check:** Stabilize through saves with pre-existing failures, then take damage at 0; verify counters were reset, one new failure, and no death.

### F02 — Death saves do not receive normal saving-throw modifiers

**Expected:** A death save has no ability modifier, but applicable saving-throw bonuses such as Bless still apply; natural 1/20 retain their special handling.

**Observed:** A dying, blessed hero with queued dice **8, 4** rolls only the d20 and receives one failure. The d4 is unused. `rollDeathSave` constructs its own d20 expression instead of using the general saving-throw machinery. Audit confirmed Bless specifically; other omitted riders should be checked individually rather than assumed equivalent.

**Location:** [dm/death.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/death.ts) (`rollDeathSave`), compare [dm/forced-save.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/forced-save.ts). **Acceptance check:** Bless/Bane, flat save bonuses, and eligible auras affect the total while natural die rules remain independent of modifiers.

### F03 — Concentration saves ignore exhaustion level 3

**Expected:** A concentration check is a Constitution saving throw. At exhaustion level 3, saving throws have disadvantage under the 2014 rules.

**Observed:** A wizard with CON 14, exhaustion 3, and Fly active takes an 8-damage concentration check. With queued dice **15, 1**, the hook rolls only 15, adds 2, and keeps concentration against DC 10. The second d20 is unused. The production hook assembles selected bonuses and War Caster state independently of ordinary save resolution.

**Location:** [dm/concentration.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/concentration.ts) (`concentrationDamageHook`). **Acceptance check:** Exhaustion and relevant lasting save effects work alongside War Caster, Bless/Bane, auras, and features; disadvantage uses both d20s.

### F04 — Condition repeat saves ignore Bless

**Expected:** A saving throw to end a condition receives applicable saving-throw riders.

**Observed:** An untrained-CON wizard at CON 10 holds poisoned with a CON DC 10 repeat save and blessed. Queued **8, 4** produces only d20 8; poisoned remains. The correct modified total would be 12. `tickSheetConditions` builds a separate save expression and does not include Bless's die.

**Location:** [dm/condition-tick.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/condition-tick.ts) (`tickSheetConditions`), compare [dm/forced-save.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/forced-save.ts). **Acceptance check:** The same save state produces equivalent modifiers through requested saves, condition repeat saves, and other automatic save paths.

### F05 — Hold Person never reaches its duration limit

**Expected:** Hold Person ends after at most one minute even if every repeat save fails and the caster keeps concentration.

**Observed:** Cast Hold Person on a humanoid, fail its initial save, and advance **11 complete condition rounds**, failing each repeat save. Paralysis and concentration still remain. Its stored metadata contains `saveEnds`, spell, source, and slot level, but no duration countdown. The final override supplies `saveEnds` without rounds; additionally, `spellConditionMeta` suppresses rounds whenever `saveEnds` is true.

**Location:** [srd/spell-mech-overrides.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-mech-overrides.ts)/spell row tables, [dm/spell-effects.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/spell-effects.ts) (`spellConditionMeta`), [dm/condition-tick.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/condition-tick.ts). **Acceptance check:** Track repeat-save timing and maximum lifetime independently; fail every save for more than ten rounds and verify expiration.

### F06 — Ordinary repeat saves happen at the wrong initiative point

**Expected:** Hold Person, Hold Monster, and comparable spell text grant repeat saves at the end of the affected creature's turn.

**Observed, static:** `tickEncounterConditions` runs ordinary save-ending conditions when the initiative order wraps. It is distinct from the specialized start/end-turn hooks. A creature early in the order can remain disabled through later creatures' turns despite being entitled to recover at its own turn end. Outside combat, one save per passage of time is explicitly an engine simplification.

**Location:** [dm/condition-tick.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/condition-tick.ts), [dm/encounter-tools.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/encounter-tools.ts), [srd/spell-mech-types.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-mech-types.ts) (`saveEnds` is described as end-of-round). **Acceptance check:** Place the victim first, middle, and last in initiative; each receives its save at its own turn end, independently of round wrap.

### F07 — Same-condition effects lose independent sources

**Expected:** Overlapping identical effects do not multiply the benefit, but independent castings retain their own source and lifetime. Ending one caster's effect must not erase another still-valid casting.

**Observed:** Two wizards each successfully impose Hold Person on the same enemy. Both spend slots and concentrate. The enemy keeps only caster A's paralysis metadata. Break A's concentration: paralysis disappears while B is still concentrating. `laySpellConditionsOnEnemy` excludes already-present condition names; the sheet condition path also stores one metadata entry per name.

**Location:** [dm/spell-effects.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/spell-effects.ts) (`laySpellConditionsOnEnemy`), [dm/set-condition.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/set-condition.ts), [dm/concentration.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/concentration.ts). **Acceptance check:** Exercise two sources, differing strengths/durations, and concentration loss in either order; suppress duplicate benefits without discarding sources.

### F08 — Repeated Aid creates permanent maximum HP

**Expected:** Repeated Aid effects do not add together; the effective increase ends with the applicable spell duration.

**Observed:** On a hero with base maximum HP 30, cast second-level Aid twice outside combat. Maximum HP becomes **35, then 40**, while only one `aided (+5)` condition is stored. Advance more than eight hours: the condition clears but maximum and current HP remain **35**. Repetition therefore grants an enduring maximum-HP increase.

**Location:** [dm/cast-buff.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-buff.ts) (maximum-HP branch after condition application), [dm/condition-tick.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/condition-tick.ts) (expiry adjustment). **Acceptance check:** Same- and different-slot recasts use the strongest active effect, and expiry restores the base maximum without accumulated drift. Audit other maximum-HP spells against the same invariant.

## Spell legality, resources, and resolution

### F09 — Costly material checks do not establish component value or identity

**Expected:** A priced component meets the required value; distinct materials retain their individual quantities, costs, and consumed/reusable status.

**Observed, helper:** Revivify rejects `Diamond (1 gp)` but accepts an unpriced inventory line simply named **Diamond** as satisfying 300 gp. With no component and 300 gp cash, it substitutes a purse payment. Clone's facts flatten its 1,000-gp consumed diamond/flesh and 2,000-gp reusable vessel into **one 3,000-gp consumed component**; the planning representation cannot distinguish them. A zero-quantity matching line is also accepted by the helper, but this audit does not establish that normal inventory routes permit that quantity.

**Location:** [srd/spell-facts.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-facts.ts) (`materialCostFrom`), [dm/cast-rules.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-rules.ts) (`materialPlan`), [dm/cast-material.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-material.ts). **Acceptance check:** Require verified component value and available quantity; handle multiple component identities and individual consumption. If purchasing from cash is intentional, disclose the abstraction and constrain it to appropriate circumstances.

### F10 — Material access is bypassed, including with War Caster

**Expected:** A caster has the required material or permitted focus/pouch and a hand available to access it. War Caster relaxes somatic handling, not all material requirements.

**Observed, helper:** Fireball passes `componentProblem` with empty equipment and no focus or component pouch. A War Caster with two equipped one-handed weapons also passes its V/S/M component check: the hands-full exemption returns before enforcing material access. Ordinary zero-price material possession is not checked by `materialPlan` either.

**Location:** [dm/cast-rules.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-rules.ts) (`componentProblem`, `handsBusy`, `materialPlan`), [srd/feat-combat.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/feat-combat.ts) (`castsWithHandsFull`). **Acceptance check:** Separate verbal, somatic, and material requirements; include weapon/shield/focus combinations and spells with S but no M. Declare assumed ordinary components if that is a product rule.

### F11 — One class's ritual feature authorizes another class's spell

**Expected:** Multiclass spells and ritual permissions follow the class feature that grants them; being a wizard does not make a sorcerer-only known spell a wizard ritual.

**Observed, helper:** A wizard 1/sorcerer 3 has Detect Magic only in the sorcerer caster record, with no wizard prepared/book copy. `spellHeldProblem(..., {ritual:true})` and `ritualProblem` both return no error. The latter checks whether **any** class grants rituals, independently of which class holds the spell.

**Location:** [dm/cast-rules.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-rules.ts) (`canCastRituals`, `spellHeldProblem`, `ritualProblem`), [srd/spell-prep.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-prep.ts). **Acceptance check:** Resolve the owning caster/book/feat and its ritual requirements together, including Ritual Caster and Book of Ancient Secrets.

### F12 — Own-turn reaction spells evade the bonus-action casting restriction

**Expected:** Under the 2014 rule, casting a bonus-action spell limits other spells during that same turn to a one-action cantrip. A reaction on a different creature's turn is a separate case. [Official 2014 spellcasting rule](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/spellcasting).

**Observed, production cast-guard probe:** On one wizard turn, call `castSpell` for Misty Step at level 2, then Shield at level 1 with `via:'reaction'`. Both succeed and spend slots. `planTurn` returns free for the reaction route before consulting the bonus-spell mark. The inverse ordering also lacks a reaction-spell mark for the bonus-action guard to inspect. This probe establishes the shared guard defect, not a complete browser trigger sequence.

**Location:** [dm/cast-guard.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-guard.ts) (`planTurn`), [dm/cast-rules.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-rules.ts) (`turnCharge`). **Acceptance check:** Same-turn bonus spell/reaction spell pairs fail in either order; off-turn reactions remain allowed. Include bonus-action cantrips in the restriction tests.

### F13 — One Fireball can hit targets 100 feet apart

**Expected:** All creatures affected by one Fireball lie within the same legal 20-foot-radius sphere.

**Observed:** On an open five-foot grid, place the wizard at (10,4) and targets at (1,4) and (21,4). One `aoe_damage` Fireball accepts both targets, spends one action/slot, and applies 8 fire damage to each on failed saves. The two targets are **100 feet apart**. Range-from-caster checks do not establish a common area center or shape membership.

**Location:** [dm/aoe-spell.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/aoe-spell.ts) (`planAoeSpell`), [dm/aoe-damage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/aoe-damage.ts). **Acceptance check:** Resolve a declared center/origin/orientation and derive membership, including spheres, cones, lines, cubes, total cover, friendly targets, and edge cases. Theatre-of-mind declarations can be a separate, explicit abstraction.

### F14 — Automatic save failure skips Evasion

**Expected:** In the 2014 Evasion feature, an eligible failed Dexterity save against a half-on-success effect still halves damage. The 2014 feature does not have the revised incapacitation restriction.

**Observed:** A rogue 7 holding unconscious is subjected to a 10-fire-damage, Dexterity-save, half-on-success area effect. Its save automatically fails and it loses **10 HP**, not 5. `aoeOnCharacters` exits the automatic-failure branch before evaluating Evasion. That branch also bypasses later spell-condition application, which warrants additional spell-specific tests.

**Location:** [dm/aoe-characters.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/aoe-characters.ts), bundled Rogue/Evasion and Conditions entries. **Acceptance check:** Apply automatic success/failure to the save result while still applying eligible damage mitigation and riders.

### F15 — Legendary Resistance does not correct a resolved damage save

**Expected:** Choosing success changes the save's mechanical consequences, not only the narration.

**Observed:** Give an enemy three Legendary Resistances. A failed Fireball save deals 8 damage: **90 → 82 HP** and resistances remain 3. Invoke `legendary_resist`: the pool falls to 2 and the tool says “The failed save becomes a success,” but HP remains **82**, rather than 86. It also accepts a use without a failed save. Automatic Legendary Resistance exists for some condition paths; that does not resolve this damage path.

**Location:** [dm/legendary-tools.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/legendary-tools.ts) (`handleLegendaryResist`, `autoLegendaryResistance`), [dm/aoe-damage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/aoe-damage.ts), [dm/forced-save.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/forced-save.ts). **Acceptance check:** Bind the choice to a pending failed save, settle damage/conditions consistently, and prevent a second application or arbitrary spend. Preserve the creature's choice rather than assuming every failure must consume resistance.

### F16 — Counterspell can remove a noncaster's action

**Expected:** Counterspell responds to an actual visible creature casting a spell within range, and the interrupted spell still consumes its casting resources.

**Observed:** A dummy with only a Club attack and **no spellcasting** can be targeted with `use_reaction`, feature Counterspell, spell Fireball. The call spends the wizard's reaction and third-level slot, reports that the nonexistent Fireball fails, and marks the dummy's round action spent. A global spell-name lookup is accepted when the monster has no matching spell. There is no pending casting event to validate or settle its resource consumption.

**Location:** [dm/reaction-spells.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/reaction-spells.ts) (`checkCounterspell`, `finishCounterspell`). **Acceptance check:** Require a concrete pending cast, validate perception/range, preserve the enemy's casting spend, and block counters against a weapon-only action or invented spell.

### F17 — AI damage dispatch can bypass attack enforcement

**Expected:** AI attack damage must follow a legal attack/action and server resolution. Human correction tools may deliberately have broader authority.

**Observed:** Using a real AI actor/DM turn, call `split_damage` with 7 slashing damage, one enemy at full share, and reason “Longsword attack.” The enemy goes **90 → 83 HP** with **no attack dice, no attacker, and a null turn budget**. The dispatch goes directly to damage application. This contradicts broad claims that the model cannot apply attack damage without server rolls.

**Location:** [dm/invoke-dispatch.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/invoke-dispatch.ts), [dm/split-damage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/split-damage.ts), [dm/enemy-damage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/enemy-damage.ts). **Acceptance check:** Separate correction/environmental adjudication from attack settlement or require a verified attack/effect record for AI-originated damage. Audit every raw damage/heal/condition route for equivalent actor-boundary bypasses.

### F18 — Undead creation and control are modeled as expiring summons

**Expected:** Animate Dead requires appropriate remains. Its 24-hour control window does not destroy the undead; loss of control and continued existence are distinct. Create Undead has additional corpse, nighttime, and component requirements.

**Observed:** Cast Animate Dead with variant Skeleton, no corpse or bone input, and an otherwise empty scratch world. A skeleton is created. It receives a 14,400-round `summoned` condition; after 1,441 minutes of clock upkeep, the summon is **removed**. The tool explicitly says these creatures disappear at 0 HP. Static inspection of the shared summon path also finds no representation/check for Create Undead's nighttime casting, corpse targets, or per-corpse material requirements.

**Location:** [srd/summon-spells.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/summon-spells.ts), [dm/summon-cast.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/summon-cast.ts), [dm/summon-store.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/summon-store.ts), [dm/summon-rules.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/summon-rules.ts). **Acceptance check:** Model creature creation, control ownership/expiry, reassertion of control, remains, and material quantity separately from conjuration disappearance. This audit does not certify all summon commands or familiar touch-delivery behavior.

### F19 — Arcane Ward incorrectly uses the wizard's resistance

**Expected:** The ward takes damage before the wizard's own immunities/resistances and temporary HP. The ward does not inherit those defenses. [Official 2014 clarification](https://www.dndbeyond.com/sources/dnd/sac/sage-advice-compendium#Wizard).

**Observed:** An abjurer has a raised 16-HP ward and an equipped, attuned Ring of Fire Resistance. Apply 10 fire damage. The engine halves it to 5 first, then the ward loses **5 HP**, retaining 11. It should lose 10, retaining 6, with no wizard HP damage in either case.

**Location:** [dm/pc-damage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/pc-damage.ts) (`damageAdjust` before `absorbByWard`), [dm/arcane-ward.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/arcane-ward.ts). **Acceptance check:** Order ward, wizard defenses, temporary HP, form HP, and overflow correctly; include Projected Ward and concentration on overflow damage.

### F20 — Multi-day durations are truncated

**Expected:** Spell durations retain their stated lifetime and relevant upcasting changes.

**Observed:** `durationRounds('10 days')` and `durationRounds('30 days')` both return **14,400 rounds**, one day. The final Antipathy/Sympathy mechanic also records frightened for 14,400 rounds, despite the spell's ten-day duration. Geas has a charmed condition without a countdown and only a note saying 30 days, a different manifestation of incomplete long-term state.

**Location:** [srd/spell-mechanics.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-mechanics.ts) (`durationRounds`), spell row tables, [dm/condition-tick.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/condition-tick.ts). **Acceptance check:** Use a representation that supports multi-day and indefinite lifetimes; test clock jumps, encounter transitions, and slot-dependent duration extensions.

## Monsters, characters, items, and additional authored rules

### F21 — Rakshasa's Limited Magic Immunity is bypassed

**Expected:** Unless it chooses otherwise, a rakshasa cannot be affected by spells of sixth level or lower.

**Observed:** Parse the installed SRD rakshasa stat block and use those stats in a scratch encounter. A third-level Fireball deals **8 HP** on a failed save (**110 → 102**). Limited Magic Immunity survives only as a truncated trait string; searches of the spell resolution paths find no matching enforcement. This is not ordinary Magic Resistance, which does have a save-advantage hook.

**Location:** [bestiary/statblock.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/bestiary/statblock.ts), [dm/monster-abilities.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/monster-abilities.ts) (`ENGINE_TRAIT_NAMES`, trait flags), spell target guards and [dm/aoe-damage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/aoe-damage.ts). **Acceptance check:** Enforce spell-level immunity across attacks, areas, conditions, detection, and other effects; permit the monster's explicit choice where appropriate.

### F22 — Monster snapshots omit substantial rules even for SRD monsters

**Expected:** The runtime retains enough source text and structured state to enforce or accurately narrate every relevant monster clause.

**Observed, real parser:** Aboleth Tentacle becomes attack dice/reach with **no disease rider**. Enslave retains DC 14/WIS/per-day/repeat-save metadata but **no charmed condition**, because its wording evades the parser pattern. Mucous Cloud retains a save but no underwater-only breathing disease state. Trait and legendary-action prose is truncated; Enslave's control/termination rules and Psychic Drain's healing clause are absent from the displayed snapshot text. Rakshasa Claw similarly lacks its curse rider. Vampire Bite retains damage types but not all its maximum-HP/healing consequences. These examples were parsed from actual installed SRD rows, not invented prose.

**Location:** [bestiary/statblock.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/bestiary/statblock.ts) (`traitLine`, `sectionLines`, `parseMonster`), [bestiary/attack-parse.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/bestiary/attack-parse.ts), [dm/monster-abilities.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/monster-abilities.ts) (`parseSaveEffect`). **Acceptance check:** Preserve full source clauses separately from compact summaries; use explicit complex-rider models or mark them for manual resolution. Test a corpus of actual monsters, not only synthetic attack strings. This finding does not claim every monster attack is broken.

### F23 — Legal rogue tool expertise cannot be selected or stored through normal legality

**Expected:** A first-level rogue may choose expertise in two proficient skills, or one proficient skill and thieves' tools.

**Observed:** `judgeProficiencies` rejects expertise containing `thieves' tools` because it checks every expertise entry against **skills**. The builder's derived proficiency data filters expertise through the skill list as well. A legal SRD option is therefore denied rather than merely omitted from a description. The lower-level tool bonus code can represent tool expertise, so the restriction is inconsistent across layers.

**Location:** [srd/legality/proficiencies.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/legality/proficiencies.ts), [characters/builder/useBuilderDerived.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/app/characters/builder/useBuilderDerived.ts), [characters/builder/steps/ClassChoices.tsx](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/app/characters/builder/steps/ClassChoices.tsx), builder submit/reconciliation paths. **Acceptance check:** Offer and validate thieves' tools expertise for rogue at the correct levels, retaining it through save, edit, regrant, and runtime tool checks.

### F24 — Proficiency legality checks upper bounds but not completeness

**Expected:** A completed character includes required class skill choices, expertise selections where granted, and granted language/tool choices. Optional or deliberately deferred choices should be represented explicitly.

**Observed, helper:** A human rogue 1 with no background, no selected class skills, no expertise, and only Common returns **no legality problems**, leaving those choices absent. The judge rejects over-picks and unsupported picks but does not require filling these grants. Client submission has additional completeness checks; server callers are not equivalent to the client.

**Location:** [srd/legality/proficiencies.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/legality/proficiencies.ts) (`judgeProficiencies`), [srd/sheet-legality.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/sheet-legality.ts), builder submit. **Acceptance check:** Exercise creation/update/library/campaign/companion/level-up paths with missing selections; reject incomplete final sheets or explicitly persist pending choices. This probe concerns the shared proficiency judge, not a fresh end-to-end HTTP reproduction for every caller.

### F25 — Artificer perks conflict with the shared item model

**Scope:** Additional authored class, outside SRD 5.1.

**Observed, static:** [test-feature-coverage.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/test-feature-coverage.mjs) acknowledges Tool Expertise, Magic Item Adept, Magic Item Savant, Magic Item Master, and Soul of Artifice as guidance. The shared attunement guard and settlement use the constant **three** slots, rather than Artificer's level-dependent four/five/six, and normal item prerequisites remain in place. Presenting these features on a sheet therefore does not supply their promised mechanics. Infusions/resource pools elsewhere do not establish enforcement of these perks.

**Location:** [srd/magic-items.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/magic-items.ts) (`attunementProblem`, `settleAttunement`), [srd/armor.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/armor.ts) (`ATTUNEMENT_SLOTS`), [scripts/test-feature-coverage.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/test-feature-coverage.mjs). **Acceptance check:** Either implement the authored class's item/tool exceptions and Soul of Artifice behavior, or explicitly label those feature effects for manual adjudication. Verify external rule provenance before extending the implementation.

### F26 — Absorb Elements announces effects it does not establish

**Scope:** Additional authored spell, outside SRD 5.1.

**Observed:** Calling its reaction spends a slot/reaction but writes **no condition metadata** for ongoing resistance. The handler can refund part of a recorded triggering hit, then returns prose about resistance and extra melee damage. It never applies the existing `absorb elements (type)` condition or stores a first-hit rider. Its message also incorrectly puts the extra hit “before their next turn”; the spell's rider applies on the next turn, and upcasting increases its dice. The isolated probe also accepts the reaction with no elemental damage trigger.

**Location:** [dm/reaction-spells.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/reaction-spells.ts), compare the unused-by-this-path Absorb Elements row in [srd/condition-effects.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/condition-effects.ts). **Acceptance check:** Validate a qualifying hit, store the absorbed type and expiration, apply resistance to subsequent eligible damage, and apply/consume the slot-scaled melee rider on the correct turn.

### F27 — Narrated spells include rules with mechanical consequences

**Observed, static and final metadata:** Teleport resolves as utility without a familiarity/mishap engine; its table and mishap damage are mechanical. Simulacrum and Clone have casting facts but no general mechanic block or matching dedicated summon entry; copied HP, restoration restrictions, resources, maturation, and persistence are not thereby enforced. Geas' once-per-day 5d10 disobedience damage and slot-dependent duration are described in a note, rather than a tracked obligation/damage gate. Wish's non-duplication stress is likewise not established by its utility row.

**Location:** [srd/spell-mech-overrides.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-mech-overrides.ts), [srd/spell-mech-rows.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/spell-mech-rows.ts), [dm/cast-redirect.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/cast-redirect.ts), [dm/leveled-spells.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/leveled-spells.ts), [dm/spell-self.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/spell-self.ts), final inventory. **Acceptance check:** Separate genuinely descriptive utility from partially manual spells with dice, costs, durations, limits, or created creature state. Attribute manual decisions explicitly. Absence of a general block alone is not the finding: dedicated engines exist for several other spells.

### F28 — Legendary and lair event timing is incomplete

**Expected:** Legendary actions occur only at the end of another creature's turn, one option per such opportunity. Lair actions occur on initiative 20, losing ties, with their printed effects.

**Observed, static:** Legendary actions check not-own-turn and available points but do not bind a use to a specific completed creature turn or limit one option to that opportunity. Lair actions accept arbitrary text once per round, print “initiative 20,” and publish a message; they neither verify the initiative event nor resolve a printed effect. Some legendary attacks do resolve actual attacks, so this is a timing/nonattack-effect gap rather than a claim that all legendary actions are narration.

**Location:** [dm/legendary-tools.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/legendary-tools.ts) (`handleLegendaryAction`, `handleLairAction`), [dm/legendary-logic.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/dm/legendary-logic.ts), turn advancement. **Acceptance check:** Model event opportunities and printed choices, settle their costs/effects, and reject wrong-phase or duplicate opportunities.

### F29 — Coverage and support labels do not certify behavior

**Observed, static:** `authoredCoverage` classifies a feature as typed when an effect/spend/reaction entry exists, and as counter when a pool exists; neither proves all feature clauses execute. Its mechanical-wording regex can classify unrecognized mechanics as plain. `AUTHORED_READERS` and several feature checks look for names/call strings in source files, rather than asserting the behavior. `gap()` treats any throw as an expected open gap, including setup failures; “zero gaps” only describes explicitly registered cases. The test coverage configuration excludes `.tsx` and renders no UI.

The normal builder/sheet spell display does not consistently disclose whether a selectable spell's complete effect is automatic, partially automatic, or manual. The workshop editor does label utility as narrated, but that is not a uniform per-option runtime support contract. A rulebook description and a success-shaped tool response can therefore imply more certainty than the stored state supports, as F15 and F26 demonstrate.

**Location:** [srd/authored-coverage.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/authored-coverage.ts), [scripts/test-feature-coverage.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/test-feature-coverage.mjs), [scripts/lib/enforce-harness.mjs](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/scripts/lib/enforce-harness.mjs), [vitest.config.mts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/vitest.config.mts), [components/sheet/SpellBook.tsx](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/components/sheet/SpellBook.tsx), [characters/builder/steps/SpellsGearStep.tsx](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/app/characters/builder/steps/SpellsGearStep.tsx), historical enforcement documents. **Acceptance check:** Record rules-level expected behavior, evidence, exceptions, and the owning engine separately from data presence. Publish support limitations at the decision point and ensure success text reflects actual settlement. Keep historical documents dated; do not silently reinterpret their denominators as current completeness.

## Coverage across the SRD's rule domains

Every domain below is represented in the bundled book. “Selected checks pass” means current tests cover parts of the domain and no additional issue was independently reproduced here; it is **not** a full certification. The detailed rules-page inventory includes all 36 top-level rules entries.

| Domain | Implementation and verification evidence | Audit assessment |
| --- | --- | --- |
| Ability scores, modifiers, proficiency, skills, advantage/disadvantage, contests, passive checks | [srd/index.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/index.ts), roll resolution, trait/effect riders; existing roll and exploration suites | Broad implementation; divergent automatic save pipelines are confirmed in F02–F04. Context and DC selection remain DM decisions. |
| Races and racial traits | Race tables, content adapters, legality and regrant; `test-enforce-races`, `test-race-languages` | All nine SRD race pages included; tested ability/speed/language/trait grants pass. Language under-selection remains F24. Additional variants require their own provenance. |
| Classes, subclasses, leveling, ASIs and feats | Class features/resources/options, sheet legality, level-up and feature-use suites | All 12 SRD classes included; many combat/resource effects execute. Expertise representation and additional Artificer limitations are F23–F25. Counter/name coverage is not full behavior coverage. |
| Multiclassing and per-class spellcasting | [srd/multiclass.ts](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/multiclass.ts), spell preparation, caster views, legality | Shared/pact slots and class-level grants have tests; ritual ownership remains F11. Maximum three classes is an intentional application restriction. |
| Backgrounds, languages, inspiration, alignment | Options/proficiencies, background descriptions, inspiration rolls | Represented; alignment/personality are appropriately descriptive. Missing final choices need F24's distinction from legal custom backgrounds. |
| Weapons, armor, shields, damage types and equipment | Armor/weapon tables, derived AC, attack profiles, item/resource tools | Broad enforcement; free object interactions are a declared simplification. Material checks are incomplete (F09–F10). |
| Combat order, surprise, actions, bonus actions, reactions, Ready | Encounter/action budgets, attack engine, initiative/ready suites | Selected checks pass; same-turn spell restrictions, Counterspell, raw AI damage, and legendary/lair events remain F12/F16/F17/F28. |
| Attack rolls, criticals, cover, range, reach, opportunity attacks | Player/enemy attacks, map sight/movement, reaction settlement | Existing checks pass selected interactions. Some raw dispatch paths escape them (F17); monster-specific riders remain F21–F22. |
| Area targeting, movement, difficult terrain, walls, zones | Map routes, zone state/triggers, AoE planner | Persistent zones have substantial implementation. Arbitrary single-blast target lists are not geometric membership (F13). No-height/theatre-of-mind limitations are deliberate. |
| Damage, healing, temporary HP, resistance, vulnerability, death | `pc-damage`, `enemy-damage`, mutation math, death logic | Basic invariants are tested; stabilization, Evasion branch ordering, and ward ordering fail (F01/F14/F19). |
| Conditions, exhaustion, concentration, effect expiration | Condition tables, metadata, clock and turn upkeep | All 14 named SRD conditions plus exhaustion are represented. Source overlap, repeat-save modifiers/timing, maximum durations, and stacking fail (F03–F08/F20). |
| General spellcasting: components, slots, rituals, casting time, targets | Shared cast guard/facts/preparation; casting suites | All 319 casting-fact names resolve. Several legality and resource details fail (F09–F13). |
| Individual spells | Structured rows plus dedicated healing/cure/zone/summon/shape/revival engines | Metadata inventory is complete; no complete behavior percentage established. F05/F07–F20/F27 provide counterexamples to blanket enforcement. |
| Summons, familiar, steed, companions, creature commands | Summon/familiar/store/PC command engines; summon suites | Creature stats and selected command/lifetime cases are tested; undead creation and control require separate semantics (F18). Not every familiar/mount interaction independently exercised. |
| Monsters, NPCs, stat blocks, traits, special actions | Parser, enemy attacks, ability casting, resource ledgers, regeneration | 318 book entries included; 322 installed SRD rows have different grouping. Limited immunity, complex riders and source retention fail (F21–F22). |
| Legendary resistance/actions and lairs | Legendary profiles/pools, action tools | Budgets exist, but response settlement and phase timing remain F15/F28. |
| Magic items, charges, attunement, curses, consumables, scrolls | Magic-item tables, item-spell mappings, item-use/consumable/curse tools | Many selected effects execute; substantial item behavior remains narrated. Item metadata counts below are deliberately narrow. Artificer exceptions remain F25. |
| Resting, hit dice, recovery, exhaustion recovery | Rest logic/tools, connected-player hit-die selection, rest suites | Selected checks pass. Rest duration/interruption is treated as an atomic DM decision, not fully simulated. |
| Travel, pace, forced march, visibility, light, carrying capacity | World tools, map sight, encumbrance and explore suites | Broad selected coverage; survival costs depend on enabled variants. Navigation/foraging decisions beyond the SRD baseline remain narrated. |
| Food/water, suffocation, falling, hazards and underwater combat | Supply settings, hazard/vitals tools, underwater rules | Selected numeric hazard checks pass; food/water and ammunition are assumed supplied unless variants are enabled. |
| Expenses, lifestyle, downtime, tools, mounts, trade goods | Currency/gear, lifestyle/between-state, mount tools, downtime suites | Numeric paths exist; resource availability and world decisions still require adjudication. Missing required tool/language choices remain F24. |
| Traps, objects, diseases, poisons, madness | Hazard/object/affliction engines, disease clock/rest hooks | SRD examples and selected upkeep cases are tested; this does not cover every monster-created affliction, demonstrated by F22. |
| XP, challenge rating, rewards, treasure | Encounter math/award tools, treasure tables | Existing checks pass selected calculations. DM encounter/reward decisions and milestone choices are separate from RAW mechanics. |
| Sentient items, artifacts, gods, planes, lore | Rulebook and narrator context; selected plane/effect helpers | Included as reference. Sentience/conflict, bespoke artifact powers and narrative world facts are not comprehensively autonomous engine systems. |
| Licensing, attribution, rulebook rendering/search | Bundled legal page, reader/search/markdown/routes, `test-rulebook` | Included and existing script checks pass; no complete live visual or independent page-by-page PDF transcription comparison performed. |

## Inclusion and structured-data inventory

| Inventory | Current count | Interpretation |
| --- | --- | --- |
| Bundled logical entries | **933** | 36 rules, 9 races, 12 classes, 319 spells, 239 items, 318 monsters. These are logical entries, not original PDF page counts. |
| SRD spells with casting facts | **319 / 319** | Names/levels/components/range/casting information resolve with and without the pack; correctness of every fact is not independently certified. |
| SRD spell general mechanic blocks | **210 / 319** | Save 90, attack 16, buff 61, utility 25, auto 5, heal 12, summon 1. |
| SRD spells without a general block | **109 / 319** | Not equivalent to 109 missing engines: several have dedicated zones, summons, cures or other handlers. Conversely a block does not establish full effect enforcement. |
| Book item titles matching `matchMagicItem` | **103 / 239** | Narrow table lookup, not catalog inclusion or complete item behavior. |
| Book item matches with effects/weapon/armor/charge fields or item-spell mappings | **98 / 239** | Another narrow metadata signal; additional special-case consumable/curse handlers are outside this count. Not comparable to the historical 108/237 metric. |
| Installed `wotc-srd` catalog | Spells **319**, monsters **322**, items **292**, races/subraces **13**, archetypes **12**, feats **1**, backgrounds **1** | Items include mundane equipment; grouped book titles and template/instruction pages differ from catalog rows. One SRD feat/background is not an assertion that PHB extras are absent. |
| Current authored subclass-feature classifier | **533** entries: typed 189, counter 150, narrated 11, plain 183, uncovered 0 | Reproduced classifier output. It inventories categories; it does not certify 339 fully enforced features or all 533 clauses. |

All 319 book spell titles have exact-name SRD catalog rows. Item family headings such as bonus ammunition/armor/shields and monster family-qualified names, templates, and NPC instructions need alias/family handling; unmatched literal titles are not automatically missing playable content. The inventory exposes those distinctions instead of treating different denominators as a regression.

## Intentional simplifications and remaining certification limits

The existing [coverage document](rules-coverage.md) and [historical audit](rules-enforcement-audit.md) explicitly describe several product choices. They should stay distinguished from accidental rule errors:

- Food, water and ammunition are assumed supplied unless the corresponding variant is enabled.
- Theatre-of-mind play does not provide map-level spatial enforcement; the map is planar and does not model heights.
- Object interactions/equipment handling are not a complete free-interaction counter. Shield/armor handling has separate costs.
- A rest is an atomic adjudicated event; interruption is represented by the DM not awarding that rest, rather than a sleep/interruption simulator.
- Multiclassing is capped at three classes, an application restriction rather than a 2014 RAW cap.
- Legacy sheets can be grandfathered, and custom/homebrew rules can deliberately differ from SRD rules.
- Metamagic point spending and choice counts exist, while some shaping effects remain narrated. That is partial mechanical support, not complete Metamagic enforcement.
- Magic items and narrative spell effects can be intentionally manual. Mechanical obligations within them still need accurate support labels and preserved source text.

Useful independent positive controls also held: damage woke a PC from a Sleep-sourced condition; a troll at 0 HP remained alive pending its regeneration rule; wizard 1/paladin 1 and wizard 1/ranger 1 retained the correct first-level shared slots; Ready Haste established held concentration without applying its buff before release. These observations avoid treating previously fixed or separately handled cases as defects.

This audit does **not** certify every atomic rule clause, every 1–20 class/feat combination, every extra third-party spell/item/monster, every variant combination, all homebrew lifecycle routes, full accessibility/responsive behavior, or an end-to-end AI campaign. It did not run a fresh coverage-percentage report, production build, typecheck, or live-model evaluation: the task is rules behavior and documentation, and application code was unchanged. The local Next.js Vitest guide also cautions that async Server Components need separate end-to-end verification.

## Recommended follow-up order and review criteria

1. Address survival and persistent-state defects first: F01, F05, F07–F09, F18. Test transitions and expiry, not just the immediate cast result.
2. Close encounter-resolution bypasses: F13, F15–F17, F21. Use actual AI invocation paths and actual SRD stat blocks alongside handler tests.
3. Unify save semantics and phase timing: F02–F06, F12, F14, F19–F20, F28. Keep natural dice, modified totals, and phase events distinct.
4. Repair character legality and material ownership: F10–F11, F23–F25. Check equivalent server entry points and retain legal choices through edits and regrant.
5. Preserve full monster rules and identify manual mechanical effects: F22, F26–F27. A compact summary must not become the only retained source.
6. Revise current support reporting: F29. Publish inclusion, structured metadata, selected tested behavior, complete effect behavior, and manual exceptions as different facts.

For each future fix, the acceptance criterion in the finding should become a behavior assertion using printed rule expectations and observable persisted state. A rule is not closed merely because a field, counter, parser row, function name, or reassuring tool message exists. The historical ledgers can remain as dated records; a new current ledger should include these findings and explicitly state its denominator and exceptions.
