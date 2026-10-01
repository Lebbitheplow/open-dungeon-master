// Attunement, as the stored sheet holds it.
//
// SRD 5.1, "Attunement": a creature can be attuned to no more than three
// magic items at a time, and to no more than one copy of an item; attuning
// takes a short rest spent with the item; some items can be attuned only by
// a class, a race or an alignment; an item that requires attunement gives
// its magic to nobody who is not attuned to it.
//
// ODM keeps the flag on the equipment row and the cap in db/sheets.ts
// capAttunement, and the player sets the flag through POST /sheet/usage. An
// effect counts while the item is worn and, if it asks for attunement,
// attuned (src/lib/srd/magic-items.ts header); the few items whose text says
// "on your person" work from the pack.
import assert from "node:assert/strict";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-attunement");
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");

const world = await openWorld();
const player = world.addUser("attuned");
const hero = world.addHero({
  user: player, class: "fighter", level: 5, acOverride: false,
  abilities: { str: 12, dex: 10 },
  proficiencies: profs({ armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] }),
});
const sheet = () => world.sheet(hero.id);
const carry = (equipment) => world.patch(hero.id, { equipment });
const saves = () => computeSheetDerived(sheet()).saves;
const attunedNames = (from = sheet()) => from.equipment.filter((item) => item.attuned).map((item) => item.name);

const usage = await world.route("campaigns/[campaignId]/sheet/usage");
async function adjust(body, user = player, campaignId = world.campaignId) {
  world.signIn(user);
  const response = await usage.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}
const attune = (name, attuned = true) => adjust({ gear: { [name]: { attuned } } });
// Attuning takes a short rest spent with the item (SRD 5.1): the route puts
// the item on the wait, and the rest makes it attuned.
const shortRest = async () => {
  const rested = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rested.ok, true, rested.error);
};

// ---- the magic is for the attuned ----

await test("an item that asks for attunement does nothing until the player attunes, and stops when they let go", async () => {
  carry([{ name: "Ring of Protection", qty: 1 }]);
  assert.equal(sheet().ac, 10);
  assert.equal(saves().wis, 0);
  assert.equal((await attune("Ring of Protection")).status, 200);
  assert.equal(sheet().ac, 10);
  await shortRest();
  assert.equal(sheet().ac, 11);
  assert.deepEqual(saves(), { str: 2, dex: 1, con: 1, int: 1, wis: 1, cha: 1 });
  await attune("Ring of Protection", false);
  assert.equal(sheet().ac, 10);
  assert.equal(saves().dex, 0);
});

await test("an attuned item that leaves the pack takes its magic with it", async () => {
  carry([{ name: "Cloak of Protection", qty: 1, attuned: true }]);
  assert.equal(sheet().ac, 11);
  await world.invoke("remove_item", { characterId: hero.id, name: "Cloak of Protection", reason: "stolen" });
  assert.equal(sheet().ac, 10);
  assert.equal(saves().con, 0);
});

await test("an item handed over by the DM never arrives attuned", async () => {
  carry([]);
  await world.invoke("grant_item", { characterId: hero.id, name: "Ring of Protection", reason: "loot" });
  assert.deepEqual(attunedNames(), []);
  assert.equal(sheet().ac, 10);
});

await test("a player cannot attune to what they do not carry", async () => {
  carry([{ name: "Rope", qty: 1 }]);
  assert.equal((await attune("Ring of Protection")).status, 400);
  assert.deepEqual(sheet().equipment.map((item) => item.name), ["Rope"]);
});

await test("an attuned ring left in the pack gives nothing; on the finger it works", async () => {
  carry([{ name: "Leather", qty: 1, equipped: true }, { name: "Ring of Protection", qty: 1, attuned: true, equipped: false }]);
  assert.equal(sheet().ac, 11);
  assert.equal(saves().wis, 0);
  carry([{ name: "Leather", qty: 1, equipped: true }, { name: "Ring of Protection", qty: 1, attuned: true, equipped: true }]);
  assert.equal(sheet().ac, 11 + 1);
  assert.equal(saves().wis, 1);
});

await test("an item whose text says 'on your person' works from the pack", async () => {
  carry([{ name: "Leather", qty: 1, equipped: true }, { name: "Luck Blade", qty: 1, attuned: true, equipped: false }]);
  assert.equal(saves().wis, 1);
});

