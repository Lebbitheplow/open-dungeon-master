# Workshop prep across bundles, workshops and campaigns

What survives each step between writing prep in a workshop and using it at a
table, and what the storyteller can actually reach once it is there. Written
for #158, alongside the fixes for #153 to #159. The checks behind every row
are `scripts/test-workshop-dependencies.mjs` (the whole path, end to end) and
`scripts/test-prep-authority-routes.mjs` (who may hold and use the prep).

## The stages

1. **Workshop.** Where prep is written: lore, places, NPCs, factions, prepared
   fights, roll tables, battle maps, the region map, the storyboard.
2. **Bundle.** `Share this workshop` writes one `odm.workshop` file. Every
   reference between rows is written as an index into the bundle's own
   arrays, never as a database id.
3. **Imported workshop.** `Open a bundle` always creates a new workshop. The
   indexes become the ids of the rows that were just written.
4. **Campaign import.** `Bring it in` copies the ticked kinds into a campaign
   (src/lib/db/content-import.ts). It copies every column of a row except the
   ones listed with a reason in `COPY_OVERRIDES` (src/lib/db/content-copy.ts).
   Every reference is remapped to the copy, and each copy records where it
   came from (src/lib/db/content-origins.ts).
5. **At the table.** The human DM uses the DM console. At an AI-narrated
   table the party lead uses the lead's desk, and the storyteller uses its
   game state and tools.

In the tables below, **link** means a resolved reference to a row: the
server follows it, it survives renames, and it drives behaviour. **Prose**
means the words only. **No** means not carried, with the reason.

## Records

| Record | Bundle | Campaign import | Human DM | AI storyteller |
| --- | --- | --- | --- | --- |
| Lore (title, body, tags, pinned, secret, style, picture) | Yes. An attached PDF stays behind. | Yes, every column. Re-embedded. | Binder | Retrieved by relevance. Pinned entries always included. Secrets marked SECRET. |
| Places (layout, connections, map, sound) | Yes | Yes. Visited and current reset. | Places panel. One-tap deploy of its map. | Current location, and as waypoints |
| NPCs (traits, agency, relations, face, voice, faction) | Yes, except archived NPCs | Yes. Bonds and arc cast reset. Archived stays archived. | Cast | Tracked NPCs (up to 20) |
| Factions | Yes, with members by name | Yes, with every member's link | Factions panel | Factions block |
| Prepared fights (roster, battlefield, notes, map settings, extras) | Yes. Extras are placements, entry, hidden enemies, overrides, rewards and phases. | Yes. A cue resets. | Deploy | Listed (up to 8, cued first). Started by name with `run_prepared_encounter`, with map and plan. |
| Roll tables (entries, without replacement) | Yes | Yes. What was drawn resets. | Tables panel | Through its roll tools |
| Market shops (kind, size, place, keeper, shelf, prices, notes, markup, buying, restock days) | Yes. New since #171. Who haggled and when it last restocked stay behind. | Yes, as the `Market` tick. It starts from the shelf its author wrote, nobody has haggled, and its restock cycle starts on arrival. | Market tab: open, edit the shelf line by line, restock now | SHOPS HERE at the party's place. `open_shop` reopens a shop that stands there as it is. |
| Battle maps (terrain, lights, backdrop, skin, doors, labels, props, zones, drawings, overlay, sound) | Yes | Yes, every layer | Map library | Through a prepared fight's or a place's map |
| Region map (terrain, pins, roads, labels, notes, backdrop, anchors) | Yes. New since #158. | Yes. Replaces the target's, as the preview warns. | Region panel | Travel tools |
| Storyboard cards | Yes, with picks, arrows and routes | Compiled, see below | | |
| House rules and variant flags | Yes, as one tick | Yes, as one tick | | Rules retrieval |
| Hand-built monsters and homebrew | Yes. Your own entry of the same name wins. | Not a campaign kind. They live on the owner's shelf. | | Resolved by slug or name for the owner |
| World pack draft | Yes. It was dropped by every UI import before #158. | No. It is a workshop tool. | | |

## Relationships

| Relationship | Bundle | Imported workshop | Campaign import | At the table |
| --- | --- | --- | --- | --- |
| Fight drawn on a map | Index | Link | Link to the map's copy. Unbound, with a warning, when the map is not coming. | Deploy and the storyteller lay it down |
| Place stands on a map | Index | Link | Same as a fight | One-tap deploy |
| Region map anchors a place | Index | Link | Link to the place's copy, or the place re-placed | Markers |
| Shop stands at a place | Index, plus the place's name | Link | Link to the place's copy. Unplaced, with a warning, when the place is not coming; it still opens at a place of that name. | SHOPS HERE |
| Shop kept by an NPC | Index | Link | Link to the NPC's copy. No keeper, with a warning, when the NPC is not coming. | Named in SHOPS HERE |
| NPC belongs to a faction | Members by name | Link | Link | Faction standing |
| NPC relations | By name | By name | By name | Agency model |
| Card picks Who | Index | Link | Waypoint (npc) on its beat or moment | Ticked when the storyteller meets them |
| Card picks Where | Index | Link | Waypoint (place). On a place card, binds the place's map. | Ticked on arrival |
| Card picks a fight | Index | Link | The fight's copy, roster and all. No empty duplicate. Waypoint (fight). | Ticked when that fight ends. Run by name. |
| Card picks a map | Index | Link | On a fight card, binds an unbound fight. On a place card, binds the place. | Through the fight or place |
| Arrow "then" | Index | Link | Order of the arc's beats | Beats in order |
| Arrow "one route of several" | Index plus route | Link plus route | The route becomes a planned moment with its condition. Routes rejoin where they meet. | Moments the storyteller fires or drops |
| Arrow "only if" | Index plus route | Link plus route | The scene becomes a planned moment with its condition | Same |
| Roster names a hand-built monster | Monster rides along | | Resolves only for the same owner, as the preview warns | |

