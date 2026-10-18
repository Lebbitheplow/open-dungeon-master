// What people write is found by Unicode in the database too: a search for
// "épée" finds "Épée de feu" in the content pack and on a homebrew shelf,
// and a shop, a Cast member, a renamed bundle monster or a homebrew slug is
// the same thing across Unicode case, form and spacing. SQLite folds ASCII
// only (LIKE, lower(), NOCASE), so these match in code. Real encrypted
// throwaway database and a small pack built with the importer's own schema;
// every lookup is also run where another campaign or user holds the same
// names, which it must never find.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import Database from "better-sqlite3-multiple-ciphers";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-unicode-lookups-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const pack = path.join(dir, "open5e.sqlite");
{
  const importer = fs.readFileSync(path.join(import.meta.dirname, "import-open5e.mjs"), "utf8");
  const schema = /db\.exec\(`(\s*CREATE TABLE spells[\s\S]*?)`\);/.exec(importer)?.[1];
  assert.ok(schema, "the importer's schema is found");
  const db = new Database(pack);
  db.exec(schema);
  const item = db.prepare(
    `INSERT INTO items (slug, name, document_slug, kind, rarity, cost, category, weight, data_json) VALUES (?, ?, 'wotc-srd', ?, '', '', '', 0, '{}')`,
  );
  item.run("epee-de-feu", "Épée de feu", "magic_item");
  item.run("longsword", "Longsword", "weapon");
  item.run("schwert", "Schwert der Straße", "weapon");
  item.run("shchit", "Щит Олега", "armor");
  item.run("longsword-1", "Longsword +1", "weapon");
  item.run("tools", "Mason's Tools (10 GP)", "gear");
  const monster = db.prepare(`INSERT INTO monsters (slug, name, document_slug, cr, type, data_json) VALUES (?, ?, 'wotc-srd', ?, 'construct', '{}')`);
  monster.run("olmuhle-golem", "Ölmühle-Golem", 3);
  monster.run("goblin", "Goblin", 0.25);
  monster.run("citta-guard", "Guardia della Città", 6);
  db.prepare(`INSERT INTO feats (slug, name, document_slug, data_json) VALUES ('elan', 'Élan Vital', 'wotc-srd', '{}')`).run();
  db.close();
}
process.env.CONTENT_DB_PATH = pack;
register("./lib/register-alias.mjs", import.meta.url);

