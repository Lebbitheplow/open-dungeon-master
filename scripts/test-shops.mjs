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
  BAD_FAILURE_MARGIN,
  dealFor,
  dealInWords,
  findStockLine,
  haggledIds,
  haggleSteps,
  markupFor,
  normalizeHaggles,
  normalizeHaggleSkill,
  offerPriceCp,
  renderShopsForPrompt,
  restockDue,
  shiftMarkup,
  stepMoves,
  stockFromPool,
  takeStock,
} = await import("../src/lib/dm/shop-logic.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { insertShop, getShop, listShops } = await import("../src/lib/db/shops.ts");
const { handleBuyItem, handleSellItem, handleHaggle, stockPool } = await import("../src/lib/dm/shop-tools.ts");
const { bonusItemValue, magicItemValueCp } = await import("../src/lib/srd/magic-item-value.ts");
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

test("a haggle walks the ladder by steps and never off it; no step leaves the markup as it was", () => {
  assert.equal(shiftMarkup(1, -1), 0.9);
  assert.equal(shiftMarkup(1, 1), 1.1);
  assert.equal(shiftMarkup(1, 2), 1.25);
  assert.equal(shiftMarkup(0.8, -1), 0.8);
  assert.equal(shiftMarkup(2, 1), 2);
  assert.equal(shiftMarkup(1.5, 2), 2);
  assert.equal(shiftMarkup(1.2, 0), 1.2, "held firm keeps an off-ladder markup exactly");
});

test("at an end of the ladder a deal is said as the end it stopped at, never as a step it did not take", () => {
  assert.equal(dealInWords(1, -1), "a step lower");
  assert.equal(dealInWords(1, 1), "a step higher");
  assert.equal(dealInWords(1.25, 2), "two steps higher");
  assert.equal(dealInWords(1.1, 0), "unchanged");
  assert.equal(dealInWords(0.8, -1), "already at their lowest");
  assert.equal(dealInWords(2, 1), "already at their highest");
  assert.equal(dealInWords(2, 2), "already at their highest");
  assert.equal(dealInWords(1.5, 2), "a step higher, as high as they go");
  assert.equal(stepMoves(0.8, -1), false);
  assert.equal(stepMoves(0.85, -1), true, "an off-ladder price still drops to the bottom rung");
  const shelf = { name: "Cheap Jack's", keeperName: "", kind: "general", buys: true, stock: [], markup: 0.8 };
  const block = renderShopsForPrompt(
    [
      { ...shelf, haggles: [{ ids: ["ann"], steps: -1, skill: "persuasion" }] },
      { ...shelf, name: "Dear Jack's", markup: 2, haggles: [{ ids: ["bo"], steps: 1, skill: "persuasion" }] },
    ],
    (id) => ({ ann: "Ann", bo: "Bo" })[id],
  );
  assert.match(block, /Haggled: Ann pay these prices \(already at their lowest\)/);
  assert.match(block, /Haggled: Bo pay these prices \(already at their highest\)/);
  assert.doesNotMatch(block, /pay prices a step/);
});

test("a won haggle is a step down, a failure holds, a failure by 5 or more is a step up (two for Intimidation)", () => {
  assert.equal(BAD_FAILURE_MARGIN, 5);
  for (const skill of ["persuasion", "intimidation", "deception"]) {
    assert.equal(haggleSteps(skill, 15, 15), -1, `${skill} meets the DC`);
    assert.equal(haggleSteps(skill, 11, 15), 0, `${skill} misses by 4`);
  }
  assert.equal(haggleSteps("persuasion", 10, 15), 1, "misses by 5");
  assert.equal(haggleSteps("deception", 1, 15), 1);
  assert.equal(haggleSteps("intimidation", 10, 15), 2);
  assert.equal(normalizeHaggleSkill(" Intimidation "), "intimidation");
  assert.equal(normalizeHaggleSkill("bribery"), null);
});

test("a haggle's price is for the characters it names; everyone else pays the shop's own", () => {
  const shop = { markup: 1.1, haggles: normalizeHaggles([{ ids: ["ann", "bo"], steps: -1, skill: "persuasion" }, { ids: ["cy"], steps: 2, skill: "intimidation" }, "old-id"]) };
  assert.equal(markupFor(shop, "ann"), 1);
  assert.equal(markupFor(shop, "bo"), 1);
  assert.equal(markupFor(shop, "cy"), 1.5);
  assert.equal(markupFor(shop, "old-id"), 1.1, "a haggle stored as a bare id used its try at the shop's price");
  assert.equal(markupFor(shop, "dee"), 1.1);
  assert.equal(markupFor(shop, null), 1.1);
  assert.equal(dealFor(shop, "dee"), null);
  assert.deepEqual(haggledIds(shop.haggles), ["ann", "bo", "cy", "old-id"]);
  assert.deepEqual(normalizeHaggles([{ ids: [], steps: 1 }, { ids: ["x", "x"], steps: 9, skill: "bribery" }, 3]), [{ ids: ["x"], steps: 2, skill: "persuasion" }]);
});

test("stock lines are found by their whole name, taken down and put back with the row they are", () => {
  const stock = [
    { itemName: "Torch", qty: 5, priceCp: 1, note: "" },
    { itemName: "Hooded Lantern", qty: 1, priceCp: 500, note: "" },
  ];
  assert.equal(findStockLine(stock, "torch").itemName, "Torch");
  assert.equal(findStockLine(stock, "hooded lantern").itemName, "Hooded Lantern");
  assert.equal(findStockLine(stock, "lantern"), null);
  assert.equal(findStockLine(stock, "sword"), null);
  // A line renamed into the table's language answers to its row as well.
  const shelf = [...stock, { itemName: "Spada lunga", qty: 1, priceCp: 1500, note: "", srdName: "Longsword" }];
  assert.equal(findStockLine(shelf, "longsword").itemName, "Spada lunga");
  assert.equal(findStockLine(shelf, "SPADA LUNGA").itemName, "Spada lunga");
  assert.equal(findStockLine(shelf, "spada"), null);
  assert.equal(findStockLine(shelf, "long sword"), null);
  assert.equal(takeStock(stock, "Torch", 6), null);
  assert.deepEqual(takeStock(stock, "Hooded Lantern", 1).map((line) => line.itemName), ["Torch"]);
  assert.equal(addStock(stock, "torch", 2, 1)[0].qty, 7);
  assert.equal(addStock(stock, "Rope", 1, 100).length, 3);
  assert.equal(addStock(stock, "Corda di canapa", 1, 100, "Rope, hempen (50 feet)")[2].srdName, "Rope, hempen (50 feet)");
});

test("stocking from a pool sizes the shelf to the settlement", () => {
  const pool = Array.from({ length: 40 }, (_, index) => ({ name: `Thing ${index}`, cost: `${index + 1} gp` }));
  let seed = 1;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  assert.equal(stockFromPool(pool, "hamlet", random).length, 6);
  assert.equal(stockFromPool(pool, "city", random).length, 24);
  assert.equal(stockFromPool([{ name: "Free", cost: "" }], "city", random).length, 0);
});

test("a general store always carries the everyday basics, one line each, ahead of what the dice pick", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pool = [
    ...Array.from({ length: 40 }, (_, index) => ({ name: `Thing ${index}`, cost: `${index + 1} gp` })),
    { name: "Torch", cost: "1 cp", staple: true },
    { name: "Rations", cost: "5 sp", staple: true },
  ];
  const shelf = stockFromPool(pool, "hamlet", random);
  assert.deepEqual(shelf.slice(0, 2).map((line) => line.itemName), ["Rations", "Torch"]);
  assert.equal(shelf.length, 8, "the staples come beside the hamlet's six lines");
  // From the pack itself, when the runner has it.
  const staples = stockPool("general").filter((item) => item.staple).map((item) => item.name);
  if (staples.length) {
    assert.ok(staples.includes("Torch"), staples.join(", "));
    assert.equal(staples.filter((name) => /^rations/i.test(name)).length, 1, "one line of rations across the pack's two editions");
    assert.ok(!staples.some((name) => /taggit|silk/i.test(name)), staples.join(", "));
    assert.deepEqual(stockPool("smith").filter((item) => item.staple), [], "only the general store has staples");
    // Every page of the pack, not the first 200 rows by name, and none of
    // what a general store never sells.
    const general = stockPool("general").map((item) => item.name);
    assert.ok(general.includes("Waterskin") && general.includes("Whetstone"), "the pool stopped partway through the alphabet");
    assert.ok(!general.some((name) => /^(camel|galley|warship|cow|cinnamon|assassin's blood|airship)$/i.test(name)), general.join(", "));
  }
});

test("a magic item is priced by its rarity under the 2014 rules: the top of each value band, a consumable half, nothing legendary for sale", () => {
  const value = (name, rarity, category) => magicItemValueCp({ name, rarity, category });
  assert.equal(value("Cloak of Protection", "uncommon", "wondrous item"), 50000);
  assert.equal(value("Potion of Climbing", "common", "potion"), 5000, "a consumable is worth half");
  assert.equal(value("Ammunition +1", "uncommon", "weapon"), 25000, "ammunition is a consumable");
  assert.equal(value("Plate Armor +1", "rare", "armor (plate)"), 500000, "+1 plate is rare, with nothing added for the plate");
  assert.equal(value("Ring of Regeneration", "Very Rare ", "ring"), 5000000);
  assert.equal(value("Staff of the Magi", "legendary", "staff"), null, "a legendary item has no price");
  assert.equal(value("Vorpal Sword", "legendary", "weapon (any sword)"), null, "which sword it is was left open");
  assert.equal(value("Belt of Giant Strength", "rarity varies", "wondrous item"), null);
  assert.equal(value("Spell Scroll", "common", "scroll"), null, "a scroll is priced by a spell level the row does not give");
  assert.equal(value("Scroll of Conjuring", "uncommon", "scroll"), 25000, "a scroll that holds no spell is its own rarity, as a consumable");
  assert.equal(value("Spell Scroll (Fireball)", "", "scroll"), 25000, "a 3rd-level scroll is uncommon (SRD 5.1, Spell Scroll)");
  assert.equal(value("Spell Scroll (Wish)", "", "scroll"), null, "a 9th-level scroll is legendary");
  assert.equal(value("Orb of Dragonkind", "artifact", "wondrous item"), null);
  assert.deepEqual(bonusItemValue("armor", 1), { cp: 500000, rarity: "rare" }, "+1 plate");
  assert.deepEqual(bonusItemValue("weapon", 3), { cp: 5000000, rarity: "very rare" }, "+3 longsword");
  assert.deepEqual(bonusItemValue("shield", 2), { cp: 500000, rarity: "rare" }, "+2 shield");
  assert.equal(bonusItemValue("armor", 3), null, "+3 armor is legendary");
  assert.equal(bonusItemValue("weapon", 4), null);
});

test("a curiosity shop stocks common magic items in any settlement, and nothing rarer by chance (SRD 5.1, Selling Treasure)", () => {
  let seed = 3;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pool = ["common", "uncommon", "rare", "very rare"].flatMap((rarity) =>
    Array.from({ length: 30 }, (_, index) => ({ name: `${rarity} ${index}`, cost: "100 gp", rarity })),
  );
  const village = stockFromPool(pool, "village", random);
  assert.equal(village.length, 10);
  assert.ok(village.every((line) => line.itemName.startsWith("common ")), village.map((line) => line.itemName).join(", "));
  const city = stockFromPool(pool, "city", random).map((line) => line.itemName);
  assert.equal(city.length, 24);
  assert.ok(city.every((name) => name.startsWith("common ")), city.join(", "));
  // From the pack itself, when the runner has it.
  const curiosities = stockPool("curiosities");
  if (curiosities.length) {
    const shelf = stockFromPool(curiosities, "village");
    assert.equal(shelf.length, 10, "the village shop opened with bare shelves");
    assert.ok(shelf.every((line) => line.priceCp === 5000 || line.priceCp === 10000), shelf.map((line) => `${line.itemName} ${line.priceCp}`).join(", "));
    assert.ok(stockFromPool(curiosities, "city").every((line) => line.priceCp <= 10000), "commons only");
    assert.equal(curiosities.find((item) => item.name === "Potion of Healing")?.cost, "5000 cp", "a potion of healing at the 50 gp the gear list asks");
    const apothecary = stockPool("apothecary").map((item) => item.name);
    assert.ok(apothecary.includes("Potion of Climbing"), apothecary.join(", "));
    assert.ok(!apothecary.some((name) => /periapt|almanac/i.test(name)), apothecary.join(", "));
  }
});

test("restock comes due by the clock", () => {
  assert.equal(restockDue({ restockDays: 7, restockedAt: 0 }, 6 * 1440, 1440), false);
  assert.equal(restockDue({ restockDays: 7, restockedAt: 0 }, 7 * 1440, 1440), true);
  assert.equal(restockDue({ restockDays: 0, restockedAt: 0 }, 99999, 1440), false);
});

test("the pack's pool offers each item once, so a shelf never holds two lines of one name", () => {
  // Empty on a runner without the content pack, which proves nothing either way.
  for (const kind of ["general", "smith", "curiosities"]) {
    const names = stockPool(kind).map((item) => item.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${kind}: ${names.length - new Set(names).size} names twice`);
  }
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
    { itemName: "Pozione di guarigione", qty: 1, priceCp: 50, note: "", srdName: "Potion of Healing" },
  ],
});

test("buying takes the coin and the goods together and writes the ledger", () => {
  const result = handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: "marla's sundries", item: "rope, hempen (50 feet)", qty: 1 }));
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = getSheetById(marla.id);
  assert.equal(after.gold, 9);
  assert.ok(after.equipment.some((item) => /rope/i.test(item.name)));
  assert.equal(getShop(shop.id).stock.find((line) => /rope/i.test(line.itemName)).qty, 1);
  assert.ok(listRecentAudit(campaign.id).some((entry) => entry.kind === "purchase" && entry.characterId === marla.id));
  // A shelf line listed as a row is bought as that row.
  const potion = handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Pozione di guarigione" }));
  assert.equal(potion.ok, true);
  assert.match(potion.note, /The trade is done: the server put it in Marla's pack and took the coin, and nothing else changed hands\. Do NOT call grant_item, modify_gold or handle_item for this trade\./);
  assert.equal(getSheetById(marla.id).equipment.find((item) => item.name === "Pozione di guarigione")?.srdName, "Potion of Healing");
  // A word of a shop's or a line's name is neither.
  assert.equal(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: "sundries", item: "Plate Armor" })).retry, true);
  assert.match(String(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "rope" })).error), /does not stock "rope"/);
});

test("the purse and the shelf refuse what they cannot cover", () => {
  assert.match(String(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Plate Armor" })).error), /cannot afford/);
  assert.match(String(handleBuyItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Rope, Hempen (50 feet)", qty: 5 })).error), /only 1/);
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
  // A name nobody knows is the call's to fix, from what she carries; one the
  // rules know that she lacks is the game saying no.
  const unknown = handleSellItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Unicorn tear" }));
  assert.equal(unknown.retry, true, JSON.stringify(unknown));
  assert.match(String(unknown.error), /carries nothing called "Unicorn tear".*They carry: /);
  const lacking = handleSellItem(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, item: "Longsword" }));
  assert.equal(lacking.refused, "rules", JSON.stringify(lacking));
  assert.match(String(lacking.error), /does not carry "Longsword"/);
});

test("a keeper buys back a potion or a scroll at half its value, and no other magic item (SRD 5.1, Selling Treasure)", () => {
  if (!stockPool("curiosities").length) {
    return; // the rarity comes from the content pack
  }
  const owner = createUser("wren", "x");
  const carried = [
    { name: "Potion of Climbing", qty: 1 },
    { name: "Pozione di scalata", srdName: "Potion of Climbing", qty: 1 },
    { name: "Cloak of Protection", qty: 1 },
    { name: "Ring of Regeneration", qty: 1 },
  ];
  const wren = createSheet(campaign.id, owner.id, 3, sheetInput("Wren", carried, 0));
  const odd = insertShop(campaign.id, { name: "Odd Lots", kind: "curiosities", size: "village", markup: 1, stock: [] });
  const sold = handleSellItem(campaign, JSON.stringify({ characterId: wren.id, shop: odd.id, item: "Potion of Climbing" }));
  assert.equal(sold.ok, true, JSON.stringify(sold));
  assert.equal(getSheetById(wren.id).gold, 25, "half the 50 gp a common potion is worth");
  assert.equal(getShop(odd.id).stock.find((line) => line.itemName === "Potion of Climbing").priceCp, 5000);
  // A potion named in the table's language sells as the row its srdName names.
  const named = handleSellItem(campaign, JSON.stringify({ characterId: wren.id, shop: odd.id, item: "Pozione di scalata" }));
  assert.equal(named.ok, true, JSON.stringify(named));
  assert.equal(getSheetById(wren.id).gold, 50);
  const city = insertShop(campaign.id, { name: "The Gilded Owl", kind: "curiosities", size: "city", markup: 1, stock: [] });
  for (const item of ["Cloak of Protection", "Ring of Regeneration"]) {
    for (const where of [odd, city]) {
      const refused = handleSellItem(campaign, JSON.stringify({ characterId: wren.id, shop: where.id, item, priceCp: 100 }));
      assert.equal(refused.refused, "rules", JSON.stringify(refused));
      assert.match(String(refused.error), /only one of the wealthiest nobles/);
    }
  }
  assert.equal(getSheetById(wren.id).equipment.length, 2, "a refused sale took something");
});

test("a haggle leaves the shop's own markup alone, is one try per character, and is shared with who was present", () => {
  const before = getShop(shop.id).markup;
  const result = handleHaggle(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, present: ["Pike"] }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.for, ["Marla", "Pike"]);
  assert.match(result.outcome, /Anyone else pays the shop's normal price/);
  const after = getShop(shop.id);
  assert.equal(after.markup, before, "the shop's own price did not move");
  assert.deepEqual(after.haggles, [{ ids: [marla.id, pike.id], steps: result.steps, skill: "persuasion" }]);
  assert.match(String(handleHaggle(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id })).error), /already tried/);
  assert.match(String(handleHaggle(campaign, JSON.stringify({ characterId: pike.id, shop: shop.id })).error), /already tried/, "a companion at the counter used their try");
  assert.equal(handleHaggle(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, present: ["Nobody"] })).retry, true);
  assert.equal(handleHaggle(campaign, JSON.stringify({ characterId: marla.id, shop: shop.id, skill: "bribery" })).retry, true);
});

test("the prompt block names the shop, its prices, and who haggled there", () => {
  const names = { [marla.id]: "Marla", [pike.id]: "Pike" };
  const block = renderShopsForPrompt(listShops(campaign.id).map((entry) => ({ ...entry, keeperName: "" })), (id) => names[id] ?? id);
  assert.match(block, /SHOPS HERE/);
  assert.match(block, /only for the characters it names/);
  assert.match(block, /Marla's Sundries/);
  assert.match(block, /Plate Armor x1 at/);
  assert.match(block, /Haggled: Marla and Pike pay /);
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
