// The readings a content pack stores (issue #570, "Rules and content"):
// the pack build runs every reader once (scripts/lib/pack-readings.mjs) and
// writes, beside each row, what the engine plays it with, whether that is a
// hand-written row, the parser's answer or nothing, what the parser left
// unread, and the rules the entry needs that the engine does not have.
//
// No pack in CI, so this suite builds a scratch one from the readers'
// golden rows (scripts/fixtures/reader-golden/) and a few Level Up rows
// written here, the way scripts/import-open5e.mjs builds the real one. It
// then holds the server to the stored answer: a spell is played from its
// stored reading, and a pack whose readings an older reader wrote is read
// live instead. With a real pack (CONTENT_DB_PATH, or data/content), every
// stored reading must be what the readers read now.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-pack-readings");
const realPack = process.env.CONTENT_DB_PATH || path.join(process.cwd(), "data", "content", "open5e.sqlite");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-pack-readings-"));
const file = path.join(dir, "open5e.sqlite");
process.env.CONTENT_DB_PATH = file;

const Database = (await import("better-sqlite3-multiple-ciphers")).default;
const { writeReadings, readingRowOf, READING_TABLES, NEEDS_TABLES } = await import("./lib/pack-readings.mjs");
const { readEntry } = await import("../src/lib/content/entry-reading.ts");
const { READER_REVISION } = await import("../src/lib/content/reading-logic.ts");
const { mechanicsNeeded } = await import("../src/lib/content/needs-logic.ts");
const { PACK_REVISION } = await import("../src/lib/content/edition.ts");

// The pack's tables, with the columns the readers and the server read.
const SCHEMA = `
  CREATE TABLE documents (slug TEXT PRIMARY KEY, name TEXT, title TEXT, license TEXT, author TEXT, url TEXT, data_json TEXT);
  CREATE TABLE spells (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, level INTEGER, school TEXT, classes_csv TEXT, ritual INTEGER, concentration INTEGER, aliases_csv TEXT, data_json TEXT NOT NULL);
  CREATE TABLE monsters (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, cr REAL, type TEXT, data_json TEXT NOT NULL);
  CREATE TABLE feats (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, aliases_csv TEXT, data_json TEXT NOT NULL);
  CREATE TABLE races (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, is_subrace INTEGER, parent_slug TEXT, data_json TEXT NOT NULL);
  CREATE TABLE classes (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, hit_die INTEGER, data_json TEXT NOT NULL);
  CREATE TABLE backgrounds (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, skills_csv TEXT, data_json TEXT NOT NULL);
  CREATE TABLE archetypes (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, class_slug TEXT, data_json TEXT NOT NULL);
  CREATE TABLE items (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, kind TEXT, rarity TEXT, cost TEXT, category TEXT, weight REAL, data_json TEXT NOT NULL);
  CREATE TABLE conditions (slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, data_json TEXT NOT NULL);
`;

