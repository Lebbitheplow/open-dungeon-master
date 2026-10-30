// Every reader that turns content-pack prose into mechanics, held to a
// golden set (issue #570, "Rules and content"): the spell, monster, feat,
// race, class, background and subclass readers that src/lib/content/
// entry-reading.ts names, each fed rows copied verbatim from the pack
// (scripts/fixtures/reader-golden/<reader>.json, cut to the fields the
// reader reads) and held to an answer a person checked against the row's
// text. Several cases are the bugs this set found: Deep Magic's Accelerate
// and Blood Armor read as save spells from "advantage on Dexterity saving
// throws", "half the damage with a successful save" read as full damage,
// "make a melee weapon attack" read as damage that never misses, and Tome of
// Heroes' Soulspy getting its Cantrips at 10th level.
//
// The count: how many of the pack's entries each reader could not read
// (missing, or text it left unread), in scripts/fixtures/reader-unread.json.
// CI has no pack, so there this suite prints the committed count; with a
// pack it counts again and fails when the number moved, so a change to a
// reader is seen in what it reads across the whole pack, not only here.
//
// After a reviewed change: `node scripts/test-reader-golden.mjs --write`
// rewrites the expected answers (keep only the ones you checked), the
// checked list and, with a pack, the count.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-reader-golden");
const WRITE = process.argv.includes("--write");
const { readEntry } = await import("../src/lib/content/entry-reading.ts");
const { READING_KINDS, reading, readingId, readingIsBestEffort } = await import("../src/lib/content/reading-logic.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { readingRowOf } = await import("./lib/pack-readings.mjs");

const fixture = (kind) => new URL(`./fixtures/reader-golden/${kind}.json`, import.meta.url);
const checkedFile = new URL("../src/lib/content/checked-readings.json", import.meta.url);
const countFile = new URL("./fixtures/reader-unread.json", import.meta.url);
const goldenOf = (kind) => JSON.parse(fs.readFileSync(fixture(kind), "utf8"));

// What each reader made of the whole pack.
const TABLES = { spell: "spells", monster: "monsters", feat: "feats", race: "races", class: "classes", background: "backgrounds", archetype: "archetypes" };
function countPack(db) {
  const counts = {};
  for (const kind of READING_KINDS) {
    const tally = { entries: 0, "hand-written": 0, parsed: 0, missing: 0, "with unread": 0, unread: {} };
    for (const raw of db.prepare(`SELECT * FROM ${TABLES[kind]} ORDER BY document_slug, slug`).all()) {
      // Each row as the pack build reads it (a Level Up spell's terms in
      // 2014 words), so the count is the stored readings'.
      const entry = readEntry(kind, readingRowOf(kind, raw));
      tally.entries += 1;
      tally[entry.source] += 1;
      if (entry.unread.length) {
        tally["with unread"] += 1;
      }
      // A monster's unread are its entries' names; the count is by block.
      for (const tag of kind === "monster" ? (entry.unread.length ? ["entries with numbers"] : []) : entry.unread) {
        tally.unread[tag] = (tally.unread[tag] ?? 0) + 1;
      }
    }
    tally.unread = Object.fromEntries(Object.entries(tally.unread).sort(([a], [b]) => a.localeCompare(b)));
    counts[kind] = tally;
  }
  return counts;
}

if (WRITE) {
  const ids = [];
  for (const kind of READING_KINDS) {
    const golden = goldenOf(kind);
    for (const entry of golden.cases) {
      ids.push(entry.id);
      const { checked: _checked, ...got } = readEntry(kind, entry.row);
      entry.expect = got;
    }
    fs.writeFileSync(fixture(kind), `${JSON.stringify(golden, null, 2)}\n`);
  }
  // The checked list is read when the readers load, so the suite holds
  // only on the run after a write.
  fs.writeFileSync(checkedFile, `${JSON.stringify({ ids: ids.sort() }, null, 2)}\n`);
  const db = getContentDb();
  if (db) {
    const committed = JSON.parse(fs.readFileSync(countFile, "utf8"));
    fs.writeFileSync(countFile, `${JSON.stringify({ ...committed, counts: countPack(db) }, null, 2)}\n`);
  }
  console.log("Wrote the golden answers, the checked list and, with a pack, the count. Review the diff, then run again.");
  process.exit(0);
}

const ids = [];
for (const kind of READING_KINDS) {
  for (const entry of goldenOf(kind).cases) {
    ids.push(entry.id);
    await test(`${entry.id}: ${entry.why}`, () => {
      assert.equal(entry.id, readingId(kind, entry.row), "the case's id names its row");
      const { checked, ...got } = readEntry(kind, entry.row);
      assert.deepEqual(got, entry.expect);
      assert.equal(checked, true, "a golden case reads as checked");
    });
  }
}

await test("Every reader has a golden set, and every case says why it is there.", () => {
  for (const kind of READING_KINDS) {
    const golden = goldenOf(kind);
    assert.equal(golden.reader, kind);
    // The pack prints 14 classes, 12 of them the SRD's.
    assert.ok(golden.cases.length >= 3, `${kind} needs a golden set`);
    for (const entry of golden.cases) {
      assert.ok(entry.why?.trim(), `${entry.id} says why it is golden`);
    }
  }
});

// The checked list the server reads is these cases: a golden entry is one a
// person held up against its text, so the table is not told it is a guess.
await test("The checked list is exactly the golden cases.", () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(checkedFile, "utf8")).ids, [...ids].sort());
});

await test("A parsed reading nobody checked is best effort; a hand-written one, or one with nothing to play, is not.", () => {
  const parsed = goldenOf("spell").cases.find((entry) => entry.expect.source === "parsed");
  assert.equal(readingIsBestEffort(readEntry("spell", parsed.row)), false, "checked");
  assert.equal(readingIsBestEffort(readEntry("spell", { ...parsed.row, slug: `${parsed.row.slug}-copy` })), true, "the same text unchecked");
  assert.equal(readingIsBestEffort(reading({ handWritten: { resolution: "buff" }, parsed: null, unread: [], checked: false })), false);
  assert.equal(readingIsBestEffort(reading({ handWritten: null, parsed: null, unread: [], checked: false })), false, "nothing to play is no guess");
  assert.equal(readingIsBestEffort(reading({ handWritten: null, parsed: null, unread: ["buff"], checked: false })), true, "a missed buff is");
});

const committed = JSON.parse(fs.readFileSync(countFile, "utf8"));
const db = getContentDb();
if (db) {
  const counts = countPack(db);
  await test("What each reader could not read across the pack is the count on record.", () => {
    assert.deepEqual(counts, committed.counts, "the readers read the pack differently: if that is right, run with --write and commit the count");
  });
}
for (const [kind, tally] of Object.entries(committed.counts)) {
  const unread = Object.entries(tally.unread).map(([tag, count]) => `${tag} ${count}`).join(", ");
  console.log(`  ${kind}: ${tally.entries} entries, ${tally["hand-written"]} hand-written, ${tally.parsed} parsed, ${tally.missing} missing; ${tally["with unread"]} with text left unread${unread ? ` (${unread})` : ""}`);
}

finish();
