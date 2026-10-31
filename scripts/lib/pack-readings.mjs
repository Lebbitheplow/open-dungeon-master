// The readings a content pack stores (issue #570, "Rules and content"):
// every reader in src/lib/content/entry-reading.ts run once over every row
// when the pack is built, its answer written beside the row in `readings`,
// marked hand-written, parsed or missing, with what it left unread; and in
// `entry_needs`, for every row of every table, the rules the entry uses that
// the engine does not have (src/lib/content/needs-logic.ts). The server
// plays from these (src/lib/content/pack-readings.ts), and
// scripts/pack-readings.mjs lists them and compares two packs.
//
// Shared by scripts/import-open5e.mjs (the build) and the suites, which
// build a scratch pack the same way.

const { readEntry } = await import("../../src/lib/content/entry-reading.ts");
const { READING_KINDS, READER_REVISION } = await import("../../src/lib/content/reading-logic.ts");
const { mechanicsNeeded } = await import("../../src/lib/content/needs-logic.ts");
const { servedSpellRow } = await import("../../src/lib/content/spell-overrides.ts");

export const READING_TABLES = {
  spell: "spells",
  monster: "monsters",
  feat: "feats",
  race: "races",
  class: "classes",
  background: "backgrounds",
  archetype: "archetypes",
};
// Every table whose rows can need a rule the engine lacks: the readers'
// and the items' (magic items are read into src/lib/classes/magic-items.json
// at dev time, scripts/generate-magic-items.mjs).
export const NEEDS_TABLES = { ...READING_TABLES, item: "items" };

// A pack row as the readers take it. A spell is read as the server serves
// it: a Level Up row's expertise die and maneuver DC already in 2014 terms.
export function readingRowOf(kind, raw) {
  const row = {
    slug: raw.slug,
    name: raw.name,
    documentSlug: raw.document_slug,
    data: JSON.parse(raw.data_json),
    aliases: raw.aliases_csv ? String(raw.aliases_csv).split(/[|,]/).filter(Boolean) : [],
    cr: raw.cr ?? null,
    classSlug: raw.class_slug ?? null,
  };
  if (kind !== "spell") {
    return row;
  }
  const served = servedSpellRow({
    slug: row.slug,
    name: row.name,
    documentSlug: row.documentSlug,
    level: Number(raw.level) || 0,
    school: String(raw.school ?? ""),
    classes: raw.classes_csv ? String(raw.classes_csv).split(",") : [],
    ritual: raw.ritual === 1,
    concentration: raw.concentration === 1,
    aliases: row.aliases,
    data: row.data,
  });
  return { ...row, data: served.data };
}

export const READINGS_SCHEMA = `
  CREATE TABLE readings (
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    document_slug TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('hand-written', 'parsed', 'missing')),
    checked INTEGER NOT NULL,
    unread_json TEXT NOT NULL,
    mechanics_json TEXT,
    PRIMARY KEY (kind, slug)
  );
  CREATE TABLE entry_needs (
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    document_slug TEXT NOT NULL,
    needs_json TEXT NOT NULL,
    PRIMARY KEY (kind, slug)
  );
  CREATE TABLE pack_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Reads every row of the pack and writes what was read; returns the counts.
export function writeReadings(db) {
  db.exec("DROP TABLE IF EXISTS readings; DROP TABLE IF EXISTS entry_needs; DROP TABLE IF EXISTS pack_meta;");
  db.exec(READINGS_SCHEMA);
  const reading = db.prepare(
    "INSERT INTO readings (kind, slug, document_slug, source, checked, unread_json, mechanics_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const need = db.prepare("INSERT INTO entry_needs (kind, slug, document_slug, needs_json) VALUES (?, ?, ?, ?)");
  const counts = {};
  db.transaction(() => {
    for (const [kind, table] of Object.entries(NEEDS_TABLES)) {
      const tally = (counts[kind] = { rows: 0, "hand-written": 0, parsed: 0, missing: 0, needs: 0 });
      for (const raw of db.prepare(`SELECT * FROM ${table}`).all()) {
        const row = readingRowOf(kind, raw);
        tally.rows += 1;
        if (READING_KINDS.includes(kind)) {
          const entry = readEntry(kind, row);
          tally[entry.source] += 1;
          reading.run(
            kind,
            row.slug,
            row.documentSlug,
            entry.source,
            entry.checked ? 1 : 0,
            JSON.stringify(entry.unread),
            entry.mechanics === null ? null : JSON.stringify(entry.mechanics),
          );
        }
        const needs = mechanicsNeeded(row);
        if (needs.length) {
          tally.needs += 1;
          need.run(kind, row.slug, row.documentSlug, JSON.stringify(needs));
        }
      }
    }
    db.prepare("INSERT INTO pack_meta (key, value) VALUES ('reader_revision', ?)").run(String(READER_REVISION));
  })();
  return counts;
}
