// Defects the exploration recount found in what the repair itself built
// (/tmp/odm-enf2/recount/explore.md, section 4), each held here by a test
// that failed on the code as the recount found it.
//
// The rules, from SRD 5.1:
//   - Armor of Invulnerability: "You have resistance to nonmagical damage
//     while you wear this armor", every type, not only the three weapon ones.
//   - Amulet of Health: Constitution 19; hit points follow the modifier, and
//     a level of exhaustion (below 4) does not touch the hit point maximum.
//   - Selling Treasure: equipment sells for half its cost; gems, jewelry and
//     art objects keep their full value. A magic item is not an art object.
//   - Adventuring Gear: a waterskin holds water and is kept; a lantern burns
//     a flask of oil, not a magic oil.
//   - Spell Scroll: the scroll is used up only when its spell is read.
//   - Magic Items, Spells: a spell cast from an item expends no spell slot.
//   - A boolean the model sends as the string "false" is false.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-explore-defects");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const tv = await import("../src/lib/dm/trade-value.ts");
const { itemUseProblem } = await import("../src/lib/dm/item-logic.ts");
const { carriedLight } = await import("../src/lib/dm/light-timers.ts");

const carries = (id, name) => world.sheet(id).equipment.some((item) => item.name === name);
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
async function raw(name, text) {
  const sheets = world.sheets();
  return dispatchAdjudication(name, text, {
    campaign: world.campaign(),
    turn: createDmTurn(world.campaignId, [], "ai"),
    sheets,
    sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
    realDiceUserIds: new Set(),
  });
}

// ---- a string "false" is false ----

