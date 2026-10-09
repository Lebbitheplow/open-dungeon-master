// Every page of the bundled book has somewhere to go in ODM, and what the
// book prints survives the trip into a workshop copy, counted page by page
// (docs/workshop-rulebook-audit-pr169.md F18, F19, F20).
//
//   - The crosswalk (src/lib/rulebook/crosswalk.ts) gives each of the 933
//     pages an editor, a template, or a rules row with an honest support
//     level; every one of the 36 rules pages has a row written for it, not
//     the default.
//   - Each page with an editor is found in the catalog under the name the
//     crosswalk gives, with the pack and, for spells and magic items, with
//     none.
//   - A ledger, with its denominators, of what a copy keeps: every spell's
//     casting facts, block and engine name; every magic item's engine
//     fields and weight; every monster's printed entries. It prints on every
//     run, and the counts are asserted, so a claim of "all of them" has a
//     number behind it.
//   - The tools F19 added: the half-dragon template, an object's damage
//     threshold, a sentient item's line.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-rulebook-crosswalk");
const { rulebookPages } = await import("../src/lib/rulebook/book.ts");
const { crosswalkAll, ruleRowIds } = await import("../src/lib/rulebook/crosswalk.ts");
const { bundledSpellRows, bundledItemRows } = await import("../src/lib/rulebook/catalog-rows.ts");
const { withMechanics } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { normalizeHomebrewData, normalizeSpellMech } = await import("../src/lib/homebrew/gear.ts");
const { spellFactsFor } = await import("../src/lib/content/index.ts");
const { factsFromRow, engineSpellNamed } = await import("../src/lib/srd/spell-facts.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { draftFromCr, draftFromData, draftFromStats, draftToData } = await import("../src/lib/bestiary/monster-draft.ts");
const { applyHalfDragon } = await import("../src/lib/bestiary/half-dragon.ts");
const { normalizeSentience, sentienceLine } = await import("../src/lib/homebrew/sentience.ts");
const { gearFromHomebrewData } = await import("../src/lib/homebrew/item-data.ts");

const pages = rulebookPages();
const walks = crosswalkAll();
const byPage = new Map(walks.map((walk) => [walk.page, walk]));
const pagesOf = (kind) => pages.filter((page) => page.kind === kind);
const lower = (text) => String(text).trim().toLowerCase();

// The pack's SRD rows of a table, by lowercased name.
function packRows(table, extra = "") {
  if (!hasPack) return new Map();
  const rows = getContentDb().prepare(`SELECT * FROM ${table} WHERE document_slug = 'wotc-srd' ${extra}`).all();
  return new Map(rows.map((row) => [lower(row.name), { ...row, source: "open5e", documentSlug: "wotc-srd", data: JSON.parse(row.data_json) }]));
}

await test("F18, F19: all 933 pages have a destination, and the counts by kind are the book's.", () => {
  assert.equal(pages.length, 933);
  assert.equal(walks.length, 933);
  const counts = Object.fromEntries(["rules", "race", "class", "spell", "item", "monster"].map((kind) => [kind, pagesOf(kind).length]));
  assert.deepEqual(counts, { rules: 36, race: 9, class: 12, spell: 319, item: 239, monster: 318 });
  for (const walk of walks) {
    assert.ok(["engine", "structured", "editable", "reference"].includes(walk.support), `${walk.page}: support "${walk.support}"`);
    assert.ok(walk.where.trim(), `${walk.page} says nowhere`);
    if (walk.kind !== "rules") assert.ok(walk.editor, `${walk.page} has no editor`);
  }
});

await test("F19: every one of the 36 rules pages has a row written for it.", () => {
  const rows = new Set(ruleRowIds());
  const missing = pagesOf("rules").filter((page) => !rows.has(page.id)).map((page) => page.id);
  assert.deepEqual(missing, []);
  assert.equal(byPage.get("half-dragon-template").template, "half-dragon");
  assert.equal(byPage.get("customizing-npcs").editor, "monster");
});

await test("F18: every class page names its class, and the workshop can write a subclass for it.", () => {
  for (const page of pagesOf("class")) {
    assert.equal(byPage.get(page.id).editor, "archetype");
    assert.equal(byPage.get(page.id).classId, page.id);
  }
});

await test("F18: every spell, item and monster page is found in the catalog under the name the crosswalk gives.", () => {
  const lost = [];
  const spells = hasPack ? packRows("spells") : new Map(bundledSpellRows().map((row) => [lower(row.name), row]));
  const items = hasPack ? packRows("items") : new Map(bundledItemRows().map((row) => [lower(row.name), row]));
  const monsters = packRows("monsters");
  for (const page of pages) {
    const walk = byPage.get(page.id);
    if (walk.template && walk.editor === "monster") continue;
    const name = lower(walk.catalogName ?? page.title);
    const shelf = page.kind === "spell" ? spells : page.kind === "item" ? items : page.kind === "monster" ? monsters : null;
    if (!shelf || (page.kind === "monster" && !hasPack)) continue;
    // A page the pack files under no SRD row (the +1, +2 and +3 families)
    // starts from the book's own row, which the route serves with book=1.
    const bookRow = page.kind === "item" ? bundledItemRows().some((row) => row.rulebook === page.id) : page.kind === "spell" ? bundledSpellRows().some((row) => row.rulebook === page.id) : false;
    if (!shelf.has(name) && !bookRow) lost.push(`${page.kind} ${page.id} (${walk.catalogName ?? page.title})`);
  }
  assert.deepEqual(lost, [], `${lost.length} pages the catalog cannot find:\n${lost.slice(0, 20).join("\n")}`);
});

await test("F18: the rulebook route gives every page its crosswalk.", async () => {
  const world = await openWorld();
  const route = await world.route("rulebook/pages/[id]");
  world.signIn(world.owner);
  for (const id of ["web", "longsword", "half-dragon-template", "objects", "dwarf", "wizard"]) {
    const page = pages.find((entry) => entry.id === id) ?? pages.find((entry) => entry.kind === "item");
    const out = await call(route, "GET", undefined, { id: page.id }, `http://test/api/rulebook/pages/${page.id}`);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.ok(out.json.crosswalk?.support && out.json.crosswalk.where, `${page.id} has no crosswalk`);
  }
  world.close();
});

// ---- the ledger ----

const ledger = [];
const FACT_KEYS = ["level", "castingTime", "verbal", "somatic", "material", "materialCostGp", "materialConsumed", "ritual", "concentration", "range"];

await test("F20: every SRD spell's copy keeps its casting facts, its block and the spell it runs as.", () => {
  const spells = hasPack ? [...packRows("spells").values()] : bundledSpellRows();
  const rows = withMechanics("spells", spells);
  const lost = [];
  let block = 0;
  let engine = 0;
  for (const row of rows) {
    const draft = draftFromCatalog("spell", row);
    const saved = normalizeHomebrewData("spell", draft.data, `${row.name} Copy`);
    assert.ok(!("error" in saved), `${row.name}: ${saved.error}`);
    const copy = factsFromRow({ name: `${row.name} Copy`, level: saved.data.level, data: saved.data, ritual: saved.data.ritual, concentration: saved.data.concentration, homebrew: true });
    const published = spellFactsFor(row.name);
    for (const key of FACT_KEYS) {
      if (JSON.stringify(copy[key]) !== JSON.stringify(published[key])) lost.push(`${row.name}: ${key} ${JSON.stringify(published[key])} became ${JSON.stringify(copy[key])}`);
    }
    if (row.mech) {
      block += 1;
      if (JSON.stringify(saved.data.mech) !== JSON.stringify(normalizeSpellMech(row.mech))) lost.push(`${row.name}: block changed`);
    }
    const runsAs = engineSpellNamed(row.name);
    if (runsAs) {
      engine += 1;
      if (saved.data.runsAs !== runsAs) lost.push(`${row.name}: runs as ${saved.data.runsAs ?? "nothing"}, not ${runsAs}`);
    }
  }
  ledger.push(["spells", pagesOf("spell").length, rows.length, rows.length - new Set(lost.map((line) => line.split(":")[0])).size, `${block} with a block, ${engine} with an engine name`]);
  assert.equal(rows.length, 319);
  assert.deepEqual(lost, [], `${lost.length} facts lost:\n${lost.slice(0, 25).join("\n")}`);
});

await test("F20: every SRD magic item's copy keeps every engine field and its weight.", () => {
  const items = hasPack ? [...packRows("items", "AND kind = 'magic_item'").values()] : bundledItemRows();
  const rows = withMechanics("items", items);
  const lost = [];
  let engined = 0;
  for (const row of rows) {
    const draft = draftFromCatalog("item", row);
    const saved = normalizeHomebrewData("item", draft.data, `${row.name} Copy`);
    if ("error" in saved) {
      lost.push(`${row.name}: ${saved.error}`);
      continue;
    }
    if (row.gear) engined += 1;
    for (const key of Object.keys(row.gear ?? {})) {
      if (row.gear[key] !== undefined && saved.data[key] === undefined) lost.push(`${row.name}: ${key} dropped`);
    }
    const published = gearFromHomebrewData(row.name, { ...(row.gear ?? {}), itemKind: row.kind });
    const copied = gearFromHomebrewData(`${row.name} Copy`, saved.data);
    if (JSON.stringify(published?.magic ?? null) !== JSON.stringify(copied?.magic ?? null)) lost.push(`${row.name}: its magic reads differently`);
  }
  ledger.push(["magic items", pagesOf("item").length, rows.length, rows.length - new Set(lost.map((line) => line.split(":")[0])).size, `${engined} with engine fields`]);
  assert.ok(rows.length >= 200);
  assert.deepEqual(lost, [], `${lost.length} fields lost:\n${lost.slice(0, 25).join("\n")}`);
});

await test("F20: every SRD monster's copy keeps every entry its row prints.", () => {
  if (!hasPack) {
    ledger.push(["monsters", pagesOf("monster").length, 0, 0, "no pack: monster rows are the pack's"]);
    return;
  }
  const rows = [...packRows("monsters").values()];
  let whole = 0;
  for (const row of rows) {
    const reloaded = draftFromData(`${row.name} Copy`, draftToData(draftFromStats(`${row.name} Copy`, parseMonster(row.data, Number(row.cr) || 0)), ""));
    const kept = new Set(Object.values(reloaded.stats.printed ?? {}).flat().filter((entry) => entry?.name).map((entry) => entry.name));
    const printed = ["special_abilities", "actions", "reactions", "legendary_actions"].flatMap((field) => (Array.isArray(row.data[field]) ? row.data[field] : []));
    if (printed.every((entry) => !String(entry.name ?? "").trim() || !String(entry.desc ?? "").trim() || kept.has(String(entry.name).replace(/\s+/g, " ").trim().slice(0, 80)))) whole += 1;
  }
  ledger.push(["monsters", pagesOf("monster").length, rows.length, whole, "printed entries kept whole"]);
  assert.equal(whole, rows.length);
});

await test("F20: the ledger, with its denominators.", () => {
  const support = Object.fromEntries(["spell", "item", "monster", "race", "class", "rules"].map((kind) => [kind, walks.filter((walk) => walk.kind === kind).reduce((out, walk) => ({ ...out, [walk.support]: (out[walk.support] ?? 0) + 1 }), {})]));
  console.log(`\nCoverage ledger (${hasPack ? "with the content pack" : "no content pack"}):`);
  console.log("  kind         book pages  catalog rows  copies kept whole  notes");
  for (const [kind, book, rows, whole, note] of ledger) console.log(`  ${kind.padEnd(12)} ${String(book).padStart(10)}  ${String(rows).padStart(12)}  ${String(whole).padStart(17)}  ${note}`);
  console.log("  support by kind (crosswalk.ts):");
  for (const [kind, counts] of Object.entries(support)) console.log(`    ${kind.padEnd(8)} ${JSON.stringify(counts)}`);
  for (const [kind, , rows, whole] of ledger) assert.equal(whole, rows, `${kind}: ${rows - whole} copies lose something`);
  assert.equal(Object.values(support).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0), 933);
});

