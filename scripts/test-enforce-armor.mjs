// Armor class, as the stored sheet holds it.
//
// The SRD 5.1 armor table is written out below and ODM's table
// (src/lib/srd/armor.ts) is checked against it, then every suit is put on a
// real sheet at several Dexterity scores and the STORED armor class is read
// back: light armor adds all of DEX, medium at most +2, heavy none of it
// and never a penalty. A shield adds 2 and only one counts; a second suit
// adds nothing; nothing worn is 10 + DEX. Unarmored Defense and Mage Armor
// are bases for a body with no armor on it and never add to a suit.
//
// Worn without the training for it, armor costs disadvantage on every
// Strength and Dexterity check, save and attack and forbids spellcasting;
// heavy armor below its Strength score costs 10 feet of speed. The player
// puts gear on and off through POST /sheet/usage, and the number moves with
// it unless a person pinned it (acOverride).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-armor");
const { SRD_ARMOR } = await import("../src/lib/srd/armor.ts");
const { speedFor } = await import("../src/lib/srd/index.ts");

// SRD 5.1, "Armor". dex: "full", a cap, or "none". [name, category, base,
// dex, Strength, stealth disadvantage, pounds]
const SRD = [
  ["Padded", "light", 11, "full", 0, true, 8],
  ["Leather", "light", 11, "full", 0, false, 10],
  ["Studded Leather", "light", 12, "full", 0, false, 13],
  ["Hide", "medium", 12, 2, 0, false, 12],
  ["Chain Shirt", "medium", 13, 2, 0, false, 20],
  ["Scale Mail", "medium", 14, 2, 0, true, 45],
  ["Breastplate", "medium", 14, 2, 0, false, 20],
  ["Half Plate", "medium", 15, 2, 0, true, 40],
  ["Ring Mail", "heavy", 14, "none", 0, true, 40],
  ["Chain Mail", "heavy", 16, "none", 13, true, 55],
  ["Splint", "heavy", 17, "none", 15, true, 60],
  ["Plate", "heavy", 18, "none", 15, true, 65],
].map(([name, category, base, dex, strength, stealth, pounds]) => ({ name, category, base, dex, strength, stealth, pounds }));

// The armor class a suit gives at a Dexterity score, by the book.
function byTheBook(row, dexScore) {
  const mod = abilityMod(dexScore);
  if (row.dex === "full") {
    return row.base + mod;
  }
  return row.dex === "none" ? row.base : row.base + Math.min(mod, row.dex);
}

await test("every SRD suit is in the table with the book's numbers", () => {
  for (const row of SRD) {
    const armor = SRD_ARMOR.find((entry) => entry.name === row.name);
    assert.ok(armor, row.name);
    assert.equal(armor.category, row.category, `${row.name} category`);
    assert.equal(armor.baseAc, row.base, `${row.name} base`);
    assert.equal(armor.dexCap, row.dex === "full" ? undefined : row.dex === "none" ? 0 : row.dex, `${row.name} DEX`);
    assert.equal(armor.strengthRequirement ?? 0, row.strength, `${row.name} Strength`);
    assert.equal(Boolean(armor.stealthDisadvantage), row.stealth, `${row.name} stealth`);
    assert.equal(armor.weightLb, row.pounds, `${row.name} weight`);
  }
  const shield = SRD_ARMOR.find((entry) => entry.name === "Shield");
  assert.deepEqual([shield.category, shield.baseAc, shield.weightLb], ["shield", 2, 6]);
});

const world = await openWorld();
const allArmor = profs({ armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] });
const player = world.addUser("armor");
const hero = world.addHero({ user: player, class: "fighter", level: 5, acOverride: false, proficiencies: allArmor });
const scores = (overrides = {}) => ({ str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides });
const wear = (names, abilities = {}, extra = {}) =>
  world.patch(hero.id, {
    abilities: scores(abilities),
    equipment: names.map((name) => ({ name, qty: 1 })),
    conditions: [],
    ...extra,
  });

await test("every suit at DEX 10, 12, 14, 18 and 20 stores the book's armor class", () => {
  for (const row of SRD) {
    for (const dex of [10, 12, 14, 18, 20]) {
      assert.equal(wear([row.name], { dex }).ac, byTheBook(row, dex), `${row.name} at DEX ${dex}`);
    }
  }
});

