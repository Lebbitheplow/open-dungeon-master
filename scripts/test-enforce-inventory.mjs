// What a character carries, as the stored sheet holds it.
//
// Items move through the DM's tools (grant_item, remove_item, use_item,
// reveal_item in src/lib/dm/mutations.ts): a grant stacks onto a row of the
// same name, a count is never below 1 or above the sheet schema's 999, a
// sheet never holds more than the schema's 60 rows, a character cannot lose
// or use what they do not carry, and a healing potion takes one off the
// stack and heals by dice the server rolls. An unidentified item is carried
// under the description the party would use until the DM reveals it.
//
// Encumbrance is ODM's documented variant (docs/rules-coverage.md): off, a
// pack weighs nothing on any roll; on, more than 5 x STR pounds costs 10
// feet, more than 10 x STR costs 20 feet and disadvantage on Strength,
// Dexterity and Constitution rolls. Past 15 x STR ODM keeps the penalties
// rather than refusing the item, where the SRD says it cannot be carried
// (src/lib/srd/encumbrance.ts, "overCapacity").
//
// A player may not write their own pack or purse: outside a level-up the
// sheet route takes portrait, notes and backstory only.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { gearKit } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-inventory");

const world = await openWorld();
const player = world.addUser("pack");
const hero = world.addHero({ user: player, class: "fighter", level: 3, maxHp: 40 });
const friend = world.addHero({ class: "cleric", level: 3, maxHp: 30 });
const sheet = () => world.sheet(hero.id);
const row = (name, id = hero.id) => world.sheet(id).equipment.find((item) => item.name.toLowerCase() === name.toLowerCase());
const pack = (equipment, extra = {}) => world.patch(hero.id, { equipment, ...extra });
const act = (name, args) => world.invoke(name, { characterId: hero.id, reason: "test", ...args });

// ---- giving and taking ----

await test("a granted item lands on the sheet, and a second grant stacks onto the same row", async () => {
  pack([]);
  assert.equal((await act("grant_item", { name: "Torch", qty: 3 })).ok, true);
  assert.equal((await act("grant_item", { name: "torch", qty: 2 })).ok, true);
  assert.equal(sheet().equipment.length, 1);
  assert.equal(row("Torch").qty, 5);
});

await test("a grant of nothing, or of less than nothing, never lowers a count", async () => {
  pack([{ name: "Rations", qty: 4 }]);
  for (const qty of [0, -1, -50]) {
    await act("grant_item", { name: "Rations", qty });
    assert.ok(row("Rations").qty >= 4, `qty ${qty} left ${row("Rations").qty}`);
  }
  await act("grant_item", { name: "Rope", qty: -3 });
  assert.ok(row("Rope") === undefined || row("Rope").qty >= 1);
});

await test("a grant without a name is refused", async () => {
  pack([]);
  assert.equal((await act("grant_item", { name: "   " })).ok, false);
  assert.equal(sheet().equipment.length, 0);
});

await test("taking part of a stack leaves the rest, taking all of it removes the row", async () => {
  pack([{ name: "Arrows", qty: 20 }]);
  assert.equal((await act("remove_item", { name: "Arrows", qty: 5 })).ok, true);
  assert.equal(row("Arrows").qty, 15);
  assert.equal((await act("remove_item", { name: "arrows", qty: 15 })).ok, true);
  assert.equal(row("Arrows"), undefined);
});

await test("taking more than is held takes what there is and never leaves a negative count", async () => {
  pack([{ name: "Caltrops", qty: 2 }]);
  const taken = await act("remove_item", { name: "Caltrops", qty: 9 });
  assert.equal(taken.result.qty, 2);
  assert.equal(row("Caltrops"), undefined);
  assert.ok(sheet().equipment.every((item) => item.qty >= 1));
});

await test("taking what is not carried is refused and the pack is untouched", async () => {
  pack([{ name: "Lantern", qty: 1 }]);
  const before = sheet().equipment;
  assert.equal((await act("remove_item", { name: "Crown of Kings" })).ok, false);
  assert.deepEqual(sheet().equipment, before);
});