// ---- the tools F19 added ----

await test("F19: the half-dragon template gives a giant the senses, the resistance, Draconic and its colour's breath; an undead is refused.", () => {
  const ogre = { ...draftFromCr("Marsh Ogre", 3), stats: { ...draftFromCr("Marsh Ogre", 3).stats, type: "giant", size: "Large", languages: "Giant" } };
  const made = applyHalfDragon(ogre, "red");
  assert.ok("draft" in made, made.error);
  const stats = made.draft.stats;
  assert.equal(stats.senses.blindsight, 10);
  assert.equal(stats.senses.darkvision, 60);
  assert.match(String(stats.resist), /fire/);
  assert.match(stats.languages, /Draconic/);
  assert.ok(stats.specials?.some((entry) => /breath/i.test(entry.name)), "no breath weapon the engine runs");
  assert.ok("error" in applyHalfDragon({ ...ogre, stats: { ...ogre.stats, type: "undead" } }, "red"));
});

await test("F19: a blow under an object's damage threshold takes nothing off; one over it lands whole.", async () => {
  const world = await openWorld();
  const glance = await world.invoke("damage_object", { name: "Portcullis", size: "large", damage: "6", threshold: 10 });
  assert.equal(glance.ok, true, glance.error);
  assert.equal(glance.result.damageTaken, 0, "a blow under the threshold did damage");
  const blow = await world.invoke("damage_object", { name: "Portcullis", size: "large", damage: "12", threshold: 10 });
  assert.equal(blow.result.damageTaken, 12);
  world.close();
});

await test("F19: a sentient item keeps its scores, voice and purpose, and the DM is told how a conflict is settled.", () => {
  const sentience = normalizeSentience({ int: 14, wis: 12, cha: 18, alignment: "chaotic good", communication: "telepathy", purpose: "slay dragons" });
  const line = sentienceLine(sentience);
  assert.match(line, /Int 14, Wis 12, Cha 18/);
  assert.match(line, /telepathically/);
  assert.match(line, /purpose: slay dragons/);
  assert.match(line, /Charisma/);
});

finish();
