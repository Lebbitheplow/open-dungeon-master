// The rest of a rollable table: weights written as "x3", rows that are a
// thing rather than a sentence, drawing without replacement, and a row that
// rolls another table. See docs/workshop-parity-audit.md phase 14.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  describeRollChain,
  dieForTable,
  followTableRefs,
  formatRollTable,
  parseRollTable,
  parseRowText,
  remainingResults,
} = await import("../src/lib/dm/roll-table-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a bare row can carry a weight, which becomes a range", () => {
  const entries = parseRollTable("x3 A goblin patrol\nNothing\n2x Wolves");
  assert.deepEqual(
    entries.map((entry) => [entry.min, entry.max, entry.text]),
    [
      [1, 3, "A goblin patrol"],
      [4, 4, "Nothing"],
      [5, 6, "Wolves"],
    ],
  );
  assert.equal(dieForTable(entries), 6);
  // The weight round-trips as the range it became.
  assert.equal(formatRollTable(entries).split("\n")[0], "1-3. A goblin patrol");
});

test("a row can be a thing: another table, a monster, an item", () => {
  assert.deepEqual(parseRowText("@table: Gems"), { text: "Gems", ref: { kind: "table", name: "Gems" } });
  assert.deepEqual(parseRowText("@Monster:wolf"), { text: "wolf", ref: { kind: "monster", name: "wolf" } });
  assert.deepEqual(parseRowText("A plain sentence"), { text: "A plain sentence" });
  const entries = parseRollTable("1-2. @table: Gems\n3. @item: Potion of Healing\n4. Dust");
  assert.equal(entries[0].ref.kind, "table");
  assert.equal(entries[1].ref.name, "Potion of Healing");
  assert.equal(entries[2].ref, undefined);
  // And the references survive the round trip through the editor's text.
  const again = parseRollTable(formatRollTable(entries));
  assert.deepEqual(again, entries);
});

test("drawing without replacement leaves only what has not been dealt", () => {
  const entries = parseRollTable("1. A\n2. B\n3. C\n4. D");
  assert.deepEqual(remainingResults(entries, []), [1, 2, 3, 4]);
  assert.deepEqual(remainingResults(entries, [2, 4]), [1, 3]);
  assert.deepEqual(remainingResults(entries, [1, 2, 3, 4]), []);
  // A gap is never dealt: it was never a result.
  const gappy = parseRollTable("1. A\n3. C");
  assert.deepEqual(remainingResults(gappy, []), [1, 3]);
});

test("a row that points at another table rolls it, and a loop stops", () => {
  const gems = { name: "Gems", entries: parseRollTable("1-3. A garnet\n4. @table: Treasure") };
  const treasure = { name: "Treasure", entries: parseRollTable("1. Coins\n2. @table: Gems") };
  const rolls = [2];
  const roll = () => rolls.shift() ?? 1;
  const chain = followTableRefs(
    { table: "Treasure", die: 2, total: 2, entry: treasure.entries[1] },
    [gems, treasure],
    roll,
  );
  assert.deepEqual(
    chain.map((step) => `${step.table}:${step.total}`),
    ["Treasure:2", "Gems:2"],
  );
  assert.equal(chain[1].entry.text, "A garnet");
  const lines = describeRollChain(chain);
  assert.ok(lines[1].includes("A garnet"));
  // Gems -> Treasure -> Gems: the second visit to a table stops the chain.
  const looped = followTableRefs(
    { table: "Gems", die: 4, total: 4, entry: gems.entries[1] },
    [gems, treasure],
    () => 2,
  );
  assert.deepEqual(
    looped.map((step) => `${step.table}:${step.die}`),
    ["Gems:4", "Treasure:4", "Gems:0"],
  );
  assert.ok(describeRollChain(looped)[2].includes("no such table"));
  // A reference to a table that does not exist says so.
  const missing = followTableRefs(
    { table: "Treasure", die: 2, total: 2, entry: { min: 2, max: 2, text: "Relics", ref: { kind: "table", name: "Relics" } } },
    [treasure],
    () => 1,
  );
  assert.equal(missing.length, 2);
  assert.equal(missing[1].die, 0);
});

console.log(`test-roll-table-extras: ${passed} passed`);
