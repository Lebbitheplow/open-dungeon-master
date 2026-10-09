// What a workshop copy of a published thing keeps. A DM who starts a
// monster, an item, a spell or a character option from something in the
// books expects the copy to work the way the original does at the table
// until they change it; this checks that against every row the content pack
// carries (and a fixture of SRD rows when it is not installed, as in CI),
// through the same functions the workshop's routes run.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { getContentDb } = await import("../src/lib/content/db.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { draftFromData, draftFromStats, draftToData } = await import("../src/lib/bestiary/monster-draft.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}\n${error.message}`;
    throw error;
  }
}

const db = getContentDb();
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/srd-monster-rows.json", import.meta.url), "utf8"));

function monsterRows(document) {
  if (!db) {
    return fixture.rows.map((row) => ({ name: row.name, document_slug: "wotc-srd", cr: row.cr, data: row.data }));
  }
  const sql = document ? "SELECT name, document_slug, cr, data_json FROM monsters WHERE document_slug = ?" : "SELECT name, document_slug, cr, data_json FROM monsters";
  return db.prepare(sql).all(...(document ? [document] : [])).map((row) => ({ ...row, data: JSON.parse(row.data_json) }));
}

// Sizes compare in one case: the pack prints "large", the workshop "Large",
// and every reader lowers it (statblock.ts sizeRank).
// Keys are sorted, because the draft rebuilds each object in its own order.
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}
const comparable = (stats) =>
  JSON.stringify(sorted(stats), (key, value) => ((key === "size" || key === "maxSize") && typeof value === "string" ? value.toLowerCase() : value));

// The block a DM gets after "start from" and a save: stored as JSON, read
// back through the draft boundary the bestiary routes use.
function throughWorkshop(name, stats) {
  const stored = JSON.parse(JSON.stringify(draftToData(draftFromStats(name, stats), "")));
  return draftFromData(name, stored).stats;
}

const ENGINE_FIELDS = ["specials", "spellcasting", "regeneration", "routines"];
const ATTACK_FIELDS = ["mode", "spellAttack", "reach", "range", "riders", "onHit"];

test("every SRD monster comes back from the workshop exactly as the engine reads it from the book", () => {
  const changed = [];
  const rows = monsterRows("wotc-srd");
  assert.ok(rows.length >= (db ? 300 : fixture.rows.length));
  for (const row of rows) {
    const published = parseMonster(row.data, typeof row.data.cr === "number" ? row.data.cr : Number(row.cr));
    if (comparable(published) !== comparable(throughWorkshop(row.name, published))) {
      changed.push(row.name);
    }
  }
  assert.deepEqual(changed, [], `changed by a workshop round trip: ${changed.join(", ")}`);
});

test("no monster in the pack loses an action, a spell list, regeneration, a routine or an attack's rider on the way through", () => {
  const lost = [];
  for (const row of monsterRows()) {
    const published = parseMonster(row.data, typeof row.data.cr === "number" ? row.data.cr : Number(row.cr));
    const back = throughWorkshop(row.name, published);
    for (const field of ENGINE_FIELDS) {
      if (comparable(published[field]) !== comparable(back[field])) {
        lost.push(`${row.document_slug}/${row.name}: ${field}`);
      }
    }
    published.attacks.forEach((attack, index) => {
      for (const field of ATTACK_FIELDS) {
        // A range of nothing ("0/0 ft.") is the pack's slip, not a range.
        if (field === "range" && attack.range && !attack.range.normal) continue;
        if (comparable(attack[field]) !== comparable(back.attacks[index]?.[field])) {
          lost.push(`${row.document_slug}/${row.name}: ${attack.name}.${field}`);
        }
      }
    });
  }
  // A handful of pack rows print an ability whose "name" is a whole
  // sentence past the 120 characters a name may have.
  const sentences = lost.filter((entry) => /: specials$/.test(entry));
  assert.ok(sentences.length <= 2, `lost: ${lost.slice(0, 20).join("; ")}`);
  assert.deepEqual(lost.filter((entry) => !/: specials$/.test(entry)), []);
});

test("an attack's bonus is the one its line prints, where the pack's field misprints it", () => {
  const rows = new Map(monsterRows("wotc-srd").map((row) => [row.name, row]));
  const bonus = (name, attack) => {
    const row = rows.get(name);
    if (!row) return null;
    return parseMonster(row.data, row.cr).attacks.find((entry) => entry.name === attack)?.toHit ?? null;
  };
  // SRD 5.1: Vampire Spawn's bite is +6 (the pack's field says +61), the
  // purple worm's +14 (+9), the black bear's +4 (+3), and the rug of
  // smothering's Smother +5 (0, which left it with no attack at all).
  for (const [name, attack, want] of [
    ["Vampire Spawn", "Bite", 6],
    ["Purple Worm", "Bite", 14],
    ["Black Bear", "Bite", 4],
    ["Rug of Smothering", "Smother", 5],
  ]) {
    if (rows.has(name)) {
      assert.equal(bonus(name, attack), want, `${name} ${attack}`);
    }
  }
});

console.log(`test-workshop-fidelity: ${passed} passed${db ? "" : " (fixture rows, no content pack)"}`);
