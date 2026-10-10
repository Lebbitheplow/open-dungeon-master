// A workshop's Market travelling with the rest of its prep, and staying put
// once it has been played (#171), through the real route handlers and a real
// encrypted SQLite file.
//
// A shop authored in a workshop (its place, its keeper, an exact shelf at an
// adventure's own prices) used to stop at both import doors: the portable
// bundle had no shops, and the campaign import had no Market kind. Inside a
// campaign the shelf was not safe either: open_shop called again for a shop
// that already stood there rerolled its stock from the pack and let everyone
// haggle again, a restock emptied the shelves on a server without the pack,
// and only the DM seat could write a shop, so the lead of an AI-narrated
// table could not prepare one at all.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-market-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// No content pack: the shelves a test sees are the ones it wrote, and a
// restock that would draw from the pack draws nothing.
process.env.CONTENT_DB_PATH = path.join(dir, "no-pack.sqlite");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getShop, listShops, updateShop, insertShop } = await import("../src/lib/db/shops.ts");
const { handleOpenShop, handleBuyItem, shopsBlock } = await import("../src/lib/dm/shop-tools.ts");
const { planContentImport, runContentImport } = await import("../src/lib/db/content-import.ts");
const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { bundleCounts, bundleDependencies, bundleWarnings, pickBundleKinds, readBundle } = await import("../src/lib/workshop/bundle.ts");
const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { MINUTES_PER_DAY } = await import("../src/lib/dm/calendar.ts");
const { askingPriceCp } = await import("../src/lib/dm/shop-logic.ts");
const { formatCopper } = await import("../src/lib/srd/currency.ts");

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const campaignsRoute = await route("campaigns");
const shopsRoute = await route("campaigns/[campaignId]/shops");
const shopRoute = await route("campaigns/[campaignId]/shops/[shopId]");

const db = getDatabase();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

const author = createUser("author", "x");
const player = createUser("player", "x");
const stranger = createUser("stranger", "x");
const as = (user) => {
  globalThis.__odmTestToken = mintSession(user.id).token;
};
const one = (sql, ...args) => db.prepare(sql).get(...args);
const copyOf = (campaignId, kind, originRowId) =>
  one(`SELECT row_id FROM content_origins WHERE campaign_id = ? AND kind = ? AND origin_row_id = ?`, campaignId, kind, originRowId)?.row_id;
const npcRow = (campaignId, name) => {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, last_shift_turn, created_at, updated_at)
     VALUES (?, ?, ?, 'friendly', '', '', '', ?, ?)`,
  ).run(id, campaignId, name, nowIso(), nowIso());
  return id;
};
const placeRow = (campaignId, name) => {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locations (id, campaign_id, name, layout_description, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`,
  ).run(id, campaignId, name, nowIso(), nowIso());
  return id;
};
const LANTERN = { itemName: "Example Lantern", qty: 1, priceCp: 123, note: "The last one from the drowned lighthouse." };
const ROPE = { itemName: "Silk Rope (50 feet)", qty: 3, priceCp: 1000, note: "" };

// ---- authoring in a workshop (the issue's reproduction, step 1) ----

as(author);
const workshop = createWorkshop(author.id, { title: "Saltmarch" });
const harbour = placeRow(workshop.id, "The Harbour");
const marla = npcRow(workshop.id, "Marla Venn");
const elsewhere = createWorkshop(author.id, { title: "Elsewhere" });
const foreignNpc = npcRow(elsewhere.id, "Somebody else's keeper");
let shopId = "";

await test("a workshop shop is written with its place, its keeper and an exact shelf", async () => {
  const made = await call(
    shopsRoute,
    "POST",
    { name: "Venn's Lanterns", kind: "outfitter", size: "town", locationId: harbour, keeperNpcId: marla, stockFromPack: false },
    { campaignId: workshop.id },
  );
  assert.equal(made.status, 200, JSON.stringify(made.json));
  shopId = made.json.shop.id;
  assert.equal(made.json.shop.locationId, harbour);
  assert.equal(made.json.shop.keeperName, "Marla Venn");
  assert.deepEqual(made.json.shop.stock, []);
  const edited = await call(shopRoute, "PATCH", { stock: [LANTERN, ROPE], restockDays: 0, buys: false, markup: 1.25 }, { campaignId: workshop.id, shopId });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const shop = getShop(shopId);
  assert.deepEqual(shop.stock, [LANTERN, ROPE]);
  assert.deepEqual(shop.preparedStock, [LANTERN, ROPE], "the author's shelf was not kept as the restock baseline");
  assert.equal(shop.markup, 1.25);
  assert.equal(shop.buys, false);
  assert.equal(shop.restockDays, 0);
});

