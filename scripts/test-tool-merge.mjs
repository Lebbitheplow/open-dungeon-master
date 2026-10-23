// One tool per intent (issue #471). Tools that did one thing for a different
// target or setting are offered as one, and the engine keeps each sibling's
// own rules behind it (src/lib/dm/tool-merge.ts):
// - purchase is every trade: at a shop standing where the party is, the shop
//   trades (its shelf, its asking price, its offer, the ledger under its
//   name, the carrying limit); anywhere else the list price is paid;
// - set_condition and clear_condition take an enemy as well as a character;
// - apply_damage takes a character, an enemy, a pet, or several at their
//   share of one total;
// - party_award is XP for one character or the party, its level-ups
//   reported however the award is made up;
// - move_token teleports as well as walks;
// - each retired name still runs when a stored turn, an agent program, an
//   older app's console or a delegated monster sends it, its arguments
//   mapped, from the console and from the model's own turn;
// - the model is offered the merged tools only, in every profile, each
//   where its siblings were offered.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { aiEngine, call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const world = await openWorld();
const { insertShop, getShop } = await import("../src/lib/db/shops.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { listOpenItemProposals } = await import("../src/lib/db/item-proposals.ts");
const { getBattleMapForEncounter, getTokenByRef, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { occupiedTiles } = await import("../src/lib/battlemap/view.ts");
const { reachableTiles } = await import("../src/lib/battlemap/movement.ts");
const turnModule = await import("../src/lib/dm/turn.ts");
const { RETIRED_TOOLS, mergedCall, engineCall, acceptsCall } = await import("../src/lib/dm/tool-merge-logic.ts");
const { ADJUDICATION_NAMES } = await import("../src/lib/dm/invoke-catalog.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const ai = await aiEngine(world);
// Without a content pack (CI) nothing prices an item by its list, so a
// trade that pays the list price is given the same price instead.
const listed = (gold) => (world.hasPack ? {} : { price: gold });
const ok = (out) => {
  assert.equal(out.ok, true, JSON.stringify(out));
  return out.result;
};

// ---- trade ----------------------------------------------------------------

const oakhollow = upsertCurrentLocation({ campaignId: world.campaignId, name: "Oakhollow" });
// A village smith at the village markup (1.1): a longsword's 15 gp list
// price is asked at 16 gp 5 sp, and plate's 1,500 gp at 1,650 gp.
const forge = insertShop(world.campaignId, {
  name: "Brann's Forge",
  kind: "smith",
  size: "village",
  locationId: oakhollow.id,
  locationName: oakhollow.name,
  stock: [
    { itemName: "Longsword", qty: 6, priceCp: 1500, note: "" },
    { itemName: "Plate", qty: 1, priceCp: 150000, note: "" },
  ],
  markup: 1.1,
  // Stocked just now, so its shelf stays the one written here.
  restockedAt: getClock(world.campaignId).instant,
  restockDays: 30,
});
const shelf = (item) => getShop(forge.id).stock.find((line) => line.itemName === item)?.qty ?? 0;
const purse = (sheet) => world.sheet(sheet.id).gold * 100 + world.sheet(sheet.id).copper;
const carries = (sheet, item) => world.sheet(sheet.id).equipment.find((line) => line.name === item)?.qty ?? 0;
const lastLedger = (sheet) => listRecentAudit(world.campaignId, 100).filter((entry) => entry.characterId === sheet.id && entry.kind === "purchase").at(-1);

const marla = world.addHero({ name: "Marla", gold: 300, abilities: { str: 14 } });

await test("a purchase where a shop stands that stocks the item trades with the shop: its shelf, its asking price, its ledger", async () => {
  // The call the model made in issue #471: purchase at the list price, at a
  // shop it never named.
  ok(await ai.invoke("purchase", { characterId: marla.id, item: "Longsword", price: 15, qty: 1, action: "buy", reason: "A new blade" }));
  assert.equal(shelf("Longsword"), 5, "the shelf is drawn down");
  assert.equal(purse(marla), 30_000 - 1650, "the shop's asking price, not the 15 gp list price");
  assert.equal(carries(marla, "Longsword"), 1);
  assert.equal(lastLedger(marla)?.delta?.shop, "Brann's Forge", "the sale is logged under the shop");
});

await test("the shop checks the carrying limit, and a refusal takes nothing off its shelf", async () => {
  const pip = world.addHero({ name: "Pip", gold: 2000, abilities: { str: 3 } });
  const out = await ai.invoke("purchase", { characterId: pip.id, item: "Plate", action: "buy" });
  assert.equal(out.ok, false);
  assert.match(out.error, /can carry 45 lb[\s\S]*Nothing was bought/);
  assert.equal(shelf("Plate"), 1);
  assert.equal(purse(pip), 200_000);
});

await test("a name in the table's language buys the shelf's row by its srdName", async () => {
  ok(await world.invoke("purchase", { characterId: marla.id, item: "Spada lunga", srdName: "Longsword", action: "buy" }));
  assert.equal(shelf("Longsword"), 4);
  assert.equal(carries(marla, "Longsword"), 2, "the shelf's line, under its own name");
});

await test("a sale where a shop here buys goes to that shop at its offer, onto its shelf and its ledger", async () => {
  const before = purse(marla);
  ok(await ai.invoke("purchase", { characterId: marla.id, item: "Longsword", action: "sell", ...listed(7.5) }));
  assert.equal(purse(marla), before + 750, "half the 15 gp list price");
  assert.equal(shelf("Longsword"), 5, "the keeper shelves what it bought");
  assert.equal(lastLedger(marla)?.delta?.shop, "Brann's Forge");
});

await test("a shop here that does not stock the item leaves the trade at list price", async () => {
  const before = purse(marla);
  ok(await ai.invoke("purchase", { characterId: marla.id, item: "Shortsword", action: "buy", ...listed(10) }));
  assert.equal(purse(marla), before - 1000, "the 10 gp list price");
  assert.equal(lastLedger(marla)?.delta?.shop, undefined, "no shop sold it");
});

await test("with no shop where the party stands, a purchase pays the list price; a thing nothing prices asks for one", async () => {
  upsertCurrentLocation({ campaignId: world.campaignId, name: "The Old Road" });
  const before = purse(marla);
  ok(await ai.invoke("purchase", { characterId: marla.id, item: "Longsword", action: "buy", ...listed(15) }));
  assert.equal(purse(marla), before - 1500);
  assert.equal(lastLedger(marla)?.delta?.shop, undefined);
  const unpriced = await world.invoke("purchase", { characterId: marla.id, item: "A carved idol", action: "buy" });
  assert.equal(unpriced.ok, false);
  assert.match(unpriced.error, /send price/);
  ok(await world.invoke("purchase", { characterId: marla.id, item: "A carved idol", action: "buy", price: 2.5 }));
  assert.equal(purse(marla), before - 1500 - 250, "half a gold piece is 0.5");
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Oakhollow" });
});

await test("buy_item and sell_item still run, from an older console or a stored turn, at the shop they name", async () => {
  const before = purse(marla);
  ok(await world.invoke("buy_item", { characterId: marla.id, shop: "Brann's Forge", item: "Longsword", qty: 1 }));
  assert.equal(purse(marla), before - 1650);
  assert.equal(shelf("Longsword"), 4);
  // A charm nothing prices, sold for the copper an older form typed.
  world.patch(marla.id, { equipment: [...world.sheet(marla.id).equipment, { name: "Carved bone charm", qty: 1 }] });
  const middle = purse(marla);
  ok(await world.invoke("sell_item", { characterId: marla.id, shop: "Brann's Forge", item: "Carved bone charm", priceCp: 40 }));
  assert.equal(purse(marla), middle + 40);
  assert.equal(lastLedger(marla)?.delta?.shop, "Brann's Forge");
});

await test("a purchase staged as an offer names the price the engine will charge, not the call's", async () => {
  // Under inventoryApprovals a purchase outside a shop waits on its player;
  // its line showed the call's own price, which the engine ignores for
  // anything the book lists.
  const offers = await openWorld({ gameSettings: { inventoryApprovals: true } });
  const buyer = offers.addHero({ name: "Tamsin", gold: 50 });
  const offerAi = await aiEngine(offers);
  const staged = ok(await offerAi.invoke("purchase", { characterId: buyer.id, item: "Longsword", price: 10, action: "buy" }));
  // The list price wins over the call's 10 where a pack prices it.
  assert.match(staged.proposed, offers.hasPack ? /buys Longsword for 15 gold/ : /buys Longsword for 10 gold/);
  // From the console, where nothing asks for the item's row first.
  const unpriced = await offers.invoke("purchase", { characterId: buyer.id, item: "A carved idol", action: "buy" });
  assert.equal(unpriced.ok, false);
  assert.match(unpriced.error, /send price/);
  assert.equal(listOpenItemProposals(offers.campaignId).length, 1, "no offer staged for a price nobody named");
});

// ---- conditions, damage, teleports in a fight ------------------------------

const brom = world.addHero({ name: "Brom", class: "fighter", level: 3, abilities: { str: 16, dex: 12 } });
ok(await world.invoke("summon_pet", { characterId: brom.id, kind: "other", form: "wolf", name: "Fang", hp: 11, ac: 13 }));
const fangHp = () => world.sheet(brom.id).pets.find((pet) => pet.name === "Fang")?.hp;
await world.beginFight([{ monster: "goblin", count: 2 }]);
const [goblin, other] = world.enemies();
const enemy = (id) => world.enemies().find((entry) => entry.id === id);

await test("set_condition and clear_condition lay and lift an enemy's condition, as set_enemy_condition did", async () => {
  ok(await world.invoke("set_condition", { enemyId: goblin.id, condition: "prone", minutes: 1 }));
  assert.ok(enemy(goblin.id).conditions.includes("prone"));
  assert.equal(enemy(goblin.id).conditionMeta.prone?.rounds, 10, "a minute is ten rounds");
  ok(await world.invoke("clear_condition", { enemyId: goblin.id, condition: "prone" }));
  assert.ok(!enemy(goblin.id).conditions.includes("prone"));
  // The retired names, as an older app's board and a delegated monster send them.
  ok(await world.invoke("set_enemy_condition", { enemyId: other.id, condition: "restrained", rounds: 2 }));
  assert.ok(enemy(other.id).conditions.includes("restrained"));
  ok(await world.invoke("clear_enemy_condition", { enemyId: other.id, condition: "restrained" }));
  assert.ok(!enemy(other.id).conditions.includes("restrained"));
  const both = await world.invoke("set_condition", { characterId: brom.id, enemyId: goblin.id, condition: "prone" });
  assert.equal(both.ok, false);
  assert.match(both.error, /name one target/);
});

await test("the AI's condition on an enemy keeps the enemy's rails: its save first, the encounter's cap, not the sheet's", async () => {
  ai.fresh();
  const out = await ai.invoke("set_condition", { enemyId: goblin.id, condition: "restrained" });
  assert.equal(out.ok, false);
  assert.match(out.error, /save/i, "a binding condition waits on the creature's save");
  ok(await ai.invoke("set_condition", { enemyId: goblin.id, condition: "invisible", rounds: 1 }));
  assert.equal(ai.turn().encounterCount, 1);
  assert.equal(ai.turn().mutationCount, 0);
});

await test("apply_damage lands on an enemy, a pet, or several at their share, as the retired tools did", async () => {
  const start = enemy(goblin.id).currentHp;
  ok(await world.invoke("apply_damage", { enemyId: goblin.id, amount: 2, type: "fire" }));
  assert.equal(enemy(goblin.id).currentHp, start - 2);
  ok(await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 1 }));
  assert.equal(enemy(goblin.id).currentHp, start - 3);
  const fang = fangHp();
  ok(await world.invoke("apply_damage", { characterId: brom.id, petName: "Fang", amount: 3 }));
  assert.equal(fangHp(), fang - 3, "the pet's own pool");
  assert.equal(world.sheet(brom.id).currentHp, world.sheet(brom.id).maxHp, "never the owner's");
  // damage_pet named no pet when its owner had one; it still finds it.
  ok(await world.invoke("damage_pet", { characterId: brom.id, amount: 2 }));
  assert.equal(fangHp(), fang - 5);
  const hp = world.sheet(brom.id).currentHp;
  const otherHp = enemy(other.id).currentHp;
  ok(await world.invoke("apply_damage", { amount: 4, targets: [{ characterId: brom.id, share: "half" }, { enemyId: other.id, share: "full" }] }));
  assert.equal(world.sheet(brom.id).currentHp, hp - 2);
  assert.equal(enemy(other.id).currentHp, otherHp - 4);
  // The damage tray an older console sends: its rows typed.
  ok(await world.invoke("split_damage", { amount: 2, targets: `enemy:${other.id} half` }));
  assert.equal(enemy(other.id).currentHp, otherHp - 5);
  const fall = await world.invoke("apply_damage", { characterId: brom.id, fallFeet: 20 });
  assert.equal(fall.ok, false);
  assert.match(fall.error, /apply_hazard/);
});

await test("the AI's damage on a pet is rolled by the server, as every other hand-applied damage is", async () => {
  ai.fresh();
  const fang = fangHp();
  const invented = await ai.invoke("apply_damage", { characterId: brom.id, petName: "Fang", amount: 4 });
  assert.equal(invented.ok, false, "a number the server never rolled is refused");
  world.dice(3);
  ok(await ai.invoke("apply_damage", { characterId: brom.id, petName: "Fang", dice: "1d6" }));
  assert.equal(fangHp(), fang - 3);
});

await test("move_token teleports with teleport, and teleport_token still runs", async () => {
  const map = getBattleMapForEncounter(world.encounter().id);
  const token = () => getTokenByRef(map.id, brom.id);
  const open = () => {
    const at = token();
    const occupied = occupiedTiles(map, listTokens(map.id), at);
    const tiles = [...reachableTiles(map.terrain, map.width, map.height, occupied, at, 6, 1, false).keys()].filter((index) => index !== at.y * map.width + at.x);
    const index = tiles.at(-1);
    return { x: index % map.width, y: Math.floor(index / map.width) };
  };
  const to = open();
  const moved = ok(await world.invoke("move_token", { tokenName: brom.id, x: to.x, y: to.y, teleport: true }));
  assert.match(moved.note, /No movement was spent/);
  assert.deepEqual([token().x, token().y], [to.x, to.y]);
  const next = open();
  ok(await world.invoke("teleport_token", { tokenName: brom.id, x: next.x, y: next.y }));
  assert.deepEqual([token().x, token().y], [next.x, next.y]);
  ai.fresh();
  const unpaid = await ai.invoke("move_token", { tokenName: brom.id, x: to.x, y: to.y, teleport: true });
  assert.equal(unpaid.ok, false, "the AI's teleport is a spell or a hazard, as before");
});

// ---- rewards ----------------------------------------------------------------

await test("party_award is XP for one character, and reports a level-up however the award is made up", async () => {
  const novice = world.addHero({ name: "Novice", level: 1, xp: 0 });
  const alone = ok(await world.invoke("party_award", { characterIds: [novice.id], amount: 300, reason: "The bridge troll" }));
  assert.deepEqual(alone.levelUpAvailable, ["Novice"]);
  const second = world.addHero({ name: "Second", level: 1, xp: 0 });
  const spoils = ok(await world.invoke("party_award", { characterIds: [second.id], amount: 300, delta: 10, reason: "A hoard" }));
  assert.deepEqual(spoils.levelUpAvailable, ["Second"], "XP with a purse beside it still says who can level up");
  assert.equal(world.sheet(second.id).gold, 10);
  const third = world.addHero({ name: "Third", level: 1, xp: 0 });
  ok(await world.invoke("award_xp", { characterIds: [third.id], amount: 50 }));
  assert.equal(world.sheet(third.id).xp, 50);
});

// ---- the model's own turn -----------------------------------------------------

await test("the model's turn runs a merged purchase at the shop, and a retired name it still sends", async () => {
  await world.invoke("end_encounter", { outcome: "victory" });
  const model = await fakeModel();
  model.pointAt(world);
  const before = shelf("Longsword");
  model.script([
    reply({ calls: [call("purchase", { characterId: marla.id, item: "Longsword", action: "buy" })] }),
    reply({ text: "Brann wraps the blade in oilcloth." }),
  ]);
  await model.turn(world, "I buy a longsword from Brann.", marla.id, marla.userId);
  assert.equal(shelf("Longsword"), before - 1, "the model's purchase drew the shop's shelf");
  model.script([
    reply({ calls: [call("buy_item", { characterId: marla.id, shop: "Brann's Forge", item: "Longsword" })] }),
    reply({ text: "Another blade changes hands." }),
  ]);
  await model.turn(world, "And one more for my brother.", marla.id, marla.userId);
  const results = model.results(model.requests[1]);
  assert.ok(results.length && !results.some((entry) => /no action called/.test(String(entry.result.error ?? ""))), JSON.stringify(results));
  assert.equal(shelf("Longsword"), before - 2, "the retired name traded too");
  model.close();
});

// ---- what the model is offered ------------------------------------------------

await test("no profile offers a retired name, and each merged tool is offered where its siblings were", async () => {
  const campaign = world.campaign();
  const names = (tools) => new Set(tools.map((tool) => tool.function.name));
  for (const fight of [false, true]) {
    for (const lean of [false, true]) {
      const offered = names(turnModule.dmTurnTools(campaign, fight, false, lean));
      for (const retired of Object.keys(RETIRED_TOOLS)) {
        assert.ok(!offered.has(retired), `${retired} is not offered (fight ${fight}, lean ${lean})`);
      }
    }
  }
  const full = (fight) => names(turnModule.dmTurnTools(campaign, fight, false, false));
  const lean = (fight) => names(turnModule.dmTurnTools(campaign, fight, false, true));
  for (const name of ["purchase", "apply_damage", "set_condition", "clear_condition", "party_award"]) {
    assert.ok(full(false).has(name) && full(true).has(name), `${name} in the full set`);
  }
  assert.ok(full(true).has("move_token"));
  // The trimmed set leaves the sheet's tools out but keeps the merged ones
  // where it kept their siblings.
  assert.ok(lean(true).has("apply_damage") && lean(true).has("set_condition") && lean(true).has("clear_condition"), "an enemy's damage and conditions in a fight");
  assert.ok(lean(false).has("apply_damage"), "a pet's damage out of a fight");
  assert.ok(lean(false).has("purchase") && !lean(true).has("purchase"), "a shop's trade out of a fight");
  assert.ok(!lean(false).has("set_condition") && !lean(false).has("grant_item"), "the rest of the sheet's tools stay out");
  // The compact profile: the cores, and the pets' group bringing a pet's damage.
  const compact = (fight, signals = {}) => turnModule.compactTurnTools(campaign, fight, false, { inEncounter: fight, ...signals }, []).offered;
  for (const name of ["purchase", "party_award", "set_condition", "clear_condition"]) {
    assert.ok(compact(false).has(name), `${name} in the exploring core`);
  }
  for (const name of ["apply_damage", "set_condition", "clear_condition", "move_token"]) {
    assert.ok(compact(true).has(name), `${name} in the fighting core`);
  }
  assert.ok(compact(false, { pets: true }).has("apply_damage"), "a table with pets has a pet's damage out of a fight");
  assert.ok(!compact(false).has("apply_damage"), "and one without waits for the group");
});

await test("the console offers one form per merged tool, and none for a retired name", () => {
  for (const [retired, merged] of Object.entries(RETIRED_TOOLS)) {
    assert.ok(!ADJUDICATION_NAMES.includes(retired), `no form for ${retired}`);
    assert.ok(ADJUDICATION_NAMES.includes(merged), `a form for ${merged}`);
  }
});

// ---- the mapping itself ---------------------------------------------------------

await test("each retired name maps onto its merged tool and routes back to its own handler", () => {
  const route = (name, args) => {
    const merged = mergedCall(name, args);
    return merged.name === "purchase" ? merged : engineCall(merged.name, merged.args);
  };
  assert.deepEqual(mergedCall("buy_item", { characterId: "c", shop: "S", item: "Rope" }), { name: "purchase", args: { characterId: "c", shop: "S", item: "Rope", action: "buy" } });
  assert.deepEqual(mergedCall("sell_item", { characterId: "c", shop: "S", item: "Gem", priceCp: 250 }), { name: "purchase", args: { characterId: "c", shop: "S", item: "Gem", action: "sell", price: 2.5 } });
  assert.equal(route("set_enemy_condition", { enemyId: "e", condition: "prone", rounds: 2 }).name, "set_enemy_condition");
  assert.equal(route("clear_enemy_condition", { enemyId: "e", condition: "prone" }).name, "clear_enemy_condition");
  assert.equal(route("damage_enemy", { enemyId: "e", amount: 3, source: "hazard" }).name, "damage_enemy");
  assert.deepEqual(route("damage_pet", { characterId: "c", amount: 3 }), { name: "damage_pet", args: { characterId: "c", amount: 3 } });
  assert.equal(route("split_damage", { amount: 4, targets: [{ enemyId: "e", share: "half" }] }).name, "split_damage");
  assert.deepEqual(route("award_xp", { characterIds: ["c"], amount: 50 }), { name: "award_xp", args: { characterIds: ["c"], amount: 50 } });
  assert.equal(route("teleport_token", { tokenName: "t", x: 1, y: 2 }).name, "teleport_token");
  // The merged tools reach their first handlers when no sibling's argument is sent.
  assert.equal(engineCall("apply_damage", { characterId: "c", amount: 3 }).name, "apply_damage");
  assert.equal(engineCall("set_condition", { characterId: "c", condition: "prone" }).name, "set_condition");
  assert.equal(engineCall("move_token", { tokenName: "t", x: 1, y: 1, forced: true }).name, "move_token");
  assert.equal(engineCall("move_token", { tokenName: "t", x: 1, y: 1, spell: "Misty Step", casterId: "c" }).name, "teleport_token");
  assert.equal(engineCall("party_award", { characterIds: ["c"], amount: 50, delta: 5 }).name, "party_award");
  // Where a merged tool is offered, its retired names are accepted.
  const offered = new Set(["purchase", "apply_damage"]);
  assert.ok(acceptsCall((name) => offered.has(name), "buy_item"));
  assert.ok(acceptsCall((name) => offered.has(name), "damage_enemy"));
  assert.ok(!acceptsCall((name) => offered.has(name), "teleport_token"), "not while move_token is not offered");
});

console.log(`tool merge: ${passed} tests passed`);
world.close();
