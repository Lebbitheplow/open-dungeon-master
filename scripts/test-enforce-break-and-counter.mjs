// A table break, a buyer who cannot act and a shop in another town (table
// function audit 2026-10-26, T05 to T07), through the routes a table's
// clients call.
//
// - While the table is paused only table talk goes through
//   (src/lib/dm/table-break-logic.ts): a Market trade, a DM's adjudication or
//   narration, a parked roll, the initiative order, the floor and the clock
//   wait, at a table a person runs and at one the AI runs, and a refusal
//   changes nothing.
// - A DM turn already running when the break began finishes, the
//   storyteller's and a connected agent program's alike; the next one waits.
// - Corrections to the record and table talk stay open through a break.
// - The Market's counter trades only for a character able to act (not dead,
//   not at 0 HP, not incapacitated) and only at a shop where the party
//   stands now, by the rule the Market lists by; the DM's own adjudications
//   settle a sale for anyone, at any shop.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, seats } from "./lib/enforce-campaign.mjs";

const { test, finish } = suite("test-enforce-break-and-counter");

const campaigns = await import("../src/lib/db/campaigns.ts");
const shops = await import("../src/lib/db/shops.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { enqueueDmJob } = await import("../src/lib/dm/queue.ts");
const { closeAgentTurn } = await import("../src/lib/dm/agent-turn.ts");

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const BREAK = /called a break\. Use OOC/;
const ROPE = [{ itemName: "Rope", qty: 5, priceCp: 100, note: "" }];
const COUNTER = [{ action: "buy", item: "Rope" }, { action: "sell", item: "Silver Idol" }, { action: "haggle" }];

async function routesOf(world) {
  const at = (name) => world.route(`campaigns/[campaignId]${name}`);
  return {
    pause: await at("/table-break"),
    trade: await at("/shops/[shopId]/trade"),
    shops: await at("/shops"),
    invoke: await at("/dm/invoke"),
    narrate: await at("/dm/narrate"),
    roll: await at("/pending-rolls/[pendingRollId]"),
    initiative: await at("/dm/initiative"),
    floor: await at("/floor"),
    clock: await at("/dm/clock"),
    rolls: await at("/rolls"),
    enemyHp: await at("/dm/enemy-hp"),
    sheetFix: await at("/sheets/[sheetId]"),
    actions: await at("/actions"),
  };
}
function as(world, user, mod, method, body, params = {}) {
  world.signIn(user);
  return call(mod, method, body, { campaignId: world.campaignId, ...params });
}
// As a connected agent program sends it (src/lib/dm/agent-turn.ts isAgentRequest).
async function asAgent(world, user, mod, body) {
  world.signIn(user);
  const request = new Request("http://test/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-odm-client": "agent" },
    body: JSON.stringify(body),
  });
  const response = await mod.POST(request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, json: await response.json() };
}
// Everything a refusal must leave as it was.
function ledger(world, sheetId, shopId) {
  const sheet = world.sheet(sheetId);
  const shop = shops.getShop(shopId);
  return JSON.stringify({ gold: sheet.gold, copper: sheet.copper, equipment: sheet.equipment, hp: sheet.currentHp, stock: shop.stock, haggles: shop.haggles });
}
function shopAt(world, place, name = "Audit Counter") {
  return shops.insertShop(world.campaignId, { name, kind: "general", size: "town", markup: 1, locationId: place?.id ?? "", locationName: place?.name ?? "", stock: ROPE });
}
const purse = { gold: 100, copper: 0, equipment: [{ name: "Silver Idol", qty: 1, worth: 4 }] };

// ---- T05: the break ----

