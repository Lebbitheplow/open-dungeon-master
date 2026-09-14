# Feature gap report: Open Dungeon Master against the VTT and world-building field

Dated 2026-09-13, against ODM 0.18.0. Companion to
`docs/workshop-parity-audit.md` (2026-09-05), which compared the workshop to
Foundry's prep tools only. This document widens the bar in two directions:
every product a table might otherwise use (Foundry VTT and its essential
modules, Roll20 Jumpgate, Fantasy Grounds Unity, Owlbear Rodeo 2.0, TaleSpire,
Alchemy RPG, Shard, AboveVTT, D&D Beyond Maps, Let's Role, Menyr, Quest Portal,
Arkenforge, EncounterPlus, MapTool, Tabletop Simulator), every world-building
and prep tool (World Anvil, Kanka, LegendKeeper, Campfire, Obsidian TTRPG
plugins, Chronica, Scabard, Realm Works, Inkarnate, Dungeondraft, Dungeon
Alchemist, Azgaar, Watabou, donjon, Chartopia, D&D Beyond homebrew, Kobold
Fight Club, Improved Initiative, Homebrewery, Syrinscape, Tabletop Audio,
Avrae), and the AI game masters ODM actually competes with (Friends & Fables,
RoleForge, Voyage, DungeonsDeep, AI Realm, AI Dungeon, Hidden Door, SagaBound,
Quest Portal's assistant, the Foundry AI modules). It covers table play,
animation and presentation, mechanics, and the workshop, not the workshop
alone.

The competitor side comes from vendor documentation, release notes and 2026
reviews fetched on the date above (sources at the end). ODM's side comes from
reading the source: `src/app/campaigns/[campaignId]/*`, `src/lib/battlemap`,
`src/lib/dm`, `src/lib/srd`, `src/lib/workshop`, `src/lib/voice`,
`src/lib/ambience`, `src/lib/dice`, and the three plan documents. Where a
claim below says a thing does not exist, it was searched for and not found.

---

## 0. How to read the verdicts

ODM is a server-authoritative rules engine with a narrator on top, human or
model. Most of the field is a rendering canvas with a document store and a
rules module. So the question for every feature is not "does ODM draw this"
but "does ODM do the job this feature does at the table, with the engine
behind it." A Foundry feature that is purely presentation is judged by what it
buys a player.

Four verdicts:

- **Have.** The job is done and engine-backed.
- **Partial.** Storage or engine exists without the editor or the surface, or
  the surface is shallower than the job.
- **Missing, build.** Nothing to build on, and it is worth building.
- **Missing, non-goal.** Deliberately out, with the reason. The parity audit's
  section 5 list is honoured here and not relitigated; new non-goals are
  argued.

---

## 1. Scorecard

Counts of distinct features compared, by area. "Ahead" means ODM does the
job in a way none of the surveyed products do.

| Area | Have | Partial | Missing, build | Non-goal | Ahead |
| --- | --- | --- | --- | --- | --- |
| Scenes and maps | 14 | 6 | 5 | 9 | 2 |
| Tokens and board presentation | 6 | 4 | 6 | 3 | 0 |
| Combat and automation | 17 | 3 | 3 | 0 | 3 |
| Dice, chat, macros | 10 | 3 | 4 | 2 | 2 |
| Actors, items, sheets, rules | 19 | 4 | 5 | 2 | 4 |
| Journals, wiki, world lore | 8 | 5 | 8 | 1 | 1 |
| Time, calendar, weather | 2 | 3 | 3 | 0 | 0 |
| Audio, visual, animation | 7 | 3 | 7 | 3 | 3 |
| Cards, tables, generators | 5 | 1 | 4 | 1 | 0 |
| World building and prep | 10 | 4 | 6 | 1 | 3 |
| Content, import, export, sharing | 8 | 3 | 7 | 2 | 0 |
| Multiplayer, social, safety | 9 | 2 | 7 | 1 | 2 |
| AI game master | 16 | 3 | 5 | 0 | 6 |
| Platform, accessibility, ecosystem | 5 | 3 | 7 | 2 | 0 |
| Editor look and feel (section 16) | 4 | 6 | 13 | 1 | 3 |

The pattern is the same one the parity audit found. Where the engine is
involved (combat, rules, the AI turn, world simulation) ODM is at or past
the bar. Where the field competes on presentation (token art, animation,
scene dressing) or on a document model (wiki, timelines, per-player
permissions) ODM is thin. The largest single gaps, in the order they matter,
are in section 16.

---

## 2. Scenes and maps

Bar: Foundry core v12/v13, Roll20 Jumpgate dynamic lighting, FGU's four-layer
lighting, Owlbear's fog, TaleSpire and Menyr in 3D.

| Feature (who has it) | ODM | Verdict |
| --- | --- | --- |
| Square grid with scale | 5 ft squares, fixed | Have |
| Hex and gridless (all) | None | Non-goal; five engine modules are square |
| Grid size, colour, line style (Foundry, Roll20) | Fixed | Non-goal; display |
| Walls and doors | Wall and door tiles; doors open, closed, locked, secret | Have |
| Terrain walls, low walls blocking movement not sight (Foundry) | Not shipped; phase 13 listed it and section 6 does not record it | Partial, finish |
| One-way walls, windows, proximity walls (Foundry v11) | None | Non-goal; LOS is tile-based and symmetric |
| Door sounds and animated doors (Foundry v11, v13) | Doors change state silently | Missing, build the sound only; a sting on `open_door` is one catalog cue |
| Dynamic lighting with bright and dim radii | Lights with radius and presets, up to 24 per map, light zones | Have |
| Light colour, angle, 19 animations, sound-reactive lights (Foundry) | None | Non-goal; display |
| Darkness sources, negative light (Foundry v12) | None | Missing, build the simple form: a zone with ambient `dark` already exists, so a magical-darkness spell effect that places one is a tool, not an engine |
| Vision modes and detection: darkvision, blindsight, tremorsense, see invisibility (Foundry) | Darkvision for PCs; monster senses stored since phase 12; blindsight and tremorsense not consumed by `los.ts` | Partial |
| Fog of war, explored | Per-tile explored fog, per-character LOS | Have |
| Per-player fog and player-specific visible tokens (Owlbear Smoke & Spectre) | Party-shared projection; hidden tokens are DM-only, not per-player | Partial |
| Elevation, multi-level maps, stairs (Foundry Levels, Arkenforge, Roll20) | None; no level change in the terrain alphabet | Non-goal, restated from the workshop plan |
| Flying and burrowing movement types (Foundry v13) | Flying speed on sheets; no vertical position on the board | Partial |
| Tiles: stacked art, overhead roofs, occlusion, video tiles | One backdrop and one DM overlay per map | Non-goal for stacking; fog already hides unexplored rooms |
| Drawings: freehand, shapes, text (Foundry, Owlbear, Roll20) | Text labels at a tile, DM-only or shared | Partial; freehand scribbles for a plan of attack are the missing half |
| Measured templates | Sphere, cone, line, cube, stopping at walls | Have |
| Ruler with waypoints and drag measurement | Board ruler and movement budgets | Have |
| Pathfinding and colour-coded reach (Drag Ruler) | Pathfinding and movement budget per token | Have |
| Scene regions: movement cost, darkness, teleport, macro, scrolling text (Foundry v12) | Cost via terrain, darkness via zones | Partial; teleport and scripts are non-goals |
| Map notes pinning a document (Foundry, Roll20, Kanka, World Anvil) | Region map pins; battle-map labels cannot open a lore entry | Missing, build; `[[links]]` already resolve, so a label that carries a link is a field |
| Ambient positioned sounds (Foundry, Arkenforge) | None | Non-goal for audio emitters; note that ODM's proximity voice is the one positional audio feature the field lacks |
| Weather overlays: rain, snow, fog (Foundry, Owlbear Weather, FXMaster, TaleSpire atmosphere, Menyr) | None visual; extreme cold and heat exist as hazards | Missing, build a CSS overlay driven by the same `set_ambience` mood; see section 9 |
| Scene transitions and cutscene mode (Scene Transitions, TaleSpire) | None | Missing, build the small form: a full-screen title card with the chapter name on chapter open, which already exists as an event |
| Camera lock and pull players to a view (Lock View, TaleSpire cutscene) | None | Missing, build for the DM seat; pings already pan |
| Procedural dungeon generation (Roll20 Instant Dungeon, Owlbear Crawl, donjon) | Generate-from-hint battle maps with rooms, lighting, spawns | Have, ahead: the generated map carries LOS and cover |
| Overworld generation and painting (nobody in the VTT field; Azgaar as a separate tool) | Seeded region map, painter, roads and rivers, Azgaar import | Have, ahead |
| Nested maps: world to region to city to building (World Anvil, Kanka, LegendKeeper, Worldographer) | Region map plus flat prepared-map drawer; a place does not open its map | Partial; the place-to-map link the audit left out |
| Map layers, seasonal and political (World Anvil, Kanka) | None | Missing, low value; borders drawn as lines cover the political case |
| Auto grid detection on uploaded images (Tableplop) | Backdrop register controls, manual | Partial |
| 3D tabletop (TaleSpire, Menyr, Sigil, Tabletop Simulator) | None | Non-goal |

---

## 3. Tokens and board presentation

Bar: Foundry tokens and dynamic rings, Roll20 token bars and status markers,
Owlbear's token utilities, TaleSpire minis.

| Feature | ODM | Verdict |
| --- | --- | --- |
| Token kinds and disposition | pc, enemy, npc, prop, hidden flag | Have |
| Portrait art on tokens | Character portraits drawn on the board | Have |
| Monster and NPC token art | NPCs have portraits; monsters have type placeholders, no portrait | Partial; audit left it out behind thumbnails work |
| HP bars | Green, amber, red bar under the token | Have |
| Condition and status icons on the token (everyone) | Conditions live in the party panel and the tracker, not on the board | Missing, build; the data is there, this is a render |
| Nameplates and hover tooltips | Names on tokens | Have |
| Health estimate text, "bloodied" (Health Estimate, dnd5e 2024) | Real HP shown to allowed seats; no estimate for players | Missing, build; `viewer.ts` already decides who sees real numbers, so the player projection can carry a word instead |
| Auras drawn around tokens (Roll20, Owlbear Auras, Token Magic) | Aura of Protection is enforced by position; nothing is drawn | Missing, build the ring for any effect with a radius |
| Token size: large and huge creatures occupying more squares | `size` on `EnemyStats`; the board draws one tile | Partial |
| Token movement animation | Token jumps to the new tile; current-turn pulse and a ping | Missing, build; a CSS transform transition on the token position |
| Damage flash, dynamic token ring, hit and miss feedback (Foundry v12 rings, Token Magic) | None | Missing, build; the roll chip already knows hit, miss, crit |
| Blood splatter, gore (Splatter) | None | Non-goal |
| Facing and auto-rotation (Foundry v13) | None | Non-goal; 5e has no facing |
| Wildcard token art, rollable-table tokens (Roll20) | None | Non-goal |
| Token targeting shared across players | Targets are named in the action, not on the board | Partial |
| Token HUD: quick actions without opening the sheet (Token Action HUD, Argon) | The composer and the character sheet dialog | Missing, build a small one: attack, cast, dodge, dash, disengage on the current token |
| Polymorph on the token, multiple forms (TaleSpire, dnd5e) | Wild Shape and Polymorph swap the stat block; the token art does not change | Partial |
| Item piles and loot on the map (Item Piles) | None; treasure goes to purses by tool | Missing, low value; see section 6 shops |

---

## 4. Combat and automation

Bar: Foundry dnd5e plus Midi-QOL, FGU's effects engine, Improved Initiative,
the AI GMs' rules engines.

| Feature | ODM | Verdict |
| --- | --- | --- |
| Initiative tracker with editing, rounds, turn pointer | Yes, with DM editing and rewind | Have |
| Auto-rolled attacks, damage, saves, resistances, crits | Server-resolved for both sides | Have, ahead: the narrator cannot state a number |
| Concentration | Set, checked on damage, broken, lingering effects cleared | Have |
| Conditions with durations and save-ends | SRD table plus named buff registry | Have |
| Active effects with stacking rules and durations | Yes | Have |
| Effects expressed on items and applied when equipped (DAE, FGU effects) | Homebrew gear carries typed effects, magic items gated by attunement | Have |
| Action economy, reactions, opportunity attacks, multiattack | Enforced | Have, ahead of everything except Midi |
| Cover and long range | Computed from the map | Have |
| Surprise, group checks, passive gating | Enforced | Have |
| Legendary and lair actions, legendary resistance | Stored as tagged text sections on the block; no economy enforced | Partial; a per-round legendary budget is the same shape as the action budget |
| Encounter builder with XP thresholds and random generator modes (KFC, DDB) | Workbench with adjusted XP, rounds-to-drop, odds | Have, ahead: it forecasts the fight, not only the budget |
| Encounter statistics: damage dealt, kills, nat 20s (Encounter Stats) | The audit log holds the data; nothing sums it | Missing, build a summary on encounter finish |
| Turn notifications with sound, auto-pan to combatant (Monk's Combat Details) | Spotlight and floor; a sting on combat start | Partial; a per-player "your turn" chime is one cue |
| Combat playlist and hype tracks (Maestro) | Ambience follows combat | Have |
| Group saving throw and contested roll requests (Monk's TokenBar) | `group_check`, `request_roll` to several players | Have |
| Damage application from a chat card with multipliers | Damage lands from the tool call, split-damage tool | Have |
| Summon, teleport and transform activities (dnd5e 6.0) | Pets and familiars, Wild Shape and Polymorph; no teleport tool moving a token | Partial; a `teleport` map tool is a move without a path |
| Falling damage from elevation | Falling by tool, no elevation | Have |
| Chases | Out of scope | Missing, low value |
| Bastions and facility turns (dnd5e 2024) | None | Non-goal; 2014 SRD ruleset |
| 2024 rules toggle, weapon masteries | None | Missing, defer until an open 5.2 dataset is imported; the content pack is SRD 5.1 |

---

## 5. Dice, chat, macros

| Feature | ODM | Verdict |
| --- | --- | --- |
| Server-authoritative dice | Yes, cryptographic RNG | Have |
| Roll notation: keep, drop, reroll | `kh`, `kl`, `rN`, floors | Have |
| Exploding dice, success counting, coins, FATE dice (Foundry) | None | Non-goal; 5e never uses them |
| Manual player rolls and named checks | `POST rolls` takes an expression or a skill | Have |
| Roll modes: public, GM, blind, self | Yes, redacted not hidden | Have |
| 3D dice | dice-box, custom look, shake to roll | Have |
| Physical and Pixels dice | Per-die source, auto-submit | Have, ahead: no other product parks the GM turn on a physical roll |
| Inline rolls in text and enrichers (Foundry `[[/check]]`) | None in lore or notes | Missing, build for handouts and house rules: `[[1d6]]` in a lore entry is the chunker plus the dice engine |
| Whispers and private threads | DM-to-player whisper, player side chats | Have |
| OOC and emotes | OOC mode; no `/emote` | Partial |
| Chat bubbles over tokens (Foundry) | None | Non-goal |
| Speak-as an NPC for a human DM (Roll20 speak-as, Theatre Inserts) | Narration is one voice; NPC lines are prose | Missing, build: a "speaking as" picker on the DM composer, which the NPC forge already knows the names for |
| Language scrambling for in-world languages (Polyglot) | Languages on sheets; no effect | Missing, low value |
| Macros, script and chat | None | Non-goal, restated |
| Hotbar | None | Non-goal |
| Chat export | Story export to DOCX, ODT, HTML | Have |
| Card decks (Foundry, Roll20, Owlbear Decked) | Draw-without-replacement tables | Have, by another name |

---

## 6. Actors, items, sheets, rules

| Feature | ODM | Verdict |
| --- | --- | --- |
| Guided character builder (Charactermancer, DDB) | Wizard with point buy, array, rolled | Have |
| Level-up advancement with choices | Yes, server-validated | Have |
| Multiclassing | Full engine | Have, ahead of Roll20 and most AI GMs |
| Spellbook with preparation, slots, pact magic, upcasting | Yes | Have |
| Inventory with weight and encumbrance | Yes, optional rule | Have |
| Containers with capacity (dnd5e) | None | Missing, low value |
| Multi-denomination currency and party purse | Yes | Have |
| Attunement and identification | Yes | Have |
| Rests, hit dice, variant rest lengths | Yes | Have |
| Transformations | Wild Shape and Polymorph with real blocks | Have |
| Companions, sidekicks, familiars (DDB Extras) | Full companion sheets that level with the party | Have, ahead |
| Party as an actor with shared inventory (dnd5e group, FGU party sheet) | Party entity with purse and pack | Have |
| Vehicles and mounts | Mount engine; no vehicle actor | Partial |
| Compendium browser with filters | `/reference` browse, compare, calculators, Ask | Have, ahead: grounded Ask with checked citations |
| Homebrew editors for every kind (DDB, Shard) | Items, spells, feats, backgrounds, species, subclasses, monsters | Have |
| Monster builder with CR calculation (Tetra-Cube, Kassoon) | Derived CR by the DMG procedure, tested against the SRD | Have, ahead |
| Class and subclass builder from scratch (DDB, Shard, Let's Role) | Subclass editor; no new base class | Partial; world packs reskin classes |
| Merchant NPC sheets, shops, buying and selling (Item Piles, Loot Sheet, Kanka inventory, Chronica shops) | No shop or trade tool; gold and items move by DM mutation | Missing, build: a `shop` scene tracker with a stock list and prices, using the item pack's costs |
| Player-to-player trading | None | Missing, build alongside shops |
| Parcels, loot bundles handed to the party (FGU) | Encounter rewards, `party_award` | Have |
| D&D Beyond character import (Alchemy, AboveVTT, Avrae, DDB Importer) | Own bundle format only | Missing, build a read-only importer of the DDB JSON into the builder; it is the most requested bridge in every product's forum |
| Foundry or Roll20 sheet import | None | Missing, low value |
| Character sheet PDF | Yes | Have |
| Custom system builder, other rulesets (Let's Role, Alchemy, Owlbear Forge, FGU) | 5e only, genres reskin it | Non-goal; the engine is the product |
| Sheet formulas and custom attributes (Dicecloud, Kanka attributes) | Freeform typed attributes on any entity | Have |

---

## 7. Journals, wiki, world lore

Bar: World Anvil, Kanka, LegendKeeper, Foundry journals, Monk's Enhanced
Journal, Forien's Quest Log.

| Feature | ODM | Verdict |
| --- | --- | --- |
| Lore entries with markdown, image, tags, links | Yes | Have |
| Player-visible entries as handouts | Visibility `dm` or `party` | Have |
| Inline secret blocks inside a visible entry (World Anvil, LegendKeeper, Foundry) | Whole-entry visibility only | Missing, build: a `:::secret` fence the renderer drops in the party projection |
| Per-player visibility, subscriber groups (World Anvil, Kanka, Foundry ownership) | Two levels: DM and table | Missing, build: a whisper already reaches one player, a handout to one player is the same address |
| Show to players, pull to screen, image popout (Foundry, Roll20) | A handout is found in the Lore tab | Missing, build: a "show this now" push over the existing SSE bus |
| Page types: PDF, video, embedded map (Foundry, Let's Role, Owlbear PDF) | Text and one image | Missing, build PDF only; players bring their own sourcebooks |
| Journal history and versioning (World Anvil) | Chapter snapshots for game state; lore has no history | Missing, low value |
| Real-time collaborative editing (LegendKeeper, Foundry ProseMirror) | Last write wins | Non-goal at this scale |
| Typed article templates: settlement, organisation, species, item (World Anvil, Kanka, Campfire) | NPC, place, monster, item are typed; everything else is a lore category | Partial; a faction entity is the one missing type, see section 11 |
| Quest log with objectives and states (Forien's, Kanka, Chronica) | AI-maintained quest log from the arc | Have, ahead: it is derived from play; Partial for a human DM who wants to write objectives by hand |
| Session reports and player journals (World Anvil, Kanka) | Chapter summaries, recaps, per-character story so far, player notes | Have |
| Timelines and eras (World Anvil, Kanka, LegendKeeper, Campfire) | Chapters in order; in-world calendar; no timeline view | Missing, build a read-only timeline from chapters, world facts and calendar events; the data already carries dates |
| Family trees and relationship graphs (World Anvil, Kanka, Campfire) | NPC relations stored per NPC, listed | Missing, build the graph view; the relations table is the edge list |
| Whiteboards and boards (LegendKeeper, World Anvil, Obsidian Canvas) | Storyboard with cards and arrows | Have, ahead: the board compiles into play |
| Full-text and semantic search across everything | `search_lore` and the reference desk | Have |
| Tag index and filters on lists | Tags stored; filters not on every list | Partial |
| Bookmarks, pinned entries | Pinned lore and pinned memories | Have |
| Public read-only world page (World Anvil, Kanka, LegendKeeper) | None | Non-goal; ODM is a private table |

---

## 8. Time, calendar, weather

| Feature | ODM | Verdict |
| --- | --- | --- |
| In-world clock advanced by travel, rests and a tool | Yes | Have |
| Rest recovery at dawn and dusk, time-driven effect expiry | Effects have durations in rounds and time | Have |
| Custom calendar editor: months, weekdays, moons, festivals (Simple Calendar, Fantasy-Calendar, Kanka, World Anvil) | `calendar.ts` engine with a fixed calendar; no editor, and world packs cannot name months | Partial; a pack field and a small editor |
| Calendar events and reminders (Kanka, Simple Calendar) | None | Missing, build: world arcs already tick, a dated event is an arc with a date |
| Weather generation by climate and season (donjon, Calendar/Weather, Menyr) | Extreme cold and heat as hazards when the DM invokes them | Missing, build a pure `weather.ts` rolled at each dawn by the living-world tick, fed into the prompt and the ambience mood |
| Day and night cycle changing map lighting (Menyr, TaleSpire, Arkenforge) | Ambient light per map, fixed | Partial: the clock knows the hour, the map does not read it |
| Synced timers and rest countdowns (Owlbear Ticker, Short Rest, Dark Torch) | None | Missing, low value; a torch timer is a nice rules touch for the light engine |

---

## 9. Audio, visual, animation

Bar: Dice So Nice, Sequencer and JB2A, Automated Animations, FXMaster,
Syrinscape, Arkenforge soundscapes, Alchemy's animated scenes, Owlbear Embers.

| Feature | ODM | Verdict |
| --- | --- | --- |
| Three-layer ambience with AI and DM control | Bed, music, sting; 65 cues | Have, ahead: the narrator picks it |
| Syrinscape-style moods and one-shot pads | Bed plus sting is the same shape; catalog is smaller | Have |
| Authored playlists with modes (Foundry, Roll20 Jukebox) | None | Partial; audit already said build only if asked |
| Player-uploaded music and per-campaign tracks (Owlbear Tracks, Let's Role) | Catalog only, fetched by script | Missing, build an upload slot into the bed and music layers; the upload guard exists |
| Per-listener volume and mute, ducking under narration | Yes | Have |
| Voice chat with rules-aware turn taking and proximity | In-process SFU | Have, ahead: nobody else muffles through walls |
| Video and webcam (Roll20, Foundry, Alchemy, Role) | Audio only | Missing, build; mediasoup already carries video, this is a second producer kind and a tile grid |
| Screen share | None | Missing, low value with handouts pushed |
| TTS narration | Kokoro, per campaign voice | Have |
| Per-NPC voices (Intelligent NPCs, Friends & Fables voice models) | One voice per campaign | Missing, build: NPC forge gains a voice pick, narration is already split by speaker in the transcript |
| Spell and attack animations on the board (JB2A, Automated Animations, Owlbear Embers, Sigil) | None | Missing, build the cheap form: a burst at the target tile keyed on damage type, a beam from caster to target for attacks; CSS on the SVG board, no asset library |
| Token movement tween | Jumps | Missing, build (section 3) |
| Ping animation | Yes | Have |
| Weather particles and colour filters (FXMaster, Owlbear Weather) | None | Missing, build (section 2) |
| Animated scene art, particles over the scene image (Alchemy) | Static scene art | Missing, build: a slow pan and a particle layer over the image ODM already generates |
| Scene transitions | None | Missing, build (section 2) |
| Fireworks and celebration effects | None | Non-goal |
| Visual-novel character inserts (Theatre Inserts, Alchemy portraits front and centre) | Portraits in the party panel | Partial; "speaking as" in section 5 gives the portrait a reason to appear |
| Dice sound and interface sounds | Dice tray has physics; no UI sounds | Partial |
| Streamer overlay mode (Alchemy, AboveVTT) | None | Non-goal |
| Player screen for an in-person table, second monitor (Arkenforge, EncounterPlus, Dungeon Scrawl lighting mode) | Every player has a device; no "table view" | Missing, build a read-only TV view of the board and scene art; it is the fogged player projection with no chrome |

---

## 10. Cards, tables, generators

| Feature | ODM | Verdict |
| --- | --- | --- |
| Roll tables: ranges, weights, nesting, document rows, no replacement | Yes | Have |
| Table rolled by the AI at the right moment | `roll_table` tool | Have, ahead |
| Card decks | Non-goal, a table drawn without replacement | Non-goal |
| Name generators (donjon, Fantasy Name Generators) | Per-field NPC generation by the model | Have |
| Town, inn, shop generators with linked NPCs (Eigengrau, Kassoon, donjon) | Location persistence and NPC roster grow from play; no one-press town | Missing, build: a `settlement` generator that emits a place, three NPCs, one shop stock and two rumours as workshop rows |
| Treasure and magic shop generators | Treasure by CR | Have |
| Random encounter by environment | Tables with `@monster:` rows and monster environment tags | Have |
| Community table sharing (Chartopia) | Tables travel in bundles | Partial |
| Adventure and plot generators (donjon) | Secret arc generation at campaign start | Have, ahead |
| Handout makers: letters, wanted posters, styled PDFs (Homebrewery, GM Binder) | A lore entry with an image | Missing, build one parchment style for the party projection of a handout |

---

## 11. World building and prep

Bar: World Anvil, Kanka, Campfire, Lazy DM, Alexandrian nodes, Dungeon World
fronts, Blades clocks, Menyr's codex.

| Feature | ODM | Verdict |
| --- | --- | --- |
| Prep space outside a campaign | Workshop | Have |
| Storyboard with typed cards and arrows, compiled into play | Yes | Have, ahead |
| Secrets and clues list, strong start, scenes (Lazy DM) | Secret cards, event cards; no strong-start card, no checklist per session | Partial; a "session prep" card set is the eight steps as card types |
| Fronts, grim portents, impending doom (Dungeon World) | World arcs escalate off screen | Have |
| Progress clocks and faction clocks (Blades) | Non-combat scene trackers with counters; no clock visual | Partial |
| Factions as entities with relations, reputation and turns | Lore entries only; NPC faction field left out of phase 14 | Missing, build: a faction row, NPC `faction_id`, party reputation per faction feeding `socialCheckDc` |
| NPC forge with agency, goals, relations | Yes | Have, ahead |
| Species, cultures, languages, religions, magic systems (Campfire, World Anvil) | Lore categories; world packs carry species and factions as names | Partial |
| Interactive image maps with pins to articles (World Anvil, Kanka, LegendKeeper) | Region map pins, backdrop image | Have |
| Map makers: Dungeondraft, Dungeon Alchemist, Inkarnate imports | UVTT and image backdrop | Have |
| Azgaar import | Yes | Have, ahead |
| Watabou city and dungeon import (Owlbear One Page Importer) | None | Missing, build the one-page dungeon JSON into a prepared map; it is the same converter shape as UVTT |
| Session zero: lines, veils, tone, consent (safety toolkit) | Genre presets, relationship and romance ladder settings | Missing, build (section 13) |
| Prep checklist and to-do (World Anvil) | Assist rail counts gaps | Have |
| Codex auto-written from the world (Menyr) | World facts register, per-character story so far | Have |
| Community worlds and content packs | World pack registry, bundles | Have |
| Player-facing world wiki | Handouts in the Lore tab | Partial; see section 7 |

---

## 12. Content, import, export, sharing

| Feature | ODM | Verdict |
| --- | --- | --- |
| Open compendium | Open5e pack | Have |
| Purchased official content (Roll20, FGU, DDB, Foundry premium) | None | Non-goal; licensing |
| Adventure modules with maps, handouts and encounters ready to run | Workshop bundles | Partial; nobody publishes them yet, and the registry lists packs, not bundles |
| Marketplace with ratings and comments | Registry listing only | Missing, build the registry entry for bundles first; ratings can wait |
| Transmogrifier: copy pages, characters, tables between games (Roll20) | Content import and clone | Have |
| World and campaign backup, scheduled (Foundry v11) | Docker volumes; no in-app backup or restore | Missing, build: an admin "download encrypted backup" and a restore path |
| Export a campaign as a bundle | Workshop bundles; a played campaign clones but does not export | Partial |
| PDF sourcebook ingestion for rules Ask (Quest Portal Library Link) | House rules text only | Missing, build: a PDF to text upload into the same chunker the house rules use |
| CSV and spreadsheet import of tables and NPCs (Data Toolbox) | Pasted book text for tables | Partial |
| Word and Google Docs import of content (Shard) | None | Missing, low value |
| Discord webhooks on campaign events (Kanka) | Discord sign-in only | Missing, build a per-campaign webhook for session scheduled and chapter closed |
| Public REST API with tokens (Kanka, TaleSpire symbiotes) | Internal REST behind cookies | Missing, defer |

---

## 13. Multiplayer, social, safety

| Feature | ODM | Verdict |
| --- | --- | --- |
| Roles: owner, lead, DM seat, assistant DM, member | Yes | Have |
| Per-document ownership levels (Foundry) | DM or table on lore and notes | Partial (section 7) |
| Invite links, QR, lobby, ready-up | Yes | Have |
| Player list and presence | Yes | Have |
| Shared cursors (Foundry, Owlbear) | Pings only | Missing, low value; pings do the job on a phone |
| Scheduling with RSVP | Yes | Have, ahead of every VTT |
| Friends, blocks, reports, mutes | Yes | Have |
| Looking-for-group directory (Roll20, Role) | None | Non-goal; private server |
| Spectators and stream viewers (Alchemy) | None | Missing, low value |
| Safety tools: X-card, lines and veils, script change (Rumble, Let's Role `/xcard`, RoleForge boundaries) | None | Missing, build, and cheap: an anonymous X-card button that pauses the turn and tells the DM seat, plus lines and veils in campaign settings that ride in the prompt as hard constraints. Every AI GM reviewer in 2026 calls this out as absent across the field |
| One character per player | Limitation | Missing, build; the field allows several and a solo player wants a party |
| Player-to-player trade | None | Missing (section 6) |
| Multiple tables per server, single process | Yes, one process | Have with the documented limit |

---

## 14. AI game master

Bar: Friends & Fables, RoleForge, Voyage, DungeonsDeep, AI Realm, AI Dungeon,
Hidden Door, SagaBound, Quest Portal's assistant, FoundryAI, Intelligent NPCs,
Familiar VTT, Archivist and Tabletop Arc.

| Feature | ODM | Verdict |
| --- | --- | --- |
| Deterministic rules engine separate from narration (RoleForge, Voyage, DungeonsDeep) | The whole architecture | Have, ahead: the guard rewrites narration that contradicts the dice |
| Platform-managed memory with no player upkeep | Rolling summary, semantic recall, facts, pins, chapter LOD | Have, ahead |
| Context viewer showing what the model saw (AI Dungeon Context Viewer) | Context inspector | Have |
| Multiplayer with turn taking | Up to a table, floor control | Have |
| Battle maps with LOS and cover (F&F Combat V4, RoleForge) | Yes | Have |
| NPC personas with persistent relationships | NPC agency, attitudes, relations | Have, ahead |
| Multiple GM personalities, tone dials (Voyage, RoleForge six-axis tone) | Genre presets and director steer; personalities on the roadmap | Partial |
| GM strictness slider, coaching to impartial (RoleForge) | Difficulty ladder is fixed; no strictness setting | Missing, build a small one: lenient, standard, harsh as a prompt block and a DC ladder offset |
| Content boundaries setting (RoleForge) | None | Missing, build with the safety tools |
| Images: portraits, scenes, maps | Yes, ComfyUI | Have |
| Voice narration and voice input | Kokoro and whisper | Have |
| Per-NPC voices | One voice | Missing (section 9) |
| Session transcription from voice chat with quest and NPC extraction (Archivist, Tabletop Arc) | Push-to-talk transcribes what a player sends; the SFU audio is never transcribed | Missing, build for human-DM tables: the SFU already has every stream, whisper is already wired, and story-beat capture is the consumer |
| Dual-track recaps, player-safe and DM-private (Tabletop Arc) | Quest log is player-safe, arc is DM-only, recap is one text | Partial; render the recap twice through `viewer.ts` |
| Session Stories postcards (Quest Portal) | Story export | Missing, low value |
| AI mercenaries to fill a party (RoleForge, F&F) | Companions | Have |
| Permadeath and consequence toggles (Voyage) | Death track is real | Have |
| Source-cited rules answers (Quest Portal) | Ask with checked citations | Have, ahead |
| AI co-pilot for a human GM | Assisted mode, assist rail, per-field generation | Have, ahead |
| Player-authored worlds with an editor (Voyage, Hidden Door Atlas) | Workshop and world packs | Have |
| Trope-card guided narrative (Hidden Door) | Storyboard cards | Have |
| Local, private, no cloud | Yes | Have, ahead: no surveyed AI GM runs on device |
| Model choice and per-role sampling | Yes | Have |
| Hosted option for people without a GPU | None | Non-goal by charter; note it is the reason the field's products exist |

---

## 15. Platform, accessibility, ecosystem

| Feature | ODM | Verdict |
| --- | --- | --- |
| Installable web app, desktop and Android shells | Yes | Have |
| iOS | Web only | Missing, defer; client repo concern |
| Light and dark theme, OS preference (Foundry v13) | One theme; no `prefers-color-scheme` handling | Missing, build; a token set already exists in `globals.css` |
| UI scale and font size | None | Missing, build with the theme |
| Reduced motion respected | Yes | Have |
| Screen reader: live regions for narration and rolls | Four files use `aria-live` | Partial |
| Keybindings with a settings page | Painter hotkeys only | Missing, build the dozen table keys: roll, end turn, open sheet, toggle map |
| Localisation | English only, no framework | Missing, defer; it is the largest platform gap for a community project |
| Tours and toolclips | Tours and help dialogs | Have |
| Extension or module API (Foundry, Owlbear SDK, TaleSpire symbiotes, Roll20 mods) | World packs | Non-goal for scripting, restated; a read-only event webhook is the safe halfway (section 12) |
| Performance mode, canvas off | Board is SVG, dice fall back silently | Have |
| Self-hosting and Docker | Yes | Have |
| Backups | See section 12 | Missing |

---

## 16. Graphical editors: how they look and how they work

This section compares the editors themselves, not what they produce. The
competitor side is from their documentation, tutorials and reviews; ODM's
side is from reading the React under `src/app/workshop`, the console panels
in `src/app/campaigns/[campaignId]`, and the shared kit in `src/lib/ui.tsx`,
`src/components/ui` and `globals.css`.

### 16.1 The two shapes the field has settled on

**Canvas-first.** Foundry, Roll20 Jumpgate, Owlbear, Dungeondraft,
Inkarnate, Wonderdraft, Dungeon Alchemist, Dungeon Scrawl, TaleSpire and
Menyr all put the map in the whole viewport, a vertical tool strip on one
edge, and a contextual palette or options panel on the opposite edge. The
interaction model is **select an object, then manipulate it**: a selected
thing shows handles for scale and rotation, a marquee selects many, wheel
over a selection rotates, Alt disables snapping, Delete removes, Ctrl+C
and V copy, Ctrl+Z and Y undo and redo. A compact **action bar floats on
the selected item** (Foundry's token HUD, Owlbear's context bar, D&D
Beyond's token toolbar) and a **tabbed config window** holds the deep
properties. Foundry, Roll20 and Dungeondraft add a layer-mode strip (pick a
layer, then a sub-tool), and every one of the three is criticised for the
"why can't I click it" moment when the wrong layer is active. Owlbear and
D&D Beyond Maps avoid it with one selectable layer plus fog.

**Form-first.** World Anvil, Kanka, Campfire and D&D Beyond homebrew are
tabbed pages of fields; the one canvas they have is the image map with
pins. LegendKeeper, Obsidian and Arcweave are document-first with a canvas
mode. Text editing has converged on the **block editor**: a bubble toolbar
on selection, a `/` menu to insert embeds and secrets, `@` or `[[` to link,
drag-in images. BBCode (World Anvil's Euclid) and markdown (Homebrewery,
Foundry's markdown option) survive for power users, and Homebrewery's
split pane with a live styled preview is the reference for handout
authoring.

**What reviewers repeat.** Foundry: configuration density and nested tabs.
Roll20: dated look, a new toolbar that eats screen. Inkarnate: slow on big
maps, coarse rotation. Dungeondraft: asset-pack management. World Anvil:
overwhelming and cluttered. Dungeon Alchemist: rectangular rooms only.
Owlbear: deleting a token is not obvious. Only Owlbear, D&D Beyond Maps and
Obsidian are genuinely usable on a phone; everything else is desktop.

### 16.2 What ODM's editors are

ODM is neither shape. It is **modal tool plus tap**, everywhere, and it is
phone-first by construction.

- **Layout.** No editor is a page of its own except the workshop hub. Every
  editor is one scrolling column inside a `Sheet` (a bottom sheet with a
  grip below the `lg` breakpoint, a centred dialog above it): canvas or list
  on top, toolbox below, fields below that, action buttons last. There are
  no floating windows, no dockable panels, no layer panel, no object list.
  The hub page keeps the open system in the URL (`?system=cast`) so back
  and bookmarks work, and shows thirteen system cards with live counts.
- **Two canvases, two renderers.** The battle map editor draws on HTML
  canvas 2D with ordered passes (ground, lights, scene, grid, tool preview)
  and a CSS transform for zoom and pan; the live board players see is pure
  SVG, memoised hard because narration streams re-render the session. The
  region map is canvas 2D redrawn eleven times a second to pulse the party
  marker.
- **Placing is "set the value, then tap the tile".** The thirteen battle
  map tools (brush, line, outline, box, fill, stamp, light, door, label,
  prop, light zone, pick, move) are chips in a wrapping row; you type the
  label text or pick the light preset in a dial under the toolbox and then
  tap where it goes. Tapping a placed label, prop or light removes it; a
  door cycles open, locked, secret. Nothing has handles, nothing rotates,
  nothing is selected, nothing is dragged. Live preview while dragging a
  shape is real: the server's own stroke compiler runs client-side and
  paints the tiles before release.
- **Hotkeys exist on the battle map only.** `1` to `5` for brushes, a
  letter per tool, Escape drops the tool, Ctrl+Z and Ctrl+Shift+Z, all
  guarded against typing in a field, every one with an on-screen twin.
  Keys are discoverable only through hover titles.
- **Undo exists in one place**, terrain painting, as a thirty-deep
  snapshot stack where undo is sent to the server as a full terrain
  replacement and validated like fresh paint, so an undo that would bury a
  standing token is refused with a sentence. Labels, props, lights, zones,
  doors and backdrop are immediate patches with no undo. The region map
  has no undo beyond "undo a point" inside a line being drawn; its
  recovery path is the eraser.
- **Zoom and pan** are done properly on both canvases: wheel at the cursor
  through a non-passive listener, two-finger pinch around the midpoint,
  `touch-none` so a stroke never scrolls the page. The battle map has
  corner zoom buttons; the region map does not. On the region map you
  cannot pan while a tool is in hand, and terrain is painted one tap per
  tile with a radius slider rather than by dragging.
- **The live board uses a two-tap model on touch**: the first tap on a
  tile is the hover preview (path, cost in feet, range), the second commits.
  Moving a token is pick-up then tap-destination. The DM's measure tool
  lists the tokens caught and offers "copy the enemy ids" because the
  console's area field takes comma-separated ids; the code comment calls
  this hop a rough edge.
- **The storyboard is deliberately not a canvas.** It is a CSS grid of
  cards; arrows are "leads to" toggle chips inside the card editor. The
  file header explains why: arrows drawn between cards that reflow with the
  viewport would point at the wrong thing on a phone. Suggestions are
  counted, not generated.
- **Everything else is a form.** NPC forge, bestiary, homebrew, encounters,
  lore, roll tables and the plugin draft are labelled fields, native
  selects and range sliders, chip toggles, and one explicit save button.
  The lore body is a textarea of markdown with a "link an entry" dropdown
  that inserts at the caret. Roll tables are one textarea of pasted text
  with a coverage pill on the row (gaps and overlaps) rather than a row
  grid. The bestiary shows the derived CR working live beside the fields.
  The plugin draft is the one editor with debounced autosave and a visible
  saved, saving, unsaved badge.
- **AI is per-field.** A small Suggest button beside each generatable
  field, hidden when no model is configured, landing in the local draft
  only. No editor has a "fill the whole form" button, by rule.
- **Visual style.** One dark palette (indigo stone, gold amber, ember),
  serif display type, gold-foil primary buttons, glass panels with grain,
  ornate corner brackets, a starfield under the body. No light mode and no
  `prefers-color-scheme` handling. Reduced motion is honoured globally.
- **Onboarding** is stronger than the field: a spotlight tour per system
  that skips off-screen steps and can ask a panel to open the thing it is
  about to point at, plus help dialogs and a glossary. Foundry and World
  Anvil rely on video tutorials; Owlbear relies on being self-evident.

### 16.3 Where ODM's editors fall short of the field

| Editor behaviour (who does it well) | ODM | Verdict |
| --- | --- | --- |
| Select an object and manipulate it: handles, rotate, nudge, marquee (every canvas tool) | Nothing is selectable; delete and re-place | Missing, build for labels, props, lights, pins and lines; terrain stays a brush |
| Edit a placed thing after placing it (all) | Values are set before the tap; no "click a label, change its text" | Missing, build; the same selection model |
| Drag and drop anywhere (all) | None in the whole app; no `draggable`, no drop targets | Missing, build where a tap sequence is worse than a drag: token move on the board, reorder of storyboard cards and roster lines, image onto a map |
| Drag-paint on the region map (Inkarnate, Wonderdraft, Azgaar brushes) | One tap per tile | Missing, build; the battle map already drag-paints |
| Pan while a tool is in hand (all: Space or middle drag) | Region map refuses; battle map has a Move tool and middle-click | Partial |
| Undo and redo across every edit (all) | Terrain only | Missing, build a generic per-editor undo of the last patches; the server returns the whole object after each patch, so the ring is the same shape as the terrain one |
| A layers or objects panel with hover-to-highlight (Foundry legend, Inkarnate object list, Dungeon Scrawl) | None | Missing, build the small form: a list of placed labels, props, lights and zones that highlights on hover and deletes in bulk |
| Copy, paste and duplicate a region of a map (Foundry, Dungeondraft, TaleSpire slabs) | Duplicate whole map only | Missing, low value |
| Grid alignment of an imported image with a visual handle (Foundry, Roll20, Owlbear import dialog) | Four range sliders, no numeric readout, no handles | Partial; a drag-the-corner alignment is the first drag-and-drop worth building |
| Visible dirty state and a consistent save model (all editors in the field pick one) | Five models: blur-to-save, change-to-save, explicit button, debounced autosave, instant write; only the plugin shows a badge | Missing, build: one save behaviour and one badge, the plugin's |
| Discard warning when closing a sheet with unsaved edits | None on NPC, monster, homebrew, beat | Missing, build |
| Confirmation dialogs in the app's own style (all) | Native `window.confirm` in about fifteen places and `alert` for upload errors; the app's own `PromptDialog` is used only by the region map | Missing, build; also required because the desktop shell has no `prompt` |
| Hit targets and density on a phone (Owlbear) | Thirteen tool chips at 11 px text wrapping into four rows | Partial; a two-row toolbox with grouped tools and larger chips |
| Hotkey discoverability (Obsidian's `?` overlay, tooltips showing keys) | Hover titles only, battle map only | Missing, build a `?` overlay and extend keys to the region map and the board |
| Block editor with slash menu and link autocomplete (World Anvil Visual, Kanka Tiptap, LegendKeeper, Foundry ProseMirror) | Markdown textarea, link inserted from a dropdown at the caret | Partial; `[[` autocomplete is the half worth building, a full block editor is not |
| Live preview beside the text (Homebrewery, World Anvil previewer) | Markdown renders only after save | Missing, build a preview toggle; the renderer exists |
| Backlinks: what mentions this entry (LegendKeeper, Kanka, Obsidian) | None | Missing, build; the link resolver already parses every body |
| Row grid for roll tables with per-row weight and reorder (Foundry, Kanka) | One textarea plus parser | Partial; the parser is honest and paste is the fast path, but a grid for editing one row is the missing half |
| Relationship graph view (Kanka relation explorer, World Anvil diplomacy web) | Chips and selects; a `RelationGraph` is fetched and not drawn | Missing, build (also section 7) |
| Storyboard canvas with drawn arrows (Arcweave, Obsidian Canvas, LegendKeeper boards) | Card grid with toggle chips | Non-goal on a phone, restated; add drag-to-reorder and collapse the "leads to" chips into a picker past twenty cards |
| Light theme and OS colour scheme (Foundry v13, Roll20, Kanka, World Anvil) | Dark only | Missing, build (also section 15) |
| Widgets: custom selects and sliders with readouts (all) | Native `select` and `input type=range` styled dark | Partial; keep native on phones, add numeric readouts to every slider |
| Duplicated upload code | The same FileReader-to-POST block copied in five editors | Refactor, not a feature; one hook |
| Two-tap touch on the board (nobody else needs it because they drag) | Yes | Have, and worth keeping alongside drag |
| Server-validated edits with refusals in sentences (nobody) | Every stroke, every undo | Have, ahead |
| Guided tours per tool (rare in the field) | Yes | Have, ahead |
| Live derived readouts inside the form: CR working, budget bar with numbers, ruleset dry-run diff (Foundry has none of these inline) | Yes | Have, ahead |

### 16.4 What to change in the editors, in order

1. **A selection model for placed things.** Tap a label, prop, light, pin
   or line to select it; a small action bar appears (edit, move, delete,
   duplicate), arrow keys and a drag nudge it. This one change closes the
   first three rows above and is the precondition for drag-and-drop.
2. **One save model and one badge**, the plugin panel's debounced autosave
   with saved, saving, unsaved, plus a discard warning on sheet close.
3. **Replace every native confirm, alert and prompt** with the app's
   dialogs.
4. **Undo on every editor**, a ring of the last twenty server responses per
   editor, replayed as a full-object patch.
5. **Drag-paint and pan-while-painting on the region map**, and corner
   zoom buttons to match the battle map.
6. **A `?` hotkey overlay**, hotkeys on the region map and the board.
7. **Markdown preview and `[[` autocomplete** in the lore editor,
   backlinks on the entry.
8. **Grouped, larger tool chips** on the battle map toolbox.
9. **Light theme.**

## 17. What matters most, ranked

Ordered by the job done at the table divided by the work, and honouring the
house rule that the engine already owning the data is what makes a feature
cheap.

### Tier 1: small, and each one closes a hole every reviewer notices

1. **Safety tools.** X-card that pauses the turn anonymously, lines and
   veils in settings riding into the prompt as hard constraints, a content
   boundary level. No AI GM in the field has them. `docs/human-dm-plan.md`
   phase 2 conventions cover the seat that receives the card.
2. **Conditions and auras on the board.** Status icons on tokens and a ring
   for any effect with a radius. Render only; the data is already there.
3. **Health estimate words for players.** "Bloodied" and "near death" in the
   player projection through `viewer.ts`.
4. **Inline secret blocks and per-player handouts.** A fence the party
   renderer drops, and a `to` on a lore entry that reuses the whisper
   address.
5. **Show to players now.** One SSE event that opens a handout or image on
   every screen.
6. **Speaking as.** An NPC picker on the human DM's composer, so an NPC line
   carries the name and portrait. This is the seed for per-NPC voices.
7. **Token movement tween and hit feedback.** A transform transition and a
   flash keyed on the roll chip's hit, miss and crit.
8. **Light and dark theme, UI scale.** Foundry v13 made this table stakes.
9. **Editor hygiene** from section 16.4: one save model with a badge, the
   app's own confirm and prompt dialogs everywhere, undo on every editor.

### Tier 2: medium, engine mostly present

0. **A selection model in the map editors** (section 16.4, item 1): tap a
   placed thing, get an action bar, nudge and drag it. Every canvas tool
   in the field works this way and it is what makes the editors feel like
   editors rather than stamps.

9. **Factions.** A faction entity, NPC membership, party reputation per
   faction feeding social DCs, and the world tick advancing faction goals
   the way NPC agency already does.
10. **Weather and the day cycle.** A pure weather module rolled at dawn by
    the living-world tick, an ambient light that reads the clock, and a CSS
    overlay driven by the ambience mood. This also gives the scene art the
    animated particle layer Alchemy sells.
11. **Shops and trade.** A shop scene tracker with stock and prices from the
    content pack, and player-to-player item transfer through the existing
    proposal flow.
12. **Legendary actions.** A per-round legendary budget shaped like the
    action budget, since the block already tags the section.
13. **Spell and attack animations.** A burst at the target tile by damage
    type and a beam for attacks, CSS on the SVG board, no asset packs.
14. **Voice transcription for human-DM tables.** The SFU has the streams and
    whisper is wired; story-beat capture is the consumer. This is the
    Archivist job and the one thing a human DM in ODM still does by hand.
15. **Timeline and relationship graph.** Read-only views over chapters,
    facts, calendar events and the NPC relations table.
16. **D&D Beyond character import.** Read-only, into the builder.
17. **More than one character per player.** Lifts the documented limitation
    and makes solo play a party.
18. **Backups.** Admin download and restore of the encrypted database.

### Tier 3: larger or lower value, do when asked

19. Video in the voice call. 20. A TV view for an in-person table.
21. Calendar editor and world-pack month names. 22. Settlement generator.
23. Watabou import. 24. PDF sourcebooks into Ask. 25. Player-uploaded
music. 26. Scene transition title cards and DM camera lock. 27. Encounter
statistics. 28. Localisation framework. 29. Keybinding page. 30. Discord
webhooks. 31. Blindsight and tremorsense in the light model. 32. Large
creature footprints on the board. 33. A terrain wall tile. 34. Lore PDF
pages. 35. A "your turn" chime. 36. Teleport map tool. 37. Bundle listings
in the registry.

### Non-goals, restated and extended

The parity audit's list stands: hex and gridless, multi-tile art and
occlusion, one-way walls and windows, light colours and animations,
positioned sound emitters, regions beyond cost and darkness, macros and
scripts, card decks, vehicles as actors, folders, in-place bundle updates, a
canvas storyboard. Added here for the same reasons: elevation and levels,
3D tabletops, facing, wildcard token art, exploding and FATE dice, chat
bubbles, custom rule systems, public world pages, a hosted cloud, a
looking-for-group directory, an extension SDK, purchased official content,
streamer overlays, real-time co-editing of text. Each is either
presentation the phone does not need, a rewrite of the square-grid engine, a
second way to do a job the engine does, or a licensing or hosting business
this project is not.

---

## 18. Sources

Foundry: foundryvtt.com knowledge base articles (scenes, walls, lighting,
tokens, scene regions, journal, playlists, cards, roll tables, users,
combat, dice, macros, chat, tiles, measurement, adventure, keybinds,
audio-video, drawings, map notes, compendium, active effects, ambient
sound), release notes 11.299 to 13.341, dnd5e wiki and 4.0 to 6.0 release
notes, package pages for the modules named in section 9 of the parity
audit plus Midi-QOL, Sequencer, JB2A, Automated Animations, Item Piles,
Levels, Token Action HUD, Simple Calendar, Dice So Nice, Token Magic,
FXMaster, Monk's modules, Forien's Quest Log, Better Rolltables, Theatre
Inserts, DAE, Tokenizer, Convenient Effects, DDB Importer, Health Estimate,
Encounter Stats, Times Up, Polyglot, Pixels.

Other VTTs: wiki.roll20.net (Jumpgate, Beacon, Charactermancer, Compendium,
Explorer Mode, Jukebox), blog.roll20.net (Jumpgate updates, Dungeon Scrawl
May 2026), help.roll20.net (Reserve, Transmogrifier, Demiplane),
fantasygrounds.com press kit and forums, extensions.owlbear.rodeo,
blog.owlbear.rodeo, talespire.com FAQ and symbiote docs, alchemyrpg.com,
shardtabletop.com, AboveVTT store page, dndbeyond.com Maps and Sigil posts,
lets-role.com, menyr.nogstudio.com, questportal.com features and
assistant, playrole.com, arkenforge.com, encounter.plus, rptools.net,
tabletopsimulator API, astraltabletop shutdown notice.

World building: worldanvil.com feature pages, kanka.io features and API
docs, legendkeeper.com features and FAQ, campfirewriting.com, phd20 plugin
guides, donjon site index, chronica.ventures, scabard.com, Azgaar wiki,
Watabou itch pages, dungeonalchemist.com, dndbeyond.com encounter builder,
koboldplus.club, tetra-cube.com, rolladvantage.com, kenku.fm,
syrinscape.com FAQ and Online, tabletopaudio.com SoundPad, avrae.io,
fantasy-calendar GitHub, slyflourish.com eight steps and safety tools,
daggerheart.com session zero, thealexandrian.net node-based design.

AI game masters: arcanumrpgs.com reviews of Friends & Fables, Voyage and
Hidden Door, dungeonsdeep.ai comparisons, roleforge.ai features, TechCrunch
on Voyage (2026-04-21), sagabound.com, myarchivist.ai, tabletoparc.com,
foundryvtt.com packages foundry-ai, intelligent-npcs, aide,
foundry-familiar, legend-lore, familiarvtt.com capabilities.

Editor look and feel: foundryvtt.com articles on controls, player
orientation, canvas layers and the v10 text editor, release 13.333, the
dnd5e compendium browser wiki and sheet pull requests; Encounter Library and
the Dungeondraft encyclopaedia gitbook; Inkarnate reviews at Dungeon
Goblin and Thread of Souls, the Inkarnate feedback board; Dungeon Alchemist
reviews at Pixel Bandits, Thumb Culture and KeenGamer; the Azgaar and
Wonderdraft wikis; Roll20's toolbar redesign wiki page and forum thread;
Owlbear 2.1 and 2.2 release notes and the fog docs; Tales Tavern guides
for TaleSpire; Alchemy's gamemaster orientation and the Czepeku scene
guide; World Anvil blog posts on the visual editor, maps, timelines and
whiteboards; Kanka blog posts on Maps v4, the Tiptap editor and bulk map
actions; LegendKeeper 101 and the boards announcement; Campfire reviews at
Kindlepreneur and Mythic Scribes; Obsidian Canvas and Leaflet guides; D&D
Beyond Maps and homebrew tutorials; the Homebrewery editor redesign notes;
Arcweave's UI quick tour; Dungeon Scrawl's 2025 review and May 2026 post.

Blocked fetches, relied on secondary sources: roll20 help center and wiki
(403), Owlbear docs (403), AI Realm home (403), World Anvil home (403),
Levels and Wall Height wikis (rate limited).