await test("An item's count on a sheet runs from 1 to 999 (equipmentItemSchema).", async () => {
  pack([{ name: "Ball Bearings", qty: 990 }]);
  await act("grant_item", { name: "Ball Bearings", qty: 99 });
  assert.ok(row("Ball Bearings").qty <= 999, `the stack holds ${row("Ball Bearings").qty}`);
});

await test("A sheet holds at most 60 kinds of item (createSheetSchema and patchSheetSchema).", async () => {
  pack(Array.from({ length: 60 }, (_, index) => ({ name: `Trinket ${index + 1}`, qty: 1 })));
  const granted = await act("grant_item", { name: "Trinket 61" });
  const held = sheet().equipment.length;
  pack([]);
  assert.ok(granted.ok === false && held === 60, `the sheet holds ${held} rows`);
});

// ---- using ----

const hurt = (id, hp) => world.patch(id, { currentHp: hp });
async function drink(args, ...faces) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const outcome = await act("use_item", args);
  return { ...outcome, log: world.diceLog(), unused: world.clearDice() };
}

await test("a potion of healing takes one off the stack and heals 2d4 + 2 by the server's dice", async () => {
  pack([{ name: "Potion of Healing", qty: 3 }]);
  hurt(hero.id, 10);
  const drunk = await drink({ item: "Potion of Healing" }, 3, 4);
  assert.equal(drunk.ok, true, drunk.error);
  assert.deepEqual(drunk.log.map((die) => die.sides), [4, 4]);
  assert.equal(sheet().currentHp, 10 + 3 + 4 + 2);
  assert.equal(row("Potion of Healing").qty, 2);
});

await test("each tier of healing potion rolls the dice the SRD gives it", async () => {
  const tiers = [
    ["Potion of Greater Healing", 4, 4],
    ["Potion of Superior Healing", 8, 8],
    ["Potion of Supreme Healing", 10, 20],
  ];
  world.patch(hero.id, { maxHp: 200 });
  for (const [name, dice, flat] of tiers) {
    pack([{ name, qty: 1 }]);
    hurt(hero.id, 1);
    const drunk = await drink({ item: name }, ...new Array(dice).fill(2));
    assert.deepEqual(drunk.log.map((die) => die.sides), new Array(dice).fill(4), name);
    assert.equal(sheet().currentHp, 1 + dice * 2 + flat, name);
    assert.equal(row(name), undefined, name);
  }
  world.patch(hero.id, { maxHp: 40, currentHp: 40 });
});

await test("healing stops at the hit point maximum, and the potion is still spent", async () => {
  pack([{ name: "Potion of Healing", qty: 2 }]);
  hurt(hero.id, 38);
  await drink({ item: "Potion of Healing" }, 4, 4);
  assert.equal(sheet().currentHp, 40);
  assert.equal(row("Potion of Healing").qty, 1);
});

await test("a potion fed to someone else heals them and leaves the pack it came from", async () => {
  pack([{ name: "Potion of Healing", qty: 1 }]);
  hurt(hero.id, 12);
  hurt(friend.id, 5);
  const fed = await drink({ item: "Potion of Healing", targetCharacterId: friend.id }, 1, 2);
  assert.equal(fed.ok, true, fed.error);
  assert.equal(world.sheet(friend.id).currentHp, 5 + 1 + 2 + 2);
  assert.equal(sheet().currentHp, 12);
  assert.equal(row("Potion of Healing"), undefined);
});

await test("using what is not carried is refused: no dice, no healing, no change", async () => {
  pack([{ name: "Rope", qty: 1 }]);
  hurt(hero.id, 10);
  const drunk = await drink({ item: "Potion of Healing" }, 4, 4);
  assert.equal(drunk.ok, false);
  assert.equal(drunk.log.length, 0);
  assert.equal(sheet().currentHp, 10);
  assert.deepEqual(sheet().equipment.map((item) => item.name), ["Rope"]);
});