await test("a low Dexterity lowers the armor class in light and medium armor", () => {
  for (const row of SRD.filter((entry) => entry.category !== "heavy")) {
    assert.equal(wear([row.name], { dex: 6 }).ac, row.base - 2, row.name);
  }
});

await test("heavy armor takes no Dexterity either way: a negative modifier does not lower its armor class", () => {
  for (const row of SRD.filter((entry) => entry.category === "heavy")) {
    const stored = wear([row.name], { dex: 6 }).ac;
    assert.equal(stored, row.base, `${row.name} at DEX 6 stores AC ${stored}, the book says ${row.base}`);
  }
});

await test("nothing worn is 10 + DEX", () => {
  for (const dex of [6, 10, 15, 20]) {
    assert.equal(wear([], { dex }).ac, 10 + abilityMod(dex));
  }
});

await test("a shield adds 2 to any base, and a second shield adds nothing", () => {
  assert.equal(wear(["Shield"], { dex: 14 }).ac, 10 + 2 + 2);
  assert.equal(wear(["Plate", "Shield"]).ac, 20);
  assert.equal(wear(["Plate", "Shield", "Shield"]).ac, 20);
  assert.equal(world.patch(hero.id, { equipment: [{ name: "Leather", qty: 1 }, { name: "Shield", qty: 3 }] }).ac, 13);
});

await test("two suits worn at once count as the better one, never as both", () => {
  assert.equal(wear(["Plate", "Chain Mail"]).ac, 18);
  assert.equal(wear(["Leather", "Studded Leather", "Hide"], { dex: 18 }).ac, 12 + 4);
});

await test("magic armor and a magic shield add their bonus on top", () => {
  assert.equal(wear(["+1 Plate"]).ac, 19);
  assert.equal(wear(["+2 Chain Mail", "+1 Shield"]).ac, 16 + 2 + 2 + 1);
  assert.equal(wear(["Leather +3"], { dex: 16 }).ac, 11 + 3 + 3);
});

await test("the stored armor class never leaves 1 to 30", () => {
  assert.ok(wear(["+3 Plate", "+3 Shield", "Ring of Protection"], {}, { conditions: ["shield of faith", "haste"] }).ac <= 30);
  assert.ok(wear([], { dex: 1 }).ac >= 1);
});

// ---- unarmored bases ----

const barbarian = world.addHero({ class: "barbarian", level: 3, acOverride: false, abilities: { dex: 14, con: 16 }, proficiencies: profs({ armor: ["light", "medium", "shields"] }) });
const monk = world.addHero({ class: "monk", level: 3, acOverride: false, abilities: { dex: 16, wis: 16 }, proficiencies: profs() });
const gear = (id, names, extra = {}) => world.patch(id, { equipment: names.map((name) => ({ name, qty: 1 })), ...extra });

await test("a barbarian's Unarmored Defense is 10 + DEX + CON, and takes a shield", () => {
  assert.equal(world.sheet(barbarian.id).ac, 10 + 2 + 3);
  assert.equal(gear(barbarian.id, ["Shield"]).ac, 10 + 2 + 3 + 2);
});

await test("Unarmored Defense does not add to armor: the suit's own number stands", () => {
  assert.equal(gear(barbarian.id, ["Hide"]).ac, 12 + 2);
  assert.equal(gear(barbarian.id, ["Half Plate", "Shield"]).ac, 15 + 2 + 2);
  assert.equal(gear(monk.id, ["Leather"]).ac, 11 + 3);
});

await test("a monk's Unarmored Defense is 10 + DEX + WIS", () => {
  assert.equal(gear(monk.id, []).ac, 10 + 3 + 3);
});

await test("a monk's Unarmored Defense and a shield never add together", () => {
  assert.ok(gear(monk.id, ["Shield"]).ac <= 10 + 3 + 3);
});

await test("a monk behind a shield stands at 10 + DEX + 2: the shield switches Unarmored Defense off", () => {
  const stored = gear(monk.id, ["Shield"]).ac;
  assert.equal(stored, 10 + 3 + 2, `stored AC ${stored}`);
});

await test("Mage Armor is 13 + DEX on a body with no armor, shield allowed", () => {
  assert.equal(wear([], { dex: 14 }, { conditions: ["mage armor"] }).ac, 13 + 2);
  assert.equal(wear(["Shield"], { dex: 14 }, { conditions: ["mage armor"] }).ac, 13 + 2 + 2);
});

