# Enforcement audit: resources and rests

The second audit and repair (2026-09-30) and the state after it are in [`../rules-enforcement-audit.md`](../rules-enforcement-audit.md); this report describes the first audit.

Area: every limited-use resource, the player usage route, consumables, Wild Shape, Font of Magic, and both rests.
Ruleset: D&D 5e SRD 5.1 (2014). All eight files pass with `node` and with `npx vitest run`, and were run five times in a row with identical results.

## Files written

| File | test() | gap() | Lines |
|---|---|---|---|
| scripts/test-enforce-resource-tables.mjs | 14 | 2 | 368 |
| scripts/test-enforce-resource-spend.mjs | 15 | 4 | 431 |
| scripts/test-enforce-usage-route.mjs | 7 | 2 | 196 |
| scripts/test-enforce-use-item.mjs | 7 | 0 | 126 |
| scripts/test-enforce-short-rest.mjs | 16 | 3 | 447 |
| scripts/test-enforce-long-rest.mjs | 9 | 3 | 308 |
| scripts/test-enforce-wild-shape.mjs | 10 | 3 | 275 |
| scripts/test-enforce-font-of-magic.mjs | 11 | 0 | 199 |
| scripts/lib/enforce-resources.mjs (new shared helper for these files) | | | 135 |
| Total | 89 | 17 | |

Nothing under src/ was edited. The two shared helpers (enforce-harness.mjs, enforce-world.mjs) were not edited. No existing test, package.json or vitest config was touched.

Fixture notes (worked around locally, not bugs in the helpers):
- A campaign seats 6 and a player fields one sheet (UNIQUE campaign_id, user_id), so `openTable()` in enforce-resources.mjs opens a world with maxPlayers 400.
- start_encounter lays out a battle map with random token placement. The only fights in these files that attack at all were the Action Surge gap (since removed as a duplicate); the remaining fights never attack. `beginBoardlessFight()` deletes the encounter's battle_maps row for the spend suite anyway.

## Ruleset as implemented

Counters (src/lib/srd/class-resources.ts, 14 SRD definitions + 122 authored subclass rows + 235 genre rows = 371; docs/rules-coverage.md says "29 counters" for the SRD file, which is stale):
- Rage 2/3/4/5/6 (long), Ki = level from 2 (short), Sorcery Points = level from 2 (long), Second Wind 1 (short), Action Surge 1, 2 at 17 (short), Channel Divinity 1/2/3 at 2/6/18 (short), Bardic Inspiration = CHA mod min 1, Wild Shape 2 (short), Lay on Hands 5 x level (long), Divine Sense 1 + CHA mod min 1 (long), Arcane Recovery and Natural Recovery 1 (long), Breath Weapon 1 (short), Relentless Endurance 1 (long, passive).
- Counters are rebuilt by db/sheets.ts patchSheet whenever level, features, abilities or classes change; used is kept and clamped to the new max. Verified for ability up, ability down and level down.
- Spending goes through use_resource: refuses at 0 left, refuses a feature the sheet lacks, refuses at 0 HP, refuses fractional and oversized amounts.
- Effects that are real state: Second Wind (1d10 + fighter level, fighter levels on a multiclass sheet), Lay on Hands (points spent = points healed, capped at max HP, refused on the dead), Rage (condition "raging", 10 rounds, B/P/S resistance, advantage on STR checks and saves, ends at 0 HP, on a long rest, or after 1 minute by the clock), Bardic Inspiration (condition "bardic inspiration (dN)" on another creature, 100 rounds, consumed by the next d20 check or save), Breath Weapon (reports dice and DC 8 + PB + CON), Wild Shape, Font of Magic.
- Rests: clock advanced by calendar.ts restMinutes; short rest spends hit dice (explicit list or server default toward half HP), refills short-recharge counters and pact slots, applies Song of Rest and Arcane/Natural Recovery; long rest restores HP, slots, all counters, half the total hit dice (min 1), removes one exhaustion level, clears temp HP, death saves, concentration, rage and wild shape, moves pending spells to prepared, heals pets.

Deliberate deviations from SRD 5.1, each pinned by a test() that says so:
| ODM rule | SRD 5.1 | Declared in |
|---|---|---|
| Bardic Inspiration refills on a long rest at every level | short rest too from bard 5 | class-resources.ts comment "modeled as long for simplicity" |
| Asking for Wild Shape while shaped reverts and spends nothing | revert is a bonus action | resource-tools.ts comment |
| Arcane/Natural Recovery picks the slots itself, lowest level first | the player chooses | rest-tools.ts applySlotRecovery comment |
| A spend list asking for more hit dice than are left is cut down, not refused | silent | rest-tools.ts |
| Font of Magic: creating a slot of a level with a spent slot hands the spent one back; a slot broken with less room than its level gives only the points that fit; at full points it is refused | silent / no refund cap stated | resource-tools.ts computeFontOfMagic comments |
| A long rest restores a bound creature to full, a downed one included | silent | rest-logic.ts comment |
| Every sheet at the table rests, companions included (invoke.ts and turn.ts pass listSheets, not fieldedSheets) | n/a | behaviour only |
| Player may mark uses SPENT at any time; in a fight nothing may come back | n/a | usage route header |

