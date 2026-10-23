# Workshop → campaign and character creator audit

Date: 2026-10-22  
Audited commit: `433b39593a67fb08b035586a5ec8a44b7a8371eb`  
Scope: read-only application audit; this report is the only repository file added. Existing untracked work was left alone.

## Verdict

**The ordinary paths work, but I cannot sign off that every Workshop creation imports and remains usable correctly.** All 26 selected assertion suites passed, including custom subclass grants, spellcasting, character creation, campaign imports and bundles. Additional isolated probes found failures those suites do not cover: wrong subclass rules after bundle collisions, features lost after renaming, silently failed campaign imports, incorrect nested-table links, and omitted dependencies.

The subclass question has a real discoverability problem behind it. A subclass is saved into its author's Homebrew library, rather than installed by the campaign creator's **Bring in prep** selection. Its availability depends on the selected class, class level, and whose library the builder is reading. The builder does not explain every missing-option case.

I did not inspect the affected user's private subclass or campaign. The conditions below identify what to check; they do not establish which condition that particular user encountered.

## How the user can use their subclass today

1. In **Workshop → Homebrew → Subclasses**, open the saved entry. Check its **Class** and its **Features by level**. Writing only the description does not define feature grants.
2. For a character in their own library, open **Characters → New character**. Choose an appropriate level, then on the **Calling** step choose that exact class. Open **Subclass** and find the entry under **From the workshop**.
3. The subclass selector opens at the class's subclass level. This build uses these levels: **cleric, sorcerer and warlock: 1; druid and wizard: 2; barbarian, bard, fighter, monk, paladin, ranger and rogue: 3**. A Workshop class uses its configured subclass level. A level 1 fighter therefore cannot choose a fighter subclass yet; the campaign's level-up flow asks when it becomes available.
4. At a campaign, options come from the libraries of the **campaign owner, human DM and assistant DM**. A regular player's personal subclass is deliberately excluded until one of those authors keeps a copy. Have that person import a Workshop bundle containing the subclass with **Homebrew items, spells and options** included, then reopen the builder. Exporting the whole shelf currently avoids the dependency omissions in F05; inspect any collision renames because of F01.
5. If the creator is already one of those table authors, their saved subclass should be available without a separate campaign-prep import. Check the parent class, level, whether the entry was forgotten/archived, and whether the catalog request succeeded.
6. Custom feature names and text are granted to the sheet, but arbitrary prose does not become new engine behavior. The editor identifies recognized features with **The engine runs it**. Borrowed features must retain their recognized names for that automation.

The level gate and table-author restriction are intentional behavior. They should be explained where the user is trying to choose the subclass.

