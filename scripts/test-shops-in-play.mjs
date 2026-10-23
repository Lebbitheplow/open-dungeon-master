// Shops in play: a party walking into a smithy finds the shop, not a list
// in the narration.
// - the players' words for a place that sells (smith, forge, stall, market)
//   offer the shop tools in a compact call, and unrelated words do not;
// - the rules tell the DM to open the shop before describing its wares and
//   never to price them in prose;
// - a shop opened or reopened where the party stands writes one "<shop> is
//   open" line for every seat, carrying the shop for the chat's Browse
//   wares, and only one per opening;
// - Browse wares goes to the Party tab's Market, at a desk and on a phone;
// - a sale nobody can price goes to the DM instead of failing.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-shops-in-play-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// The fallback stock is checked as a fresh server has it, with no content
// pack, whether or not this machine has one installed.
process.env.CONTENT_DB_PATH = path.join(dir, "no-content-pack.sqlite");

register("./lib/register-alias.mjs", import.meta.url);

const profiles = await import("../src/lib/dm/tool-profiles.ts");
const rules = await import("../src/lib/dm/prompt-rules.ts");
const { browseWares, phoneBarSplit, visiblePanelTabs } = await import("../src/lib/dm/table-tabs.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { handleOpenShop, handleSellItem, stockPool } = await import("../src/lib/dm/shop-tools.ts");
const { listShops } = await import("../src/lib/db/shops.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const NAMES = ["request_roll", "move_party", "grant_item", "purchase", "open_shop", "haggle", "travel"];
const offersShop = (playerText) => profiles.compactToolNames(NAMES, { inEncounter: false, englishPlayerText: playerText }, []).has("open_shop");

test("the words for a place that sells offer the shop tools", () => {
  for (const words of [
    "We head to the blacksmith.",
    "I visit the smith about my sword.",
    "Is there a weaponsmith in town?",
    "We step into the forge.",
    "I look for an armorer.",
    "I ask the armourer about mail.",
    "We wander the market stalls.",
    "Is there a general store?",
    "I visit the apothecary.",
    "We stop at the trading post.",
    "Find me a fletcher, I need arrows.",
    "The bazaar, then the herbalist.",
    "I check the vendors at the stand.",
    "We look for an outfitter or a provisioner.",
    "I visit the alchemist.",
    "I want to buy a longsword.",
    "I sold my pelts.",
  ]) {
    assert.ok(offersShop(words), `"${words}" offers open_shop`);
  }
});

test("unrelated words open no shop, and the match is word-bounded", () => {
  for (const words of [
    "I ask the innkeeper about the missing girl.",
    "We smash the door into smithereens.",
    "I search the storeroom.",
    "A standard greeting, then we sit.",
    "I read the marketing flyer.",
    "We follow the river north.",
  ]) {
    assert.ok(!offersShop(words), `"${words}" opens no shop`);
  }
});

test("the rules open the shop before its wares and keep prices out of prose", () => {
  // One clause of the bookkeeping rule every call carries, so it costs a
  // 16K window no line of its own.
  const rule = /call open_shop before describing a place's wares, never pricing them in prose/;
  assert.match(rules.DM_SYSTEM, rule, "the full rules carry it");
  const context = { inEncounter: false, groups: new Set(), caster: false, features: false, classFeatures: false, featSpells: false, dying: false, arc: false, recall: false, map: false, legendary: false };
  assert.match(rules.dmSystemText(false, context), rule, "a compact call carries it, shop group open or not");
  // One purchase call trades at a listed shop, from its shelf at its prices
  // (issue #471).
  assert.match(rules.DM_SYSTEM, /every purchase, sale, or trade goes through ONE purchase call \(at a shop in SHOPS HERE the shop trades from its shelf at its own prices/, "trading at a listed shop goes through purchase");
  // The short rules a small model plays on (PR #463) say it too: the model
  // that lists a smith's wares in prose is the small one.
  assert.match(rules.dmSystemText(false, { ...context, brief: true }), /call open_shop before you describe its wares, and never price them in prose/, "the short rules carry it");
});

const dm = createUser("dm", "x");
const player = createUser("marla", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
upsertCurrentLocation({ campaignId: campaign.id, name: "Oakhollow" });
const shopLines = () => listRecentMessages(campaign.id, 50).filter((message) => message.shopId);

test("a shop opening writes one line for every seat, carrying the shop", () => {
  const opened = handleOpenShop(campaign, JSON.stringify({ name: "Brann's Forge", kind: "smith", size: "village" }));
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const lines = shopLines();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].authorType, "system");
  assert.equal(lines[0].content, "Brann's Forge is open.");
  assert.equal(lines[0].glyph, "cue-coin");
  // The same call again with nothing said since is the same opening.
  assert.equal(handleOpenShop(campaign, JSON.stringify({ name: "Brann's Forge", kind: "smith" })).reopened, true);
  assert.equal(shopLines().length, 1, "no second line for the same opening");
});

test("with no content pack a shop stocks from the bundled SRD tables, magic left out", () => {
  // CONTENT_DB_PATH above names no file, as on a fresh server.
  const smith = stockPool("smith");
  assert.ok(smith.some((item) => item.name === "Longsword" && item.cost === "1500 cp"), "a longsword at its 15 gp list price");
  assert.ok(smith.some((item) => item.name === "Plate"), "armor too");
  assert.ok(!smith.some((item) => /pistol|kevlar|machete|hurled vial|silvered stake|monoblade/i.test(item.name)), "no setting weapons or genre armor");
  assert.ok(smith.some((item) => item.name === "Net") && smith.some((item) => item.name === "Club"), "the whole SRD weapon table");
  assert.ok(stockPool("general").some((item) => item.name === "Backpack"));
  assert.ok(stockPool("apothecary").some((item) => /antitoxin/i.test(item.name)));
  assert.ok(stockPool("outfitter").some((item) => /bedroll/i.test(item.name)));
  assert.deepEqual(stockPool("curiosities"), [], "magic items stay out");
  const forge = listShops(campaign.id).find((shop) => shop.name === "Brann's Forge");
  assert.ok(forge.stock.length > 0 && forge.stock.every((line) => line.priceCp > 0), "the forge opened with priced stock");
});

test("a later visit reopens the shop with a line of its own", () => {
  insertCampaignMessage({ campaignId: campaign.id, seq: 9000, authorType: "player", userId: player.id, content: "We leave, and come back tomorrow." });
  handleOpenShop(campaign, JSON.stringify({ name: "Brann's Forge", kind: "smith" }));
  const lines = shopLines();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].shopId, lines[1].shopId, "the same shop both times");
  handleOpenShop(campaign, JSON.stringify({ name: "Hilde's Herbs", kind: "apothecary" }));
  assert.equal(shopLines().length, 3, "another shop is another line");
});