await test("Mage Armor adds nothing to a suit of armor", () => {
  assert.equal(wear(["Leather"], { dex: 14 }, { conditions: ["mage armor"] }).ac, 11 + 2);
  assert.equal(wear(["Plate"], {}, { conditions: ["mage armor"] }).ac, 18);
});

await test("Mage Armor and Unarmored Defense are alternatives: the better one is used, not their sum", () => {
  assert.equal(gear(barbarian.id, [], { conditions: ["mage armor"] }).ac, Math.max(13 + 2, 10 + 2 + 3));
  assert.equal(gear(monk.id, [], { conditions: ["mage armor"] }).ac, Math.max(13 + 3, 10 + 3 + 3));
  world.patch(barbarian.id, { conditions: [] });
  world.patch(monk.id, { conditions: [] });
});

// ---- the number follows the gear ----

const usage = await world.route("campaigns/[campaignId]/sheet/usage");
async function adjust(user, body) {
  world.signIn(user);
  const response = await usage.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("putting armor on and off through the player's route moves the stored armor class", async () => {
  wear(["Chain Mail", "Shield", "Longsword"], { dex: 14 });
  assert.equal(world.sheet(hero.id).ac, 18);
  // The first toggle makes wearing explicit: what is not marked is not worn.
  let reply = await adjust(player, { gear: { "Chain Mail": { equipped: true } } });
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(world.sheet(hero.id).ac, 16);
  reply = await adjust(player, { gear: { Shield: { equipped: true } } });
  assert.equal(world.sheet(hero.id).ac, 18);
  reply = await adjust(player, { gear: { "Chain Mail": { equipped: false } } });
  assert.equal(world.sheet(hero.id).ac, 10 + 2 + 2);
});

await test("a character who has taken off their armor and shield is unarmored: 10 + DEX", async () => {
  wear(["Chain Mail", "Shield"], { dex: 14 });
  await adjust(player, { gear: { Shield: { equipped: true } } });
  assert.equal(world.sheet(hero.id).ac, 10 + 2 + 2);
  const reply = await adjust(player, { gear: { Shield: { equipped: false } } });
  assert.deepEqual(reply.body.sheet.equipment.map((item) => item.equipped), [false, false]);
  assert.equal(reply.body.sheet.ac, 12, `with both items marked unworn the sheet stores AC ${reply.body.sheet.ac}`);
});

await test("a player cannot equip what the sheet does not carry, and nothing is written", async () => {
  wear(["Leather"], { dex: 14 });
  const before = world.sheet(hero.id);
  const reply = await adjust(player, { gear: { Plate: { equipped: true } } });
  assert.equal(reply.status, 400);
  assert.deepEqual(world.sheet(hero.id).equipment, before.equipment);
  assert.equal(world.sheet(hero.id).ac, before.ac);
});

await test("a change of Dexterity moves the armor class with it", () => {
  wear(["Studded Leather"], { dex: 12 });
  assert.equal(world.patch(hero.id, { abilities: scores({ dex: 18 }) }).ac, 12 + 4);
  assert.equal(world.patch(hero.id, { abilities: scores({ dex: 8 }) }).ac, 12 - 1);
});

await test("a pinned armor class ignores the gear until the pin is lifted", () => {
  wear(["Leather"], { dex: 10 });
  assert.equal(world.patch(hero.id, { ac: 19 }).acOverride, true);
  assert.equal(wear(["Plate", "Shield"]).ac, 19);
  assert.equal(wear([]).ac, 19);
  assert.equal(world.patch(hero.id, { acOverride: false, equipment: [{ name: "Plate", qty: 1 }] }).ac, 18);
});

// ---- wearing what you cannot wear ----

const speedOf = (id) => speedFor(world.sheet(id));

await test("heavy armor below its Strength score costs 10 feet, at the score it costs nothing", () => {
  for (const row of SRD.filter((entry) => entry.strength > 0)) {
    wear([row.name], { str: row.strength - 1 });
    assert.equal(speedOf(hero.id), 20, `${row.name} at STR ${row.strength - 1}`);
    wear([row.name], { str: row.strength });
    assert.equal(speedOf(hero.id), 30, `${row.name} at STR ${row.strength}`);
  }
  wear(["Ring Mail"], { str: 3 });
  assert.equal(speedOf(hero.id), 30);
});

await test("A dwarf's speed is not reduced by wearing heavy armor.", () => {
  world.patch(hero.id, { race: "hill_dwarf", speed: 25 });
  wear(["Plate"], { str: 10 });
  const speed = speedOf(hero.id);
  world.patch(hero.id, { race: "human", speed: 30 });
  assert.equal(speed, 25, `a dwarf in plate at STR 10 moves ${speed} ft`);
});

const kit = await gearKit(world);
const d20sOf = async (args) => {
  world.clearDice();
  world.diceLog();
  world.dice(15, 4);
  const outcome = await world.invoke("request_roll", { characterId: hero.id, reason: "test", ...args });
  const faces = world.diceLog().filter((die) => die.sides === 20).map((die) => die.face);
  world.clearDice();
  assert.equal(outcome.ok, true, outcome.error);
  return faces;
};
const untrained = () => world.patch(hero.id, { proficiencies: profs({ armor: ["light"], weapons: ["simple", "martial"] }) });
const retrained = () => world.patch(hero.id, { proficiencies: allArmor });

await test("armor worn without training puts disadvantage on Strength and Dexterity checks and saves only", async () => {
  wear(["Chain Shirt"], { str: 16 });
  untrained();
  assert.equal((await d20sOf({ kind: "ability_check", ability: "str" })).length, 2);
  assert.equal((await d20sOf({ kind: "saving_throw", ability: "dex" })).length, 2);
  assert.equal((await d20sOf({ kind: "skill_check", skill: "athletics" })).length, 2);
  assert.equal((await d20sOf({ kind: "saving_throw", ability: "wis" })).length, 1);
  assert.equal((await d20sOf({ kind: "ability_check", ability: "int" })).length, 1);
  retrained();
  assert.equal((await d20sOf({ kind: "ability_check", ability: "str" })).length, 1);
});

await test("a shield carried without training counts as untrained armor", async () => {
  wear(["Leather", "Shield"]);
  untrained();
  assert.equal((await d20sOf({ kind: "saving_throw", ability: "str" })).length, 2);
  retrained();
});

await test("noisy armor puts disadvantage on Stealth, quiet armor does not", async () => {
  for (const row of SRD) {
    wear([row.name], { str: 16 });
    assert.equal((await d20sOf({ kind: "skill_check", skill: "stealth" })).length, row.stealth ? 2 : 1, row.name);
  }
});

await kit.arena({ first: barbarian.id });
kit.stand(hero.id, 1);

await test("armor worn without training puts disadvantage on a Strength or Dexterity attack roll", async () => {
  wear(["Plate", "Longsword"], { str: 16 });
  world.patch(hero.id, { proficiencies: profs({ weapons: ["simple", "martial"] }) });
  const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 15, 4, 3);
  retrained();
  assert.equal(swing.d20s.length, 2, `a swing in untrained plate rolled ${swing.d20s.length} d20`);
});