await test("a keeper or a place from another campaign is refused, not stored", async () => {
  const keeper = await call(shopRoute, "PATCH", { keeperNpcId: foreignNpc }, { campaignId: workshop.id, shopId });
  assert.equal(keeper.status, 400, JSON.stringify(keeper.json));
  const place = await call(shopRoute, "PATCH", { locationId: placeRow(elsewhere.id, "Far away") }, { campaignId: workshop.id, shopId });
  assert.equal(place.status, 400, JSON.stringify(place.json));
  const made = await call(shopsRoute, "POST", { name: "Stolen keeper", keeperNpcId: foreignNpc, stockFromPack: false }, { campaignId: workshop.id });
  assert.equal(made.status, 400, JSON.stringify(made.json));
  assert.equal(getShop(shopId).keeperNpcId, marla);
});

await test("the market panel lists the workshop's places and cast for the shop editor", async () => {
  const listed = await call(shopsRoute, "GET", undefined, { campaignId: workshop.id });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.canPrep, true);
  assert.ok(listed.json.places.some((place) => place.id === harbour));
  assert.ok(listed.json.keepers.some((npc) => npc.id === marla && npc.name === "Marla Venn"));
  assert.deepEqual(listed.json.shops[0].preparedStock, [LANTERN, ROPE]);
});

