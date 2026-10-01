// What a PLAYER can do to their own counters, through the route their
// character sheet's buttons call:
// POST /api/campaigns/[campaignId]/sheet/usage.
//
// The rule (src/lib/dm/usage-rules.ts): a player SPENDS and never recovers.
// A used count goes up at the player's hand and comes down only at a rest,
// or as a correction by the DM or the party lead, who may name any sheet at
// the table. Held as tests:
//
//   a spend is stored; used is clamped into 0..max; a maximum cannot be
//   written; a malformed number is refused; a counter the sheet lacks cannot
//   be invented; a player reaches their own sheet and no other; nothing comes
//   back at a player's hand, in a fight or out of one; the lead corrects any
//   sheet; the dead spend nothing; a player spends no hit die here at all
//   (SRD 5.1: they are spent at the end of a short rest, which take_rest
//   runs); in a fight armor and attunement do not change, and a shield costs
//   the action.
//
// The first hero of a table belongs to its owner, who is the party lead, so
// every table here seats the lead first and tests a plain player after.
import assert from "node:assert/strict";
import { casting, openTable, postUsage, stored } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-usage-route");
const world = await openTable();

const fighterOf = (table, extra = {}) =>
  table.addHero({
    class: "fighter",
    level: 5,
    maxHp: 44,
    hitDice: { die: "d10", total: 5, spent: 0 },
    ...extra,
  });

async function refusedBy(table, id, body, status) {
  const before = stored(table, id);
  const response = await postUsage(table, id, body);
  if (status === "refused") {
    assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(body));
  } else {
    assert.equal(response.status, status, JSON.stringify(body));
  }
  assert.deepEqual(stored(table, id), before, `${JSON.stringify(body)} changed the sheet`);
}

await test("a player marks a use spent and the database holds it", async () => {
  const fighter = fighterOf(world);
  const response = await postUsage(world, fighter.id, { resources: { second_wind: 1 }, hitDiceSpent: 2 });
  assert.equal(response.status, 200, response.json.error);
  const sheet = world.sheet(fighter.id);
  assert.deepEqual(sheet.resources.second_wind, { max: 1, used: 1 });
  assert.deepEqual(sheet.resources.action_surge, { max: 1, used: 0 });
  assert.deepEqual(sheet.hitDice, { die: "d10", total: 5, spent: 2 });
});

await test("used is clamped to the maximum and the maximum never moves", async () => {
  const monk = world.addHero({ class: "monk", level: 4, hitDice: { die: "d8", total: 4, spent: 0 } });
  const response = await postUsage(world, monk.id, { resources: { ki: 200 } });
  assert.equal(response.status, 200, response.json.error);
  assert.deepEqual(world.sheet(monk.id).resources.ki, { max: 4, used: 4 });
  // The lead's correction of the hit dice is clamped the same way.
  const lead = await postAs(world, world.owner, { characterId: monk.id, hitDiceSpent: 20 });
  assert.equal(lead.status, 200, lead.json.error);
  assert.deepEqual(world.sheet(monk.id).hitDice, { die: "d8", total: 4, spent: 4 });
});

await test("a maximum, a negative, a fraction or an oversized number is refused", async () => {
  const monk = world.addHero({ class: "monk", level: 4 });
  for (const body of [
    { resources: { ki: { max: 99, used: 0 } } },
    { resources: { ki: -1 } },
    { resources: { ki: 1.5 } },
    { resources: { ki: 201 } },
    { resources: { ki: "0" } },
    { hitDiceSpent: -1 },
    { hitDiceSpent: 21 },
    { hitDiceSpent: 0.5 },
    { hitDice: { die: "d12", total: 20, spent: 0 } },
    { maxHp: 500 },
    {},
  ]) {
    await refusedBy(world, monk.id, body, 400);
  }
});

