# Workshop parity audit against Foundry VTT

Dated 2026-09-05. Companion to `docs/workshop-plan.md`, whose nine phases are
all built. This document asks a different question: taking Foundry VTT's
prep toolset as the bar, what can a DM make there that they cannot make
here, and what is the honest reason in each case.

Foundry's side comes from its knowledge base articles (Scenes, Walls,
Lighting, Tiles, Drawings, Map Notes, Ambient Sounds, Scene Regions, Tokens,
Actors, Items, Journal Entries, Rollable Tables, Playlists, Active Effects,
Compendium Packs, Adventure Documents, Cards, Macros), fetched today, plus
the dnd5e system's item and actor types. ODM's side comes from reading the
workshop pages, the DM console panels they reuse, the engine modules under
`src/lib/battlemap`, `src/lib/overworld`, `src/lib/bestiary`,
`src/lib/npcs`, `src/lib/workshop`, and the schema in `src/lib/db/core.ts`.

---

## 0. How to read the verdicts

Foundry is a rendering engine with a document store; the rules live in a
system package on top. ODM is a server-authoritative rules engine with a DM,
human or model, on top. So "parity" here means: **every prep job a Foundry
GM does has a place in the workshop, and the thing produced is one the ODM
engine actually runs.** It does not mean a WebGL canvas with nineteen light
animations. Where a Foundry feature is display only, the audit asks what job
it does at the table and whether ODM does that job.

Three verdicts:

- **Have.** The job is done, and the result is engine-backed.
- **Partial.** The storage or the engine exists and the editor does not, or
  the editor exists and is shallower than the job needs. These are the
  cheap wins, because the hard half is already built.
- **Missing.** Nothing to build on. Each one says whether it should be
  built or is a deliberate non-goal, and why.

---

## 1. Scorecard

| Foundry document or tool | ODM today | Verdict |
| --- | --- | --- |
| Scene (battle map) | `prepared_maps`: generate, blank, UVTT import, capture; theme, ambient light, notes, backdrop art | Have |
| Grid config (square, hex, gridless, size, colour) | Square 5 ft only, fixed | Missing, deliberate for hex; see 2.1 |
| Walls layer (7 wall types, 3 door states, direction) | Wall tile, door tile. No locked, secret, one-way, window | Partial |
| Wall drawing helpers (chain, snap, select, clone, close all) | Single-tile brush, drag to paint | Partial |
| Lighting layer (place, radius, colour, animation, darkness) | `lights_json` stored and generated, **no editor** | Partial |
| Tiles (art assets on the map, roofs, occlusion) | One backdrop image per map, no placed assets | Partial |
| Drawings and text labels | None | Missing, build |
| Map notes (journal pins on a scene) | None on battle maps; pins with labels on the region map | Partial |
| Ambient sounds (positioned emitters) | None | Missing, build the simple form |
| Scene regions (areas with behaviours: teleport, cost, darkness) | Difficult and water tiles carry cost; nothing else | Missing, build the two that matter |
| Measured templates | sphere, cone, line, cube on the live board | Have |
| Fog and vision | Explored fog, LOS engine, bright/dim/dark, carried light | Have |
| Token config (size, vision, light, bars, disposition) | pc, enemy, npc, prop tokens; hidden flag; light | Partial; see 2.1 |
| Prototype tokens on a scene before play | Deliberately none on prepared maps | Missing, deliberate, but see 2.1 for the halfway |
| Scene padding, initial view, background colour | None | Missing, deliberate |
| Scene-linked playlist and journal | None | Partial; see 2.8 |
| Actor: PC | Character builder and library, outside the workshop | Have, but unlinked; see 2.3 |
| Actor: NPC | NPC forge: agency model, axes, goals, relations, portrait | Have |
| Actor: monster | Bestiary editor writing `EnemyStats`, derived CR | Partial; the block is shallower than a stat block |
| Actor: group (party) | Target party bar | Have, prep-scoped |
| Actor: vehicle | None | Missing, deliberate |
| Items: weapon, armour, gear, consumable, tool, loot, container | `homebrew_entries` kind `item`, **no editor anywhere** | Partial, and the largest single gap |
| Items: spell, feat, class, subclass, background, species | `homebrew_entries` kinds exist, **no editor anywhere** | Partial, same gap |
| Active effects on items and actors | `active_effects` table in the engine; homebrew carries none | Partial |
| Journal entries (pages, rich text, secrets, images, links) | Lore entries: category, title, plain text, tags, pinned | Partial |
| Journal handouts to players | None; lore is DM canon only | Missing, build |
| Rollable tables (ranges, weights, nested, documents, replacement) | Text rows with ranges; die derived | Partial |
| Playlists | Ambience catalog and a DM `set_ambience` call; no authored playlists | Partial |
| Macros | None | Missing, deliberate |
| Cards | None | Missing, deliberate; a table drawn without replacement is a deck |
| Combat encounter prep | Encounter templates, roster, map link, workbench | Have; placement and hidden enemies missing |
| Compendium browser | `/reference` browse, compare, calculators, ask | Have |
| Compendium packs (user-made collections) | Bundles, world packs, rulesets | Partial |
| Adventure documents (selective import, overwrite tracking) | Bundle import always creates; campaign import is selective by kind | Partial |
| Folders | None; tags on maps and lore | Partial |
| Undo on the canvas | None anywhere | Missing, build |
| Keybinds | None in the workshop | Missing, build the few that matter |
| Calendar and world time | `dm/calendar.ts` engine; no workshop editor | Partial |

