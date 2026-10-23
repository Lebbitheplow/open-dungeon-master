// What a Workshop entry is called, and what names it, through every door
// that moves or renames it (docs/workshop-creator-import-audit-2026-10-22.md
// F01, F02, F04, F05, F07 and the defects of the same family found with
// them), against a real database:
//
//   - a bundle whose subclass, spell, monster or item arrives renamed beside
//     the importer's own points its pregens, its subclass's spells, its roll
//     tables and its shelves at the arrivals, not at the importer's entries;
//   - a fight's roster that names one of the author's own monsters by id,
//     and a map pin that opens a lore entry, mean the same on arrival;
//   - "only what this workshop uses" follows what its tables, shelves and
//     kept entries name, a subclass's later spells included, and says what
//     nothing answers to;
//   - renaming a subclass, a spell, a feat, a monster or an item carries the
//     sheets, entries and table rows that held the old name, where the
//     renamed entry was the one that answered to it, and nowhere else;
//   - a campaign import that numbers a colliding row points the copies that
//     name it (a roll table's row, a place's path, an NPC's place and feud,
//     a map pin) at the copy, and says what a row names that stayed behind;
//   - it brings the monsters and items the copied rows name by name, and the
//     spells those cast, when the target's authors answer differently;
//   - a character file carries the Homebrew its sheet stands on;
//   - the content API names a player's own subclass and class a table leaves
//     out, for the class asked about;
//   - a campaign clone keeps its NPCs' places in the arc's cast, a storyboard
//     fight's step names its foes as the table calls them, and every table
//     in a campaign has a name of its own that a rename carries.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-workshop-references");
const world = await openWorld();
const { createHomebrew, listHomebrew } = await import("../src/lib/db/homebrew.ts");
const { normalizeHomebrewData } = await import("../src/lib/homebrew/gear.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createCharacter, getCharacter, listCharactersForUser } = await import("../src/lib/db/characters.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertRollTable, listRollTables } = await import("../src/lib/db/roll-tables.ts");
const { followTableRefs } = await import("../src/lib/dm/roll-table-logic.ts");
const { runContentImport, planContentImport } = await import("../src/lib/db/content-import.ts");
const { createHomebrewMonster, listHomebrewMonsters, updateHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { insertShop } = await import("../src/lib/db/shops.ts");
const { updateHomebrewCarried } = await import("../src/lib/db/homebrew-rename.ts");
const { buildCharacterBundle } = await import("../src/lib/character-bundle.ts");
const { characterFileShelf } = await import("../src/lib/db/character-file.ts");
const sheets = await import("../src/lib/db/sheets.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

const db = getDatabase();
const manifest = (name, shelf = "all") => ({ name, blurb: "A test adventure.", inspiredBy: "Original work", shelf });

function brew(userId, kind, name, data) {
  const normalized = normalizeHomebrewData(kind, data, name);
  if ("error" in normalized) throw new Error(`${name}: ${normalized.error}`);
  return createHomebrew(userId, { kind, name, data: normalized.data });
}
const knights = (feature, extra = {}) => ({
  classSlug: "fighter",
  desc: `Knights of the ${feature}.`,
  levels: { 3: [{ n: feature, d: `What ${feature} does.` }] },
  ...extra,
});
const spell = (desc) => ({ level: 1, school: "evocation", desc, classes: ["wizard"] });
const monster = (userId, name, ac, stats = {}) => {
  const base = draftFromCr(name, 2);
  return createHomebrewMonster(userId, { ...base, stats: { ...base.stats, ac, ...stats } }, "");
};
const featureNames = (sheet) => (sheet.features ?? []).map((feature) => feature.name);

function exported(workshopId, shelf = "all") {
  const result = exportWorkshopBundle(workshopId, manifest("Incoming adventure", shelf));
  assert.ok(!("error" in result), result.error);
  const round = readBundle(JSON.stringify(result.bundle));
  assert.ok(!("error" in round), round.error);
  return { bundle: round.bundle, shelf: result.shelf };
}

function landed(userId, bundle) {
  const result = importWorkshopBundle(userId, bundle);
  assert.ok(!("error" in result), result.error);
  return result;
}

// ---- F01: a bundle's renamed arrivals ----

await test("F01: a pregen keeps the bundle's subclass and spells when the importer has others of those names", () => {
  const author = world.addUser("author");
  const recipient = world.addUser("recipient");
  brew(recipient.id, "spell", "Marsh Spark", spell("A local spark: 1d4 lightning damage."));
  brew(recipient.id, "archetype", "Marsh Knight", knights("Local Ward"));
  brew(author.id, "spell", "Marsh Spark", spell("An incoming spark: 3d6 fire damage."));
  brew(author.id, "archetype", "Marsh Knight", knights("Incoming Ward", { spells: { 3: ["Marsh Spark"] } }));
  const workshop = createWorkshop(author.id, { title: "Marsh" });
  createCharacter(author.id, 3, heroInput({ name: "Sir Reed", class: "fighter", level: 3, subclass: "Marsh Knight" }), "pc", workshop.id);
  createCharacter(
    author.id,
    1,
    heroInput({
      name: "Wren",
      class: "wizard",
      spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: ["Marsh Spark"], known: [], cantrips: [], spellbook: ["Marsh Spark"] },
    }),
    "pc",
    workshop.id,
  );
  const { bundle } = exported(workshop.id);
  const result = landed(recipient.id, bundle);
  assert.ok(result.shelf.renamed.some((line) => line.includes("Marsh Knight [Incoming adventure]")), result.shelf.renamed.join(" | "));

  const library = listCharactersForUser(recipient.id);
  const reed = library.find((character) => character.name === "Sir Reed");
  assert.equal(reed.sheet.subclass, "Marsh Knight [Incoming adventure]");
  assert.ok(featureNames(reed.sheet).includes("Incoming Ward"), featureNames(reed.sheet).join(", "));
  assert.ok(!featureNames(reed.sheet).includes("Local Ward"));
  const wren = library.find((character) => character.name === "Wren");
  assert.deepEqual(wren.sheet.spellcasting.prepared, ["Marsh Spark [Incoming adventure]"]);
  assert.deepEqual(wren.sheet.spellcasting.spellbook, ["Marsh Spark [Incoming adventure]"]);
  // The arriving subclass grants the arriving spell, not the importer's.
  const arrived = listHomebrew(recipient.id, "archetype").find((entry) => entry.name === "Marsh Knight [Incoming adventure]");
  assert.deepEqual(arrived.data.spells, { 3: ["Marsh Spark [Incoming adventure]"] });
  // Their own entries are untouched.
  const own = listHomebrew(recipient.id, "archetype").find((entry) => entry.name === "Marsh Knight");
  assert.equal(own.data.levels[3][0].n, "Local Ward");
});

await test("F01: a subclass identical to the importer's, but granting a spell that arrived renamed, is not taken for theirs", () => {
  const author = world.addUser("author");
  const recipient = world.addUser("recipient");
  for (const [user, desc] of [[recipient, "Theirs: 1d4 cold."], [author, "Ours: 2d8 radiant."]]) {
    brew(user.id, "spell", "Dawn Lance", spell(desc));
    brew(user.id, "archetype", "Dawn Knight", knights("Dawn Guard", { spells: { 3: ["Dawn Lance"] } }));
  }
  const workshop = createWorkshop(author.id, { title: "Dawn" });
  createCharacter(author.id, 3, heroInput({ name: "Sol", class: "fighter", level: 3, subclass: "Dawn Knight" }), "pc", workshop.id);
  landed(recipient.id, exported(workshop.id).bundle);
  const sol = listCharactersForUser(recipient.id).find((character) => character.name === "Sol");
  assert.equal(sol.sheet.subclass, "Dawn Knight [Incoming adventure]");
  const arrived = listHomebrew(recipient.id, "archetype").find((entry) => entry.name === sol.sheet.subclass);
  assert.deepEqual(arrived.data.spells, { 3: ["Dawn Lance [Incoming adventure]"] });
});

await test("F01 family: a bundle's roll tables and shelves name its monsters and items as they arrived", () => {
  const author = world.addUser("author");
  const recipient = world.addUser("recipient");
  monster(recipient.id, "Bog Hound", 11);
  monster(author.id, "Bog Hound", 17);
  brew(recipient.id, "item", "Reed Charm", { desc: "Theirs.", itemKind: "gear", cost: "1 gp" });
  brew(author.id, "item", "Reed Charm", { desc: "Ours, and different.", itemKind: "gear", cost: "9 gp" });
  const workshop = createWorkshop(author.id, { title: "Bog" });
  insertRollTable({ campaignId: workshop.id, name: "Bog encounters", entries: [{ min: 1, max: 1, text: "Bog Hound", ref: { kind: "monster", name: "Bog Hound" } }, { min: 2, max: 2, text: "Reed Charm", ref: { kind: "item", name: "Reed Charm" } }], createdByUserId: author.id });
  insertShop(workshop.id, { name: "Charm stall", kind: "general", size: "village", stock: [{ itemName: "Reed Charm", qty: 2, priceCp: 900, note: "" }], preparedStock: [{ itemName: "Reed Charm", qty: 2, priceCp: 900, note: "" }], markup: 1, buys: true, restockDays: 7 });
  const result = landed(recipient.id, exported(workshop.id).bundle);
  const [table] = listRollTables(result.workshopId);
  assert.equal(table.entries[0].ref.name, "Bog Hound [Incoming adventure]");
  assert.equal(table.entries[1].ref.name, "Reed Charm [Incoming adventure]");
  const shop = db.prepare(`SELECT stock_json, prepared_stock_json FROM shops WHERE campaign_id = ?`).get(result.workshopId);
  assert.equal(JSON.parse(shop.stock_json)[0].itemName, "Reed Charm [Incoming adventure]");
  assert.equal(JSON.parse(shop.prepared_stock_json)[0].itemName, "Reed Charm [Incoming adventure]");
});

await test("A fight that names the author's monster by id fields it on arrival; a map pin opens the lore it named", () => {
  const author = world.addUser("author");
  const recipient = world.addUser("recipient");
  const lurker = monster(author.id, "Fen Lurker", 14);
  const workshop = createWorkshop(author.id, { title: "Fen" });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO encounter_templates (id, campaign_id, name, enemies_json, battlefield, map_json, notes, extras_json, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, '', '{}', '', '{}', ?, ?, ?)`).run(
    crypto.randomUUID(), workshop.id, "Lurker ambush", JSON.stringify([{ monster: lurker.slug, count: 2 }]), author.id, now, now,
  );
  const loreId = crypto.randomUUID();
  db.prepare(`INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, visibility, created_at, updated_at) VALUES (?, ?, 'geography', 'The drowned bell', 'It rings at low tide.', '[]', 0, 'party', ?, ?)`).run(loreId, workshop.id, now, now);
  db.prepare(`INSERT INTO prepared_maps (id, campaign_id, name, notes, tags_json, width, height, terrain, ambient, theme, lights_json, seed, labels_json, created_at, updated_at) VALUES (?, ?, 'Bell map', '', '[]', 4, 4, ?, 'bright', 'field', '[]', 1, ?, ?, ?)`).run(
    crypto.randomUUID(), workshop.id, ".".repeat(16), JSON.stringify([{ x: 1, y: 1, text: "Bell", dmOnly: false, ref: { kind: "lore", id: loreId } }]), now, now,
  );
  const { bundle } = exported(workshop.id);
  assert.equal(bundle.encounters[0].enemies[0].monster, "Fen Lurker", "the roster travelled as an id");
  const result = landed(recipient.id, bundle);
  const roster = JSON.parse(db.prepare(`SELECT enemies_json FROM encounter_templates WHERE campaign_id = ?`).get(result.workshopId).enemies_json);
  assert.equal(roster[0].monster, "Fen Lurker");
  assert.ok(listHomebrewMonsters(recipient.id).some((entry) => entry.draft.name === "Fen Lurker"));
  const labels = JSON.parse(db.prepare(`SELECT labels_json FROM prepared_maps WHERE campaign_id = ?`).get(result.workshopId).labels_json);
  const bell = db.prepare(`SELECT id FROM lore_entries WHERE campaign_id = ? AND title = 'The drowned bell'`).get(result.workshopId);
  assert.equal(labels[0].ref.id, bell.id);
});

// ---- F05: only what this workshop uses ----

await test("F05: 'only what this workshop uses' follows tables, shelves, a subclass's later spells and a class's subclasses", () => {
  const author = world.addUser("author");
  monster(author.id, "Audit Marsh Lurker", 13);
  monster(author.id, "Unused Beast", 10);
  brew(author.id, "spell", "Audit Fenlight", spell("A pale light: 1d8 radiant damage."));
  brew(author.id, "archetype", "Audit Fen Knight", knights("Fen Guard", { spells: { 5: ["Audit Fenlight"] } }));
  brew(author.id, "spell", "Charm Bolt", spell("A bolt: 1d10 force damage."));
  brew(author.id, "item", "Bolt Charm", { desc: "Casts Charm Bolt.", itemKind: "magic_item", rarity: "uncommon", spells: [{ spell: "Charm Bolt", charges: 1, level: 1 }] });
  brew(author.id, "spell", "Unused Spell", spell("Never used: 1d4 cold damage."));
  const workshop = createWorkshop(author.id, { title: "Used" });
  insertRollTable({ campaignId: workshop.id, name: "Marsh", entries: [{ min: 1, max: 1, text: "Audit Marsh Lurker", ref: { kind: "monster", name: "Audit Marsh Lurker" } }, { min: 2, max: 2, text: "Ghost Wisp", ref: { kind: "monster", name: "Ghost Wisp" } }], createdByUserId: author.id });
  insertShop(workshop.id, { name: "Curios", kind: "general", size: "village", stock: [{ itemName: "Bolt Charm", qty: 1, priceCp: 5000, note: "" }], preparedStock: null, markup: 1, buys: true, restockDays: 7 });
  createCharacter(author.id, 3, heroInput({ name: "Fen", class: "fighter", level: 3, subclass: "Audit Fen Knight" }), "pc", workshop.id);
  const { bundle, shelf } = exported(workshop.id, "used");
  const carried = [...bundle.monsters.map((entry) => entry.name), ...bundle.homebrew.map((entry) => entry.name)];
  for (const name of ["Audit Marsh Lurker", "Audit Fen Knight", "Audit Fenlight", "Bolt Charm", "Charm Bolt"]) assert.ok(carried.includes(name), `${name} stayed behind: ${carried.join(", ")}`);
  for (const name of ["Unused Beast", "Unused Spell"]) assert.ok(!carried.includes(name), `${name} came though unused`);
  assert.ok(shelf.unused.includes("monster Unused Beast"));
  assert.ok(!shelf.unused.some((line) => line.includes("Audit Fenlight")));
  assert.ok(shelf.missing.includes("Ghost Wisp"), shelf.missing.join(", "));
});

// ---- F02: a rename carries what held the old name ----

await test("F02: renaming a subclass carries the library and table characters that held it, and later levels keep its features", () => {
  const owner = world.owner;
  brew(owner.id, "archetype", "Audit Bog Knight", knights("Bog Ward", { levels: { 3: [{ n: "Bog Ward", d: "Wards." }], 7: [{ n: "Bog Stride", d: "Strides." }] } }));
  const entry = listHomebrew(owner.id, "archetype").find((candidate) => candidate.name === "Audit Bog Knight");
  const library = createCharacter(owner.id, 3, heroInput({ name: "Moss", class: "fighter", level: 3, subclass: "Audit Bog Knight" }));
  const hero = world.addHero({ class: "fighter", level: 3, subclass: "Audit Bog Knight", user: owner });
  assert.ok(featureNames(world.sheet(hero.id)).includes("Bog Ward"));

  const out = updateHomebrewCarried(owner.id, entry.id, { name: "Audit Fen Knight" });
  assert.equal(out.entry.name, "Audit Fen Knight");
  assert.ok(out.carried.characters >= 2, JSON.stringify(out.carried));
  assert.equal(getCharacter(library.id).sheet.subclass, "Audit Fen Knight");
  assert.equal(getCharacter(library.id).subclass, "Audit Fen Knight");
  assert.equal(world.sheet(hero.id).subclass, "Audit Fen Knight");
  // A later level still grants the subclass's features.
  world.patch(hero.id, { level: 7 });
  const leveled = featureNames(world.sheet(hero.id));
  assert.ok(leveled.includes("Bog Ward") && leveled.includes("Bog Stride"), leveled.join(", "));
});

await test("F02 family: renaming a spell, a feat, a monster or an item carries sheets, entries and table rows", () => {
  const owner = world.owner;
  brew(owner.id, "spell", "Gloam Dart", spell("A dart of dusk: 1d6 necrotic damage."));
  brew(owner.id, "archetype", "Gloam Knight", knights("Gloam Ward", { spells: { 3: ["Gloam Dart"] } }));
  brew(owner.id, "feat", "Gloam Born", { desc: "Born at dusk." });
  brew(owner.id, "item", "Gloam Lantern", { desc: "Glows at dusk.", itemKind: "gear", cost: "5 gp" });
  const beast = monster(owner.id, "Gloam Moth", 12);
  const hero = world.addHero({
    class: "wizard",
    level: 1,
    user: owner,
    feats: ["Gloam Born"],
    equipment: [{ name: "Gloam Lantern", qty: 1 }],
    spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: ["Gloam Dart"], known: [], cantrips: [], spellbook: ["Gloam Dart"] },
  });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, last_shift_turn, stat_block, created_at, updated_at) VALUES (?, ?, 'Moth keeper', 'indifferent', '', '', '', 'Gloam Moth', ?, ?)`).run(crypto.randomUUID(), world.campaignId, now, now);
  insertRollTable({ campaignId: world.campaignId, name: "Dusk", entries: [{ min: 1, max: 1, text: "Gloam Moth", ref: { kind: "monster", name: "Gloam Moth" } }, { min: 2, max: 2, text: "Gloam Lantern", ref: { kind: "item", name: "Gloam Lantern" } }], createdByUserId: owner.id });
  insertShop(world.campaignId, { name: "Lamps", kind: "general", size: "village", stock: [{ itemName: "Gloam Lantern", qty: 1, priceCp: 500, note: "" }], preparedStock: null, markup: 1, buys: true, restockDays: 7 });

  const byName = (kind, name) => listHomebrew(owner.id, kind).find((entry) => entry.name === name);
  updateHomebrewCarried(owner.id, byName("spell", "Gloam Dart").id, { name: "Dusk Dart" });
  updateHomebrewCarried(owner.id, byName("feat", "Gloam Born").id, { name: "Dusk Born" });
  updateHomebrewCarried(owner.id, byName("item", "Gloam Lantern").id, { name: "Dusk Lantern" });
  updateHomebrewMonster(owner.id, beast.id, { ...beast.draft, name: "Dusk Moth" }, "");

  const sheet = world.sheet(hero.id);
  assert.deepEqual(sheet.spellcasting.prepared, ["Dusk Dart"]);
  assert.deepEqual(sheet.spellcasting.spellbook, ["Dusk Dart"]);
  assert.deepEqual(sheet.feats, ["Dusk Born"]);
  assert.equal(sheet.equipment.find((item) => /lantern/i.test(item.name)).name, "Dusk Lantern");
  assert.deepEqual(byName("archetype", "Gloam Knight").data.spells, { 3: ["Dusk Dart"] });
  assert.equal(db.prepare(`SELECT stat_block FROM npcs WHERE campaign_id = ? AND name = 'Moth keeper'`).get(world.campaignId).stat_block, "Dusk Moth");
  const dusk = listRollTables(world.campaignId).find((table) => table.name === "Dusk");
  assert.deepEqual(dusk.entries.map((entry) => entry.ref.name), ["Dusk Moth", "Dusk Lantern"]);
  const shop = db.prepare(`SELECT stock_json FROM shops WHERE campaign_id = ? AND name = 'Lamps'`).get(world.campaignId);
  assert.equal(JSON.parse(shop.stock_json)[0].itemName, "Dusk Lantern");
});

