# The Workshop: DM prep and world building, outside any campaign

A phased plan for a user-scoped place where a DM builds maps, NPCs, monsters,
story and rules before a table exists, and imports any of it into a campaign at
creation time.

Companion to `docs/human-dm-plan.md`, which built the human DM seat *inside* a
running campaign (phases 1 to 8, all shipped). This plan builds the room the DM
works in *before* the session.

---

## 0. The finding that shapes this plan

Almost every tool in the request already exists. What does not exist is a place
to use them before a campaign does.

| The ask | What ODM already has | What is actually missing |
| --- | --- | --- |
| Overworld maps | `src/lib/overworld/logic.ts` (seeded 96x72 noise terrain, six tile classes, genre reskins), `db/overworld.ts` (anchors, pins, party marker, DM notes), `OverworldPanel` / `OverworldAuthoring` | No brush. The overworld is generate-or-nothing; there is no hand editing of a single tile |
| Dungeon maps | `battlemap/generate.ts` (seeded rooms, lights, spawns), `battlemap/paint.ts` (5-brush painter with connectivity validation), `dm/map-studio.ts` (preview, reroll, apply, paint), `DmMapStudioPanel` | Maps only exist attached to a live encounter. No saved map that outlives a fight, no import of outside art |
| AI-generated maps | ComfyUI / FLUX worker, `dm/maps.ts`, `dm/images.ts`, genre `mapStyle` prompts | Illustrated maps are pictures only. They carry no walls, so the rules engine cannot run on them |
| Interactive NPC creation | `db/npcs.ts` with a real agency model: personality axes, goals, NPC-to-NPC relations, per-character bonds, a pressure meter, aliases, attitude | **Closed in phase 5.** There was no authoring form: NPCs were born from AI tool calls or `NpcReviewPanel` |
| Storyboarding | chapters, arcs (`dm/arc.ts`), beats, facts, lore entries, `dm/director.ts`, `dm/assist/suggest` | All of it is retrospective. There is no forward-looking board of scenes, hooks and secrets |
| NPC party members | `CompanionBuilderDialog`, `companions/create`, `companions/request` | **Closed in phase 5.** Companions were campaign-local, with no library, unlike PCs |
| Monster / boss builder | 3,207 Open5e monsters, 7 genre bestiaries, `bestiary/statblock.ts`, `synthesize.ts` (DMG by-CR baseline), `homebrew` kind `"monster"`, `dm/assist.ts quickStatblock` | No editor. `synthesize` goes CR to stats; nothing goes stats to CR, so a hand-built monster has no honest difficulty number |
| Grouped enemies | `encounter_templates` (roster, battlefield, map settings, notes) plus mob initiative from human-DM Phase 2 | Templates are campaign-scoped and cannot be reused or shared |
| Encyclopedia | `/reference` over the content DB plus `src/lib/help` glossary | Read-only, and unaware of house rules or homebrew |
| Calculator | `srd/encounter-math.ts` (CR to XP, per-level thresholds, DMG multiplier bands), `srd/odds.ts` (hit chance, expected damage, rounds to drop), `DmOddsPanel` | Needs a live party to point at. Useless during prep |
| Table ruleset | `db/rules.ts` (house-rules text, chunked, embedded, per-chunk enable/pin), `gameSettings.variantRules`, per-user `homebrew_entries` | Three separate things with no single object binding them, and nothing user-scoped |
| World Anvil | nothing | Everything, and it stays that way. See section 6 |

**So this is not eleven new subsystems. It is one new scope plus the editors
the existing subsystems never got.** Planning it as eleven new subsystems is
the main way this goes wrong.

---

## 1. The load-bearing decision: a workshop is a campaign row

The character library is the precedent that already works. `library_characters`
holds a sheet the user owns; `instantiateIntoCampaign` copies it into
`character_sheets` and only the copy mutates during play. A dead campaign never
corrupts the library version.

We want the same shape for world content, but world content is nine tables
(`lore_entries`, `npcs`, `roll_tables`, `encounter_templates`, `locations`,
`overworld_maps`, `battle_maps`, `rule_chunks`, `campaign_notes`), not one.

**Two ways to get there.**

**Option A, the honest schema:** add a nullable `workshop_id` beside
`campaign_id` on every content table, with a CHECK that exactly one is set.
Then every DB rim, every route guard, every SSE projection and every panel
grows a second code path. Roughly nine table migrations and forty call sites,
and each one is a chance to get a visibility rule backwards. `human-dm-plan.md`
section 2.3 already warns about exactly this failure mode.

**Option B, the shadow campaign:** a workshop **is** a `campaigns` row with
`kind = 'workshop'`. Every content table, route guard, permission helper,
projection and panel works unchanged, because there is nothing new to teach
them. Importing into a real campaign is a row copy between two campaign ids,
which is the same operation `instantiateIntoCampaign` performs on a sheet.

**Take Option B.** The cost is a handful of guards rather than a schema
migration, and the guards are enumerable:

- `campaigns.kind TEXT NOT NULL DEFAULT 'campaign' CHECK (kind IN ('campaign','workshop'))`,
  added through the `addColumns` helper in `src/lib/db/core.ts`.
- `listCampaignsForUser` filters `c.kind = 'campaign'`. The workshop still gets
  an owner row in `campaign_members` so `requireDm` and `requireMember` keep
  working untouched.