---

## 2. Findings by system

### 2.1 Battle maps

**What is solid.** The prepared-map library is a real scene editor for a
tile engine: generate from a hint, start blank, import UVTT with an
edge-based wall conversion that keeps corridors at width, paint five
terrain brushes, stamp six shapes with a live footprint, put art under the
grid with register controls, and deploy onto a table weeks later. Every
stroke is validated server-side. That is the right architecture and nothing
below asks to change it.

**Partial: brush radius.** `paintTerrain` accepts a radius up to 3 and the
overworld panel exposes exactly that slider. `MapEditor` never sends one.
One stroke, one tile, every time. This is the cheapest fix in the audit.

**Partial: lighting.** `prepared_maps.lights_json` exists, the generator
fills it, UVTT import carries lights across, `MapLight` has bright and dim
radii, and the play view renders them. There is no way to place, move or
remove a light by hand. A light brush (click to place, click again to
remove, a radius pair) is a second entry in the existing palette and the
PATCH route grows one field. Foundry's colour, angle and animation are
display; the job is "this room has a brazier," and that is what the engine
already models.

**Partial: walls and doors.** ODM has one wall and one door. Foundry has
locked doors, secret doors, one-way walls, terrain walls that block movement
but not sight, and windows. Of these, three are jobs the engine can run
today and one is a real gap:

- *Locked door* and *secret door* are door states, not new tiles. A
  `door_states_json` on the map keyed by tile (`locked`, `secret`) and an
  `open_door` tool for the DM. A locked door blocks movement until opened;
  a secret door renders as wall in the players' projection until found.
  The alphabet stays at five characters, which is what
  `docs/workshop-plan.md` phase 4 said mattered.
- *Terrain wall* (blocks movement, not sight): a low wall, a fence, a
  chasm. Today a DM has to choose between water (crossable) and wall
  (opaque). This one genuinely needs a sixth character, because it is a
  fourth combination of `blocksMove` and `blocksSight`. Add it as a tile,
  accept that pathfinding, LOS, fog, the stamp compiler, the UVTT importer,
  the DM prompt and the renderer all learn it, and do it once.
- *One-way walls* and *windows*: non-goals. The engine's LOS is tile-based
  and symmetric, and nothing at a 5e table is lost without them.

