# Progression: enforcement audit

Area: class progression 1 to 20, subclasses, experience and levelling, the level-up flow, feats and Ability Score Improvements, companion auto-levelling.
Ruleset: D&D 5e SRD 5.1 (2014). Date: 2026-09-27. Nothing under src/ was edited.

## Headline

The class DATA is right. Every SRD class table, every SRD subclass table, the XP table, the proficiency bonus, hit dice, slot ceilings and almost every scaling counter match the SRD at all 20 levels, both on a sheet walked up through the route and on a sheet created at a level.

The level-up REQUEST is not checked. The single-class branch of `PATCH /api/campaigns/[campaignId]/sheet` has one gate (`level > sheet.level`, route.ts:725) and then hands the whole request to `patchSheet` (route.ts:823). Everything the SRD rules about a level-up is computed in `LevelUpDialog.tsx` and trusted by the server. A crafted request takes level 20 on 0 XP with 500 hit points, 30 in every score, any feats, any class's features, a full heal, all slots back, and a million gold.

Two engine bugs were found in scaling that is otherwise correct: Brutal Critical adds 4 dice at barbarian 13 and 9 at 17 (the three tiers sum), and Song of Rest never grows past a d6.

## Ruleset as implemented

- Levelling is by experience only. There is no milestone setting in `gameSettingsSchema`. XP arrives by `award_xp`, `party_award`, the fight-end award in `enemy-damage.ts`, and a chapter-close award (`chapter-close.ts awardChapterMilestoneXp`, a tenth of the gap between rows, clamped 25 to 1000).
- The XP table `XP_THRESHOLDS` (srd/index.ts:540) is the SRD's, row for row.
- An award never raises a level. It publishes `level_up_available`; the client opens the dialog when `levelForXp(xp) > level` (SessionView.tsx:299). The player takes all earned levels in one dialog.
- ODM's own ceiling: one award is at most 20000 XP (mutations.ts, MAX_XP_PER_AWARD).
- The DM's `update_sheet` is bounded by `sheetBuffViolation` (one level at a time, no XP worth more than one level, scores at most 20, bounded HP and gold). The player's route has none of these bounds.
- Class features: `class-features.json` plus `subclasses.json`, granted by `populateFeaturesForClasses`. Server-side at creation, on the multiclass branch and for companions. Client-side on a single-class level-up.
- Counters: `populateResources` runs inside `patchSheet` whenever level, features, abilities or classes change; spent uses are preserved and clamped.
- Artificer is shipped (outside SRD 5.1); its published table is matched.
- 12 SRD subclasses plus 105 authored ones. Feats: the content pack (142 rows with the pack installed, including SRD Grappler) plus 52 authored in `authored-feats.json` (the 2014 Alert among them).

Documented deviations, each pinned by a test():
- Bardic Inspiration refills on a long rest at every level (class-resources.ts comment; SRD adds the short rest at bard 5).
- ASIs at character levels 4, 8, 12, 16, 19 (docs/rules-coverage.md "Kept simplifications").
- A patron's spells arrive on the sheet for free (docs/rules-coverage.md "Subclass spell lists"; SRD only adds them to the warlock's list).
- A companion's level-up picks no subclass (autoLevelCompanion header comment).

### The ASI simplification, precisely

`ASI_LEVELS = [4, 8, 12, 16, 19]` (asi.ts:4). `earnedAsiCount(level)` and `crossedAsiLevels(from, to)` take no class. So:
- single-class fighter: 5 improvements instead of 7. The ones at 6 and 14 never appear in the dialog or the builder.
- single-class rogue: 5 instead of 6. The one at 10 never appears.
- every other class: correct.
The doc line sits under "Multiclassing" and calls it "the pre-existing simplification". Nothing states that a single-class fighter or rogue loses improvements, so it is pinned as ODM's rule AND recorded as a gap (progression-fighter-rogue-asi) for the maintainer to decide.

## Files written

All pass with `node scripts/<file>` and `npx vitest run scripts/<file>`. All under 500 lines. No em or en dashes.

| File | test() | gap() |
|---|---|---|
| scripts/lib/enforce-srd-progression.mjs (the literal SRD tables, shared by the five suites; 495 lines) | | |
| scripts/test-enforce-class-tables.mjs | 32 (8 written, two of them run once per class for 13 classes) | 7 |
| scripts/test-enforce-levelup.mjs | 6 | 13 |
| scripts/test-enforce-xp.mjs | 13 | 4 |
| scripts/test-enforce-subclasses.mjs | 10 | 2 |
| scripts/test-enforce-feats.mjs | 5 | 11 |
| Total | 66 | 37 |

The shared helpers were not edited. One new helper file was added under scripts/lib because five suites need the same tables; Vitest does not pick it up.

## Findings