await test("a sheet that never said what is worn wears what it carries", async () => {
  carry([{ name: "Leather", qty: 1 }, { name: "Ring of Protection", qty: 1, attuned: true }]);
  assert.equal(sheet().ac, 11 + 1);
});

await test("magic armor left in the pack adds nothing", async () => {
  carry([{ name: "Leather", qty: 1, equipped: true }, { name: "+2 Plate", qty: 1, equipped: false }, { name: "+1 Shield", qty: 1, equipped: false }]);
  assert.equal(sheet().ac, 11);
});

// ---- three, and no more ----

const FOUR = ["Ring of Protection", "Cloak of Protection", "Robe of Stars", "Luck Blade"];

await test("the fourth attunement through the player's route does not take, and the first three stand", async () => {
  carry(FOUR.map((name) => ({ name, qty: 1 })));
  for (const name of FOUR) {
    await attune(name);
  }
  await shortRest();
  assert.deepEqual(attunedNames(), FOUR.slice(0, 3));
  assert.equal(sheet().ac, 12);
  assert.equal(saves().wis, 3);
});

await test("letting one go makes room for another", async () => {
  await attune("Cloak of Protection", false);
  await attune("Luck Blade");
  await shortRest();
  assert.deepEqual(attunedNames(), ["Ring of Protection", "Robe of Stars", "Luck Blade"]);
  assert.equal(sheet().ac, 11);
  assert.equal(saves().wis, 3);
});

await test("four attuned items in one write are cut to three", async () => {
  carry(FOUR.map((name) => ({ name, qty: 1, attuned: true })));
  assert.deepEqual(attunedNames(), FOUR.slice(0, 3));
  const gearBody = Object.fromEntries(FOUR.map((name) => [name, { attuned: true }]));
  await adjust({ gear: gearBody });
  assert.equal(attunedNames().length, 3);
});

await test("the DM's update_sheet cannot write a fourth attunement either", async () => {
  carry([]);
  const written = await world.invoke("update_sheet", {
    characterId: hero.id,
    equipment: FOUR.map((name) => ({ name, qty: 1, attuned: true })),
    reason: "test",
  });
  if (written.ok) {
    assert.ok(attunedNames().length <= 3);
  } else {
    assert.deepEqual(sheet().equipment, []);
  }
});

