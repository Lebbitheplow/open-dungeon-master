// The transformation engine's data and pure math: beast-form table, Wild
// Shape level caps, and the derived-stat override while transformed.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { BEAST_FORMS, beastFormsHolding, findBeastForm, formatCr, wildShapeCapsFor, wildShapeForms } = await import(
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
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      assert.ok(form.abilities[ability] >= 1 && form.abilities[ability] <= 30, form.name);
    }
    for (const attack of form.attacks) {
      assert.ok(isValidExpression(attack.damage), `${form.name} ${attack.name}`);
      for (const rider of attack.riders ?? []) {
        assert.ok(isValidExpression(rider.dice), `${form.name} ${attack.name} rider`);
      }
      if (attack.onHit?.damage) {
        assert.ok(isValidExpression(attack.onHit.damage), `${form.name} ${attack.name} on a hit`);
      }
    }
    assert.equal(form.fly === true, (form.speeds.fly ?? 0) > 0, form.name);
    assert.equal(form.swim === true, (form.speeds.swim ?? 0) > 0, form.name);
  }
});

// SRD 5.1 has 97 beast stat blocks; ten are swarms ("a swarm of Tiny
// beasts"), a crowd no spell that names a beast gives.
test("every SRD 5.1 beast is a form, and no swarm", () => {
  assert.equal(BEAST_FORMS.length, 87);
  assert.equal(BEAST_FORMS.some((form) => /^swarm/i.test(form.name)), false);
  for (const name of ["Camel", "Giant Elk", "Polar Bear", "Elephant", "Frog", "Sea Horse", "Flying Snake", "Giant Toad", "Killer Whale", "Triceratops"]) {
    assert.ok(findBeastForm(name), `${name} is no form`);
  }
});

test("a frog and a sea horse have no attack: the SRD prints none", () => {
  assert.deepEqual(BEAST_FORMS.filter((form) => !form.attacks.length).map((form) => form.name).sort(), ["Frog", "Sea Horse"]);
});

test("the bears' attacks are the SRD's: +4 for the black bear, +6 for the brown", () => {
  assert.deepEqual(findBeastForm("Black Bear").attacks.map((attack) => [attack.name, attack.toHit, attack.damage]), [["Bite", 4, "1d6+2"], ["Claws", 4, "2d4+2"]]);
  assert.deepEqual(findBeastForm("Brown Bear").attacks.map((attack) => [attack.name, attack.toHit, attack.damage]), [["Bite", 6, "1d8+4"], ["Claws", 6, "2d6+4"]]);
});

test("rider damage of another type rides the hit: a flying snake's 3d4 poison, a giant toad's 1d10 poison and its grapple", () => {
  const [snake] = findBeastForm("Flying Snake").attacks;
  assert.deepEqual([snake.damage, snake.type, snake.riders], ["1", "piercing", [{ dice: "3d4", type: "poison" }]]);
  const [toad] = findBeastForm("Giant Toad").attacks;
  assert.deepEqual(toad.riders, [{ dice: "1d10", type: "poison" }]);
  assert.deepEqual([toad.onHit.condition, toad.onHit.alsoCondition, toad.onHit.escapeDc], ["grappled", "restrained", 13]);
});

test("reach, range and the second attack the old table dropped", () => {
  assert.equal(findBeastForm("Giant Octopus").attacks[0].reach, 15);
  assert.equal(findBeastForm("Tyrannosaurus Rex").attacks.every((attack) => attack.reach === 10), true);
  const rock = findBeastForm("Ape").attacks.find((attack) => attack.name === "Rock");
  assert.deepEqual([rock.range, rock.longRange], [25, 50]);
  const hooves = findBeastForm("Elk").attacks.find((attack) => attack.name === "Hooves");
  assert.equal(hooves.proneTargetsOnly, true);
});

test("the forms Wild Shape opens by druid level: a camel at 2nd, a polar bear (CR 2, swims) only to a Moon druid of 6th", () => {
  const names = (level, moon) => wildShapeForms(wildShapeCapsFor(level, moon)).map((form) => form.name);
  assert.ok(names(2, false).includes("Camel"));
  assert.equal(names(2, false).includes("Frog"), false, "a frog swims");
  assert.ok(names(4, false).includes("Frog"));
  assert.equal(names(5, true).includes("Polar Bear"), false);
  assert.ok(names(6, true).includes("Polar Bear"));
  assert.ok(names(6, true).includes("Giant Elk"));
  assert.equal(names(20, false).includes("Giant Elk"), false, "CR 2 is no plain druid's");
  assert.ok(names(12, true).includes("Elephant"));
});

test("form lookup takes a whole name, never a part of one, and is never wrong-species", () => {
  assert.equal(findBeastForm("Wolf")?.name, "Wolf");
  assert.equal(findBeastForm("WOLF")?.name, "Wolf");
  // An English article or "form" around the name is a guess no other table
  // gets: the form is named as the list writes it.
  assert.equal(findBeastForm("a wolf"), null);
  assert.equal(findBeastForm("brown bear form"), null);
  assert.equal(findBeastForm("dire wolf")?.name, "Dire Wolf");
  assert.equal(findBeastForm("tyrannosaurus rex")?.name, "Tyrannosaurus Rex");
  // A part of one name is no form either; the refusal names the forms that
  // hold it.
  assert.equal(findBeastForm("rex"), null);
  assert.deepEqual(beastFormsHolding("rex").map((form) => form.name), ["Tyrannosaurus Rex"]);
  assert.equal(findBeastForm("house cat"), null);
  assert.equal(findBeastForm(""), null);
  // A name the table does not hold is no form, never the beast inside it:
  // the caller's refusal lists the forms there are. A giant elk is a form
  // of its own, never the elk.
  assert.equal(findBeastForm("giant elk")?.name, "Giant Elk");
  assert.equal(findBeastForm("giant hamster"), null);
  assert.equal(findBeastForm("a winter wolf"), null);
  assert.equal(findBeastForm("werewolf"), null);
  assert.equal(findBeastForm("a shaggy brown bear"), null);
  // A part of several names picks none of them.
  assert.equal(findBeastForm("bear"), null);
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