test("Browse wares goes to the Party tab's Market, at a desk and on a phone", () => {
  const target = browseWares("shop-1", 42);
  assert.deepEqual(target, { tab: "party", section: "market", mobileView: "panel", request: { shopId: "shop-1", at: 42 } });
  assert.notDeepEqual(browseWares("shop-1", 43).request, target.request, "a second press is a second request");
  // Every seat has the Party tab, on the phone's bar or under More: the
  // bottom bar opens the same panel either way.
  for (const seat of [
    { adjudicates: false, isLead: false, secretStory: false },
    { adjudicates: false, isLead: true, secretStory: true },
    { adjudicates: true, isLead: true, secretStory: true },
  ]) {
    const tabs = visiblePanelTabs({ hasBattleMap: true, mapsEnabled: true, hasSettings: true, ...seat });
    assert.ok(tabs.includes(target.tab), `Party is offered to ${JSON.stringify(seat)}`);
    const { bar, more } = phoneBarSplit(tabs);
    assert.ok(bar.includes(target.tab) || more.includes(target.tab), "and reachable on a phone");
  }
});

test("a sale nobody can price goes to the keeper, not to a dead end", () => {
  const sheet = createSheet(
    campaign.id,
    player.id,
    3,
    createSheetSchema.parse({
      name: "Marla",
      race: "human",
      class: "fighter",
      abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 16 },
      maxHp: 12,
      ac: 16,
      hitDice: { die: "d10", total: 3, spent: 0 },
      proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
      equipment: [{ name: "Carved bone charm", qty: 1 }],
      gold: 1,
    }),
  );
  const refused = handleSellItem(campaign, JSON.stringify({ characterId: sheet.id, shop: "Brann's Forge", item: "Carved bone charm" }));
  assert.equal(refused.unpriced, true, JSON.stringify(refused));
  assert.equal(refused.retry, true, "the model still reads it as a call to fix with priceCp");
  const priced = handleSellItem(campaign, JSON.stringify({ characterId: sheet.id, shop: "Brann's Forge", item: "Carved bone charm", priceCp: 50 }));
  assert.equal(priced.ok, true, JSON.stringify(priced));
});

console.log(`shops in play: ${passed} tests passed`);
removeTempDir(dir);