await test("A character wearing armor they lack proficiency with cannot cast spells: the slot stays unspent.", async () => {
  const casting = { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Magic Missile"], known: [], cantrips: [] };
  wear(["Plate"], { str: 16 });
  world.patch(hero.id, { proficiencies: profs(), spellcasting: casting });
  const cast = await world.invoke("use_spell_slot", { characterId: hero.id, level: 1, spell: "Magic Missile" });
  const used = world.sheet(hero.id).spellcasting.slots[1].used;
  world.patch(hero.id, { proficiencies: allArmor, spellcasting: null });
  assert.equal(cast.ok, false, `the slot was spent (${used} used) in untrained plate`);
});

await test("Armor takes 1 to 10 minutes to don and a shield an action; nobody changes into plate in the middle of a fight.", async () => {
  wear(["Plate", "Shield"], { str: 16 });
  // The shield goes on with the hero's action, on their own turn.
  const shield = await kit.onTurnOf(hero.id, () => adjust(player, { gear: { Shield: { equipped: true } } }));
  assert.equal(shield.status, 200, shield.body.error);
  assert.equal(world.sheet(hero.id).ac, 12);
  assert.ok(world.encounter());
  const reply = await adjust(player, { gear: { Plate: { equipped: true } } });
  assert.notEqual(reply.status, 200, `plate went on mid-fight: AC ${world.sheet(hero.id).ac}`);
  assert.equal(world.sheet(hero.id).ac, 12);
});

await kit.endFight();
world.close();
finish();
