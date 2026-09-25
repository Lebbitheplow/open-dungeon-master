// Cantrips as their own list: legacy sheets that kept cantrips inside
// prepared/known heal on read, and the spell allowance never counts
// cantrips or a subclass's always-prepared spells.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { allSpellNames, isCantripName, normalizeSpellcasting, spellsAgainstLimit, splitCantrips } =
  await import("../src/lib/srd/spell-lists.ts");
const { spellcastingSchema } = await import("../src/lib/schemas/sheet.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("checklist cantrips are recognized, case-insensitively", () => {
  assert.equal(isCantripName("Sacred Flame"), true);
  assert.equal(isCantripName("  fire bolt "), true);
  assert.equal(isCantripName("Cure Wounds"), false);
  assert.equal(isCantripName("Some Homebrew Thing"), false);
});

test("a legacy cleric's cantrips move out of prepared", () => {
  const healed = splitCantrips({
    known: [],
    prepared: ["Sacred Flame", "Guidance", "Bless", "Cure Wounds"],
  });
  assert.deepEqual(healed.cantrips, ["Sacred Flame", "Guidance"]);
  assert.deepEqual(healed.prepared, ["Bless", "Cure Wounds"]);
  assert.deepEqual(healed.known, []);
});

test("a legacy bard's cantrips move out of known, without duplicates", () => {
  const healed = splitCantrips({
    known: ["Vicious Mockery", "Healing Word"],
    prepared: [],
    cantrips: ["vicious mockery", "Minor Illusion"],
  });
  assert.deepEqual(healed.cantrips, ["vicious mockery", "Minor Illusion"]);
  assert.deepEqual(healed.known, ["Healing Word"]);
});

test("normalizing is idempotent and reaches multiclass caster entries", () => {
  const once = normalizeSpellcasting({
    ability: "wis",
    slots: {},
    known: [],
    prepared: ["Guidance", "Bless"],
    casters: [{ classId: "cleric", ability: "wis", known: [], prepared: ["Guidance", "Bless"] }],
  });
  const twice = normalizeSpellcasting(once);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.cantrips, ["Guidance"]);
  assert.deepEqual(once.casters[0].cantrips, ["Guidance"]);
  assert.deepEqual(once.casters[0].prepared, ["Bless"]);
  assert.equal(normalizeSpellcasting(null), null);
});

test("unknown homebrew names stay where they were written", () => {
  const healed = splitCantrips({ known: [], prepared: ["Zap of Zork"] });
  assert.deepEqual(healed.prepared, ["Zap of Zork"]);
  assert.deepEqual(healed.cantrips, []);
});

test("every list is reachable for casting", () => {
  assert.deepEqual(allSpellNames({ cantrips: ["Guidance"], known: [], prepared: ["Bless"] }), [
    "Guidance",
    "Bless",
  ]);
  assert.deepEqual(allSpellNames(null), []);
});

test("the allowance skips cantrips and granted subclass spells", () => {
  const prepared = ["Bless", "Cure Wounds", "Healing Word", "Sacred Flame"];
  assert.equal(spellsAgainstLimit(prepared), 3);
  assert.equal(spellsAgainstLimit(prepared, ["bless", "Cure Wounds"]), 1);
});

test("the schema defaults cantrips for payloads written before the field", () => {
  const parsed = spellcastingSchema.parse({ ability: "wis", slots: {}, prepared: ["Bless"] });
  assert.deepEqual(parsed.cantrips, []);
  const withCasters = spellcastingSchema.parse({
    ability: "wis",
    slots: {},
    prepared: [],
    casters: [{ classId: "cleric", ability: "wis" }],
  });
  assert.deepEqual(withCasters.casters[0].cantrips, []);
});

console.log(`spell-lists: ${passed} tests passed`);
