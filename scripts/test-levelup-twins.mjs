// Level Up content in an SRD 5.1 game (issue #570, "Rules and content"):
// Level Up's version of an SRD entry never reaches the table, its entries
// built on rules this game has no track for (strife, fatigue and the rest)
// are not offered for play, and every search that can still show one says
// what it needs (src/lib/content/levelup-logic.ts).
//
// A scratch pack holds an SRD goblin beside the Menagerie's goblin, a
// Menagerie-only dragon whose breath gives strife, a Tome of Beasts creature
// that drinks from ley lines, and an SRD item beside Level Up's twin of it,
// read the way the pack build reads them (scripts/lib/pack-readings.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-levelup-twins");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-levelup-"));
const file = path.join(dir, "open5e.sqlite");
process.env.CONTENT_DB_PATH = file;

const Database = (await import("better-sqlite3-multiple-ciphers")).default;
const { writeReadings } = await import("./lib/pack-readings.mjs");
const { PACK_REVISION } = await import("../src/lib/content/edition.ts");
const logic = await import("../src/lib/content/levelup-logic.ts");

const block = (name, extra = {}) => ({
  name,
  armor_class: 12,
  hit_points: 9,
  hit_dice: "2d8",
  strength: 10,
  dexterity: 12,
  constitution: 10,
  intelligence: 8,
  wisdom: 10,
  charisma: 8,
  challenge_rating: "1/4",
  actions: [{ name: "Scimitar", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." }],
  ...extra,
});
const MONSTERS = [
  ["goblin", "Goblin", "wotc-srd", 0.25, block("Goblin")],
  ["goblin-a5e", "Goblin", "menagerie", 0.25, block("Goblin", { actions: [{ name: "Shortsword", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage." }] })],
  ["earth-dragon-wyrmling-a5e", "Earth Dragon Wyrmling", "menagerie", 2, block("Earth Dragon Wyrmling", { actions: [{ name: "Scouring Breath", desc: "The dragon breathes scouring sand in a 15-foot cone. Each creature in the area makes a DC 12 Dexterity saving throw, taking 11 (2d10) slashing damage on a failure. A creature that fails also gains a level of strife." }] })],
  ["ley-wisp", "Ley Wisp", "tob2", 2, block("Ley Wisp", { special_abilities: [{ name: "Ley Drinker", desc: "While within 60 feet of a ley line, the wisp regains 5 hit points at the start of its turn." }] })],
];
const ITEMS = [
  ["bag-of-holding", "Bag of Holding", "wotc-srd", "This bag has an interior space considerably larger than its outside dimensions."],
  ["bag-of-holding-a5e", "Bag of Holding", "a5e", "This bag is larger on the inside. While carrying it you gain an expertise die on checks to find what is in it."],
  ["dice-of-the-gambler-a5e", "Dice of the Gambler", "a5e", "While carrying the dice you gain an expertise die on gambling checks."],
];

const db = new Database(file);
db.exec(`
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
`);
for (const [slug, name, document, cr, data] of MONSTERS) {
  db.prepare("INSERT INTO monsters (slug, name, document_slug, cr, type, data_json) VALUES (?, ?, ?, ?, 'humanoid', ?)").run(slug, name, document, cr, JSON.stringify({ ...data, slug, document__slug: document }));
}
for (const [slug, name, document, desc] of ITEMS) {
  db.prepare("INSERT INTO items (slug, name, document_slug, kind, rarity, cost, category, weight, data_json) VALUES (?, ?, ?, 'magic_item', 'uncommon', '', 'wondrous', 15, ?)").run(slug, name, document, JSON.stringify({ desc }));
}
writeReadings(db);
db.pragma(`user_version = ${PACK_REVISION}`);
db.close();

const { searchMonsters, searchItems, getEntryDetail } = await import("../src/lib/content/index.ts");
const { resolveMonster } = await import("../src/lib/bestiary/index.ts");
const names = (rows) => rows.map((row) => `${row.documentSlug}/${row.slug}`).sort();

await test("A search lists the SRD's goblin, never Level Up's goblin of the same name.", () => {
  assert.deepEqual(names(searchMonsters({ q: "goblin" })), ["wotc-srd/goblin"]);
  assert.deepEqual(names(searchMonsters({ q: "goblin", unoffered: true })), ["wotc-srd/goblin"], "browsing does not list the twin either");
});

await test("Level Up's twin of an SRD item is not listed beside it.", () => {
  assert.deepEqual(names(searchItems({ q: "bag of holding" })), ["wotc-srd/bag-of-holding"]);
});

await test("A twin's slug answers as the SRD entry: a world pack naming goblin-a5e fights the SRD goblin.", () => {
  assert.equal(getEntryDetail("monsters", "goblin-a5e")?.slug, "goblin");
  const resolved = resolveMonster("goblin-a5e", { setting: "classic-fantasy" });
  assert.equal(resolved?.stats.attacks[0]?.name, "Scimitar", "the SRD block's scimitar, not the Menagerie's shortsword");
});

await test("An entry built on strife is not offered for play, and the reference still finds it, labeled.", () => {
  assert.deepEqual(names(searchMonsters({ q: "wyrmling" })), [], "the encounter roster and the GM's picks do not get it");
  const browsed = searchMonsters({ q: "wyrmling", unoffered: true });
  assert.deepEqual(names(browsed), ["menagerie/earth-dragon-wyrmling-a5e"]);
  assert.deepEqual(browsed[0].needs, ["strife"]);
  assert.deepEqual(names(searchItems({ q: "dice of the gambler" })), [], "nor is an item whose expertise die it does not roll");
  assert.deepEqual(searchItems({ q: "dice of the gambler", unoffered: true })[0]?.needs, ["expertise dice"]);
});

await test("A ley line rider is labeled but still offered: the GM places the ley lines.", () => {
  const found = searchMonsters({ q: "ley wisp" });
  assert.deepEqual(names(found), ["tob2/ley-wisp"]);
  assert.deepEqual(found[0].needs, ["ley lines"]);
});

await test("The label says what an entry uses and what that means at this table.", () => {
  assert.equal(logic.needsLabel(["strife"]), "Uses strife");
  assert.equal(logic.needsLabel(["fatigue", "expertise dice", "ley lines"]), "Uses fatigue, expertise dice and ley lines");
  assert.match(logic.needsNote(["strife"]), /Level Up Advanced 5e, which this game does not play\. It is not offered for play here/);
  assert.match(logic.needsNote(["ley lines"]), /Deep Magic: the GM decides where they run\. The GM plays that part\./);
  assert.equal(logic.needsLabel([]), null);
  assert.equal(logic.offeredInPlay(["bloodied", "ley lines"]), true);
  assert.equal(logic.offeredInPlay(["bloodied", "rattled"]), false);
  assert.equal(logic.isLevelUpTwin({ documentSlug: "menagerie", name: "Goblin" }, new Set(["goblin"])), true);
  assert.equal(logic.isLevelUpTwin({ documentSlug: "tob", name: "Goblin" }, new Set(["goblin"])), false, "only Level Up's books rewrite the SRD's entries");
});

fs.rmSync(dir, { recursive: true, force: true });
finish();