await test("A boolean argument sent as the string \"false\" is false: pc_attack with useInspiration \"false\" spends no Inspiration.", async () => {
  const fighter = world.addHero({ class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  await kit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  const [enemy] = world.enemies();
  kit.giveTurn(fighter.id);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  world.patch(fighter.id, { resources: { ...world.sheet(fighter.id).resources, inspiration: { max: 1, used: 0 } } });
  // The call as the model's turn loop makes it: a raw string, straight to
  // the dispatcher (the DM console's form refuses a string for a checkbox).
  world.clearDice();
  world.diceLog();
  world.dice(15, 4);
  world.say("player", "I swing at it.", fighter);
  const out = await raw("pc_attack", JSON.stringify({ characterId: fighter.id, targetEnemyId: enemy.id, useInspiration: "false" }));
  const d20s = world.diceLog().filter((die) => die.sides === 20).length;
  world.clearDice();
  await kit.endFight();
  assert.equal(typeof out.error, "undefined", out.error);
  assert.equal(d20s, 1, "the attack rolled with advantage");
  assert.equal(world.sheet(fighter.id).resources.inspiration.used, 0, "Inspiration was spent");
});

// ---- hit points under items and exhaustion ----

await test("A level of exhaustion below 4 leaves the hit point maximum alone, including what an Amulet of Health adds.", async () => {
  const hero = world.addHero({ class: "fighter", level: 10, maxHp: 60, abilities: { con: 10 }, equipment: [{ name: "Amulet of Health", qty: 1, equipped: true, attuned: true }] });
  world.patch(hero.id, { currentHp: 100 });
  const out = await world.invoke("set_condition", { characterId: hero.id, condition: "exhaustion" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).exhaustion, 1);
  assert.equal(world.sheet(hero.id).currentHp, 100, "exhaustion 1 clamped the hit points to the stored maximum");
});

// ---- Armor of Invulnerability ----

await test("Armor of Invulnerability halves nonmagical damage of every type (fire from burning oil), never magical damage.", async () => {
  const knight = world.addHero({ class: "fighter", level: 5, maxHp: 40, proficiencies: TRAINED, equipment: [{ name: "Armor of Invulnerability", qty: 1, equipped: true, attuned: true }] });
  world.patch(knight.id, { currentHp: 30 });
  await world.invoke("apply_damage", { characterId: knight.id, amount: 10, type: "fire", reason: "burning lamp oil" });
  assert.equal(world.sheet(knight.id).currentHp, 25, "nonmagical fire landed whole");
  world.patch(knight.id, { currentHp: 30 });
  await world.invoke("apply_damage", { characterId: knight.id, amount: 10, type: "fire", magical: true, reason: "a fire bolt" });
  assert.equal(world.sheet(knight.id).currentHp, 20, "magical fire was halved");
  world.patch(knight.id, { currentHp: 30 });
  await world.invoke("apply_damage", { characterId: knight.id, amount: 10, type: "slashing", reason: "an orc's axe" });
  assert.equal(world.sheet(knight.id).currentHp, 25);
});

// ---- what things are worth ----

await test("A value written into an item's name prices it only when it is a gem, art object or trade good: \"Plate Armor (1 gp)\" is plate armor at its list price.", async () => {
  assert.equal(tv.listPriceCp("Plate Armor (1 gp)") === 100, false, "the name set plate armor's price to 1 gp");
  const buyer = world.addHero({ class: "fighter", level: 1 });
  world.patch(buyer.id, { gold: 100, equipment: [] });
  await world.invoke("purchase", { characterId: buyer.id, item: "Plate Armor (1 gp)", price: 1500, qty: 1, action: "buy" });
  assert.equal(carries(buyer.id, "Plate Armor (1 gp)") || carries(buyer.id, "Plate Armor"), false, "plate armor was bought for a price in its name");
  assert.equal(world.sheet(buyer.id).gold, 100);
});

await test("Only gems, jewelry, art objects and trade goods sell at full value: a magic item or a priced piece of gear does not.", async () => {
  for (const name of ["Pearl of Power", "Brooch of Shielding", "Necklace of Fireballs", "Gem of Seeing", "Circlet of Blasting", "Crown of Stars", "Figurine of Wondrous Power (Onyx Dog)", "Signet Ring", "Reliquary"]) {
    assert.equal(tv.keepsFullValue(name), false, `${name} kept full value`);
  }
  assert.equal(tv.keepsFullValue("Ruby (1000 gp)"), true);
  assert.equal(tv.keepsFullValue("Silver chalice worth 25 gp"), true);
  assert.equal(tv.keepsFullValue("Gold bar"), true);
});

if (world.hasPack) {
  await test("An item's list price is found by its exact name however many longer names share its letters: a Shield is 10 gp.", async () => {
    // "Shield" shares its letters with a page of magic shields that sort
    // before it; the list price is the plain Shield's, 10 gp.
    assert.equal(tv.listPriceCp("Shield"), 1000, "the Shield's 10 gp list price was not found");
    assert.equal(tv.packListCp("shield"), 1000);
  });
}

await test("A shop pays at most 100,000 gp a unit for a thing the table has no price for, the same ceiling purchase keeps; a larger number is refused and nothing moves.", async () => {
  const seller = world.addHero({ class: "rogue", level: 1 });
  world.patch(seller.id, { gold: 0, copper: 0, equipment: [{ name: "Carved Whistle", qty: 1 }] });
  const opened = await world.invoke("open_shop", { name: "The Last Stall", kind: "curiosities", size: "city" });
  assert.equal(opened.ok, true, opened.error);
  const sold = await world.invoke("sell_item", { characterId: seller.id, shop: "The Last Stall", item: "Carved Whistle", priceCp: 50_000_000_000 });
  assert.equal(sold.ok, false, "a whistle sold for 500 million gold");
  assert.equal(world.sheet(seller.id).gold, 0);
  assert.equal(carries(seller.id, "Carved Whistle"), true);
});

// ---- what use_item uses up ----

await test("use_item never destroys a waterskin or a Necklace of Prayer Beads; a Bead of Force and a day's rations are used up.", async () => {
  assert.notEqual(itemUseProblem("Waterskin"), null, "a waterskin counted as used up");
  assert.notEqual(itemUseProblem("Necklace of Prayer Beads"), null, "prayer beads counted as used up");
  assert.equal(itemUseProblem("Bead of Force"), null);
  assert.equal(itemUseProblem("Rations (1 day)"), null);
  const drinker = world.addHero({ class: "fighter", level: 2, equipment: [{ name: "Waterskin", qty: 1 }] });
  await world.invoke("use_item", { characterId: drinker.id, item: "Waterskin" });
  assert.equal(carries(drinker.id, "Waterskin"), true, "the waterskin was destroyed");
});

await test("A lantern burns a flask of lamp oil, never a magic oil such as Oil of Sharpness.", async () => {
  assert.equal(carriedLight({ equipment: [{ name: "Hooded Lantern", qty: 1 }, { name: "Oil of Sharpness", qty: 1 }] }).radius, 0, "the lantern burned Oil of Sharpness");
  assert.equal(carriedLight({ equipment: [{ name: "Lantern", qty: 1 }, { name: "Oil of Etherealness", qty: 1 }] }).radius, 0);
  assert.ok(carriedLight({ equipment: [{ name: "Lantern", qty: 1 }, { name: "Oil (flask)", qty: 1 }] }).radius > 0);
  assert.ok(carriedLight({ equipment: [{ name: "Lantern", qty: 1 }, { name: "Lamp oil", qty: 1 }] }).radius > 0);
});

// ---- scrolls and wands ----

await test("A spell scroll whose reading check cannot be made is refused and kept, never used up and reported as a failed check of 0.", async () => {
  const mage = world.addHero({ class: "wizard", level: 5, abilities: { int: 16 } });
  world.patch(mage.id, { equipment: [{ name: "Spell Scroll (Fireball)", qty: 1 }], spellcasting: { known: ["Magic Missile"] } });
  const out = await world.invoke("use_item", { characterId: mage.id, item: "Spell Scroll (Fireball)" });
  assert.equal(carries(mage.id, "Spell Scroll (Fireball)"), true, `the scroll was used up: ${JSON.stringify(out.result ?? out.error)}`);
});

await test("use_item with a name that fits both a charged item and another item does not spend the charged item's charges.", async () => {
  const cleric = world.addHero({ class: "cleric", level: 5, abilities: { wis: 16 } });
  world.patch(cleric.id, { currentHp: 10, equipment: [{ name: "Staff of Healing", qty: 1, equipped: true, attuned: true }, { name: "Potion of Healing", qty: 1 }] });
  await world.invoke("use_item", { characterId: cleric.id, item: "healing" });
  const staff = world.sheet(cleric.id).equipment.find((item) => item.name === "Staff of Healing");
  assert.equal(staff.charges ?? 10, 10, "a staff charge was spent for a use_item that named no staff");
});

await test("A spell cast from a scroll just read spends no spell slot when its effect is resolved through heal.", async () => {
  const cleric = world.addHero({
    class: "cleric", level: 3, abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: [] },
    equipment: [{ name: "Spell Scroll (Cure Wounds)", qty: 1 }],
  });
  const friend = world.addHero({ class: "fighter", level: 3, maxHp: 30 });
  world.patch(friend.id, { currentHp: 5 });
  const read = await world.invoke("use_item", { characterId: cleric.id, item: "Spell Scroll (Cure Wounds)" });
  assert.equal(read.ok, true, read.error);
  assert.equal(read.result.spellCast, "Cure Wounds");
  const healed = await world.invoke("heal", { characterId: friend.id, casterId: cleric.id, spell: "Cure Wounds", reason: "the scroll" });
  assert.equal(healed.ok, true, healed.error);
  assert.ok(world.sheet(friend.id).currentHp > 5, "the scroll's healing did not land");
  assert.equal(world.sheet(cleric.id).spellcasting.slots["1"].used, 0, "a slot was spent on top of the scroll");
});

await test("A spell cast from a wand's charge spends no spell slot when its effect is resolved through cast_at_enemy.", async () => {
  const mage = world.addHero({
    class: "wizard", level: 3, abilities: { int: 16 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: ["Magic Missile"], known: [], cantrips: [] },
    equipment: [{ name: "Wand of Magic Missiles", qty: 1 }],
  });
  await kit.fight(1, { heroFaces: { [mage.id]: 19 } });
  const [enemy] = world.enemies();
  kit.giveTurn(mage.id);
  kit.place(mage.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  const used = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Magic Missiles", charges: 1, spell: "Magic Missile" });
  assert.equal(used.ok, true, used.error);
  world.dice(2, 2, 2);
  const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Magic Missile", level: 1, darts: 3 });
  world.clearDice();
  await kit.endFight();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 0, "a slot was spent on top of the wand's charge");
});

// ---- new behaviour around the fixes ----

await test("strictBooleanArgs turns the words true and false into booleans, leaves every other value alone, and both entry points (the dispatcher and the model's turn loop) run it", async () => {
  const { strictBooleanArgs } = await import("../src/lib/dm/arg-coerce.ts");
  assert.deepEqual(JSON.parse(strictBooleanArgs(JSON.stringify({ a: "false", b: "TRUE", c: "no", d: 1, e: "falsey" }))), { a: false, b: true, c: "no", d: 1, e: "falsey" });
  assert.equal(strictBooleanArgs("{not json"), "{not json");
  assert.equal(strictBooleanArgs("[]"), "[]");
  const fs = await import("node:fs");
  const turn = fs.readFileSync(new URL("../src/lib/dm/turn.ts", import.meta.url), "utf8");
  assert.match(turn, /const rawArguments = strictBooleanArgs\(toolCall\.rawArguments\)/);
});

await test("A spell read from a scroll is cast with the scroll's save DC (13 for a 1st-level spell), not the reader's own, and a second cast of it spends a slot as usual", async () => {
  const { spellSaveDcFor } = await import("../src/lib/srd/index.ts");
  const sage = world.addHero({
    class: "wizard", level: 9, abilities: { int: 20 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Burning Hands"], known: [], cantrips: [] },
    equipment: [{ name: "Spell Scroll (Burning Hands)", qty: 1 }],
  });
  assert.equal(spellSaveDcFor(world.sheet(sage.id), "Burning Hands"), 17);
  const read = await world.invoke("use_item", { characterId: sage.id, item: "Spell Scroll (Burning Hands)" });
  assert.equal(read.ok, true, read.error);
  assert.equal(read.result.saveDc, 13);
  assert.equal(spellSaveDcFor(world.sheet(sage.id), "Burning Hands"), 13);
  const first = await world.invoke("use_spell_slot", { characterId: sage.id, spell: "Burning Hands", level: 1 });
  assert.equal(first.ok, true, first.error);
  assert.equal(world.sheet(sage.id).spellcasting.slots["1"].used, 0, "the scroll's cast spent a slot");
  const second = await world.invoke("use_spell_slot", { characterId: sage.id, spell: "Burning Hands", level: 1 });
  assert.equal(second.ok, true, second.error);
  assert.equal(world.sheet(sage.id).spellcasting.slots["1"].used, 1, "a cast with no scroll behind it spent no slot");
});

await test("A wand's spell costs what the item says: Wand of Fireballs at 2 charges is a 4th-level Fireball at DC 15; a spell the wand does not cast is refused and spends nothing", async () => {
  const mage = world.addHero({
    class: "wizard", level: 5, abilities: { int: 16 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: [] },
    equipment: [{ name: "Wand of Fireballs", qty: 1, equipped: true, attuned: true }],
  });
  const wrong = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Fireballs", charges: 1, spell: "Cone of Cold" });
  assert.equal(wrong.ok, false);
  assert.equal(world.sheet(mage.id).equipment[0].charges ?? 7, 7, "a refused cast spent a charge");
  const cast = await world.invoke("use_item", { characterId: mage.id, item: "Wand of Fireballs", charges: 2, spell: "Fireball" });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(cast.result.spellLevel, 4);
  assert.equal(cast.result.saveDc, 15);
  assert.equal(world.sheet(mage.id).equipment[0].charges, 5);
});

// ---- what the narrator sees ----

await test("GAME STATE shows each character's afflictions (a disease, a madness, a poison waiting) and their lifestyle and downtime progress, so the narrator plays them from the engine's record.", async () => {
  const { fakeModel, reply } = await import("./lib/enforce-narrator.mjs");
  // A table with no voice, so the turn leaves nothing running behind it.
  const told = await openWorld({ gameSettings: { ttsEnabled: false } });
  const model = await fakeModel();
  model.pointAt(told);
  const patient = told.addHero({ name: "Oswin", class: "fighter", level: 3 });
  // Still incubating: no condition on the sheet yet, only the record.
  await told.invoke("afflict", { characterId: patient.id, kind: "disease", name: "Sewer Plague", save: false });
  await told.invoke("set_lifestyle", { characterIds: [patient.id], lifestyle: "modest" });
  model.script([reply({ text: "The sewers stink behind you." })]);
  await model.turn(told, "I rest by the fire.", patient.id);
  model.close();
  const sent = JSON.stringify(model.requests[0]?.messages ?? []);
  assert.match(sent, /infected with Sewer Plague, symptoms in/, "the disease never reached GAME STATE");
  assert.match(sent, /lifestyle modest/, "the lifestyle never reached GAME STATE");
});

world.close();
finish();
