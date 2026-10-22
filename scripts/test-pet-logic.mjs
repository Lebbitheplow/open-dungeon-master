// The pet engine's pure rules: who may summon what, and the stat blocks a
// summon produces (familiar forms, Beast Master scaling, the drake).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildPet } = await import("../src/lib/dm/pet-tools.ts");
const { isValidExpression } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function sheet(overrides = {}) {
  return {
    name: "Wren",
    class: "wizard",
    subclass: "",
    level: 5,
    features: [],
    feats: [],
    pets: [],
    spellcasting: { ability: "int", slots: {}, prepared: ["Find Familiar"], known: [] },
    ...overrides,
  };
}

test("Find Familiar gates the familiar and unknown forms are refused", () => {
  const owl = buildPet(sheet(), { kind: "familiar", form: "owl" });
  assert.equal(owl.form, "Owl");
  assert.equal(owl.hp, 1);
  assert.deepEqual(owl.attacks, []);
  // No spell, no feature: refused.
  const denied = buildPet(sheet({ spellcasting: null }), { kind: "familiar", form: "owl" });
  assert.match(denied.error, /does not know Find Familiar/);
  const unknown = buildPet(sheet(), { kind: "familiar", form: "badger" });
  // The spell's own list (SRD 5.1, Find Familiar), crab to weasel.
  assert.match(unknown.error, /Unknown familiar form "badger"\. The forms there are: bat, cat, crab, frog, hawk, lizard, octopus, owl, poisonous snake, quipper, rat, raven, sea horse, spider, weasel\. Ask the player which/);
  assert.doesNotMatch(unknown.error, /imp|quasit/, "a form only Pact of the Chain gives was offered");
  // A creature of its own is no familiar form inside its name; no form named is asked for.
  assert.match(buildPet(sheet(), { kind: "familiar", form: "giant owl" }).error, /Unknown familiar form "giant owl"/);
  assert.match(buildPet(sheet(), { kind: "familiar", form: "" }).error, /A familiar needs its form: bat, .*owl, .*Ask the player which/);
});

test("Pact of the Chain unlocks the special forms, and only then", () => {
  const noChain = buildPet(sheet(), { kind: "familiar", form: "imp" });
  assert.match(noChain.error, /Pact of the Chain/);
  const warlock = sheet({
    class: "warlock",
    spellcasting: { ability: "cha", slots: {}, prepared: [], known: [] },
    features: [{ name: "Pact Boon: Pact of the Chain", source: "choice" }],
  });
  const imp = buildPet(warlock, { kind: "familiar", form: "imp" });
  assert.equal(imp.form, "Imp");
  assert.ok(imp.attacks.length > 0);
  for (const attack of imp.attacks) {
    assert.ok(isValidExpression(attack.damage), attack.damage);
  }
});

test("Beast Master companions scale with the ranger and reject big beasts", () => {
  const ranger = sheet({ class: "ranger", subclass: "Beast Master", level: 5 });
  const wolf = buildPet(ranger, { kind: "beast_companion", form: "wolf" });
  // Wolf base 11 HP vs 4x level 20: the floor wins; +3 proficiency on AC
  // and attacks.
  assert.equal(wolf.hp, 20);
  assert.equal(wolf.ac, 13 + 3);
  assert.equal(wolf.attacks[0].toHit, 4 + 3);
  assert.equal(wolf.attacks[0].damage, "2d4+2+3");
  // CR above 1/4 is not a valid companion.
  const bear = buildPet(ranger, { kind: "beast_companion", form: "brown bear" });
  assert.match(bear.error, /CR 1\/4 or lower/);
  // A non-Beast-Master ranger has no companion feature.
  const plain = buildPet(sheet({ class: "ranger" }), { kind: "beast_companion", form: "wolf" });
  assert.match(plain.error, /no Ranger's Companion/);
});

test("the drake needs Drakewarden and scales by level", () => {
  const warden = sheet({ class: "ranger", subclass: "Drakewarden", level: 7 });
  const drake = buildPet(warden, { kind: "drake", form: "drake" });
  assert.equal(drake.hp, 5 + 7 * 5);
  assert.equal(drake.ac, 14);
  assert.equal(drake.attacks[0].toHit, 2 + 3);
  const denied = buildPet(sheet(), { kind: "drake", form: "drake" });
  assert.match(denied.error, /Drake Companion/);
});

test("story pets take model-supplied stats and require them", () => {
  const crow = buildPet(sheet(), { kind: "other", form: "clockwork crow", hp: 6, ac: 13 });
  assert.equal(crow.hp, 6);
  assert.equal(crow.kind, "other");
  const missing = buildPet(sheet(), { kind: "other", form: "clockwork crow" });
  assert.match(missing.error, /needs hp and ac/);
});

// Every pet the tables can build is one the sheet's own schema keeps: an
// imp's sting once carried the type "piercing (poison rides the sting)",
// past the schema's 20 characters, and a sheet holding it could not be
// restored by undo.
const { petSchema } = await import("../src/lib/schemas/sheet.ts");
const { FAMILIAR_FORMS } = await import("../src/lib/srd/familiar-forms.ts");
const { BEAST_FORMS } = await import("../src/lib/srd/beast-forms.ts");
test("every familiar form and every companion beast builds a pet the sheet schema accepts", () => {
  const warlock = sheet({
    class: "warlock",
    spellcasting: { ability: "cha", slots: {}, prepared: [], known: [] },
    features: [{ name: "Pact of the Chain", source: "choice" }],
  });
  const ranger = sheet({ class: "ranger", subclass: "Beast Master", level: 20 });
  const built = [
    ...FAMILIAR_FORMS.map((form) => buildPet(warlock, { kind: "familiar", form: form.form })),
    ...BEAST_FORMS.map((beast) => buildPet(ranger, { kind: "beast_companion", form: beast.name })).filter((pet) => !("error" in pet)),
  ];
  assert.ok(built.length > FAMILIAR_FORMS.length + 20, `${built.length} pets built`);
  for (const pet of built) {
    assert.ok(!("error" in pet), pet.error);
    const parsed = petSchema.safeParse(pet);
    assert.ok(parsed.success, `${pet.form}: ${parsed.error?.message}`);
  }
});

console.log(`test-pet-logic: ${passed} passed`);
