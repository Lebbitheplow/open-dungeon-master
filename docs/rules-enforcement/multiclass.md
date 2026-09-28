# Enforcement audit: multiclass

Area: multiclassing end to end, through the real level-up path (PATCH on
`src/app/api/campaigns/[campaignId]/sheet/route.ts`), the rest, casting and
resource engines reached through `invokeEngine`, and the library round trip.

All four suites pass both ways (`node scripts/<file>` and `npx vitest run <file>`).
Totals: 50 test(), 18 gap(). Nothing under `src/` was edited.

## Files written

| File | Lines | test() | gap() |
|---|---|---|---|
| `scripts/test-enforce-multiclass-levelup.mjs` | 484 | 20 | 7 |
| `scripts/test-enforce-multiclass-slots.mjs` | 382 | 14 | 4 |
| `scripts/test-enforce-multiclass-features.mjs` | 305 | 12 | 1 |
| `scripts/test-enforce-multiclass-library.mjs` | 316 | 4 | 6 |
| `scripts/lib/enforce-multiclass.mjs` (shared helper, not a suite) | 199 | | |

The helper holds the literal SRD tables (prerequisites, hit dice, the multiclass
slot table), the route caller, a one-hero-per-case `hero()` that replaces the
owner's sheet, `assertRefused` (refusal plus a deep-equal proof that nothing was
written) and `assertCoherent` (every mirror and counter invariant of a multiclass
sheet). The two shared helper files were not touched.

## Ruleset as implemented

ODM implements SRD 5.1 multiclassing with these properties, all verified:

- Prerequisites: the SRD table exactly, checked in both directions, 13 minimum.
  All 132 ordered SRD class pairs pass at 13 and are refused at 12 for the new
  class and for the held class. A refusal writes nothing.
- Proficiency grants: the SRD multiclass row for all 12 classes, never a saving
  throw. Bard stores the literal string "one musical instrument". Skill pick:
  rogue and ranger from their class list, bard any skill, validated server side.
  An invalid pick is dropped silently, not refused (state is correct).
- Hit dice: per-class pools created on the first multiclass level, carrying
  spent dice over; the scalar `hitDice` is a mirror (die of the first class,
  totals summed). Short rest spends biggest die first and clamps to what is
  left; long rest returns half, rounded down, minimum 1, biggest die first.
- Spell slots: shared table for two or more Spellcasting classes; one
  Spellcasting class keeps its own table; warlock excluded, Pact Magic apart,
  refilled on a short rest, and pact and shared slots pay for either class's
  spells. ODM's JSON tables match the SRD rows for levels 1 to 20 (full, half,
  pact, multiclass).
- Character level vs class level: proficiency bonus and cantrip scaling by
  character level; features, Sneak Attack, Martial Arts, Rage uses and damage,
  ki, Lay on Hands, sorcery points, Second Wind by class level. Extra Attack
  does not stack (fighter 5 / paladin 5 = 2; fighter 11 = 3), and the turn
  budget refuses a third swing in a real fight. One Unarmored Defense, by
  acquisition order. Save DC and spell attack use the owning class's ability.
- Player-writable fields: `class`, `classes`, `hitDicePools`, `proficiencies`,
  `resources` are not in `patchSheetSchema` and are dropped. On the multiclass
  path `hitDice`, `gold`, `xp`, `ac`, `conditions`, `equipment` and
  `spellcasting` are ignored too. Outside a level-up only portrait, notes and
  backstory pass.

Deliberate deviations from SRD 5.1, each pinned as a test() with a comment:

| Deviation | Declared in |
|---|---|
| At most 3 classes (SRD: no limit) | `multiclass.ts` MULTICLASS_CAP comment, docs/rules-coverage.md |
| ASIs at CHARACTER levels 4/8/12/16/19. SRD grants by class level, plus fighter 6 and 14, rogue 10. A fighter 3 / rogue 1 earns one under ODM, none under the SRD. Self-consistent: each threshold is crossed exactly once from 1 to 20 | docs/rules-coverage.md "Kept simplifications" |
| Lead edits to class, subclass, level fold into the first class entry | same |
| Characters are created single-class | same (but see finding 1) |
| Custom genre classes: prerequisite is 13 in the casting ability, else the first save; grants are armor capped at medium plus tools | docs/rules-coverage.md, `multiclassPrereq` |
| Artificer (not SRD 5.1) counts half its levels rounded UP | `casterLevelFor` comment |
| A table can turn multiclassing off (new classes only) | route comment |

## Findings

### High