### What a card becomes in a campaign

- **Place, What happened before:** a lore entry.
- **Something happens, Somebody's moment:** a beat when the plain arrows
  reach it from the start of the board. Otherwise it is a planned moment.
- **A fight:** the fight it picks, or an empty fight named for the card. It is
  also a beat or a moment when arrows run through it. A fight card with no
  arrows stays prep only.
- **A reason to go:** a quest in the Quests panel. The storyteller reads that
  log; before #158 these quests went to an older log it ignored whenever an
  arc existed.
- **Something hidden:** a DM-only note. The storyteller now reads these
  notes as DM prep notes. Before, a secret was invisible at an AI-narrated
  table.

### Not carried

- **A pick on a reason-to-go or something-hidden card.** A quest and a note
  carry words only. The preview counts these picks.
- **A map picked on a scene that is not a fight or a place.** Nothing at the
  campaign end binds a map to a scene.
- **The faction of a shared NPC in a chapter bundle.** The faction belongs to
  the shared workshop.

## Shared workshops (#159)

A chapter workshop can draw on one shared workshop (the storyboard's
`Shared workshop` card). Its storyboard pickers then list the shared
workshop's cast, places, maps and fights after the chapter's own, marked
`(shared)`.

- **Live, not pinned.** A card's pick is the shared row itself, so a rename
  shows on every chapter. A deleted shared row, or a detached shared
  workshop, shows as **missing** on the card. A save drops the missing pick.
- **One level.** A shared workshop cannot draw on another. A workshop that
  chapters draw on cannot start drawing on one.
- **Yours only.** Both workshops belong to the same owner.
- **Campaign imports.** Whatever a chapter's cards pick from the shared
  workshop is copied into the campaign the first time, then reused by every
  later chapter. The shared workshop can still be imported directly. Rows
  already brought in are kept as the campaign has them. Lore, tables, rules
  and factions travel through that direct import, not through a chapter.
- **Bundles.** A chapter bundle carries the shared rows its cards pick,
  marked `shared`, plus the shared workshop's name, so it stands on its own.
  Every linkable row carries a `ref`, a key that stays the same across
  exports. If the importer already has a workshop holding those refs (they
  opened the shared workshop's bundle first), the preview offers to link to
  it. The chapter then draws on it and nothing is duplicated. Otherwise the
  shared rows land as the chapter's own.

## Importing again

- **Kept by default.** Rows an earlier import brought from the same source
  are kept as the campaign has them, edits included. `Bring second copies`
  numbers them instead. The preview counts both.
- **Boards.** A second import of the same board does not repeat its lore,
  fights, notes or quests.
- **Shops.** A shop an earlier import brought keeps its played shelf, its
  prices and its haggles. A later chapter's own shops arrive beside it.
- **Restocks.** A shop with a written shelf refills that shelf on its restock
  day, and keeps what the party sold the keeper. A shop stocked from the pack
  rerolls from the pack, and keeps its shelf on a server without one.
- **An arc already exists.** The board's beats are left alone by default.
  `Add them as act N` appends them after the beats already played, and skips
  beats the arc already has. Played and skipped beats, their details and the
  recapped acts are never touched. A sketched saga act becomes this act.

## Who may use the prep

- **Human DM table.** The DM seat holds the prepared fights and the map
  library. The lead is a player there.
- **AI-narrated table.** The party lead holds them, from the lead's desk
  (`Prepared fights and maps`), and the Market's shops and shelves from the
  Market tab (#171). This uses the same rule that lets the lead
  import prep (`requirePrepAuthority`, src/lib/campaign-api.ts).
  - The lead **cues** a fight rather than deploying it. A cue is a private
    flag, not a transcript line, so the players never read the fight's name.
  - The storyteller sees cued fights first and starts them with
    `run_prepared_encounter`.
- **Everyone else** is refused, at both kinds of table.

## Release checklist for authors

1. Open the board of every chapter. No card should show a **missing** pick,
   and the "What this becomes" card should read the way you expect.
2. Every fight a card picks has a roster, and its map if it should have one.
3. Export the shared workshop, then each chapter. Read each export's warnings:
   images left behind, and links that point nowhere.
4. On a clean account, open the shared workshop's bundle first, then each
   chapter's. Choose `Link to my "<shared>"` and confirm it found every
   record.
5. Make a throwaway campaign. Bring in the shared workshop, then chapter one
   with its board, then chapter two with `Add them as act 2`. Read every
   warning and note in each preview before pressing the button.
6. In the campaign, check:
   - the Quests panel has the board's quests;
   - the arc has its acts;
   - prepared fights have their rosters, maps and rewards;
   - the cast has no numbered duplicates.
