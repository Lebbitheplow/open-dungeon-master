# Rules enforcement audit: character creation

The second audit and repair (2026-09-30) and the state after it are in [`../rules-enforcement-audit.md`](../rules-enforcement-audit.md); this report describes the first audit.

Area: "creation". Repo: /home/lebbi/open-dungeon-master. Date: 2026-09-27.
All six suites pass both ways (`node scripts/<file>` and `npx vitest run scripts/<file>`),
with the content pack present and with it absent (`CONTENT_DB_PATH` pointed at nothing).
Nothing under `src/` was edited.

## Headline

The character builder computes a rules-legal sheet. The server does not check it.
`POST /api/campaigns/[campaignId]/sheet`, `PUT` on the same route, `POST /api/characters`,
`PUT /api/characters/[characterId]` and the import route all validate with one zod schema
(`createSheetSchema`) whose bounds are storage bounds, not rules. The only rules checks on
a new character are: the spell lists (`spellListProblems`), the server-side grant of class,
race and background features, the pruning of "choice" features, and the level (always the
table's). Everything else is stored as sent. A request that never touched the builder can
store, at level 1: six ability scores of 30, 500 hit points, AC 30, twenty d12 hit dice on
a wizard, all six saves, all eighteen skills with expertise, heavy armor training, thirty
feats, Extra Attack (3) and a Rage counter, ten 9th-level slots, fighter 20 / wizard 20,
and a million gold.

## Ruleset as implemented

### Which edition, and where each piece of data comes from

| Source | What it is | Edition |
|---|---|---|
| README badge, docs/rules-coverage.md, docs/LICENSES.md | State the ruleset: "D&D 5e SRD 5.1" | 2014 |
| `src/lib/srd/skills.json`, `spell-slots.json`, `class-features.json` | SRD 5.1 data (CC-BY-4.0) | 2014 |
| `src/lib/srd/classes.json` | The SRD twelve, all correct against the SRD table, PLUS `artificer`, which is not in SRD 5.1 (its `_license` line still says "derived from the SRD 5.1") | 2014 + ODM |
| `src/lib/srd/races.json` | 31 rows. 9 are SRD 5.1. 7 are 2014 Player's Handbook subraces not in the SRD (mountain dwarf, wood elf, drow, stout halfling, forest gnome, deep gnome, variant human). 15 are lineages from later books restated by ODM (aasimar, goliath, firbolg, tabaxi, kenku, tortle, four genasi, changeling, warforged, goblin, bugbear, lizardfolk). The file's `_license` claims SRD 5.1 for all; `_license_authored` says "below the SRD nine are original content" | 2014 |
| `src/lib/srd/backgrounds.json` | Acolyte is SRD 5.1. The other 12 are the 2014 PHB backgrounds (the file calls them "generic skill pairings") | 2014 |
| `src/lib/backgrounds/catalog.json` | 36 setting backgrounds written by ODM | ODM |
| `src/lib/classes/*.json` | 36 genre classes written by ODM (6 per genre), each borrowing an SRD spell list | ODM |
| `src/lib/srd/subclasses.json`, `authored-*.json` | 105 subclasses, spells, 52 feats written by ODM ("odm-expanded") | ODM, 2014 shape |
| Content pack v1 (`wotc-srd`, `toh`, `a5e`, `taldorei`, `o5e`, ...) | Open5e v1: SRD 5.1 plus third-party OGL/CC books | 2014 family |
| Content pack v2 backfill (`srd-2024`, `a5e-ag`, `a5e-ddg`, `a5e-gpg`, `bfrd`, `spells-that-dont-suck`) | Added only where a NAME is new (dedupe by name, `scripts/import-open5e.mjs`) | includes 2024 |

### 2024 content that reaches the 2014 engine (pack installed)

The backfill dedupes by name, so a 2024 row arrives exactly when its name is new. That is
why there are no 2024 backgrounds or classes in the pack (Acolyte, Fighter and so on
already existed) and no weapon mastery (the 152 `srd-2024` items are plain gear). What did
arrive:

- Species: `orc` and `goliath` (srd-2024). The Orc is offered in the builder with no
  ability score increase, "Common plus two languages of your choice" (the 2024 rule,
  hard-coded at `src/lib/content/mechanics.ts:334`), and a "Darkvision" trait with no range,
  which the light model reads as no darkvision. The Goliath takes numbers from ODM's bundled
  goliath and shows 2024 trait names. Gap `edition-2024-species`.
- Feats: 16 srd-2024 rows, including the only "Alert" in the pack (2024 text: add the
  proficiency bonus, swap initiative) while the engine applies the 2014 +5; the four 2024
  fighting-style feats (Archery, Defense, Great Weapon Fighting, Two-Weapon Fighting, which
  do nothing as feats because the engine matches "Fighting Style: X"); "Ability Score
  Improvement" as a feat; and seven epic boons ("to a maximum of 30"). Gap
  `edition-2024-feat-text`.
- Archetypes: Draconic Sorcery, Evoker, Fiend Patron, Warrior of the Open Hand (2024 names,
  chosen at level 3 in 2024) beside the 2014 ones. They match no ODM feature table, so they
  grant base-class features only. Not tested here (subclass area).
- Spells: 20 srd-2024 spells, including "Divine Smite" as a spell. Not tested here.
- Level Up (a5e) backgrounds carry an ability score increase in their v2 rows. ODM ignores
  it (`backgroundMechanics` has no field for it). Correct, pinned by a test.

No 2024 rule was found in the bundled (no-pack) data.

### Creation methods

Standard array, 27-point buy (8 to 15, costs 0,1,2,3,4,5,7,9), and 4d6 drop lowest as a
pool of six placed freely. All three are implemented in the BROWSER. ODM's own rule: the
pool may be rerolled only while it totals under 70. Racial bonuses are added after; level
improvements cap at 20 (`applyAsiChoices`). Improvements are at character levels 4, 8, 12,
16, 19 only: the fighter's extra ones at 6 and 14 and the rogue's at 10 are not granted
(documented, rules-coverage.md "Kept simplifications").

### Deliberate deviations from SRD 5.1 (documented by ODM, pinned by tests)

| Deviation | Declared in |
|---|---|
| Player may type Max HP, AC, gold before saving | `schemas/sheet.ts` comment on `createSheetSchema`; FinishStep / EquipmentSection steppers |
| A typed AC pins the armor engine off (`acOverride`); an absent flag is read as pinned | `schemas/sheet.ts`, `db/sheets.ts:260` |
| Starting gear is a fixed loadout per class plus the background kit, plus anything the player adds | `srd/weapons.ts defaultLoadout`, `srd/armor.ts defaultArmor`, `useBuilderDerived.ts` |
| Unknown class or race accepted, granted nothing | homebrew and pack rows; `features.ts` |
| "story", "feat", "background" features survive every regrant | `features.ts populateFeaturesForClasses` header |
| Characters created single-class | rules-coverage.md |
| ASIs at 4/8/12/16/19 for every class | rules-coverage.md |
| Artificer offered beside the SRD twelve | `classes.json` |
| Tool choices stored as one line ("three musical instruments of your choice") | `classes.json`, `mechanics.ts backgroundTools` comment |
| Dice pool reroll only under 70 | `abilityDice.ts` |
| Racial damage resistance and most passive traits "narrated" | `scripts/test-feature-coverage.mjs` acknowledged list |

The first two are recorded as gaps anyway (medium) because nothing bounds them.

## Files written

| File | test() | gap() |
|---|---|---|
| `/home/lebbi/open-dungeon-master/scripts/test-enforce-abilities.mjs` | 12 | 2 |
| `/home/lebbi/open-dungeon-master/scripts/test-enforce-creation-routes.mjs` | 8 | 12 |
| `/home/lebbi/open-dungeon-master/scripts/test-enforce-creation-grants.mjs` | 4 | 17 |
| `/home/lebbi/open-dungeon-master/scripts/test-enforce-proficiencies.mjs` | 9 | 2 |
| `/home/lebbi/open-dungeon-master/scripts/test-enforce-races.mjs` | 9 | 8 (7 without the pack) |
| `/home/lebbi/open-dungeon-master/scripts/test-enforce-backgrounds.mjs` | 9 | 5 (4 without the pack) |
| Total | 51 | 46 |

Two local helpers (new files, not the shared ones):

- `/home/lebbi/open-dungeon-master/scripts/lib/enforce-creation.mjs`: a lobby, a seated
  player, `atTable(sheet)` and `throughLibrary(sheet, level)` for the two doors, two legal
  SRD sheets, and a guard that refuses to post a character without a portrait.
- `/home/lebbi/open-dungeon-master/scripts/lib/enforce-builder.mjs`: runs the real
  `useBuilderDerived` + `validateBuilder` + `buildBuilderResult` without a browser by
  answering React's `useMemo` with a dispatcher that calls the function. This is what lets
  the suites build all 12 classes, 31 races and 49 backgrounds through the actual builder
  code and post the result to the actual route.

## Findings

Severity follows the harness: high = a player can gain or keep something the rules deny.
"Reproduce" for every route finding: sign in as a campaign member in a lobby and POST the
legal fighter from `scripts/lib/enforce-creation.mjs` with the one field changed.

### A. The creation routes store what they are sent (one root cause)

Root cause for all of A: `src/app/api/campaigns/[campaignId]/sheet/route.ts` POST (lines
454 to 477) and PUT (607 to 633, and the edit shape 552 to 603), `src/app/api/characters/route.ts`
POST (53 to 69), validate with `createSheetSchema` (`src/lib/schemas/sheet.ts:214`) and
`spellListProblems` only, then `createSheet` (`src/lib/db/sheets.ts:219`) writes the fields.
Suggested fix for all of A: one server function, `creationProblems(sheet, level)`, run
beside `spellListProblems` in every creation and edit route, that derives what a sheet of
this class, race, background and level may hold (the builder's own helpers already compute
all of it: `findClass`, `srdRaceFor`, `expertiseSlotsFor`, `earnedAsiCount`,
`spellSlotsFor`, `suggestedStartingHp`) and refuses or overwrites the rest. Hit dice,
slots, saves, speed and class armor/weapon training should simply be server-derived, never
read from the request, for classes and races the server has a table for.

| id | sev | Rule | Observed |
|---|---|---|---|
| creation-ability-over-20 | high | No score passes 20 at creation | six 30s stored (`abilityScoresSchema` max 30) |
| creation-ability-21 | high | The cap is 20 exactly | STR 21 stored |
| creation-ability-unearned | high | Scores come from array, point buy or dice | six 19s stored; the server never sees a method, a point total or a roll. Dice are thrown in the browser (`abilityDice.ts rollPool`, `Math.random`). Holding this means rolling server-side |
| creation-ability-below-3 | low | No method gives under 3 | CHA 1 stored |
| creation-hp-unbounded | medium | die max + CON at level 1 | 500 HP stored for a fighter whose maximum is 12. Documented knob, no bound |
| creation-hit-die-size | medium | One die size per class | wizard stored with d12 |
| creation-hit-dice-count | high | One hit die per level | 20 dice at level 1; and 1 die at a level 5 table. `hitDice.total` is never tied to level on this door |
| creation-hit-dice-spent | low | spent <= total | 20 of 1 spent |
| creation-ac-pinned | medium | AC is armor + shield + DEX | AC 30 stored, pinned by the player; also pinned when the flag is omitted (`db/sheets.ts:260`). In play the same player may not change AC at all |
| creation-gold-unbounded | medium | purse 5 to 25 gp, or at most 200 gp of starting wealth | 1,000,000 gp stored |
| creation-speed | medium | speed comes from the race | human with 120 ft stored |
| creation-library-door | high | The library door holds the same rules | `POST /api/characters` then `{libraryCharacterId}`: at the character's own level nothing is recomputed (500 HP, six 30s arrive intact); at a different level `adaptSheetToLevel` fixes level, dice count, HP and slots but not scores or die size |
| creation-saves | high | two saves per class | fighter proficient in all six |
| creation-skill-count | high | class count + background 2 + race | all eighteen stored |
| creation-skill-list | medium | class skills from the class list | fighter with Arcana and Stealth |
| creation-expertise-unearned | high | rogue 1, bard 3 only | fighter with four expertise skills |
| creation-expertise-unproficient | medium | expertise needs proficiency | Stealth doubled without proficiency. `patchSheet` filters expertise against skills, `createSheet` does not, and `computeSheetDerived` (index.ts:419) checks expertise before proficiency |
| creation-skill-unknown | low | eighteen skills exist | "lockpicking" stored |
| creation-armor-training | high | wizard: no armor | heavy armor and shields stored |
| creation-weapon-training | medium | wizard: five weapons | simple and martial stored |
| creation-languages | low | human soldier: two | twelve stored |
| creation-feats | high | feats from an ASI or variant human | four feats at level 1; Alert's +5 reaches initiative |
| creation-features-by-source | high | features come from class, race, background at level | root cause `src/lib/srd/features.ts:298`: every "story" and "feat" feature in the request is kept. Level 1 wizard stored with Extra Attack (3), Sneak Attack, a Rage counter (max 2) and Fighting Style: Archery. Fix: at creation, accept only "choice" (already pruned) and pack race/background names; keep the story/feat path for play |
| creation-class-levels | high | class levels sum to the level; created single-class | root cause `src/lib/db/sheets.ts:232`: a `classes` array of two or more is used as sent. fighter 20 / wizard 20 into a level 1 table is stored at level 1 with 24 features and Action Surge x2. Fix: at creation ignore `classes` unless the sheet comes from the library path, and there require the sum to equal the level |
| creation-subclass-early | low | fighter picks at 3 | "Champion" stored at level 1 (no features granted) |
| creation-spell-slots | high | slots from the class table | `{1: 10, 9: 10}` stored; `spellListProblems` reads the class table for the top level and never looks at the slots sent |
| creation-attunement | medium | three attuned items | five stored; `capAttunement` runs in `patchSheet` only |
| creation-equipment | medium | kit or 200 gp | plate, a +3 shield and 999 potions stored |

### B. A legal character the server refuses

| id | sev | Rule | Observed | Root cause | Fix |
|---|---|---|---|---|---|
| creation-high-elf-cantrip | medium | A high elf's racial wizard cantrip is on top of the class's cantrips | A high elf wizard built exactly by the rules through the builder is refused: "A level 1 wizard knows 3 cantrips; that list has 4." Same for any high elf caster | `submit.ts:263` adds the racial cantrip to `spellcasting.cantrips`; `spell-prep.ts:380` counts the list against the class cap | Count `racialChoices.cantrip` as free in `spellListProblems`, the way subclass spells are |

Reproduce: builder, high elf, wizard, pick the racial cantrip and three wizard cantrips, submit.

### C. Wrong numbers

| id | sev | Rule | Observed | Root cause | Fix |
|---|---|---|---|---|---|
| creation-remarkable-athlete-rounding | medium | Remarkable Athlete: half proficiency ROUNDED UP | +1 at levels 7, 8 and +2 at 13 to 16, where the SRD gives +2 and +3 | `src/lib/srd/index.ts:415` `halfPb = Math.floor(pb / 2)` used for both scopes | `Math.ceil` when scope is "physical" (also `dm/rolls.ts` if it repeats the math) |
| creation-background-purse | medium | The background's purse is the starting coin | Every character starts with 15 gp and carries an item named "10 gp" / "25 gp" that is not money. Hermit is 10 gp up, noble 10 gp down | `useBuilderState.ts:154` gold opens at 15; `useBuilderDerived.ts:187` turns every kit line into an item | Store the purse as a number on the background row, set gold from it, drop the line from the kit |
| creation-hp-minimum-per-level | low | Each level adds at least 1 HP | Wizard with CON 3 has 2 HP at every level 1 to 20 | `index.ts:564` and `abilityDice.ts:233` floor the total, not each level | `Math.max(1, perLevel)` |

### D. Data against the SRD table

| id | sev | Rule | Observed | Where |
|---|---|---|---|---|
| creation-dwarf-weapon-training | low | Dwarven Combat Training: battleaxe, handaxe, light hammer, warhammer | No `weapons` entry and no such trait on either dwarf | `src/lib/srd/races.json` |
| creation-high-elf-weapon-training | low | Elf Weapon Training on the high elf | Missing; the wood elf has it | `src/lib/srd/races.json` |
| creation-half-elf-language | low | Half-elf: Common, Elvish, one of choice | Without the pack the sheet lists four languages, one of them the literal text "one of your choice" | `races.json` half_elf; `useBuilderOptions.ts srdRaceOptions` does not filter the placeholder (`race-options.ts withSrd` does) |
| creation-background-grant-budget | low | Two tools or languages per background | Seven ODM backgrounds give three | `src/lib/backgrounds/catalog.json` |
| creation-druid-metal-armor | low | Druids wear no metal | The druid's starting gear is Scale Mail; "shields (nonmetal)" is never read | `src/lib/srd/armor.ts:312 defaultArmor` |
| creation-pack-background-skills | low (pack) | Two skills per background | Pack row Fate-Touched has no skill text at all and is offered anyway | `useBuilderOptions.ts mergedBackgroundOptions` |

### E. Traits that are only names

| id | sev | Rule | Observed |
|---|---|---|---|
| creation-dragonborn-ancestry | low | Ancestry sets breath type, breath save and resistance | No ancestry choice exists (`racialChoices` has no field). The sheet resists nothing; the breath is always a DEX save. The breath counter and its dice (2d6, 3d6 at 6, 4d6 at 11, 5d6 at 16) ARE correct and tested |
| creation-innate-spells | low | Infernal Legacy, Drow Magic: a cantrip, then a spell at 3rd and at 5th | The cantrip is not on the spell list; nothing arrives at 3 or 5. Same for forest gnome and aasimar cantrips |
| creation-duplicate-proficiency | low | A proficiency gained twice is replaced by a choice | Half-orc soldier has Intimidation from both and ends with four skills, not five. No replacement is offered for fixed-vs-fixed duplicates (skills or tools) |
| creation-tool-choices | low | Bard: three named instruments | The sheet is proficient in the sentence "three musical instruments of your choice" |

### F. The builder's own gate (client side, low)

| id | sev | Rule | Observed | Root cause |
|---|---|---|---|---|
| creation-builder-method | low | Standard array is 15,14,13,12,10,8 once each | `validateBuilder` passes six 15s under "standard", any six numbers under "roll" | `submit.ts:176 abilitiesBlocker` checks only point buy |
| creation-builder-final-check | low | rules-coverage.md: picks are re-checked "once more as the sheet is built" | `buildBuilderResult` reconciles, then takes skills, expertise and languages from the unreconciled preview (`submit.ts:314`). With a stale state it emits a fighter with Arcana, four class skills, expertise; a level 1 rogue with four expertise picks; five chosen languages where three are owed. `callingBlocker` counts picks without checking them | `submit.ts:314`, `submit.ts:87` |

The wizard's handlers keep the state clean, so F needs a stale state to show. It matters
because A means the server would not catch it either.

### G. Edition leaks

| id | sev | Observed |
|---|---|---|
| edition-2024-species | medium | see "2024 content" above. Test uses an inline copy of the pack's Orc row, so it runs without the pack |
| edition-2024-feat-text | low (pack) | 16 srd-2024 feats offered; Alert's text and mechanics disagree |

Fix strategy: drop `srd-2024` from the species and feat backfill (or tag rows with their
game system and filter them out of the 2014 builder), and remove `srd-2024` from
`BUNDLED_DOCUMENTS` in `race-options.ts:34`.

## What is enforced today (tests)

- Level is always the table's starting level; features, resources and the background
  feature are granted by the server for that level. A client cannot write level, XP,
  current or temp HP, conditions, resources, exhaustion, death saves, concentration, wild
  shape, pets, companion flag, owner or campaign through the creation request.
- Schema hard bounds refuse 26 malformed values with nothing stored.
- Signed-out callers get 401, non-members 404, a second character 409.
- "class" and "race" features in the request are replaced by the server's grant.
- "choice" features are pruned to the slots the class opens (no style for a wizard, no
  invocation for a level 1 warlock, one style for a level 1 fighter).
- Spell lists: cantrip cap, prepared/known cap, wizard book of six, spell level cap,
  non-caster with spells, all refused.
- Unpinned AC is derived from gear whatever the request says.
- A library character built at level 20 joins a level 1 table at level 1 with level 1 dice,
  HP, features and counters.
- Modifiers 1 to 30, proficiency bonus 1 to 20 (clamped outside), point-buy costs, budget
  and range, 4d6 drop lowest bounds, ASI cap at 20 in the builder, ASI slot count by level.
- computeSheetDerived: all 18 skills, six saves, passive Perception, initiative, spell DC
  and attack at every level with proficiency and expertise; negative modifiers; Alert,
  Observant, Jack of All Trades.
- The SRD class table (12 classes): hit die, saves, skill count and list, armor, weapons,
  tools, class language, subclass level, all correct in the data, in the built sheet and in
  the stored sheet, with the level 1 features and hit points. Caster level 1 cantrips,
  spells and slots. Expertise slots by level. Weapon and armor training lookups.
- 15 rulebook races: bonuses, speed, size, languages, skills, tools, armor; all 31 bundled
  races through builder and route; darkvision in the light model's senses at the right
  range; resistances in the damage engine's list (dwarves and stout halfling poison,
  tiefling fire, ODM lineages); Relentless Endurance and Breath Weapon counters; race weapon
  training for a wizard; every racial choice demanded by the builder; pack rows for the SRD
  races resolve to the same numbers.