**Partial: wall drawing.** Foundry draws a wall as a line with chaining and
snapping. ODM paints a tile. The tile model is right for this engine, but
the editor lacks the three tools that make painting fast: **a line tool**
(click two corners, fill the tiles between), **a rectangle tool** (outline
or filled) and **a flood fill**. All three compile to strokes the same way
`stampStrokes` does, so they inherit the whole rulebook for free. Add
**eyedropper** (pick the brush under the cursor) while there.

**Missing: undo.** A brush tool without undo is a brush tool people are
afraid of. The server already returns the whole terrain after each patch, so
the client can keep a ring of the last N terrains and PATCH the previous one
back with a `replaceTerrain` field. Twenty levels, client-side, cleared when
the map changes. This is one field on the route and one hook.

**Missing: drawings and text labels.** A DM labels rooms ("1. Entry hall")
and draws an arrow to the secret door. Foundry has a drawings layer. ODM
has nothing, on either map. Proposal: a `labels_json` on `prepared_maps`
and `battle_maps` of `{x, y, text, dmOnly}`. No freehand, no polygons: a
label at a tile does the labelling job and is readable on a phone. The
players' projection drops `dmOnly` labels.

**Missing: map notes.** Foundry pins a journal entry to a scene. ODM's
region map already does this for places (anchors) and pins (labels). The
battle map does not. The label proposal above, with an optional
`loreId` or `npcId`, covers it: a pin that opens the entry.

**Partial: tiles and roofs.** One backdrop image per map. Foundry stacks
any number of art tiles, and its overhead tiles with occlusion do a real
job: the roof hides the room until a token walks in. ODM already does that
job differently and better for its engine, because fog is per-tile and the
art is drawn under the fog, so an unexplored room's picture is simply not
shown. Multi-tile art stacking is a non-goal (see risk 4 in the plan:
"import formats, not editors"). What is worth adding is a **second image
slot for the DM-only overlay** (the annotated version of the same map),
which is the one tile a GM places on almost every scene.

**Partial: tokens on a prepared map.** The plan refused tokens on prep maps
to keep a second lifecycle out of the combat code. That reasoning holds for
`pc` and `enemy`. It does not hold for `npc` and `prop`, which carry no stat
block and exist only as furniture; the barrel, the altar, the shopkeeper in
the doorway. A `props_json` on the prepared map, copied into `battle_tokens`
rows of kind `npc` or `prop` at deploy time, gives the DM a furnished room
without touching the enemy lifecycle. Encounter placement (see 2.7) is the
other half.

**Missing: scene regions.** Foundry regions attach behaviours to an area.
Two of the nine behaviours are things this engine already has a home for:
*modify movement cost* (that is what difficult terrain is; done) and
*adjust darkness* (a lit room in a dark dungeon). The second needs a
`zones_json` of rectangles with an `ambient` override, read by the light
model. Teleport, scripts and scrolling text are non-goals.

**Missing, deliberate: hex and gridless.** The pathfinder, LOS, cover,
templates and fog are square-grid. A hex grid is a rewrite of all five.
5e's own default is squares. Not for the workshop.

**Missing, deliberate: scene padding, initial view, background colour,
video backdrops.** Display only, and the play view is a scrolling canvas
that sizes itself.

**Missing: sound emitters.** See 2.8.

### 2.2 Region (world map)

**What is solid.** A seeded 96x72 terrain generator with dials and an AI
plan, a six-brush painter with a radius slider, places as anchors with
layout descriptions and connections, pins with labels, a party marker, pan
and pinch zoom. It is a more capable overworld than Foundry has natively,
which has none: Foundry treats a world map as just another scene with a
picture on it.

**Gaps against the job**, since Foundry is not the bar here:

- *Fixed size.* 96x72, always. A one-valley campaign and a continent are
  the same grid. Width and height on the row already exist with defaults;
  the generator takes them; the PATCH refuses to change them. Allow resize
  with anchors re-validated.
- *No roads, rivers or borders.* Six terrain classes and nothing linear.
  Rivers and roads are what make a region map readable, and travel time
  (`travel.ts`) would read them. A `paths_json` of typed polylines
  (`road`, `river`, `border`) drawn tile to tile, rendered on top of the
  terrain, is the smallest version that is useful.
