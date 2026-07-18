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

## Import counts (2026-07-17)

| Table       | Rows  |
| ----------- | ----- |
| spells      | 1435  |
| feats       | 74    |
| conditions  | 15    |
| backgrounds | 42    |
| races       | 54    |
| classes     | 12    |
| archetypes  | 107   |
| items       | 2047  |
| monsters    | 3207  |
| documents   | 17    |

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
