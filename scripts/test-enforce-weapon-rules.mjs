// The weapon properties that are about hands, turns and quivers.
//
// SRD 5.1: a versatile weapon rolls its bigger die only when held in two
// hands; a two-handed weapon needs both hands to attack with, so neither
// goes with a shield. Two-weapon fighting is a bonus action that follows an
// Attack action made with a light melee weapon, is made with a different
// light melee weapon, and leaves the ability modifier off the damage unless
// that modifier is negative. A loading weapon fires once per action however
// many attacks the character has.
//
// Ammunition is ODM's documented variant (docs/rules-coverage.md, "Deliberate
// omissions"): off, a quiver is assumed full and nothing is counted; on, a
// shot spends a round, an empty quiver refuses the attack, and half of what
// was spent comes back when the fight ends (src/lib/srd/ammunition.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-weapon-rules");

const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const trained = profs({ weapons: ["simple", "martial"], armor: ["light", "medium", "heavy", "shields"] });
const qtyOf = (sheet, name) => sheet.equipment.find((item) => item.name.startsWith(name))?.qty ?? 0;

// ---- hands ----

const world = await openWorld();
const kit = await gearKit(world);
// A level 5 fighter holds the floor: two attacks and one bonus action a turn.
const anchor = world.addHero({ class: "fighter", level: LEVEL, abilities: { str: 16, dex: 14 }, proficiencies: trained });
const hero = world.addHero({ class: "fighter", level: LEVEL, acOverride: false, proficiencies: trained });
await kit.arena({ first: anchor.id });
kit.stand(hero.id, 1);
kit.stand(anchor.id, 1, 1);

function arm(id, { str = 10, dex = 10, equipment = [], features }) {
  return world.patch(id, {
    abilities: { str, dex, con: 10, int: 10, wis: 10, cha: 10 },
    equipment,
    ...(features ? { features } : {}),
  });
}

await test("a versatile weapon rolls the bigger die in two hands and the smaller in one", async () => {
  arm(hero.id, { str: 14, equipment: [{ name: "Longsword", qty: 1 }] });
  let swing = await kit.swing(hero.id, { weapon: "Longsword", twoHanded: true }, 10, 9);
  assert.deepEqual(swing.damageDice, [10]);
  assert.equal(swing.result.damage, 9 + 2);
  swing = await kit.swing(hero.id, { weapon: "Longsword" }, 10, 8);
  assert.deepEqual(swing.damageDice, [8]);
});

await test("holding a weapon that is not versatile in two hands changes nothing", async () => {
  arm(hero.id, { str: 14, equipment: [{ name: "Mace", qty: 1 }] });
  const swing = await kit.swing(hero.id, { weapon: "Mace", twoHanded: true }, 10, 6);
  assert.deepEqual(swing.damageDice, [6]);
});

await test("A versatile weapon rolls its two-handed die only when both hands hold it; a character with a shield on their arm has one hand free.", async () => {
  arm(hero.id, { str: 14, equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }, { name: "Chain Mail", qty: 1, equipped: true }] });
  assert.equal(world.sheet(hero.id).ac, 18);
  const swing = await kit.swing(hero.id, { weapon: "Longsword", twoHanded: true }, 10, 8);
  assert.equal(swing.ok, true, swing.error);
  assert.deepEqual(swing.damageDice, [8], `rolled a d${swing.damageDice[0]} with AC ${world.sheet(hero.id).ac}`);
});