await test("F02: a rename is not carried where another author's entry of that name answered first, nor for a published name", () => {
  const dm = world.addUser("dm");
  const owner = world.addUser("owner");
  const table = campaigns.createCampaign(owner.id, { title: "Shared", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal", gameSettings: {} });
  db.prepare(`UPDATE campaigns SET human_dm_user_id = ? WHERE id = ?`).run(dm.id, table.id);
  // The owner comes first at that table, so the owner's Ash Knight answers.
  brew(owner.id, "archetype", "Ash Knight", knights("Owner Ash"));
  const theirs = brew(dm.id, "archetype", "Ash Knight", knights("DM Ash"));
  const sheet = sheets.createSheet(table.id, owner.id, 3, heroInput({ name: "Cinder", class: "fighter", level: 3, subclass: "Ash Knight" }));
  updateHomebrewCarried(dm.id, theirs.id, { name: "Ember Knight" });
  assert.equal(sheets.getSheetById(sheet.id).subclass, "Ash Knight", "the DM's rename moved a sheet the owner's entry answered for");
  // A homebrew spell saved under a published name never answered to it.
  if (world.hasPack) {
    const shadow = brew(owner.id, "spell", "Magic Missile", spell("A shadowed copy: 1d4 force damage."));
    const caster = sheets.createSheet(table.id, owner.id, 1, heroInput({ name: "Pell", class: "wizard", spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: ["Magic Missile"], known: [], cantrips: [], spellbook: ["Magic Missile"] } }));
    updateHomebrewCarried(owner.id, shadow.id, { name: "Shadow Missile" });
    assert.deepEqual(sheets.getSheetById(caster.id).spellcasting.prepared, ["Magic Missile"]);
  }
});

// ---- F04: a campaign import's numbered rows ----

await test("F04: an imported roll table follows its nested table to the numbered copy, on the first import and the next", () => {
  const owner = world.addUser("owner");
  const source = createWorkshop(owner.id, { title: "Gem source" });
  const target = createWorkshop(owner.id, { title: "Gem target" });
  insertRollTable({ campaignId: target.id, name: "Gems", entries: [{ min: 1, max: 1, text: "LOCAL RUBY" }], createdByUserId: owner.id });
  insertRollTable({ campaignId: source.id, name: "Gems", entries: [{ min: 1, max: 1, text: "INCOMING EMERALD" }], createdByUserId: owner.id });
  insertRollTable({ campaignId: source.id, name: "Loot", entries: [{ min: 1, max: 1, text: "Gems", ref: { kind: "table", name: "Gems" } }], createdByUserId: owner.id });
  const roll = (campaignId, from) => {
    const tables = listRollTables(campaignId);
    const start = tables.find((table) => table.name === from);
    return followTableRefs({ table: start.name, die: 1, total: 1, entry: start.entries[0] }, tables, () => 1).at(-1).entry.text;
  };
  const first = runContentImport({ sourceId: source.id, campaignId: target.id, selection: ["tables"], houseRulesMode: "append" });
  assert.ok(!("error" in first), first.error);
  assert.equal(roll(target.id, "Loot"), "INCOMING EMERALD");
  const again = runContentImport({ sourceId: source.id, campaignId: target.id, selection: ["tables"], houseRulesMode: "append", again: "copy" });
  assert.ok(!("error" in again), again.error);
  assert.equal(roll(target.id, "Loot (2)"), "INCOMING EMERALD");
  assert.ok(listRollTables(target.id).some((table) => table.name === "Gems (3)"));
});

await test("F04 family: places, NPCs and pins follow numbered copies; a row whose record stayed behind is named", () => {
  const owner = world.addUser("owner");
  const source = createWorkshop(owner.id, { title: "Town source" });
  const target = createWorkshop(owner.id, { title: "Town target" });
  const now = new Date().toISOString();
  const place = (campaignId, name, connections = []) =>
    db.prepare(`INSERT INTO locations (id, campaign_id, name, layout_description, connections_json, visited, is_current, created_at, updated_at) VALUES (?, ?, ?, '', ?, 0, 0, ?, ?)`).run(crypto.randomUUID(), campaignId, name, JSON.stringify(connections), now, now);
  const npc = (campaignId, name, location, relations = []) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, relations_json, last_shift_turn, created_at, updated_at) VALUES (?, ?, ?, 'indifferent', '', ?, ?, '', ?, ?)`).run(id, campaignId, name, location, JSON.stringify(relations), now, now);
    return id;
  };
  place(target.id, "Mill");
  npc(target.id, "Ada", "Mill");
  place(source.id, "Mill");
  place(source.id, "Ford", ["Mill"]);
  npc(source.id, "Ada", "Mill");
  npc(source.id, "Bram", "Mill", [{ npcName: "Ada", stance: "rival" }]);
  npc(source.id, "Cora", "Ford");
  const lore = crypto.randomUUID();
  db.prepare(`INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, visibility, created_at, updated_at) VALUES (?, ?, 'geography', 'Mill lore', 'Old.', '[]', 0, 'party', ?, ?)`).run(lore, source.id, now, now);
  db.prepare(`INSERT INTO prepared_maps (id, campaign_id, name, notes, tags_json, width, height, terrain, ambient, theme, lights_json, seed, labels_json, created_at, updated_at) VALUES (?, ?, 'Mill map', '', '[]', 4, 4, ?, 'bright', 'field', '[]', 1, ?, ?, ?)`).run(
    crypto.randomUUID(), source.id, ".".repeat(16), JSON.stringify([{ x: 0, y: 0, text: "Lore", dmOnly: false, ref: { kind: "lore", id: lore } }]), now, now,
  );
  insertRollTable({ campaignId: source.id, name: "Who", entries: [{ min: 1, max: 1, text: "Cora", ref: { kind: "npc", name: "Cora" } }], createdByUserId: owner.id });
  // The table comes without its NPC: the preview says so first.
  const plan = planContentImport(source.id, target.id, ["tables"]);
  assert.ok(plan.warnings.some((warning) => /roll-table row/.test(warning.message)), plan.warnings.map((warning) => warning.message).join(" | "));
  const tablesOnly = runContentImport({ sourceId: source.id, campaignId: target.id, selection: ["tables"], houseRulesMode: "append" });
  assert.ok((tablesOnly.referenceNotes ?? []).some((line) => /Cora/.test(line)), JSON.stringify(tablesOnly.referenceNotes));

  const out = runContentImport({ sourceId: source.id, campaignId: target.id, selection: ["locations", "npcs", "lore", "maps"], houseRulesMode: "append" });
  assert.ok(!("error" in out), out.error);
  const row = (sql, ...args) => db.prepare(sql).get(...args);
  assert.deepEqual(JSON.parse(row(`SELECT connections_json FROM locations WHERE campaign_id = ? AND name = 'Ford'`, target.id).connections_json), ["Mill (2)"]);
  assert.equal(row(`SELECT location FROM npcs WHERE campaign_id = ? AND name = 'Bram'`, target.id).location, "Mill (2)");
  assert.equal(JSON.parse(row(`SELECT relations_json FROM npcs WHERE campaign_id = ? AND name = 'Bram'`, target.id).relations_json)[0].npcName, "Ada (2)");
  const copiedLore = row(`SELECT id FROM lore_entries WHERE campaign_id = ? AND title = 'Mill lore'`, target.id);
  const labels = JSON.parse(row(`SELECT labels_json FROM prepared_maps WHERE campaign_id = ? AND name = 'Mill map'`, target.id).labels_json);
  assert.equal(labels[0].ref.id, copiedLore.id);
  // The target's own rows are untouched.
  assert.equal(row(`SELECT location FROM npcs WHERE campaign_id = ? AND name = 'Ada'`, target.id).location, "Mill");
});

await test("A campaign import brings the monsters and items its rows name by name, and the spells they cast", () => {
  const author = world.addUser("author");
  const host = world.addUser("host");
  brew(author.id, "spell", "Rot Bolt", spell("A rotten bolt: 2d6 necrotic damage."));
  monster(author.id, "Rot Drake", 15, { spells: ["Rot Bolt"] });
  monster(host.id, "Rot Drake", 10);
  brew(author.id, "item", "Rot Wand", { desc: "Casts Rot Bolt.", itemKind: "magic_item", rarity: "uncommon", spells: [{ spell: "Rot Bolt", charges: 3, level: 1 }] });
  const source = createWorkshop(author.id, { title: "Rot" });
  const target = createWorkshop(host.id, { title: "Host table" });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, last_shift_turn, stat_block, created_at, updated_at) VALUES (?, ?, 'Drake rider', 'hostile', '', '', '', 'Rot Drake', ?, ?)`).run(crypto.randomUUID(), source.id, now, now);
  insertShop(source.id, { name: "Wands", kind: "general", size: "village", stock: [{ itemName: "Rot Wand", qty: 1, priceCp: 9000, note: "" }], preparedStock: null, markup: 1, buys: true, restockDays: 7 });
  const out = runContentImport({ sourceId: source.id, campaignId: target.id, selection: ["npcs", "shops"], houseRulesMode: "append" });
  assert.ok(!("error" in out), out.error);
  assert.deepEqual(out.monstersBrought, ["Rot Drake [Rot]"]);
  assert.deepEqual(out.itemsBrought, ["Rot Wand"]);
  assert.deepEqual(out.spellsBrought, ["Rot Bolt"]);
  assert.equal(db.prepare(`SELECT stat_block FROM npcs WHERE campaign_id = ?`).get(target.id).stat_block, "Rot Drake [Rot]");
  assert.ok(listHomebrew(host.id, "spell").some((entry) => entry.name === "Rot Bolt"));
  // Their own Rot Drake still answers to its name at their other tables.
  assert.ok(listHomebrewMonsters(host.id).some((entry) => entry.draft.name === "Rot Drake" && entry.draft.stats.ac === 10));
});