- A workshop never wakes an AI turn. `dm/wake.ts`, `dm/loop.ts`,
  `dm/world-tick.ts`, `dm/beat-cadence.ts` and chapter close all return early
  on `kind === 'workshop'`. One shared predicate, `isWorkshop(campaign)`, so
  there is one thing to grep for and one thing to test.
- `gameSettings.dmMode` is forced to `"human"` and `status` to `'lobby'`.
- Admin panels and `/api/campaigns` list workshops separately.

Write `scripts/test-workshop-isolation.mjs` first, and have it assert the
negative: a workshop row produces no DM turn, no world tick, no beat nudge,
and never appears in a campaign list. That test is the whole safety argument
for Option B and it should exist before the first panel does.

### 1.1 The stand-in party

Three tools need a party that does not exist yet: the encounter calculator
needs levels, `openScene` in `map-studio.ts` refuses to run without sheets, and
the odds panel needs a target to point at.

Give the workshop a **target party** rather than fake sheets:
`workshop.targetParty = { size: number, level: number, characters: string[] }`,
stored in `settings_json`, where `characters` are optional
`library_characters` ids. `thresholdsForParty` already takes a bare array of
levels, so the calculator needs nothing else. `openScene` takes an optional
roster of placeholder tokens instead of reading `listSheets`.

This is also the honest answer to "strength vs party size and level": the DM
declares the party they are building for, once, and every tool in the workshop
reads it.

---

## 2. The second decision: a ruleset is an object

The request says "all tools assume the ruleset is being enforced." Today a
"ruleset" is three unrelated things: `gameSettings.variantRules` (eight flags
in a Zod schema), `campaigns.house_rules_text` (free prose, chunked and
embedded into `rule_chunks`), and `homebrew_entries` (per-user, per-kind).
Nothing binds them, and none of it is reusable across campaigns.

New user-scoped table `library_rulesets`:

```
id, user_id, name, description,
variant_rules_json,   -- the existing GameSettings["variantRules"] shape
house_rules_text,     -- the existing chunked prose
homebrew_ids_json,    -- which of the user's homebrew entries this ruleset ships
content_flags_json,   -- SRD only / Open5e / genre bestiaries, per kind
created_at, updated_at
```

Three consequences, and all three are the point:

1. **A workshop selects one ruleset.** Every workshop tool reads it. The
   monster builder validates against it, the calculator applies its crit and
   flanking rules, the encyclopedia searches homebrew alongside SRD, the map
   builder honours its terrain rules.
2. **Import applies it whole.** One selection at campaign creation sets
   `variantRules`, posts the house rules to `PUT /rules`, and makes the
   homebrew visible. This is what `submitWorldSetup` in
   `src/app/WorldSetupFields.tsx` already does by hand for two of the three.
3. **Validation has somewhere to live.** `src/lib/rulesets/validate.ts`, pure,
   takes a ruleset plus a draft (monster, encounter, map, NPC) and returns
   findings. It is the single place any tool asks "is this legal at this
   table," which is the only way "all tools assume the ruleset" stays true
   after the fifth tool is added. (Deferred: this module was never built.
   Rulesets ship variant flags, prose and homebrew today; nothing validates
   drafts against them yet.)

Do not let a ruleset introduce mechanics. `docs/worlds.md` already establishes
why: sheets store spells, items and features **by name**, so anything that
rewrites a canonical name at storage time silently breaks `findSpellByName`,
`use_spell_slot` and `FEATURE_EFFECTS`. A ruleset toggles and adds. It never
renames.

---

## 3. Design rules for the workspace

`human-dm-plan.md` section 4 set these for the console. The workshop needs its
own, because prep is a different job from running a table.

1. **The workshop is a shelf, not a wizard.** Every artifact stands alone and
   is finishable in one sitting. Nothing requires finishing something else
   first. A DM who only ever builds one map got full value.
2. **Every artifact carries its own import contract.** A map knows it becomes a
   `battle_maps` row, an NPC knows it becomes an `npcs` row. The DM never
   learns a translation layer, and "will this work in a campaign" is answered
   in the workshop, not after the import.
3. **Generation is a first draft, never a commit.** Every AI or procedural
   button produces something editable that has not been saved. This is
   `previewStudioMap`'s existing contract and it should hold everywhere.
4. **The ruleset badge is always on screen.** If the tool is enforcing
   something, say which ruleset, and let one click open it.
5. **Suggestions are ambient, not modal.** The storyboard's topic suggestions
   sit in a rail, the way `DmAssistPanel` does. They never interrupt.
6. **Nothing here needs a model to work.** The generators are seeded and pure;
   the AI is an accelerator. A workshop on a machine with no model running is
   a slower workshop, not a broken one. This is already true of
   `overworld/logic.ts` and `battlemap/generate.ts` and it should stay true.
7. **Import is always partial and always previewed.** The DM picks what
   crosses over, sees the count, and can bring the rest later.

---

## 4. Prior art worth using, and what its license allows

The request asks whether existing projects can be adopted. Checked, with the
verdicts:

