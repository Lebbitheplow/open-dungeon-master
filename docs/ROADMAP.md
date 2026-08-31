# Roadmap

## Delivered

**Phase 1 (2026-07-17):** fork foundation. Accounts, campaigns with invite
codes and lobbies, structured SRD 5.1 character sheets, the server-side
dice engine, the SSE real-time layer, and the AI Dungeon Master tool loop
with server-enforced rolls.

**Full-vision build (2026-07-17):**

- Open5e content pack (1,435 spells, 107 subclasses, 2,047 items, 3,207
  monsters, 54 races, 42 backgrounds, 74 feats) in a read-only content DB,
  with per-user homebrew entries merged into every picker and a /licenses
  attribution page. See docs/content.md.
- Per-user character library (characters saved to the profile, reusable
  across campaigns via copy-on-instantiate with level adaptation; durable
  progression syncs back on campaign end or on demand).
- Full creation wizard: point buy / standard array / rolled stats, Open5e
  races, subclasses, backgrounds, searchable spell/equipment/feat pickers.
- Campaign settings: genre presets (high fantasy, dark fantasy, mystery,
  horror, cyberpunk, steampunk, post-apocalyptic, custom) with per-genre DM
  flavor and map art style; AI story setup (secret DM outline); dice
  policy; TTS voice; maps toggle; invite links (/join/CODE); live
  owner-editable settings in the lobby.
- Turn/floor control: request_player_input spotlight tool, server-enforced
  composer locking, owner override.
- Real dice mode: per-player opt-in; rolls park the persisted DM-turn state
  machine (dm_turns/pending_rolls, survives restarts) until the player
  enters their physical dice; digital fallback button.
- DM stat authority: apply_damage, heal, award_xp (with level-up flow),
  modify_gold, grant/remove_item, set/clear_condition, use_spell_slot; all
  server-clamped, audit-logged (sheet_audit), live in the session Log tab.
- Locations and maps: move_party/update_location tools keep structured area
  state in GAME STATE; ComfyUI renders genre-styled top-down maps on a
  serial media queue when vision allows; Map tab with history + owner
  redraw.
- Voice: push-to-talk via local faster-whisper (odm-stt.service :8870,
  confirm-then-send) and Kokoro TTS narration per campaign voice with
  per-user mute/volume and replay.
- Memory: record_event tool + compaction-time extraction feed per-character
  "story so far" on the profile and recent developments in GAME STATE;
  "Previously..." recap after 6h idle.

**Human-DM mode, phase 1:** a campaign can be created with a person in the
Dungeon Master seat (`dmMode` setting plus `campaigns.human_dm_user_id`).
The DM runs no character, holds no party slot, sees enemy hit points and an
unfogged battle map, and writes narration through `POST /dm/narrate`; player
actions queue for them instead of waking an AI turn. Who may see and do what
is decided in one pure module (`src/lib/dm/viewer.ts`), and story authority
(the secrets, the floor, the arc) follows the seat: the party lead in an
AI-run campaign, the DM in a human-run one. Phases 2 to 7 are built on top:
the adjudication console and roll modes, story capture, the assist rail and
roll tables, the map studio and prepared encounters, board handling with
hidden tokens, initiative editing, pings and measured templates, and assisted
mode, where a DM hands the AI the monsters, has a written beat said to the
table in full, or hands over a counted stretch of answers while they step
away. Phase 8 is the cross-cutting engine work that improves AI mode as much
as human mode: active effects with real durations, an in-world calendar and
clock, the party as an entity with its own purse and pack, coins in more than
one denomination, unidentified items, mounted combat, structured non-combat
scene trackers, freeform typed attributes on anything, and the assistant DM
seat. See docs/human-dm-plan.md.

**The Workshop, phases 1 to 9 (2026-08-30):** a user-scoped place to build
prep before any table exists, and to import it into a campaign. A workshop is
a `campaigns` row with `kind = 'workshop'`, so every content table, route
guard and panel serves it unchanged and importing is a row copy between two
campaign ids; what separates it is that it never plays, which
`scripts/test-workshop-isolation.mjs` and
`scripts/test-workshop-integration.mjs` assert as negatives. `/workshop` runs
the map studio, the region map, prepared encounters, lore, roll tables and the
rules editor outside a campaign, budgeted against a declared target party
rather than character sheets that do not exist yet. A table's variant rules
and house rulings become one reusable object (`library_rulesets`) that can be
applied to any table or captured back off one. Importing is offered at
campaign creation and again from the lobby, previews what it would overwrite,
and numbers name collisions rather than failing on them. See
docs/workshop-plan.md.