// ---- F07: a character file and its Homebrew ----

await test("F07: a character file carries its subclass and spells, and another account imports it", async () => {
  const author = world.addUser("author");
  const stranger = world.addUser("stranger");
  brew(author.id, "spell", "Mire Light", spell("A mire light: 1d8 radiant damage."));
  brew(author.id, "archetype", "Audit Marsh Knight", knights("Marsh Ward", { spells: { 3: ["Mire Light"] } }));
  const character = createCharacter(author.id, 3, heroInput({ name: "Tarn", class: "fighter", level: 3, subclass: "Audit Marsh Knight" }));
  const file = await buildCharacterBundle(character, async () => null, new Date(), "test", characterFileShelf(author.id, character.sheet));
  assert.deepEqual(file.homebrew.map((entry) => entry.name).sort(), ["Audit Marsh Knight", "Mire Light"]);
  const route = await world.route("characters/import");
  world.signIn(stranger);
  const out = await call(route, "POST", file);
  assert.equal(out.status, 201, JSON.stringify(out.json));
  assert.equal(out.json.character.sheet.subclass, "Audit Marsh Knight");
  assert.ok(featureNames(out.json.character.sheet).includes("Marsh Ward"));
  assert.ok(listHomebrew(stranger.id, "archetype").some((entry) => entry.name === "Audit Marsh Knight"));
  // A refused file takes its arrivals back.
  const before = listHomebrew(stranger.id).length;
  const broken = { ...file, name: "Broken", sheet: { ...file.sheet, name: "Broken", class: "homebrew:@class:Nothing Here" }, homebrew: [{ kind: "spell", name: "Orphan Spell", data: spell("Orphaned: 1d4 cold damage.") }] };
  const refused = await call(route, "POST", broken);
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.equal(listHomebrew(stranger.id).length, before);
});