// Level Up rows written for what the needs reader must and must not see.
const LEVEL_UP = {
  monster: [
    { slug: "wailing-dread-a5e", name: "Wailing Dread", documentSlug: "menagerie", cr: 3, data: { armor_class: 13, hit_points: 40, condition_immunities: "fatigue", actions: [{ name: "Dreadful Wail", desc: "Each creature within 30 feet that can hear it must succeed on a DC 13 Wisdom saving throw or gain a level of strife." }] } },
    { slug: "stone-sentinel-a5e", name: "Stone Sentinel", documentSlug: "menagerie", cr: 2, data: { armor_class: 17, hit_points: 30, condition_immunities: "fatigue, poisoned", actions: [{ name: "Slam", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) bludgeoning damage." }] } },
    { slug: "cave-skulker", name: "Cave Skulker", documentSlug: "tob", cr: 1, data: { armor_class: 12, hit_points: 18, special_abilities: [{ name: "Slippery", desc: "The skulker maneuvers out of reach: opportunity attacks against it have disadvantage." }] } },
    { slug: "ley-wisp", name: "Ley Wisp", documentSlug: "tob2", cr: 2, data: { armor_class: 14, hit_points: 22, special_abilities: [{ name: "Ley Drinker", desc: "While within 60 feet of a ley line, the wisp regains 5 hit points at the start of its turn." }] } },
  ],
  spell: [
    { slug: "steady-hand-a5e", name: "Steady Hand", documentSlug: "a5e", level: 1, data: { desc: "Until the spell ends, the target gains an expertise die on Dexterity checks.", higher_level: "", duration: "Up to 1 hour" } },
  ],
  item: [
    { slug: "lucky-dice-a5e", name: "Lucky Dice", documentSlug: "a5e", data: { desc: "While carrying the dice you gain an expertise die on gambling checks. If you roll a 1, you gain a level of fatigue." } },
  ],
};

const db = new Database(file);
db.exec(SCHEMA);
const insert = {
  spell: db.prepare("INSERT INTO spells (slug, name, document_slug, level, school, classes_csv, ritual, concentration, aliases_csv, data_json) VALUES (?, ?, ?, ?, 'evocation', 'wizard', 0, 0, ?, ?)"),
  monster: db.prepare("INSERT INTO monsters (slug, name, document_slug, cr, type, data_json) VALUES (?, ?, ?, ?, 'monstrosity', ?)"),
  feat: db.prepare("INSERT INTO feats (slug, name, document_slug, aliases_csv, data_json) VALUES (?, ?, ?, ?, ?)"),
  race: db.prepare("INSERT INTO races (slug, name, document_slug, is_subrace, parent_slug, data_json) VALUES (?, ?, ?, 0, NULL, ?)"),
  class: db.prepare("INSERT INTO classes (slug, name, document_slug, hit_die, data_json) VALUES (?, ?, ?, 8, ?)"),
  background: db.prepare("INSERT INTO backgrounds (slug, name, document_slug, skills_csv, data_json) VALUES (?, ?, ?, '', ?)"),
  archetype: db.prepare("INSERT INTO archetypes (slug, name, document_slug, class_slug, data_json) VALUES (?, ?, ?, ?, ?)"),
  item: db.prepare("INSERT INTO items (slug, name, document_slug, kind, rarity, cost, category, weight, data_json) VALUES (?, ?, ?, 'magic', 'uncommon', '', 'wondrous', 0, ?)"),
};
const put = (kind, row) => {
  const json = JSON.stringify(row.data);
  const aliases = (row.aliases ?? []).join("|");
  if (kind === "spell") insert.spell.run(row.slug, row.name, row.documentSlug, row.level ?? 1, aliases, json);
  else if (kind === "monster") insert.monster.run(row.slug, row.name, row.documentSlug, row.cr ?? 0, json);
  else if (kind === "feat") insert.feat.run(row.slug, row.name, row.documentSlug, aliases, json);
  else if (kind === "archetype") insert.archetype.run(row.slug, row.name, row.documentSlug, row.classSlug ?? "", json);
  else insert[kind].run(row.slug, row.name, row.documentSlug, json);
};
const golden = {};
for (const kind of Object.keys(READING_TABLES)) {
  golden[kind] = JSON.parse(fs.readFileSync(new URL(`./fixtures/reader-golden/${kind}.json`, import.meta.url), "utf8")).cases.map((entry) => entry.row);
  golden[kind].forEach((row) => put(kind, row));
}
for (const [kind, rows] of Object.entries(LEVEL_UP)) {
  rows.forEach((row) => put(kind, row));
}
const counts = writeReadings(db);
db.pragma(`user_version = ${PACK_REVISION}`);
db.close();

await test("The build stores one reading for every row a reader reads, as the reader answered it.", () => {
  const pack = new Database(file, { readonly: true });
  for (const [kind, table] of Object.entries(READING_TABLES)) {
    const rows = pack.prepare(`SELECT * FROM ${table}`).all();
    assert.equal(counts[kind].rows, rows.length);
    for (const raw of rows) {
      const stored = pack.prepare("SELECT * FROM readings WHERE kind = ? AND slug = ?").get(kind, raw.slug);
      assert.ok(stored, `${kind} ${raw.slug} has a stored reading`);
      const live = readEntry(kind, readingRowOf(kind, raw));
      assert.equal(stored.source, live.source, `${kind} ${raw.slug}`);
      assert.equal(stored.checked === 1, live.checked, `${kind} ${raw.slug} checked`);
      assert.deepEqual(JSON.parse(stored.unread_json), live.unread, `${kind} ${raw.slug} unread`);
      assert.deepEqual(stored.mechanics_json === null ? null : JSON.parse(stored.mechanics_json), JSON.parse(JSON.stringify(live.mechanics)), `${kind} ${raw.slug} mechanics`);
    }
  }
  assert.equal(pack.prepare("SELECT value FROM pack_meta WHERE key = 'reader_revision'").get().value, String(READER_REVISION));
  pack.close();
});

await test("Each row is marked hand-written, parsed or missing.", () => {
  const pack = new Database(file, { readonly: true });
  const sources = new Set(pack.prepare("SELECT DISTINCT source FROM readings").all().map((row) => row.source));
  assert.deepEqual([...sources].sort(), ["hand-written", "missing", "parsed"]);
  const shield = pack.prepare("SELECT * FROM readings WHERE kind = 'spell' AND slug = 'shield'").get();
  assert.equal(shield.source, "missing");
  assert.equal(shield.mechanics_json, null);
  assert.deepEqual(JSON.parse(shield.unread_json), ["buff"]);
  pack.close();
});

await test("The rules an entry needs are read from what it does, never from what it is immune to.", () => {
  const pack = new Database(file, { readonly: true });
  const needs = (kind, slug) => JSON.parse(pack.prepare("SELECT needs_json FROM entry_needs WHERE kind = ? AND slug = ?").get(kind, slug)?.needs_json ?? "[]");
  assert.deepEqual(needs("monster", "wailing-dread-a5e"), ["strife"], "a wail that gives strife; its fatigue immunity is 5.1's exhaustion");
  assert.deepEqual(needs("monster", "stone-sentinel-a5e"), [], "immune to fatigue needs nothing");
  assert.deepEqual(needs("monster", "cave-skulker"), [], "a Tome of Beasts creature that maneuvers is no Level Up maneuver");
  assert.deepEqual(needs("monster", "ley-wisp"), ["ley lines"]);
  assert.deepEqual(needs("spell", "steady-hand-a5e"), [], "a spell's expertise die is already read as a d4 (issue #116)");
  assert.deepEqual(needs("item", "lucky-dice-a5e"), ["fatigue", "expertise dice"], "an item's is not");
  assert.equal(counts.item.needs, 1);
  pack.close();
});

await test("The needs reader knows each of the rules it names.", () => {
  const read = (desc, documentSlug = "menagerie") => mechanicsNeeded({ documentSlug, data: { desc } });
  assert.deepEqual(read("The target is rattled until the end of its next turn."), ["rattled"]);
  assert.deepEqual(read("You gain an expertise die on the check."), ["expertise dice"]);
  assert.deepEqual(read("You can spend 2 exertion to use this."), ["exertion"]);
  assert.deepEqual(read("You learn the Bounding Strike maneuver.", "a5e"), ["maneuvers"]);
  assert.deepEqual(read("While bloodied, the ogre can use Sword Sweep."), ["bloodied"]);
  assert.deepEqual(read("The first time it becomes bloodied, it roars."), ["bloodied"]);
  assert.deepEqual(read("If the troll is bloodied, its bite deals 2d6."), [], "a bloodied attack the attack reader already plays");
  assert.deepEqual(read("Each creature in the area gains one level of fatigue and one level of strife."), ["strife", "fatigue"]);
  assert.deepEqual(read("A creature in the area takes 2d6 fire damage.", "a5e"), []);
});

// The server reads the stored answer: Steal Warmth's stored reading is
// changed in the scratch pack, and the cast tools see the change.
const write = new Database(file);
const steal = write.prepare("SELECT mechanics_json FROM readings WHERE kind = 'spell' AND slug = 'steal-warmth'").get();
const tampered = { ...JSON.parse(steal.mechanics_json), halfOnSave: false, damageType: "fire" };
write.prepare("UPDATE readings SET mechanics_json = ? WHERE kind = 'spell' AND slug = 'steal-warmth'").run(JSON.stringify(tampered));
write.close();

const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
const { packReadingsCurrent, storedReading } = await import("../src/lib/content/pack-readings.ts");

await test("A spell is played from the reading the pack stored.", () => {
  assert.equal(packReadingsCurrent(), true);
  assert.equal(storedReading("spell", "steal-warmth")?.source, "parsed");
  const resolved = spellMechanicsFor({ spell: "Steal Warmth" });
  assert.equal(resolved?.mech.damageType, "fire", "the stored answer, not a parse of the text");
  assert.equal(resolved?.mech.halfOnSave, false);
  // A hand-written row still answers first.
  assert.equal(spellMechanicsFor({ spell: "Burning Hands" })?.mech.save, "dex");
});

await test("A pack whose readings an older reader wrote is read live.", () => {
  const older = new Database(file);
  older.prepare("UPDATE pack_meta SET value = ? WHERE key = 'reader_revision'").run(String(READER_REVISION - 1));
  older.close();
  globalThis.__odmPackReadings = undefined;
  assert.equal(packReadingsCurrent(), false);
  assert.equal(storedReading("spell", "steal-warmth"), null);
  const resolved = spellMechanicsFor({ spell: "Steal Warmth" });
  assert.equal(resolved?.mech.damageType, "cold", "read from its text again");
  assert.equal(resolved?.mech.halfOnSave, true);
});

// The real pack, where there is one: its stored readings are the readers'.
if (fs.existsSync(realPack)) {
  const pack = new Database(realPack, { readonly: true });
  let revision = null;
  try {
    revision = Number(pack.prepare("SELECT value FROM pack_meta WHERE key = 'reader_revision'").get()?.value);
  } catch {
    console.log(`  ${realPack} has no stored readings (built before them); the server reads it live.`);
  }
  if (revision === READER_REVISION) {
    await test("The installed pack's stored readings are what the readers read now.", () => {
      const moved = [];
      for (const [kind, table] of Object.entries(NEEDS_TABLES)) {
        for (const raw of pack.prepare(`SELECT * FROM ${table}`).all()) {
          const row = readingRowOf(kind, raw);
          if (kind in READING_TABLES) {
            const stored = pack.prepare("SELECT * FROM readings WHERE kind = ? AND slug = ?").get(kind, raw.slug);
            const live = readEntry(kind, row);
            const same =
              stored &&
              stored.source === live.source &&
              stored.unread_json === JSON.stringify(live.unread) &&
              stored.mechanics_json === (live.mechanics === null ? null : JSON.stringify(live.mechanics));
            if (!same) moved.push(`${kind} ${raw.document_slug}/${raw.slug}`);
          }
          const needs = pack.prepare("SELECT needs_json FROM entry_needs WHERE kind = ? AND slug = ?").get(kind, raw.slug)?.needs_json ?? "[]";
          if (needs !== JSON.stringify(mechanicsNeeded(row))) moved.push(`${kind} ${raw.document_slug}/${raw.slug} needs`);
        }
      }
      assert.deepEqual(moved.slice(0, 20), [], `${moved.length} stored readings differ from the readers: raise READER_REVISION (src/lib/content/reading-logic.ts) and rebuild the pack`);
    });
  } else if (revision !== null) {
    console.log(`  ${realPack} stores readings from readers revision ${revision}; this code's are ${READER_REVISION}, so the server reads it live until it is rebuilt.`);
  }
  pack.close();
}

fs.rmSync(dir, { recursive: true, force: true });
finish();
