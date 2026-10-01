// Food and water under the `supplies` variant rule, and nothing without it.
//
// SRD 5.1, Food and Water: a character needs a pound of food a day and can
// go without for 3 + Constitution modifier days (at least 1); each day
// beyond that costs a level of exhaustion, and a normal day of eating resets
// the count. A day without water costs a level of exhaustion. Exhaustion
// from going without is not removed until the character eats and drinks.
// ODM's decision: the rule is a variant, off by default, as ammunition is.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-supplies");
const RULES = {
  flanking: false, criticalFumbles: false, encumbrance: false, lingeringInjuries: false,
  powerfulCritical: false, criticalDamageMods: false, ammunition: false, restVariant: "standard",
};
const fed = await openWorld({ gameSettings: { variantRules: { ...RULES, supplies: true } } });
const loose = await openWorld({ gameSettings: { variantRules: RULES } });
const days = (world, amount) => world.invoke("pass_time", { amount, unit: "days" });
const qty = (world, id, name) => world.sheet(id).equipment.find((item) => item.name === name)?.qty ?? 0;

await test("with the variant off a day passes and nobody eats or tires", async () => {
  const hero = loose.addHero({ class: "fighter", level: 3, maxHp: 30, equipment: [{ name: "Rations (1 day)", qty: 2 }] });
  await days(loose, 5);
  assert.equal(qty(loose, hero.id, "Rations (1 day)"), 2);
  assert.equal(loose.sheet(hero.id).exhaustion ?? 0, 0);
});

const hungry = fed.addHero({ class: "fighter", level: 3, maxHp: 30, abilities: { con: 10 }, equipment: [{ name: "Rations (1 day)", qty: 1 }, { name: "Waterskin", qty: 1 }] });

await test("Under the supplies variant each dawn a character eats a ration from their pack.", async () => {
  await days(fed, 1);
  assert.equal(qty(fed, hungry.id, "Rations (1 day)"), 0);
  assert.equal(fed.sheet(hungry.id).exhaustion ?? 0, 0);
});

await test("Past 3 + CON modifier days without food a character gains a level of exhaustion each further day.", async () => {
  await days(fed, 3);
  assert.equal(fed.sheet(hungry.id).exhaustion ?? 0, 0, "three days without food are within a CON 10 character's limit");
  await days(fed, 1);
  assert.equal(fed.sheet(hungry.id).exhaustion, 1);
});

await test("A character going without food keeps their exhaustion through a long rest.", async () => {
  const rested = await fed.invoke("take_rest", { kind: "long" });
  assert.equal(rested.ok, true, rested.error);
  assert.ok((fed.sheet(hungry.id).exhaustion ?? 0) >= 1);
});

await test("A day with nothing to drink costs a level of exhaustion.", async () => {
  const dry = fed.addHero({ class: "fighter", level: 3, maxHp: 30, equipment: [{ name: "Rations (1 day)", qty: 5 }] });
  await days(fed, 1);
  assert.equal(fed.sheet(dry.id).exhaustion, 1);
});

fed.close();
loose.close();
finish();