Sources: [subclass editor](../src/app/workshop/homebrew/ArchetypeFields.tsx), [subclass loading](../src/app/characters/builder/useBuilderOptions.ts#L167), [From the workshop group](../src/app/characters/builder/usePickerGroups.ts#L388), [level explanation](../src/app/characters/builder/steps/CallingStep.tsx#L332), [content scope](../src/lib/content/scope.ts#L29), [table authors](../src/lib/db/homebrew.ts#L270), [level-up choices](../src/app/campaigns/%5BcampaignId%5D/LevelUpDialog.tsx#L339).

## What goes where

There are three separate operations: copying campaign prep, reading an author's library, and importing a portable file. They are not interchangeable.

### Adventure prep → campaign

The campaign creator's **House rules, lore and prep → Bring in prep → Start from** selection copies the selected source after the campaign is created. An existing campaign's import picker runs the same server import with a preview.

- **Lore:** copied and indexed for retrieval; visibility and pinned state travel. Attached PDFs are deliberately outside the ordinary copy contract.
- **Places:** copied with prepared-map links when the maps travel; visited/current state resets.
- **Region map:** copied as the campaign's region, replacing its existing region when selected. Place references are remapped.
- **Battle maps:** prepared maps and their layers travel. A prepared fight or place can use the copied map.
- **NPCs and factions:** copied with supported links; imported NPCs bring required factions, and factions can also be selected independently.
- **Prepared encounters:** rosters, maps and encounter extras travel. Foreign Homebrew monsters referenced by supported IDs can be brought into the target owner's Bestiary.
- **Roll tables:** rows and no-replacement behavior travel, with drawn results reset. Reference fidelity has the defects in F04/F05.
- **Market shops:** shop policy, prepared stock, place and keeper links travel; play state such as haggling/restock timing resets.
- **Storyboard:** compiled into campaign lore, quests, fights, DM notes, prep cards and an arc/next act, rather than mounted as the editable Workshop board. Previewed omissions and arc limits are part of this conversion.
- **WorldForge:** its overlay, atlas, timeline, secrets and links travel with the narrative records it requires, unless deliberately excluded. Supported bound monsters/items can travel too.
- **House rules and variant rules:** copied through their existing import choice; replacement/append behavior follows that choice.

These paths have substantial existing coverage. The passing checks establish their tested contracts, rather than universal fidelity for every relationship or addon.

Sources: [complete campaign import vocabulary](../src/lib/workshop/import-kinds.ts#L10), [import execution](../src/lib/db/content-import.ts#L372), [column copy contract](../src/lib/db/content-copy.ts), [library dependencies](../src/lib/db/import-monsters.ts), [portability contract](workshop-portability.md).

### Homebrew → character builder and gameplay

- **Classes:** offered through the class catalog; their IDs, hit dice, training, spellcasting and feature tables reach the character engines.
- **Subclasses:** offered under their parent class at its eligible level; features and supported casting/training choices reach the sheet and level-up engines.
- **Species:** offered as ancestry choices with normalized grants and supported traits.
- **Backgrounds:** offered with skills, tools/languages, starting gear, coin and feature data.
- **Feats:** offered when the character earns a feat; prerequisite/grant checks and supported automation apply.
- **Spells:** offered through scoped spell pickers, subject to class/level/learning rules; supported mechanics blocks reach casting.
- **Items:** offered through gear/inventory/shop workflows, subject to the relevant creation rules; supported stored mechanics are hydrated on the server.
- **Monsters:** used through Bestiary, NPC stat blocks and encounter rosters. They are not character-creator options.
- **Hazards:** used by hazard/affliction tools. They are not character-creator options.

All nine Homebrew kinds have a consumer. They are not nine additional campaign-prep checkboxes: the character and gameplay catalogs use personal/table-author scope. Creating a world-pack draft does not install these mechanics.

Sources: [Homebrew kinds](../src/lib/schemas/homebrew.ts#L10), [content catalog](../src/lib/content/index.ts), [creation admission](../src/lib/characters/catalog.ts), [Workshop systems and storage distinction](../src/app/workshop/%5BworkshopId%5D/systems.ts#L22).

### Pregens, rulesets and world packs

- **Party/pregens:** library characters filed under a Workshop travel in its bundle and land in the importer's library. They are not an ordinary **Bring in prep** kind. Using a library character in a campaign is a separate admission step; the player-character and DM-companion paths remain distinct.
- **Ruleset presets:** apply variant rules and house-rule prose. Their Homebrew ticks do not install or restrict character options; see F08.
- **Plugin/world-pack drafts:** travel in Workshop bundles as drafts. Publishing/installing the pack and choosing it as a campaign's setting are separate operations. A world pack provides setting/reskin data and deliberately omits playable Homebrew, maps, encounters, tables and pregens; the conversion reports those omissions.
- **Standalone character files:** carry the sheet and optional portrait, without the Homebrew definitions it depends on; see F07.

Sources: [bundle shelf and pregen arrival](../src/lib/db/workshop-bundle-parts.ts#L268), [campaign admission](../src/lib/db/characters.ts#L372), [pack omissions](../src/lib/workshop/to-pack-omissions.ts), [character file format](../src/lib/character-bundle.ts#L61).

## Findings

P1 means a supported journey can silently lose content or use different rules. P2 means an incomplete transfer or explanation can block the intended journey. **Reproduced** means observed against the current functions/routes using temporary data; **code review** means traced in source without a rendered browser journey.

### F01 (P1): Bundle collisions can give a pregen the recipient's subclass and spells

**Reproduced.** The recipient already has `Marsh Knight` granting `Local Ward`. An incoming bundle has a different `Marsh Knight` granting `Incoming Ward`. The shelf correctly creates `Marsh Knight [Incoming adventure]`, but `landedSheet` leaves both the sheet's `subclass` and its multiclass entry's `subclass` as `Marsh Knight`. Creating the arriving character grants **Local Ward**, not **Incoming Ward**.

A colliding `Marsh Spark` spell is also renamed on the shelf, while the sheet's `known`, `prepared` and nested caster spell lists retain `Marsh Spark`. The same function remaps equipment and feats, but omits subclass and spell names. Shelf arrivals also have no general remapping pass for spell references inside other Homebrew definitions.

**Impact:** a successful import can produce a legal-looking character with the recipient's different rules. The collision report names the new entry but does not repair its consumers.

**Recommendation:** use the arrival map for every structured subclass/spell reference, including multiclass sheets and dependencies inside imported definitions. Verify the resulting grants, rather than only the presence of both shelf entries.

Sources: [collision creation](../src/lib/db/workshop-bundle-shelf.ts#L235), [incomplete sheet remapping](../src/lib/db/workshop-bundle-shelf.ts#L308), [pregen creation](../src/lib/db/workshop-bundle-parts.ts#L268), [feature population](../src/lib/db/characters.ts#L134).

### F02 (P1): Renaming an in-use subclass disconnects existing characters

**Reproduced.** A level 3 fighter using `Audit Bog Knight` has `Bog Ward`. Rename the Homebrew entry to `Audit Fen Knight`, then advance the fighter to level 4 through the sheet patch path. The stored subclass remains `Audit Bog Knight`, `Bog Ward` disappears, and the old name is no longer offered by the legality catalog.

**Cause:** subclass references are stored by name. The update changes the Homebrew entry's name without migrating references or retaining an alias. The editor allows the rename.

**Recommendation:** preserve subclass identity through a rename, preferably with a stable reference and compatible handling of existing sheets. A rename must preserve grants, feature text, spell lists and later level-up behavior.

Sources: [rename route](../src/app/api/homebrew/%5Bid%5D/route.ts#L47), [database update](../src/lib/db/homebrew.ts#L191), [subclass lookup](../src/lib/db/subclass-extras.ts), [offered-name check](../src/lib/characters/catalog.ts#L229).

### F03 (P1): Campaign creation reports success when the selected prep import failed

**Reproduced at the submission helper; caller verified in code.** Stub the import request to return HTTP 400, HTTP 500, or reject with a network error. `submitContentImport` fulfills with `undefined` in all three cases. It never checks the response status and catches network failures. `CreateCampaignDialog.submit` then calls `onCreated` normally.

**Impact:** the campaign exists, but the maps, world, rules or adventure the user selected can be missing with no failure explanation. The ordinary existing-campaign picker checks HTTP errors, so the two entry points behave differently.

**Recommendation:** return and display the import outcome in the existing creation flow, retaining the selected source for retry against the already-created campaign. Success must distinguish campaign creation from prep import completion.

Sources: [submission helper](../src/app/workshop/ContentImportPicker.tsx#L420), [creator caller](../src/app/CreateCampaignDialog.tsx#L315).

### F04 (P1): Imported nested roll tables can roll on the wrong table after a name collision

**Reproduced through `runContentImport`.** The target has `Gems → LOCAL RUBY`. The source has `Gems → INCOMING EMERALD` and `Loot → @table: Gems`. Import both source tables. The source table correctly becomes `Gems (2)`, but the arriving `Loot` reference remains `Gems`. Following that reference returns **LOCAL RUBY**.

The preview warns that a name is numbered; it does not say that the nested reference will point at the old table.

**Recommendation:** remap typed row references using the import's source-to-target names/identities, and report a referenced record deliberately left behind. Cover repeated imports as well as the first collision.

Sources: [roll-table copy](../src/lib/db/content-copy.ts#L181), [reference resolution](../src/lib/dm/roll-table-logic.ts#L180), [authoring typed references](../src/app/workshop/tables/RefPicker.tsx).

### F05 (P1): “Only what this Workshop uses” omits real dependencies

**Reproduced through `exportWorkshopBundle` using `shelf: "used"`.** One fixture contains:

- A roll table with `@monster: Audit Marsh Lurker`.
- A level 3 pregen using `Audit Fen Knight`.
- That subclass grants the custom spell `Audit Fenlight` at level 5.

The export carries the table, pregen and subclass, but omits both the monster and the future spell. Its report classifies both dependencies as **unused**, with `missing: []`. Exporting the same fixture with `shelf: "all"` carries both.

**Cause:** the usage scan receives selected prose, rosters, NPC stat blocks, World bindings and held pregen options. It does not inspect roll-table references or recursively follow a kept subclass's spell dependencies. It explicitly includes a custom subclass's parent class, but does not provide a general dependency closure.

**Recommendation:** gather typed dependencies from every exported record and follow them transitively before applying the shelf selection. Retain the current whole-shelf default. The “used” selection must include future grants, not just what today's character already holds.

Sources: [usage inputs](../src/lib/db/workshop-bundle-export.ts#L286), [usage scan](../src/lib/db/workshop-bundle-shelf.ts#L124).

### F06 (P2): The subclass builder discards the explanation for a player's missing subclass

**Route reproduced; UI code reviewed.** The same player searching for their `Player Marsh Knight` receives:

```text
Personal catalog:  offered = ["Player Marsh Knight"], unadmitted = []
Campaign catalog:  offered = [], unadmitted = ["Player Marsh Knight"]
```

That exclusion is intentional. However, `useArchetypes` reads only `results`, ignores `unadmitted`, and swallows request failures. The corresponding species/class/background loader also omits exclusion/failure status; a failure in any of its three requests makes the entire batch fall back. Classes additionally have no entry in the server's `unadmittedNames` kind map. The generic item/spell/feat search hook already preserves `unadmitted` and failure state.

After saving a subclass, Homebrew keeps the editor open without explaining parent-class level or table-author availability. Its guide says the builder offers the content alongside the books without explaining those scope conditions. Additionally, a Workshop with only library content has no campaign-prep import kinds, so **Start from** can describe it as “still empty” despite its Homebrew count.

**Recommendation:** use the existing editor/help and picker status areas to explain where the entry is available, the parent class and required level, and whose copy the table needs. Preserve the API's existing exclusion/error information in these pickers. Explain “no campaign prep to copy” separately from an empty Homebrew library. No additional setting is needed.

Sources: [scope response](../src/lib/content/scope.ts#L55), [subclass loader](../src/app/characters/builder/useBuilderOptions.ts#L167), [option batch](../src/app/characters/builder/useBuilderOptions.ts#L66), [generic search behavior](../src/app/characters/builder/useContentSearch.ts), [save behavior](../src/app/workshop/homebrew/HomebrewPanel.tsx#L187), [guide](../src/lib/tours/workshop-guide.ts#L184), [empty-source message](../src/app/workshop/ContentImportPicker.tsx#L404).

### F07 (P2): A character file alone cannot transfer its custom subclass

**Reproduced.** Build a valid level 3 fighter with `Audit Marsh Knight`, export it with `buildCharacterBundle`, and pass its sheet to the real import admission function. Admission succeeds for the original author. For a second user without that Homebrew entry it fails:

```text
Audit Marsh Knight is not a subclass of the Fighter; pick one from that class's list.
```

The character file contains the sheet and optional portrait, without the subclass definition. UUID-based species, backgrounds and Workshop classes have an additional portability issue: the ordinary character file does not use the Workshop bundle's portable-reference conversion.

**Recommendation:** explain the dependency transfer before export/import, or carry the required definitions through an explicit dependency-aware format. Preserve destination admission checks. For an immediate transfer, use the Workshop bundle with the character filed as a pregen and the required Homebrew included; still review F01/F05.

Sources: [character file schema/writer](../src/lib/character-bundle.ts#L61), [import admission](../src/app/api/characters/import/route.ts#L60), [Workshop portable references](../src/lib/db/workshop-bundle-shelf.ts#L69).

### F08 (P2): The existing ruleset Homebrew ticks do not ship or admit Homebrew

**Code review.** The Ruleset Library labels this control **Homebrew this ruleset ships** and says checked entries are canon wherever the ruleset is applied. The stored `homebrewIds` remain on the library preset. Applying the preset copies variant rules and house-rule prose only; the content-scope and admission readers do not consult those IDs. Capturing a campaign as a ruleset initializes the list to empty.

**Impact:** checking a subclass here is not a way to install it at another table or choose which author-owned options that table offers. Users can reasonably infer that it is.

**Recommendation:** make the existing label/help match its implemented meaning, or implement a persistent, reviewed canon/dependency contract. Do not add a second admission toggle to explain the first.

Sources: [control and promise](../src/app/workshop/RulesetLibrary.tsx#L272), [apply/capture](../src/lib/db/rulesets.ts#L149), [current visibility rule](../src/lib/content/scope.ts#L29), [ruleset model](../src/lib/rulesets/logic.ts#L22).

## Verification and limits

The following run passed **26 script suites** with the installed content pack:

```bash
npm test -- \
  scripts/test-workshop-classes.mjs scripts/test-workshop-scope.mjs \
  scripts/test-enforce-workshop-subclasses.mjs scripts/test-enforce-workshop-species.mjs \
  scripts/test-enforce-workshop-backgrounds.mjs scripts/test-enforce-workshop-feats.mjs \
  scripts/test-enforce-workshop-items.mjs scripts/test-enforce-workshop-spells.mjs \
  scripts/test-enforce-workshop-monsters.mjs scripts/test-enforce-workshop-hazards.mjs \
  scripts/test-workshop-integration.mjs scripts/test-workshop-bundle.mjs \
  scripts/test-workshop-dependencies.mjs scripts/test-workshop-import.mjs \
  scripts/test-workshop-links.mjs scripts/test-workshop-isolation.mjs \
  scripts/test-workshop-fidelity.mjs scripts/test-workshop-option-findings.mjs \
  scripts/test-workshop-board.mjs scripts/test-workshop-market.mjs \
  scripts/test-workshop-world-sync.mjs scripts/test-world-use-in-campaign.mjs \
  scripts/test-campaign-creator-flow.mjs scripts/test-character-bundle.mjs \
  scripts/test-workshop-start-from.mjs scripts/test-import-preflight.mjs
```

Four suites also passed with the optional content pack absent:

```bash
CONTENT_DB_PATH=/tmp/odm-audit-content-pack-absent-2026-10-22.sqlite npm test -- \
  scripts/test-workshop-classes.mjs scripts/test-workshop-scope.mjs \
  scripts/test-enforce-workshop-subclasses.mjs scripts/test-workshop-start-from.mjs
```

These scripts execute their own top-level assertions; Vitest's “0 tests” refers to native Vitest test registrations, not to an absence of assertions.

Additional probes ran from shell stdin against the existing `enforce-world` scratch harness. They created temporary users, campaigns, Workshops and library entries, called the production functions/routes named in F01–F07, printed the observations recorded above, and closed the scratch databases. The campaign submission probe stubbed `fetch`. No permanent test files, application changes, real-user mutations, commits or pull requests were made.

Browser components were inspected in source. I did not run a rendered website/app-shell journey, accessibility scan, real model generation, or an addon/provider matrix. Existing browser scenario `60-workshop-classes` covers class editing and saving, rather than a complete custom-subclass creation → selection → campaign admission journey. The report therefore separates observed backend/helper behavior from UI-source findings.

Before treating Workshop integration as complete, cover the failing seams above and add a browser journey that saves a custom subclass, chooses it at the eligible level, enters a campaign, and verifies its features and casting. Exercise both a table author and a regular player, with an explained exclusion for the latter. Repeat the journey in the app shell. No new controls are required to establish that contract.

## Follow-up: the fixes, and the defects of the same family (2026-10-22)

A second pass swept the codebase for the patterns behind F01 to F08: a reference held by name or by this server's id that crosses an import or a rename, a dependency an export does not follow, and a request whose failure is swallowed. Every finding above, and every defect of the same family listed below, is fixed on server branch `workshop-import-audit` and client branch `host-gate-workshop-references`, unless marked otherwise.

### The eight findings

- **F01:** a bundle's arrivals land in dependency order (spells, items, then what names them, classes before subclasses), and each arrival's own references are named as they are called here before it is compared with the importer's entry, so a subclass whose spell arrived renamed is not taken for the importer's. Pregens follow every renamed subclass, spell, feat and item, the multiclass entries and casters' lists included (`src/lib/homebrew/sheet-refs.ts`). The new workshop's roll tables and shop shelves follow renamed monsters and items (`src/lib/db/prep-refs.ts`).
- **F02:** a rename carries the old name's holders with it, in one transaction: the author's library characters, the sheets and prep of every table the author runs, and the author's own entries that name it (`src/lib/db/homebrew-rename.ts`). It is not carried where another author's entry of that name answered first, nor where the books publish the name. Spells, feats, items, monsters and hazards are carried the same way as subclasses. The editor says what a rename carried.
- **F03:** the creator keeps the campaign it made; a prep import, house rules or lore that did not land is said on the review with a way into the campaign as it is, and Try again sends only what failed. The import picker's own refusals, network failures and failed previews are said too.
- **F04:** a campaign import points its copies' names at the copies, this import's or an earlier one's: roll-table rows, place connections, NPC locations and relations, and map pins (`src/lib/db/content-import-refs.ts`). A roll-table row whose record stayed behind is named in the outcome and warned about in the preview.
- **F05:** "only what this workshop uses" is a closure: what the workshop's rows name (Cast, fights, roll tables, shop shelves, map pins, pregens, World links, and the prose of rewards, personalities, faction blurbs, map notes and house rules), then whatever a kept entry names in turn. The report names missing spells and items as well as monsters.
- **F06:** the content API names a player's own classes as well as subclasses a table leaves out, and a subclass search names only that class's. The builder, the level-up dialog and the content pickers say why a list is short (left out at this table, or not loaded), and a failed list no longer takes the others with it. The Homebrew editor says where a kept entry is offered, a subclass with its class and level; the guide, the tour and the empty-source message say the same.
- **F07:** a character file carries the Homebrew its sheet stands on, and names it by kind and name; on import it lands on the importer's shelf through the bundle's arrival rules before the sheet is judged, and a refused file takes its arrivals back (`src/lib/db/character-file.ts`).
- **F08:** the Ruleset Library no longer offers the Homebrew ticks; it says that a ruleset carries rules, and that the author's Homebrew already counts at every table they run. Stored lists are kept and still accepted from older clients.

### The same family, found by the sweep

Imports and exports:
- A fight's roster row naming the author's monster as `homebrew:<id>` was exported as the id and fielded nothing for anyone but its author. Rosters now travel by name.
- Map pins kept the source's lore, NPC and table ids through bundles and campaign imports and opened nothing. They now follow the rows they named, or lose their link and keep their words.
- A campaign import brought hand-built monsters only for `homebrew:<id>` refs. Monsters and items the copied rows name by name (stat blocks and rosters from a bundle-made workshop, roll-table rows, map pins, shop shelves) now travel when the target's authors answer differently, with the homebrew spells they cast.
- Items brought by a campaign import were compared on raw data and could arrive as needless duplicates; they are compared on their rules now.
- Unticking a bundle's monsters or Homebrew while keeping its pregens, Cast, fights, tables or shops was not warned about; the preview now counts those dependencies, and a pregen's homebrew reference falls back to the importer's own entry of that name.
- A bundle NPC numbered on arrival could lose its faction; a roster row written as a bare name lost its placements and overrides.

Silent failures:
- The creator's house rules and lore (as well as its prep import).
- The import picker: a refusal shown in the success colour, a network failure with no message, an unreadable source list shown as "nothing to copy", a failed preview that left the import enabled.
- Homebrew: save and copy with no network handling; forget, restore and delete-for-good that ignored refusals; a catalog that could not be reached reported as "not in the catalog".
- The Ruleset Library: preview, apply, save and delete.
- The Workshop shelf: create, copy and delete. The character library: portrait, copy, delete, the portrait poll, and discarding a copy. A bundle import's raw "Failed to fetch".
- Content pickers that reported any failure as a missing content pack, and a small catalog picker that vanished on a failure.
- The spell pool and feat text caches remembered a failed request as "no such spell" or an empty feat, and a transient failure unregistered a table's workshop feat in the browser.
- The level-up dialog labelled a workshop subclass "description only".

Left alone at first, then traced and fixed:
- A campaign clone kept the story arc but cleared each NPC's link into the arc's cast. The next link is made by name, so a cast member whose NPC was renamed since was never joined again. The clone now keeps the links, since its arc is the source's own (`src/lib/db/campaign-clone.ts`).
- A storyboard fight's step was written before the import brought the monsters its roster names, so it could read "2 homebrew:<id>" or a name the monster no longer has at the table. A fight step is ticked by matching the foes end_encounter reports against its words, so such a step never ticked by itself. The arc is now written last, and a step names each foe as the table calls it (`src/lib/db/workshop-storyboard.ts`).
- Two roll tables of one name were not only a bundle's problem: the table editor let one campaign hold both, and a "@table:" row, or the DM rolling by name, only ever found the first. A new table whose name is taken is now numbered, the way imports number theirs; renaming onto a taken name is refused with the reason; renaming a table carries the "@table:" rows that rolled on it; and a bundle's duplicates land numbered after the first, which keeps the name it was rolled by (`src/lib/db/roll-tables.ts`). The tables panel's delete and reset now say when they fail.

Traced and not defects:
- A workshop class names a book spell list ("wizard"), not spells. A homebrew spell joins that list by naming the book class, so the class has no spells of its own for the closure to follow.
- A homebrew feat holds its prose, a prerequisite and the published feat it runs as. A spell a character takes through it is on the character's sheet, which the closure follows.
- Campaigns that already hold two tables of one name keep them: the first still answers to the name, and either can now be renamed apart.

### Verification

- New: `scripts/test-workshop-references.mjs` (16 checks against a real database: F01, F02 and its family, F04 and its family, F05, F06, F07, the by-name monster, item and spell import, the clone's cast links, a storyboard fight step's foes, and roll table names) and `scripts/test-workshop-import-feedback.mjs` (10 checks: F03 outcomes, bundle preview dependencies, sheet and entry renames, the scope note, F08). The three checks added after the first pass fail on the code before their fixes.
- New browser scenarios: `63-workshop-subclass` (a subclass made in Homebrew with a feature, the editor's availability line, offered under From Homebrew for a level 3 fighter with its feature granted, offered under its new name after a rename, and a table's left-out note), `64-prep-import-failure` (the import picker's failed preview and refusal, the creator's follow-up and a single campaign on Try again) and `65-table-names` (a second table of a taken name arrives numbered, a rename onto a taken name is refused in the editor with the reason, a rename to a free name carries the row that rolls on it), desktop and phone, website and app shell.
- The full suite (`npm test`, 725 files) passes once the name guard classifies the new roll table and clone sites; one existing expectation changed with the fight step fix (a roster's "bandit" is now named "Bandit", as the table calls it). The workshop suites pass again without the content pack.
- Browser: the three new scenarios with `setup-prep-and-end`, `workshop-classes`, `campaign-creator`, `world-use-in-campaign`, `import-owed`, `level-up-classes` and `builder-search` pass on the website and in the app shell (`--app`), desktop and phone, 20 runs each (`table-names` was rerun on the website after a selector fix in the scenario itself); `32-builder-a11y` (axe) passes on desktop and phone.
- `npm run build`, the bundle budget, `tsc` and `eslint` pass; the client's `npm test` passes.
