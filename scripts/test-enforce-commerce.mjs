// Shops and trades, through the routes a player's client calls.
//
// ODM's shop rules (docs/rules-coverage.md, "Commerce"): the shelf sets the
// price (list price times the settlement's markup), the purse and the shelf
// refuse what they cannot cover, the keeper buys at half list, and a haggle
// is one Persuasion check per character per shop that moves every price a
// step. The SRD's own rule is the half-price sale ("Selling Treasure"); the
// rest is ODM's and is pinned as ODM states it.
//
// A trade between players is checked against both sheets when offered and
// again when accepted, and moves both sheets together or not at all. The
// invariant under all of it: no sequence of offers, purchases and sales
// leaves the table holding more coin or more items than it started with.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-commerce");
const shops = await import("../src/lib/db/shops.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const { searchItems } = await import("../src/lib/content/index.ts");

const world = await openWorld();
// The owner runs the story; the three at the counter are ordinary players.
world.addHero({ class: "fighter", level: 3 });
const [ann, bo, cy] = ["ann", "bo", "cy"].map((name) => {
  const user = world.addUser(name);
  return { user, hero: world.addHero({ user, class: "rogue", level: 3, abilities: { cha: 10 } }) };
});
const sheet = (who) => world.sheet(who.hero.id);
const copperOf = (who) => sheet(who).gold * 100 + sheet(who).copper;
const held = (who, name) => sheet(who).equipment.find((item) => item.name.toLowerCase() === name.toLowerCase())?.qty ?? 0;
const give = (who, { gold = 0, copper = 0, equipment = [] }) => world.patch(who.hero.id, { gold, copper, equipment });

async function call(mod, user, body, params = {}) {
  world.signIn(user);
  const response = await mod.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...params }) },
  );
  return { status: response.status, body: await response.json() };
}

// ---- the counter ----

const counter = await world.route("campaigns/[campaignId]/shops/[shopId]/trade");
const LIST = { Rope: 100, Lantern: 500, Dagger: 200 };
function openShop(markup = 1, size = "town") {
  return shops.insertShop(world.campaignId, {
    name: `Shop ${Math.random().toString(36).slice(2, 8)}`,
    kind: "general",
    size,
    markup,
    stock: [
      { itemName: "Rope", qty: 5, priceCp: LIST.Rope, note: "" },
      { itemName: "Lantern", qty: 1, priceCp: LIST.Lantern, note: "" },
      { itemName: "Dagger", qty: 3, priceCp: LIST.Dagger, note: "" },
    ],
  });
}
const at = (shop, who, body) => call(counter, who.user, body, { shopId: shop.id });
const shelf = (shop, name) => shops.getShop(shop.id).stock.find((line) => line.itemName === name)?.qty ?? 0;

await test("a purchase takes the shelf's price from the purse, the item from the shelf, and both at once", async () => {
  const shop = openShop();
  give(ann, { gold: 10, copper: 50 });
  const reply = await at(shop, ann, { action: "buy", item: "Rope", qty: 2 });
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(copperOf(ann), 1050 - 2 * LIST.Rope);
  assert.equal(held(ann, "Rope"), 2);
  assert.equal(shelf(shop, "Rope"), 3);
});

await test("the price is list times the settlement's markup, to the copper", async () => {
  for (const [markup, each] of [[0.8, 400], [0.9, 450], [1.1, 550], [1.25, 625], [1.5, 750], [2, 1000]]) {
    const shop = openShop(markup);
    give(ann, { gold: 20 });
    const reply = await at(shop, ann, { action: "buy", item: "Lantern" });
    assert.equal(reply.status, 200, reply.body.error);
    assert.equal(2000 - copperOf(ann), each, `markup ${markup}`);
  }
});

await test("a purse one copper short is refused and nothing moves; the exact price is enough", async () => {
  const shop = openShop();
  give(ann, { gold: 4, copper: 99 });
  const refused = await at(shop, ann, { action: "buy", item: "Lantern" });
  assert.equal(refused.status, 409);
  assert.equal(copperOf(ann), 499);
  assert.equal(held(ann, "Lantern"), 0);
  assert.equal(shelf(shop, "Lantern"), 1);
  give(ann, { gold: 5, copper: 0 });
  assert.equal((await at(shop, ann, { action: "buy", item: "Lantern" })).status, 200);
  assert.equal(copperOf(ann), 0);
});