Phase 4 is the maps. The region map was generate-or-nothing since it was
built, and a DM can now paint coastlines, forests and mountain ranges by hand;
the one thing it refuses is a map with nowhere a settlement could stand,
because `placeAnchor` will not put a location on water or a peak, and places
the paint leaves in the sea are named rather than moved. Battle maps gained a
stamp palette (rooms, corridors, caverns, pillared halls, pools, rubble) that
compiles to ordinary brush strokes so every shape is validated by the painter
that already guards the live board, and a backdrop layer: an uploaded or
imported picture drawn under the grid, cosmetic only, hidden by fog exactly
where the terrain is. Universal VTT files (`.dd2vtt`, `.uvtt`) import their
walls, doors and lights as real mechanics rather than as a picture, read
edge-first so a one-tile corridor survives the conversion. And maps now outlive
the encounter they were drawn for: `prepared_maps` is a per-campaign drawer a
DM builds in and deploys from, which is what turns the workshop's map tab into
a builder rather than a preview, and travels into a campaign through the same
import as the rest of the prep. There is no stairs stamp, because the terrain
alphabet has no level change and inventing one would mean a tile the
pathfinder, the fog and the DM prompt all have to learn.

Phase 5 is the cast. `db/npcs.ts` has held a real agency model since it was
built, and every bit of it was reachable only by the AI DM's tool calls: six
personality axes that drift with how the party behaves, a scene goal, a
session goal advanced by background dice, a defining ambition, NPC-to-NPC
relations, aliases. The NPC forge is the form over it, and it sits under a
Cast tab in both the DM console and the workshop. Two things in it are worth
the sentence: an axis is stored as a number and shown as the word it means,
because a DM setting "warmth: 2" is guessing where a DM setting "warm" is
writing a person; and relations are stored per NPC and therefore one-sided by
construction, so the panel says plainly which links are mutual, which are not,
and which name somebody nobody has written yet. Generation is per field, never
per NPC, so a DM can take the model's sense of what somebody wants and throw
away its sense of who they are. NPCs can carry a face now, uploaded or
rendered on the same media queue everything else uses.

The companion library is one column on `library_characters` rather than a
second table, because the level adaptation that lets a stored character join a
table at that table's level is the same work either way. Making that reuse
real meant lifting the adaptation out of the database call it had lived inside
since the character library existed and into `src/lib/characters/adapt.ts`,
unchanged; it is now covered by tests for the first time. A companion written
once can join any table at whatever level it plays at, having given back the
ability score improvements it has not earned there and been handed the spell
slots of the level it is actually playing.

That phase also turned up a bug in phase 3's import: NPC relations were being
dropped along with per-character bonds, on the grounds that both were keyed by
ids the target campaign does not have. Bonds are. Relations are keyed by name,
so a cast imported together now arrives with its feuds intact.

Phase 6 is the bestiary and the calculator. `synthesize.ts` went challenge
rating to stats and nothing went the other way, so a hand-built monster had no
honest difficulty number; `src/lib/bestiary/derive-cr.ts` is the inverse, by
the DMG's own procedure, and it was checked against the SRD rather than
asserted to work: it lands within one rating 79% of the time, and the tests
hold a floor under that so a regression cannot pass quietly. The misses are
monsters whose damage is not in their attack list, and 87% of the badly-rated
ones say so, which is why the editor has a field for the breath weapon or the
round of spellcasting that the rating cannot otherwise see. Monsters are built
into `homebrew_entries` in the exact shape a fight snapshots, so one reaches
the board through the ordinary `start_encounter` path rather than a second
one; the resolver answers to the unambiguous slug first and to a name last, so
a DM's own "Goblin" never changes what an existing campaign means by a goblin.
The workbench puts the XP budget and the shape of the fight on one screen:
adjusted XP against the four thresholds, and how many rounds each side lasts,
with both sides swinging real dice through the same forecast the odds panel
uses, so `powerfulCritical` and `criticalDamageMods` move the numbers the way
they will at the table. Every number links to its parts, and the standing
assumptions are printed rather than buried.

That phase turned up a second bug: a prepared encounter in a workshop was
budgeted against a party of one, because the readout fell back to a single
character at the starting level whenever there were no character sheets, and a
workshop has none by construction. Every prepared fight in a workshop has been
reading far deadlier than it is. There is now one place that answers which
party a fight is measured against.

Phase 7 is the storyboard, the only genuinely new subsystem in the workshop
and deliberately the smallest. Cards for places, history, things that happen,
fights, reasons to go, secrets and somebody's moment, with arrows between
them. The arrows are what make it a board rather than a list: a hook with no
payoff is only detectable if the board knows which way the story runs. What it
suggests is counted, not generated, in the same spirit as the assist rail: a
fight nothing leads into, a secret nothing reveals, an NPC written in the
workshop that nothing on the board uses. Importing compiles the board into
structure that already existed, which is the test the node types were chosen
against: places and history become lore, events and character moments become
the arc's beats in the order the arrows say, hooks become quests, fights
become prepared encounters with the roster left for the DM, and secrets become
DM-only notes. A campaign already running keeps its arc; everything else still
lands, and the import says so before the button rather than after.

