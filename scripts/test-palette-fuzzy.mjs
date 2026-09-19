// The command palette's matcher and the workshop shelf's plate picker: both
// pure, both small, both the kind of thing that breaks quietly.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { fuzzyScore, commandScore, filterCommands } = await import("../src/lib/palette/fuzzy.ts");
const { WORKSHOP_PLATES, plateIndex, workshopPlate } = await import("../src/app/workshop/plates.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const commands = [
  { id: "forest", label: "Forest ambush", group: "World" },
  { id: "long", label: "Long rest", group: "Party", keywords: ["long rest sleep"] },
  { id: "short", label: "Short rest", group: "Party" },
  { id: "cast", label: "Go to Cast", group: "Jump to a system", keywords: ["npc"] },
  { id: "restore", label: "Restore hit points", group: "Party" },
];

test("an empty query keeps the host's order", () => {
  assert.deepEqual(filterCommands("  ", commands).map((c) => c.id), commands.map((c) => c.id));
});

test("a word start beats a mid-word hit", () => {
  const ids = filterCommands("rest", commands).map((c) => c.id);
  assert.ok(ids.indexOf("long") < ids.indexOf("forest"));
  assert.ok(ids.includes("restore"));
});

test("a label prefix wins outright", () => {
  assert.equal(filterCommands("short", commands)[0].id, "short");
});

test("letters in order still find a command, below exact typing", () => {
  assert.equal(filterCommands("lgrs", commands)[0].id, "long");
  assert.ok(fuzzyScore("lgrs", "Long rest") < fuzzyScore("long", "Long rest"));
});

test("keywords and groups match when the label does not", () => {
  assert.deepEqual(filterCommands("npc", commands).map((c) => c.id), ["cast"]);
  assert.ok(filterCommands("party", commands).length === 3);
});

test("every word of the query has to land", () => {
  assert.deepEqual(filterCommands("long rest", commands).map((c) => c.id)[0], "long");
  assert.equal(commandScore("long dragon", commands[1]), null);
});

test("nothing matches nonsense", () => {
  assert.deepEqual(filterCommands("zzqx", commands), []);
  assert.equal(fuzzyScore("zz", "Long rest"), null);
});

test("matching ignores case", () => {
  assert.equal(filterCommands("LONG", commands)[0].id, "long");
});

// ---- workshop plates ----

test("the same workshop always draws the same plate", () => {
  const id = "2f1c8b1e-0000-4000-8000-abcdefabcdef";
  assert.equal(workshopPlate(id), workshopPlate(id));
  assert.ok(WORKSHOP_PLATES.includes(workshopPlate(id)));
});

test("a shelf of workshops is more than one picture", () => {
  const ids = Array.from({ length: 40 }, (_, n) => `1d7a52be-1997-4f83-b524-${String(n).padStart(12, "0")}`);
  const plates = new Set(ids.map((id) => workshopPlate(id)));
  assert.ok(plates.size >= 8, `only ${plates.size} plates over 40 ids`);
  for (const id of ids) {
    const index = plateIndex(id);
    assert.ok(Number.isInteger(index) && index >= 0 && index < WORKSHOP_PLATES.length);
  }
});

test("no id falls back to the workshop plate, and every plate is root-relative", () => {
  assert.equal(workshopPlate(""), WORKSHOP_PLATES[0]);
  assert.equal(workshopPlate(null), WORKSHOP_PLATES[0]);
  for (const plate of WORKSHOP_PLATES) assert.ok(plate.startsWith("/assets/placeholders/"));
});

console.log(`palette-fuzzy: ${passed} passed`);