await test("a break refuses a Market purchase, sale and haggle in the break's words, and nothing moves", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  const shop = shopAt(world, upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Town" }));
  world.patch(sheet.id, purse);
  assert.equal((await as(world, player, r.pause, "POST")).status, 200);
  const before = ledger(world, sheet.id, shop.id);
  world.diceLog();
  for (const body of COUNTER) {
    const refused = await as(world, player, r.trade, "POST", body, { shopId: shop.id });
    assert.equal(refused.status, 409, `${body.action}: ${JSON.stringify(refused.json)}`);
    assert.match(refused.json.error, BREAK);
    assert.equal(refused.json.tableBreak.userId, player.id);
  }
  const forThem = await as(world, dm, r.trade, "POST", { action: "buy", item: "Rope", characterId: sheet.id }, { shopId: shop.id });
  assert.equal(forThem.status, 409, "the DM's Market purchase for a player went through a break");
  assert.equal(ledger(world, sheet.id, shop.id), before, "a refused trade moved coin, stock or a haggle");
  assert.equal(world.diceLog().length, 0, "a refused haggle rolled");
  assert.equal((await as(world, player, r.pause, "DELETE")).status, 200);
  const bought = await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: shop.id });
  assert.equal(bought.status, 200, JSON.stringify(bought.json));
  assert.equal(world.sheet(sheet.id).gold, 99);
});

await test("a fresh DM adjudication and narration wait out the break; a sheet correction and the catalog do not", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  const hp = world.sheet(sheet.id).currentHp;
  await as(world, player, r.pause, "POST");
  const ruled = await as(world, dm, r.invoke, "POST", { name: "apply_damage", args: { characterId: sheet.id, amount: 3, reason: "Audit trap" } });
  assert.equal(ruled.status, 409, JSON.stringify(ruled.json));
  assert.match(ruled.json.error, BREAK);
  assert.equal(world.sheet(sheet.id).currentHp, hp);
  const spoken = await as(world, dm, r.narrate, "POST", { content: "The torches gutter." });
  assert.equal(spoken.status, 409, JSON.stringify(spoken.json));
  assert.equal(listRecentMessages(world.campaignId, 20).some((message) => message.content.includes("torches gutter")), false);
  assert.equal((await as(world, dm, r.invoke, "GET")).status, 200);
  const fixed = await as(world, dm, r.invoke, "POST", { name: "update_sheet", args: { characterId: sheet.id, field: "currentHp", value: "20", reason: "a sum gone wrong" } });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  assert.equal(world.sheet(sheet.id).currentHp, 20, "Correct a sheet is the record, and goes on");
  await as(world, player, r.pause, "DELETE");
  assert.equal((await as(world, dm, r.invoke, "POST", { name: "apply_damage", args: { characterId: sheet.id, amount: 3, reason: "Audit trap" } })).status, 200);
  assert.equal(world.sheet(sheet.id).currentHp, 17);
});

await test("a parked initiative roll stays parked through the break: no roll, no order, no floor", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  campaigns.setMemberHoldRolls(world.campaignId, player.id, true);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(started.ok, true, started.error);
  const parked = listOpenPendingRolls(world.campaignId).find((roll) => roll.characterId === sheet.id);
  assert.ok(parked, "the held roll did not park");
  const floor = campaigns.getFloor(world.campaignId);
  await as(world, player, r.pause, "POST");
  const rolled = await as(world, player, r.roll, "POST", { dice: ["digital"] }, { pendingRollId: parked.id });
  assert.equal(rolled.status, 409, JSON.stringify(rolled.json));
  assert.match(rolled.json.error, BREAK);
  assert.equal((await as(world, dm, r.roll, "POST", { fallback: "digital" }, { pendingRollId: parked.id })).status, 409);
  assert.equal(getPendingRoll(parked.id).status, "pending");
  assert.equal(world.encounter().orderReady, false, "the order locked during the break");
  assert.deepEqual(campaigns.getFloor(world.campaignId), floor, "the floor moved during the break");
  await as(world, player, r.pause, "DELETE");
  assert.equal((await as(world, player, r.roll, "POST", { dice: ["digital"] }, { pendingRollId: parked.id })).status, 200);
  assert.equal(world.encounter().orderReady, true);
});