- Backgrounds: Acolyte item for item; the 2014 table for all 13; two real skills and no
  ability or feat keys for all 49; all 49 through builder and route; the feature cannot be
  swapped by the request; pack backgrounds read without ability increases; hit points for
  every die, CON 8 to 20, levels 1 to 20, hill dwarf +1 per level.

## Not modelled (no gap recorded)

- Fighter ASIs at 6 and 14, rogue at 10 (documented).
- Tough feat's +2 HP per level, and any other feat that changes HP: HP is a number the
  client sends; nothing on the server derives it.
- Expertise in thieves' tools (rogue) and any tool expertise: expertise is skills only.
- Racial advantage on saves (Dwarven Resilience, Fey Ancestry, Gnome Cunning), Stonecunning,
  Trance, Mask of the Wild, Sunlight Sensitivity: names on the sheet, acknowledged as
  narrated in `scripts/test-feature-coverage.mjs`. Brave and Lucky have helpers in
  `feature-effects.ts`; whether the roll engine calls them is the roll suite's question.
- SRD class starting equipment choices (a)/(b) and rolled starting wealth by class.
- Alignment, age, height, weight: free text or absent.
- Small size limits on heavy weapons: `sizeForRace` is tested, its use is the combat suite's.
- Background personality traits, ideals, bonds, flaws.