await test("a consumable with no dice of its own is simply spent", async () => {
  pack([{ name: "Rations", qty: 2 }]);
  hurt(hero.id, 10);
  const eaten = await drink({ item: "Rations" }, 4, 4);
  assert.equal(eaten.ok, true);
  assert.equal(eaten.log.length, 0);
  assert.equal(row("Rations").qty, 1);
  assert.equal(sheet().currentHp, 10);
});

// ---- unidentified ----

await test("an unidentified item is carried under its description and kept apart from a known one", async () => {
  pack([{ name: "Silver Ring", qty: 1 }]);
  await act("grant_item", { name: "Silver Ring", unidentified: true });
  const rings = sheet().equipment.filter((item) => item.name === "Silver Ring");
  assert.equal(rings.length, 2);
  assert.deepEqual(rings.map((item) => item.identified === false), [false, true]);
});

await test("the reveal renames the mystery and only the mystery", async () => {
  const revealed = await act("reveal_item", { name: "Silver Ring", revealedName: "Ring of Protection" });
  assert.equal(revealed.ok, true, revealed.error);
  assert.equal(row("Ring of Protection").identified, undefined);
  assert.equal(row("Silver Ring").identified, undefined);
  assert.equal(sheet().equipment.length, 2);
});

await test("an item that was never a mystery cannot be revealed into something else", async () => {
  pack([{ name: "Pebble", qty: 1 }]);
  const revealed = await act("reveal_item", { name: "Pebble", revealedName: "Staff of Power" });
  assert.equal(revealed.ok, false);
  assert.deepEqual(sheet().equipment.map((item) => item.name), ["Pebble"]);
});

// ---- the player's own hand ----

