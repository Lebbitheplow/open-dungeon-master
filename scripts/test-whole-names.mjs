// An item is the row its whole name or its srdName names, never a row a word
// of its name happens to spell: "Dinner plate" is no Plate armor and "Fishing
// net" no Net, at an English table as at any other. The engines read the
// row (rowName, matchWeapon, magicWeaponOfRow), so a "Spada lunga" listed as
// a Rapier is a rapier wherever it is read; an item no row knows is asked
// what it is (srdName, tags) before it is granted or bought. A composite
// magic item is the SRD's own pair of names ("Vicious Rapier", "Chain Mail of
// Fire Resistance"), sent as srdName at a table that names it otherwise. The
// names below are written at an Italian, French, Spanish, German and English
// table.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call } from "./lib/enforce-campaign.mjs";

const { test, finish } = suite("test-whole-names");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { itemRow, itemTags } = await import("../src/lib/srd/item-tags.ts");
const { armorNamed, armorOfRow, matchArmor } = await import("../src/lib/srd/armor.ts");
const { weaponNamed, matchWeapon, SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor-table.ts");
const { findPoison } = await import("../src/lib/srd/afflictions.ts");
const { srdNameFor, consumableEffect } = await import("../src/lib/dm/item-logic.ts");
const { magicWeaponOfRow } = await import("../src/lib/dm/gear-attack.ts");
const { defensiveDuelistBonus } = await import("../src/lib/srd/feat-combat.ts");
const { buildItemSheet } = await import("../src/lib/help/item-sheet.ts");
const { otherHandArmed } = await import("../src/lib/dm/attack-rules.ts");
const { itemSpellsOfRow } = await import("../src/lib/srd/item-spells.ts");
const { loadLine } = await import("../src/lib/srd/encumbrance.ts");
const { isBasicPoison } = await import("../src/lib/dm/attack-onhit.ts");
const { magicItemBonus, rowName } = await import("../src/lib/srd/item-row.ts");
const { looksMagical } = await import("../src/lib/srd/starting-wealth.ts");
const { findNamed } = await import("../src/lib/language/text-logic.ts");
const { wearsHeavyArmor } = await import("../src/lib/dm/damage-logic.ts");
const { handsBusy } = await import("../src/lib/dm/cast-rules.ts");
const { resourceTools } = await import("../src/lib/dm/resource-tool-defs.ts");
const { compactTool } = await import("../src/lib/dm/tool-profiles.ts");
const { getLocationByName, insertKnownLocation } = await import("../src/lib/db/locations.ts");
const { insertShop, normalizeStock, stockLineSchema } = await import("../src/lib/db/shops.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets, getSheetById } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
const content = await world.route("content/[kind]");

// The model's call, through the turn loop's dispatch and its gate.
async function ai(name, args, actor) {
  world.say("player", "I take it.", actor);
  const turn = createDmTurn(world.campaignId, []);
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() });
}

const hero = world.addHero({ name: "Ada", class: "fighter", level: 3, gold: 500 });
const carried = (name) => getSheetById(hero.id).equipment.find((item) => item.name === name);

// Everyday things whose names hold an SRD weapon's or armor's word, at each
// table: none is that row.
const LOOKALIKES = [
  "Dinner plate", "Copper plate", "Silver Plate", "Bear hide", "Wolf Hide", "Strip of leather", "Fishing net",
  "Club soda", "Smoked pike", "Dart board", "Arm sling", "Whipcord belt", "Rope ladder",
  "Piatto da portata", "Pelle d'orso", "Rete da pesca",
  "Assiette plate", "Pierre plate", "Lance-pierre", "Carte du club",
  "Plato de cobre", "Red de pesca", "Tabla de dardos",
  "Sack voller Münzen", "Fischernetz", "Net van touw",
];