1. `multiclass-created-multiclassed`
   - Rule: characters are created single-class; a second class is taken at a level-up.
   - Observed: POST /sheet at a level 3 table with `classes: [fighter 11, wizard 9]`
     and `hitDicePools` of 20d12 twice is accepted (201). Features for fighter 11
     and wizard 9 are granted (Extra Attack (2)), no prerequisite is checked, the
     level column says 3 until the first patch, when it becomes 20.
   - Root cause: `src/lib/schemas/sheet.ts` createSheetSchema lines 238 to 239 carry
     `classes` and `hitDicePools` for the library round trip, and
     `src/lib/db/sheets.ts` createSheet lines 232 to 235 and 306 to 309 trust them.
     The same payload reaches createSheet from PUT /sheet and from POST /api/characters.
   - Reproduce: the gap in test-enforce-multiclass-library.mjs.
   - Fix: strip both fields in the player-facing routes (keep them only on the
     internal instantiate path), or validate that the levels sum to the table's
     level and that every class passes `canMulticlassInto`.

2. `multiclass-levelup-hp-unchecked`
   - Rule: a level adds that class's hit die (or its fixed value) plus the CON modifier.
   - Observed: `maxHp: 500` on a wizard level is stored (28 to 500).
   - Root cause: route.ts buildMulticlassLevelUp lines 352 to 353 copy
     `data.maxHp` and `data.currentHp`. The DM tool has a cap
     (`mutation-math.ts` sheetBuffViolation line 38); the player route has none.
   - Fix: compute the legal range from the class being levelled
     (1 to die, plus CON modifier, per level gained) and refuse outside it.

3. `multiclass-levelup-scores-unchecked`
   - Rule: scores rise only through an ASI, to at most 20.
   - Observed: all six scores set to 30 at character level 2.
   - Root cause: route.ts line 354. Prerequisites read the stored scores, so the
     bypass takes two requests: write the score, then multiclass.
   - Fix: allow a change only when `crossedAsiLevels` is non-empty, bound it to
     +2 total per threshold and to 20.

4. `multiclass-levelup-feature-forged`
   - Rule: class features come from class levels.
   - Observed: `features: [{ name: "Extra Attack (3)", source: "story" }]` sent by
     a fighter 1 / rogue 1 is kept, and `attacksAllowedFor` returns 4.
   - Root cause: `src/lib/srd/features.ts` populateFeaturesForClasses lines 298 to
     310 keep every story, feat, choice and background entry from the request,
     and `feature-effects.ts` matches by name only.
   - Fix: on player patches accept only `choice` entries that `optionSlotsFor`
     allows and carry story and feat entries over from the STORED sheet.