await test("more than the shelf holds is refused, and an emptied shelf sells nothing", async () => {
  const shop = openShop();
  give(ann, { gold: 500 });
  const refused = await at(shop, ann, { action: "buy", item: "Dagger", qty: 4 });
  assert.equal(refused.status, 409);
  assert.equal(copperOf(ann), 50000);
  assert.equal(shelf(shop, "Dagger"), 3);
  assert.equal((await at(shop, ann, { action: "buy", item: "Dagger", qty: 3 })).status, 200);
  assert.equal((await at(shop, ann, { action: "buy", item: "Dagger" })).status, 409);
  assert.equal(held(ann, "Dagger"), 3);
  assert.equal(copperOf(ann), 50000 - 3 * LIST.Dagger);
});

await test("a count of none, a negative count and a fraction are refused at the counter", async () => {
  const shop = openShop();
  give(ann, { gold: 50 });
  for (const qty of [0, -1, 1.5, 100]) {
    assert.equal((await at(shop, ann, { action: "buy", item: "Rope", qty })).status, 400, `qty ${qty}`);
  }
  assert.equal(copperOf(ann), 5000);
  assert.equal(shelf(shop, "Rope"), 5);
});

await test("an item the shop does not stock is refused", async () => {
  const shop = openShop();
  give(ann, { gold: 50000 });
  assert.equal((await at(shop, ann, { action: "buy", item: "Staff of Power" })).status, 409);
  assert.equal(copperOf(ann), 5000000);
});

await test("a player buys for their own character only, whoever they name", async () => {
  const shop = openShop();
  give(ann, { gold: 10 });
  give(bo, { gold: 10 });
  const reply = await at(shop, ann, { action: "buy", item: "Rope", characterId: bo.hero.id });
  assert.equal(reply.status, 200);
  assert.equal(copperOf(bo), 1000);
  assert.equal(held(bo, "Rope"), 0);
  assert.equal(copperOf(ann), 900);
});

await test("a shop in another campaign is not a shop here", async () => {
  const elsewhere = await openWorld();
  const foreign = shops.insertShop(elsewhere.campaignId, { name: "Elsewhere", stock: [{ itemName: "Rope", qty: 1, priceCp: 1, note: "" }] });
  give(ann, { gold: 10 });
  assert.equal((await at(foreign, ann, { action: "buy", item: "Rope" })).status, 404);
  assert.equal(copperOf(ann), 1000);
});

await test("selling what is not carried is refused and pays nothing", async () => {
  const shop = openShop();
  give(ann, { gold: 1, equipment: [{ name: "Torch", qty: 1 }] });
  assert.equal((await at(shop, ann, { action: "sell", item: "Crown Jewels" })).status, 409);
  assert.equal(copperOf(ann), 100);
  assert.equal(shops.getShop(shop.id).stock.length, 3);
});

await test("a shop that does not buy refuses a sale", async () => {
  const shop = shops.updateShop(openShop().id, { buys: false });
  give(ann, { gold: 0, equipment: [{ name: "Dagger", qty: 1 }] });
  assert.equal((await at(shop, ann, { action: "sell", item: "Dagger" })).status, 409);
  assert.equal(held(ann, "Dagger"), 1);
});

await test("the keeper pays half the list price, and only for what changed hands", async () => {
  const shop = openShop();
  give(ann, { gold: 0, equipment: [{ name: "Gem", qty: 2 }] });
  const sold = await world.invoke("sell_item", { characterId: ann.hero.id, shop: shop.id, item: "Gem", qty: 5, priceCp: 250 });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(copperOf(ann), 2 * 250);
  assert.equal(held(ann, "Gem"), 0);
  assert.equal(shelf(shop, "Gem"), 2);
  if (searchItems({ q: "Longsword", limit: 5 }).some((item) => item.name === "Longsword")) {
    // Longsword lists at 15 gp in the SRD; the keeper pays 7 gp 5 sp. The
    // list price is the content pack's, so this half runs only beside it.
    give(ann, { gold: 0, equipment: [{ name: "Longsword", qty: 1 }] });
    assert.equal((await at(shop, ann, { action: "sell", item: "Longsword" })).status, 200);
    assert.equal(copperOf(ann), 750);
  }
});