await test("the order, the floor and the clock wait where they stand; corrections and table talk go on", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  const state = () => JSON.stringify({ turn: world.encounter().turnIndex, round: world.encounter().round, floor: campaigns.getFloor(world.campaignId), clock: getClock(world.campaignId) });
  const before = state();
  await as(world, player, r.pause, "POST");
  for (const body of [{ op: "step", direction: "forward" }, { op: "reset" }, { op: "enemies", play: true }, { op: "companion" }]) {
    const refused = await as(world, dm, r.initiative, "POST", body);
    assert.equal(refused.status, 409, `${body.op}: ${JSON.stringify(refused.json)}`);
    assert.match(refused.json.error, BREAK);
  }
  for (const body of [{}, { set: "hold" }]) {
    assert.match((await as(world, dm, r.floor, "POST", body)).json.error, BREAK);
  }
  assert.match((await as(world, dm, r.clock, "POST", { do: "advance", amount: 1, unit: "hours" })).json.error, BREAK);
  assert.equal(state(), before, "the break moved the turn, the floor or the clock");
  const [enemy] = world.enemies();
  assert.equal((await as(world, dm, r.enemyHp, "POST", { enemyId: enemy.id, currentHp: 3 })).status, 200, "an enemy's hit points could not be corrected");
  assert.equal((await as(world, dm, r.sheetFix, "PATCH", { currentHp: 20, reason: "Audit correction" }, { sheetId: sheet.id })).status, 200);
  assert.equal((await as(world, player, r.actions, "POST", { kind: "ooc", content: "brb" })).status, 202);
  await as(world, player, r.pause, "DELETE");
  assert.equal((await as(world, dm, r.initiative, "POST", { op: "step", direction: "forward" })).status, 200);
});

await test("a storyteller turn running when the break began finishes; the next waits for Resume", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { player, sheet } = await seats(world);
  const r = await routesOf(world);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let started = false;
  const running = enqueueDmJob(world.campaignId, async () => {
    started = true;
    await held;
    await world.invoke("apply_damage", { characterId: sheet.id, amount: 2, reason: "The turn in flight" });
  });
  await tick();
  assert.ok(started);
  const hp = world.sheet(sheet.id).currentHp;
  await as(world, player, r.pause, "POST");
  const ran = [];
  const next = enqueueDmJob(world.campaignId, async () => { ran.push("next"); });
  release();
  await running;
  assert.equal(world.sheet(sheet.id).currentHp, hp - 2, "the turn in flight did not land");
  await tick();
  assert.deepEqual(ran, [], "a turn started during the break");
  await as(world, player, r.pause, "DELETE");
  await next;
  assert.deepEqual(ran, ["next"]);
});

await test("an agent program's turn begun before the break finishes; a turn it would open during one waits", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  // The model's damage is the server's to roll (src/lib/dm/ai-gate.ts).
  const hit = async () => {
    world.dice(2);
    const out = await asAgent(world, dm, r.invoke, { name: "apply_damage", args: { characterId: sheet.id, dice: "1d4", reason: "The agent's trap" } });
    world.clearDice();
    return out;
  };
  const hp = world.sheet(sheet.id).currentHp;
  assert.equal((await hit()).status, 200);
  await tick();
  await as(world, player, r.pause, "POST");
  const finishing = await hit();
  assert.equal(finishing.status, 200, `the agent's running turn was cut off: ${JSON.stringify(finishing.json)}`);
  assert.equal(world.sheet(sheet.id).currentHp, hp - 4);
  closeAgentTurn(world.campaignId);
  const fresh = await hit();
  assert.equal(fresh.status, 409);
  assert.match(fresh.json.error, BREAK);
  assert.equal(world.sheet(sheet.id).currentHp, hp - 4);
});

