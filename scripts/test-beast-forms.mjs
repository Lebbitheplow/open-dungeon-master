// The transformation engine's data and pure math: beast-form table, Wild
// Shape level caps, and the derived-stat override while transformed.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { BEAST_FORMS, findBeastForm, formatCr, wildShapeCapsFor } = await import(
  "../src/lib/srd/beast-forms.ts"
);
const { computeSheetDerived, effectiveAcFor, speedFor } = await import(
  "../src/lib/srd/index.ts"
);
const { isValidExpression } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every form is a coherent stat block", () => {
  const names = new Set();
  for (const form of BEAST_FORMS) {
    assert.ok(!names.has(form.name), `duplicate ${form.name}`);
    names.add(form.name);
    assert.ok(form.hp >= 1 && form.hp <= 300, form.name);
    assert.ok(form.ac >= 8 && form.ac <= 30, form.name);
    assert.ok(form.attacks.length >= 1, form.name);
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      assert.ok(form.abilities[ability] >= 1 && form.abilities[ability] <= 30, form.name);
    }
    for (const attack of form.attacks) {
      assert.ok(isValidExpression(attack.damage), `${form.name} ${attack.name}`);
    }
  }
});

test("form lookup is fuzzy but never wrong-species", () => {
  assert.equal(findBeastForm("Wolf")?.name, "Wolf");
  assert.equal(findBeastForm("dire wolf")?.name, "Dire Wolf");
  assert.equal(findBeastForm("a shaggy brown bear")?.name, "Brown Bear");
  assert.equal(findBeastForm("tyrannosaurus rex")?.name, "Tyrannosaurus Rex");
  assert.equal(findBeastForm("house cat"), null);
  assert.equal(findBeastForm(""), null);
});

test("Wild Shape caps follow the druid table, Moon druids scale by level", () => {
  assert.deepEqual(wildShapeCapsFor(2, false), { maxCr: 0.25, fly: false, swim: false });
  assert.deepEqual(wildShapeCapsFor(4, false), { maxCr: 0.5, fly: false, swim: true });
  assert.deepEqual(wildShapeCapsFor(8, false), { maxCr: 1, fly: true, swim: true });
  assert.equal(wildShapeCapsFor(2, true).maxCr, 1);
  assert.equal(wildShapeCapsFor(9, true).maxCr, 3);
  assert.equal(wildShapeCapsFor(18, true).maxCr, 6);
  // Movement gates are level gates, not Moon perks.
  assert.equal(wildShapeCapsFor(2, true).swim, false);
});

test("formatCr renders the fractional CRs the table uses", () => {
  assert.equal(formatCr(0.25), "1/4");
  assert.equal(formatCr(0.5), "1/2");
  assert.equal(formatCr(1), "1");
  assert.equal(formatCr(8), "8");
});

// A level 5 druid: WIS 16, STR 8, proficient in Perception and Athletics.
function druid(wildShape = null) {
  return {
    class: "druid",
    level: 5,
    speed: 30,
    abilities: { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
    proficiencies: {
      saves: ["int", "wis"],
      skills: ["perception", "athletics"],
      expertise: [],
      languages: [],
      tools: [],
      armor: ["light", "medium"],
      weapons: [],
    },
    spellcasting: { ability: "wis", slots: {}, prepared: [], known: [] },
    equipment: [],
    features: [],
    feats: [],
    ac: 12,
    wildShape,
  };
}

test("derived stats swap to the form's physical scores and keep the mind", () => {
  const bear = findBeastForm("Brown Bear");
  const shaped = druid({
    form: bear.name,
    beastHp: bear.hp,
    beastMaxHp: bear.hp,
    beastAc: bear.ac,
    kind: "wildshape",
    abilities: { str: bear.abilities.str, dex: bear.abilities.dex, con: bear.abilities.con },
    speed: bear.speed,
    attacks: bear.attacks,
  });
  const derived = computeSheetDerived(shaped);
  // Bear STR 19 (+4) with the druid's own proficiency in Athletics (+3).
  assert.equal(derived.abilityMods.str, 4);
  assert.equal(derived.skills.athletics, 7);
  // The druid's mind is untouched: WIS 16 (+3), proficient WIS save +6.
  assert.equal(derived.abilityMods.wis, 3);
  assert.equal(derived.saves.wis, 6);
  // AC and speed come from the form.
  assert.equal(effectiveAcFor(shaped), bear.ac);
  assert.equal(speedFor(shaped), 40);
  // Unshaped, everything reads from the sheet.
  const plain = druid();
  assert.equal(computeSheetDerived(plain).abilityMods.str, -1);
  assert.equal(effectiveAcFor(plain), 12);
  assert.equal(speedFor(plain), 30);
});

console.log(`test-beast-forms: ${passed} passed`);