await test("buying an item back costs more than its sale paid, at every markup", async () => {
  for (const markup of [0.8, 1, 2]) {
    const shop = openShop(markup);
    give(ann, { gold: 100, equipment: [{ name: "Idol", qty: 1 }] });
    await world.invoke("sell_item", { characterId: ann.hero.id, shop: shop.id, item: "Idol", priceCp: 500 });
    assert.equal((await at(shop, ann, { action: "buy", item: "Idol" })).status, 200);
    assert.ok(copperOf(ann) < 10000, `markup ${markup} left ${copperOf(ann)} copper`);
    assert.equal(held(ann, "Idol"), 1);
  }
});

// A town's haggle is DC 13 (shop-logic.ts haggleDc); CHA 10 and no
// Persuasion means the d20 is the total.
async function haggle(shop, who, face) {
  world.clearDice();
  world.dice(face);
  const reply = await at(shop, who, { action: "haggle" });
  world.clearDice();
  return reply;
}

await test("a won haggle drops every price a step, a lost one raises them a step", async () => {
  let shop = openShop(1);
  assert.equal((await haggle(shop, ann, 13)).body.result.success, true);
  assert.equal(shops.getShop(shop.id).markup, 0.9);
  shop = openShop(1);
  assert.equal((await haggle(shop, ann, 12)).body.result.success, false);
  assert.equal(shops.getShop(shop.id).markup, 1.1);
});

await test("a character haggles once in a shop: a second try is refused and rolls nothing", async () => {
  const shop = openShop(1);
  await haggle(shop, ann, 20);
  world.diceLog();
  const again = await haggle(shop, ann, 20);
  assert.equal(again.status, 409);
  assert.equal(world.diceLog().length, 0);
  assert.equal(shops.getShop(shop.id).markup, 0.9);
  assert.deepEqual(shops.getShop(shop.id).haggledBy, [ann.hero.id]);
});

await test("the markup never leaves its ladder, however many characters haggle", async () => {
  const shop = openShop(0.9);
  for (const who of [ann, bo, cy]) {
    await haggle(shop, who, 20);
  }
  assert.equal(shops.getShop(shop.id).markup, 0.8);
  const dear = openShop(1.5);
  for (const who of [ann, bo, cy]) {
    await haggle(dear, who, 2);
  }
  assert.equal(shops.getShop(dear.id).markup, 2);
});

// ---- trades ----

const offers = await world.route("campaigns/[campaignId]/item-proposals");
const answers = await world.route("campaigns/[campaignId]/item-proposals/[proposalId]");
const offer = (who, body) => call(offers, who.user, body);
const answer = (who, id, action) => call(answers, who.user, { action }, { proposalId: id });
const everyone = [ann, bo, cy];
const tableCopper = () => everyone.reduce((sum, who) => sum + copperOf(who), 0);
const tableCount = (name) => everyone.reduce((sum, who) => sum + held(who, name), 0);
function deal() {
  give(ann, { gold: 50, copper: 25, equipment: [{ name: "Ruby", qty: 3 }, { name: "Rope", qty: 1 }] });
  give(bo, { gold: 20, copper: 0, equipment: [{ name: "Map", qty: 1 }] });
  give(cy, { gold: 5, copper: 0, equipment: [] });
  return { copper: tableCopper(), rubies: tableCount("Ruby"), maps: tableCount("Map") };
}
const conserved = (start) => {
  assert.equal(tableCopper(), start.copper, "coin");
  assert.equal(tableCount("Ruby"), start.rubies, "rubies");
  assert.equal(tableCount("Map"), start.maps, "maps");
};
const pending = () => proposals.listOpenItemProposals(world.campaignId).length;