- *No region labels.* "The Weald", "Duchy of Marr" written across an area.
  Same `labels_json` shape as the battle map.
- *No image import.* Foundry's world map is a picture. A DM with a
  hand-drawn or Inkarnate map cannot use it here. The battle map's backdrop
  layer already solved this exact problem; give the overworld the same
  `backdrop_path` and transform, drawn under the tiles.
- *Azgaar import.* The plan named it and it was never built. Its `.map`
  export is a documented text format with heightmap, biomes, rivers, roads,
  burgs and states. Given `paths_json` above, a converter that reads
  biomes into the six tiles and burgs into anchors is a pure module in the
  house style.
- *Export.* No way to get the picture out for a player handout. A PNG
  render of the terrain plus labels, from the same draw code the panel
  uses.

### 2.3 Actors: cast, bestiary, companions, PCs

**Cast (NPC forge): Have.** The agency model is deeper than Foundry's NPC
sheet, which is a stat block with a biography box. Per-field AI suggestion
with no whole-form button is the right call. Two small gaps: no *faction*
field (factions are lore entries; an NPC should be able to point at one),
and no *voice* note (how they talk; a one-line field the DM prompt already
has a use for).

**Bestiary: Partial, and this is where "cuts corners" shows.** The editor
writes `EnemyStats`, which is what the engine runs, and that is the right
storage. But a 5e stat block a DM expects to write has fields the shape
does not carry:

| Stat block field | ODM | Note |
| --- | --- | --- |
| Ability scores (STR to CHA) | Missing | Only save mods and dex mod. Skills, grapple, shove and the DM prompt all want the scores |
| Skills | Missing | Perception and Stealth decide surprise and passive checks |
| Senses (darkvision, blindsight, passive Perception) | Missing | The light model runs darkness and cannot ask a monster whether it sees in it |
| Languages | Missing | Prompt flavour, but a stat block without it looks unfinished |
| Alignment | Missing | Prompt flavour |
| Actions vs bonus actions vs reactions vs legendary vs lair | One `traits` text list | The plan chose text on purpose because the engine runs only the attack list; keep text, but **tag each line** so the block prints in sections |
| Spellcasting | Missing | Folded into `extraDamagePerRound` for the rating. A spell list by name would let the engine's own spell lookup print the blocks |
| Portrait and token art | Missing | NPCs have portraits and the upload guard; monsters do not. Type placeholders exist |
| Environment and tags | Missing | Random encounter tables by terrain want this |
| Copy from SRD | Have | The finder starts a draft from a catalog block |
| Derived CR | Have | Better than Foundry, which has none |

Senses and skills change what the engine does. The rest change what the
block looks like, and a block that looks unfinished is one a DM will not
trust. Add them as optional fields on `EnemyStats` (old snapshots lack
them, the same pattern `attacksPerTurn` and `size` already follow).

**Companions: Have.** Library role column, level adaptation.

**PCs: Have, but unlinked.** The character builder and library exist and
`targetParty.characters` can name library characters, yet nothing in the
workshop opens the builder or shows the named sheets. A Party card on the
hub that lists the target party's characters and links into the builder
closes the loop. Also **pregens**: a DM preparing a one-shot builds four
sheets and hands them out. The library already holds sheets; what is
missing is marking a sheet as a pregen that travels in the bundle and lands
as a claimable sheet on import.

### 2.4 Items and the missing homebrew editors

**This is the largest gap in the audit.** Foundry's Items directory is half
of what a GM creates: weapons, armour, magic items, consumables, spells,
feats, subclasses, backgrounds, species. ODM has the storage
(`homebrew_entries`, seven kinds, a permissive schema, a route at
`/api/homebrew`) and the consumers (the character builder's pickers read
homebrew beside SRD, the reference desk cites it, rulesets ship it by id).
**There is no user interface that creates a homebrew entry.** No page, no
panel, no form posts to that route. Phase 2 of the plan said "homebrew gets
a library view" and it did not happen.