await test("an AI-run table holds the same: a trade, a parked roll and the lead's floor", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero({ name: "Lead" });
  const player = world.addUser("player");
  const hero = world.addHero({ user: player, name: "Player", gold: 10 });
  const r = await routesOf(world);
  const shop = shopAt(world, upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Town" }));
  campaigns.setMemberHoldRolls(world.campaignId, player.id, true);
  assert.equal((await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] })).ok, true);
  const parked = listOpenPendingRolls(world.campaignId).find((roll) => roll.characterId === hero.id);
  assert.ok(parked);
  const floor = campaigns.getFloor(world.campaignId);
  const before = ledger(world, hero.id, shop.id);
  await as(world, player, r.pause, "POST");
  assert.match((await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: shop.id })).json.error, BREAK);
  assert.match((await as(world, player, r.roll, "POST", { dice: ["digital"] }, { pendingRollId: parked.id })).json.error, BREAK);
  assert.match((await as(world, world.owner, r.roll, "POST", { fallback: "digital" }, { pendingRollId: parked.id })).json.error, BREAK);
  assert.match((await as(world, world.owner, r.floor, "POST", {})).json.error, BREAK);
  assert.equal(ledger(world, hero.id, shop.id), before);
  assert.equal(world.encounter().orderReady, false);
  assert.deepEqual(campaigns.getFloor(world.campaignId), floor);
  await as(world, player, r.pause, "DELETE");
  assert.equal((await as(world, player, r.roll, "POST", { dice: ["digital"] }, { pendingRollId: parked.id })).status, 200);
});

await test("in a break the console still looks things up, whispers and preps; a player's named roll waits, loose dice do not", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  await as(world, player, r.pause, "POST");
  for (const [name, args] of [
    ["search_lore", { query: "the old mill" }],
    ["recall_story", { query: "the burned mill" }],
    ["send_whisper", { characterIds: [sheet.id], message: "You hear something behind the door." }],
    ["set_npc", { name: "Marla Venn", attitude: "friendly" }],
    ["write_campaign_note", { title: "Prep", content: "The bridge is out." }],
  ]) {
    const answer = await as(world, dm, r.invoke, "POST", { name, args });
    assert.doesNotMatch(String(answer.json?.error ?? ""), BREAK, `${name} was held by the break: ${JSON.stringify(answer.json)}`);
  }
  world.patch(sheet.id, { conditions: ["guidance"] });
  const named = await as(world, player, r.rolls, "POST", { kind: "skill_check", skill: "athletics" });
  assert.equal(named.status, 409, JSON.stringify(named.json));
  assert.match(named.json.error, BREAK);
  assert.ok(world.sheet(sheet.id).conditions.includes("guidance"), "a refused roll spent Guidance");
  const loose = await as(world, player, r.rolls, "POST", { expression: "1d20" });
  assert.equal(loose.status, 201, JSON.stringify(loose.json));
  await as(world, player, r.pause, "DELETE");
});

await test("an agent program's turn older than the break may finish only for the break's first minutes", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, player, sheet } = await seats(world);
  const r = await routesOf(world);
  const { getDatabase } = await import("../src/lib/db/core.ts");
  world.dice(2);
  assert.equal((await asAgent(world, dm, r.invoke, { name: "apply_damage", args: { characterId: sheet.id, dice: "1d4", reason: "The agent's trap" } })).status, 200);
  world.clearDice();
  await tick();
  await as(world, player, r.pause, "POST");
  // The break began ten minutes ago: the turn has had its time to finish.
  getDatabase()
    .prepare(`UPDATE campaign_events SET payload_json = json_set(payload_json, '$.at', ?) WHERE campaign_id = ? AND type = 'table_paused'`)
    .run(Date.now() - 10 * 60_000, world.campaignId);
  const hp = world.sheet(sheet.id).currentHp;
  world.dice(2);
  const late = await asAgent(world, dm, r.invoke, { name: "apply_damage", args: { characterId: sheet.id, dice: "1d4", reason: "The agent's trap" } });
  world.clearDice();
  assert.equal(late.status, 409, JSON.stringify(late.json));
  assert.equal(world.sheet(sheet.id).currentHp, hp);
});