// ---- What the first pass left: a clone's cast, a fight step's foes, tables of one name ----

await test("A campaign clone keeps each NPC's link into the arc's cast", async () => {
  const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
  const { upsertNpc, patchNpcAgency } = await import("../src/lib/db/npcs.ts");
  patchNpcAgency(upsertNpc({ campaignId: world.campaignId, name: "Hooded Mira" }).id, { arcCastId: "np1" });
  const clone = cloneCampaign(world.owner.id, world.campaignId);
  assert.ok(!("error" in clone), clone.error);
  assert.equal(db.prepare(`SELECT arc_cast_id FROM npcs WHERE campaign_id = ? AND name = 'Hooded Mira'`).get(clone.campaign.id)?.arc_cast_id, "np1");
});

await test("A storyboard fight's step names its foes as the table calls them once the monsters arrive", async () => {
  const { insertBeat } = await import("../src/lib/db/workshop-beats.ts");
  const { checkBeat } = await import("../src/lib/workshop/board.ts");
  const author = world.addUser("author");
  const host = world.addUser("host");
  monster(host.id, "Gloomfang", 11);
  const theirs = monster(author.id, "Gloomfang", 17);
  const workshop = createWorkshop(author.id, { title: "Den" });
  const fight = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO encounter_templates (id, campaign_id, name, enemies_json, battlefield, map_json, notes, created_by_user_id, created_at, updated_at) VALUES (?, ?, 'Den ambush', ?, '', '{}', '', ?, ?, ?)`).run(
    fight, workshop.id, JSON.stringify([{ monster: `homebrew:${theirs.id}`, count: 2 }]), author.id, now, now,
  );
  // The board test-story-setup.mjs knows writes an arc, a beat on it waiting on the den's fight.
  for (const [kind, title, links] of [["backstory", "The flood", {}], ["setting", "The mill", {}], ["hook", "A howl at dusk", {}], ["event", "The wheel stops", { encounterId: fight }], ["npc_moment", "Marla confesses", {}], ["event", "The wheelhouse opens", {}], ["encounter", "The den", { encounterId: fight }]]) {
    insertBeat(workshop.id, checkBeat({ kind, title, body: `${title}.`, links }).beat);
  }
  const table = campaigns.createCampaign(host.id, { title: "Host table", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  const outcome = runContentImport({ sourceId: workshop.id, campaignId: table.id, selection: ["storyboard"], houseRulesMode: "append" });
  assert.ok(!("error" in outcome), outcome.error);
  const brought = outcome.monstersBrought?.[0];
  assert.ok(brought && brought !== "Gloomfang", JSON.stringify(outcome.monstersBrought));
  const arc = JSON.stringify(campaigns.getCampaignById(table.id).storyArc);
  assert.ok(arc.includes(`2 ${brought}`), arc);
  assert.ok(!arc.includes("homebrew:"), arc);
});

await test("Each table in a campaign keeps a name of its own, and a rename carries the rows that roll on it", async () => {
  const { getRollTable, updateRollTable } = await import("../src/lib/db/roll-tables.ts");
  const owner = world.addUser("owner");
  const workshop = createWorkshop(owner.id, { title: "Tables" });
  const row = (text) => [{ min: 1, max: 1, text }];
  const gems = insertRollTable({ campaignId: workshop.id, name: "Gems", entries: row("Ruby"), createdByUserId: owner.id });
  const second = insertRollTable({ campaignId: workshop.id, name: "gems", entries: row("Opal"), createdByUserId: owner.id });
  assert.equal(second.name, "gems (2)");
  const loot = insertRollTable({ campaignId: workshop.id, name: "Loot", entries: [{ min: 1, max: 1, text: "Gems", ref: { kind: "table", name: "Gems" } }], createdByUserId: owner.id });
  updateRollTable(gems.id, { name: "Jewels" });
  assert.deepEqual(getRollTable(loot.id).entries[0], { min: 1, max: 1, text: "Jewels", ref: { kind: "table", name: "Jewels" } });
  // A rename onto a name another table holds is refused, with the reason.
  const route = await world.route("campaigns/[campaignId]/dm/roll-tables/[tableId]");
  world.signIn(owner);
  const refused = await call(route, "PATCH", { name: "jewels" }, { campaignId: workshop.id, tableId: loot.id });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.match(refused.json.error, /already called jewels/);
  // An older bundle's two tables of one name land numbered after the first.
  db.prepare(`UPDATE roll_tables SET name = 'Jewels' WHERE id = ?`).run(second.id);
  const result = landed(owner.id, exported(workshop.id).bundle);
  assert.deepEqual(listRollTables(result.workshopId).map((table) => table.name).sort(), ["Jewels", "Jewels (2)", "Loot"]);
});

// ---- F06: the content API's explanation ----

await test("F06: at a table, a player's own class and subclass are named as left out, for the class asked", async () => {
  const player = world.addUser("player");
  world.addHero({ user: player, class: "fighter" });
  brew(player.id, "archetype", "Player Marsh Knight", knights("Player Ward"));
  brew(player.id, "archetype", "Player Wizard School", { classSlug: "wizard", desc: "A school.", levels: { 2: [{ n: "School Trick", d: "A trick." }] } });
  brew(player.id, "class", "Player Warden", { desc: "A warden.", hitDie: 10, primary: ["str"], saves: ["str", "con"], skillChoices: { count: 2, from: ["athletics", "survival"] } });
  const content = await world.route("content/[kind]");
  world.signIn(player);
  const url = (kind, extra = "") => `http://test/api/content/${kind}?campaign=${world.campaignId}${extra}`;
  const subclasses = await call(content, "GET", undefined, { kind: "archetypes" }, url("archetypes", "&class=fighter"));
  assert.equal(subclasses.status, 200);
  assert.deepEqual(subclasses.json.unadmitted, ["Player Marsh Knight"]);
  const classes = await call(content, "GET", undefined, { kind: "classes" }, url("classes"));
  assert.ok((classes.json.unadmitted ?? []).includes("Player Warden"), JSON.stringify(classes.json.unadmitted));
});

world.close();
finish();