Build a **Homebrew** system in the workshop (an eleventh card) with one
editor per kind, each of which is a catalog-backed form (pick a base item,
then edit; the same "pick, do not type" rule the workshop already follows):

- *Item*: kind (weapon, armour, gear, consumable, magic item), cost,
  weight, rarity, attunement, damage and properties for weapons, AC and
  strength requirement for armour, charges for magic items, description.
  The sheet's equipment and the encumbrance rule read these.
- *Spell*: level, school, casting time, range, components, duration,
  concentration, ritual, classes, description, and the structured
  damage/save the engine's spell resolver reads.
- *Feat*, *background*, *species*: the fields the builder's pickers show.
- *Subclass* (`archetype`): class, level features.
- *Monster* is already the bestiary and stays there.

Two constraints from `docs/worlds.md` that the editor must honour: sheets
store spells, items and features **by name**, so a homebrew entry never
renames a canonical one; and homebrew is user-scoped, so it needs no import
kind, but a **bundle should carry the homebrew a workshop's ruleset
references**, which is the ROADMAP item about monsters travelling, widened.

**Active effects.** Foundry attaches effects to items and the effect
applies when equipped. ODM has `active_effects` in the engine for
conditions. A homebrew item that grants +1 AC or resistance should be able
to say so structurally, or the item is text the engine cannot read. Give
the item editor a small effects list (target attribute, mode, value),
matching what the engine's effect tools already apply.

### 2.5 Journals: lore, places, notes

**Lore: Partial.** Category, title, body, tags, pinned, search, duplicate.
The body is a plain textarea. Foundry's journal is the GM's binder, and the
gaps are the binder's:

- *Rich text.* Headings, bold, lists, tables. Markdown in the body with a
  preview is enough; nothing in the DM prompt cares, and the chunker
  already splits house rules on headings.
- *Images.* A lore entry cannot hold a picture. Add `image_path` with the
  upload guard, the same as NPC portraits.
- *Secrets in text.* Foundry's secret blocks are text the players never
  see inside an entry they can see. ODM's lore is all DM canon, so today
  there is no "players can see this" at all, and therefore no handouts.
- *Handouts.* A DM preparing a session writes the letter the party finds
  and the notice on the tavern wall. There is nowhere to put that. Add a
  `visibility` column (`dm`, `party`) on lore entries. On import it lands
  the same way, and `campaign_notes` already has the visibility precedent.
  A player-visible entry with a picture is a handout.
- *Links between documents.* Foundry's `@UUID` links turn a name into a
  click. ODM lore mentions "Marla" and nothing connects it to the NPC.
  Resolve `[[Name]]` in the body against the workshop's NPCs, places, maps
  and other entries at render time, no storage change.
- *Pages.* Foundry entries have pages. Lore entries are flat. Not needed
  if entries can link to each other.

**Places: Partial.** Authored on the region map only (name, layout
description, connections). A place should also carry the prepared map it
uses and the ambience it plays, so that walking into it in play opens the
right board with the right sound. Two optional ids on `locations`.

**Notes: Have** in the campaign (`campaign_notes`, with visibility); the
workshop has no notes tab because the storyboard's secret cards compile
into them. Fine.

### 2.6 Roll tables

**Partial.** Text rows with ranges, parsed from pasted book text, a derived
die, gap detection, an AI drafter. Foundry's tables add four things worth
having:

- *Weights.* "This entry is three times as likely" without the DM doing
  the range arithmetic. A weight column that normalizes into ranges is a
  pure function on `roll-table-logic.ts`.
- *Nested tables.* A treasure table whose row says "roll on Gems". Rows
  whose text is `@table:Name` resolve at roll time. The engine's
  `roll_table` tool then cascades.
- *Draw without replacement.* Rumours a party has heard should not repeat.
  A `drawn_json` on the row, a reset button. This is also what makes a
  table a **card deck**, which is why Cards is a non-goal.
