# Content pack (Open5e import)

The expanded character content (spells, feats, items, subclasses, monsters)
lives in a separate read-only SQLite at `data/content/open5e.sqlite`, built by:

```bash
node scripts/import-open5e.mjs            # uses cached raw pages if present
node scripts/import-open5e.mjs --refresh  # re-download from api.open5e.com
```

Raw API pages are cached under `data/content/raw/` so re-runs are offline.
The app works without the pack (SRD 5.1 fallback in `src/lib/srd/`), showing a
hint to run the import. Override the pack location with `CONTENT_DB_PATH`.

## Import counts (2026-07-21)

| Table       | Rows  |
| ----------- | ----- |
| spells      | 1802  |
| feats       | 141   |
| conditions  | 15    |
| backgrounds | 52    |
| races       | 74    |
| classes     | 14    |
| archetypes  | 222   |
| items       | 2047  |
| monsters    | 3207  |
| documents   | 31    |

## Three layers, in order

The import runs in three passes, each adding only what the previous one did
not have. Deduping is by **name**, not slug, because that is what a player
sees in a picker.

1. **Open5e v1** (the original import) is authoritative. Existing character
   sheets reference these slugs, so they are never rewritten.
2. **Open5e v2 backfill** adds the sources v1 never covered: SRD 5.2
   (`srd-2024`), Black Flag, Gate Pass Gazette, Spells That Don't Suck. Its
   class rows also carry level-tagged features, unlike v1's prose blobs.
3. **The authored layer** (`odm-expanded`) supplies what no open dataset has
   at all: the widely played subclasses, spells, feats and lineages. Source
   files are `src/lib/srd/subclasses.json`, `src/lib/srd/authored-*.json`
   and the lineages in `src/lib/srd/races.json`. See `docs/LICENSES.md` for
   the original-wording and generic-naming rules that govern them.

   Authored entries are stored under generic titles, never a personal name:
   the pack serves "Arcane Hand", not "Bigby's Hand". The printed name stays
   searchable through `src/lib/srd/manifest/spells.json`. When a rename makes
   an authored entry collide with an open document, the open row wins and the
   authored one should be pruned, which is how "Arcane Hand" ended up served
   from the CC-BY SRD instead of from us.

`scripts/test-content-completeness.mjs` asserts the whole expected catalog
resolves. When a player reports something missing, add its name to that
test's list first: the build fails until the content actually exists.

## Selectable options

Some 5e abilities are not granted, they are *chosen*: Eldritch Invocations,
Battle Master maneuvers, Metamagic, Pact Boons, Artificer infusions, Rune
Knight runes and Four Elements disciplines. These lived only as feature names
until `src/lib/srd/options.json` gave them bodies, so a warlock's sheet said
"Eldritch Invocations" and the player never picked any.

A pick is stored as a `"choice"`-sourced feature named with its kind's prefix
(`"Invocation: Agonizing Blast"`), which is exactly how Fighting Style already
worked, so `populateFeatures` preserves it across level-ups and the sheet
schema is unchanged. Counts per class and level live in `src/lib/srd/options.ts`
(`optionSlotsFor`, `openOptionSlots`); the builder and `LevelUpDialog` render
straight from `openOptionSlots`.

## Explaining it to players

`src/lib/help/` answers "what does this do?" for anything a player meets, so
nobody has to know 5e to play. `describeFeature(classId, subclass, name)`
resolves through, most specific first: authored subclass rules text, custom
genre-class text, an exact entry in `help/srd-features.json`, the `guidance`
already written on `RESOURCE_DEFS` and `FEATURE_EFFECTS`, then a looser SRD
match. `help/glossary.json` covers the core concepts (armor class, saving
throws, concentration, spell slots, advantage) in plain language.

The UI side is two primitives in `src/components/ui/`: `InfoButton` renders
the ⓘ that opens a description (fetching from `/api/content/[kind]/[slug]`
when the text is not local), and `GameTerm` makes a rules word tappable. They
are dialogs rather than tooltips on purpose: Radix tooltips never open on a
touch tap and the session layout is used on phones.

`scripts/test-help-coverage.mjs` is the counterpart to the mechanics guard:
`test-feature-coverage.mjs` proves a feature DOES something, this one proves
it EXPLAINS something. Adding a feature with no player-facing text fails the
build, as does a `<GameTerm>` naming a glossary id that does not exist.

Items combine v1 weapons (68), armor (23), magic items (1618), and v2 plain
adventuring gear. Races include subraces as separate rows linked by
`parent_slug`. Monsters are imported now for the future combat engine.

## Licensing

Each imported document's license is listed on the in-app `/licenses` page,
sourced from the `documents` table. The dataset mixes CC-BY-4.0 (Wizards SRD)
with OGL and third-party open content (Kobold Press et al). Keep the
`/licenses` page linked from the app footer.

Homebrew entries are user-scoped rows in the app database
(`homebrew_entries`), merged into every content picker with a homebrew flag.
