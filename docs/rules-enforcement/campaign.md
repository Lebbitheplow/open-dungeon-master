# Enforcement report: campaign

The second audit and repair (2026-09-30) and the state after it are in [`../rules-enforcement-audit.md`](../rules-enforcement-audit.md); this report describes the first audit.

Area: campaign creation and settings, permissions, persistence, import and export, custom
content (homebrew, rulesets, world packs, genre classes), multiplayer synchronization, and the
AI DM's tool interface. Continued from an interrupted agent; its seven files were kept, re-run,
reviewed and reclassified under the owner decisions, and five files were added.

All twelve files pass both ways (`node scripts/test-enforce-x.mjs` and `npx vitest run`), each
was run five times in a row under node with the same result, none has an em dash or en dash,
and the longest is 493 lines. Nothing under src/ was edited, no tracked file was changed, and
the two shared helpers were not touched.

Totals: 131 test() and 45 gap(). By severity: 17 high, 16 medium, 12 low.

## Ruleset as implemented

Campaign frame
- Starting level 1 to 20, party 1 to 8, difficulty easy, normal, hard or deadly. A table nobody
  configured runs plain SRD 5.1: every variant off, standard rests, digital dice, one character
  each, multiclassing on, item approvals off, AI DM.
- Variant toggles stored: flanking, criticalFumbles, encumbrance, lingeringInjuries,
  powerfulCritical, criticalDamageMods, ammunition, restVariant (standard, gritty, heroic).
  Five are read by an engine. Three are only a sentence in the DM prompt (findings below).
- Unknown setting keys are stripped, out of range values refused.

Deliberate deviations from SRD 5.1, each declared in the source and pinned as a test()
- Settings may change mid campaign and mid fight (settings/route.ts).
- At an AI table the party lead holds story authority and there is no DM seat, so the console
  is closed to everyone. Once a person runs the table the lead is an ordinary player
  (src/lib/dm/viewer.ts, campaign-api.ts requireStoryAuthority).
- A DM seat holds no party slot (db/campaigns.ts countPartySlots).
- A library character enters at the TABLE's level: going down gives back improvements, hit
  dice, slots and spells; going up resizes and the new improvements are taken in play
  (characters/adapt.ts).
- At a real-dice table the faces a player types are believed, labelled physical
  (docs/ROADMAP.md, "a trust feature"). Kept as a test() because the table opts in through its
  dice policy and the faces are still checked against the die. Flagged here for the owner as a
  judgment call under owner decision 2.
- end_encounter ends the fight whatever its arguments say, unreadable JSON included
  (encounter-tools.ts above endArgsSchema).
- A published monster answers to its name before a hand built one, and a table fights its
  owner's homebrew monsters only (bestiary/index.ts resolveMonster).
- A setting class has one multiclass prerequisite ability, checked both entering and leaving.
- A homebrew monster's stated challenge rating is the author's to set; the editor shows the
  derived rating beside it (monster-draft.ts readMonster).

## Files

| File | test() | gap() | Origin |
| --- | --- | --- | --- |
| scripts/lib/enforce-campaign.mjs | helper | | inherited, unchanged |
| scripts/test-enforce-campaign-config.mjs | 16 | 1 | inherited, unchanged |
| scripts/test-enforce-variant-rules.mjs | 16 | 4 | inherited, unchanged |
| scripts/test-enforce-permissions.mjs | 17 | 0 | inherited, header revised |
| scripts/test-enforce-player-patch.mjs | 13 | 1 | inherited, header revised |
| scripts/test-enforce-patch-fields.mjs | 5 | 19 | new |
| scripts/test-enforce-rolls-trust.mjs | 11 | 2 | inherited, unchanged |
| scripts/test-enforce-persistence.mjs | 8 | 3 | inherited, unchanged |
| scripts/test-enforce-import.mjs | 9 | 3 | inherited, unchanged |
| scripts/test-enforce-homebrew.mjs | 9 | 3 | new |
| scripts/test-enforce-genre-classes.mjs | 7 | 2 | new |
| scripts/test-enforce-sync.mjs | 9 | 2 | new |
| scripts/test-enforce-tool-args.mjs | 11 | 5 | new |

How the owner decisions were applied. The inherited player-patch header said that what ODM
"trusts the table" with was pinned elsewhere. That paragraph is gone. No inherited test() pinned
a player self edit as legal, so nothing had to be flipped inside those two files; what was
missing was the findings themselves, field by field. They are in the new patch-fields file, one
gap per key of patchSheetSchema, ids starting with patch-. Every world is closed once, at the
end of its file. Every posted, imported or recruited character carries a portrait. Every fight
in the new files has its map rows removed after start_encounter.

## Findings

### High