- *Document results.* A row that IS a monster, an item or an NPC rather
  than text about one. Rows carry an optional `ref: {kind, id}`; the
  random-encounter case is "roll on Forest, get 1d4 wolves, deploy".

### 2.7 Encounters and combat

**Have** the roster, the battlefield hint, the map link, the notes, and a
workbench that is more honest than Foundry's CR sum (attrition, rounds to
drop, who dies). **Missing** on the template:

- *Placement.* Where each enemy starts on the linked map, and where the
  party enters. `encounter_templates.map_json` already holds the map
  settings; add `placements_json`. Deploy reads it instead of the spawner
  when the linked map matches. This, with props from 2.1, is the halfway
  that makes a prepared map a prepared scene without tokens living on it.
- *Hidden at start.* An ambusher. `battle_tokens.hidden` exists; the
  template cannot set it.
- *Overrides.* This goblin has 3 hp and is named Snik. Per-line name and hp
  override, which `add_enemies` already accepts.
- *Rewards.* XP is derived. Treasure is not attached. A `rewards_json`
  (items by name, coin, or a table to roll) that the DM is reminded of when
  the fight ends.
- *Phases.* "When the shaman drops, the wolves flee." One text field per
  template today (notes); a list of trigger lines the DM sees in the
  encounter readout is the cheap version.

### 2.8 Playlists, sounds, ambience

**Partial.** ODM has an ambience catalog, a DM tool that sets it, and
auto-selection on scene change. Foundry has authored playlists, scene-linked
autoplay, and positioned ambient sounds. What a DM preparing a session
actually does is decide "the crypt sounds like this." Give **prepared maps
and places an `ambience` field** that names a catalog track or a mood, and
have deploy or arrival call `set_ambience` with it. Authored playlists (an
ordered list of tracks with a mode) are a small table and a small editor
and should follow only if people ask. Positioned emitters are a non-goal:
the play view is not a 3D audio scene.

### 2.9 Rules, active effects, macros

**Rulesets: Have.** Variant flags, house-rules prose with per-chunk enable
and pin, homebrew ids. The `validate.ts` the plan promised (checking a draft
monster, item or map against the ruleset) is still deferred and the
ROADMAP already lists it. It becomes necessary the moment the item editor
exists, because "this item is not legal at this table" is the question the
ruleset was built to answer.

**Macros: non-goal.** Foundry macros are scripts. ODM's equivalents are the
DM's tool calls and roll tables. Nothing to build.

### 2.10 Compendia, adventures, sharing

**Have** bundles with images, world pack drafts, rulesets, selective import
into campaigns by kind, and copy from another campaign. Gaps:

- *Import into a workshop is all or nothing and always creates.* Foundry's
  adventure import is selective and can update in place. Selective import
  is `ContentImportPicker` pointed at a bundle instead of a source; the
  planner already exists. Update in place stays a non-goal (the plan's
  collision argument holds).
- *Homebrew does not travel.* Already on the ROADMAP for monsters; widen
  to every kind the ruleset references.
- *Pregens do not travel.* See 2.3.
- *No folders.* Tags exist on maps (API only; the editor has no field for
  them) and lore. Put a tag field on every editor and a tag filter on every
  row list. Folders are a non-goal; tags do the job and survive import.

### 2.11 Editor hygiene, cross-cutting

Foundry gets these from being a desktop-shaped app. The workshop lacks all
of them and each is small:

- **Undo** on both painters (see 2.1).
- **Keyboard**: brush hotkeys (1 to 5), Escape drops the tool, Ctrl+Z.
  With on-screen equivalents, because the phone has no keys.
- **Bulk**: multi-select and delete or tag on every row list.
- **Duplicate** exists on maps, lore, NPCs, workshops. Missing on tables,
  encounters and beats.
- **Dirty state**: the client audit already notes the rules editor has no
  unsaved marker; the same is true of every blur-to-save field in the map
  editor.
- **Native dialogs**: `window.prompt` is used for pin labels and place
  renames on the region map. Electron does not implement `prompt`; the call
  throws in the desktop shell. Replace with the app's own dialog.

