# Campaign plugins (world packs)

A world pack is a pre-configured universe a table can pick at campaign creation
instead of a bare genre. Picking one renames what everybody sees, steers the DM,
and nudges the character builder. It does not change a single rule.

A pack is one JSON file. That is the whole plugin format.

## Where packs live

| Directory | Ships with the app | License | Removable |
| --- | --- | --- | --- |
| `src/lib/worlds/bundled/` | yes | the project's MIT license | no |
| `data/worlds/` | no, gitignored | whatever its author says | yes |

This split is a licensing boundary, not a convenience.

**Bundled packs must be original works.** Anything in this repository is covered
by its MIT license, so a bundled pack cannot be built on somebody else's
setting. `scripts/test-world-packs.mjs` enforces that by failing the build if a
bundled pack names a `rightsHolder`. `saltmarch.json` is the worked example:
copy it as the starting point for your own.

**Community packs are installed, never committed.** A pack based on an existing
universe is downloaded from a registry or added from a file through
Admin, Campaign plugins. It lands in `data/worlds/`, which is gitignored, is not
part of this repository, and is not covered by its MIT license.

An installed pack shadows a bundled one with the same id, so you can ship your
own build of a world we bundle. Removing the override falls back to the bundled
copy rather than leaving a campaign without its world.

## The one rule: a pack is a name mapping

A pack never introduces or alters mechanics. It maps canonical ids and canonical
names to display names, and supplies flavor text.

This is not a style preference, it is a correctness constraint. Character sheets
store spells, equipment and features **by name** (`src/lib/schemas/sheet.ts`). If
a pack rewrote "Cure Wounds" to "Curaga" at storage time, `findSpellByName`,
`use_spell_slot`, `spellMechanicsFor` and `FEATURE_EFFECTS` would all miss and the
sheet would quietly break. Keeping the canonical value on the sheet also means a
character built in a pack campaign can be pulled into a plain campaign and simply
renders under its ordinary names.

The DM is told about the mapping through the world primer
(`src/lib/worlds/primer-logic.ts`), which prints an alias table and instructs it
to narrate the world's word but call every tool with the canonical one.

If a world genuinely needs new mechanics, that is a custom class in
`src/lib/classes/` or a homebrew entry, not a pack.

## Attribution and the unofficial notice

Two fields carry the legal framing, and the UI keys off them:

- `inspiredBy` says what the pack is a homage to, in the author's own words.
- `rightsHolder` names who owns the setting being referenced.

Setting `rightsHolder` turns every surface that shows the pack into an explicit
non-affiliation notice (`src/components/UnofficialPackNotice.tsx`):

> **Unofficial community campaign**
>
> This campaign is a fan-created work and is not affiliated with, sponsored by,
> or endorsed by *&lt;rightsHolder&gt;*.

Leaving it empty means the pack is an original world and gets a milder
community-content line instead. **If your pack is built on someone else's
universe, fill it in.** The risk a fan campaign actually runs is not that it
exists, it is that a player could come away thinking the rights holder made it
or blessed it.

Do not paste text out of a published book, wiki, or fan conversion. Write every
blurb yourself. Researching an existing fan 5e conversion to decide *which*
canonical class a concept maps onto is fine; copying its prose is not.

## Franchises with several eras

Final Fantasy VII and Final Fantasy XIV are not the same world, and neither are
Ocarina of Time and Breath of the Wild. Ship one pack per era:

- `franchise` is the group label the picker collapses entries under.
- `edition` is the label of this entry inside that group.
- `editionOrder` sorts entries within the group, so they list in release order.

A franchise with one pack leaves `edition` empty and renders as a single button.
A franchise with more than one **must** label every entry.

## Fields

| Field | Notes |
| --- | --- |
| `id` | lowercase snake_case matching `^[a-z][a-z0-9_]{2,49}$`, and it must equal the filename stem. This is also the install path, so it is validated hard. `index` is reserved, because `index.json` in a pack folder is the registry listing |
| `name` | display title, up to 70 chars |
| `blurb` | one sentence for the picker, up to 200 chars |
| `version` | shown in the browser and used to offer updates. Semver by convention |
| `author` | who made this pack |
| `homepage` | optional link to where it is maintained |
| `inspiredBy` | what it is a homage to, in your words |
| `rightsHolder` | who owns the referenced setting, or empty for an original world. See above |
| `franchise` / `edition` / `editionOrder` | grouping, see above |
| `baseGenre` | one of the eight genres, never `custom`. Selecting the pack also sets the campaign's genre to this, so every existing genre consumer keeps working |
| `dmFlavor` | appended to the genre's own flavor in the DM system prompt. The highest-leverage field: tone, what magic feels like, what the stakes are, what the DM should never do. At least 200 chars |
| `mapStyle` / `portraitStyle` | art-style fragments for map and portrait generation |
| `nameHints` / `raceHint` | one line each, steering the story-setup pass and the companion tools |
| `companionRaces` | SRD race ids AI companions may use; empty means no restriction |
| `theme` | seeds `campaigns.theme`, max 120 chars |
| `premise` | seeds `campaigns.description`, max 500 chars |
| `races` / `classes` / `backgrounds` | `{ id, name, blurb }` reskins. The `id` must be a real id. `classes` also takes `castingLabel`, which must be `null` for a non-caster |
| `spells` / `items` / `features` | `{ from, name, blurb }` reskins, where `from` is the canonical name |
| `monsters` | `{ slug, name, cr, blurb }`, the same shape as a bestiary entry. `slug` must be a real Open5e slug and `cr` must match it |
| `alignments` | codes this world leans on, from LG NG CG LN N CN LE NE CE. The other nine stay pickable |
| `nameSeeds` | `people` and `places`, offered as clickable suggestions in the builder |
| `factions` / `locations` / `hooks` / `glossary` | story elements, rendered into the DM's game-state block |