const lobby = await openWorld({ status: "lobby" });
const sheetRoute = await lobby.route("campaigns/[campaignId]/sheet");
// The payload carries a portrait because a sheet created without one asks
// the host's image backend to paint it, which no test should do.
const PORTRAIT = { url: "/uploads/enforce-attunement.png" };
async function create(user, input) {
  lobby.signIn(user);
  const response = await sheetRoute.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ ...input, portrait: PORTRAIT }) }),
    { params: Promise.resolve({ campaignId: lobby.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// The creation route refuses magic items outright (a new character starts
// with mundane gear), so four attuned items reach a new sheet only through
// the doors that carry a played character in: the library copy and the DM's
// companions, which all land in createSheet. That is where the cap is pinned.
await test("a sheet made with four attuned items is stored attuned to three, and its armor class counts three", async () => {
  const made = lobby.addHero({
    name: "Four Rings",
    acOverride: false,
    abilities: { dex: 10 },
    equipment: FOUR.map((name) => ({ name, qty: 1, attuned: true })),
  });
  const stored = lobby.sheet(made.id);
  assert.deepEqual(attunedNames(stored), FOUR.slice(0, 3));
});

await test("the player's creation route takes no magic item at all, attuned or not, and stores nothing", async () => {
  const guest = lobby.addUser("ringbearer");
  const made = await create(guest, heroInput({
    name: "Five Rings",
    acOverride: false,
    equipment: FOUR.map((name) => ({ name, qty: 1, attuned: true })),
  }));
  assert.notEqual(made.status, 201);
  assert.equal(lobby.sheets().some((entry) => entry.name === "Five Rings"), false);
});

// ---- one of each ----

await test("different items add together", async () => {
  carry([{ name: "Ring of Protection", qty: 1, attuned: true }, { name: "Cloak of Protection", qty: 1, attuned: true }]);
  assert.equal(sheet().ac, 12);
  assert.equal(saves().int, 2);
});

await test("a row of two rings is one ring's worth of magic", async () => {
  carry([{ name: "Ring of Protection", qty: 2, attuned: true }]);
  assert.equal(sheet().ac, 11);
});

await test("two copies of one item are one item's magic: two Rings of Protection are one +1", async () => {
  carry([{ name: "Ring of Protection", qty: 1, attuned: true }, { name: "Ring of Protection (spare)", qty: 1, attuned: true }]);
  assert.equal(sheet().ac, 11, `two attuned Rings of Protection store AC ${sheet().ac}`);
});

// ---- who may attune, and when ----

await test("An item that requires attunement by a class can be attuned only by that class: a Staff of Power by a sorcerer, warlock or wizard.", async () => {
  carry([{ name: "Staff of Power", qty: 1 }]);
  const reply = await attune("Staff of Power");
  assert.ok(reply.status !== 200 || sheet().ac === 10, `a fighter attuned to a Staff of Power: AC ${sheet().ac}`);
  assert.deepEqual(attunedNames(), []);
  assert.equal(sheet().ac, 10);
});

await test("a class-bound item written attuned onto another class's sheet by any path gives nothing", () => {
  carry([{ name: "Staff of Power", qty: 1, attuned: true }]);
  assert.deepEqual(attunedNames(), []);
  assert.equal(sheet().ac, 10);
  assert.equal(saves().wis, 0);
});

await test("the class an item names may attune to it through the same route", async () => {
  const mage = world.addUser("staffbearer");
  const wizard = world.addHero({ user: mage, class: "wizard", level: 5, acOverride: false, abilities: { dex: 10 }, equipment: [{ name: "Staff of Power", qty: 1 }] });
  const reply = await adjust({ gear: { "Staff of Power": { attuned: true } } }, mage);
  assert.equal(reply.status, 200, reply.body.error);
  await shortRest();
  assert.deepEqual(attunedNames(world.sheet(wizard.id)), ["Staff of Power"]);
});

await test("attuning on a sheet that says what it wears puts the item on, so its magic works", async () => {
  carry([{ name: "Leather", qty: 1, equipped: true }, { name: "Ring of Protection", qty: 1, equipped: false }]);
  assert.equal((await attune("Ring of Protection")).status, 200);
  await shortRest();
  const ring = sheet().equipment.find((item) => item.name === "Ring of Protection");
  assert.equal(ring.attuned, true);
  assert.equal(ring.equipped, true);
  assert.equal(saves().wis, 1);
});

await test("an item that needs no attunement is not attuned through the route, and takes no slot", async () => {
  carry([{ name: "Armor of Cushioning", qty: 1 }]);
  const reply = await attune("Armor of Cushioning");
  assert.notEqual(reply.status, 200);
  assert.deepEqual(attunedNames(), []);
});

const kit = await gearKit(world);
await kit.arena({ first: hero.id });

await test("Attuning to an item takes a short rest spent focused on it: nobody attunes in the middle of a fight.", async () => {
  carry([{ name: "Ring of Protection", qty: 1 }]);
  assert.ok(world.encounter());
  const reply = await attune("Ring of Protection");
  assert.notEqual(reply.status, 200, `attuned mid-fight: AC ${sheet().ac}`);
  assert.deepEqual(attunedNames(), []);
  assert.equal(sheet().ac, 10);
});

await kit.endFight();

// ---- what counts as a magic item ----

await test("an ordinary item is not magic for sharing a word with one", async () => {
  for (const name of ["Potion of Healing", "Belt Pouch", "Quarterstaff", "Leather", "Traveler's Cloak", "Signet Ring"]) {
    carry([{ name, qty: 1, attuned: true }]);
    assert.equal(sheet().ac, name === "Leather" ? 11 : 10, name);
    assert.deepEqual(saves(), { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, name);
    assert.equal(computeSheetDerived(sheet()).abilityMods.str, 1, name);
  }
});

await test("an item has a magic item's effect only if it IS that item: a pouch is not a Pouch of Runestones", async () => {
  carry([{ name: "Pouch", qty: 1 }]);
  assert.equal(sheet().ac, 10, `a Pouch stores AC ${sheet().ac}`);
  carry([{ name: "Potion", qty: 1 }]);
  assert.equal(computeSheetDerived(sheet()).abilityMods.str, 1);
});

await test("a name that contains a magic item's name is not that item: a Basilisk Fang is not the item called Asi", async () => {
  carry([{ name: "Basilisk Fang", qty: 1 }]);
  await attune("Basilisk Fang");
  assert.equal(sheet().ac, 10, `an attuned Basilisk Fang stores AC ${sheet().ac}`);
});

world.close();
finish();