- **`foundryvtt/dnd5e`, MIT.** Already the reference for `docs/rules-coverage.md`.
  For this plan the relevant piece is nothing new: its compendium browser and
  `award.mjs` shapes. Keep mining it, keep logging substantial borrowing in
  `docs/LICENSES.md`.
- **Universal VTT (`.dd2vtt` / `.uvtt`), an open JSON format.** This is the
  single highest-value import format in the list, because it carries **wall
  segments, portals and light sources** alongside the image. ODM has a real
  line-of-sight engine (`battlemap/los.ts`) and a light model, so a UVTT file
  is the one outside map format whose mechanics ODM can actually consume
  rather than merely display. Dungeondraft, Dungeon Alchemist and others
  export it.
- **Azgaar's Fantasy Map Generator, MIT (verify at implementation time).** A
  browser world generator with political, cultural and religious layers well
  beyond `overworld/logic.ts`. Do not vendor it: it is a large monolithic app
  with its own UI. Support its export as an **import format** for the
  overworld, and read its algorithms for the terrain classifier.
- **watabou's generators (One Page Dungeon, Medieval Fantasy City), Dungeon
  Scrawl, donjon.** Popular, but the source is closed or unclear. Import their
  exported files where the format is documented; vendor nothing. Verify each
  license before doing even that.
- **`foundryvtt/foundryvtt` core.** Documentation only, no source, proprietary
  EULA. Read the articles as a spec, exactly as `human-dm-plan.md` section 0
  established. Copy nothing.

The pattern across all of these: **import formats, not dependencies.** ODM is
offline-first and self-hosted; adding a large browser app as a dependency
fights that, while supporting its file format costs one parser and gives users
the tool they already like.

---

## 5. Phases

Ordered so the import loop closes at Phase 3. Everything after that lands in a
workshop that already delivers value.

### Phase 1: the shell (BUILT)

`campaigns.kind`, the `isWorkshop` guards, `scripts/test-workshop-isolation.mjs`,
`/workshop` and `/workshop/[id]`, `POST|GET /api/workshops`, the target party,
and a tabbed shell that starts with only the panels that already exist
(`DmMapStudioPanel`, `OverworldPanel`, `LorePanel`, `DmTablesPanel`,
`DmEncounterPrepPanel`, `RulesPanel`). Most of this phase is wiring, and at the
end of it the existing panels run outside a campaign.

*Ships:* prep artifacts that survive between campaigns, in the panels the DM
already knows.

### Phase 2: rulesets (BUILT)

`library_rulesets`, the ruleset picker in the workshop header,
`/api/rulesets`. Homebrew gets a library view rather than living only inside
the character builder's pickers. The `src/lib/rulesets/validate.ts` validator
this phase promised stayed unbuilt and is deferred; the ruleset informs the
tools but is not enforced at authoring time.

*Ships:* one table ruleset, written once, reusable.

### Phase 3: import into campaign creation (BUILT)

The loop closes here.

- `POST /api/campaigns/{id}/import` taking `{ workshopId, select: {...} }` and
  copying rows inside one transaction, with names deduplicated on collision.
- `src/lib/workshop/import.ts`, pure planner: given a workshop and a selection,
  return the exact list of rows to write plus any conflicts. Testable without
  a database, same shape as the rest of `src/lib`.
- `CreateCampaignDialog` gains a "Start from a workshop" step with per-kind
  checkboxes and counts. `submitWorldSetup` folds into this: it is already the
  post-creation drafts-poster, just narrower.
- Import is also available after creation, from the lobby, because prep
  continues after session one.

*Ships:* the whole point of the feature.

### What phases 1 to 3 actually shipped, and where they differed

The spine is in. `campaigns.kind` (`src/lib/db/core.ts`), the pure guards in
`src/lib/workshop/kind.ts`, `/workshop` and `/workshop/[id]` running the six
existing DM panels unchanged, `library_rulesets` with
`src/lib/rulesets/logic.ts`, and the import planner in
`src/lib/workshop/import.ts` behind `POST /api/campaigns/{id}/import`.

Three places the build departed from the plan above, all deliberate:

- **The AI-turn guard is one line in `requestDmTurn`, not nine.** The plan
  named `wake.ts`, `loop.ts`, `world-tick.ts`, `beat-cadence.ts` and chapter
  close. In practice `requestDmTurn` is the only door: `tickWorldState` runs
  only inside `turn.ts`, and the beat cadence is computed client-side in
  `SessionView`. One guard on the way in beats five that each have to be
  remembered.
- **`content_flags_json` was dropped from the ruleset table.** Nothing reads
  it. `homebrewIds` stayed because Phase 6's monster editor has a real use
  for it; a column with no consumer is a liability, not a head start.
- **`scripts/test-workshop-isolation.mjs` is joined by
  `scripts/test-workshop-integration.mjs`.** The isolation suite tests the
  pure predicates, which is the house style, but the load-bearing claim of
  section 1 is a claim about the database, and a pure test cannot make it.
  The integration suite makes its own throwaway key and temp SQLite file, so
  it needs no environment, and it covers the upgrade path in a second process:
  drop `campaigns.kind`, reopen, and assert every existing row reads as a
  campaign.

Left for Phase 4 as planned: `battle_maps` rows cannot be imported, because
`battle_maps.encounter_id` is NOT NULL and a prep map has no encounter. The
import picker does not offer them rather than offering them and failing.