---

## 3. What "carries over to the client apps" means

The desktop and Android shells render the server's own web pages in a
WebContentsView or a WebView (`docs/redesign-coverage-audit.md` in the
client repo already tracks the workshop screens). So every workshop
improvement reaches the clients automatically,
and the client work is entirely about what a web page needs to be usable
inside a shell on a touch screen. Four concrete items:

1. **`TerrainCanvas` has no `touch-none`.** On Android a brush drag scrolls
   the page instead of painting. `OverworldPanel` sets it; the battle map
   canvas does not. One class.
2. **No pan or zoom on the battle map canvas.** A 40x30 map on a phone is
   unusable at fit-to-width. The overworld already has drag-pan, wheel-zoom
   and two-finger pinch; the battle map needs the same, with a zoom that
   the tile-at-pointer maths accounts for.
3. **`window.prompt`** as above.
4. **File inputs and uploads** work in both shells (portraits and backdrops
   already go through `<input type=file>` and `/api/upload`), so the new
   image slots inherit that. Drag-and-drop does not exist on Android and
   must never be the only way to do anything; the workshop has none today,
   and the storyboard's "no canvas" choice should hold for the same reason.

The client repo's coverage audit lists which workshop screens the redesign
has drawn. Every new field or tool in the plan below is a line in that
document, so the two audits stay in step.

---

## 4. Plan

Continues the numbering in `docs/workshop-plan.md`. Ordered by the ratio of
what the engine already has to what the editor lacks, so the early phases
are mostly wiring.

### Phase 10: the painter finishes (small)

Brush radius in the map editor; line, rectangle and fill tools compiled to
strokes; eyedropper; undo ring with `replaceTerrain`; a light brush over
`lights_json`; tags field; `touch-none`, pan and pinch on `TerrainCanvas`;
brush hotkeys with on-screen equivalents; replace `window.prompt`. Tests:
`test-map-paint.mjs` grows the tool compilers, `test-map-backdrop.mjs` is
untouched.

### Phase 11: homebrew editors (large, and the one that matters most)

The Homebrew system card. Item, spell, feat, background, species and
subclass editors over `homebrew_entries`, each catalog-backed. The
structured damage, AC and effects fields that make an item something the
engine reads. Homebrew travelling in bundles. `src/lib/rulesets/validate.ts`
finally built, because the item editor is its first real caller.

### Phase 12: the stat block (medium)

Ability scores, skills, senses, languages, alignment, tagged action
sections, a spell list by name, portrait, environment tags on
`EnemyStats` and the monster editor. Senses feed the light model; skills
feed passive checks. `test-derive-cr.mjs` unchanged; the rating does not
move.

### Phase 13: the scene, not just the map (medium)

Door states (locked, secret) with a DM tool; the sixth tile for low walls;
labels and pins on both maps; props on prepared maps; placements, hidden,
overrides and rewards on encounter templates; light zones; ambience on maps
and places; a DM-only overlay image. Deploy reads all of it.

### Phase 14: the binder (medium)

Markdown lore with preview, images, `[[links]]`, party-visible entries as
handouts, faction and voice on NPCs, place-to-map and place-to-ambience
links, weights, nesting, draw-without-replacement and document rows on
tables, duplicate everywhere, tag filters everywhere.

### Phase 15: the world (medium)

Resizable overworld, roads, rivers and borders, region labels, backdrop
image, Azgaar import, PNG export, pregens in the library and the bundle,
the Party card on the hub, selective bundle import.

---

## 5. Deliberate non-goals, restated so nobody re-litigates them

Hex and gridless grids. Multi-tile art stacking and occlusion. One-way
walls and windows. Light animations and colours. Positioned sound emitters.
Scene regions beyond darkness and cost. Macros and scripts. Card decks as
their own thing. Vehicles. Folders. In-place bundle updates. A canvas
storyboard. Each is either display-only, a rewrite of the five engine
modules that make the map server-authoritative, or a second way to do a job
the engine already does. Section 7 risk 4 of the workshop plan still
applies: this is a rules engine with prep tools, not a VTT with a rules
module.

