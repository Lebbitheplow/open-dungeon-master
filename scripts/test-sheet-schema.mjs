// Sheet schema back-compat: the backstory field and its bounds.
import assert from "node:assert/strict";
import { createSheetSchema, patchSheetSchema } from "../src/lib/schemas/sheet.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const baseSheet = {
  name: "Testa",
  race: "human",
  class: "fighter",
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  maxHp: 12,
  ac: 16,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
};

test("pre-backstory payloads still parse, defaulting to empty", () => {
  const parsed = createSheetSchema.parse(baseSheet);
  assert.equal(parsed.backstory, "");
});

test("backstory round-trips and trims", () => {
  const parsed = createSheetSchema.parse({ ...baseSheet, backstory: "  A quiet farrier.  " });
  assert.equal(parsed.backstory, "A quiet farrier.");
});

test("backstory over 2000 chars is rejected", () => {
  const result = createSheetSchema.safeParse({ ...baseSheet, backstory: "x".repeat(2001) });
  assert.equal(result.success, false);
});

test("patch schema accepts a backstory update", () => {
  const parsed = patchSheetSchema.parse({ backstory: "Rewritten past." });
  assert.equal(parsed.backstory, "Rewritten past.");
});

test("patch schema leaves backstory undefined when absent", () => {
  const parsed = patchSheetSchema.parse({ gold: 10 });
  assert.equal(parsed.backstory, undefined);
});

test("pre-ASI payloads default asiChoices to empty", () => {
  const parsed = createSheetSchema.parse(baseSheet);
  assert.deepEqual(parsed.asiChoices, []);
});

test("asiChoices round-trip all three modes", () => {
  const parsed = createSheetSchema.parse({
    ...baseSheet,
    asiChoices: [
      { mode: "plus2", ability: "str" },
      { mode: "plus1x2", abilities: ["dex", "con"] },
      { mode: "feat", feat: "Alert" },
    ],
  });
  assert.equal(parsed.asiChoices.length, 3);
  assert.equal(parsed.asiChoices[2].feat, "Alert");
});

test("asiChoices reject unknown modes and overflow", () => {
  assert.equal(
    createSheetSchema.safeParse({ ...baseSheet, asiChoices: [{ mode: "plus3", ability: "str" }] })
      .success,
    false,
  );
  assert.equal(
    createSheetSchema.safeParse({
      ...baseSheet,
      asiChoices: Array.from({ length: 6 }, () => ({ mode: "plus2", ability: "str" })),
    }).success,
    false,
  );
});

test("patch schema accepts ability score updates", () => {
  const parsed = patchSheetSchema.parse({
    abilities: { str: 18, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  });
  assert.equal(parsed.abilities.str, 18);
});

console.log(`test-sheet-schema: ${passed} tests passed.`);
