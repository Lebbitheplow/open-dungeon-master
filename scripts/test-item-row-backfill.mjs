// Items saved before names were read whole keep the weapon or armor the
// words of their English name gave them: one pass at boot writes that row as
// srdName on every stored line no row answers to now (a sheet, a library
// character, the party's pack, what lies on the ground, a shelf, a chapter a
// rewind brings back, a grant awaiting its player), and leaves every other
// line as it was: a line with its own tags, and an unidentified one, whose
// name is a description at any table.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-item-row-backfill");
const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");
const { backfillLegacyItemRows } = await import("../src/lib/db/item-row-backfill.ts");
const { insertDroppedItem, listDroppedItems } = await import("../src/lib/db/dropped-items.ts");
const { insertShop, getShop } = await import("../src/lib/db/shops.ts");
const { insertItemProposal, getItemProposal } = await import("../src/lib/db/item-proposals.ts");
const { revealItemMath } = await import("../src/lib/dm/mutation-math.ts");
const { armorOfRow } = await import("../src/lib/srd/armor.ts");
const { rowName } = await import("../src/lib/srd/item-row.ts");
const db = getDatabase();

// An English name the old reading read a row out of, and what it read.
const OLD = [
  ["Silvered Longsword", "Longsword"],
  ["Steel Shield", "Shield"],
  ["Elven Longbow", "Longbow"],
  ["Dwarven Chain Mail", "Chain Mail"],
];
// Lines that keep no srdName: a row by their whole name already, a magic
// row, a name no word of which is a weapon or armor, ammunition, a line
// that names its row, and the table's own names.
const KEPT = [
  { name: "Longsword", qty: 1 },
  { name: "Bag of Holding", qty: 1 },
  { name: "Rope, hempen (50 feet)", qty: 1 },
  { name: "Arrows", qty: 20 },
  { name: "Spada lunga", srdName: "Longsword", qty: 1 },
  { name: "Spada lunga", qty: 1 },
  // What a line says it is by itself: its own tags, or that it is not yet
  // known (its name is the party's description, at every table).
  { name: "Club soda", qty: 1, tags: ["consumable"] },
  { name: "a gleaming chain shirt", qty: 1, identified: false },
  { name: "una cotta di maglia lucente", qty: 1, identified: false },
  { name: "une cotte de mailles brillante", qty: 1, identified: false },
  { name: "una cota de malla reluciente", qty: 1, identified: false },
  { name: "ein glänzendes Kettenhemd", qty: 1, identified: false },
  { name: "an ornate longsword", qty: 1, identified: false },
];
const lines = () => [...OLD.map(([name]) => ({ name, qty: 1 })), ...KEPT];
const expected = [...OLD.map(([name, srdName]) => ({ name, qty: 1, srdName })), ...KEPT];

await test("the pass ran once at boot and left its marker", () => {
  assert.ok(db.prepare(`SELECT key FROM app_settings WHERE key = 'item_row_backfill_done'`).get());
});