// ---- T06: who can stand at the counter ----

await test("the counter refuses the dead, the dying, the stable and the incapacitated, and moves nothing", async () => {
  const world = await openWorld();
  world.addHero({ name: "Lead" });
  const player = world.addUser("buyer");
  const hero = world.addHero({ user: player, name: "Brin" });
  const r = await routesOf(world);
  const shop = shopAt(world, upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Town" }));
  const fresh = { ...purse, currentHp: 30, conditions: [], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } };
  const cases = [
    ["dead", { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } }, /Brin is dead and cannot/],
    ["dying", { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 1, failures: 1, stable: false, dead: false } }, /Brin is at 0 HP and cannot/],
    ["stable at 0 HP", { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: true, dead: false } }, /Brin is at 0 HP and cannot/],
    ["asleep", { conditions: ["unconscious"] }, /Brin is unconscious and cannot/],
    ["incapacitated", { conditions: ["incapacitated"] }, /Brin is incapacitated and cannot/],
    ["paralyzed", { conditions: ["paralyzed"] }, /Brin is paralyzed and cannot/],
    ["stunned", { conditions: ["stunned"] }, /Brin is stunned and cannot/],
    ["petrified", { conditions: ["petrified"] }, /Brin is petrified and cannot/],
  ];
  for (const [label, state, said] of cases) {
    world.patch(hero.id, { ...fresh, ...state });
    const before = ledger(world, hero.id, shop.id);
    world.diceLog();
    for (const body of COUNTER) {
      const refused = await as(world, player, r.trade, "POST", body, { shopId: shop.id });
      assert.equal(refused.status, 409, `${label} ${body.action}: ${JSON.stringify(refused.json)}`);
      assert.match(refused.json.error, said, `${label} ${body.action}`);
    }
    assert.equal(ledger(world, hero.id, shop.id), before, `${label}: a refusal moved something`);
    assert.equal(world.diceLog().length, 0, `${label}: a refused haggle rolled`);
  }
  // Poisoned, prone and frightened characters can still shop.
  world.patch(hero.id, { ...fresh, conditions: ["poisoned", "prone", "frightened"] });
  assert.equal((await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: shop.id })).status, 200);
  assert.equal(world.sheet(hero.id).gold, 99);
  assert.equal(shops.getShop(shop.id).stock[0].qty, 4);
  const sold = await as(world, player, r.trade, "POST", { action: "sell", item: "Silver Idol" }, { shopId: shop.id });
  assert.equal(sold.status, 200, JSON.stringify(sold.json));
  // The DM settles a fallen friend's purchase and sale through the engine.
  world.patch(hero.id, { ...fresh, currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  assert.equal((await world.invoke("sell_item", { characterId: hero.id, shop: shop.id, item: "Silver Idol" })).ok, true);
  assert.equal((await world.invoke("buy_item", { characterId: hero.id, shop: shop.id, item: "Rope" })).ok, true);
  // A haggle is a check made by talking, and an unconscious character cannot
  // make one, at the console either.
  world.patch(hero.id, { ...fresh, conditions: ["unconscious"] });
  world.diceLog();
  const asleep = await world.invoke("haggle", { characterId: hero.id, shop: shop.id });
  assert.equal(asleep.ok, false);
  assert.match(asleep.error, /Brin is unconscious and cannot haggle\. Nothing was rolled/);
  assert.equal(world.diceLog().length, 0);
});

// ---- T07: only where the party stands ----

