// A magic item made in the workshop works at the table the way the SRD's
// magic items do (SRD 5.1, Magic Items: Attunement, Charges, Cursed Items,
// Magic Weapons and Armor; Equipment: Armor and Shields). The homebrew item
// used to carry five effect kinds and nothing else: a workshop +2 sword hit
// like a plain one unless "+2" was in its name, its fire dice never rolled,
// a homebrew wand's charges were never on the sheet, its spell was never
// cast from it, and an item that needed no attunement took one of the three
// places. Each rule here is written through the homebrew route, carried on a
// sheet at the table, and read back from the engine that runs it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-workshop-items");
const { speedFor } = await import("../src/lib/srd/index.ts");
const { armorOfRow } = await import("../src/lib/srd/armor.ts");
const { attunementRefusal } = await import("../src/lib/dm/usage-rules.ts");
const { attunementProblem } = await import("../src/lib/srd/magic-items.ts");
const { itemCheckRiders } = await import("../src/lib/srd/item-check-riders.ts");

const world = await openWorld();
const kit = await gearKit(world);
const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const anchor = world.addHero({ class: "fighter", level: LEVEL });
// The owner's own character: at a table the workshop that counts is the one
// of whoever runs it.
const keeper = world.addHero({
  user: world.owner, class: "fighter", level: LEVEL, acOverride: false, maxHp: 60,
  proficiencies: profs({ armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] }),
});
const sheet = () => world.sheet(keeper.id);
const scores = (overrides = {}) => ({ str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides });
function carry(equipment, abilities = {}) {
  world.patch(keeper.id, { equipment, abilities: scores(abilities), currentHp: 60 });
  // The snapshot is laid on the row when the sheet is read; one more write
  // derives what follows from it, as every DM tool does.
  world.patch(keeper.id, {});
}

const homebrew = await world.route("homebrew");
async function brew(name, data) {
  world.signIn(world.owner);
  const response = await homebrew.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "item", name, data }) }),
  );
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.entry;
}

const LONGSWORD = { category: "martial", kind: "melee", damage: "1d8 slashing", properties: ["versatile"] };

await kit.arena({ first: anchor.id });
kit.stand(keeper.id, 1);

await test("A workshop sword's bonus and its fire dice ride every hit while it is attuned, and not before.", async () => {
  await brew("Cinderbrand", {
    itemKind: "magic_item",
    requiresAttunement: true,
    weapon: LONGSWORD,
    weaponRiders: { bonus: 2, extra: [{ dice: "2d6", type: "fire" }] },
  });
  carry([{ name: "Cinderbrand", qty: 1, equipped: true }]);
  const plain = await kit.swing(keeper.id, { weapon: "Cinderbrand" }, 10, 5);
  assert.equal(plain.ok, true, plain.error);
  assert.equal(plain.result.rolled, 10 + 3 + PB, "the unattuned sword added its bonus");
  assert.deepEqual(plain.damageDice, [8], "the unattuned sword rolled its fire");
  world.patch(keeper.id, { equipment: sheet().equipment.map((item) => ({ ...item, attuned: true })) });
  const lit = await kit.swing(keeper.id, { weapon: "Cinderbrand" }, 10, 5, 3, 4);
  assert.equal(lit.ok, true, lit.error);
  assert.equal(lit.result.rolled, 10 + 3 + PB + 2);
  assert.deepEqual(lit.damageDice.sort(), [6, 6, 8], "the fire did not ride the hit");
  assert.equal(lit.result.damage, 5 + 3 + 2 + 3 + 4);
});

await test("Workshop armour's +1 and its mithral-like riders reach the armour class and the Stealth check.", async () => {
  await brew("Wyrmscale Plate", {
    itemKind: "magic_item",
    armor: { category: "heavy", baseAc: 18, strengthRequirement: 15, stealthDisadvantage: true, weightLb: 65 },
    armorRiders: { bonus: 1, noStealthPenalty: true, noStrength: true },
  });
  carry([{ name: "Wyrmscale Plate", qty: 1, equipped: true }], { str: 8 });
  assert.equal(sheet().ac, 18 + 1);
  const worn = armorOfRow(sheet().equipment[0]);
  assert.equal(worn.armor.stealthDisadvantage, false, "the suit's Stealth penalty survived its rider");
  assert.equal(worn.armor.strengthRequirement, undefined);
  // Plate at Strength 8 costs 10 feet of speed; this suit forgives it.
  assert.equal(speedFor(sheet()), 30);
});

await test("A workshop wand holds its charges on the sheet, spends them on its spell at its own DC, and refuses past empty.", async () => {
  await brew("Ember Wand", {
    itemKind: "magic_item",
    charges: { max: 3, regain: "all" },
    spells: [{ spell: "Burning Hands", charges: 1, level: 1, perCharge: true, maxLevel: 3, dc: 14 }],
  });
  carry([{ name: "Ember Wand", qty: 1, equipped: true }]);
  kit.freshTurn();
  const first = await kit.onTurnOf(keeper.id, () => world.invoke("use_item", { characterId: keeper.id, item: "Ember Wand", spell: "Burning Hands", charges: 2 }));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.spellLevel, 2);
  assert.equal(first.result.saveDc, 14);
  assert.equal(first.result.chargesLeft, 1);
  const wand = sheet().equipment.find((item) => item.name === "Ember Wand");
  assert.equal(wand.charges, 1);
  const over = await kit.onTurnOf(keeper.id, () => world.invoke("use_item", { characterId: keeper.id, item: "Ember Wand", spell: "Burning Hands", charges: 2 }));
  assert.equal(over.ok, false, "the wand spent charges it did not have");
});

await test("A workshop trinket that needs no attunement takes none of the three places; one that needs it takes one.", async () => {
  await brew("Lucky Pebble", { itemKind: "magic_item", requiresAttunement: false, checks: { bonus: 1 } });
  await brew("Seer's Circlet", { itemKind: "magic_item", requiresAttunement: true, attunedBy: { text: "a wizard", classes: ["wizard"] }, checks: { advantage: ["perception"] } });
  carry([
    { name: "Lucky Pebble", qty: 1, equipped: true },
    { name: "Seer's Circlet", qty: 1, equipped: true },
  ]);
  const [pebble, circlet] = sheet().equipment;
  assert.match(attunementProblem(pebble, [], { ...sheet(), name: "Keeper" }) ?? "", /needs no attunement/);
  assert.match(attunementProblem(circlet, [], { ...sheet(), name: "Keeper" }) ?? "", /a wizard/, "a fighter attuned to a wizard's circlet");
  assert.equal(itemCheckRiders(sheet().equipment, "athletics").bonus, 1, "the pebble's +1 to checks did not count");
  assert.equal(itemCheckRiders(sheet().equipment, "perception").advantage, false, "an unattuned circlet gave advantage");
});

await test("A cursed workshop item keeps its attunement until the curse is broken.", async () => {
  await brew("Grasping Ring", { itemKind: "magic_item", requiresAttunement: true, cursed: true, effects: [{ kind: "ac_bonus", amount: 1 }] });
  carry([{ name: "Grasping Ring", qty: 1, equipped: true, attuned: true }]);
  assert.equal(sheet().ac, 10 + 1);
  const refusal = attunementRefusal(sheet(), { "Grasping Ring": { attuned: false } });
  assert.match(refusal ?? "", /cursed/, "the cursed ring's attunement could be ended");
});

finish();
