// Magic weapons and armor, their charges, and attunement's short rest, as the
// engines hold them.
//
// SRD 5.1, "Magic Items": a magic weapon or armor is built on a mundane one,
// named in its entry ("Weapon (any sword)", "Armor (plate)"), and keeps that
// item's statistics. On top it carries what its text gives: a bonus to
// attack and damage or to AC, extra damage dice of a type, sometimes only
// against some creatures, a lifted Strength requirement. An item with charges
// spends them and regains them at dawn; a wand's last charge may crumble it.
// Attuning takes a short rest spent with the item.
//
// ODM reads the base item from the pack row's category, and the numbers from
// an authored rider table (scripts/lib/magic-item-riders.mjs), both written
// into src/lib/classes/magic-items.json so a table without the pack plays the
// same.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-magic-gear");
const { resolveAttackWeapon, weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { computeSheetDerived, speedFor, acBreakdownFor } = await import("../src/lib/srd/index.ts");

const MARTIAL = ["simple", "martial"];
const derivedOf = { abilityMods: { str: 3, dex: 1, con: 0, int: 0, wis: 0, cha: 0 }, proficiencyBonus: 3 };
const baseOf = (name) => resolveAttackWeapon([{ name, qty: 1 }], MARTIAL, name).srd?.name ?? null;

// ---- the base weapon ----

await test("A magic weapon is its base weapon: an SRD sword with no weapon in its name is a longsword, an axe a battleaxe, and the base the name gives wins.", () => {
  const expected = [
    ["Flame Tongue", "Longsword"], ["Holy Avenger", "Longsword"], ["Frost Brand", "Longsword"],
    ["Vorpal Sword", "Longsword"], ["Sun Blade", "Longsword"], ["Luck Blade", "Longsword"],
    ["Defender", "Longsword"], ["Dragon Slayer", "Longsword"], ["Giant Slayer", "Longsword"],
    ["Nine Lives Stealer", "Longsword"], ["Sword of Sharpness", "Longsword"], ["Dancing Sword", "Longsword"],
    ["Berserker Axe", "Battleaxe"], ["Oathbow", "Longbow"], ["Dwarven Thrower", "Warhammer"],
    ["Hammer of Thunderbolts", "Maul"], ["Flame Tongue Scimitar", "Scimitar"],
    ["Frost Brand (Greatsword)", "Greatsword"], ["Vicious Rapier", "Rapier"],
  ];
  for (const [name, base] of expected) {
    assert.equal(baseOf(name), base, `${name} swings as ${baseOf(name)}`);
  }
});

await test("With no weapon named, a character carrying only a magic sword attacks with it, not with a fist.", () => {
  const picked = resolveAttackWeapon([{ name: "Rope", qty: 1 }, { name: "Holy Avenger", qty: 1 }], MARTIAL, undefined);
  assert.equal(picked.displayName, "Holy Avenger");
  assert.equal(picked.srd?.name, "Longsword");
});

await test("A magic sword swings with the sword's die, type and proficiency, and adds its bonus only while attuned when it asks for attunement.", () => {
  const profile = (item) => weaponAttackProfile(derivedOf, MARTIAL, resolveAttackWeapon([item], MARTIAL, item.name));
  const avenger = profile({ name: "Holy Avenger", qty: 1, attuned: true });
  assert.equal(avenger.damageType, "slashing");
  assert.equal(avenger.proficient, true);
  assert.equal(avenger.improvised, false);
  assert.equal(avenger.toHit, 3 + 3 + 3);
  assert.equal(avenger.damageExpression, "1d8+6");
  const unattuned = profile({ name: "Holy Avenger", qty: 1 });
  assert.equal(unattuned.toHit, 3 + 3);
  assert.equal(unattuned.damageExpression, "1d8+3");
  // Items that need no attunement work for whoever wields them.
  const slayer = profile({ name: "Dragon Slayer", qty: 1 });
  assert.equal(slayer.toHit, 3 + 3 + 1);
  const sun = profile({ name: "Sun Blade", qty: 1, attuned: true });
  assert.equal(sun.damageType, "radiant");
  assert.ok(sun.properties.includes("finesse"));
  assert.equal(sun.toHit, 3 + 3 + 2);
});

await test("a magic weapon's blows count as magical, bonus or not, and a magic weapon named by nobody who carries it is refused, not improvised", () => {
  const brand = weaponAttackProfile(derivedOf, MARTIAL, resolveAttackWeapon([{ name: "Frost Brand", qty: 1 }], MARTIAL, "Frost Brand"));
  assert.equal(brand.magicWeapon, true);
  const missing = resolveAttackWeapon([{ name: "Rope", qty: 1 }], MARTIAL, "Flame Tongue");
  assert.equal(missing.carried, false);
});

// ---- magic armor ----

const wearer = (name, abilities = {}, armor = ["light", "medium", "heavy", "shields"]) => ({
  class: "fighter", level: 5, features: [], feats: [], conditions: [], speed: 30, race: "human",
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10, ...abilities },
  proficiencies: profs({ armor }),
  equipment: [{ name, qty: 1, equipped: true, attuned: true }],
});