await test("a shelf holds one line per item: a second line of the same name joins the first", async () => {
  const scratch = insertShop(workshop.id, { name: "Scratch", stock: [] });
  const edited = await call(
    shopRoute,
    "PATCH",
    { stock: [{ itemName: "Torch", qty: 2, priceCp: 1 }, { itemName: "torch", qty: 3, priceCp: 9 }] },
    { campaignId: workshop.id, shopId: scratch.id },
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.deepEqual(getShop(scratch.id).stock, [{ itemName: "Torch", qty: 5, priceCp: 1, note: "" }]);
  assert.equal((await call(shopRoute, "DELETE", undefined, { campaignId: workshop.id, shopId: scratch.id })).status, 200);
});

// ---- the portable bundle (step 2) ----

const manifest = { name: "Saltmarch", blurb: "A harbour market.", inspiredBy: "Original work" };
const bundle = readBundle(JSON.stringify(exportWorkshopBundle(workshop.id, manifest).bundle)).bundle;

await test("a bundle carries the shop, its shelf and its policy, with place and keeper by index", async () => {
  assert.equal(bundle.shops.length, 1);
  const [shop] = bundle.shops;
  assert.equal(shop.name, "Venn's Lanterns");
  assert.equal(bundle.locations[shop.location].name, "The Harbour");
  assert.equal(bundle.npcs[shop.keeper].name, "Marla Venn");
  assert.deepEqual(shop.stock, [LANTERN, ROPE]);
  assert.deepEqual(shop.preparedStock, [LANTERN, ROPE]);
  assert.equal(shop.markup, 1.25);
  assert.equal(shop.buys, false);
  assert.equal(shop.restockDays, 0);
  assert.ok(!JSON.stringify(shop).includes(harbour) && !JSON.stringify(shop).includes(marla), "a database id travelled");
  assert.equal(bundleCounts(bundle).shops, 1);
  const links = bundleDependencies(bundle);
  assert.ok(links.some((link) => link.from === "shops" && link.to === "locations" && link.count === 1));
  assert.ok(links.some((link) => link.from === "shops" && link.to === "npcs" && link.count === 1));
});

await test("the bundle lands as a new workshop's Market, place and keeper resolved to the new rows", async () => {
  const result = importWorkshopBundle(author.id, bundle);
  const [shop] = listShops(result.workshopId);
  assert.ok(shop, "the imported workshop has no shop");
  assert.deepEqual(shop.stock, [LANTERN, ROPE]);
  assert.deepEqual(shop.preparedStock, [LANTERN, ROPE]);
  assert.equal(one(`SELECT campaign_id, name FROM locations WHERE id = ?`, shop.locationId).campaign_id, result.workshopId);
  assert.equal(shop.locationName, "The Harbour");
  assert.equal(one(`SELECT campaign_id, name FROM npcs WHERE id = ?`, shop.keeperNpcId).name, "Marla Venn");
  assert.equal(one(`SELECT campaign_id FROM npcs WHERE id = ?`, shop.keeperNpcId).campaign_id, result.workshopId);
  assert.equal(shop.markup, 1.25);
  assert.equal(shop.buys, false);
});

await test("unticking the places and the cast lands the shop unplaced and unkept, and says so first", async () => {
  const picked = pickBundleKinds(bundle, ["shops"]);
  const result = importWorkshopBundle(author.id, picked);
  const [shop] = listShops(result.workshopId);
  assert.equal(shop.locationId, "");
  assert.equal(shop.locationName, "The Harbour", "the place's name should stay so it opens where a place of that name is");
  assert.equal(shop.keeperNpcId, "");
  assert.equal(result.droppedLinks, 2);
  assert.equal(pickBundleKinds(bundle, ["locations"]).shops.length, 0);
});

await test("a bundle written before Markets still reads, and a hand-edited one says what it drops", async () => {
  const old = JSON.parse(JSON.stringify(bundle));
  delete old.shops;
  const read = readBundle(JSON.stringify(old));
  assert.ok("bundle" in read, read.error);
  assert.deepEqual(read.bundle.shops, []);
  assert.equal(listShops(importWorkshopBundle(author.id, read.bundle).workshopId).length, 0);
  const edited = JSON.parse(JSON.stringify(bundle));
  edited.shops[0].stock.push({ itemName: "Nothing left", qty: 0, priceCp: 5, note: "" });
  edited.shops[0].keeper = 99;
  const warnings = bundleWarnings(readBundle(JSON.stringify(edited)).bundle);
  assert.ok(warnings.some((line) => /1 stock line .*left out/.test(line)), JSON.stringify(warnings));
  assert.ok(warnings.some((line) => /1 link points at something the bundle does not hold/.test(line)), JSON.stringify(warnings));
});

// ---- the campaign import (step 3) ----

const created = await call(campaignsRoute, "POST", { title: "The Saltmarch table", gameSettings: { dmMode: "ai" } });
assert.equal(created.status, 201, JSON.stringify(created.json));
const campaignId = created.json.campaign.id;
db.prepare(`INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at) VALUES (?, ?, 'player', 0, ?)`).run(campaignId, player.id, nowIso());
db.prepare(`UPDATE campaigns SET status = 'active' WHERE id = ?`).run(campaignId);
// The table has been playing a while: its clock is weeks past the workshop's.
setClockInstant(campaignId, getClock(campaignId).instant + 40 * MINUTES_PER_DAY);

await test("the import preview offers the Market and says what its shops lean on", async () => {
  const alone = planContentImport(workshop.id, campaignId, ["shops"]);
  assert.equal(alone.counts.shops, 1);
  assert.ok(alone.warnings.some((warning) => warning.kind === "shops" && /place that is not coming along/.test(warning.message)), JSON.stringify(alone.warnings));
  assert.ok(alone.warnings.some((warning) => warning.kind === "shops" && /keeper .*not coming along/.test(warning.message)), JSON.stringify(alone.warnings));
  const whole = planContentImport(workshop.id, campaignId, ["shops", "locations", "npcs"]);
  assert.ok(!whole.warnings.some((warning) => warning.kind === "shops"), JSON.stringify(whole.warnings));
  assert.ok(whole.notes.some((note) => note.kind === "shops" && /2 stock lines/.test(note.message)), JSON.stringify(whole.notes));
});

let tableShop = null;
await test("the shop arrives with its shelf, remapped to the campaign's copies of its place and keeper", async () => {
  const outcome = runContentImport({ sourceId: workshop.id, campaignId, selection: ["locations", "npcs", "shops"], houseRulesMode: "replace" });
  assert.ok(!("error" in outcome));
  const shops = listShops(campaignId);
  assert.equal(shops.length, 1);
  tableShop = shops[0];
  assert.equal(tableShop.locationId, copyOf(campaignId, "locations", harbour));
  assert.equal(tableShop.keeperNpcId, copyOf(campaignId, "npcs", marla));
  assert.deepEqual(tableShop.stock, [LANTERN, ROPE]);
  assert.deepEqual(tableShop.preparedStock, [LANTERN, ROPE]);
  assert.deepEqual(tableShop.haggledBy, []);
  assert.equal(tableShop.restockedAt, getClock(campaignId).instant, "the restock cycle did not start on arrival");
  assert.equal(copyOf(campaignId, "shops", shopId), tableShop.id);
});

const sheet = createSheet(
  campaignId,
  player.id,
  3,
  createSheetSchema.parse({
    name: "Pell",
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 16 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 3, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["persuasion"], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 50,
  }),
);
upsertCurrentLocation({ campaignId, name: "The Harbour" });

await test("the storyteller sees the prepared shelf at the place, keeper named, prices as authored", async () => {
  const block = shopsBlock(getCampaignById(campaignId));
  assert.match(block, /Venn's Lanterns \(kept by Marla Venn\)/);
  assert.ok(block.includes(`Example Lantern x1 at ${formatCopper(askingPriceCp(123, 1.25))}`), block);
  assert.deepEqual(getShop(tableShop.id).stock, [LANTERN, ROPE], "building the prompt rerolled the prepared shelf");
});

await test("a purchase, a haggle and a reopen leave the played shelf as the table left it", async () => {
  const campaign = getCampaignById(campaignId);
  const bought = handleBuyItem(campaign, JSON.stringify({ characterId: sheet.id, shop: "Venn's Lanterns", item: "Example Lantern" }));
  assert.equal(bought.ok, true, JSON.stringify(bought));
  updateShop(tableShop.id, { haggledBy: [sheet.id] });
  const reopened = handleOpenShop(campaign, JSON.stringify({ name: "Venn's Lanterns", kind: "general", size: "village", keeper: "Somebody new" }));
  assert.equal(reopened.ok, true, JSON.stringify(reopened));
  assert.equal(reopened.restocked, false);
  const shop = getShop(tableShop.id);
  assert.deepEqual(shop.stock, [ROPE], "reopening put the sold lantern back or rerolled the shelf");
  assert.deepEqual(shop.haggledBy, [sheet.id], "reopening let everyone haggle again");
  assert.equal(shop.kind, "outfitter");
  assert.equal(shop.keeperNpcId, tableShop.keeperNpcId, "reopening replaced the authored keeper");
  assert.equal(listShops(campaignId).length, 1);
});

await test("importing the chapter again keeps the played shop, sold stock and all, and makes no duplicate", async () => {
  const plan = planContentImport(workshop.id, campaignId, ["locations", "npcs", "shops"]);
  assert.ok(plan.notes.some((note) => note.kind === "shops" && /came in from here before/.test(note.message)), JSON.stringify(plan.notes));
  runContentImport({ sourceId: workshop.id, campaignId, selection: ["locations", "npcs", "shops"], houseRulesMode: "replace" });
  assert.equal(listShops(campaignId).length, 1);
  assert.deepEqual(getShop(tableShop.id).stock, [ROPE]);
  assert.deepEqual(getShop(tableShop.id).haggledBy, [sheet.id]);
});

await test("asking for second copies brings a numbered shop with the authored shelf", async () => {
  runContentImport({ sourceId: workshop.id, campaignId, selection: ["shops"], houseRulesMode: "replace", again: "copy" });
  const second = listShops(campaignId).find((shop) => shop.name === "Venn's Lanterns (2)");
  assert.ok(second, listShops(campaignId).map((shop) => shop.name).join(", "));
  assert.deepEqual(second.stock, [LANTERN, ROPE]);
  assert.deepEqual(getShop(tableShop.id).stock, [ROPE], "the copy touched the played shop");
});

await test("a due restock refills the authored shelf; a pack restock with no pack keeps what is there", async () => {
  updateShop(tableShop.id, { restockDays: 3 });
  const pool = insertShop(campaignId, {
    name: "Harbour Sundries",
    locationId: tableShop.locationId,
    locationName: "The Harbour",
    stock: [{ itemName: "Torch", qty: 4, priceCp: 1, note: "" }],
    restockDays: 1,
    restockedAt: getClock(campaignId).instant,
  });
  assert.equal(pool.preparedStock, null, "a shop stocked from the pack has no authored shelf");
  setClockInstant(campaignId, getClock(campaignId).instant + 4 * MINUTES_PER_DAY);
  shopsBlock(getCampaignById(campaignId));
  assert.deepEqual(getShop(tableShop.id).stock, [LANTERN, ROPE], "the restock did not refill the authored shelf");
  assert.deepEqual(getShop(tableShop.id).haggledBy, [], "a restock is a new visit: the haggles reset");
  assert.deepEqual(getShop(pool.id).stock, [{ itemName: "Torch", qty: 4, priceCp: 1, note: "" }], "a restock with nothing to draw on emptied the shelf");
});

await test("open_shop at another place makes one shop there, not one per call", async () => {
  upsertCurrentLocation({ campaignId, name: "Gull Point" });
  const campaign = getCampaignById(campaignId);
  handleOpenShop(campaign, JSON.stringify({ name: "Harbour Sundries", kind: "general" }));
  handleOpenShop(campaign, JSON.stringify({ name: "Harbour Sundries", kind: "general" }));
  assert.equal(listShops(campaignId).filter((shop) => shop.name === "Harbour Sundries").length, 2);
});

// ---- who may prepare a shop ----

await test("the lead of an AI-narrated table prepares shops; an ordinary player cannot", async () => {
  as(author);
  const listed = await call(shopsRoute, "GET", undefined, { campaignId });
  assert.equal(listed.json.canPrep, true);
  const made = await call(shopsRoute, "POST", { name: "The Tide Market", stockFromPack: false, locationId: tableShop.locationId }, { campaignId });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const stocked = await call(shopRoute, "PATCH", { stock: [LANTERN] }, { campaignId, shopId: made.json.shop.id });
  assert.equal(stocked.status, 200, JSON.stringify(stocked.json));
  as(player);
  assert.equal((await call(shopsRoute, "GET", undefined, { campaignId })).json.canPrep, false);
  assert.equal((await call(shopsRoute, "POST", { name: "Mine now" }, { campaignId })).status, 403);
  assert.equal((await call(shopRoute, "PATCH", { stock: [] }, { campaignId, shopId: made.json.shop.id })).status, 403);
  assert.equal((await call(shopRoute, "DELETE", undefined, { campaignId, shopId: made.json.shop.id })).status, 403);
  as(stranger);
  assert.equal((await call(shopsRoute, "POST", { name: "Not my table" }, { campaignId })).status, 404);
  as(author);
  assert.equal((await call(shopRoute, "DELETE", undefined, { campaignId, shopId: made.json.shop.id })).status, 200);
});

await test("at a table a person runs, the lead is a player and the DM seat holds the Market", async () => {
  as(stranger);
  const human = await call(campaignsRoute, "POST", { title: "A run table", gameSettings: { dmMode: "human" } });
  assert.equal(human.status, 201, JSON.stringify(human.json));
  const humanId = human.json.campaign.id;
  db.prepare(`INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at) VALUES (?, ?, 'player', 0, ?)`).run(humanId, player.id, nowIso());
  db.prepare(`UPDATE campaigns SET party_lead_user_id = ?, human_dm_user_id = ? WHERE id = ?`).run(player.id, stranger.id, humanId);
  as(player);
  assert.equal((await call(shopsRoute, "POST", { name: "Lead's shop" }, { campaignId: humanId })).status, 403);
  as(stranger);
  assert.equal((await call(shopsRoute, "POST", { name: "DM's shop", stockFromPack: false }, { campaignId: humanId })).status, 200);
});

// ---- the other doors prep goes through ----

await test("a cloned workshop keeps its Market, linked to the clone's own place and keeper", async () => {
  const clone = cloneCampaign(author.id, workshop.id).campaign;
  const [shop] = listShops(clone.id);
  assert.ok(shop, "the clone lost its Market");
  assert.equal(shop.locationId, copyOf(clone.id, "locations", harbour));
  assert.equal(shop.keeperNpcId, copyOf(clone.id, "npcs", marla));
  assert.deepEqual(shop.stock, [LANTERN, ROPE]);
});

removeTempDir(dir);
console.log(`workshop market: ${passed} checks passed.`);