Empty string or empty array on `dmFlavor`, `mapStyle`, `portraitStyle`,
`nameHints`, `raceHint` and `companionRaces` means "inherit the base genre".

## Valid ids

- **Races**: the 31 ids in `src/lib/srd/races.json`.
- **Classes**: the 13 in `src/lib/srd/classes.json` plus the 36 genre classes in
  `src/lib/classes/*.json`.
- **Backgrounds**: the 13 in `src/lib/srd/backgrounds.json` plus the 36 in
  `src/lib/backgrounds/catalog.json`.
- **Spell and item names**: any real spell or item name, checked against the
  Open5e content pack plus `src/lib/srd/weapons.ts` and `armor.ts`. Watch the
  exact spelling: the armor entry is `Leather`, not `Leather Armor`.
- **Monster slugs**: any Open5e monster slug, with the CR that matches it.

## Size targets

Aim for roughly this per pack. The bundled-pack test enforces the floors in
brackets.

- races 8 to 12 [6], classes 8 to 13 [6], backgrounds 6 to 12 [4]
- monsters 20 to 30 [15], spells 15 to 25 [10], items 10 to 15 [6]
- features 6 to 8, factions 4 to 6 [3], locations 6 to 8 [4]
- hooks 5 to 8 [4], glossary 8 to 12 [6]
- nameSeeds 8 to 12 people and 6 to 10 places [6 each]

## Distributing a pack

A registry is a single JSON file anywhere reachable over https:

```json
{
  "packs": [
    {
      "id": "your_world",
      "name": "Your World",
      "blurb": "One sentence.",
      "version": "1.0.0",
      "author": "You",
      "homepage": "https://example.org/your-world",
      "inspiredBy": "A fan homage to Something.",
      "rightsHolder": "Somebody Inc.",
      "franchise": "Something",
      "edition": "",
      "editionOrder": 0,
      "baseGenre": "high_fantasy",
      "downloadUrl": "https://example.org/packs/your_world.json"
    }
  ]
}
```

An operator points their server at it with the **World registry URL** setting in
Admin, or the `WORLD_REGISTRY_URL` environment variable.

### The default registry

The app ships pointing at a registry of community packs, so a fresh install has
something to browse. Precedence is the Admin setting, then the environment
variable, then that built-in default (`DEFAULT_WORLD_REGISTRY_URL` in
`src/lib/worlds/install.ts`).

Listing is not endorsing. Those packs are built on other people's settings: they
are not distributed with this app, are not covered by its MIT license, and none
of them installs on its own. Browsing shows the listing; an admin still has to
press Install, and every pack with a `rightsHolder` carries the unofficial notice
wherever it appears.

To run your own instead, set the Admin field or the environment variable to your
index. To browse nothing at all, set either to `off`, which leaves installing
from a file as the only route in.

Hosting notes:

- The server fetches the index and the manifests itself, so **CORS does not
  apply**. Any static host works, including ones that would be unusable from a
  browser.
- `downloadUrl` must be **https** and must return the raw JSON, not an HTML
  download page. Bodies are capped at 2MB with a 20 second timeout.
- The index and the manifests do not have to live in the same place.
- Only an admin can install, and a registry install resolves the URL from the
  index rather than from the client, so the set of hosts a server will fetch
  from is exactly the set its own registry names.

Anyone can skip the registry entirely and install a `.json` by hand from
Admin, Campaign plugins, Install from a file.

### Publishing a folder of packs

```bash
node scripts/validate-world-packs.mjs /path/to/packs
node scripts/build-world-registry.mjs /path/to/packs https://your-host/worlds
```

The second command writes `index.json` beside the manifests, with a
`downloadUrl` of `<base-url>/<id>.json` for each. Upload the whole folder to any
static https host and point the registry setting at `<base-url>/index.json`.
Re-run it whenever you add a pack or bump a `version`, since the browser offers
an Update when the registry's version differs from the installed one.

### Hosts with no path pattern

Some hosts give every file its own opaque URL: Google Drive, an object store
with signed links, a paste service. There is no `<base>/<id>.json` to build, so
pass an explicit mapping instead:

```bash
node scripts/build-world-registry.mjs /path/to/packs --urls urls.json
```

where `urls.json` is `{ "<pack id>": "<https download url>" }`. The builder
fails loudly if a pack has no URL in the mapping.

For Google Drive specifically, a file's direct URL is
`https://drive.google.com/uc?export=download&id=<file id>`, which returns the
raw bytes rather than the preview page. Two warnings:

- **Do not derive the mapping by scraping the folder listing.** The order of ids
  in that HTML does not reliably match the order of filenames; doing it that way
  produced an index where several packs pointed at the wrong file. Fetch each id
  and read the `id` field out of the JSON it actually serves.
- **Update files in place** using Drive's Manage versions. Deleting and
  re-uploading mints a new file id and silently breaks that entry in the index.

Drive also throttles heavily-downloaded public files, so a busy registry is
better off on a plain static host.

## Checking your work

```bash
node scripts/validate-world-packs.mjs [dir]   # any folder, defaults to data/worlds
node scripts/test-world-packs.mjs             # the bundled packs, part of npm test
node scripts/test-world-install.mjs           # the install and removal lifecycle
```

`src/lib/worlds/bundled/saltmarch.json` is the worked example. Match its depth.
