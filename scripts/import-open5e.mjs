// Downloads the Open5e dataset and builds the read-only content database at
// data/content/open5e.sqlite. Raw API pages are cached under data/content/raw/
// so re-runs work offline; pass --refresh to re-download.
//
// Usage: node scripts/import-open5e.mjs [--refresh]

import Database from "better-sqlite3";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeArmor,
  normalizeBackground,
  normalizeClassRows,
  normalizeCondition,
  normalizeDocument,
  normalizeFeat,
  normalizeGearItem,
  normalizeMagicItem,
  normalizeMonster,
  normalizeRaceRows,
  normalizeSpell,
  normalizeWeapon,
} from "./lib/open5e-normalize.mjs";

const API = "https://api.open5e.com";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "data", "content");
const rawDir = path.join(contentDir, "raw");
const dbPath = path.join(contentDir, "open5e.sqlite");
const refresh = process.argv.includes("--refresh");

mkdirSync(rawDir, { recursive: true });

async function fetchAllPages(endpoint) {
  const cacheFile = path.join(rawDir, `${endpoint.replace(/\W+/g, "_")}.json`);
  if (!refresh && existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  }
  const results = [];
  let url = `${API}${endpoint}?limit=500`;
  while (url) {
    process.stdout.write(`  fetching ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} -> HTTP ${response.status}`);
    }
    const page = await response.json();
    results.push(...(page.results ?? []));
    url = page.next;
  }
  writeFileSync(cacheFile, JSON.stringify(results));
  return results;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE spells (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      level INTEGER NOT NULL, school TEXT NOT NULL, classes_csv TEXT NOT NULL,
      ritual INTEGER NOT NULL, concentration INTEGER NOT NULL, data_json TEXT NOT NULL
    );
    CREATE TABLE feats (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE TABLE conditions (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE TABLE backgrounds (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      skills_csv TEXT NOT NULL, data_json TEXT NOT NULL
    );
    CREATE TABLE races (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      is_subrace INTEGER NOT NULL, parent_slug TEXT NOT NULL, data_json TEXT NOT NULL
    );
    CREATE TABLE classes (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      hit_die INTEGER NOT NULL, data_json TEXT NOT NULL
    );
    CREATE TABLE archetypes (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      class_slug TEXT NOT NULL, data_json TEXT NOT NULL
    );
    CREATE TABLE items (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('weapon','armor','gear','magic_item')),
      rarity TEXT NOT NULL, cost TEXT NOT NULL, category TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE TABLE monsters (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      cr REAL NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL
    );
    CREATE TABLE documents (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL,
      license TEXT NOT NULL, author TEXT NOT NULL, url TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE INDEX idx_spells_search ON spells(level, school);
    CREATE INDEX idx_items_kind ON items(kind);
    CREATE INDEX idx_monsters_cr ON monsters(cr);
    CREATE INDEX idx_archetypes_class ON archetypes(class_slug);
  `);
}

function insertRows(db, table, columns, rows) {
  const placeholders = columns.map(() => "?").join(", ");
  const statement = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}, data_json) VALUES (${placeholders}, ?)`,
  );
  const insertMany = db.transaction((batch) => {
    for (const row of batch) {
      statement.run(...columns.map((column) => row[column]), JSON.stringify(row.data));
    }
  });
  insertMany(rows.filter((row) => row && row.slug && row.name));
}

async function main() {
  const tmpPath = `${dbPath}.tmp`;
  rmSync(tmpPath, { force: true });
  const db = new Database(tmpPath);
  db.pragma("journal_mode = OFF");
  createSchema(db);

  console.log("spells...");
  insertRows(
    db,
    "spells",
    ["slug", "name", "document_slug", "level", "school", "classes_csv", "ritual", "concentration"],
    (await fetchAllPages("/v1/spells/")).map(normalizeSpell),
  );

  console.log("feats...");
  insertRows(
    db,
    "feats",
    ["slug", "name", "document_slug"],
    (await fetchAllPages("/v1/feats/")).map(normalizeFeat),
  );

  console.log("conditions...");
  insertRows(
    db,
    "conditions",
    ["slug", "name", "document_slug"],
    (await fetchAllPages("/v1/conditions/")).map(normalizeCondition),
  );

  console.log("backgrounds...");
  insertRows(
    db,
    "backgrounds",
    ["slug", "name", "document_slug", "skills_csv"],
    (await fetchAllPages("/v1/backgrounds/")).map(normalizeBackground),
  );

  console.log("races...");
  insertRows(
    db,
    "races",
    ["slug", "name", "document_slug", "is_subrace", "parent_slug"],
    (await fetchAllPages("/v1/races/")).flatMap(normalizeRaceRows),
  );

  console.log("classes + archetypes...");
  const classRows = (await fetchAllPages("/v1/classes/")).map(normalizeClassRows);
  insertRows(
    db,
    "classes",
    ["slug", "name", "document_slug", "hit_die"],
    classRows.map((entry) => entry.cls),
  );
  insertRows(
    db,
    "archetypes",
    ["slug", "name", "document_slug", "class_slug"],
    classRows.flatMap((entry) => entry.archetypes),
  );

  console.log("items (weapons, armor, magic items, gear)...");
  const itemColumns = ["slug", "name", "document_slug", "kind", "rarity", "cost", "category"];
  insertRows(db, "items", itemColumns, (await fetchAllPages("/v1/weapons/")).map(normalizeWeapon));
  insertRows(db, "items", itemColumns, (await fetchAllPages("/v1/armor/")).map(normalizeArmor));
  insertRows(
    db,
    "items",
    itemColumns,
    (await fetchAllPages("/v1/magicitems/")).map(normalizeMagicItem),
  );
  insertRows(
    db,
    "items",
    itemColumns,
    (await fetchAllPages("/v2/items/")).map(normalizeGearItem).filter(Boolean),
  );

  console.log("monsters...");
  insertRows(
    db,
    "monsters",
    ["slug", "name", "document_slug", "cr", "type"],
    (await fetchAllPages("/v1/monsters/")).map(normalizeMonster),
  );

  console.log("documents...");
  insertRows(
    db,
    "documents",
    ["slug", "name", "title", "license", "author", "url"],
    (await fetchAllPages("/v1/documents/")).map(normalizeDocument),
  );

  console.log("\nImport complete:");
  for (const table of [
    "spells",
    "feats",
    "conditions",
    "backgrounds",
    "races",
    "classes",
    "archetypes",
    "items",
    "monsters",
    "documents",
  ]) {
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    console.log(`  ${table}: ${count}`);
  }

  db.close();
  rmSync(dbPath, { force: true });
  const finished = new Database(tmpPath);
  finished.close();
  // Atomic-ish swap: build in a temp file, then move into place.
  const { renameSync } = await import("node:fs");
  renameSync(tmpPath, dbPath);
  console.log(`\nWrote ${dbPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