### Phase 4: maps (BUILT)

The largest phase, and the one with the real technical decision in it.

**The tension:** ODM's battle map is a row-major string over a five-character
terrain alphabet (`.` floor, `#` wall, `~` water, `,` rough, `+` door). That is
what makes pathfinding, LOS, cover and fog cheap and server-authoritative. A
"tile builder" in the Dungeondraft sense means art, and art does not fit in
five characters.

**The resolution:** two layers, honestly separated. The mechanical layer stays
the terrain string, and it is the only thing the engine reads. The backdrop is
a picture drawn under the grid that nothing mechanical consults. Every surface
that shows one says so out loud.

**What shipped, in five pieces.**

**The overworld brush.** `src/lib/overworld/paint.ts` beside `logic.ts`,
`paintOverworldTerrain` in `db/overworld.ts`, a `strokes` field on the
overworld PATCH, and a Paint terrain mode with a six-brush palette and a size
slider in `OverworldPanel`. 26 assertions in
`scripts/test-overworld-paint.mjs`.

The constraint it enforces is not the battle map's. A battle map owes the
engine a connected field and a walled border; the region map owes it somewhere
to stand, because `placeAnchor` refuses water and mountain, so a region painted
entirely into ocean and peaks is one where every location the campaign ever
discovers piles onto the same fallback tile. Painting the last settleable tile
away is refused with that reason. Anchors the paint leaves in the sea are
**reported, never moved**: `setOverworldAnchor` already accepts water and
mountains on the stated grounds that a DM who puts a lighthouse on a reef means
it, and quietly relocating a town because the DM widened a lake would
contradict that.

**The stamp palette.** `src/lib/battlemap/stamp.ts` compiles a shape (room,
corridor, cavern, pillared hall, pool, rubble) into ordinary brush strokes and
does nothing else, so every stamp goes through `paintTerrain` and inherits its
whole rulebook: it cannot wall a combatant in, cannot open the border, cannot
produce a picture the pathfinder refuses. The stamp is a shape, not a second
painter. 25 assertions in `scripts/test-map-stamp.mjs`.

*There is no stairs stamp*, which the plan asked for. The alphabet has five
characters and none of them is a level change; inventing one would mean a tile
the pathfinder, the fog and the DM prompt all have to learn. A door is the
crossing between two places this engine can actually run.

**The backdrop layer.** `battle_maps.backdrop_path` plus
`backdrop_transform_json`, the same pair on `prepared_maps`, and
`src/lib/battlemap/backdrop.ts` for the geometry and the guard. A path is
accepted only if it matches a file this app wrote through `/api/upload`,
refused rather than sanitized, which is what keeps a stored transform from
becoming a directory traversal or an outbound request to somebody else's
server. 19 assertions in `scripts/test-map-backdrop.mjs`.

Fog was the part that was easy to get wrong. A backdrop drawn edge to edge
would show a player the whole dungeon through the fog hiding the terrain, so
the projection carries the image and the renderer draws it under the terrain
cells, where unexplored tiles keep their opaque square. The art is covered
exactly where the terrain would have been.

**UVTT import.** `src/lib/battlemap/uvtt.ts`, and the piece with the real
problem in it. A UVTT wall is a LINE between two tiles; an ODM wall is a TILE.
Reading it the naive way (mark the tile each line passes through) rounds the
walls on both sides of a one-tile corridor into the corridor and deletes it.

So the conversion is edge-based: each segment blocks the tile EDGES it lies
along, and the solid rock is then found by flooding inward from outside the
map. Every tile the flood reaches without crossing a blocked edge is outside
the building and becomes wall; everything it cannot reach is enclosed space and
becomes floor. Corridors survive at their true width and rooms keep the size
they were drawn. A drawing whose walls do not close is refused with what to do
instead, rather than handing back a slab of rock. Portals become doors only
where they land between two open tiles, and the import says how many it had to
leave out. 26 assertions in `scripts/test-map-uvtt.mjs`.

The picture never passes through the import route: the client uploads it via
`/api/upload` first, which is this app's one image writer and the one place
that decides what an image is, and the route receives a path.

**The map library**, and the one place this plan was wrong.

The plan said to make `battle_maps.encounter_id` nullable so maps could outlive
encounters. That would put a second lifecycle through every token, fog and
movement path that currently assumes the link, for the sake of prep that needs
none of them. Prepared maps have no tokens and no fog: they are prep, and a map
with combatants standing on it before the fight exists is a virtual tabletop,
which section 7 lists as the thing not to drift into.

So `prepared_maps` is its own table holding only the ground, and deploying one
copies its terrain into a fresh encounter's battle map. Nothing on the table
ever points at a prepared map and no combat code learned a new shape. The FK
was never touched.

Being campaign-scoped makes a workshop a map library for free, and fixes the
gap Phase 3 left open: `maps` is now an import kind, so maps drawn in a
workshop travel into a real campaign through the same copy as everything else.

`DmMapLibraryPanel` is what makes the workshop's map tab useful at all. A
workshop has no party, so it can never open a scene, and until this the tab
could only roll previews it had nowhere to put. Now a DM rolls, starts from
blank rock or blank ground, or imports a drawing; paints and stamps it; and
puts it on a table weeks later. 12 further checks in
`scripts/test-workshop-integration.mjs`, against a real encrypted database.