Phase 8 grew `/reference` from a player's rules lookup into a DM's research
desk: four modes, of which three are assembly over things that already
existed. Browse gained a house-rules tab that searches the table's own
rulings beside the SRD, through the same chunker and the same scorer the live
turn uses. Compare puts up to four spells or monsters side by side and marks
only the rows that DIFFER, with a monster's derived rating from phase 6 next
to its printed one. The calculators are the five a DM does on paper between
sessions, and they run in the browser because every one of them was already a
pure function; not a line of arithmetic was written for them, and each answer
shows its parts rather than a number. The one genuinely new thing is Ask.
Retrieval runs first and mechanically, the model gets one call with labelled
evidence, and then every citation it returns is checked against what was
actually supplied: a citation naming a source the desk never sent is dropped,
and an answer left with none is marked ungrounded and says so. That check is
what separates "with citations" from decoration, and it is why an ungrounded
chat box over rules text was not worth building.

Phase 9 lets a workshop leave as a file and come back as one. The bundle
reuses the world pack manifest's licensing fields rather than inventing a
second set, so a shared workshop carries the same non-affiliation notice a
pack does. Two refusals define the format more than anything it carries. No
image ever travels: backdrops and portraits stay on disk, maps arrive as
geometry, and the test asserts that structurally so a future backdrop field
fails a test rather than passing quietly. No id travels either, so storyboard
arrows move as indexes and an import always creates a new workshop instead of
merging into an existing one, which deletes the collision problem phase 3 had
to solve. The world pack compile shipped honest rather than complete: a world
pack IS its reskin tables, a workshop holds none, and rather than emit an
empty pack that looks finished it produces the flavour half a workshop does
accumulate and returns the refusals naming what stayed behind and why.

World Anvil, which the workshop plan carried as its own phase, is ruled out.
Its API needs a per-application key that World Anvil issues only to Guild
members above Grandmaster rank, so the phase could not be started by anyone
working on this. The fallback stands: paste or upload an article and file it as
a lore entry.

**Live voice chat (2026-08):** an in-process mediasoup SFU with custom
signaling over the existing REST and SSE stack: one table channel per
campaign, up to eight DM-managed side rooms, and floor-aware turn taking
(open, hold, spotlight, initiative) with soft or strict enforcement and a
raise-hand queue. Optional per-campaign rules make the call behave like the
world: battle-map proximity hearing, whisper/normal/shout say ranges, walls
that muffle, and downed characters going deaf; the DM always hears everyone.
Off by default server-wide (`VOICE_ENABLED`), with an admin tri-state
override; needs HTTPS and one open UDP/TCP port. Voice rooms are in-process
state: a restart ends the call and players rejoin. See docs/configuration.md.

**Ambience and music (2026-08):** a 65-cue catalog in three layers (a bed for
where the party is, music for what the scene does, one-shot stings), driven by
the AI's `set_ambience`/`play_sting` tools, the DM's hand (with per-layer
holds the auto-picker respects), combat following, and scene inference. Per
listener volume and mute, automatic ducking under TTS narration. No audio
ships with the repository: `npm run fetch-ambience` pulls public-domain and
CC recordings (Freesound needs an API key) and the licenses page credits every
installed track.

**Bluetooth and per-die dice sources (2026-08):** on top of the existing
real-dice mode, each opted-in player picks per die shape whether that die is
typed from a physical roll, rolled by the server, or read live from a paired
Pixels Bluetooth die (Web Bluetooth: Chromium plus HTTPS). Rolls auto-submit
once no die needs typing; a disconnected Pixel degrades to typing. Choices are
stored per browser, not per account.

**Audit and hardening pass (2026-08-31):** the cross-cutting sweep after the
human-DM, workshop, voice, ambience and dice batches: the human-DM guard moved
to the one chokepoint every turn request passes, the DM seat made an invariant
of `dmMode`, digital die faces moved server-side, encounter templates able to
reference prepared maps, manual place authoring in the workshop, duplicate
actions on library assets, touch-reachable labels and controls across the new
DM panels, the full test suite wired into CI, and this document brought back
in line with what is actually built.

## Next

- Ruleset validation (`src/lib/rulesets/validate.ts` from the workshop plan):
  checking a monster, map or NPC draft against the selected ruleset is
  deferred; today the ruleset informs the tools but is not enforced at
  authoring time.
- Homebrew monsters travelling with workshop bundles and imports (they are
  user-scoped today, so a prepared encounter that names one imports with an
  unresolvable roster line and a warning).
- Per-account dice-source sync, so a player's Pixels and per-die choices
  follow them between browsers.
- Multiple DM personalities
- Split the solo monolith (src/app/solo/page.tsx) into components
- Remove vestigial mflux/sdnq image backend enum values

## Known limitations

- One Next.js process owns everything: the SQLite database, the event bus,
  the DM turn queue and the voice rooms. Multi-instance deployment is
  unsupported, and a restart drops live voice calls (players rejoin).
- The ambience library ships empty until `npm run fetch-ambience` is run on
  the server; without a `FREESOUND_API_KEY` the best source is skipped.
- Dice-source choices (including Pixels pairings) are per device, and the
  server cannot distinguish a typed physical roll from a typed lie; real-dice
  mode remains a trust feature, as tabletop dice always have been.
- One character per player per campaign
- The Ollama "local" provider (Gemma) calls tools less reliably than the
  OpenAI-compatible path; the default DM model is qwen3.6-dm via Ollama's
  OpenAI endpoint