await test("a counter the sheet does not have cannot be invented", async () => {
  const fighter = fighterOf(world);
  await refusedBy(world, fighter.id, { resources: { rage: 0 } }, 400);
  await refusedBy(world, fighter.id, { resources: { lay_on_hands: 5 } }, 400);
  // No spellcasting, no slots.
  await refusedBy(world, fighter.id, { slots: { 1: 0 } }, 403);
  // Beside a real counter the invented one is dropped, not created.
  const mixed = await postUsage(world, fighter.id, { resources: { second_wind: 1, rage: 0 } });
  assert.equal(mixed.status, 200, mixed.json.error);
  assert.deepEqual(Object.keys(world.sheet(fighter.id).resources).sort(), ["action_surge", "second_wind"]);
});

await test("the route reaches the caller's own sheet and no other", async () => {
  const mine = fighterOf(world);
  const theirs = fighterOf(world);
  const before = stored(world, theirs.id);
  const response = await postUsage(world, mine.id, {
    characterId: theirs.id,
    resources: { second_wind: 1 },
  });
  assert.equal(response.status, 200, response.json.error);
  assert.equal(response.json.sheet.id, mine.id);
  assert.deepEqual(stored(world, theirs.id), before);
  assert.equal(world.sheet(mine.id).resources.second_wind.used, 1);
});

await test("someone who is not at the table, or not signed in, changes nothing", async () => {
  const fighter = fighterOf(world);
  const before = stored(world, fighter.id);
  const route = await world.route("campaigns/[campaignId]/sheet/usage");
  const call = () =>
    route.POST(
      new Request("http://test/", { method: "POST", body: JSON.stringify({ resources: { second_wind: 1 } }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
  world.signIn(world.addUser("stranger"));
  assert.ok([403, 404].includes((await call()).status));
  globalThis.__odmTestToken = undefined;
  assert.equal((await call()).status, 401);
  assert.deepEqual(stored(world, fighter.id), before);
});

await test("in a fight nothing comes back: not a feature, not a slot, not a hit die", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const fighter = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 3 } });
  const wizard = table.addHero({
    class: "wizard",
    level: 3,
    spellcasting: casting("int", { 1: [4, 4], 2: [2, 1] }),
  });
  table.patch(fighter.id, {
    resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 1 } },
  });
  await table.beginFight([{ monster: "goblin", count: 1 }]);
  await refusedBy(table, fighter.id, { resources: { second_wind: 0 } }, 409);
  await refusedBy(table, fighter.id, { hitDiceSpent: 2 }, 409);
  await refusedBy(table, wizard.id, { slots: { 1: 3 } }, 409);
  // One refill among honest spends refuses the whole request.
  await refusedBy(table, wizard.id, { slots: { 1: 3, 2: 2 } }, 409);
  // Spending is still bookkeeping, fight or no fight.
  const spent = await postUsage(table, wizard.id, { slots: { 2: 2 } });
  assert.equal(spent.status, 200, spent.json.error);
  assert.deepEqual(table.sheet(wizard.id).spellcasting.slots["2"], { max: 2, used: 2 });
});

// ---- a player never recovers ----

await test("a class feature comes back at its rest and never at the player's hand", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const barbarian = table.addHero({ class: "barbarian", level: 3 });
  const paladin = table.addHero({ class: "paladin", level: 4 });
  for (let count = 0; count < 3; count += 1) {
    const rage = await table.invoke("use_resource", { characterId: barbarian.id, resource: "Rage" });
    assert.equal(rage.ok, true, rage.error);
    await table.invoke("pass_time", { amount: 1, unit: "minutes" });
  }
  await table.invoke("use_resource", {
    characterId: paladin.id,
    resource: "Lay on Hands",
    amount: 20,
  });
  await refusedBy(table, barbarian.id, { resources: { rage: 0 } }, "refused");
  await refusedBy(table, paladin.id, { resources: { lay_on_hands: 0 } }, "refused");
  // One refill among honest spends refuses the whole request.
  await refusedBy(table, barbarian.id, { resources: { rage: 2 }, hitDiceSpent: 1 }, "refused");
});