await test("an accepted trade moves both sheets, and the table holds what it held", async () => {
  const start = deal();
  const made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Ruby", qty: 2 }], giveCp: 125, want: [{ name: "Map", qty: 1 }], wantCp: 1000 });
  assert.equal(made.status, 200, made.body.error);
  conserved(start);
  assert.equal(held(ann, "Ruby"), 3);
  const done = await answer(bo, made.body.proposal.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.deepEqual([held(ann, "Ruby"), held(bo, "Ruby"), held(ann, "Map"), held(bo, "Map")], [1, 2, 1, 0]);
  assert.equal(copperOf(ann), 5025 - 125 + 1000);
  assert.equal(copperOf(bo), 2000 + 125 - 1000);
  conserved(start);
});

await test("an offer of what the offerer does not hold, or for what the other lacks, never reaches them", async () => {
  const start = deal();
  const before = pending();
  for (const body of [
    { toCharacterId: bo.hero.id, give: [{ name: "Ruby", qty: 4 }] },
    { toCharacterId: bo.hero.id, give: [{ name: "Crown", qty: 1 }] },
    { toCharacterId: bo.hero.id, giveCp: 5026 },
    { toCharacterId: bo.hero.id, want: [{ name: "Map", qty: 2 }] },
    { toCharacterId: bo.hero.id, wantCp: 2001 },
  ]) {
    assert.equal((await offer(ann, body)).status, 409, JSON.stringify(body));
  }
  for (const body of [
    { toCharacterId: bo.hero.id },
    { toCharacterId: ann.hero.id, giveCp: 1 },
    { toCharacterId: "nobody", giveCp: 1 },
    { giveCp: 1 },
  ]) {
    assert.equal((await offer(ann, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(pending(), before);
  conserved(start);
});

await test("a negative amount of coin is an offer of none, never a way to take", async () => {
  const start = deal();
  const made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Rope", qty: 1 }], giveCp: -5000, wantCp: -5000 });
  assert.equal(made.status, 200, made.body.error);
  await answer(bo, made.body.proposal.id, "approve");
  assert.equal(copperOf(ann), 5025);
  assert.equal(copperOf(bo), 2000);
  conserved(start);
});

await test("only the other side accepts: not the offerer, not a bystander", async () => {
  const start = deal();
  const made = await offer(ann, { toCharacterId: bo.hero.id, giveCp: 100, want: [{ name: "Map", qty: 1 }] });
  const id = made.body.proposal.id;
  assert.equal((await answer(ann, id, "approve")).status, 403);
  assert.equal((await answer(cy, id, "approve")).status, 403);
  assert.equal((await answer(cy, id, "decline")).status, 403);
  assert.equal(held(bo, "Map"), 1);
  conserved(start);
  assert.equal((await answer(ann, id, "cancel")).status, 200);
  assert.equal((await answer(bo, id, "approve")).status, 400);
  conserved(start);
});

await test("an offer is checked again on acceptance: gold spent in between stops it, and nothing moves", async () => {
  const start = deal();
  const made = await offer(ann, { toCharacterId: bo.hero.id, giveCp: 5000, want: [{ name: "Map", qty: 1 }] });
  await world.invoke("modify_gold", { characterId: ann.hero.id, delta: -10, reason: "spent" });
  const refused = await answer(bo, made.body.proposal.id, "approve");
  assert.equal(refused.status, 409);
  assert.equal(copperOf(ann), 5025 - 1000);
  assert.equal(copperOf(bo), 2000);
  assert.equal(held(bo, "Map"), 1);
  assert.equal(held(ann, "Map"), 0);
  assert.equal(proposals.getItemProposal(made.body.proposal.id).status, "declined");
  assert.equal(tableCount("Map"), start.maps);
});

await test("an item given away in between stops the trade, from either side", async () => {
  const start = deal();
  let made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Ruby", qty: 3 }], wantCp: 100 });
  await world.invoke("remove_item", { characterId: ann.hero.id, name: "Ruby", qty: 1, reason: "lost" });
  assert.equal((await answer(bo, made.body.proposal.id, "approve")).status, 409);
  assert.deepEqual([held(ann, "Ruby"), held(bo, "Ruby"), copperOf(bo)], [2, 0, 2000]);
  made = await offer(ann, { toCharacterId: bo.hero.id, giveCp: 100, want: [{ name: "Map", qty: 1 }] });
  await world.invoke("remove_item", { characterId: bo.hero.id, name: "Map", reason: "burned" });
  assert.equal((await answer(bo, made.body.proposal.id, "approve")).status, 409);
  assert.equal(copperOf(ann), start.copper - 2500);
  assert.equal(held(ann, "Map"), 0);
});

await test("the same goods offered to two players change hands once", async () => {
  const start = deal();
  const toBo = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Ruby", qty: 3 }], wantCp: 500 });
  const toCy = await offer(ann, { toCharacterId: cy.hero.id, give: [{ name: "Ruby", qty: 3 }], wantCp: 500 });
  assert.equal((await answer(bo, toBo.body.proposal.id, "approve")).status, 200);
  assert.equal((await answer(cy, toCy.body.proposal.id, "approve")).status, 409);
  assert.deepEqual([held(ann, "Ruby"), held(bo, "Ruby"), held(cy, "Ruby")], [0, 3, 0]);
  assert.equal(copperOf(cy), 500);
  conserved(start);
});

await test("an accepted trade cannot be accepted twice", async () => {
  const start = deal();
  const made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Ruby", qty: 1 }], wantCp: 100 });
  assert.equal((await answer(bo, made.body.proposal.id, "approve")).status, 200);
  assert.equal((await answer(bo, made.body.proposal.id, "approve")).status, 400);
  assert.equal((await answer(ann, made.body.proposal.id, "cancel")).status, 400);
  assert.deepEqual([held(ann, "Ruby"), held(bo, "Ruby")], [2, 1]);
  conserved(start);
});

await test("a long run of trades, purchases and sales never adds a coin or an item to the table", async () => {
  const start = deal();
  const shop = openShop(1);
  let spent = 0;
  for (let round = 0; round < 6; round += 1) {
    const [from, to] = [[ann, bo], [bo, cy], [cy, ann]][round % 3];
    const made = await offer(from, { toCharacterId: to.hero.id, give: held(from, "Ruby") ? [{ name: "Ruby", qty: 1 }] : [], giveCp: 50, wantCp: 25 });
    if (made.status === 200) {
      await answer(to, made.body.proposal.id, "approve");
      await answer(to, made.body.proposal.id, "approve");
    }
    const before = tableCopper();
    await at(shop, from, { action: "buy", item: "Rope" });
    await world.invoke("sell_item", { characterId: from.hero.id, shop: shop.id, item: "Rope", priceCp: 50 });
    spent += before - tableCopper();
    assert.ok(tableCopper() <= before);
  }
  assert.equal(tableCopper(), start.copper - spent);
  assert.equal(tableCount("Ruby"), start.rubies);
  for (const who of everyone) {
    assert.ok(sheet(who).copper >= 0 && sheet(who).copper <= 99 && sheet(who).gold >= 0);
    assert.ok(sheet(who).equipment.every((item) => item.qty >= 1));
  }
});

await test("an item that changes hands is the same item afterwards: unidentified, with its slug and its weight", async () => {
  give(ann, { equipment: [{ name: "Tarnished Ring", qty: 1, identified: false, slug: "homebrew:ring" }] });
  give(bo, { equipment: [] });
  const made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Tarnished Ring", qty: 1 }] });
  await answer(bo, made.body.proposal.id, "approve");
  const ring = sheet(bo).equipment.find((item) => item.name === "Tarnished Ring");
  assert.equal(ring?.identified, false, `the ring arrived as ${JSON.stringify(ring)}`);
  assert.equal(ring.slug, "homebrew:ring");
});

await test("a traded item arrives with its weight, and neither worn nor attuned", async () => {
  give(ann, { equipment: [{ name: "Ring of Protection", qty: 1, weight: 0.5, equipped: true, attuned: true }] });
  give(bo, { equipment: [] });
  const made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Ring of Protection", qty: 1 }] });
  await answer(bo, made.body.proposal.id, "approve");
  const ring = sheet(bo).equipment.find((item) => item.name === "Ring of Protection");
  assert.equal(ring.weight, 0.5);
  assert.equal(Boolean(ring.attuned), false);
  assert.equal(Boolean(ring.equipped), false);
  assert.equal(sheet(ann).equipment.length, 0);
});

await test("a mystery item does not merge into a known one of the same name", async () => {
  give(ann, { equipment: [{ name: "Plain Ring", qty: 1, identified: false }] });
  give(bo, { equipment: [{ name: "Plain Ring", qty: 1 }] });
  const made = await offer(ann, { toCharacterId: bo.hero.id, give: [{ name: "Plain Ring", qty: 1 }] });
  await answer(bo, made.body.proposal.id, "approve");
  const rings = sheet(bo).equipment.filter((item) => item.name === "Plain Ring");
  assert.deepEqual(rings.map((item) => [item.qty, item.identified !== false]).sort(), [[1, false], [1, true]]);
});

world.close();
finish();