await test("Magic armor is its base armor: Armor of Invulnerability is plate, Elven Chain a chain shirt +1, Dwarven Plate plate +2.", () => {
  const ac = (name, abilities) => acBreakdownFor(wearer(name, abilities)).ac;
  assert.equal(ac("Armor of Invulnerability"), 18);
  assert.equal(ac("Plate Armor of Etherealness"), 18);
  assert.equal(ac("Demon Armor"), 19);
  assert.equal(ac("Dwarven Plate"), 20);
  assert.equal(ac("Elven Chain"), 13 + 2 + 1);
  assert.equal(ac("Glamoured Studded Leather"), 12 + 2 + 1);
  assert.equal(ac("Adamantine Armor"), 16);
  assert.equal(ac("Armor of Fire Resistance"), 11 + 2);
  assert.equal(ac("Chain Mail of Fire Resistance"), 16);
});

await test("Elven Chain is worn as if trained, even by a character with light armor training only.", () => {
  const breakdown = acBreakdownFor(wearer("Elven Chain", {}, ["light"]));
  assert.equal(breakdown.unproficient, false);
  assert.equal(breakdown.ac, 16);
});

await test("Mithral armor has no Strength requirement and no Stealth disadvantage.", () => {
  for (const name of ["Mithral Plate", "Mithral Armor", "Mithral Half Plate"]) {
    const sheet = wearer(name, { str: 8 });
    const breakdown = acBreakdownFor(sheet);
    assert.equal(breakdown.stealthDisadvantage, false, name);
    assert.equal(breakdown.speedPenalty, 0, name);
    assert.equal(speedFor(sheet), 30, name);
  }
  assert.equal(acBreakdownFor(wearer("Mithral Plate")).ac, 18);
});

await test("worn Adamantine Armor turns a critical hit into a normal hit; carried and not worn it does not", async () => {
  const { wornArmorTurnsCrits } = await import("../src/lib/srd/armor.ts");
  assert.equal(wornArmorTurnsCrits([{ name: "Adamantine Armor" }]), true);
  assert.equal(wornArmorTurnsCrits([{ name: "Adamantine Half Plate" }]), true);
  assert.equal(wornArmorTurnsCrits([{ name: "Adamantine Armor", equipped: false }, { name: "Plate", equipped: true }]), false);
  assert.equal(wornArmorTurnsCrits([{ name: "Plate" }]), false);
});

await test("a name that holds an armor word is armor only when it is armor: a Leather Backpack adds nothing", () => {
  assert.equal(acBreakdownFor(wearer("Leather Backpack")).ac, 12);
  assert.equal(acBreakdownFor(wearer("Ring of Protection")).armorName, null);
});

// ---- on the table ----

const world = await openWorld();
const kit = await gearKit(world);
const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const anchor = world.addHero({ class: "fighter", level: LEVEL });
const hero = world.addHero({
  class: "paladin", level: LEVEL, acOverride: false, maxHp: 60,
  abilities: { str: 16 },
  proficiencies: profs({ armor: ["light", "medium", "heavy", "shields"], weapons: MARTIAL }),
});
const sheet = () => world.sheet(hero.id);
const carry = (equipment) => world.patch(hero.id, { equipment, currentHp: 60 });