await test("a player spends no hit die at the sheet: hit dice are spent at the end of a short rest, which the rest itself rolls", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const fighter = fighterOf(table, { maxHp: 44 });
  table.patch(fighter.id, { currentHp: 10 });
  await refusedBy(table, fighter.id, { hitDiceSpent: 1 }, 409);
  const response = await postUsage(table, fighter.id, { hitDiceSpent: 2 });
  assert.match(response.json.error, /short rest/);
  // The rest spends them, with real rolls.
  table.clearDice();
  table.dice(5, 5);
  const rested = await table.invoke("take_rest", { kind: "short", spend: [{ characterId: fighter.id, dice: 2 }] });
  table.clearDice();
  assert.equal(rested.ok, true, rested.error);
  assert.equal(table.sheet(fighter.id).hitDice.spent, 2);
  assert.ok(table.sheet(fighter.id).currentHp > 10, "the dice healed nothing");
});

await test("spent hit dice come back at a long rest and never at the player's hand", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const fighter = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 5 } });
  await refusedBy(table, fighter.id, { hitDiceSpent: 0 }, "refused");
  await refusedBy(table, fighter.id, { hitDiceSpent: 4 }, "refused");
});

// ---- who corrects ----

// The route as a named user calls it, for the lead and the DM.
async function postAs(table, user, body) {
  const route = await table.route("campaigns/[campaignId]/sheet/usage");
  table.signIn(user);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("the party lead puts uses back, on their own sheet and on a named one, fight or no fight", async () => {
  const table = await openTable();
  const leader = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 4 } });
  const fighter = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 3 } });
  table.patch(leader.id, { resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 1 } } });
  table.patch(fighter.id, { resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 1 } } });

  const own = await postAs(table, table.owner, { resources: { second_wind: 0 } });
  assert.equal(own.status, 200, own.json.error);
  assert.equal(table.sheet(leader.id).resources.second_wind.used, 0);

  const named = await postAs(table, table.owner, {
    characterId: fighter.id,
    resources: { second_wind: 0 },
    hitDiceSpent: 1,
  });
  assert.equal(named.status, 200, named.json.error);
  assert.equal(named.json.sheet.id, fighter.id);
  assert.equal(table.sheet(fighter.id).resources.second_wind.used, 0);
  assert.equal(table.sheet(fighter.id).hitDice.spent, 1);
  // The lead's own sheet was not the one written.
  assert.equal(table.sheet(leader.id).hitDice.spent, 4);

  await table.beginFight([{ monster: "goblin", count: 1 }]);
  const inFight = await postAs(table, table.owner, {
    characterId: fighter.id,
    resources: { action_surge: 0 },
  });
  assert.equal(inFight.status, 200, inFight.json.error);
  assert.equal(table.sheet(fighter.id).resources.action_surge.used, 0);
});

await test("a correction cannot store more used than the maximum, or reach another table", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table);
  const over = await postAs(table, table.owner, { characterId: fighter.id, resources: { second_wind: 9 } });
  assert.equal(over.status, 200, over.json.error);
  assert.deepEqual(table.sheet(fighter.id).resources.second_wind, { max: 1, used: 1 });

  const elsewhere = await openTable();
  const stranger = fighterOf(elsewhere);
  const before = stored(elsewhere, stranger.id);
  const reached = await postAs(table, table.owner, { characterId: stranger.id, resources: { second_wind: 1 } });
  assert.equal(reached.status, 404);
  assert.deepEqual(stored(elsewhere, stranger.id), before);
});

await test("the DM, who plays no character, corrects a named sheet", async () => {
  const table = await openTable({ gameSettings: { dmMode: "human" } });
  const campaigns = await import("../src/lib/db/campaigns.ts");
  fighterOf(table);
  const fighter = fighterOf(table);
  table.patch(fighter.id, { resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 0 } } });
  const dm = table.addUser("dm");
  table.addHero({ class: "fighter", level: 1, user: dm });
  assert.equal(campaigns.setHumanDm(table.campaignId, dm.id), true);
  const out = await postAs(table, dm, { characterId: fighter.id, resources: { second_wind: 0 } });
  assert.equal(out.status, 200, out.json.error);
  assert.equal(table.sheet(fighter.id).resources.second_wind.used, 0);
});