*Ships:* overworld and dungeon maps, generated or drawn or imported, saved and
reusable.

### Phase 5: NPCs and companions (BUILT)

**The NPC forge.** `db/npcs.ts` has held a real agency model since it was
built (six personality axes that drift with how the party behaves, a scene
goal, a session goal advanced by background dice at chapter close, a defining
ambition, NPC-to-NPC relations, aliases, a pressure meter), and every bit of
it was reachable only by the AI DM's tool calls. `src/lib/npcs/forge.ts` is
the pure half of the form over it, `/api/campaigns/{id}/dm/npcs` the rim, and
`DmNpcForgePanel` the panel. Because the panel is DM-only prep it is the
workshop's cast list for free, under a new Cast tab. 48 assertions in
`scripts/test-npc-forge.mjs`.

Two things in the forge are not validation, and they are why it is a module
rather than a zod schema.

*An axis is stored as a number and read as a word.* A DM setting "warmth: 2"
is guessing; a DM setting "warm" is writing a person. The number is what the
engine drifts and compares, the word is what a human works in, and zero reads
as "neither" because most people are unremarkable on most axes and a roster
where everyone is extreme on all six is a roster of cartoons.

*A relation is one-sided by construction.* Relations are stored per NPC, so
Marla can hold a grudge the smith knows nothing about, which is true to life
and invisible in a JSON field. `relationGraph` resolves the roster into edges
that say plainly which links are mutual (keeping both scores, because
disagreement is the story), which are one-sided, and which name somebody
nobody has written yet.

**Generation is per field**, which is what the plan meant by interactive. A
DM can take the model's sense of what somebody wants and throw away its sense
of who they are. There is deliberately no button that fills the whole form:
that produces an NPC nobody wrote and nobody can argue with. A personality
comes back as adjectives from the axes' own vocabulary rather than as numbers
the model would have to invent, and words it does not know are ignored rather
than guessed at.

**Portraits** get `npcs.portrait_url` and reuse the serial media queue, with
the same upload-path guard the map backdrop uses. That guard moved to
`src/lib/uploads.ts` when the second caller appeared; there is still one
regular expression deciding what a file this app wrote looks like.

**The companion library** is `library_characters.role`, one column rather
than a table, exactly as planned. The reason that works is
`instantiateIntoCampaign`'s level adaptation, and making it work meant moving
that adaptation out of the DB call into `src/lib/characters/adapt.ts`, pure
and unchanged. It had run since the character library existed and no test
could reach it, because it sat inside a database call; `scripts/
test-character-adapt.mjs` is the first thing that has ever checked it, at 19
assertions. A companion out of the library now arrives at whatever level the
table plays at, having given back the ability score improvements it has not
earned there, shed multiclass levels from the right end, and been handed the
spell slots of the level it is actually playing.

**Three things came out different from the plan.**

*Bonds are not in the form.* The plan listed them; `npc-logic.ts` says
plainly that `NpcBond` is superseded by the relationships table, where how an
NPC feels about one character now lives on the approval meter. The column and
its parser survive only so the one-time backfill can read them. Putting a
dead field in a new form would have been building a second source of truth on
purpose.

*There is no statblock link.* The plan wanted one for an NPC who might fight.
Nothing would read it: the bestiary and prepared encounters already handle an
NPC who fights, and a column that only round-trips itself is a liability, the
same reason `content_flags_json` was dropped from the ruleset table in phase
2.

*Phase 3 had a bug, and this phase found it.* The workshop import dropped
`relations_json` along with `bonds_json`, on the stated grounds that both
were keyed by ids the target does not have. Bonds are keyed by character id
and that reasoning holds. Relations are keyed by NAME, so a cast imported
together should arrive with its feuds intact, and a relation naming somebody
left behind simply reads as a link to an NPC nobody has written yet, which
the forge now shows as exactly that. Fixed, and asserted in
`scripts/test-workshop-integration.mjs`, which gained 10 checks here.

*Ships:* NPCs and NPC party members written by hand, reusable across
campaigns.

### Phase 6: bestiary forge and the encounter workbench (BUILT)

**Stats to CR.** `synthesize.ts` went CR to stats and nothing went back, so a
hand-built monster had no honest difficulty number and every calculation
downstream of one was resting on a rating somebody typed.
`src/lib/bestiary/derive-cr.ts` is the inverse, by the DMG's own procedure: a
defensive rating from effective hit points nudged by armour class, an
offensive rating from damage per round nudged by attack bonus, and the two
averaged. It is deliberately the published method rather than a better one,
because a DM who disagrees with the number has to be able to look up why it
says what it says.

Two things in it are subtle enough to be worth naming. *The two halves are
averaged in ROW POSITIONS, not as numbers.* The four ratings below CR 1 are
an eighth apart and everything above is a whole one, so the ladder is not the
number line: a glass cannon that is defensively CR 0 and offensively CR 2
averages to CR 1/2 on the ladder and CR 1 on the number line, which is twice
the XP for the same monster. *Resistances are priced against the rating the
monster ENDS UP at*, which is circular by the DMG's own construction (it tells
you to use the rating you expect), so the whole calculation runs twice: once
to find the band, once to answer.