await kit.arena({ first: anchor.id });
kit.stand(hero.id, 1);
const setDummyType = async (type) => {
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const enemy = kit.dummy();
  getDatabase().prepare(`UPDATE encounter_enemies SET stat_json = ? WHERE id = ?`).run(JSON.stringify({ ...enemy.stats, type }), enemy.id);
};

await test("An attuned Flame Tongue hits as a longsword and adds 2d6 fire to every hit.", async () => {
  carry([{ name: "Flame Tongue", qty: 1, attuned: true }]);
  const swing = await kit.swing(hero.id, { weapon: "Flame Tongue" }, 12, 5, 3, 4);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 12 + abilityMod(16) + PB);
  assert.deepEqual(swing.damageDice, [8, 6, 6]);
  assert.equal(swing.result.damage, 5 + abilityMod(16) + 3 + 4);
  assert.equal(swing.result.damageType, "slashing");
});

await test("A Holy Avenger adds +3 and deals 2d10 radiant more to a fiend or an undead, and not to anything else.", async () => {
  carry([{ name: "Holy Avenger", qty: 1, attuned: true }]);
  await setDummyType("undead");
  let swing = await kit.swing(hero.id, { weapon: "Holy Avenger" }, 12, 5, 6, 7);
  assert.equal(swing.result.rolled, 12 + abilityMod(16) + PB + 3);
  assert.deepEqual(swing.damageDice, [8, 10, 10]);
  assert.equal(swing.result.damage, 5 + abilityMod(16) + 3 + 6 + 7);
  await setDummyType("humanoid");
  swing = await kit.swing(hero.id, { weapon: "Holy Avenger" }, 12, 5);
  assert.deepEqual(swing.damageDice, [8]);
  assert.equal(swing.result.damage, 5 + abilityMod(16) + 3);
});

await test("a Vicious Weapon adds 2d6 on a natural 20, and nothing on any other hit", async () => {
  carry([{ name: "Vicious Longsword", qty: 1 }]);
  let swing = await kit.swing(hero.id, { weapon: "Vicious Longsword" }, 19, 5);
  assert.deepEqual(swing.damageDice, [8]);
  swing = await kit.swing(hero.id, { weapon: "Vicious Longsword" }, 20, 1, 1, 1, 1, 1, 1);
  assert.deepEqual([...swing.damageDice].sort(), [6, 6, 6, 6, 8, 8]);
});

await kit.endFight();

await test("Armor of Invulnerability, worn and attuned, halves nonmagical damage of every type and no magical damage.", async () => {
  // Proven at HEAD by /tmp/odm-enf2/proof2.txt (10 slashing took 10): the
  // table stored the resistance as the bare word "nonmagical", which names
  // no damage type. The regenerated table carries the phrase the damage
  // engine reads.
  carry([{ name: "Armor of Invulnerability", qty: 1, equipped: true, attuned: true }]);
  let hit = await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "slashing", reason: "an orc's axe" });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(sheet().currentHp, 55);
  world.patch(hero.id, { currentHp: 60 });
  hit = await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "slashing", magical: true, reason: "a flame tongue" });
  assert.equal(sheet().currentHp, 50);
  // SRD 5.1: "resistance to nonmagical damage", every type (last-explore
  // AI1): a Fire Bolt is magical and lands whole, burning oil is halved.
  world.patch(hero.id, { currentHp: 60 });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "fire", magical: true, reason: "a fire bolt" });
  assert.equal(sheet().currentHp, 50);
  world.patch(hero.id, { currentHp: 60 });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "fire", reason: "burning oil" });
  assert.equal(sheet().currentHp, 55);
});

// ---- charges ----

const mage = world.addHero({ class: "wizard", level: LEVEL, maxHp: 30 });
const wand = () => world.sheet(mage.id).equipment.find((item) => item.name === "Wand of Magic Missiles");

await test("A Wand of Magic Missiles holds 7 charges: each use spends what it costs, the wand stays in the pack, and a use with too few charges left is refused.", async () => {
  world.patch(mage.id, { equipment: [{ name: "Wand of Magic Missiles", qty: 1 }] });
  let used = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Magic Missiles", charges: 3 });
  assert.equal(used.ok, true, used.error);
  assert.equal(wand()?.charges, 4);
  used = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Magic Missiles", charges: 5 });
  assert.equal(used.ok, false);
  assert.equal(wand()?.charges, 4);
});

