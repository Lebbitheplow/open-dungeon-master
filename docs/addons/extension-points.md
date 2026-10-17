# Extension points

An addon changes the app only through these. Each has a contract: the
arguments the server sends the addon's MCP tool, and the result it accepts
back. The server checks every result against the same rules its own features
use and writes it through its own code. An addon never writes the database,
never reaches a player's session, and never acts on the rules engine directly.

Contract version 1 (`"apiVersion": 1`). The source of truth is
[`src/lib/addons/contracts.ts`](../../src/lib/addons/contracts.ts) and
[`src/lib/addons/board-bridge.ts`](../../src/lib/addons/board-bridge.ts).

- [Every call](#every-call)
- [Workshop importers](#workshop-importers)
- [Map generators](#map-generators)
- [Board views](#board-views)
- [Asking for a new extension point](#asking-for-a-new-extension-point)

## Every call

Every tool call carries:

```json
{
  "outputDir": "/srv/odm/data/addons/work/5b0e.../output",
  "options": { "detail": "full" },
  "host": { "serverVersion": "0.28.0", "apiVersion": 1, "platform": "linux" }
}
```

- `outputDir` is an empty folder for this run. Anything the result names on
  disk is a plain file name in it (`"bundle.json"`, not a path). The folder is
  removed when the run is collected.
- `options` are the contribution's option fields, normalized (see
  [authoring.md](authoring.md#settings-and-options)).
- Results: `structuredContent`, or a text block holding JSON. `isError: true`
  with a text block is a failure shown to the DM in your words.
- Report progress (`notifications/progress`) at least every few minutes.

## Workshop importers

**Where:** Import with an addon, on the workshop shelf and in a workshop's
hub. **Who:** anyone who may create a workshop.
**Result:** a workshop bundle, previewed, then imported as a new workshop.

```json
"workshopImporters": [{
  "id": "rulebook",
  "title": "Rulebook PDF",
  "description": "Reads a rulebook PDF you own and builds a workshop of its monsters, spells and items.",
  "tool": "import_rulebook",
  "accepts": [".pdf", "application/pdf"],
  "maxInputMB": 400,
  "options": [{ "key": "pages", "label": "Pages to read", "type": "text", "default": "" }]
}]
```

The file is uploaded in pieces (so a 300 MB book is fine) up to `maxInputMB`
(at most 2048) and handed over on disk:

```json
{
  "input": { "path": "/srv/odm/data/addons/work/5b0e.../input/Monster Book.pdf", "name": "Monster Book.pdf", "mime": "application/pdf", "bytes": 48210443 },
  "outputDir": "...", "options": { "pages": "" }, "host": { ... }
}
```

Return one of:

```json
{ "bundleFile": "bundle.json", "notes": ["Pages 1 to 6 are art and were skipped.", "3 stat blocks had no attack bonus; check them."] }
{ "bundle": { "kind": "odm.workshop", "version": 1, "manifest": { ... }, "monsters": [ ... ] }, "notes": [] }
```

`bundle` inline is for small results (up to 8 MB); write anything larger to a
file (up to 256 MB). **Pictures go in files**: anywhere the bundle takes a
picture (`portrait`, `image`, `backdrop`) or a map's board view file (`data`
under `addonView.files`), write `"file:<name>"` for a file you wrote to
`outputDir` (`"file:art/bog-hag.png"`) instead of a data URL. The server reads
each one in (a picture is PNG, JPEG or WebP up to 8 MB; a view file a `.glb`
or a picture), so a whole adventure's art comes through without an enormous
JSON file. The bundle is a workshop bundle exactly as the app exports one: the format is [`src/lib/workshop/bundle-schema.ts`](../../src/lib/workshop/bundle-schema.ts),
and the quickest way to learn it is to export a workshop from the app and read
the file. What a rulebook importer typically fills:

| Key | Holds |
|---|---|
| `monsters` | `{ name, desc, stats: { ac, maxHp, cr, size, type, speed, attacks: [{ name, toHit, damage: "2d6+3", type: "slashing" }], traits: [...] } }`. Damage must be a dice expression the table can roll |
| `homebrew` | Items, spells, feats, species, backgrounds and subclasses: `{ kind: "spell" \| "item" \| "feat" \| "race" \| "background" \| "archetype" \| "hazard", name, data }`, normalized per kind on import |
| `lore` | `{ category, title, body, visibility: "party" \| "dm" }`: setting text, the book's chapters as reference |
| `npcs`, `locations`, `encounters`, `tables`, `maps` | When the book has them. An adventure's battle maps go in `maps`, with the picture as `backdrop` and the walls, doors and water as `terrain` (the [map generator](#map-generators) table explains the alphabet) |
| `manifest` | `name`, `blurb`, `inspiredBy`, `rightsHolder`. Missing ones are filled from the file name, but set them: `inspiredBy` is the book's title and `rightsHolder` its publisher, which the preview shows in its notice |

The server fills in `kind` and `version`, then reads the bundle with the same
reader a bundle file goes through (every field, length and array size), and
shows the DM the preview: counts, warnings, your `notes`, and ticks for each
kind. Nothing is created until they press Import.

**Building a rulebook importer.** Read text and layout locally (pdf.js,
PyMuPDF, pdfplumber; OCR for scans), report a page at a time, find stat blocks
and spell entries by their layout, and use [sampling](authoring.md#asking-the-storyteller-sampling)
to turn the prose of each into fields. Published names matter: a spell called
*Fireball* is always the published Fireball at a table, whatever a homebrew
entry under that name says. Leave out entries the app already has (the SRD's)
and give genuinely new entries names of their own. The importer reads a book its user owns, on their
own server, for their own table: it must never send the book anywhere, and an
addon must never ship any book's content itself ([guidelines](guidelines.md#content-and-rights)).

## Map generators

**Where:** Build a map with an addon, in the map library (a workshop's Maps,
and the DM's map drawer at the table). **Who:** whoever has prep authority
over the campaign or workshop. **Result:** a new prepared map in that library.

```json
"mapGenerators": [{
  "id": "blender",
  "title": "3D dungeon",
  "description": "Builds the room in Blender: a painted top-down picture for the board and a 3D model for the 3D view.",
  "tool": "generate_map",
  "options": [{ "key": "style", "label": "Stone", "type": "select", "default": "granite", "choices": [ ... ] }]
}]
```

Arguments:

```json
{
  "request": { "name": "Echo Cave", "width": 24, "height": 18, "theme": "cave", "ambient": "dim", "summary": "a flooded crypt with two ways in", "seed": 2934810 },
  "outputDir": "...", "options": { "style": "granite" }, "host": { ... }
}
```

`theme` is one of `cave`, `forest`, `swamp`, `riverside`, `interior`, `field`;
`ambient` is `bright`, `dim` or `dark`; `width` and `height` are squares (5 feet
each), 4 to 200; `summary` is the DM's own words and may be empty.

Result:

```json
{
  "map": {
    "name": "Echo Cave",
    "width": 24, "height": 18,
    "terrain": "########....~~..##...",
    "theme": "cave", "ambient": "dim", "outdoors": false,
    "lights": [{ "x": 5, "y": 7, "brightRadius": 2, "dimRadius": 4 }],
    "notes": "Two ways in: the stair at the north, the drain at the east.",
    "tags": ["cave", "water"]
  },
  "backdrop": { "file": "render.png", "transform": { "offsetX": 0, "offsetY": 0, "scale": 1, "opacity": 1 } },
  "view": { "data": { "camera": { "pitch": 55 } }, "files": ["scene.glb", "floor.webp"] },
  "notes": ["Rendered in 41 s."]
}
```

- **terrain is the rules.** One character per square, row by row,
  `width * height` of them, from the terrain alphabet:

  | Char | Square | Rules |
  |---|---|---|
  | `.` | floor | open |
  | `#` | wall | blocks movement and sight |
  | `~` | water | swimming (doubled cost without a swim speed) |
  | `,` | difficult | doubled cost |
  | `+` | door | a door the DM can open, lock or hide |
  | `\|` | low wall | blocks movement, not sight; half cover behind it |
  | `^` | climb | climbing (doubled cost without a climb speed) |

  Movement, sight, cover and fog read nothing else. A wall in your model that
  is not a `#` in the terrain is decoration a creature walks through; make
  them agree.
- **backdrop** is the picture under the grid: PNG, JPEG or WebP, up to 8 MB,
  top-down and covering the whole map edge to edge (render orthographic, with
  the camera square over the grid; a whole number of pixels per square keeps
  it in register). The board draws it only inside explored squares. Every
  browser and app shows it, so it is also what a server without your board
  view sees.
- **view** is for your own board view: `data` up to 256 KB as JSON, and up to
  8 `files`, each `.glb` (binary glTF, up to 64 MB) or a picture. They are
  stored with the map, carried onto the table when the DM deploys it, copied
  with the library into a campaign, carried inside workshop bundles, and
  handed only to your addon's board view.

The server checks the terrain (alphabet and length), the lights (on the map),
each picture by its bytes and each model by its glTF header, then adds the map
to the library, where the DM can edit it, deploy it to the table, or open it
as a scene.

**Building a 3D map generator.** Blender runs headless: declare it in
`requires` (with a `path` setting for the admin), run
`blender --background --factory-startup --python build.py -- <args>` from your
program, and keep its output off your stdout. Build the scene from your own
layout and derive the terrain from it, or start from a terrain you generate and
model to it; either way the terrain string and the model must describe the same
room. Render the backdrop with an orthographic camera looking straight down,
export the scene with `bpy.ops.export_scene.gltf(export_format="GLB")`, and
report progress per stage. Put the units in `view.data` (one Blender unit per
square is the natural choice) so your board view can line the model up with the
grid.

## Board views

**Where:** the board's View switch, at the table and in the enlarged
tabletop, for everyone who opens the board in a browser or the desktop app.
**Result:** your page draws the board, with every layer the flat board draws
and its moments as they happen; taps come back to the table. A view changes
how the board looks, never what the rules do: an isometric pixel-art table, a
3D one with models and animation.

```json
"boardViews": [{
  "id": "table3d",
  "title": "3D",
  "description": "The board as a 3D table.",
  "entry": "ui/index.html",
  "needsViewData": true
}]
```

`needsViewData: true` offers the view only on maps your own generator made;
`false` offers it on every board (a view that builds its scene from the
terrain alone). The page and everything under `ui/` are served at
`/api/addons/<id>/ui/...`.

`options` are fields each viewer sets for their own device, drawn by the
table behind an **Options** button beside the View switch and kept on that
device (your frame cannot keep anything itself: its storage is sandboxed
away). They arrive in the snapshot as `options`, held to the fields with
defaults filled in:

```json
"options": [
  { "key": "pixelScale", "label": "Pixel size", "type": "select", "default": "2", "choices": [{ "value": "1", "label": "Fine" }, { "value": "2", "label": "Chunky" }] },
  { "key": "quality", "label": "Quality", "type": "select", "default": "high", "choices": [{ "value": "low", "label": "Low, for a slower computer" }, { "value": "high", "label": "High" }] }
]
```

### The frame

Your page runs in `<iframe sandbox="allow-scripts">`: an opaque origin, no
cookies, no access to the page around it, no popups or navigation. Its
response headers add a policy of its own: scripts, styles, pictures, fonts and
workers from your `ui/` folder (and inline, and `blob:`), WebAssembly allowed,
connections to this server only (which, without a cookie, means its public
files). Bundle your libraries (three.js and its GLTFLoader, say) into `ui/`;
nothing can load from a CDN. Keep the page self-contained: it must work with
no network beyond your own files.

Godot single-threaded Web views may ship their `.pck` resource pack beside
`.wasm`/JavaScript in `ui/`. Packs use `application/octet-stream`; `.wav` UI
audio uses `audio/wav`. Existing size limits and sandbox policy apply.

### Messages

Every message carries `odm: 1`. The page posts to `window.parent` with target
`"*"` (its own origin is opaque), and listens for messages whose `source` is
`window.parent`.

From the table to your page:

```js
{ odm: 1, type: "snapshot", snapshot }                              // on load and on every change
{ odm: 1, type: "file", requestId, ok: true, name, mime, bytes }    // bytes is an ArrayBuffer
{ odm: 1, type: "file", requestId, ok: false, name, error }
{ odm: 1, type: "fx", events }                                      // effects as they land, each once
{ odm: 1, type: "ping", x, y, focus, at }                           // somebody pointed at a square
{ odm: 1, type: "camera", mode: "pull" | "lock" | "free", x, y, zoom } // the DM steering everyone's view
```

An effect is `{ id, kind, from, to, fromTokenId, toTokenId, outcome,
outcomes, damageType, ranged, amount, shape, label, state, at }`: `kind` is
`attack`, `spell`, `heal`, `condition`, `death`, `door` and the like; `to` is a
square or, for an area, a list with `outcomes` beside it; `shape` is a spell's
area (`{ kind: "sphere" | "cone" | "line" | "cube", sizeFeet, tiles }`);
`amount` is there only when this viewer may see the number. The table plays
the sound. Draw the swing, the bolt, the burst; the snapshot that follows has
the result.

From your page to the table:

```js
{ odm: 1, type: "ready" }                          // send once your listener is attached
{ odm: 1, type: "tile", x, y }                     // a tap on a square
{ odm: 1, type: "token", tokenId }                 // a tap on a figure
{ odm: 1, type: "hover", x, y }                    // or { x: null, y: null } when the pointer leaves
{ odm: 1, type: "file", requestId, name }          // "backdrop", or one of snapshot.view.files[].name
{ odm: 1, type: "face", requestId, tokenId }       // the picture the figure wears on the flat board
{ odm: 1, type: "anchors", tokens }                // where you drew each figure (below)
{ odm: 1, type: "error", message }                 // shown to the viewer under the board
```

Files in your asset library load straight from `snapshot.assetsUrl`
(`fetch(snapshot.assetsUrl + "tiles.png")`, or a loader given that address);
the `file` message is for the map's own files, which are private to the
table.

A tap is exactly a tap on the flat board: the table decides what it means
from what the viewer is doing (moving, aiming a spell, targeting, pointing,
the DM placing or teleporting) and the server decides whether it is allowed.
Your view cannot do anything a click on the grid could not. What a tap opens
(a figure's ring of actions, its plate) is the table's own and appears over
your frame. Tell the table where you drew each figure, as fractions of your
frame (`[centre across, top, bottom]`, so `[0.5, 0.4, 0.5]` is a figure in the
middle), and the ring and plate open on it:

```js
{ odm: 1, type: "anchors", tokens: { "tok-1": [0.42, 0.31, 0.38], "tok-2": [0.61, 0.52, 0.6] } }
```

Send it after you draw, and again when the camera or a figure moves (not
every frame when nothing changed). Without anchors they open where the figure
stands on the flat grid. The enemies' intent arrows are yours to draw: the
table hides its own over a board view.

### The snapshot

```js
{
  bridge: 1,
  mapId, width, height,
  terrain,          // row-major, one char per square; unexplored squares are spaces
  legend,           // { ".": "floor", "#": "wall", ..., " ": "unexplored" }
  theme, ambient, outdoors,
  skin, genre,      // optional public skin binding and campaign setting
  visible,          // square indexes this viewer sees now
  explored,         // square indexes this viewer has seen
  fullVision,       // true for the DM's view (no fog)
  tokens: [{
    id, kind: "pc" | "enemy" | "npc" | "prop", name, x, y, size, mine, down, hidden, elevation, health, conditions, stamp,
    creature,       // a monster's { type: "undead", slug: "ghoul", cr: 1 }, or null
    character,      // a character's { race: "elf", class: "wizard" }, or null
    auras,          // [{ radiusFeet, tone: "ward" | "harm" | "bless" | "neutral" }]
  }],
  lights: [{ x, y, radius }],
  turn,             // { tokenId, round } or null
  round, turnName,
  board,            // "fight" or "scene"
  myTokenId,
  reachable,        // squares this viewer's figure can reach this turn
  zones,            // spell areas: [{ id, spell, caster, tone, look, cells, hot, label, untilRound }]
  labels,           // [{ x, y, text, dmOnly }] pinned to squares
  marks,            // what people drew: [{ id, kind: "stroke" | "arrow" | "rect" | "ellipse", tone, points: [{ x, y }] }]
  intents,          // what each enemy means to do: [{ tokenId, verb, targetTokenId, expected, stale }]
  targets,          // who attacked whom this round: { tokenId: [tokenId, ...] }
  doors,            // the DM's view only: { "x,y": "locked" | "secret" }, else null
  hasBackdrop,
  view,             // { data, files: [{ name, type, bytes }] } from your own generator, or null
  assetsUrl,        // where your asset library is served, ending in "/"
  options,          // this viewer's choices for your view's options, e.g. { pixelScale: "2" }
  viewer: { canDirect },
  appearance: { theme: "night" | "day", reducedMotion, audio: { muted, volume } /* optional */ }
}
```

Optional API-v1 board presentation fields: `snapshot.skin` forwards the existing
player-safe skin ID/material bindings; `genre` identifies the campaign setting.
`appearance.audio` contains only `{ muted, volume }` from global user controls.
Older addons may ignore these additions; missing audio preferences should mean
silence. These fields grant no session, file or gameplay authority.

`creature` and `character` are for a view that draws figures by kind: a
skeleton model for `undead`, a sprite by `slug`, a robe for a `wizard`. A
zone's `look` says how the flat board draws it (`wall` a band, `cloud` a soft
fill, `ground`, `light`, `dark`, `ward` a tint with an edge) and `hot` is a
wall of fire's burning side.

Square `i` is at `x = i % width`, `y = floor(i / width)`. The snapshot is the
projection the server made for this viewer: a hidden enemy is absent from a
player's snapshot, and unexplored squares are blank. **Draw nothing outside
`explored`**, and dim what is explored but not `visible`. The model file is
the whole map, so the same rule applies to it: show only the parts over
explored squares, as the flat board does with its picture.

Respect `appearance.reducedMotion` (no camera swoops, no idle animation), keep
the frame light (it shares the device with the rest of the table), and stop
rendering when nothing changes.

The [example's board view](../../examples/addons/hello-dungeon/ui/board.js)
is a working isometric renderer in plain canvas: a floor texture from its
asset library, spell areas, labels, intents, effects and pings, and anchors.
It shows each message in use.

## Asking for a new extension point

Addons cannot reach anything that is not on this page, by design. If an addon
needs to change something else (the AI DM's tools, the character builder,
encounters, narration), open an issue on the server repository describing what
the addon would do, what it would read, and what it would hand back. A new
extension point is added to the server with its own contract, checks and tests,
in a release, and documented here; the contract version goes up only when an
existing contract has to change.