await test("finding 1: a name that holds a weapon's or armor's word is no row, at any table, English included.", () => {
  for (const name of LOOKALIKES) {
    assert.equal(weaponNamed(name), null, `${name} is a weapon`);
    assert.equal(armorNamed(name), null, `${name} is armor`);
    assert.equal(itemRow({ name }), null, `${name} is ${itemRow({ name })?.name}`);
    assert.deepEqual(itemTags({ name }), [], `${name} has tags`);
    assert.equal(loadLine({ name, qty: 1 }).eachLb, null, `${name} weighs as a row`);
  }
  for (const name of ["Assassin's Blood Orange", "Blood orange", "Sangue d'assassino"]) {
    assert.equal(findPoison(name), null, name);
  }
  assert.equal(findPoison("assassin’s blood")?.name, "Assassin's Blood");
});

await test("finding 1: the row's own name, its plural, the book's comma order and its textKey variants find it.", () => {
  for (const [name, row] of [["Longsword", "Longsword"], ["LONGSWORDS", "Longsword"], ["long-sword", "Longsword"], ["Crossbow, light", "Light Crossbow"], ["light crossbow", "Light Crossbow"], ["Torches", "Torch"], ["half plate", "Half Plate"], ["HALF-PLATE", "Half Plate"]]) {
    const found = weaponNamed(name)?.name ?? armorNamed(name)?.name ?? itemRow({ name })?.name ?? null;
    assert.equal(found, row, `${name}`);
  }
});

await test("finding 1: the gate asks what a lookalike is before it is granted, at every table; with srdName it is that row.", async () => {
  for (const name of ["Dinner plate", "Piatto da portata", "Assiette plate", "Plato de cobre", "Fischernetz"]) {
    const out = await ai("grant_item", { characterId: hero.id, name, reason: "the chest" }, hero);
    assert.equal(out.retry, true, `${name}: granted without asking`);
    assert.match(out.error, /srdName/);
    assert.equal(carried(name), undefined);
  }
  const named = await ai("grant_item", { characterId: hero.id, name: "Spada lunga", srdName: "longsword", reason: "the chest" }, hero);
  assert.equal(named.ok, true, named.error);
  assert.equal(carried("Spada lunga").srdName, "Longsword");
  assert.equal(matchWeapon(carried("Spada lunga"))?.name, "Longsword");
});

await test("finding 2: a composite magic item is the SRD's own pair of names; sent as srdName at another table, the engines read that pair, never the family's default base.", () => {
  for (const [srdName, weapon, magic] of [
    ["Flame Tongue Scimitar", "Scimitar", "Flame Tongue"],
    ["Frost Brand Greatsword", "Greatsword", "Frost Brand"],
    ["Vicious Rapier", "Rapier", "Vicious Weapon"],
  ]) {
    assert.deepEqual(srdNameFor(srdName, "grant_item"), { srdName });
    for (const name of [srdName, "Scimitarra lingua di fuoco", "Cimeterre langue de feu", "Cimitarra lengua de fuego", "Flammenzungen-Krummsäbel"]) {
      const row = magicWeaponOfRow({ name, srdName });
      assert.equal(row.srd?.name, weapon, `${name} as ${srdName}`);
      assert.equal(row.gear?.def?.name, magic, `${name} as ${srdName}`);
    }
  }
  for (const [srdName, armor] of [["Mithral Half Plate", "Half Plate"], ["Chain Mail of Fire Resistance", "Chain Mail"], ["Adamantine Plate", "Plate"]]) {
    assert.deepEqual(srdNameFor(srdName, "grant_item"), { srdName });
    assert.equal(armorOfRow({ name: "Armatura del fabbro", srdName })?.armor.name, armor, srdName);
  }
  for (const name of ["Flame Tongue Spada", "Vicious", "Rapier Vicious", "Chain Mail of Fire"]) {
    assert.ok("error" in srdNameFor(name, "grant_item"), `${name} was taken as a row`);
  }
});