await test("At dawn a wand regains 1d6 + 1 of its expended charges, never past its most.", async () => {
  world.patch(mage.id, { equipment: [{ name: "Wand of Magic Missiles", qty: 1, charges: 1 }] });
  world.clearDice();
  world.dice(2);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  world.clearDice();
  assert.equal(wand()?.charges, 1 + 2 + 1);
  world.dice(6);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  world.clearDice();
  assert.equal(wand()?.charges, 7);
});

await test("Spending a wand's last charge rolls a d20, and on a 1 the wand is destroyed.", async () => {
  world.patch(mage.id, { equipment: [{ name: "Wand of Magic Missiles", qty: 1, charges: 1 }] });
  world.dice(20);
  let used = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Magic Missiles", charges: 1 });
  assert.equal(world.clearDice(), 0, "the d20 for the last charge was not rolled");
  assert.equal(used.ok, true, used.error);
  assert.equal(wand()?.charges, 0);
  world.patch(mage.id, { equipment: [{ name: "Wand of Magic Missiles", qty: 1, charges: 1 }] });
  world.dice(1);
  used = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Magic Missiles", charges: 1 });
  assert.equal(world.clearDice(), 0);
  assert.equal(used.ok, true, used.error);
  assert.equal(wand(), undefined);
});

// ---- attunement takes a short rest ----

const usage = await world.route("campaigns/[campaignId]/sheet/usage");
async function attune(name) {
  world.signIn(world.owner);
  const response = await usage.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ characterId: hero.id, gear: { [name]: { attuned: true } } }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("Attuning takes a short rest: asked outside a fight, the item waits, attuning, and becomes attuned when the character finishes a short rest.", async () => {
  carry([{ name: "Ring of Protection", qty: 1, equipped: true }]);
  const before = sheet().ac;
  const reply = await attune("Ring of Protection");
  assert.equal(reply.status, 200, reply.body.error);
  let ring = sheet().equipment.find((item) => item.name === "Ring of Protection");
  assert.equal(ring.attuned ?? false, false);
  assert.equal(ring.attuning, true);
  assert.equal(sheet().ac, before);
  world.dice(1, 1, 1, 1, 1);
  const rested = await world.invoke("take_rest", { kind: "short" });
  world.clearDice();
  assert.equal(rested.ok, true, rested.error);
  ring = sheet().equipment.find((item) => item.name === "Ring of Protection");
  assert.equal(ring.attuned, true);
  assert.equal(ring.attuning, undefined);
  assert.equal(sheet().ac, before + 1);
});

await test("A cursed item's attunement cannot be ended by the wearer: letting go of an attuned Berserker Axe is refused.", async () => {
  carry([{ name: "Berserker Axe", qty: 1, equipped: true, attuned: true }]);
  world.signIn(world.owner);
  const response = await usage.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ characterId: hero.id, gear: { "Berserker Axe": { attuned: false } } }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 409);
  assert.equal(sheet().equipment[0].attuned, true);
});

await test("the GAME STATE line for a magic item says what the engine applies, its charges, and whether it is worn and attuned", async () => {
  const { magicItemLine } = await import("../src/lib/dm/item-summary.ts");
  const tongue = magicItemLine({ name: "Flame Tongue", qty: 1, attuned: true, equipped: true });
  assert.match(tongue, /longsword/);
  assert.match(tongue, /\+2d6 fire/);
  assert.match(tongue, /attuned, worn/);
  assert.match(magicItemLine({ name: "Wand of Magic Missiles", qty: 1, charges: 3 }), /3\/7 charges/);
  assert.match(magicItemLine({ name: "Ring of Protection", qty: 1, attuning: true }), /attuning at the next rest/);
  assert.equal(magicItemLine({ name: "Rope", qty: 1 }), null);
});

await test("a magic item's charges and its pending attunement are optional fields: an old row with neither still loads", () => {
  carry([{ name: "Rope", qty: 1 }]);
  assert.deepEqual(sheet().equipment.map((item) => item.name), ["Rope"]);
  assert.equal(computeSheetDerived(sheet()).proficiencyBonus, PB);
});

world.close();
finish();
