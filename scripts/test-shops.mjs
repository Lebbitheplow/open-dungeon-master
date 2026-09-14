// Shops (docs/vtt-parity-implementation-plan.md 11.1) and trades (11.2):
// the server prices from the pack's cost strings with the settlement's
// markup, the purse and the shelf clamp what can be had, a haggle walks
// the markup a step, restock comes due by the clock, and a trade moves
// both sheets at once or not at all.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-shops-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const {
  addStock,
  askingPriceCp,
  costToCopper,
  findStockLine,
  haggleStep,
  offerPriceCp,
  renderShopsForPrompt,
  restockDue,
  stockFromPool,
  takeStock,
} = await import("../src/lib/dm/shop-logic.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { insertShop, getShop, listShops } = await import("../src/lib/db/shops.ts");
const { handleBuyItem, handleSellItem, handleHaggle } = await import("../src/lib/dm/shop-tools.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const { computeTrade, normalizeTradeOffer, tradeSummary, canResolveTrade } = await import("../src/lib/dm/trade-logic.ts");
const { applyTrade } = await import("../src/lib/dm/trade.ts");
const { insertItemProposal } = await import("../src/lib/db/item-proposals.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("pack costs read into copper and prices follow the markup", () => {
  assert.equal(costToCopper("15 gp"), 1500);
  assert.equal(costToCopper("2 sp"), 20);
  assert.equal(costToCopper("5,000 gp"), 500000);
  assert.equal(costToCopper(""), null);
  assert.equal(askingPriceCp(1500, 1.1), 1650);
  assert.equal(askingPriceCp(1, 0.8), 1);
  assert.equal(offerPriceCp(1500), 750);
  assert.equal(offerPriceCp(1), 1);
});

test("a haggle walks the ladder a step either way and never off it", () => {
  assert.equal(haggleStep(1, true), 0.9);
  assert.equal(haggleStep(1, false), 1.1);
  assert.equal(haggleStep(0.8, true), 0.8);
  assert.equal(haggleStep(2, false), 2);
});

test("stock lines are found loosely, taken down and put back", () => {
  const stock = [
    { itemName: "Torch", qty: 5, priceCp: 1, note: "" },
    { itemName: "Hooded Lantern", qty: 1, priceCp: 500, note: "" },
  ];
  assert.equal(findStockLine(stock, "torch").itemName, "Torch");
  assert.equal(findStockLine(stock, "lantern").itemName, "Hooded Lantern");
  assert.equal(findStockLine(stock, "sword"), null);
  assert.equal(takeStock(stock, "Torch", 6), null);
  assert.deepEqual(takeStock(stock, "Hooded Lantern", 1).map((line) => line.itemName), ["Torch"]);
  assert.equal(addStock(stock, "torch", 2, 1)[0].qty, 7);
  assert.equal(addStock(stock, "Rope", 1, 100).length, 3);
});

test("stocking from a pool sizes the shelf to the settlement", () => {
  const pool = Array.from({ length: 40 }, (_, index) => ({ name: `Thing ${index}`, cost: `${index + 1} gp` }));
  let seed = 1;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  assert.equal(stockFromPool(pool, "hamlet", random).length, 6);
  assert.equal(stockFromPool(pool, "city", random).length, 24);
  assert.equal(stockFromPool([{ name: "Free", cost: "" }], "city", random).length, 0);
});

test("restock comes due by the clock", () => {
  assert.equal(restockDue({ restockDays: 7, restockedAt: 0 }, 6 * 1440, 1440), false);
  assert.equal(restockDue({ restockDays: 7, restockedAt: 0 }, 7 * 1440, 1440), true);
  assert.equal(restockDue({ restockDays: 0, restockedAt: 0 }, 99999, 1440), false);
});

const dm = createUser("dm", "x");
const player = createUser("marla", "x");
const other = createUser("pike", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
const sheetInput = (name, equipment, gold) =>
  createSheetSchema.parse({
    name,
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 16 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 3, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["persuasion"], languages: [], tools: [], armor: [], weapons: [] },
    equipment,
    gold,
  });
const marla = createSheet(campaign.id, player.id, 3, sheetInput("Marla", [{ name: "Torch", qty: 3 }, { name: "Longsword", qty: 1 }], 10));
const pike = createSheet(campaign.id, other.id, 3, sheetInput("Pike", [{ name: "Rope", qty: 1 }], 2));
const shop = insertShop(campaign.id, {
  name: "Marla's Sundries",
  kind: "general",
  size: "village",
  markup: 1,
  stock: [
    { itemName: "Rope, Hempen (50 feet)", qty: 2, priceCp: 100, note: "" },
    { itemName: "Plate Armor", qty: 1, priceCp: 150000, note: "" },
  ],
});

test("buying takes the coin and the goods together and writes the ledger", () => {
  const result = handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: "sundries", item: "rope", qty: 1 }));
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = getSheetById(marla.id);
  assert.equal(after.gold, 9);
  assert.ok(after.equipment.some((item) => /rope/i.test(item.name)));
  assert.equal(getShop(shop.id).stock.find((line) => /rope/i.test(line.itemName)).qty, 1);
  assert.ok(listRecentAudit(campaign.id).some((entry) => entry.kind === "purchase" && entry.characterId === marla.id));
});