**It was checked against published monsters**, which is the only thing that
makes a CR calculator trustworthy. Across the SRD it lands within one rating
79% of the time and exactly 40% of the time, and `scripts/test-derive-cr.mjs`
holds a floor under both numbers so a regression cannot pass quietly. The
misses are not random: they are monsters whose damage is not in the attack
list, and 87% of the badly-rated ones say so in `notes`. The rest are
monsters whose extra damage is in a LEGENDARY action, which `EnemyStats` does
not carry and the engine does not run, so the low rating is the right answer
for this table even where it disagrees with the book.

**`extraDamagePerRound`** turns that limitation into a field. The DMG folds
breath weapons and spellcasting in by hand, and so does this: a number beside
the block, shown on the editor with a hint saying what it is for, that the
rating counts and the ENGINE ignores, because the engine runs the attack list.

**The monster editor** writes a `homebrew_entries` row of kind `"monster"`,
storing the block in the `EnemyStats` shape the engine snapshots into
`stat_json` when a fight starts. That is the whole design: no translation
layer, and nothing the editor can write that a fight would ignore. The one
rule with teeth is the damage expression, which is refused rather than
repaired, because an unrollable expression is not a weaker attack, it is an
attack that throws mid-fight. Everything else clamps: a DM who types 5,000
hit points meant a tough monster.

**A hand-built monster reaches the table through the ordinary path.**
`resolveMonster` gained an optional owner and two new lookups at opposite
ends of its chain: the unambiguous `homebrew:<id>` slug wins outright, and a
NAME is the last fallback, so a DM who happens to have built something called
"Goblin" does not thereby change what every existing campaign means by a
goblin. The owner is threaded from the campaign through
`resolveEnemyRequests`, so `start_encounter`, `add_enemies`, the prepared
encounter readout and the assist rail all resolve the same monsters.

**The workbench** (`src/lib/dm/encounter-workbench.ts`) puts the DMG budget
and the shape of the fight on one screen. The budget half is the engine's
own maths, so a fight that reads "hard" here is one `start_encounter` will
also treat as hard. The attrition half is the question the budget cannot
answer and the one a DM actually asks: how long will this take, and is
anybody going to die. Both sides swing real dice expressions through
`forecastAttack`, so misses are counted and `powerfulCritical` and
`criticalDamageMods` move the numbers exactly as far as they will move them
at the table. Every number carries its parts, and the standing assumptions
(nobody heals, nobody runs, everybody concentrates fire) are printed rather
than buried.

**A bug the phase found.** A prepared encounter in a workshop was being
costed against a party of ONE, because the readout fell back to
`[campaign.startingLevel]` when there were no character sheets and a
workshop has none by construction. Every prepared fight in a workshop has
been reading far deadlier than it is. `src/lib/dm/party-budget.ts` is the one
place that answers "which party", and it answers with the target party in a
workshop and with the real roster everywhere else; a campaign whose players
have not rolled up yet still reads exactly as it always did.

**Three things came out different from the plan.**

*Legendary and lair actions are trait lines, not fields.* The plan asked for
them structurally. Nothing in the engine runs a legendary action, so a
structured field would have been a column only its own editor reads, which
is the reasoning that dropped `content_flags_json` in phase 2 and the
statblock link in phase 5. `traits` is one-line rules text the engine already
surfaces to whoever is running the monster, which is where a legendary action
is actually useful.

*Groups needed no new storage.* The plan called for a named roster saved to
`encounter_templates`; phase 2 had already built that, and what was missing
was that the readout beside it was wrong in a workshop. Fixing that was worth
more than a second way to save a roster.

*Monsters are owned by the user, not the workshop.* Every other homebrew kind
already is, and a DM who builds a monster in one workshop should find it in
the next one without exporting anything. It also means monsters need no
import kind: they are already there.

*Ships:* the monster and boss builder, and the dynamic strength calculator.

### Phase 7: the storyboard (BUILT)

The one genuinely new subsystem, and it stayed small.

`workshop_beats` holds typed cards with a title, a body, optional links to an
NPC, a prepared map, a prepared encounter or a place, arrows to other cards,
and a position on the board. `src/lib/workshop/board.ts` is the graph and the
suggestions, `board-compile.ts` is what a board becomes, and both are pure;
30 assertions in `scripts/test-workshop-board.mjs`.

**The arrows are the reason it is a graph and not a list.** A hook with no
payoff is only detectable if the board knows which way the story runs. The
graph drops arrows to cards that no longer exist rather than drawing lines to
nowhere, and deleting a card takes the arrows pointing at it with it, because
a warning that fires every time a DM changes their mind is a warning nobody
reads. The reading order follows the arrows from the beginning of a chain,
and a board that is nothing but a cycle still produces one, because the
answer wanted is the order the cards read in and not a proof that the story
is acyclic.

**The suggestions are arithmetic.** No model call: a faction with no reason
for the party to care, a hook that leads nowhere, a fight nothing leads into,
a secret nothing reveals, an NPC written in the workshop that nothing on the
board uses. `dm/assist-logic.ts` is the precedent. A suggestion a DM can
check is worth more than one they have to trust, and every one here is
something they can disagree with. Their ids are derived from what they are
about rather than from where they landed in the list, so they are stable
across a reload. Places and history are allowed to sit unconnected, because a
board of a place and its history is a legitimate early board and flagging it
would make the panel noise.

