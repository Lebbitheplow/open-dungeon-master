// Downloads the Open5e dataset and builds the read-only content database at
// data/content/open5e.sqlite. Raw API pages are cached under data/content/raw/
// so re-runs work offline; pass --refresh to re-download.
//
// Usage: node scripts/import-open5e.mjs [--refresh]

import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeArmor,
  normalizeBackground,
  normalizeBackgroundV2,
  normalizeClassRows,
  normalizeClassRowsV2,
  normalizeCondition,
  normalizeDocument,
  normalizeDocumentV2,
  normalizeFeat,
  normalizeFeatV2,
  normalizeGearItem,
  normalizeMagicItem,
  normalizeMonster,
  normalizeRaceRows,
  normalizeSpeciesV2,
  normalizeSpell,
  normalizeSpellV2,
  normalizeWeapon,
  slugify,
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
      ritual INTEGER NOT NULL, concentration INTEGER NOT NULL,
      -- Other names the same spell is printed under. The SRD renames every
      -- wizard-named PHB spell ("Melf's Acid Arrow" -> "Acid Arrow"), so a
      -- player searching the name in their book found nothing until searches
      -- started matching this column too.
      aliases_csv TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE TABLE feats (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL,
      aliases_csv TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL
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

// A backfill: it adds only content the table does not already have, and never
// rewrites what the v1 import put there. Deduping is by NAME, not slug,
// because that is what a player sees in a picker. Matching v2 on slug alone
// added a fifth "Web" under a document-prefixed key rather than recognizing
// the spell was already present.
//
// The altSlug fallback stays for the rarer case of two genuinely different
// entries colliding on one slug, so neither is silently dropped.
function insertNewRows(db, table, columns, rows) {
  const existing = db.prepare(`SELECT slug, name FROM ${table}`).all();
  const takenSlugs = new Set(existing.map((row) => row.slug));
  const takenNames = new Set(existing.map((row) => row.name.trim().toLowerCase()));
  const resolved = [];
  for (const row of rows) {
    if (!row || !row.name) {
      continue;
    }
    const name = row.name.trim().toLowerCase();
    if (takenNames.has(name)) {
      continue;
    }
    let slug = row.slug;
    if (takenSlugs.has(slug)) {
      slug = row.altSlug && !takenSlugs.has(row.altSlug) ? row.altSlug : null;
    }
    if (!slug) {
      continue;
    }
    takenSlugs.add(slug);
    takenNames.add(name);
    resolved.push({ ...row, slug });
  }
  insertRows(db, table, columns, resolved);
  return resolved.length;
}

const AUTHORED_DOC = "odm-expanded";

// The authored layer: the class options, spells, feats and lineages that no
// openly licensed dataset carries. The source files live under src/lib/srd/
// rather than data/, because data/ is gitignored (it holds the app database
// and the API cache) and this content has to be in the repo for a fresh
// clone to rebuild the pack. They land in the same tables as everything
// else, so every picker, search and detail route serves them with no code
// change, and insertNewRows means an upstream row of the same name wins.
function insertAuthoredContent(db) {
  const readJson = (...parts) => JSON.parse(readFileSync(path.join(root, ...parts), "utf8"));

  insertRows(
    db,
    "documents",
    ["slug", "name", "title", "license", "author", "url"],
    [
      {
        slug: AUTHORED_DOC,
        name: "Open Dungeon Master Expanded Options",
        title: "Open Dungeon Master Expanded Options",
        license: "Original content, mechanics only",
        author: "Open Dungeon Master",
        url: "",
        data: {
          desc: "Class options, spells, feats and lineages widely played at 5e tables that no openly licensed dataset carries. The rules are described in original wording; no publisher's descriptive text is reproduced.",
        },
      },
    ],
  );

  // Subclasses: the same tables that grant features become archetype rows, so
  // the pickers list exactly what the feature engine can actually grant.
  const subclasses = readJson("src", "lib", "srd", "subclasses.json").classes;
  const archetypeRows = [];
  for (const [classId, entries] of Object.entries(subclasses)) {
    for (const entry of entries) {
      const levelText = Object.entries(entry.levels)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(
          ([level, features]) =>
            `**Level ${level}.** ` +
            features.map((feature) => `*${feature.n}.* ${feature.d}`).join(" "),
        )
        .join("\n\n");
      const spellText = entry.spells
        ? "\n\n**Always-prepared spells.** " +
          Object.entries(entry.spells)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([level, spells]) => `Level ${level}: ${spells.join(", ")}.`)
            .join(" ")
        : "";
      const desc = `${entry.desc}\n\n${levelText}${spellText}`;
      archetypeRows.push({
        slug: `${classId}-${slugify(entry.name)}`,
        name: entry.name,
        document_slug: AUTHORED_DOC,
        class_slug: classId,
        data: { name: entry.name, desc, class: classId, aliases: entry.aliases ?? [] },
      });
    }
  }
  console.log(
    `  archetypes +${insertNewRows(
      db,
      "archetypes",
      ["slug", "name", "document_slug", "class_slug"],
      archetypeRows,
    )}`,
  );

  const spells = readJson("src", "lib", "srd", "authored-spells.json").spells;
  console.log(
    `  spells +${insertNewRows(
      db,
      "spells",
      ["slug", "name", "document_slug", "level", "school", "classes_csv", "ritual", "concentration"],
      spells.map((spell) => ({
        slug: slugify(spell.name),
        altSlug: `odm-${slugify(spell.name)}`,
        name: spell.name,
        document_slug: AUTHORED_DOC,
        level: spell.level,
        school: String(spell.school || "").toLowerCase(),
        classes_csv: (spell.classes || []).map((entry) => entry.toLowerCase()).join(","),
        ritual: spell.ritual ? 1 : 0,
        concentration: spell.concentration ? 1 : 0,
        // level_int and dnd_class mirror the v1 field names the rest of the
        // app already reads off spell rows.
        data: {
          ...spell,
          level_int: spell.level,
          dnd_class: (spell.classes || []).join(", "),
          higher_level: spell.higher_level || "",
        },
      })),
    )}`,
  );

  const feats = readJson("src", "lib", "srd", "authored-feats.json").feats;
  console.log(
    `  feats +${insertNewRows(
      db,
      "feats",
      ["slug", "name", "document_slug"],
      feats.map((feat) => ({
        slug: slugify(feat.name),
        altSlug: `odm-${slugify(feat.name)}`,
        name: feat.name,
        document_slug: AUTHORED_DOC,
        data: feat,
      })),
    )}`,
  );

  // Alternate names, applied last so it covers upstream and authored rows
  // alike. Without this a player searching "Tasha's Hideous Laughter" gets
  // nothing, because the SRD files it under "Hideous Laughter".
  const manifest = readJson("src", "lib", "srd", "manifest", "spells.json").spells;
  const setAliases = db.prepare("UPDATE spells SET aliases_csv = ? WHERE slug = ?");
  const findSpell = db.prepare(
    "SELECT slug, name FROM spells WHERE name = ? COLLATE NOCASE LIMIT 1",
  );
  let aliased = 0;
  const applyAliases = db.transaction((entries) => {
    for (const entry of entries) {
      const names = [entry.n, ...(entry.a ?? [])];
      for (const candidate of names) {
        const row = findSpell.get(candidate);
        if (!row) {
          continue;
        }
        // Every name for this spell except the one the row is stored under.
        const others = names.filter(
          (name) => name.toLowerCase() !== row.name.trim().toLowerCase(),
        );
        if (others.length) {
          setAliases.run(others.join("|").toLowerCase(), row.slug);
          aliased += 1;
        }
        break;
      }
    }
  });
  applyAliases(manifest.filter((entry) => (entry.a ?? []).length));
  console.log(`  aliases applied to ${aliased} spells`);

  // Lineages: src/lib/srd/races.json is the single source of truth (it is
  // what actually grants traits), so the pack rows are generated from it
  // rather than duplicated into a second file.
  const races = readJson("src", "lib", "srd", "races.json").races;
  console.log(
    `  races +${insertNewRows(
      db,
      "races",
      ["slug", "name", "document_slug", "is_subrace", "parent_slug"],
      races.map((race) => ({
        slug: race.id.replace(/_/g, "-"),
        altSlug: `odm-${race.id.replace(/_/g, "-")}`,
        name: race.name,
        document_slug: AUTHORED_DOC,
        is_subrace: 0,
        parent_slug: "",
        data: {
          name: race.name,
          desc: race.traits.join(". ") + ".",
          asi: race.asi,
          speed: race.speed,
          size: race.size,
          traits: race.traits.join("\n"),
          languages: (race.languages || []).join(", "),
        },
      })),
    )}`,
  );
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

  // v1 stops at the sources it was built for; v2 is where SRD 5.2, Black
  // Flag, Gate Pass Gazette and several hundred more spells live. Everything
  // below fills gaps only, so the v1 import above stays authoritative.
  console.log("\nv2 backfill...");
  console.log("  spells...");
  console.log(
    `    +${insertNewRows(
      db,
      "spells",
      ["slug", "name", "document_slug", "level", "school", "classes_csv", "ritual", "concentration"],
      (await fetchAllPages("/v2/spells/")).map(normalizeSpellV2),
    )}`,
  );

  console.log("  feats...");
  console.log(
    `    +${insertNewRows(
      db,
      "feats",
      ["slug", "name", "document_slug"],
      (await fetchAllPages("/v2/feats/")).map(normalizeFeatV2),
    )}`,
  );

  console.log("  backgrounds...");
  console.log(
    `    +${insertNewRows(
      db,
      "backgrounds",
      ["slug", "name", "document_slug", "skills_csv"],
      (await fetchAllPages("/v2/backgrounds/")).map(normalizeBackgroundV2),
    )}`,
  );

  console.log("  species (races)...");
  console.log(
    `    +${insertNewRows(
      db,
      "races",
      ["slug", "name", "document_slug", "is_subrace", "parent_slug"],
      (await fetchAllPages("/v2/species/")).map(normalizeSpeciesV2),
    )}`,
  );

  console.log("  classes + archetypes...");
  const v2ClassRows = (await fetchAllPages("/v2/classes/")).map(normalizeClassRowsV2);
  console.log(
    `    classes +${insertNewRows(
      db,
      "classes",
      ["slug", "name", "document_slug", "hit_die"],
      v2ClassRows.flatMap((entry) => (entry.cls ? [entry.cls] : [])),
    )}`,
  );
  console.log(
    `    archetypes +${insertNewRows(
      db,
      "archetypes",
      ["slug", "name", "document_slug", "class_slug"],
      v2ClassRows.flatMap((entry) => (entry.archetype ? [entry.archetype] : [])),
    )}`,
  );

  console.log("  documents...");
  insertNewRows(
    db,
    "documents",
    ["slug", "name", "title", "license", "author", "url"],
    (await fetchAllPages("/v2/documents/")).map(normalizeDocumentV2),
  );

  // The authored layer: our own subclass, spell, feat and race entries for
  // the options no open dataset carries. Written in our own words; see
  // src/lib/srd/subclasses.json and data/content/authored/.
  console.log("\nauthored content...");
  insertAuthoredContent(db);

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