const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
async function patchOwn(body) {
  world.signIn(player);
  const response = await sheetRoute.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("a player cannot write their own pack or purse through the sheet route", async () => {
  pack([{ name: "Dagger", qty: 1 }], { gold: 5, copper: 0 });
  for (const body of [
    { gold: 5000 },
    { copper: 99 },
    { equipment: [{ name: "+3 Plate", qty: 1 }] },
    { notes: "mine", gold: 5000 },
  ]) {
    const reply = await patchOwn(body);
    assert.equal(reply.status, 403, JSON.stringify(body));
  }
  assert.equal(sheet().gold, 5);
  assert.deepEqual(sheet().equipment.map((item) => item.name), ["Dagger"]);
});

await test("A level-up changes what leveling changes; a player's gold and equipment come from the table, never from their own request.", async () => {
  pack([{ name: "Dagger", qty: 1 }], { gold: 5, copper: 0, xp: 2700 });
  const reply = await patchOwn({ level: 4, gold: 1000000, equipment: [{ name: "+3 Plate", qty: 1 }, { name: "Potion of Supreme Healing", qty: 999 }] });
  const after = sheet();
  world.patch(hero.id, { level: 3, gold: 5, xp: 900 });
  assert.ok(reply.status !== 200 || after.gold === 5, `the level-up left ${after.gold} gold and ${after.equipment.map((item) => item.name).join(", ")}`);
});

// ---- encumbrance ----

const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const maps = await import("../src/lib/db/battle-maps.ts");

async function loadTable(variant) {
  const table = await openWorld({ gameSettings: { variantRules: { encumbrance: variant } } });
  const kit = await gearKit(table);
  const holder = table.addHero({ class: "fighter", level: 3 });
  const porter = table.addHero({ class: "fighter", level: 3, abilities: { str: 10, dex: 10 }, equipment: [{ name: "Mace", qty: 1 }] });
  await kit.arena({ first: holder.id });
  kit.stand(porter.id, 1);
  const carry = (pounds, gold = 0) =>
    table.patch(porter.id, { equipment: [{ name: "Mace", qty: 1, weight: 4 }, { name: "Crate", qty: 1, weight: pounds - 4 }], gold });
  const speed = () => {
    const encounter = table.encounter();
    const map = maps.getBattleMapForEncounter(encounter.id);
    return pcMoveBudget(table.campaignId, encounter, map, table.sheet(porter.id), maps.getTokenByRef(map.id, porter.id)).speed;
  };
  const d20s = async (args) => {
    table.clearDice();
    table.diceLog();
    table.dice(15, 4);
    const outcome = await table.invoke("request_roll", { characterId: porter.id, reason: "test", ...args });
    assert.equal(outcome.ok, true, outcome.error);
    const faces = table.diceLog().filter((die) => die.sides === 20).length;
    table.clearDice();
    return faces;
  };
  return { table, kit, porter, carry, speed, d20s };
}

const weighed = await loadTable(true);

await test("at STR 10 the thresholds are 50 and 100 pounds, and the threshold itself is not over it", () => {
  for (const [pounds, speed] of [[10, 30], [50, 30], [51, 20], [100, 20], [101, 10], [150, 10]]) {
    weighed.carry(pounds);
    assert.equal(weighed.speed(), speed, `${pounds} lb`);
  }
});

await test("the thresholds move with Strength", () => {
  weighed.table.patch(weighed.porter.id, { abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  for (const [pounds, speed] of [[80, 30], [81, 20], [160, 20], [161, 10]]) {
    weighed.carry(pounds);
    assert.equal(weighed.speed(), speed, `${pounds} lb at STR 16`);
  }
  weighed.table.patch(weighed.porter.id, { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
});

await test("coins weigh 50 to the pound and count toward the load", () => {
  weighed.carry(50, 0);
  assert.equal(weighed.speed(), 30);
  weighed.carry(50, 100);
  assert.equal(weighed.speed(), 20);
});

await test("a heavy load puts disadvantage on Strength, Dexterity and Constitution rolls and on attacks, a lighter one on none", async () => {
  weighed.carry(101);
  assert.equal(await weighed.d20s({ kind: "ability_check", ability: "str" }), 2);
  assert.equal(await weighed.d20s({ kind: "saving_throw", ability: "dex" }), 2);
  assert.equal(await weighed.d20s({ kind: "saving_throw", ability: "con" }), 2);
  assert.equal(await weighed.d20s({ kind: "saving_throw", ability: "wis" }), 1);
  assert.equal(await weighed.d20s({ kind: "skill_check", skill: "arcana" }), 1);
  assert.equal((await weighed.kit.swing(weighed.porter.id, { weapon: "Mace" }, 15, 4, 3)).d20s.length, 2);
  weighed.carry(100);
  assert.equal(await weighed.d20s({ kind: "ability_check", ability: "str" }), 1);
  assert.equal((await weighed.kit.swing(weighed.porter.id, { weapon: "Mace" }, 15, 4)).d20s.length, 1);
});

await test("ODM's rule: a grant past the carrying capacity is kept, with the heavy penalties", async () => {
  // SRD 5.1 makes STR x 15 the most a character can carry at all. ODM does
  // not refuse a grant the story already made (encumbrance.ts overCapacity).
  weighed.carry(149);
  const granted = await weighed.table.invoke("grant_item", { characterId: weighed.porter.id, name: "Leather", qty: 1 });
  assert.equal(granted.ok, true);
  assert.equal(weighed.table.sheet(weighed.porter.id).equipment.some((item) => item.name === "Leather"), true);
  assert.equal(weighed.speed(), 10);
});

await weighed.kit.endFight();

const unweighed = await loadTable(false);

await test("with the variant off the same load slows nobody and weighs on no roll", async () => {
  unweighed.carry(149, 5000);
  assert.equal(unweighed.speed(), 30);
  assert.equal(await unweighed.d20s({ kind: "ability_check", ability: "str" }), 1);
  assert.equal(await unweighed.d20s({ kind: "saving_throw", ability: "con" }), 1);
  assert.equal((await unweighed.kit.swing(unweighed.porter.id, { weapon: "Mace" }, 15, 4)).d20s.length, 1);
});

await unweighed.kit.endFight();
world.close();
finish();