patch-level, patch-maxHp, patch-currentHp, patch-tempHp, patch-ac, patch-xp, patch-gold,
patch-conditions, patch-equipment, patch-spellcasting, patch-feats, patch-features,
patch-abilities (13 findings, one root cause)
- Rule: a player changes nothing on their own sheet that the rules do not give them.
- Observed: a player who has earned 2nd level sends the dialog's request with one field
  written by hand, and it is stored: 500 max HP, full health from 3 HP, 200 temporary HP, AC 30,
  355,000 XP, a million gold, conditions cleared, Plate and a Vorpal Sword, a fighter holding
  9th level slots and Wish, three feats at 2nd level, a Rage counter, all six scores at 20.
  patch-level: the same route levels a sheet that has 0 XP.
- Root cause: src/app/api/campaigns/[campaignId]/sheet/route.ts PATCH, line 725. `levelingUp`
  is `level > sheet.level`, and once true every key of patchSheetSchema is passed to patchSheet
  unchecked. The gains are computed only in the client dialog.
- Reproduce: node scripts/test-enforce-patch-fields.mjs.
- Fix: build the level-up server side as the multiclass path already does. Accept only the
  player's CHOICES (class, hit point roll or fixed, improvement or feat at 4, 8, 12, 16, 19,
  subclass, spell picks), derive every number, and check XP against the level asked for.

patch-levelUpSpells-above-slots
- Rule: a spell learned at a level-up is of a level the character has slots for.
- Observed: a fighter taking a first wizard level writes Wish and Meteor Swarm in the
  spellbook and has both prepared.
- Root cause: sheet/route.ts buildMulticlassLevelUp counts the picks and never reads their
  level or class list.
- Fix: run each pick through the same class list and max spell level check the preparation
  route uses.

homebrew-player-redefines-srd-spell
- Rule: a spell has one level; Revivify is 3rd.
- Observed: a player posts a homebrew spell named Revivify at level 1 on the cleric list. Their
  1st level cleric prepares it (status 200) and use_spell_slot spends a 1st level slot on it.
  Another player's identical cleric is refused.
- Root cause: src/lib/content/index.ts searchSpells and findSpellByName put the SHEET OWNER's
  homebrew rows ahead of the published ones; the spells route and mutations.ts use_spell_slot
  pass the player's id. Monsters are resolved the safe way round.
- Fix: resolve spells as monsters are resolved. Published name first, and only the table
  owner's homebrew (or entries on the applied ruleset's homebrewIds) counts in play.

rolls-held-roll-accepts-typed-faces (inherited, confirmed)
- Observed: at a digital only table any member sets holdRolls, which parks their rolls, then
  answers each with { dice: [20] }. Stored as "str (physical)" total 20.
- Root cause: pending-rolls/[pendingRollId]/route.ts POST never asks why the roll was parked;
  members/me opens holdRolls to everyone.
- Fix: store the reason a roll was parked and accept typed faces only for a real-dice park.

import-illegal-sheet-stored (inherited, confirmed)
- Observed: a hand edited character file is stored with every score at 30, 500 HP at level 1,
  twenty d12 hit dice, twelve attuned items, an unknown class, a million gold.
- Root cause: src/lib/character-bundle.ts validates with createSheetSchema alone, same root as
  the creation findings.
- Fix: one shared legality check for creation, import and library edits.

### Medium

homebrew-player-spell-needs-no-dm
- A player invents a spell, names their own class on it and prepares it; nobody who runs the
  table is asked. Root cause: spells route changeSpell calls searchSpells with the caller's id.
  Fix: as above, table scoped homebrew.

sync-private-notes-sent-to-the-table
- Rule: sheet.ts says notes "stay private to the owner".
- Observed: a player's notes are in the event log and in another player's snapshot.
- Root cause: every publishPersisted("sheet_updated", { sheet }) and the campaign GET send the
  sheet whole to every member.
- Fix: a public projection of a sheet that drops notes for everyone but the owner and the DM.

tool-gold-ignores-declared-bounds
- Rule: modify_gold and party_award declare a bound of 100,000 gp to the model.
- Observed: two calls added 2,000,000,000,000 gp.
- Root cause: mutations.ts argsSchema, `delta: z.coerce.number().int()` with no bounds, while
  update_sheet is held to 1,000 gp and award_xp to 20,000 XP.
- Fix: bound delta in argsSchema and refuse above it.

tool-item-quantity-unchecked
- Observed: grant_item qty 1,000,000 is granted; qty 0 and -3 are read as 1 rather than
  refused, in grant_item, remove_item and purchase.
- Root cause: argsSchema `qty` has no bounds.
- Fix: `.min(1).max(99)`.

console-correct-sheet-does-nothing
- Observed: the form answers "update_sheet changed nothing"; the sheet's own keys answer
  "Correct a sheet needs field". A person at the console has no working correction.