Reproduce any of them with `ODM_ENFORCE_REPORT=/tmp/x.jsonl node scripts/<file>`; the `observed` field carries the value seen.

### High

**levelup-without-xp**. Rule: a level is earned (300 XP for 2nd). Observed: a level 1 sheet with 0 XP reaches 2 on request, on an active table and in the lobby (where it also passes the campaign's starting level). Root cause: route.ts PATCH:725, `levelingUp` never reads `sheet.xp`. Fix: refuse when `level > levelForXp(sheet.xp)` (after fixing xp-starting-level-holds-none, or every table that starts above 1 locks).

**levelup-beyond-xp**. Observed: 300 XP, `{ level: 20 }` answers 200 and stores level 20. Same root cause. Same fix.

**levelup-max-hp-unbounded**. Rule: at most hit die maximum plus CON modifier per level. Observed: maxHp 500 stored for a fighter 2. Root cause: route.ts:823 into sheets.ts patchSheet:541; the gain exists only in LevelUpDialog.tsx:166. Fix: compute the legal range server-side from class die, CON and levels gained; accept a value inside it.

**levelup-heals**. Observed: a fighter at 8 of 28 HP levels up to 36 of 36 with 50 temporary HP. Root cause: `currentHp` and `tempHp` are in patchSheetSchema and stored as sent. Fix: server sets currentHp to old plus gain; drop tempHp from the player schema.

**levelup-features-by-hand**. Observed: a wizard 2 sends Rage, Sneak Attack and "Extra Attack (3)"; the stored sheet has a Rage counter, 1 sneak die and 3 extra attacks. Root cause: sheets.ts patchSheet:586 stores `patch.features`; the single-class branch never calls populateFeatures. Fix: regrant server-side as the multiclass branch does, and accept only choice-sourced entries that `pruneChoiceFeatures` allows.

**levelup-writes-engine-state**. Observed: xp 355000, gold 1000000, ac 30, conditions cleared (poisoned removed), equipment replaced, all in one level-up. Root cause: route.ts:721 to 734 only restricts keys when NOT levelling. Fix: an allowlist of level-up keys.

**levelup-refills-slots**. Observed: a wizard with every slot spent sends `used: 0` and gets them all back. Root cause: `spellcasting.slots` stored as sent on the single-class branch. Fix: build slots server-side carrying `used` over, as buildMulticlassLevelUp does. (Slot maxima being client-written is the spells agent's slots-levelup-trusts-client.)

**asi-without-a-slot**, **asi-more-than-two-points**, **asi-past-twenty**. Observed: STR 17 at level 2; +47 points from one improvement; STR 21. Root cause: `abilities` stored as sent (patchSheet:526); abilityScoresSchema allows 30 (schemas/sheet.ts:8). Fix: send the AsiChoice list, not the scores, and apply `applyAsiChoices` server-side for `crossedAsiLevels` slots only.

**feat-without-a-slot**. Observed: three feats at fighter 2; a feat plus +2 STR at fighter 4. Root cause: patchSheet:585. Fix: as above, feats come from the same validated choice list.

**progression-brutal-critical-stacks**. Rule: 1, 2, 3 extra dice at barbarian 9, 13, 17. Observed: 1 at 9, 4 at 13, 9 at 17. Root cause: feature-effects.ts combatRiders:733 does `critExtraDice +=` for every matching feature, and a barbarian 17 holds all three "Brutal Critical (n)" entries, each resolving the level-based dice function. pc-attack.ts:787 rolls the total. The existing test only ever passes one entry. Fix: take the largest per feature family, as `extra_attack` does, and add Savage Attacks on top.

### Medium

**levelup-features-not-granted**. Observed: `{ level: 5, maxHp, hitDice }` leaves a fighter 5 with Fighting Style and Second Wind only. Root cause: same as features-by-hand.

**xp-dm-level-leaves-the-sheet-behind**. Observed: update_sheet level 4 to 5 leaves 4 hit dice and no Extra Attack; the dialog will not open afterwards. Root cause: patchSheet resizes counters on a level change but not features or hit dice. Same for the lead's `PATCH /sheets/[sheetId]`. Fix: regrant inside patchSheet when level or class changes.

**levelup-hit-dice-unvalidated**. Observed: a wizard 2 holding 20d12 with spent dice returned; a request without hitDice keeps the old total. Fix: server sets die and total, carries spent.

**levelup-while-dying**. Observed: the dialog's own request lifts a dying fighter to 8 HP with `deathSaves` still set. Fix: route HP through the heal path, or clear deathSaves when currentHp rises above 0.

**levelup-subclass-of-another-class**, **levelup-subclass-changed**. Observed: a fighter stores "Life Domain"; a Champion 3 becomes a Battle Master at 4. Root cause: patchSheet:587. No features follow a foreign subclass (verified by a test), so the harm is a wrong sheet and prompt. Fix: validate against subclassNamesFor plus the pack's archetypes, and refuse a change once set.

**xp-starting-level-holds-none**. Rule: a level 5 character has 6500 XP. Observed: every sheet is created with xp 0 (sheets.ts createSheet:283), so a level 5 hero needs 14000 earned, not 7500, to reach 6. Awarding 7500 offers nothing. Fix: seed xp with `XP_THRESHOLDS[level - 1]` at creation.

**progression-paladin-channel-divinity**. Rule: a paladin has 1 use at every level. Observed: 2 at paladin 6, 3 at 18. Root cause: class-resources.ts:301, one def for cleric and paladin using channelUses:212. Fix: branch on the owning class.

**progression-song-of-rest-die**. Observed: d6 at every level. Root cause: songOfRestDieFor:795 returns the first matching feature, always "Song of Rest (d6)". Fix: take the largest die among matches.

**progression-fighter-rogue-asi**. See above.

**asi-constitution-not-retroactive**. Observed: CON 14 to 16 at fighter 4 gives 36 HP, not 40. Root cause: LevelUpDialog.tsx:165 uses the old CON and adds no back-pay.

**asi-lowers-a-score**. Observed: INT 8 to 3 to fund STR.

**feat-prerequisite-unchecked**. Observed: a human fighter with 8 in every score and no armor training takes Grappler, Defensive Duelist, Inspiring Leader, War Caster, Heavy Armor Master and Elven Accuracy. Nothing reads a prerequisite anywhere, server or UI (AsiFeatEditor lists every feat). All 52 authored prerequisites parse into five checkable kinds (a test pins that).

**feat-elven-accuracy-never-read**. Observed: `hasElvenAccuracy` (feature-effects.ts:934) reads `sheet.features`; a feat taken in the app lands in `sheet.feats`, so the third d20 is never rolled.

**feat-sheet-numbers-not-applied**. Observed: Actor leaves CHA unchanged, Tough adds no HP, Mobile no speed. 24 of the 52 authored feats open with an ability increase that is never offered or applied.

### Low

- **progression-rage-unlimited-at-20**: 6 rages at barbarian 20 (rageUses:204).
- **progression-wild-shape-unlimited-at-20**: 2 uses at druid 20 (class-resources.ts:329).
- **progression-indomitable-uncounted**: no counter exists.
- **levelup-subclass-early**: a fighter 2 stores "Champion"; features are still held to their levels.
- **feat-taken-twice**, **feat-unknown-name**: stored as sent.
- **xp-companion-never-improves**: autoLevelCompanion applies no ASI; scores at 20 are the scores at 1.
- **xp-console-correction-does-nothing**: the console's "Correct a sheet" form sends `{ field, value }` (catalog-party.ts:345), the handler parses sheet keys (mutations.ts:1705), so it always answers "changed nothing". Outside my area strictly; found while testing the DM level path.
- **subclass-genie-spell-above-slot**: The Genie lists Phantasmal Force (2nd level) at warlock 1 and again at 3 (subclasses.json:4104).
- **subclass-loose-name-grants-features**: a paladin whose subclass reads "Oath" gets Oath of Devotion's five features (features.ts subclassMatches:178).

## Companions

An auto-levelled companion holds a legal sheet at every level from 1 to 20 for fighter, wizard and monk: level, proficiency bonus, hit dice, average HP, class features, counters, slot ceiling. Damage taken, spent uses and spent hit dice survive the level-up, and one award can take several levels. Not legal or missing: no subclass (documented), no ASI (gap), and a caster's spell list never grows (a wizard 20 still knows the one spell it joined with; spells agent's area).

## Not modelled

- Milestone levelling.
- Level-up restricted to a rest or to out-of-combat: a level-up in an active encounter answers 200. The SRD does not forbid it, so no gap.
- Indomitable, and feats other than Alert and Observant, as mechanics.
- Circle of the Land terrain spells and the Fiend's expanded list (ODM grants neither; consistent with the SRD for the Fiend).
- Rolled HP validation: the dialog rolls with Math.random in the browser.

## Could not test

- The dialog itself (React). Its request shape was reproduced by hand.
- Feat prerequisites from the content pack on CI: the pack is absent there, so the suite uses names only and reads prerequisites from the bundled JSON.

## Notes for the coordinator

- No suite of mine POSTs a character; sheets are made with createSheet. Companions are recruited as `kind: "guest"`, which queues no portrait.
- One of my early PROBES (not a suite) called add_companion with `kind: "party"` twice. That queued two real portrait renders on this machine's ComfyUI and hung the probe until killed. The scratch database is gone; the renders may have completed or be sitting in the queue.
- No gap id of mine starts with "multiclass-". Where the multiclass branch shares a hole, my notes point at test-enforce-multiclass-levelup.
