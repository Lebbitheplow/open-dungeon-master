# Workshop and rulebook audit — PR #169

Audit date: 2026-10-09. PR: [Workshop rules fidelity, and WorldForge built into the workshop](https://github.com/Lebbitheplow/open-dungeon-master/pull/169). Audited head: **ecd78fe3b3456541f085b72bea1ec002d83e0551**. Source links below are pinned to that head; this report remains meaningful if the PR changes.

**Conclusion:** the PR substantially improves the workshop, and its existing tests pass, but it does not yet establish that every rulebook entry can be copied, edited, discovered, and played with its full rules intact. There are reproducible gaps in spell copying, monster data preservation, homebrew lifecycle, campaign scope, and WorldForge integration. These should be addressed before describing the workshop as fully faithful to the rulebook.

This is a documentation-only audit. Application code was not changed, no PR comments or issues were posted, and the user's live campaign databases were not used for mutations. Tests and probes ran against the exact PR head in a separate temporary checkout, using scratch databases and the installed content pack read-only. Findings describe the remaining state of the PR, including existing limitations exposed by its new workflows; they are not all claimed to be regressions introduced by this PR.

## Scope and verification

The audit followed the seams between the bundled SRD reader, content catalog, workshop drafts, save normalization, character builder, campaign runtime, exports/imports, and WorldForge. It reviewed the existing fidelity/enforcement tests, inventoried the bundled book and SRD catalog, and added temporary independent probes outside the repository. Engine probes used the real database and invocation harness with controlled dice.

| Check | Result | What it establishes |
| --- | --- | --- |
| Full existing suite with the installed content pack | **474 test files passed**, about 308 seconds | Existing assertions pass. Vitest reports “Tests: no tests” because these script suites run assertions at module import; this is not a claim that 474 individual rules were tested. |
| Focused rulebook/workshop suites with the pack | **14 files passed** | Fidelity, workshop enforcement, option findings, WorldForge, WorldForge AI, and rulebook checks. |
| Same focused suites without the pack | **14 files passed** | Existing fallback assertions pass; this does not establish that the no-pack UI exposes all usable rows. |
| TypeScript | **npx tsc --noEmit passed** | No type errors at the audited head. |
| Independent probes | Confirmed the observations identified as reproduced below | These probes exercise omissions in the existing assertion set. They were not added as application tests. |
| Collaborative browser | Workshop loaded; opened the spell editor, searched and copied Revivify | Confirmed the actual editor exposes “V, S, M” without the diamond text, retains the original name, and has no contextual source link. This was a focused browser check, not a complete responsive/accessibility audit. |

The browser needed the audit machine's LAN address added to the dev server's allowed origins. Initial HMR/font/origin failures were audit-environment problems and are not counted as PR defects. No production build, actual local-model Forge/Ask/Draft session, or complete browser journey through every editor was certified.

### What “500 pages integrated” means in this repository

The bundled reader contains **933 logical entries**, not 933 pages of the original PDF. Its breakdown is 36 rules pages, 9 race pages, 12 class pages, 319 spells, 239 item pages, and 318 monster pages. The installed pack's wotc-srd rows include 319 spells, 322 monsters, 292 items including mundane equipment, 13 races/subraces, 12 archetypes, one feat, and one background. These counts have different grouping rules and cannot be used as a completeness percentage.

All 319 book spell titles found an exact-name catalog result with the pack installed. Three item page titles and seven monster page titles did not have exact-name results; these include grouped bonus items, family qualifiers, aliases, and template/instruction pages. They are a source-mapping problem to investigate, not evidence that ten playable entries are absent.

For the 319 book spells, spellMechanicsFor returned 210 structured blocks and no block for 109 names. The 210 comprise save 90, attack 16, buff 61, utility 25, auto 5, heal 12, summon 1. **109 without this block does not mean 109 broken spells:** some are narrative utility and others have separate engines, including summons and zones. Conversely, having a block does not prove full behavior, as Web demonstrates below.

Sources: [rulebook types](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/rulebook/types.ts#L1), [book contents/search](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/rulebook/book.ts#L1), [spell mechanics resolver](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/content/index.ts#L625).

## Prioritized backlog

P1 means a core copy/play path produces the wrong mechanics or loses rules data. P2 means a meaningful usability, scope, or reliability gap. P3 means additional authoring coverage or assurance work. “Reproduced” means an independent probe observed the behavior; “code-confirmed” means the implementation directly establishes it; “design gap” and “verification gap” are not assertions of a reproduced runtime failure.

| ID | Priority | Area | Evidence |
| --- | --- | --- | --- |
| F01 | P1 | Renamed spell copies lose engines outside SpellMech | Reproduced |
| F02 | P1 | Costly/consumed spell materials disappear on copying | Reproduced, browser-confirmed |
| F03 | P1 | “Start from” homebrew drops its existing mechanics | Reproduced |
| F04 | P1 | Catalog, creation, and play use different author scopes | Reproduced search; code-confirmed downstream scope |
| F05 | P1 | Monster copying starts from an already lossy stat block | Reproduced data loss |
| F06 | P1 | Deleting gear removes mechanics despite the dialog's promise | Reproduced |
| F07 | P2 | Browser feat cache leaks between campaigns and survives deletion | Reproduced |
| F08 | P2 | No-pack UI hides otherwise available local/bundled options | Reproduced API; code-confirmed UI |
| F09 | P2 | Renamed equipment copies lose weight | Reproduced |
| F10 | P2 | Spell prose preview can disagree with the effective mechanics | Reproduced resolver |
| F11 | P2 | Trap attacks ignore natural 1/20 and critical damage | Reproduced |
| F12 | P2 | A copy with a published name can silently resolve as the original | Code-confirmed; browser shows unchanged default name |
| F13 | P2 | SRD findings are incomplete and sometimes inaccurate | Reproduced false finding; code-confirmed omissions |
| F14 | P2 | WorldForge articles/fields are not carried into the DM feed | Reproduced feed; code-confirmed storage/prompt paths |
| F15 | P2 | Reimport does not update WorldForge relationship metadata | Reproduced |
| F16 | P2 | Concurrent WorldForge slice saves can overwrite each other | Code-confirmed; race not browser-reproduced |
| F17 | P2 | Global shelves and bundle name collisions need explicit handling | Code-confirmed design behavior |
| F18 | P2 | No contextual rulebook-to-editor mapping or provenance | Code-confirmed, focused browser check |
| F19 | P3 | Some rulebook chapters have no dedicated preparation model | Design gap |
| F20 | P2 | Fidelity claims exceed what the present tests actually verify | Verification gap |

## Detailed findings and acceptance checks

### F01 — Renamed spells lose name-keyed behavior outside the copied block

**Observed:** copying Web as Silkbind and casting it through cast_at_enemy applies restrained and the copied escape metadata, but creates **no battle-map zone**. The original Web creates a 16-square zone with difficult terrain, light obscurement, and entering/start-of-turn saves. Copying Conjure Animals as Call the Wild saves successfully, but cast_buff refuses it as unknown. The original creates eight wolves with sheets, tokens, and initiative entries. A renamed Polymorph also failed the enemy transformation call, redirecting to cast_buff instead of transforming the target.

**Cause:** catalog-mechanics copies only SpellMech. Zone/light and summon resolvers still look up the cast's name in separate registries. A renamed copy cannot reach those registries merely by retaining its SpellMech or description.

**Improve:** give a copy stable references or portable structured data for every mechanic the source uses. Audit other name-driven subsystems, especially transformations, reactions, persistent areas, light, familiars, and summons. Those additional families need their own behavior checks; this audit does not claim every one was reproduced failing.

**Acceptance:** renamed Web creates the same zone and resolves movement/turn-entry/fire behavior; renamed Conjure Animals produces the same valid summons and removes them when concentration ends; renamed Polymorph replaces and restores the enemy's statistics. Compare stored state and costs, not only response text or block equality.

Sources: [spellMechanicsOf](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/workshop/catalog-mechanics.ts#L30), [zone casting](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/zone-cast.ts#L1), [zone registry](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/battlemap/zones-spells.ts#L1), [buff/summon routing](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/cast-buff.ts#L1), [enemy transformation routing](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/enemy-polymorph-logic.ts#L1).

### F02 — Copying drops costly and consumed material components

**Observed:** published Revivify requires consumed diamonds worth 300 gp; its saved renamed copy has materialCostGp null and materialConsumed false. Raise Dead loses 500 gp and Resurrection loses 1,000 gp the same way. The real engine accepts use_spell_slot for the renamed Revivify copy Second Chance with zero gold and no equipment. This verifies bypassed casting requirements, not a completed resurrection effect.

The browser's Revivify draft contains only “V, S, M.” The pack stores diamond details in a separate material field. Chromatic Orb retains its cost because the material also appears parenthetically in components.

**Cause:** both draftFromCatalog and normalizeSpellData omit material/material_specified. Copying only components cannot preserve separate source fields.

**Improve:** preserve and edit material description, cost, and consumption in a normalized casting-facts model. A repair must survive both draft creation and save normalization.

**Acceptance:** compare all casting facts before and after a copy/save/reload. Renamed costly spells refuse casting without the required component and consume the component when required. Include separate material fields and parenthetical formats.

Sources: [spell draft creation](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/draft.ts#L147), [spell normalization](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/homebrew/gear.ts#L43), [material/casting-facts extraction](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/srd/spell-facts.ts#L158).

### F03 — “Start from” existing homebrew loses structured data

**Observed:** the picker includes homebrew, but its conversion treats it like a published pack row. Independent draft probes lost:

- Item: weapon, fire rider, charges, attunement, and effects.
- Feat: runsAs Sharpshooter.
- Background: structured skill/language/purse grants.
- Species: heavyArmorSpeed, skills, tools, and cantrip choice.
- Subclass: feature levels and always-prepared spells.

**Cause:** catalog-mechanics deliberately returns no published enrichment for homebrew; draftFromCatalog then reconstructs a limited schema instead of preserving its stored data. The separate **Duplicate** action preserves data; this finding concerns the “Start from” route.

**Improve:** use the stored homebrew schema when the source is homebrew, with the same normalization and preservation contract as Duplicate. Include source discrimination in the picker entry type.

**Acceptance:** selecting a saved homebrew row through “Start from,” renaming, saving, and reloading preserves every engine field and choice. Cover all selectable kinds. Homebrew hazards are not currently included by hazardCatalog, so the draft-only hazard case was not counted as a reachable picker failure.

Sources: [picker rows](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/CatalogStart.tsx#L97), [draftFromCatalog](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/draft.ts#L127), [homebrew enrichment exclusions](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/workshop/catalog-mechanics.ts#L44), [Duplicate implementation](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/HomebrewPanel.tsx#L1).

### F04 — Discovery, creation, and runtime disagree about whose content applies

**Observed:** a DM-owned custom feat Audit Marksman169 exists, but a signed-in player searching the content API gets an empty result. The API searches the current user's shelf without campaign context. Runtime gear, spell, feat, and subclass paths can use the campaign owner and human/assistant DM authors. Creation legality instead consults only campaign.ownerUserId. Outside a campaign it derives no owner from input.userId for those option lookups.

Monster spawning also resolves workshop stat blocks with the campaign owner only, rather than the broader author set used by gear/options. This can make a DM-seat's own preparation discoverable in one context and unusable in another.

**Improve:** define one admission/scope policy and apply it consistently to pickers, previews, creation legality, saved sheets, monsters, and play. The existing policy that player-authored content needs DM adoption can remain; the UI should display the options the table has actually admitted and explain rejected personal content.

**Acceptance:** owner, human DM, assistant DM, ordinary player, and library-only author each browse/create/play with the intended content. A player's campaign picker can select the DM's admitted custom feat/species/spell/subclass. A DM-seat's accepted monster resolves when an NPC or encounter uses it. Unadmitted player content remains excluded consistently.

Sources: [content API scope](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/api/content/[kind]/route.ts#L38), [builder requests](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/characters/builder/useBuilderOptions.ts#L55), [legality context](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/characters/catalog.ts#L245), [tableAuthors](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/homebrew.ts#L169), [monster author scope](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/encounter-spawn.ts#L48).

### F05 — Monster fidelity compares against an already reduced source

**Observed:** scanning all 322 installed SRD monster rows found **28 rows with special-ability names absent from both parsed traits and parsed specials**. These include optional variants, so 28 is a data-preservation observation, not a count of 28 fully broken monsters. Concrete omissions include Vampire's Misty Escape, Spider Climb, and Vampire Weaknesses; Flesh Golem's Lightning Absorption; Kraken's Freedom of Movement and Siege Monster; and Clay Golem's Immutable Form.

**Cause:** parseMonster preserves recognized engine traits but caps other trait lines at four and truncates text to about 140 characters. The workshop starts from those EnemyStats. Equality between a published parsed block and its copy cannot detect omissions that occurred before the copy.

**Improve:** preserve the full printed block separately from the compact combat projection. Expose unimplemented abilities as complete DM-readable text, and attach engine status per ability. Audit behavior for omitted mechanical abilities individually; absence from traits/specials alone does not rule out every other engine representation.

**Acceptance:** every source action, special trait, reaction, legendary action, and variant is retained somewhere accessible after copy/save/reload. A Vampire copy still exposes its full weaknesses and escape rules. Regression tests derive expected names/text from the source row independently of parseMonster.

Sources: [caps and trait projection](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/bestiary/statblock.ts#L198), [source parsing](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/bestiary/statblock.ts#L264), [draftFromStats](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/bestiary/monster-draft.ts#L299), [recognized engine traits](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/monster-abilities.ts#L484).

### F06 — Deletion contradicts the promise to preserve carried gear

**Observed:** the delete dialog says “Sheets that carry it keep their last copy of it.” After an item's catalog entry is deleted, hydrateHomebrewGear removes the carried item's gear block. A probe with an AC-bonus ring retained its inventory name/slug but lost its magic mechanics.

**Improve:** choose and communicate a clear lifecycle policy. Preserving the last trusted server snapshot requires provenance/version handling; alternatively, archive in-use entries or explicitly warn that deletion removes mechanical effects. An inventory label alone does not fulfill the current promise.

**Acceptance:** deletion behavior agrees with the dialog on existing sheets, including after reload and subsequent writes. Editing, archiving, deleting, and changing the author scope have explicit behavior for items already carried.

Sources: [delete confirmation](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/HomebrewPanel.tsx#L157), [gear hydration and snapshot removal](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/homebrew.ts#L194).

### F07 — Browser feat mechanics persist across campaigns

**Observed:** registerBrowserTableFeats inserts into a single module-global map. Registering campaign A's Deadeye as Sharpshooter, then registering campaign B's empty feat snapshot, still makes holdsFeat report Sharpshooter for B's sheet containing Deadeye. Empty updates do not clear deleted rows either.

**Improve:** key browser mechanics by campaign/library scope, replace that scope's snapshot, and clear it on deletion/navigation/account changes. Consider the equivalent lifecycle for species metadata too; the reproduced case here is feats.

**Acceptance:** two campaigns can use the same custom feat name with different effects without leakage. Removing a feat clears its effect in the browser, matching the server. Test sequential navigation in one JS runtime, not only isolated page loads.

Sources: [browser cache registration and lookup](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/srd/feat-effects.ts#L86), [campaign snapshot registration](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/campaigns/[campaignId]/useCampaignStream.ts#L1119).

### F08 — No-pack fallback is available in the API but hidden in the UI

**Observed with CONTENT_DB_PATH=/nonexistent:** the content API returned 55 feats including a saved custom feat, one saved custom race, and 49 bundled backgrounds, all with packInstalled false. CatalogStart returns null when that flag is false, hiding the usable results. useBuilderOptions also exits before applying returned races/backgrounds. The unavailable state is never reset after a successful installed-pack response.

Published spells/items have no searchable pack rows in that state, even though many SRD names can still resolve in the runtime and the bundled reader remains present. Hazards are a useful contrast: their 27 bundled results report availability independently and stay usable.

**Improve:** separate pack installation from catalog usability. Continue to expose local and bundled rows, label missing sources, recover from transient failures, and consider a complete bundled SRD search/copy fallback for workshop use.

**Acceptance:** no-pack “Start from” and the builder expose returned custom/bundled options. Installing a pack or recovering from an API error restores the picker. Any requirement for the optional content pack is visible where it matters.

Sources: [unavailable flag](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/characters/builder/useContentSearch.ts#L65), [hidden picker](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/CatalogStart.tsx#L61), [early return](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/characters/builder/useBuilderOptions.ts#L68), [catalog API](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/api/content/[kind]/route.ts#L1).

### F09 — Renamed equipment loses its carried weight

**Observed:** Longsword has top-level weight 3 and raw data.weight “3 lb.”; its normalized copy has no weight. Backpack loses 5 lb and Rations (1 day) loses 2 lb the same way. Armor enrichment separately supplies weight, so this is not universal across items.

**Cause:** draftFromCatalog reads only numeric data.weight and ignores the catalog's normalized top-level weight. Renaming also defeats the normal original-name lookup, so the item can become unweighed in encumbrance calculations.

**Improve:** copy the normalized weight/price facts and retain their provenance. Validate mundane gear as well as magic combat effects.

**Acceptance:** renamed weapon, tool, supply, and mundane gear copies have the same carried weight, quantity behavior, and encumbrance effect as the original. Test actual catalog rows, including string weights.

Sources: [item draft fields](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/draft.ts#L169), [armor weight enrichment](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/workshop/catalog-mechanics.ts#L69), [name-based weight lookup](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/content/item-weights.ts#L1), [inventory weight calculation](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/srd/encumbrance.ts#L77).

### F10 — The prose preview can misstate the effective spell

**Observed:** a copied Eldritch Blast carries explicit dice 1d10. Changing its description to say 20d6 leaves mechSpellDamage resolving 1d10. That precedence is intentional, but SpellFields still labels its prose-only calculation “From the description the engine reads,” and the description hint says the engine reads damage/save/type from it.

**Improve:** show a single effective engine preview that accounts for the structured block, prose, defaults, and external mechanics. Identify which field wins and flag conflicting prose. Species/subclass/feat aliases need similarly clear feedback where editing words does not parameterize the recognized feature's implementation.

**Acceptance:** the displayed dice/save/effect match what a saved draft actually resolves. Editing prose alone either changes the effective value where supported or visibly explains that a structured override remains active. Do not use Fireball as a universal example: spells without explicit dice can legitimately continue to read their prose.

Sources: [prose preview](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/SpellFields.tsx#L29), [description hint](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/HomebrewEditor.tsx#L101), [structured dice precedence](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/srd/spell-dice.ts#L41), [mechanics precedence](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/content/index.ts#L632).

### F11 — Named trap attacks omit basic attack-roll rules

**Observed in springTrapOn:** a forced natural 1 with +20 hits AC 10; a natural 20 with +0 misses AC 23; a natural 20 against AC 10 rolls only one d6 for a 1d6 piercing hit. The trap path checks only total against computed AC and never applies natural-face miss/hit/critical rules.

**Improve:** route trap attack rolls and hit damage through shared attack resolution, while keeping any post-hit poison save separate from critical hit dice. Also check pinned AC and other defenses: the probe's acOverride input was not reflected by this path's acBreakdownFor result, and that deserves a dedicated defense-consistency check.

**Acceptance:** natural 1 misses, natural 20 hits, eligible hit dice double on a critical, poison-save damage remains governed by its own rules, and the target AC matches the value used by other attacks against that character.

Source: [trap attack and damage path](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/trap-run.ts#L30).

### F12 — Unrenamed copies can save while the original retains authority

**Observed/code path:** “Start from” keeps the published name. Homebrew spells with published names are filtered out by the spell catalog, and known feats take their built-in behavior before table mechanics. Gear has a published-name guard too, although an explicit homebrew slug can resolve the selected item. The distinction makes name-only use ambiguous.

Protecting published rules is a reasonable policy. The gap is allowing an edited copy to appear saved and usable without explaining whether its own mechanics will be selected.

**Improve:** propose a unique copy name, report canonical-name collisions before saving, and expose the actual identity used in a picker, sheet, and runtime call. Preserve deliberate original-rule protection.

**Acceptance:** an edited spell saved under a published name cannot silently masquerade as the edited version. Users receive a clear rename/admission requirement or a stable explicit identity that resolves consistently after reload/export/import.

Sources: [original default name](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/draft.ts#L147), [published spell guard](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/content/index.ts#L167), [known feat precedence](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/srd/feat-effects.ts#L114), [gear identity/precedence](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/homebrew.ts#L218).

### F13 — SRD findings are not a full mechanics or balance check

**Observed:** an otherwise ordinary Ring Mail draft receives “Every SRD heavy armour has a Strength requirement,” although Ring Mail has none. Another checker message says a shield above +2 exceeds every SRD shield “magical ones included,” overlooking magical shield bonuses.

**Coverage gap:** draftFindings passes basic item fields/effects to validateDraft but omits weaponRiders, armorRiders, charges, checks, item spells, and cursed state. Those are precisely the additional mechanics the workshop now authors. A green result does not establish that these fields are SRD-like, fully supported, or balanced. Validators for prose/aliases likewise do not certify every described feature.

**Improve:** separate schema validity, engine support, SRD similarity, and discretionary balance advice. Correct misleading rule assertions and give unsupported/unchecked fields an explicit status. Validate condition/damage vocabulary and incompatible mechanic combinations wherever the engine expects a closed set.

**Acceptance:** unchanged published examples have no false deviations; independently exaggerated riders/charges/check bonuses get appropriate feedback; unrecognized conditions/effect combinations cannot silently imply working automation.

Sources: [heavy armor/shield findings](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/rulesets/validate.ts#L138), [fields sent to validation](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/draft.ts#L73), [option findings](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/rulesets/validate-options.ts#L1).

### F14 — WorldForge prose and structured world facts do not reach the DM feed

**Observed:** creating an NPC with an article containing a distinctive fact stores the article, but worldForPrompt returns no NPC note and an empty block when no hidden truth/link/secret is present. The NPC's underlying ordinary record has no corresponding long text; the article remains in the overlay. The current feed only adds hidden truths, a limited number of links, and secrets.

Custom fields, article prose, timelines, calendars, and atlas context are not read by this feed. Normal text written to existing location/lore fields can reach other prompt paths, so this is not a claim that all WorldForge content is absent from play. WorldForge Ask/Draft can read articles; that does not make the gameplay narrator read them.

**Improve:** add bounded retrieval for relevant articles and structured facts, with explicit player visibility, canon handling, and prompt-budget behavior. Explain which authored facts currently feed play. Define how WorldForge calendar/timeline data relate to the gameplay clock rather than leaving that relationship implicit.

**Acceptance:** a fact stored only in an NPC article becomes available when that NPC is relevant in play. Hidden facts remain DM-only. Late entries remain retrievable rather than being permanently excluded by first-N truncation. Imported world content behaves the same.

Sources: [overlay versus ordinary record](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/world-forge.ts#L100), [article storage](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/world-forge.ts#L274), [bounded DM feed](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/world-prompt.ts#L14), [feed integration](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/turn.ts#L423), [WorldForge AI article input](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/dm/world-ai.ts#L58).

### F15 — Reimport retains old relationship metadata

**Observed:** import/copy a relationship with label ally and veracity known; change it in the source to hidden and rank Captain; copy it again. The target still has known and an empty rank. A probe with real source WorldForge NPC records confirmed this behavior.

**Cause:** copyWorldDoc merges links by from/to/label and only appends previously unseen keys. Existing links are not updated. The JSON import path uses an equivalent append-only relationship merge.

**Improve:** make relationship identity/version handling consistent with entity updates. Decide whether changed source metadata updates, conflicts, or preserves local edits, and report the decision. Label changes/deletions also need an explicit merge policy.

**Acceptance:** repeating an import updates intended veracity, rank, and direction changes without duplicating links; intentional target edits produce a reviewable conflict rather than silent stale content.

Source: [copyWorldDoc relationship merge](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/world-forge-io.ts#L247), [JSON import relationship merge](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/world-forge-io.ts#L130).

### F16 — WorldForge's optimistic whole-slice saves have no conflict protection

**Code-confirmed risk:** useWorld.patch reads latest.current, sends a replacement slice, and replaces the local state with the response. The reference is refreshed in an effect; there is no actual save queue despite the comment referring to queued saves. A failed request restores its entire before-state, potentially rolling back a later successful local change. Two tabs replacing the same links/events slice can lose one another's edits because server writes have no revision check.

This was not reproduced as a timed browser race. The replacement/rollback contract itself is the identified reliability gap.

**Improve:** serialize dependent local saves or use operations keyed by row identity, add revision/conflict detection for multiple clients, and prevent stale responses/rollbacks from overwriting newer state.

**Acceptance:** delayed responses, one failed overlapping save, and two concurrent editors never silently lose another accepted change. The saving indicator reflects outstanding requests, and conflicts have a usable recovery path.

Sources: [state reference](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/world/useWorld.ts#L30), [optimistic replacement and rollback](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/world/useWorld.ts#L74), [server slice replacement](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/world-forge.ts#L71).

### F17 — Portability depends on a global shelf and collision policy

**Code-confirmed behavior:** bundle export includes all of the workshop owner's homebrew monsters/items/options, not just dependencies of this workshop. Import skips an existing same-kind/same-name homebrew row; the recipient's definition wins. An imported encounter or NPC can consequently refer to a different monster than the bundle author intended. Counts alone do not explain that semantic substitution.

Ordinary campaign content import does not transfer the user-scoped homebrew shelf. A newly imported NPC/encounter reference therefore needs the appropriate author shelf to remain available. Bundle statBlock export already translates homebrew IDs into portable names, which addresses one important portability gap; it does not solve conflicting definitions or author-scope mismatches.

**Improve:** preview name collisions with rule differences, support deliberate rename/remapping or preserve bundle identities, expose missing dependencies, and allow dependency-scoped export. Consider pinned versions so later global-shelf edits do not unexpectedly alter other workshops/campaigns.

**Acceptance:** two bundles defining different monsters with the same name can be imported without silently changing either adventure's intended stats. The export preview lists included unrelated shelf content and missing dependencies. Test both bundle import and ordinary campaign import across authorized authors.

Sources: [portable NPC stat block](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/workshop-bundle-export.ts#L31), [entire owner shelf export](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/workshop-bundle-export.ts#L385), [same-name import precedence](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/workshop-bundle-parts.ts#L224), [ordinary content copying](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/db/content-import.ts#L384).

### F18 — The reader and workshop lack a durable source crosswalk

**Observed/code-confirmed:** workshop editors have catalog info popovers but no contextual rulebook-passage links or book-to-draft handoff. Draft data do not retain a rulebook page/anchor, source document, original catalog identity, or a diff against the source. Reading an entry and editing its copy are disconnected workflows.

The exact-title inventory illustrates why a name-based crosswalk is insufficient: grouped Ammunition/Armor/Shield +1/+2/+3 pages, Animated Object family-qualified titles, Elf, Drow, Gnome, Deep, Half-Dragon Template, and Customizing NPCs need explicit mapping or a clear “instruction/template” classification. These titles are not asserted to be missing playable content.

**Improve:** carry stable source metadata into copies and link editor controls/findings to the relevant rulebook passage. Allow “start from this entry” from the reader, preserve navigation context, and distinguish published SRD, other pack sources, authored supplements, and homebrew.

**Acceptance:** every book entry has a tested mapping to a catalog/template/rules-only destination. A copied entry exposes its source and changes. A DM can open the relevant original rule without losing an unsaved draft.

Sources: [book identity model](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/rulebook/types.ts#L8), [catalog information popover](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/CatalogStart.tsx#L121), [draft identity/data conversion](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/draft.ts#L127).

### F19 — Broader chapter coverage still needs an explicit product decision

**Design gap:** the workshop has item, spell, feat, background, species, subclass, and hazard editors; hazards model traps, poisons, and diseases. That does not create a dedicated preparation model for every rules chapter. Examples to decide explicitly include full base-class progression, madness tables/effects, object durability and damage thresholds, and sentient item/artifact properties. Lore, tables, rules, and raw structured blocks can represent some of the prose, but that does not establish an automatic play path for all of it.

**Improve:** maintain a chapter-to-preparation matrix identifying “reference only,” “editable text,” “structured prep,” and “engine-resolved.” Build only the missing tools the product intends to support, and label deliberate manual adjudication accurately. Treat the SRD's customizing-monster/NPC/template guidance as transformation workflows where appropriate, rather than pretending all guidance pages are catalog actors.

**Acceptance:** every one of the 36 general rules pages and every class/race chapter has an explicit destination and supported workflow. No whole-chapter integration claim rests solely on the page rendering successfully.

Sources: [available editor kinds](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/app/workshop/homebrew/types.ts#L12), [hazard coverage](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/workshop/hazard-catalog.ts#L34), [book chapter structure](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/src/lib/rulebook/book.ts#L1).

### F20 — Strengthen the definition and evidence for “fidelity”

**Verification gap:** the spell fidelity suite compares copied SpellMech to the original's SpellMech and counts only spells that have that block. It does not cast each copied spell or compare material facts, zones, summons, transformation, concentration cleanup, or target state. Its item fixtures are synthesized from engine tables with minimal descriptions and omit real catalog weight formats. Monster comparison cannot detect source facts discarded by the common parser.

The historical rules-enforcement audit already distinguishes effect-layer partial/narrated spells and item mechanic coverage. Its “0 open gaps” means zero remaining entries in that audit's ledger, not proof that every paragraph or every later workshop workflow is automated. Do not reuse historical percentages as a fresh measurement of this PR.

The PR also acknowledges that actual local-model Forge/Ask/Draft behavior was not verified with the real model; a deterministic stand-in checks contracts but cannot establish model output quality, tool selection, or reliable use of imported world facts.

**Improve:** add an independently derived coverage ledger keyed by SRD page/entry/effect. Track source presence, discoverability, data preservation, authoring/editability, runtime support, and behavior-level evidence separately. Add live-model smoke cases and a browser matrix for each editor through save/reload/import/play.

**Acceptance:** every completeness assertion has a defined denominator and a current artifact behind it. Exercise renamed and edited copies, pack/no-pack, library/campaign, all DM/player scopes, deletion, collisions, and export/import. Existing passing assertions must remain useful, but passing them alone is insufficient to close the findings above.

Sources: [spell equality assertion](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/scripts/test-workshop-fidelity.mjs#L182), [synthesized item fixtures](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/scripts/test-workshop-fidelity.mjs#L264), [historical coverage distinctions](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/docs/rules-enforcement-audit.md#L62), [AI contract tests](https://github.com/Lebbitheplow/open-dungeon-master/blob/ecd78fe3b3456541f085b72bea1ec002d83e0551/scripts/test-workshop-worldforge-ai.mjs#L1).

## Suggested order for follow-up sessions

1. **Make copied rules portable:** F01–F03 and F05, then F09/F10. Establish a preservation contract that includes every runtime subsystem and full original text.
2. **Make content usable and safe to maintain:** F04, F06–F08, F11/F12. Align author scopes and lifecycle behavior before expanding the catalog further.
3. **Make world preparation reach play reliably:** F14–F17. Cover narrator retrieval, import updates, and concurrent editing.
4. **Make the rulebook integration reviewable:** F13, F18–F20. Add contextual sources, honest support status, and independent coverage evidence.

## Reproduction notes for a later session

Checkout the pinned PR head separately and point CONTENT_DB_PATH at the installed read-only Open5e database. The existing scripts/lib/enforce-world.mjs harness creates scratch databases; import it before application modules. Use world.route for authenticated API probes and world.invoke for the real adjudication entry point. Pure draft/cache probes can use scripts/lib/register-alias.mjs. No temporary audit account or database is required to reproduce the findings.

Useful baseline commands at that checkout:

```sh
CONTENT_DB_PATH=/path/to/open5e.sqlite npm test
npx tsc --noEmit
CONTENT_DB_PATH=/path/to/open5e.sqlite npm test -- scripts/test-workshop-fidelity.mjs scripts/test-enforce-workshop-*.mjs scripts/test-workshop-option-findings.mjs scripts/test-workshop-worldforge*.mjs scripts/test-rulebook.mjs
CONTENT_DB_PATH=/nonexistent npm test -- scripts/test-workshop-fidelity.mjs scripts/test-enforce-workshop-*.mjs scripts/test-workshop-option-findings.mjs scripts/test-workshop-worldforge*.mjs scripts/test-rulebook.mjs
```

Minimal discriminating cases:

- F01: copy Web → Silkbind and Conjure Animals → Call the Wild; prepare only the renamed spell; compare zones/summoned sheets and cleanup with the published cast.
- F02: copy/save Revivify → Second Chance; inspect spellFactsFor and try use_spell_slot at level 3 with no component, no equipment, and zero gold.
- F03: feed an actual saved homebrew row through withMechanics → draftFromCatalog → normalizeHomebrewData; compare all stored mechanic fields.
- F05: compare raw pack special_abilities names against the union of parsed traits/specials, then inspect omitted names and any alternative structured representation.
- F06: hydrate a slugged custom AC-bonus item, delete its entry, and hydrate the returned inventory again; inspect gear.
- F07: in one browser-like runtime register A's Deadeye → Sharpshooter, then B's empty snapshot; holdsFeat for B must be false.
- F08: no-pack content API responses contain usable feat/species/background rows despite packInstalled false; follow those flags through the picker/builder hooks.
- F10: copy Eldritch Blast, change description 1d10 → 20d6 without changing mech.dice; compare preview inputs with mechSpellDamage.
- F11: call springTrapOn with forced d20 faces 1/+20 and 20/+0, using AC 10 and an equipped high-AC target; count hit damage dice on the critical.
- F14: create a WorldForge Character with article text only; inspect worldForPrompt and the ordinary NPC record, then trace the actual narrator inputs.
- F15: copy a real relationship, alter veracity/rank/direction in the source, copy again, and compare target metadata.

Temporary probe code/logs were used as audit aids and were not committed as tests. The descriptions and acceptance checks above are the durable handoff; they deliberately distinguish a verified failure from the additional tests needed to define its full extent.