await test("the counter trades only where the party stands, as the Market lists; the DM settles anywhere", async () => {
  const world = await openWorld();
  world.addHero({ name: "Lead" });
  const player = world.addUser("traveller");
  const hero = world.addHero({ user: player, name: "Wren", ...purse });
  const r = await routesOf(world);
  const town = upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Town" });
  const townShop = shopAt(world, town, "Town Counter");
  assert.equal((await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: townShop.id })).status, 200, "same place");
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Harbor" });
  const legacy = shops.insertShop(world.campaignId, { name: "Harbor Stall", locationId: "", locationName: "Audit Harbor", stock: ROPE });
  const unplaced = shopAt(world, null, "Nowhere Cart");
  const listed = await as(world, player, r.shops, "GET");
  assert.deepEqual(listed.json.shops.map((shop) => shop.name), ["Harbor Stall"]);
  for (const shop of [townShop, unplaced]) {
    const before = ledger(world, hero.id, shop.id);
    world.diceLog();
    for (const body of COUNTER) {
      const refused = await as(world, player, r.trade, "POST", body, { shopId: shop.id });
      assert.equal(refused.status, 409, `${shop.name} ${body.action}: ${JSON.stringify(refused.json)}`);
      assert.match(refused.json.error, new RegExp(`${shop.name} is not at Audit Harbor, where the party is now`));
    }
    assert.equal(ledger(world, hero.id, shop.id), before, `${shop.name}: a refusal moved something`);
    assert.equal(world.diceLog().length, 0);
  }
  assert.equal((await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: legacy.id })).status, 200, "a shop remembered by the place's name");
  // The lead steers this table and sees every shop, each saying whether it is
  // here; their own character still has to travel.
  const leadView = await as(world, world.owner, r.shops, "GET");
  assert.equal(leadView.json.shops.find((shop) => shop.id === townShop.id).standsHere, false);
  assert.equal(leadView.json.shops.find((shop) => shop.id === legacy.id).standsHere, true);
  assert.equal((await as(world, world.owner, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: townShop.id })).status, 409);
  // The DM's own hand: an errand to the last town, by id and by name.
  assert.equal((await world.invoke("buy_item", { characterId: hero.id, shop: townShop.id, item: "Rope" })).ok, true);
  assert.equal((await world.invoke("buy_item", { characterId: hero.id, shop: "Town Counter", item: "Rope" })).ok, true);
});

await test("a party that is nowhere trades at the shops that are nowhere too, as open_shop opens them, and at no other", async () => {
  const world = await openWorld();
  world.addHero({ name: "Lead" });
  const player = world.addUser("lost");
  const hero = world.addHero({ user: player, ...purse });
  const r = await routesOf(world);
  const cart = shopAt(world, null, "Roadside Cart");
  const elsewhere = shops.insertShop(world.campaignId, { name: "Far Forge", locationId: "", locationName: "Distant Town", stock: ROPE });
  const view = await as(world, player, r.shops, "GET");
  assert.deepEqual(view.json.shops.map((shop) => shop.name), ["Roadside Cart"]);
  assert.equal(view.json.here, null);
  assert.equal((await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: cart.id })).status, 200);
  const before = ledger(world, hero.id, elsewhere.id);
  const refused = await as(world, player, r.trade, "POST", { action: "buy", item: "Rope" }, { shopId: elsewhere.id });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /Far Forge is not where the party is now/);
  assert.equal(ledger(world, hero.id, elsewhere.id), before);
  assert.equal((await world.invoke("buy_item", { characterId: hero.id, shop: "Far Forge", item: "Rope" })).ok, true, "the DM settles it");
});

await test("a human DM's Market trade for a player keeps to the counter; the console settles anywhere", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { dm, sheet } = await seats(world);
  const r = await routesOf(world);
  world.patch(sheet.id, purse);
  const shop = shopAt(world, upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Town" }));
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Audit Harbor" });
  const before = ledger(world, sheet.id, shop.id);
  const refused = await as(world, dm, r.trade, "POST", { action: "buy", item: "Rope", characterId: sheet.id }, { shopId: shop.id });
  assert.equal(refused.status, 409);
  assert.equal(ledger(world, sheet.id, shop.id), before);
  const settled = await as(world, dm, r.invoke, "POST", { name: "buy_item", args: { characterId: sheet.id, shop: shop.id, item: "Rope" } });
  assert.equal(settled.status, 200, JSON.stringify(settled.json));
});

await finish();
