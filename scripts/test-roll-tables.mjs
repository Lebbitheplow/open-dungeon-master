// DM roll tables: pasting one in, finding the die, and what a roll lands on.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  dieForTable,
  entryForRoll,
  formatRollTable,
  parseRollTable,
  tableGaps,
} = await import("../src/lib/dm/roll-table-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("numbered ranges parse, including the en dash a book gives you", () => {
  const entries = parseRollTable("1-5 A goblin patrol\n6–10. Nothing at all");
  assert.deepEqual(entries, [
    { min: 1, max: 5, text: "A goblin patrol" },
    { min: 6, max: 10, text: "Nothing at all" },
  ]);
});

test("single numbers parse with any of the usual separators", () => {
  const entries = parseRollTable("1. One\n2) Two\n3: Three\n4 Four");
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["One", "Two", "Three", "Four"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.min),
    [1, 2, 3, 4],
  );
});

test("bare lines are numbered in order", () => {
  const entries = parseRollTable("Rain\nFog\nClear skies");
  assert.deepEqual(entries, [
    { min: 1, max: 1, text: "Rain" },
    { min: 2, max: 2, text: "Fog" },
    { min: 3, max: 3, text: "Clear skies" },
  ]);
});

test("a half-numbered paste keeps going from where the numbers stopped", () => {
  const entries = parseRollTable("1-3 Numbered\nBare line");
  assert.deepEqual(entries[1], { min: 4, max: 4, text: "Bare line" });
});

test("a backwards range is read the way it was meant", () => {
  assert.deepEqual(parseRollTable("5-1 Backwards"), [
    { min: 1, max: 5, text: "Backwards" },
  ]);
});

test("blank lines and surrounding space are ignored", () => {
  assert.equal(parseRollTable("\n\n  1. One  \n\n").length, 1);
  assert.equal(parseRollTable("   ").length, 0);
});

test("the die is the smallest that covers the table", () => {
  assert.equal(dieForTable(parseRollTable("1. a\n2. b\n3. c")), 4);
  assert.equal(dieForTable(parseRollTable("1-10 a\n11-20 b")), 20);
  assert.equal(dieForTable([]), 0);
  // Past d100 the table rolls its own size rather than silently truncating.
  assert.equal(dieForTable([{ min: 1, max: 120, text: "x" }]), 120);
});

test("holes and overlaps are reported, not hidden", () => {
  // Seven rows on a d8 leaves an 8 that lands nowhere.
  const seven = parseRollTable(Array.from({ length: 7 }, (_, i) => `${i + 1}. row`).join("\n"));
  assert.deepEqual(tableGaps(seven).uncovered, [8]);
  const overlapping = [
    { min: 1, max: 3, text: "a" },
    { min: 3, max: 4, text: "b" },
  ];
  assert.deepEqual(tableGaps(overlapping).overlapping, [3]);
});

test("a roll finds its row, and a gap finds nothing", () => {
  const entries = parseRollTable("1-5 Low\n6-10 High");
  assert.equal(entryForRoll(entries, 1).text, "Low");
  assert.equal(entryForRoll(entries, 5).text, "Low");
  assert.equal(entryForRoll(entries, 6).text, "High");
  assert.equal(entryForRoll(entries, 11), null);
});

test("formatting and parsing round trip", () => {
  const entries = parseRollTable("1-5 A goblin patrol\n6. Nothing");
  assert.deepEqual(parseRollTable(formatRollTable(entries)), entries);
});

test("a paste cannot flood the table or one row", () => {
  const huge = Array.from({ length: 200 }, (_, i) => `Row ${i}`).join("\n");
  assert.equal(parseRollTable(huge).length, 100);
  assert.equal(parseRollTable(`1. ${"x".repeat(500)}`)[0].text.length, 300);
});

console.log(`roll tables: ${passed} tests passed`);