- Root cause: catalog-party.ts update_sheet requires `field` and `value`; the handler's
  updateSheetPatchSchema strips both.
- Fix: map { field, value } to a patch in normalizeArgs, or give the form the real fields.
- Also recorded by the progression agent as xp-console-correction-does-nothing (low).

console-forms-miss-the-tools-arguments
- Observed: "Learn a spell" can never succeed ("learn_spell needs a spell name and action").
  use_spell_slot and learn_spell send the spell as `name` where the handler reads `spell`;
  learn_spell and purchase have no `action` field.
- Root cause: catalog-party.ts; test-invoke-catalog.mjs compares tool NAMES only.
- Fix: correct the four forms and extend the guard to compare field names with each tool's
  declared properties.

genre-counter-from-another-class
- Observed: rigger, aberrant, ratcatcher, machinist and alchemist hold a counter that belongs
  to another class's feature; dirgesinger and apostate each hold two counters for The Rite
  Completed. All are spendable.
- Root cause: class-resources.ts populateResources matches any feature that CONTAINS the
  definition's words and never reads the row's `classes` list.
- Fix: for rows from resources.json match the exact name and require the granting class.

patch-acOverride, patch-hitDice, patch-expertise: same root cause as the high patch findings.

Inherited and confirmed: config-multi-character-unique (the second sheet throws SqliteError on
UNIQUE (campaign_id, user_id)), variant-strictness-request-roll (request_roll and scene_check
ignore the strictness shift), variant-flanking-unread, rollback-duplicates-party-stash
(party_json is not in CAMPAIGN_SNAPSHOT_COLUMNS), rollback-keeps-later-effects (active_effects
is not in SNAPSHOT_TABLES), import-spell-lists-unchecked.

### Low

- tool-update-sheet-ceiling-is-per-call: sheetBuffViolation has no memory, so three calls take
  a level 3 fighter to level 6 on 0 XP. Fix: judge against XP and a per turn total.
- sync-secret-roll-is-announced: a "dm" or "self" roll is published to every seat, redacted,
  while the snapshot drops it outright. Fix: do not fan such events out to other seats.
- genre-counter-upgrade-unread: Hardened (2 uses) and Rat Tide (2 uses) leave 1. Root cause:
  generated resources.json rows lack `upgrades`. Fix: regenerate after fixing the generator.
- ruleset-homebrew-ids-unchecked: another account's id or a meaningless string is stored.
- patch-copper, patch-subclass.
- Inherited: patch-correction-breaks-counter-invariants, rolls-manual-total-without-dice,
  rollback-keeps-the-clock, import-drops-experience, variant-criticalfumbles-unread,
  variant-lingeringinjuries-unread.

## What held

Worth saying because the purpose was to find faults: the tool interface is solid against
malformed input. All 39 mutation and encounter tools refused eight kinds of broken arguments,
with and without a fight running, with no throw and no state change, including ids from another
campaign. Fifty concurrent invokes on one sheet and one enemy lost nothing, a counter spent by
seven callers at once stopped at its maximum, and sequence numbers were strictly increasing.
Enemy numbers and whisper text never reached a player.

## Not modelled

- Flanking, critical fumbles and lingering injuries have switches and no mechanic.
- Homebrew races, backgrounds, feats and archetypes are stored and normalized but their
  mechanical effect is whatever the builder's client applies.
- A ruleset's homebrewIds gates nothing in the engine.
- World packs carry names only, so there is nothing mechanical to bound.

## Could not test, and why

- The connected agent workbench (src/lib/agents/workbench.ts) calls the web routes over
  loopback HTTP; no server runs in these suites. Its permissions are those of the routes, which
  are tested directly.
- A full agent program turn through the bridge needs the fake adapter and an HTTP listener;
  scripts/test-harness-turn.mjs already covers it. Only the bridge's own refusals and the MCP
  door's 401 and 403 are asserted here.
- Without the content pack (CI) the SRD goblin's exact numbers and the published Revivify
  control cannot be asserted; both are guarded or reported as the control failing.

## Overlap with other areas, left alone on purpose

- A spent counter set back to zero outside a fight through /sheet/usage: class features and hit
  dice are recorded in test-enforce-usage-route.mjs. The SPELL SLOT half is still pinned as
  ODM's rule in test-enforce-spell-slots.mjs, which under owner decision 1 should become a gap;
  that file belongs to the spells area and was not edited.
- Homebrew gear: equipment area (homebrew-redefines-srd-gear, homebrew-snapshot-from-the-client).
- patch-level, patch-features and patch-subclass restate levelup-without-xp,
  levelup-features-by-hand and levelup-subclass-early so that the patch- list is complete.