---

## 6. What shipped (2026-09-05)

All six phases landed in the server app. The client apps are shells around
the same web UI, so every tool below is on phones, foldables and desktop
with tap, drag and pinch, and the client repo's
`docs/redesign-coverage-audit.md` lists them against its screens.

### Phase 10, the painter

Line, rectangle, ellipse and fill shape tools with a preview while
dragging; undo and redo (thirty steps) compiled to strokes the engine
validates like fresh paint; hotkeys on desktop; zoom, pan and pinch on
every map surface; brush radius; light sources (up to 24, radius 1 to 8,
named presets) on prepared maps and the live board, drawn by the vision
engine. The paint routes read one `PaintRequest`.

### Phase 11, homebrew editors

A Homebrew system on the hub with editors for items (weapons, armour and
magic items with typed effects), spells, feats, backgrounds, species and
subclasses, every one started from a catalog pick and checked by the
ruleset validator (errors, warnings, notes) as it is typed. A homebrew
weapon or armour is snapshotted onto the equipment line, so the attack
roll, the AC engine and the PDF read it without a database lookup, and it
is hydrated back from the shelf when a sheet is read. Bundles carry
homebrew; the importer's own entry of the same kind and name wins.

### Phase 12, the stat block

Abilities, skills, senses, languages, alignment, spells and environment
on the monster block, a sectioned trait editor (traits, actions, bonus,
reactions, legendary), passive perception in the printed, skill, wisdom
order, and the turn prompt printing all of it.

### Phase 13, the scene

Labels, props, doors (open, closed, locked, secret, resolved into
effective terrain by the rim so no combat code learned door states), light
zones and ambience on prepared maps and the board, a DM-only overlay
image, and encounter template extras (placements, hidden enemies, stat
overrides, rewards, a private note) that deploy applies.

### Phase 14, the binder

Lore entries with a visibility (the table reads it, or only the DM), a
picture that makes a handout, safe markdown with headings, lists and
`[[links]]` to other entries, NPCs, places and monsters. Tables with `x3`
weights, `@table:`, `@monster:`, `@item:` and `@npc:` rows, nesting to
four deep with loop protection, and draw without replacement with a reset.

### Phase 15, the world

Region maps from 24 by 18 to 192 by 144 with named presets, rerolled at
the new size with places, pins, lines and labels carried where they fit.
Roads, rivers and borders drawn point by point and finished on purpose,
place and region labels, an eraser, a picture in place of the tiles, an
Azgaar Fantasy Map Generator import (cells, burgs, rivers, routes as
GeoJSON, rasterized by nearest centroid at a chosen size), and Save as
PNG. Pregens: library characters filed under a workshop, listed on a
Party system and card, carried in the bundle as sheets the builder's own
schema checks on both sides. Selective bundle import: every kind is a tick
in the preview, and house rules are one of them.

### Left out, and why

- NPC faction and voice, place-to-map and place-to-ambience links: the NPC
  forge and locations modules were being edited by other work while this
  pass ran, so these wait for that to land.
- Monster portraits: behind the thumbnails work in flight for the same
  reason.
- Duplicate on storyboard beats and tag filters on every list: not done.
- Azgaar state borders: the cells export carries state ids but no
  boundaries, so borders are drawn by hand after an import.
- The DM prompt does not yet read the region's lines and labels;
  `describeFeatures` in `src/lib/overworld/features.ts` is written for it.
- Pregens travel without portraits.

### Tests added

`test-map-tools`, `test-map-lights`, `test-homebrew-gear`,
`test-ruleset-validate`, `test-block-sections`, `test-map-scene`,
`test-encounter-extras`, `test-lore-links`, `test-roll-table-extras`,
`test-overworld-features`, `test-azgaar-import`, with the bundle and
integration suites extended for homebrew, pregens, kind picking and the
region map's persistence.