const { createCompanionUser, createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { searchFeats, searchItems, searchMonsters } = await import("../src/lib/content/index.ts");
const { createHomebrew, findHomebrewBySlug, isTableGearName } = await import("../src/lib/db/homebrew.ts");
const { findShopByName, insertShop } = await import("../src/lib/db/shops.ts");
const { createRecord, getWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { createNpcFromDraft, listNpcs } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const decomposed = (text) => text.normalize("NFD");
const names = (rows) => rows.map((row) => row.name);
const alice = createUser("alice", "x");
const bruno = createUser("bruno", "x");
const table = (owner, tableLanguage) =>
  createCampaign(owner.id, {
    title: "Table",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { tableLanguage },
  });

test("a search a person types finds pack names across Unicode case, form and spacing", () => {
  for (const q of ["épée", "ÉPÉE", decomposed("Épée"), "épée  de", " Épée de feu "]) {
    assert.deepEqual(names(searchItems({ q })), ["Épée de feu"], JSON.stringify(q));
  }
  assert.deepEqual(names(searchItems({ q: "STRASSE" })), ["Schwert der Straße"], "case folds in full: ß is ss");
  assert.deepEqual(names(searchItems({ q: "straße" })), ["Schwert der Straße"]);
  assert.deepEqual(names(searchItems({ q: "щит" })), ["Щит Олега"]);
  assert.deepEqual(names(searchItems({ q: "LONG" })), ["Longsword", "Longsword +1"], "ASCII matches as LIKE did");
  assert.deepEqual(names(searchItems({ q: "", kind: "weapon" })), ["Longsword", "Longsword +1", "Schwert der Straße"]);
  // A bonus is searched as written: "+1" is not any name holding a "1".
  assert.deepEqual(names(searchItems({ q: "+1" })), ["Longsword +1"]);
  assert.deepEqual(names(searchItems({ q: "1" })), ["Longsword +1", "Mason's Tools (10 GP)"]);
  // Symbols alone key to nothing: the search is an empty box.
  assert.equal(searchItems({ q: "&" }).length, searchItems({}).length);
  assert.deepEqual(names(searchMonsters({ q: "ölmühle" })), ["Ölmühle-Golem"]);
  assert.deepEqual(names(searchMonsters({ q: "città", maxCr: 5 })), [], "the other conditions still hold");
  assert.deepEqual(names(searchMonsters({ q: "CITTÀ" })), ["Guardia della Città"]);
  assert.ok(names(searchFeats({ q: "élan" })).includes("Élan Vital"));
  // Paging is over the found names, in the table's order.
  assert.deepEqual(names(searchMonsters({ limit: 1, offset: 1 })), ["Guardia della Città"]);
});

test("a homebrew search finds the author's entry across case and form, and never another author's", () => {
  createHomebrew(alice.id, { kind: "item", name: "Épée de lune", data: { itemKind: "weapon" } });
  createHomebrew(bruno.id, { kind: "item", name: "Épée de Bruno", data: { itemKind: "weapon" } });
  assert.deepEqual(names(searchItems({ q: decomposed("ÉPÉE DE"), userId: alice.id })), ["Épée de lune", "Épée de feu"]);
  assert.deepEqual(names(searchItems({ q: "épée de bruno", userId: alice.id })), []);
});

test("homebrew slugs keep a name's letters, so names in another script never share one", () => {
  const first = createHomebrew(alice.id, { kind: "item", name: "Ёлка", data: {} });
  const second = createHomebrew(alice.id, { kind: "item", name: "Дуб", data: {} });
  assert.equal(first.slug, "ёлка");
  assert.equal(second.slug, "дуб");
  assert.equal(findHomebrewBySlug([alice.id], "item", "ёлка")?.name, "Ёлка");
  assert.equal(findHomebrewBySlug([bruno.id], "item", "ёлка"), null);
  assert.equal(createHomebrew(alice.id, { kind: "item", name: "Longsword of Dawn", data: {} }).slug, "longsword_of_dawn");
});

test("a table knows its workshop gear by name, however it is written, and never another author's", () => {
  const camp = table(alice, "fr");
  createHomebrew(alice.id, { kind: "item", name: "Corde-pont d'Argent", data: { itemKind: "gear" } });
  createHomebrew(bruno.id, { kind: "item", name: "Lanterne de Bruno", data: { itemKind: "gear" } });
  assert.equal(isTableGearName(camp.id, "corde pont d’argent"), true);
  assert.equal(isTableGearName(camp.id, decomposed("CORDE-PONT D'ARGENT")), true);
  assert.equal(isTableGearName(camp.id, "Lanterne de Bruno"), false);
});

test("a companion's username keeps an ASCII name and leaves out one with nothing left", () => {
  assert.match(createCompanionUser("Élodie Marsh").username, /^companion-elodie_marsh-[0-9a-f]{8}$/);
  assert.match(createCompanionUser("Ёлка").username, /^companion-[0-9a-f]{8}$/);
});

test("a shop is found by name across Unicode case, in its own campaign only", () => {
  const italian = table(alice, "italian");
  const other = table(bruno, "italian");
  insertShop(italian.id, { name: "Bottega di Niccolò" });
  insertShop(other.id, { name: "Bottega di Niccolò" });
  const found = findShopByName(italian.id, decomposed("BOTTEGA DI NICCOLÒ"));
  assert.equal(found?.campaignId, italian.id);
  assert.equal(findShopByName(table(alice, "italian").id, "bottega di niccolò"), null);
});

test("WorldForge refuses a second Cast member under another case or form of a name, campaign by campaign", () => {
  const german = table(alice, "german");
  const other = table(bruno, "german");
  const npcType = getWorldDoc(german.id).types.find((type) => type.shelf === "npc");
  assert.ok(npcType);
  assert.ok("ref" in createRecord(german.id, npcType, { name: "Äbtissin Ölmühle" }));
  const again = createRecord(german.id, npcType, { name: decomposed("ÄBTISSIN  ÖLMÜHLE") });
  assert.equal(again.status, 409);
  assert.ok("ref" in createRecord(other.id, npcType, { name: "äbtissin ölmühle" }), "another campaign's Cast is its own");
});

test("an imported monster renamed beside the importer's own is renamed in the Cast's stat blocks too", () => {
  const author = createUser("author", "x");
  const workshop = createWorkshop(author.id, { title: "Mühle" });
  createHomebrewMonster(author.id, { ...draftFromCr("Ölmühle-Golem", 2), stats: { ...draftFromCr("Ölmühle-Golem", 2).stats, maxHp: 30 } }, "");
  const draft = normalizeNpcDraft({ name: "Der Wächter", statBlock: "ÖLMÜHLE-GOLEM" });
  assert.ok(!("error" in draft));
  createNpcFromDraft(workshop.id, draft.draft);
  const manifest = { name: "Mühle", blurb: "A mill.", inspiredBy: "Original work" };
  const bundle = readBundle(JSON.stringify(exportWorkshopBundle(workshop.id, manifest).bundle)).bundle;
  // The importer has a monster of that name with other rules.
  createHomebrewMonster(alice.id, { ...draftFromCr("Ölmühle-Golem", 2), stats: { ...draftFromCr("Ölmühle-Golem", 2).stats, maxHp: 99 } }, "");
  const imported = importWorkshopBundle(alice.id, bundle);
  const [guard] = listNpcs(imported.workshopId);
  assert.notEqual(guard.statBlock, "ÖLMÜHLE-GOLEM");
  assert.match(guard.statBlock, /^Ölmühle-Golem /);
  // The author's own workshop keeps its name.
  assert.equal(listNpcs(workshop.id)[0].statBlock, "ÖLMÜHLE-GOLEM");
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM npcs WHERE stat_block = ?`).get(guard.statBlock).n, 1);
});

console.log(`\n${passed} unicode lookup tests passed`);
removeTempDir(dir);