## Could not test, and why

- The builder's React components (AbilityEditor, steps): only the pure modules under them
  run in Node. The STANDARD_ARRAY constant lives in `AbilityEditor.tsx`; the suite writes
  the array literally instead.
- `PUT /api/characters/[characterId]`, `POST /api/characters/import` and the campaign sheet
  `PUT`: read, not exercised. They validate with the same `createSheetSchema` and nothing
  more, so every finding in A applies; one gap per root cause was preferred over three
  copies.
- The level-up PATCH (player patch of abilities, maxHp, feats at level-up): left to the
  advancement suite.
- Whether the damage engine halves damage for the resistances listed, and whether the roll
  engine applies Alert, Brave or Lucky: other suites' areas. This suite stops at the list
  or number the engine reads.

## Notes for whoever runs these

- Side effect found and fixed: a character posted without a portrait queues a real render
  on the image backend (`src/lib/portrait.ts queueLibraryPortrait`). My first probe script
  did exactly that before I noticed; three portrait renders reached the local ComfyUI queue
  and their files were dropped when the scratch directory was removed. Every payload in the
  suites now carries `portrait: { url: "/uploads/enforce-creation.png" }`, and
  `enforce-creation.mjs` throws if a sheet is about to be posted without one.
- No fights are started in this area, so the random battle map placement does not apply.
- The shared helpers were not edited. No bug found in either.
- `heroInput` in `enforce-world.mjs` builds sheets with empty proficiencies and 30 HP at
  any level by design ("nothing here is derived"); that is only possible because of
  finding A. If A is fixed at the route, `createSheet` called directly still accepts them,
  so the other suites are unaffected.