**The compile is the test of the node kinds.** Places and history become
lore entries, events and character moments become the arc's beats in the
order the arrows say, hooks become quests, fights become prepared encounters,
and secrets become DM-only notes on the one table that has a visibility
column. Nothing new was built at the campaign end to receive any of it, which
is what the kind list was chosen for: a kind that compiled into nothing would
have been a kind to delete. The integration suite asserts the arithmetic
directly, that every card lands and none is lost.

**Two refusals, both stated before the button.** A campaign that already has
a story arc keeps it: overwriting a spine with beats marked done and detail
accreted from actual play would delete the campaign's memory of itself, so
the board's places, quests, fights and notes still land and its beats do not.
And an arc needs a premise and at least two beats, which is `normalizeStoryArc`
own floor; below that the import says which one is missing and what to add,
rather than writing half a spine the engine would treat as the whole plan.

**Two things came out different from the plan.**

*A fight card compiles to an EMPTY roster.* The board says a fight belongs
here, not what is in it. A roster invented from a card title would be a fight
nobody wrote; the DM fills it in, and the workbench from phase 6 tells them
what it costs.

*The board renders as a list, not a canvas.* Cards keep their x and y so a
canvas can be added later without a migration, but a list is what reads on a
phone, and prep gets done on a phone.

*Ships:* forward-looking prep that lands as real campaign structure.

### Phase 8: the research desk. BUILT.

`/reference` grew from a player's rules lookup into four modes: Browse,
Compare, Calculators and Ask.

- **Browse** gained a **House rules** tab. The table's own rulings are
  searchable beside the SRD, chunked by the engine's own `chunkHouseRules`
  and ranked by its own `scoreRuleByKeywords`, so a ruling a DM finds here is
  in the order the live turn would have surfaced it
  (`src/lib/reference/rulings.ts`). Homebrew was already in the other tabs.
- **Compare** puts up to four spells or monsters side by side and marks the
  rows that DIFFER, with "only what differs" on by default. A browser already
  has tabs; what it cannot do is tell you which of forty numbers moved.
  Monster rows carry the DERIVED rating from phase 6 next to the printed one,
  which is the comparison most likely to change a DM's mind
  (`src/lib/reference/compare.ts`).
- **Calculators**, all five, on one screen and entirely client-side because
  every one is a pure SRD function already: encounter budget, treasure by CR,
  travel time, spell save DC, carrying capacity. Not one line of arithmetic
  lives in the module; each calculator is inputs plus a call into the module
  that owns the rule, and every answer returns PARTS rather than a number
  (`src/lib/reference/calculators.ts`).
- **Ask** is the grounded desk. Retrieval runs first and mechanically over
  the content database, the glossary and the user's rulesets; the model gets
  ONE call with labelled evidence; and then every citation it returns is
  checked back against what was actually supplied. A citation naming a label
  the desk never sent is DROPPED, and an answer with nothing left is marked
  ungrounded and says so in the UI. That check is the difference between
  "with citations" meaning something and being decoration
  (`src/lib/reference/desk-logic.ts`).

*Deviations.*