await test("finding 2: a composite is built only on the bases the SRD's entry allows, and a suit may be written \"<suit> Armor\".", () => {
  for (const srdName of ["Plate Armor of Fire Resistance", "Mithral Plate Armor", "Adamantine Breastplate Armor", "Berserker Greataxe", "Giant Slayer Rapier", "Sword of Sharpness Scimitar", "Vicious Light Crossbow"]) {
    assert.ok(!("error" in srdNameFor(srdName, "grant_item")), `${srdName} was refused`);
  }
  // Mithral and adamantine: medium or heavy, but not hide; a sword of
  // sharpness deals slashing damage; a Dagger of Venom and an Animated
  // Shield are built on one base only.
  for (const srdName of ["Mithral Hide", "Mithral Shield", "Adamantine Leather", "Sword of Sharpness Rapier", "Flame Tongue Dagger", "Berserker Longsword", "Dagger of Venom Greatsword", "Animated Shield Plate"]) {
    assert.ok("error" in srdNameFor(srdName, "grant_item"), `${srdName} was taken as a row`);
  }
});

await test("finding 2: every engine that asks what weapon or armor a line is reads the base its magic row is built on, at every table.", () => {
  for (const name of ["Pugnale del veleno", "Dague venimeuse", "Daga del veneno", "Giftdolch", "Dagger of Venom"]) {
    const item = { name, srdName: "Dagger of Venom", qty: 1, equipped: true };
    assert.equal(matchWeapon(item)?.name, "Dagger", name);
    assert.equal(otherHandArmed({ equipment: [{ name: "Longsword", qty: 1, equipped: true }, item], weapon: "Longsword", shieldName: null }), true, `${name}: the other hand is empty`);
  }
  for (const [name, srdName] of [["Armatura di adamantio", "Adamantine Plate"], ["Plaque naine", "Dwarven Plate"], ["Placas enanas", "Dwarven Plate"], ["Zwergenplatte", "Dwarven Plate"], ["Dwarven Plate", undefined]]) {
    const item = { name, ...(srdName ? { srdName } : {}), qty: 1, equipped: true };
    assert.equal(matchArmor(item)?.name, "Plate", name);
    assert.equal(wearsHeavyArmor([item]), true, `${name}: no heavy armor`);
  }
  const cleric = {
    name: "Ida", class: "cleric", level: 5, classes: [{ id: "cleric", level: 5 }], features: [], conditions: [],
    abilities: { str: 14, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
    proficiencies: { armor: ["light armor", "medium armor", "shields"], weapons: ["simple weapons"], tools: [], skills: [], saves: [], languages: [], expertise: [] },
    equipment: [{ name: "Shield", qty: 1, equipped: true }, { name: "Mazza della distruzione", srdName: "Mace of Disruption", qty: 1, equipped: true }],
  };
  assert.equal(handsBusy(cleric), 2, "a shield and a mace of disruption fill both hands");
});

await test("finding 3: Defensive Duelist reads the row the weapon swings as: a Spada lunga listed as a Rapier is finesse, a whipcord belt is no whip.", () => {
  const sheet = (item) => ({ feats: ["Defensive Duelist"], features: [], equipment: [{ ...item, equipped: true, qty: 1 }], proficiencies: { weapons: ["martial"] } });
  for (const name of ["Spada lunga", "Épée longue", "Espada larga", "Langschwert", "Fancy sword"]) {
    assert.equal(defensiveDuelistBonus(sheet({ name, srdName: "Rapier" }), 2), 2, name);
    assert.equal(defensiveDuelistBonus(sheet({ name }), 2), null, `${name} with no row`);
  }
  for (const name of ["Whipcord belt", "Cintura di cuoio", "Rapier sheath"]) {
    assert.equal(defensiveDuelistBonus(sheet({ name }), 2), null, name);
  }
});

await test("finding 4: the help card, the dual-wield check, an item's spells, its weight and the poison read the row, not the line's own name.", () => {
  for (const name of ["Spada lunga", "Épée longue", "Espada larga", "Langschwert"]) {
    const line = { name, srdName: "Rapier", qty: 1 };
    assert.equal(buildItemSheet(rowName(line), [])?.weapon?.damage ?? null, buildItemSheet("Rapier", [])?.weapon?.damage, name);
    assert.equal(loadLine(line).eachLb, 2, name);
    assert.equal(buildItemSheet(name, []), null, `${name}'s own name opened a card`);
  }
  for (const name of ["Bacchetta dei dardi", "Baguette de projectiles", "Varita de proyectiles", "Zauberstab der Geschosse"]) {
    assert.deepEqual(itemSpellsOfRow({ name, srdName: "Wand of Magic Missiles" }).map((entry) => entry.spell), ["Magic Missile"], name);
    assert.deepEqual(itemSpellsOfRow({ name }), [], `${name} cast with no row`);
  }
  for (const name of ["Veleno base", "Poison basique", "Veneno básico", "Einfaches Gift"]) {
    assert.equal(isBasicPoison({ name, srdName: "Basic Poison" }), true, name);
    assert.equal(isBasicPoison({ name }), false, `${name} with no row`);
  }
  // Two lines held, the swung one by its own stored name: the other hand
  // holds a weapon whatever either is called.
  const equipment = [
    { name: "Spada corta", srdName: "Shortsword", equipped: true, qty: 1 },
    { name: "Pugnale", srdName: "Dagger", equipped: true, qty: 1 },
  ];
  assert.equal(otherHandArmed({ equipment, weapon: "Spada corta", shieldName: null }), true);
  assert.equal(otherHandArmed({ equipment: equipment.slice(0, 1), weapon: "Spada corta", shieldName: null }), false);
});

await test("finding 7: a place, a faction, a shop, a card or a prepared fight is its whole name, compared by textKey, at every table: never a part of it, and no word read aside.", async () => {
  insertKnownLocation({ campaignId: world.campaignId, name: "The Rusty Anchor" });
  insertKnownLocation({ campaignId: world.campaignId, name: "Église Saint-Paul" });
  for (const name of ["The Rusty Anchor", "THE RUSTY ANCHOR", "the rusty-anchor"]) {
    assert.equal(getLocationByName(world.campaignId, name)?.name, "The Rusty Anchor", name);
  }
  assert.equal(getLocationByName(world.campaignId, "église saint paul")?.name, "Église Saint-Paul");
  for (const name of ["Rusty", "Anchor", "rusty anchor", "The Rusty Anchor Inn", "Saint-Paul", "L'ancora arrugginita"]) {
    assert.equal(getLocationByName(world.campaignId, name), null, name);
  }
  // A stop list holds more than articles: no leading word is ever read
  // aside, so a name that opens with one is its own record.
  for (const [record, asked] of [["No Mercy", "Mercy"], ["Before Dawn", "Dawn"], ["Contro Corrente", "Corrente"], ["Sans Peur", "Peur"], ["Sin Nombre", "Nombre"], ["Gegen den Sturm", "Sturm"], ["La Corte dei Giunchi", "corte dei giunchi"]]) {
    assert.equal(findNamed([{ name: record }], asked, (entry) => [entry.name]), null, `"${asked}" for ${record}`);
    assert.equal(findNamed([{ name: record }], record.toUpperCase(), (entry) => [entry.name])?.name, record);
  }
  insertKnownLocation({ campaignId: world.campaignId, name: "Before Dawn", layoutDescription: "A hilltop shrine facing east." });
  const moved = await world.invoke("move_party", { name: "Dawn", layoutDescription: "A fishing village." });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(getLocationByName(world.campaignId, "Before Dawn")?.layoutDescription, "A hilltop shrine facing east.");
  assert.equal(getLocationByName(world.campaignId, "Dawn")?.name, "Dawn");
});

await test("finding 8: reveal_item's gate and its math find the line one way: the line's name in any case is revealed; a part of it is refused.", async () => {
  world.patch(hero.id, { equipment: [{ name: "Anello opaco", qty: 1, identified: false }] });
  const partial = await ai("reveal_item", { characterId: hero.id, name: "Anello", revealedName: "Anello della protezione", srdName: "Ring of Protection", reason: "identify" }, hero);
  assert.ok(partial.error, "a part of the line's name was revealed");
  const whole = await ai("reveal_item", { characterId: hero.id, name: "ANELLO OPACO", revealedName: "Anello della protezione", srdName: "Ring of Protection", reason: "identify" }, hero);
  assert.equal(whole.ok, true, whole.error);
  assert.equal(carried("Anello della protezione").srdName, "Ring of Protection");
});

await test("finding 10: tags add to the row's tags: Arrows sent with consumable keep arrows; a silvered SRD weapon is silvered and still the weapon.", async () => {
  for (const name of ["Frecce +1", "Flèches +1", "Flechas +1", "Pfeile +1"]) {
    assert.deepEqual([...itemTags({ name, srdName: "Arrows", tags: ["consumable"] })].sort(), ["arrows", "carried", "consumable"], name);
  }
  for (const name of ["Spada lunga argentata", "Épée longue argentée", "Espada larga plateada", "Versilbertes Langschwert", "Silvered Longsword"]) {
    const item = { name, srdName: "Longsword", tags: ["silvered"] };
    assert.deepEqual(itemTags(item), ["silvered"], name);
    assert.equal(matchWeapon(item)?.name, "Longsword", name);
  }
  const granted = await ai("grant_item", { characterId: hero.id, name: "Spada lunga argentata", srdName: "Longsword", tags: ["silvered"], reason: "the smith" }, hero);
  assert.equal(granted.ok, true, granted.error);
  assert.deepEqual(carried("Spada lunga argentata").tags, ["silvered"]);
});

await test("finding 11: purchase is gated as grant_item is, and the bought line carries its row; a shelf line keeps the row its catalog pick named.", async () => {
  world.patch(hero.id, { gold: 500 });
  for (const item of ["Corda di canapa", "Corde de chanvre", "Cuerda de cáñamo", "Hanfseil"]) {
    const asked = await ai("purchase", { characterId: hero.id, item, price: 1, action: "buy", reason: "the market" }, hero);
    assert.equal(asked.retry, true, `${item}: bought without asking`);
    assert.match(asked.error, /srdName/);
    assert.equal(carried(item), undefined);
  }
  const bought = await ai("purchase", { characterId: hero.id, item: "Corda di canapa", srdName: "Rope, hempen (50 feet)", price: 1, action: "buy", reason: "the market" }, hero);
  assert.equal(bought.ok, true, bought.error);
  assert.equal(carried("Corda di canapa").srdName, "Rope, hempen (50 feet)");
  // A model that grants a bought item again leaves two, or trades something in besides: the result says it is done.
  assert.match(bought.note, /The trade is done: the server put it in .+'s pack and took the coin, and nothing else changed hands\. Do NOT call grant_item, modify_gold or handle_item for this trade\./);
  const shelf = normalizeStock([
    { itemName: "Lanterna schermabile", qty: 2, priceCp: 500, srdName: "lantern, hooded" },
    { itemName: "Pane", qty: 5, priceCp: 2 },
    { itemName: "Coltello", qty: 1, priceCp: 100, srdName: "Knife of Nowhere" },
  ]);
  assert.equal(shelf[0].srdName, "Lantern, Hooded", "the row's own spelling is stored");
  assert.equal("srdName" in shelf[1], false, "an old line parses without one");
  assert.equal("srdName" in shelf[2], false, "a name no list holds is no row");
  assert.equal(stockLineSchema.safeParse({ itemName: "Coltello", qty: 1, priceCp: 100, srdName: "Knife of Nowhere" }).success, false);
  const shop = insertShop(world.campaignId, { name: "Bottega di Lia", kind: "general", stock: shelf });
  const sold = await world.invoke("buy_item", { characterId: hero.id, shop: shop.name, item: "Lanterna schermabile" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(carried("Lanterna schermabile").srdName, "Lantern, Hooded");
});

await test("purchase carries srdName, described past the tool's first sentence; the compact profile keeps the field and cuts the description. Loot no list has, and a spell scroll, are granted with grant_item and paid for with modify_gold, at every table.", async () => {
  const purchase = resourceTools.find((entry) => entry.function.name === "purchase");
  assert.match(purchase.function.description, /srdName is the SRD or pack item it is, by its English name \('Longsword'\), sent with the first call/);
  const compact = compactTool(purchase);
  assert.deepEqual(Object.keys(compact.function.parameters.properties), Object.keys(purchase.function.parameters.properties));
  // At a shop or not since buy_item and sell_item folded into it (issue #471).
  assert.equal(compact.function.description, "Resolve a character buying or selling an item in one audited step.");
  world.patch(hero.id, { gold: 500 });
  for (const item of ["Portafortuna", "Porte-bonheur", "Amuleto de la suerte", "Glücksbringer", "Lucky charm"]) {
    const asked = await ai("purchase", { characterId: hero.id, item, price: 1, action: "buy", reason: "the market" }, hero);
    assert.equal(asked.retry, true, `${item}: bought without asking`);
    assert.match(asked.error, /loot no list has is granted with grant_item and paid for with modify_gold/);
    assert.equal(carried(item), undefined);
  }
  for (const item of ["Pergamena", "Parchemin", "Pergamino", "Schriftrolle", "Scroll"]) {
    const asked = await ai("purchase", { characterId: hero.id, item, srdName: "Spell Scroll", price: 50, action: "buy", reason: "the market" }, hero);
    assert.equal(asked.retry, true, `${item}: a scroll bought with no spell`);
    assert.match(asked.error, /grant it with grant_item and paid for with modify_gold, naming the spell/);
    assert.equal(carried(item), undefined);
  }
});

await test("Every item ODM's own class, pack and genre kits write is the row it names: the druid's Wooden Shield is a Shield.", async () => {
  const { CLASS_KITS, PACKS } = await import("../src/lib/srd/starting-kit-data.ts");
  const { GENRE_KITS } = await import("../src/lib/srd/genre-kits.ts");
  const { matchGear } = await import("../src/lib/srd/adventuring-gear.ts");
  const names = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      if (typeof value.name === "string" && typeof value.qty === "number") names.add(value.name);
      Object.values(value).forEach(walk);
    }
  };
  walk([CLASS_KITS, PACKS, GENRE_KITS]);
  // The setting kits' own gear, which no list prices or describes.
  const settingGear = ["Bullets", "Hacking Rig", "Drone Controls", "Medic's Kit", "Field Instruments", "Investigator's Kit", "Photographer's Kit", "Seance Kit"];
  assert.deepEqual([...names].filter((name) => !itemRow({ name }) && !matchGear(name)), settingGear);
  assert.equal(matchArmor({ name: "Wooden Shield" })?.name, "Shield");
});

await test("finding 12: a healing potion sent with tags alone is asked which potion it is; its row decides the tier, at every table.", async () => {
  for (const name of ["Pozione di guarigione superiore", "Potion de soins supérieurs", "Poción de curación mayor", "Großer Heiltrank", "Greater Healing Potion"]) {
    const asked = await ai("grant_item", { characterId: hero.id, name, tags: ["consumable", "potion", "healing_potion"], reason: "the chest" }, hero);
    assert.equal(asked.retry, true, `${name}: granted without its row`);
    assert.equal(consumableEffect({ name, srdName: "Potion of Greater Healing" }).expression, "4d4+4", name);
  }
  assert.equal(consumableEffect({ name: "Healing potion" }).kind, "generic", "a near spelling of the row's name is no row");
});

await test("finding 13: one reader takes a +N bonus from a name, wherever it stands, and every reader of a magic bonus calls it.", () => {
  for (const [name, bonus] of [["Spada lunga +1", 1], ["+2 Épée longue", 2], ["Escudo, +3", 3], ["Schild (+1)", 1], ["Razioni (+10 giorni)", 0], ["Freccia +12", 0]]) {
    assert.equal(magicItemBonus(name), bonus, name);
    assert.equal(looksMagical(name), bonus > 0, name);
  }
});

await test("srdName takes every weapon and armor as ODM's own tables name it (\"Light Crossbow\", the setting gear), at every table: none is refused with itself as the nearest, and a shelf keeps it.", async () => {
  for (const { name } of [...SRD_WEAPONS, ...SRD_ARMOR]) {
    const listed = srdNameFor(name, "grant_item");
    assert.ok(!("error" in listed), `${name}: ${listed.error}`);
  }
  for (const [name, srdName, weapon] of [
    ["Balestra leggera", "Light Crossbow", "Light Crossbow"],
    ["Arbalète de poing", "Hand Crossbow", "Hand Crossbow"],
    ["Ballesta pesada", "Heavy Crossbow", "Heavy Crossbow"],
    ["Revolver des Sheriffs", "Revolver", "Revolver"],
    ["Light Crossbow", "Crossbow, light", "Light Crossbow"],
  ]) {
    const out = await ai("grant_item", { characterId: hero.id, name, srdName, reason: "the armory" }, hero);
    assert.ok(!out.error, `${name}: ${out.error}`);
    assert.equal(matchWeapon(carried(name))?.name, weapon, name);
    const [line] = normalizeStock([{ itemName: name, qty: 1, priceCp: 100, srdName }]);
    assert.equal(matchWeapon({ name, srdName: line.srdName })?.name, weapon, `${name} on a shelf`);
  }
});

await test("a shelf line picked from the market's catalog carries the row the catalog says it is, and every pick saves: a family of +1 to +3 items and a homebrew item carry none, a renamed pick keeps its row at every table.", async () => {
  createHomebrew(world.owner.id, { kind: "item", name: "Moonsilver Lantern", data: { description: "A lantern.", rarity: "common", cost: "10 gp" } });
  world.signIn(world.owner);
  // Every item the editor's catalog offers, page by page, as it asks.
  const offered = [];
  for (let offset = 0; ; offset += 200) {
    const out = await call(content, "GET", undefined, { kind: "items" }, `http://test/api/content/items?${new URLSearchParams({ q: "", limit: "200", offset: String(offset), campaign: world.campaignId })}`);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    offered.push(...out.json.results);
    if (out.json.results.length < 200) break;
  }
  // As the editor adds a pick (MarketShopEditor.tsx).
  const picked = (entry, itemName = entry.name) => ({ itemName: itemName.slice(0, 80), qty: 1, priceCp: 100, note: "", ...(entry.srdName ? { srdName: entry.srdName } : {}) });
  const refused = offered.filter((entry) => !stockLineSchema.safeParse(picked(entry)).success).map((entry) => entry.name);
  assert.deepEqual(refused, []);
  const entry = (name) => offered.find((row) => row.name === name);
  assert.equal(entry("Moonsilver Lantern")?.srdName, undefined, "a homebrew item is no row");
  if (world.hasPack) {
    assert.ok(offered.length > 1000, `the catalog offered ${offered.length}`);
    assert.equal(entry("Weapon +1")?.srdName, undefined, "a family is no one row");
    assert.equal(entry("Shield +1")?.srdName, "Shield");
    const longsword = entry("Longsword");
    assert.equal(longsword?.srdName, "Longsword");
    for (const name of ["Spada lunga", "Épée longue", "Espada larga", "Langschwert", "Longsword"]) {
      const line = stockLineSchema.parse(picked(longsword, name));
      assert.equal(line.srdName, "Longsword", name);
    }
  }
});

await test("a magic item named at the table is priced by the rarity of the row srdName names, at every table: a purchase pays it, a +1 weapon its bonus's, and a grant's worth is refused, as for its English name.", async () => {
  if (!world.hasPack) {
    return;
  }
  for (const [name, srdName, paidCp] of [
    ["Mantello di protezione", "Cloak of Protection", 50000],
    ["Cape de protection", "Cloak of Protection", 50000],
    ["Capa de protección", "Cloak of Protection", 50000],
    ["Schutzumhang", "Cloak of Protection", 50000],
    ["Cloak of Protection", undefined, 50000],
    ["Spada lunga +1", "Longsword", 50000],
    ["Épée longue +1", "Longsword", 50000],
    ["Longsword +1", undefined, 50000],
  ]) {
    world.patch(hero.id, { gold: 1000, copper: 0 });
    const bought = await ai("purchase", { characterId: hero.id, action: "buy", item: name, ...(srdName ? { srdName } : {}), price: 1, qty: 1, reason: "the market" }, hero);
    assert.equal(bought.ok, true, `${name}: ${bought.error}`);
    const sheet = getSheetById(hero.id);
    assert.equal(100000 - (sheet.gold * 100 + (sheet.copper ?? 0)), paidCp, name);
    const gift = await ai("grant_item", { characterId: hero.id, name, ...(srdName ? { srdName } : {}), worth: 5, reason: "a gift" }, hero);
    assert.match(String(gift.error), /has a price the rules set/, name);
  }
});

finish();