test("the purse and the shelf refuse what they cannot cover", () => {
  assert.match(String(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "plate" })).error), /cannot afford/);
  assert.match(String(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "rope", qty: 5 })).error), /only 1/);
  assert.match(String(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "dragon" })).error), /does not stock/);
});

test("selling pays half list for a known item and restocks the shelf", () => {
  // priceCp is the fallback for a runner without the content pack; with the pack the list price wins.
  const result = handleSellItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Longsword", priceCp: 750 }));
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = getSheetById(marla.id);
  assert.ok(after.gold > 9, "the sale paid nothing");
  assert.ok(!after.equipment.some((item) => item.name === "Longsword"));
  assert.ok(getShop(shop.id).stock.some((line) => line.itemName === "Longsword"));
  assert.match(String(handleSellItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Unicorn tear" })).error), /does not carry/);
});

test("a haggle moves the markup a step and is one try per character", () => {
  const result = handleHaggle(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id }));
  assert.equal(result.ok, true);
  assert.ok(result.markup === 0.9 || result.markup === 1.1, `markup ${result.markup}`);
  assert.equal(getShop(shop.id).markup, result.markup);
  assert.match(String(handleHaggle(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id })).error), /already tried/);
});

test("the prompt block names the shop and its prices", () => {
  const block = renderShopsForPrompt(listShops(campaign.id).map((entry) => ({ ...entry, keeperName: "" })));
  assert.match(block, /SHOPS HERE/);
  assert.match(block, /Marla's Sundries/);
  assert.match(block, /Plate Armor x1 at/);
  assert.equal(renderShopsForPrompt([]), "");
});

test("a trade offer normalises and reads aloud", () => {
  assert.equal(normalizeTradeOffer({ toCharacterId: pike.id }), null);
  const offer = normalizeTradeOffer({ toCharacterId: pike.id, give: [{ name: "Torch", qty: 2 }], giveCp: 100, want: [{ name: "Rope", qty: 1 }], wantCp: 0 });
  assert.equal(offer.give[0].qty, 2);
  assert.equal(tradeSummary(offer, "Marla", "Pike"), "Marla offers Torch x2, 1 gp to Pike for Rope");
  assert.equal(canResolveTrade("approve", true, false, false), false);
  assert.equal(canResolveTrade("approve", false, true, false), true);
  assert.equal(canResolveTrade("decline", true, false, false), true);
  assert.equal(canResolveTrade("cancel", false, true, false), false);
  assert.equal(canResolveTrade("cancel", false, false, true), true);
});

test("a trade moves both sheets at once, or not at all", () => {
  const offer = normalizeTradeOffer({ toCharacterId: pike.id, give: [{ name: "Torch", qty: 2 }], giveCp: 100, want: [{ name: "Rope", qty: 1 }], wantCp: 50 });
  const from = getSheetById(marla.id);
  const to = getSheetById(pike.id);
  const computed = computeTrade(from, to, offer);
  assert.ok(!("error" in computed), computed.error);
  assert.equal(computed.from.equipment.find((item) => item.name === "Torch").qty, 1);
  assert.ok(computed.from.equipment.some((item) => item.name === "Rope"));
  assert.equal(computed.to.equipment.find((item) => item.name === "Torch").qty, 2);
  assert.equal(computed.to.gold * 100 + computed.to.copper, 250);
  assert.equal(computed.from.gold * 100 + computed.from.copper, from.gold * 100 + from.copper - 50);
  assert.match(computeTrade(from, to, normalizeTradeOffer({ toCharacterId: pike.id, give: [{ name: "Torch", qty: 9 }] })).error, /no longer carries/);
  assert.match(computeTrade(from, to, normalizeTradeOffer({ toCharacterId: pike.id, wantCp: 100000 })).error, /does not have/);
});

test("an accepted trade lands on both sheets with an audit row each", () => {
  const offer = normalizeTradeOffer({ toCharacterId: pike.id, give: [{ name: "Torch", qty: 1 }], want: [{ name: "Rope", qty: 1 }] });
  const proposal = insertItemProposal({ campaignId: campaign.id, turnId: null, characterId: marla.id, userId: player.id, toolName: "trade", argsJson: JSON.stringify(offer), summary: "x", reason: "", seq: 1, toCharacterId: pike.id });
  assert.equal(proposal.toCharacterId, pike.id);
  const applied = applyTrade(campaign, proposal);
  assert.equal(applied.ok, true, applied.error);
  assert.ok(getSheetById(marla.id).equipment.some((item) => item.name === "Rope"));
  assert.ok(getSheetById(pike.id).equipment.some((item) => item.name === "Torch"));
  const trades = listRecentAudit(campaign.id).filter((entry) => entry.kind === "trade");
  assert.equal(trades.length, 2);
  // Pike no longer has a rope: the same offer now fails whole.
  assert.match(applyTrade(campaign, proposal).error, /does not carry/);
});

console.log(`shops: ${passed} tests passed`);
removeTempDir(dir);