// ---- the dead, and the fight's own clock ----

await test("a dead character's player spends nothing and changes no gear", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table, { equipment: [{ name: "Shield", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }] });
  table.patch(fighter.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  await refusedBy(table, fighter.id, { resources: { second_wind: 1 } }, "refused");
  await refusedBy(table, fighter.id, { hitDiceSpent: 1 }, "refused");
  await refusedBy(table, fighter.id, { gear: { Shield: { equipped: true } } }, "refused");
});

await test("in a fight hit dice are not spent, armor does not change and nothing is attuned", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table, {
    acOverride: false,
    equipment: [
      { name: "Plate", qty: 1, equipped: false },
      { name: "Leather", qty: 1, equipped: true },
      { name: "Ring of Protection", qty: 1 },
      { name: "Longsword", qty: 1, equipped: false },
    ],
  });
  await table.beginFight([{ monster: "goblin", count: 1 }]);
  await refusedBy(table, fighter.id, { hitDiceSpent: 1 }, "refused");
  await refusedBy(table, fighter.id, { gear: { Plate: { equipped: true } } }, "refused");
  await refusedBy(table, fighter.id, { gear: { Leather: { equipped: false } } }, "refused");
  await refusedBy(table, fighter.id, { gear: { "Ring of Protection": { attuned: true } } }, "refused");
  // A weapon is drawn for nothing, on anyone's turn.
  const drawn = await postUsage(table, fighter.id, { gear: { Longsword: { equipped: true } } });
  assert.equal(drawn.status, 200, drawn.json.error);
  assert.equal(table.sheet(fighter.id).equipment.find((item) => item.name === "Longsword").equipped, true);
  assert.equal(table.encounter().turnBudget, null);
});

await test("in a fight a shield goes on for the action, on the character's own turn", async () => {
  const table = await openTable();
  const first = fighterOf(table, {
    equipment: [{ name: "Shield", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }],
  });
  const second = fighterOf(table, {
    equipment: [{ name: "Shield", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }],
  });
  await table.beginFight([{ monster: "goblin", count: 1 }], {
    heroFaces: { [first.id]: 20, [second.id]: 5 },
  });
  // Not their turn: refused, nothing worn, nothing charged.
  await refusedBy(table, second.id, { gear: { Shield: { equipped: true } } }, "refused");
  assert.equal(table.encounter().turnBudget, null);

  const on = await postUsage(table, first.id, { gear: { Shield: { equipped: true } } });
  assert.equal(on.status, 200, on.json.error);
  assert.equal(table.sheet(first.id).equipment.find((item) => item.name === "Shield").equipped, true);
  assert.equal(table.encounter().turnBudget.ownerId, first.id);
  assert.equal(table.encounter().turnBudget.actionUsed, true);
  // The action is gone, so the shield stays where it is this turn.
  await refusedBy(table, first.id, { gear: { Shield: { equipped: false } } }, "refused");
});

await test("out of a fight gear changes freely", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table, {
    equipment: [{ name: "Plate", qty: 1, equipped: false }, { name: "Ring of Protection", qty: 1 }],
  });
  const out = await postUsage(table, fighter.id, {
    gear: { Plate: { equipped: true }, "Ring of Protection": { attuned: true } },
  });
  assert.equal(out.status, 200, out.json.error);
  // Attuning takes a short rest spent with the item: the ring waits for it.
  assert.equal(table.sheet(fighter.id).equipment.find((item) => item.name === "Ring of Protection").attuning, true);
  assert.equal((await table.invoke("take_rest", { kind: "short" })).ok, true);
  const gear = Object.fromEntries(table.sheet(fighter.id).equipment.map((item) => [item.name, item]));
  assert.equal(gear.Plate.equipped, true);
  assert.equal(gear["Ring of Protection"].attuned, true);
});

world.close();
finish();