5. `multiclass-levelup-many-levels`
   - Rule: one level at a time (ODM's own words in sheetBuffViolation).
   - Observed: a level 1 fighter with 0 XP sends `level: 8, levelUpClass: "wizard"`
     and becomes fighter 1 / wizard 7.
   - Root cause: route.ts lines 87 to 91 only require `gained >= 1`. XP is never
     compared with `XP_THRESHOLDS` on either level-up path.
   - Fix: require `gained === 1` and an earned level (XP threshold or a lead grant).

6. `multiclass-spell-above-class-level`
   - Rule: each class learns spells as if single-classed.
   - Observed: a cleric 5 / wizard 1 writes Fireball and Wish in the spellbook.
   - Root cause: route.ts lines 240 to 300 count the picks and never check their
     level; the multiclass branch returns at line 759 before the
     `spellListProblems` call at line 810 that holds this rule for single-class
     sheets. docs/rules-coverage.md lists this as enforced at level-up.
   - Fix: run `spellListProblems` over the built sheet before patching.

7. `multiclass-strip-keeps-spell-slots`
   - Rule: a character stripped of its only caster class has no spell slots.
   - Observed: fighter 3 / wizard 4 entering a level 3 table becomes a fighter 3
     with 4 first-level and 3 second-level slots, ability INT, a spellbook and
     `casters: []`.
   - Root cause: `src/lib/characters/adapt.ts` adaptSheetToLevel lines 116 to 125
     only rewrite slots when the new table is non-empty; lines 96 to 103 filter
     caster entries but never null `spellcasting`.
   - Fix: when no remaining class casts, set `spellcasting` to null; otherwise
     always replace the slots, empty table included.

### Medium

8. `multiclass-cantrips-uncounted`: a cleric 1 takes 7 cantrips in one request
   (up to 20). Root cause: route.ts lines 247 to 252 and 300 split cantrips off
   before the count and append them whole. Fix: as finding 6.

9. `multiclass-spell-off-class-list`: a cleric 1 learns Eldritch Blast and Magic
   Missile. No pick is checked against the class list on any level-up path
   (`checklistClassSpell` is only used by the prepare route). Fix: validate
   each pick with `searchSpells` or `checklistClassSpell` for the class.

10. `multiclass-pact-slot-refunded`: a warlock 3 with both pact slots spent takes
    a fighter level and has both back. Root cause: route.ts line 343 reads
    `spellcasting.pact.used`, which does not exist on a single-class warlock
    (its slots live in `spellcasting.slots`). Fix: seed `used` from the
    single-class slot at the pact level.

11. `multiclass-expertise-unearned`: a fighter 3 / wizard 1 sends `expertise` and
    holds it. Root cause: route.ts lines 147 to 152 filter to proficient skills
    only. Fix: cap by `expertiseSlotsFor` summed over the class list.

12. `multiclass-paladin-channel-divinity-uses`: fighter 2 / paladin 6 has 2 uses;
    so does a single-classed paladin 6. SRD paladins have one. Root cause:
    `src/lib/srd/class-resources.ts` channelUses lines 212 to 216 is the cleric
    table applied to `classIds: ["cleric", "paladin"]` (lines 300 to 306).
    Fix: size by cleric level when held, else 1.

13. `multiclass-adapt-hp-first-class-die`: fighter 3 / wizard 2 adapted to level 5
    has 34 HP (a fighter 5's) instead of 30. Root cause: adapt.ts lines 106 to
    115 call `suggestedStartingHp(sheet.class, ..., level)`. Fix: sum per class.

14. `multiclass-sync-drops-proficiencies`: tools, skill pick and expertise gained
    from a second class do not survive save and re-entry. Root cause:
    `src/lib/db/characters.ts` syncProgressToLibrary lines 329 to 360 never
    write `proficiencies`. Fix: add it to the merge.

### Low

15. `multiclass-subclass-wrong-class`: "Champion" attaches to a rogue entry. It
    grants nothing, but blocks a real pick later (route.ts lines 116 to 118).
16. `multiclass-subclass-before-its-level`: "Thief" attaches at rogue 1. Label
    only, features still wait. Fix for both: check `subclassLevelFor` and
    `subclassNamesFor` (allowing content-pack names).
17. `multiclass-lead-level-leaves-pools`: `update_sheet { level: 9 }` on a
    rogue 5 / fighter 3 gives rogue 6 but pools stay 5 + 3, so hit dice total 8
    at level 9. Root cause: `sheets.ts` patchSheet lines 482 to 497.
18. `multiclass-lead-class-duplicates`: `update_sheet { class: "fighter" }` on
    rogue / fighter yields fighter / fighter, with the rogue pool left behind.

## Overlap note

Findings 2, 3, 4 and 5 sit in `buildMulticlassLevelUp`, a separate branch from
the single-class level-up. The single-class branch passes the same fields
straight to `patchSheet`, so the progression area likely reports siblings. A
fix has to cover both branches.

## Not modelled

- Third casters. `casterLevelFor` reads the class's `casterType` only, so an
  Eldritch Knight or Arcane Trickster (both present in `subclasses.json`, neither
  in SRD 5.1) adds nothing to the caster level and has no slots of its own.
  The player loses rather than gains, so no gap().
- ASI validation of any kind on the server (see finding 3); the thresholds
  exist only as helpers the client uses.
- Hit points per class on level-up: the server never computes them.
- Druid armor restriction (no metal) on the multiclass grant.
- Bardic Inspiration short-rest recharge from bard 5 (documented in the def).
- Rounding of combined half-caster levels. The SRD wording is ambiguous between
  halving per class and halving the sum; ODM halves per class. The suite only
  asserts cases where both readings agree.

## Could not test, and why

- Cantrip scaling without the content pack: tiers come from pack text, so the
  test returns early when `world.hasPack` is false.
- Fights place tokens on a generated map at random distance, so melee and
  ranged attacks are refused for reach or line of sight. The two fight tests
  delete the encounter's `battle_maps` row to fight without a board. The
  `mapsEnabled` setting does not stop `start_encounter` creating a map.
- `update_sheet` through the human façade requires `field` and `value`, which
  the handler then discards; the suite sends those plus the real patch keys.

## Operational warning

POST /sheet with a new character and no portrait queues a real image render
(`queueLibraryPortrait`). One early probe of mine triggered a single render on
this machine's ComfyUI before I noticed. Every creation payload in the suites
now carries a portrait, so the committed tests queue nothing. Other areas'
suites that POST new characters should do the same.