Inspiration (item 5 of the brief): ODM has no DM-awarded Inspiration at all. There is no field on the sheet or the campaign and no tool. The only "inspiration" is Bardic Inspiration, modelled as the die condition from resource-tools.ts inspirationCondition, consumed in rolls.ts resolveRollExpression. It cannot stack (a second die on the same holder is refused and costs the bard nothing). Pinned in test-enforce-resource-spend.mjs.

## Findings

### High

**usage-route-refills-class-features**
- Rule: a limited-use feature comes back at the rest its rule names and at no other time.
- Observed: outside an encounter a player POSTs `{ resources: { rage: 0 } }` and has every rage again; same for an emptied Lay on Hands pool. No rest, no clock movement. Status 200.
- Root cause: src/app/api/campaigns/[campaignId]/sheet/usage/route.ts POST. The refill check (lines 74 to 94) sits inside `if (getActiveEncounter(campaignId))`; lines 124 to 138 then write the sent value clamped to 0..max.
- Reproduce: spend three rages through use_resource, then call the route as the owning player.
- Fix: refuse any decrease of a used count on this route (the lead's Adjust dialog already covers corrections), or allow it only up to what the last rest would have returned.
- Classification caveat: the route header describes this as bookkeeping, and test-enforce-spell-slots.mjs (spells agent) pins the slot half as "ODM's rule". The two suites disagree on classification, not on behaviour; both flip together if it is fixed. The maintainers should decide which reading stands.

**usage-route-refills-hit-dice**
- Rule: spent hit dice return at a long rest, half the total at a time.
- Observed: `{ hitDiceSpent: 0 }` with 5 of 5 spent returns all five, so every short rest can roll the full pool again.
- Root cause: same route, lines 117 to 122.
- Fix: as above.

### Medium

**resources-rage-in-heavy-armor**
- Rule: Rage's benefits apply only while not wearing heavy armor.
- Observed: a barbarian in plate (AC 18 derived by the armor engine) rages and takes 5 from a 10 point slashing hit.
- Root cause: src/lib/dm/resource-tools.ts computeUseResource, case "condition" (about line 571), and src/lib/dm/condition-logic.ts pcResistances line 411; neither reads the worn armor.
- Fix: in pcResistances and ragingMeleeBonus, skip the rage riders when acBreakdownFor reports heavy armor worn.

**resources-bonus-action-not-charged**
- Rule: Second Wind and Rage take the bonus action of the turn; a turn has one.
- Observed: after Second Wind on the fighter's own turn `encounter.turnBudget` is still null.
- Root cause: src/lib/dm/mutations.ts applyDmMutation case "use_resource" (line 1071) never touches the turn budget; only action-tools.ts and pc-attack.ts call spendAction.
- Fix: give each ResourceDef an action kind and call spendAction before the spend when an encounter is active. The same root cause makes Action Surge buy nothing, which is already recorded by the combat agent as economy-action-surge-grants-nothing, so it is not repeated here.

**rest-gritty-short-rest-length**
- Rule: gritty realism short rest is 8 hours (DMG), and ODM's own prompt line says so (src/lib/dm/rules-logic.ts REST_VARIANT_LINES).
- Observed: the clock moves 1440 minutes.
- Root cause: src/lib/dm/calendar.ts restMinutes line 359 returns MINUTES_PER_DAY. scripts/test-calendar.mjs pins 1440, so that test asserts the code rather than the rule.
- Fix: return 8 hours and correct test-calendar.mjs.

**rest-long-rest-at-zero-hit-points**
- Rule: at least 1 hit point at the start of a long rest to gain its benefits.
- Observed: a character at 0 HP with two failed death saves, and a stable one at 0 HP, both wake at full HP with the track wiped and every counter back.
- Root cause: src/lib/dm/rest-tools.ts handleTakeRest lines 188 to 199 skip only `deathSaves.dead`.
- Fix: skip sheets with currentHp 0 as well (or give a stable one 1 HP and nothing else).

**rest-one-long-rest-a-day**
- Rule: no more than one long rest per 24 hours.
- Observed: two long rests back to back both restore everything. Under the heroic variant that is a full recovery every in-world hour.
- Root cause: nothing stores when the last long rest ended; handleTakeRest never consults the clock it advances.
- Fix: store the instant of the last long rest on the campaign or sheet and refuse (or downgrade) a second one inside 1440 minutes.

**wildshape-unlisted-form-skips-the-caps**
- Rule: beast form limited by CR and movement at every druid level.
- Observed: a druid 2 becomes "ancient red dragon" with 300 HP and AC 22 when formHp and formAc are passed; damage really lands on the 300.
- Root cause: src/lib/dm/resource-tools.ts computeUseResource, case "wild_shape", unknown-beast path (lines 673 to 691). The inline comment admits the caps cannot be checked; docs/rules-coverage.md lists the caps as enforced with no exception.
- Fix: look the form up in the content pack's bestiary for a CR, and refuse a form with no known CR, or cap formHp by the level's CR ceiling.

### Low

| id | Rule | Observed | Root cause | Fix |
|---|---|---|---|---|
| resources-amount-zero-or-less | an amount is a whole number of at least 1 | amount 0 or -5 spends one use and applies the effect | mutations.ts line 1085 `Math.max(1, args.amount ?? 1)` | refuse amount < 1 |
| resources-rage-ends-without-a-fight | rage ends if a turn ends with no attack made and no damage taken | raging only counts down 10 rounds; after two idle turns it still holds | encounter-tools.ts advancePointer, condition-tick.ts | record attacked/damaged on the turn budget and drop raging at turn end |
| resources-ranger-vanish-counter | ranger Vanish is unlimited | every ranger from 14 carries `mystery_vanish` max 3 | class-resources.ts CUSTOM_RESOURCE_DEFS (lines 423 to 440) drops the row's `classes` list, and the match term is the bare word "vanish" | carry `classes` into the def and honour it in populateResources |
| resources-uncounted-daily-features | Cleansing Touch CHA mod per long rest, Stroke of Luck 1 per rest, Mystic Arcanum 1 each per long rest | no counter, so no limit | SRD_RESOURCE_DEFS has no rows; test-feature-coverage.mjs lists them as acknowledged guidance-only | add three defs |
| rest-hit-die-minimum-per-die | each die heals die + CON mod, minimum 0 per die | a 1 and a 6 at CON -2 heal 3, not 4; Song of Rest's die is eaten the same way | rest-logic.ts hitDicePlanExpression builds one expression; rest-tools.ts line 289 floors the total | roll per die and floor each |
| rest-invalid-spend-list-runs-anyway | an unreadable spend list is refused | dice 0, -1 or 1.5 falls to the flat schema, the list is dropped, the rest runs on default spending and an hour passes | rest-tools.ts parseRestArgs lines 95 to 112 | return null when `spend` was present but invalid |
| rest-concentration-outlives-the-spell | concentration ends with the spell | after a short rest the cleric is still stored as concentrating on Bless though "blessed" expired | condition-tick.ts tickSheetConditions, clock.ts advanceClock | clear concentratingOn when the last condition of that spell expires |
| wildshape-has-no-duration | form lasts half druid level in hours | a druid 2 is still a wolf after 6 hours and after a short rest, which also refills the use | wildShape carries no timer | store an expiry instant and revert in advanceClock |
| wildshape-healing-skips-the-beast | healing in form restores the beast's HP | heal raises the druid's own currentHp; beastHp unchanged | mutations.ts case "heal" (line 847) ignores sheet.wildShape | route healing to beastHp while shaped |

## Not modelled (no gap recorded: the player gains nothing, or no mechanic exists to test)

- DM-awarded Inspiration.
- Tiefling Infernal Legacy spells (Hellish Rebuke at 3, Darkness at 5) and drow Drow Magic spells (Faerie Fire at 3, Darkness at 5): only the cantrip is granted, no spell and no once-per-long-rest counter.
- Font of Inspiration (short-rest Bardic Inspiration from bard 5): documented simplification.
- Food and drink as a condition of removing exhaustion on a long rest.
- Interrupted rests (an hour of walking, fighting or casting).
- A stable creature at 0 HP regaining 1 HP after 1d4 hours.
- Lay on Hands spending 5 points to cure a disease or poison (guidance text only).
- Divine Sense at CHA below 10: ODM floors at 1 use where 1 + CHA mod would be 0.
- Action Surge limited to once per turn at fighter 17 (both uses can be spent in one call with amount 2).
- Rage's "cannot cast or concentrate" is enforced only in the battle map hand (battlemap/hand-spells.ts), outside my scope.

## Could not test, and why

- Benched characters under multiCharacter "one_active" resting or not: the fixture cannot give one user two sheets (UNIQUE constraint on campaign_id, user_id in the test database). The campaign agent has a gap about second characters.
- Torches burnt by a rest: gutterBurntLights needs a live battle map with lights; scripts/test-light-timers.mjs covers the logic. The clock advance that drives it is asserted to the minute.
- Turn-by-turn rage expiry through the AI turn loop: used the exported skipCurrentTurn instead of a model turn.
- Pact slot refill and the long-rest slot restore were left to test-enforce-spell-slots.mjs, and the per-level class table counters (plus the level 20 capstones, paladin Channel Divinity, Indomitable, Song of Rest die) to test-enforce-class-tables.mjs, to avoid duplicates.