- The plan said "point `dm/ask.ts` and `dm/lore-check.ts` at the content DB".
  Neither was reused. Both are campaign-scoped end to end (they retrieve over
  a transcript, they queue per campaign, they publish a status chip into a
  campaign's strip), and the desk is not in a campaign. It is a new pair of
  modules following their SHAPE, which is the part that was worth copying:
  one system message, all retrieved text inside the user message between
  delimiters, and the system prompt saying the enclosed text is data.
- The **glossary became a citable source kind**, which the plan did not
  anticipate. The content pack ships every spell and monster and not one
  sentence of rules prose, so without it a general rules question had nothing
  to cite and fell back to the model's memory, which is the exact failure the
  phase existed to avoid.
- `travel.ts` gained the PHB travel-pace speed table. It had the forced-march
  math and no miles-per-hour, and the calculator needed one; it belongs there
  rather than duplicated in the calculator.

*Shipped:* the encyclopedia and the fact-checking desk, with
`scripts/test-reference-desk.mjs` (40 checks).

### Phase 9: sharing. BUILT.

A workshop leaves as one JSON file and comes back as a new workshop.

- **The bundle format** (`src/lib/workshop/bundle.ts`) reuses the world pack
  manifest's licensing fields verbatim rather than inventing a second set, so
  the same `UnofficialPackNotice` rides along with a shared workshop. `name`,
  `blurb` and `inspiredBy` are required; `rightsHolder` is what turns the
  notice from a community-content line into an explicit non-affiliation
  disclaimer.
- **No images travel, ever.** Battle map backdrops and NPC portraits are
  files on disk; the bundle carries map geometry, lights and terrain and
  drops the art with a warning. This is the licensing boundary doing real
  work: the thing most likely to have come from somewhere else is the
  picture, and a format that cannot carry one cannot launder one. The test
  asserts it structurally, so adding a backdrop field later fails a test
  rather than passing quietly.
- **No IDs travel either.** Everything is written fresh, and storyboard
  arrows are stored as INDEXES into the bundle's own array rather than as
  ids, so a board arrives with its arrows intact and nothing points at a row
  on somebody else's machine.
- **Import always CREATES.** It never merges into an existing workshop, which
  deletes the entire collision-naming problem phase 3 had to solve and means
  a hostile bundle has nothing of the importer's to corrupt. A two-step
  preview shows the manifest, the counts and the notice before anything is
  written.
- **The world pack compile** (`src/lib/workshop/to-pack.ts`) exists and is
  honest about being half a pack.

*Deviations.*

- The plan said "a workshop that is only reskins can compile straight to a
  world pack". **That premise is half wrong, and the honest version shipped
  instead.** A world pack IS its reskin tables, and a workshop holds no
  reskins, because a reskin is not a prep artefact: it is a translation table
  for the engine's own vocabulary. Adding an editor for one is a new
  subsystem, which risk 4 says not to do. So the compile produces the OTHER
  half, which a workshop does accumulate and which is the tedious half to type
  by hand (factions, places, hooks, glossary, name seeds, theme, premise),
  leaves the reskin tables empty, and RETURNS THE REFUSALS naming what did not
  travel and why. The test asserts the draft actually passes
  `worldPackSchema.parse`, so it is a file a person finishes rather than one
  they repair.
- Hand-built monsters cannot become pack monsters: a pack's monster list
  overlays a name onto an existing SRD stat block BY SLUG, and a monster built
  from scratch has no slug. Refused with that sentence rather than dropped.

*Shipped:* export, import and the pack draft, with
`scripts/test-workshop-bundle.mjs` (31 checks) and ten more in
`scripts/test-workshop-integration.mjs`, which round-trips a real workshop
through a real serialize and parse.

## 7. Sequencing and honest effort

| Phase | Scope | Rough size |
| --- | --- | --- |
| 1 shell | wiring plus guards | small |
| 2 rulesets | one table, one validator, one picker | small |
| 3 import | the planner, the route, the dialog step | medium |
| 4 maps | backdrop layer, prepared maps, brushes, stamps, UVTT | **large** |
| 5 NPCs | one form, one graph editor, one column | medium |
| 6 bestiary | derive-cr, editor, workbench | medium to large, as estimated |
| 7 storyboard | the only new subsystem | medium, and it stayed small |
| 8 research desk | mostly assembly, as estimated; the grounding was the work | small to medium |
| 9 sharing | manifest plus lifecycle, both precedented; smaller than feared | medium |

Phases 1 to 3 are the spine. Everything after is independent and can be
reordered by what the table actually wants next.

**Where this most likely goes wrong**, in order:

0. **The prep tools kept finding bugs in the engine underneath them, and that
   is the argument for building them.** Phase 5 found that the workshop import
   dropped NPC relations, which are keyed by name and should have travelled.
   Phase 6 found that a prepared encounter in a workshop was budgeted against
   a party of ONE, so every prepared fight there read far deadlier than it is.
   Neither was visible until something made a person look at the number.
1. **Phase 4 was underestimated, and the fix was to not do the risky
   part.** The plan wanted `battle_maps.encounter_id` made nullable so maps
   could outlive encounters, which touches tokens, fog, movement and the
   studio. A separate `prepared_maps` table holding only the ground delivers
   the same feature and touches none of them. The general lesson: when the
   expensive step exists to give something a home, check whether it needs a
   home of its own first.
2. **The workshop leaks into the game loop.** A workshop that wakes an AI turn
   or shows up in a campaign list is the Option B failure mode. This is why
   `scripts/test-workshop-isolation.mjs` comes before the first panel.
3. **Feature sprawl on the storyboard. This held.** The constraint was that a
   node type is only allowed if it already has a campaign-side row to become,
   and the seven kinds the plan named all did: nothing new was built at the
   campaign end to receive the board. `compileBoard` returns `emptyKinds` for
   the same reason, counted from the CARDS rather than from the output, so a
   kind that stops earning its place is visible rather than inferred.
4. **Scope creep toward a VTT.** ODM's identity is a server-authoritative rules
   engine with structured story memory. A workshop that grows a lighting
   compositor and an asset marketplace is a different product. Import formats,
   not editors, wherever the choice exists.

---

## 8. Conventions this plan commits to

Inherited from `docs/human-dm-plan.md` and worth restating because they are
what keeps the codebase testable:

- Pure logic modules with no `@/` imports and no DB access, so the
  `scripts/test-*.mjs` suites can load them directly. The DB rim is a separate
  file. `overworld/logic.ts` and `battlemap/paint.ts` are the models.
- Schema changes are additive, through the `addColumns` helper, because SQLite
  cannot alter CHECK constraints in place.
- Files under 500 lines. `db/campaigns.ts` is already at 751, so it is the
  one to watch. Phase 4 kept `db/battle-maps.ts` and `dm/map-studio.ts` under
  the line by putting the library in its own pair of files
  (`db/prepared-maps.ts`, `dm/map-library.ts`) rather than growing them.
- Every phase ships a test script wired into `scripts/test-all.mjs`.
- Anything borrowed substantially from an MIT project gets an entry in
  `docs/LICENSES.md`.
- `docs/ROADMAP.md` gets updated as phases land. Its "Next" section currently
  lists combat and encounter work that human-DM phases 1 to 8 already
  delivered, and that drift should not repeat here.