await test("a sheet, a library character, the party's pack, a dropped item and a shelf keep the row the old reading gave each line, and nothing else changes", () => {
  const hero = world.addHero({ name: "Old Timer", class: "fighter", level: 3 });
  db.prepare(`UPDATE character_sheets SET equipment_json = ? WHERE id = ?`).run(JSON.stringify(lines()), hero.id);
  db.prepare(
    `INSERT INTO library_characters (id, user_id, name, role, race, class, subclass, background, level, xp, sheet_json, workshop_id, created_at, updated_at)
     VALUES ('lib-1', ?, 'Old Timer', 'pc', 'human', 'fighter', '', '', 3, 0, ?, '', '', '')`,
  ).run(world.owner.id, JSON.stringify({ name: "Old Timer", equipment: lines() }));
  db.prepare(`UPDATE campaigns SET party_json = ? WHERE id = ?`).run(JSON.stringify({ gold: 0, inventory: lines() }), world.campaignId);
  insertDroppedItem({ campaignId: world.campaignId, mapId: null, x: null, y: null, place: "the road", item: { name: "Silvered Longsword", qty: 1 }, droppedBy: "a bandit" });
  const shop = insertShop(world.campaignId, { name: "Old Stock", kind: "general", stock: [] });
  db.prepare(`UPDATE shops SET stock_json = ? WHERE id = ?`).run(JSON.stringify([{ itemName: "Steel Shield", qty: 1, priceCp: 1000, note: "" }, { itemName: "Spada lunga", qty: 1, priceCp: 1500, note: "" }]), shop.id);

  backfillLegacyItemRows(db);

  const equipmentOf = (json) => JSON.parse(json);
  assert.deepEqual(equipmentOf(db.prepare(`SELECT equipment_json FROM character_sheets WHERE id = ?`).get(hero.id).equipment_json), expected);
  assert.deepEqual(JSON.parse(db.prepare(`SELECT sheet_json FROM library_characters WHERE id = 'lib-1'`).get().sheet_json).equipment, expected);
  assert.deepEqual(JSON.parse(db.prepare(`SELECT party_json FROM campaigns WHERE id = ?`).get(world.campaignId).party_json).inventory, expected);
  assert.equal(listDroppedItems(world.campaignId)[0].item.srdName, "Longsword");
  assert.deepEqual(getShop(shop.id).stock.map((line) => line.srdName ?? null), ["Shield", null]);

  // A second pass finds nothing left to change.
  const before = db.prepare(`SELECT equipment_json FROM character_sheets WHERE id = ?`).get(hero.id).equipment_json;
  backfillLegacyItemRows(db);
  assert.equal(db.prepare(`SELECT equipment_json FROM character_sheets WHERE id = ?`).get(hero.id).equipment_json, before);
});

await test("a chapter snapshot's sheets, shelves and party pack, and a grant or purchase awaiting its player, keep the same rows; a prepared shelf too; a blob no reader parses is left alone", () => {
  const hero = world.addHero({ name: "Snapshot Keeper", class: "fighter", level: 3 });
  const shopRow = { id: "snap-shop", campaign_id: world.campaignId, stock_json: JSON.stringify([{ itemName: "Steel Shield", qty: 1, priceCp: 1000, note: "" }]), prepared_stock_json: "" };
  const payload = {
    capturedAt: "",
    campaign: { party_json: JSON.stringify({ gold: 0, inventory: lines() }), scene: "" },
    tables: { character_sheets: [{ id: hero.id, equipment_json: JSON.stringify(lines()) }], shops: [shopRow], quests: [] },
    loreFlags: [],
    ruleFlags: [],
  };
  db.prepare(`INSERT INTO chapter_snapshots (id, campaign_id, chapter_index, boundary_seq, kind, snapshot_json, created_at) VALUES ('snap-1', ?, 1, 1, 'boundary', ?, '')`).run(world.campaignId, JSON.stringify(payload));
  db.prepare(`INSERT INTO chapter_snapshots (id, campaign_id, chapter_index, boundary_seq, kind, snapshot_json, created_at) VALUES ('snap-2', ?, 2, 2, 'boundary', '{not json', '')`).run(world.campaignId);
  const proposal = (toolName, args) => insertItemProposal({ campaignId: world.campaignId, turnId: null, characterId: hero.id, userId: world.owner.id, toolName, argsJson: JSON.stringify(args), summary: "", reason: "", seq: 1 });
  const grant = proposal("grant_item", { characterId: hero.id, name: "Silvered Longsword", reason: "the chest" });
  const buy = proposal("purchase", { characterId: hero.id, action: "buy", item: "Elven Longbow", reason: "the smith" });
  const sell = proposal("purchase", { characterId: hero.id, action: "sell", item: "Steel Shield", reason: "the smith" });
  const shop = insertShop(world.campaignId, { name: "Prepared Stock", kind: "general", stock: [] });
  db.prepare(`UPDATE shops SET prepared_stock_json = ? WHERE id = ?`).run(JSON.stringify([{ itemName: "Dwarven Chain Mail", qty: 1, priceCp: 7500, note: "" }]), shop.id);

  backfillLegacyItemRows(db);

  const stored = JSON.parse(db.prepare(`SELECT snapshot_json FROM chapter_snapshots WHERE id = 'snap-1'`).get().snapshot_json);
  assert.deepEqual(JSON.parse(stored.tables.character_sheets[0].equipment_json), expected);
  assert.deepEqual(JSON.parse(stored.campaign.party_json).inventory, expected);
  assert.deepEqual(JSON.parse(stored.tables.shops[0].stock_json).map((line) => line.srdName), ["Shield"]);
  assert.equal(stored.tables.shops[0].prepared_stock_json, "");
  assert.deepEqual(stored.tables.quests, []);
  assert.equal(db.prepare(`SELECT snapshot_json FROM chapter_snapshots WHERE id = 'snap-2'`).get().snapshot_json, "{not json");
  assert.equal(JSON.parse(getItemProposal(grant.id).argsJson).srdName, "Longsword");
  assert.equal(JSON.parse(getItemProposal(buy.id).argsJson).srdName, "Longbow");
  assert.equal(JSON.parse(getItemProposal(sell.id).argsJson).srdName, undefined);
  assert.deepEqual(JSON.parse(db.prepare(`SELECT prepared_stock_json FROM shops WHERE id = ?`).get(shop.id).prepared_stock_json).map((line) => line.srdName), ["Chain Mail"]);
});