await test("A two-handed weapon requires two hands to attack with, so it cannot be swung while a shield is equipped.", async () => {
  arm(hero.id, { str: 14, equipment: [{ name: "Greatsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }, { name: "Chain Mail", qty: 1, equipped: true }] });
  const swing = await kit.swing(hero.id, { weapon: "Greatsword" }, 10, 3, 4);
  assert.equal(swing.ok, false, `the greatsword hit for ${swing.result?.damage} behind AC ${world.sheet(hero.id).ac}`);
});

// ---- two-weapon fighting ----

// The off-hand swing follows the Attack action, so each of these cases is a
// turn of the anchor's: the main hand first, then the other.
async function offHandSwing(args, ...faces) {
  kit.freshTurn();
  const main = await kit.swing(anchor.id, { weapon: args.weapon }, 10, 4);
  assert.equal(main.ok, true, main.error);
  return kit.swing(anchor.id, { ...args, offHand: true }, ...faces);
}

await test("the off-hand swing leaves the ability modifier off the damage", async () => {
  arm(anchor.id, { str: 16, equipment: [{ name: "Shortsword", qty: 2 }] });
  const swing = await offHandSwing({ weapon: "Shortsword" }, 10, 4);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 10 + abilityMod(16) + PB);
  assert.equal(swing.result.damage, 4);
});

await test("the Two-Weapon Fighting style puts the modifier back", async () => {
  arm(anchor.id, {
    str: 16,
    equipment: [{ name: "Shortsword", qty: 2 }],
    features: [...world.sheet(anchor.id).features, { name: "Fighting Style: Two-Weapon Fighting", source: "choice" }],
  });
  const swing = await offHandSwing({ weapon: "Shortsword" }, 10, 4);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.damage, 4 + abilityMod(16));
  world.patch(anchor.id, { features: world.sheet(anchor.id).features.filter((feature) => !feature.name.startsWith("Fighting Style")) });
});

await test("the off-hand swing costs the bonus action, and there is only one", async () => {
  arm(anchor.id, { str: 16, equipment: [{ name: "Shortsword", qty: 2 }] });
  kit.freshTurn();
  assert.equal((await kit.swing(anchor.id, { weapon: "Shortsword" }, 10, 4)).ok, true);
  assert.equal((await kit.swing(anchor.id, { weapon: "Shortsword", offHand: true }, 10, 4)).ok, true);
  const before = kit.dummy().currentHp;
  const again = await kit.swing(anchor.id, { weapon: "Shortsword", offHand: true }, 10, 4);
  assert.equal(again.ok, false);
  assert.equal(again.log.length, 0);
  assert.equal(kit.dummy().currentHp, before);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("Extra Attack gives a level 5 fighter two attacks a turn and refuses a third", async () => {
  arm(anchor.id, { str: 16, equipment: [{ name: "Longsword", qty: 1 }] });
  kit.freshTurn();
  assert.equal((await kit.swing(anchor.id, { weapon: "Longsword" }, 10, 4)).ok, true);
  assert.equal((await kit.swing(anchor.id, { weapon: "Longsword" }, 10, 4)).ok, true);
  const before = kit.dummy().currentHp;
  const third = await kit.swing(anchor.id, { weapon: "Longsword" }, 10, 4);
  assert.equal(third.ok, false);
  assert.equal(kit.dummy().currentHp, before);
  assert.equal(world.encounter().turnBudget.attacksMade, 2);
});

await test("The bonus-action attack of two-weapon fighting is made with a light melee weapon.", async () => {
  arm(anchor.id, { str: 16, equipment: [{ name: "Shortsword", qty: 1 }, { name: "Longsword", qty: 1 }] });
  kit.freshTurn();
  await kit.swing(anchor.id, { weapon: "Shortsword" }, 10, 4);
  const swing = await kit.swing(anchor.id, { weapon: "Longsword", offHand: true }, 10, 4);
  assert.equal(swing.ok, false, `an off-hand longsword hit for ${swing.result?.damage}`);
});

await test("The off-hand attack is available only after taking the Attack action with a light melee weapon that turn.", async () => {
  arm(anchor.id, { str: 16, equipment: [{ name: "Shortsword", qty: 2 }] });
  kit.freshTurn();
  const swing = await kit.swing(anchor.id, { weapon: "Shortsword", offHand: true }, 10, 4);
  assert.equal(swing.ok, false, "the off-hand swing came before any Attack action");
});

await test("The off-hand attack does not add the ability modifier to damage, unless that modifier is negative.", async () => {
  arm(anchor.id, { str: 6, dex: 6, equipment: [{ name: "Shortsword", qty: 2 }] });
  const swing = await offHandSwing({ weapon: "Shortsword" }, 19, 5);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.damage, 5 + abilityMod(6), `a d6 showing 5 with a -2 modifier dealt ${swing.result.damage}`);
});

// ---- loading ----

await test("A loading weapon fires one piece of ammunition per action, bonus action or reaction, regardless of the attacks the character can make.", async () => {
  arm(anchor.id, { str: 10, dex: 16, equipment: [{ name: "Heavy Crossbow", qty: 1 }] });
  kit.stand(anchor.id, 3, 1);
  kit.freshTurn();
  assert.equal((await kit.swing(anchor.id, { weapon: "Heavy Crossbow" }, 10, 4)).ok, true);
  const second = await kit.swing(anchor.id, { weapon: "Heavy Crossbow" }, 10, 4);
  kit.stand(anchor.id, 1, 1);
  assert.equal(second.ok, false, `a second bolt flew in the same action for ${second.result?.damage ?? "a miss"}`);
});

// ---- ammunition: the variant off ----

await test("with the ammunition variant off a shot spends nothing and an empty quiver is no bar", async () => {
  arm(hero.id, { dex: 14, equipment: [{ name: "Shortbow", qty: 1 }, { name: "Arrows", qty: 20 }] });
  kit.stand(hero.id, 4);
  assert.equal((await kit.swing(hero.id, { weapon: "Shortbow" }, 10, 4)).ok, true);
  assert.equal(qtyOf(world.sheet(hero.id), "Arrows"), 20);
  arm(hero.id, { dex: 14, equipment: [{ name: "Shortbow", qty: 1 }] });
  assert.equal((await kit.swing(hero.id, { weapon: "Shortbow" }, 10, 4)).ok, true);
  assert.deepEqual(world.encounter().ammoSpent, {});
});

await kit.endFight();

// ---- ammunition: the variant on ----

const counted = await openWorld({ gameSettings: { variantRules: { ammunition: true } } });
const range = await gearKit(counted);
const holder = counted.addHero({ class: "fighter", level: LEVEL, proficiencies: trained });
const archer = counted.addHero({ class: "fighter", level: LEVEL, abilities: { dex: 16 }, proficiencies: trained });
const carry = (equipment) => counted.patch(archer.id, { equipment });
await range.arena({ first: holder.id });
range.stand(archer.id, 4);

await test("the variant is on at this table", () => {
  assert.equal(counted.campaign().gameSettings.variantRules.ammunition, true);
});

await test("a shot spends one round, hit or miss", async () => {
  carry([{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }]);
  assert.equal((await range.swing(archer.id, { weapon: "Longbow" }, 15, 4)).result.hit, true);
  assert.equal(qtyOf(counted.sheet(archer.id), "Arrows"), 19);
  assert.equal((await range.swing(archer.id, { weapon: "Longbow" }, 2)).result.hit, false);
  assert.equal(qtyOf(counted.sheet(archer.id), "Arrows"), 18);
});

await test("the last round fired takes the line off the sheet, and the next shot is refused", async () => {
  carry([{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 1 }]);
  assert.equal((await range.swing(archer.id, { weapon: "Longbow" }, 15, 4)).ok, true);
  assert.equal(counted.sheet(archer.id).equipment.some((item) => item.name === "Arrows"), false);
  const before = range.dummy().currentHp;
  const dry = await range.swing(archer.id, { weapon: "Longbow" }, 15, 4);
  assert.equal(dry.ok, false);
  assert.equal(dry.log.length, 0);
  assert.equal(range.dummy().currentHp, before);
});

await test("bolts do not feed a bow, and arrows do not feed a crossbow", async () => {
  carry([{ name: "Longbow", qty: 1 }, { name: "Light Crossbow", qty: 1 }, { name: "Crossbow Bolts", qty: 20 }]);
  assert.equal((await range.swing(archer.id, { weapon: "Longbow" }, 15, 4)).ok, false);
  assert.equal(qtyOf(counted.sheet(archer.id), "Crossbow Bolts"), 20);
  assert.equal((await range.swing(archer.id, { weapon: "Light Crossbow" }, 15, 4)).ok, true);
  assert.equal(qtyOf(counted.sheet(archer.id), "Crossbow Bolts"), 19);
  carry([{ name: "Light Crossbow", qty: 1 }, { name: "Arrows", qty: 20 }]);
  assert.equal((await range.swing(archer.id, { weapon: "Light Crossbow" }, 15, 4)).ok, false);
});

await test("a thrown or a melee weapon draws on no quiver", async () => {
  carry([{ name: "Javelin", qty: 3 }, { name: "Mace", qty: 1 }, { name: "Arrows", qty: 5 }]);
  assert.equal((await range.swing(archer.id, { weapon: "Javelin" }, 15, 4)).ok, true);
  range.stand(archer.id, 1);
  assert.equal((await range.swing(archer.id, { weapon: "Mace" }, 15, 4)).ok, true);
  range.stand(archer.id, 4);
  assert.equal(qtyOf(counted.sheet(archer.id), "Arrows"), 5);
});

await test("half the rounds spent in a fight come back when it ends, rounded down", async () => {
  await range.endFight();
  await range.arena({ first: holder.id });
  range.stand(archer.id, 4);
  carry([{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }]);
  for (let shot = 0; shot < 5; shot += 1) {
    await range.swing(archer.id, { weapon: "Longbow" }, 2);
  }
  assert.equal(qtyOf(counted.sheet(archer.id), "Arrows"), 15);
  await range.endFight();
  assert.equal(qtyOf(counted.sheet(archer.id), "Arrows"), 17);
});

await test("Half the ammunition spent in a battle is recovered afterwards, however the quiver is written on the sheet.", async () => {
  await range.arena({ first: holder.id });
  range.stand(archer.id, 4);
  carry([{ name: "Longbow", qty: 1 }, { name: "Arrows (20)", qty: 1 }]);
  for (let shot = 0; shot < 4; shot += 1) {
    await range.swing(archer.id, { weapon: "Longbow" }, 2);
  }
  await range.endFight();
  const quiver = counted.sheet(archer.id).equipment.find((item) => item.name.startsWith("Arrows"));
  assert.equal(quiver?.name, "Arrows (18)", `four shots from "Arrows (20)" left "${quiver?.name}" after the fight`);
});

await test("A refused attack never happened: a shot the engine turns down for range must leave the quiver as it was.", async () => {
  await range.arena({ first: holder.id });
  carry([{ name: "Hand Crossbow", qty: 1 }, { name: "Bolts", qty: 10 }]);
  // A hand crossbow reaches 120 feet. The board is not that long, so the
  // shot is turned down by a wall across the line instead: the refusal
  // comes from the same check, and the quiver is what is read.
  range.stand(archer.id, 13);
  const { setBattleMapTerrain } = await import("../src/lib/db/battle-maps.ts");
  const board = range.board();
  const tiles = new Array(board.width * board.height).fill(".");
  for (let y = 0; y < board.height; y += 1) {
    tiles[y * board.width + 6] = "#";
  }
  setBattleMapTerrain(board.id, tiles.join(""));
  const far = await range.swing(archer.id, { weapon: "Hand Crossbow" }, 15, 4);
  assert.equal(far.ok, false);
  assert.deepEqual(counted.encounter().ammoSpent, {});
  const left = qtyOf(counted.sheet(archer.id), "Bolts");
  assert.equal(left, 10, `the refused shot left ${left} of 10 bolts`);
});

await range.endFight();
world.close();
finish();