await test("a line revealed under a new name is read by that name or the row sent with it, never a row it carried as a description, at every table", () => {
  const described = { name: "a gleaming chain shirt", qty: 1, equipped: true, identified: false, srdName: "Chain Shirt" };
  const english = revealItemMath([described], "a gleaming chain shirt", "Elven Chain").equipment[0];
  assert.equal(english.srdName, undefined);
  assert.equal(rowName(english), "Elven Chain");
  const worn = armorOfRow(english);
  assert.equal(worn?.armor.name, "Chain Shirt");
  assert.equal(worn?.bonus, 1);
  for (const name of ["Cotta di maglia elfica", "Cotte de mailles elfique", "Cota de malla élfica", "Elfenkettenhemd"]) {
    const revealed = revealItemMath([described], "a gleaming chain shirt", name, { srdName: "Elven Chain" }).equipment[0];
    assert.equal(revealed.srdName, "Elven Chain", name);
    assert.equal(armorOfRow(revealed)?.bonus, 1, name);
  }
  // Revealed under the same name, the line keeps what it carried.
  assert.equal(revealItemMath([described], "a gleaming chain shirt").equipment[0].srdName, "Chain Shirt");
});

await test("a real boot over stored lines runs the pass once, in a fresh process", () => {
  const hero = world.addHero({ name: "Boot Keeper", class: "fighter", level: 3 });
  db.prepare(`UPDATE character_sheets SET equipment_json = ? WHERE id = ?`).run(JSON.stringify(lines()), hero.id);
  db.prepare(`DELETE FROM app_settings WHERE key = 'item_row_backfill_done'`).run();
  db.pragma("wal_checkpoint(TRUNCATE)");
  execFileSync(process.execPath, [path.join(import.meta.dirname, "lib", "boot-db.mjs")], { env: process.env, stdio: "ignore" });
  assert.deepEqual(JSON.parse(db.prepare(`SELECT equipment_json FROM character_sheets WHERE id = ?`).get(hero.id).equipment_json), expected);
  assert.ok(db.prepare(`SELECT key FROM app_settings WHERE key = 'item_row_backfill_done'`).get());
});

finish();
