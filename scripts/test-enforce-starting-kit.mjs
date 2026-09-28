// A new character's free kit. Under the default `startingWealth`
// ("equipment") a hero starts with its class's and background's equipment
// (SRD 5.1, "Starting Equipment" in each class), with the either-or choices
// the player made. The kit used to be derived from the class's training
// (defaultLoadout and defaultArmor), so a barbarian, trained in medium armor
// and shields, started in scale mail with a shield and a longbow at AC 18.
// Now the class tables are data (src/lib/srd/starting-kit-data.ts), resolved
// in one place (src/lib/srd/starting-kit.ts) for the server, the builder and
// the engine's companions.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT, openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-starting-kit");
const { atTable, throughLibrary, call, sheetRoute, campaignId, player, world, clearSeat, characters, sheets } =
  await openCreation();
const builder = await openBuilder();
const srd = await import("../src/lib/srd/index.ts");
const { defaultArmor, matchArmor, isArmorProficient } = await import("../src/lib/srd/armor.ts");
const { defaultLoadout, matchWeapon, isWeaponProficient, SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const kits = await import("../src/lib/srd/starting-kit.ts");
const { customClassOptions } = await import("../src/lib/characters/options.ts");

// ---- the tables, against the SRD's text ----

// SRD 5.1, Equipment Packs.
const EXPLORER = ["Backpack", "Bedroll", "Mess Kit", "Tinderbox", "Torch x10", "Rations (1 day) x10", "Waterskin", "Rope, Hempen (50 feet)"];
const DUNGEONEER = ["Backpack", "Crowbar", "Hammer", "Piton x10", "Torch x10", "Tinderbox", "Rations (1 day) x10", "Waterskin", "Rope, Hempen (50 feet)"];
const BURGLAR = ["Backpack", "Ball Bearings (bag of 1000)", "String (10 feet)", "Bell", "Candle x5", "Crowbar", "Hammer", "Piton x10", "Lantern, Hooded", "Oil (flask) x2", "Rations (1 day) x5", "Tinderbox", "Waterskin", "Rope, Hempen (50 feet)"];
const DIPLOMAT = ["Chest", "Case, Map or Scroll x2", "Clothes, Fine", "Ink (1 ounce bottle)", "Ink Pen", "Lamp", "Oil (flask) x2", "Paper (one sheet) x5", "Perfume (vial)", "Sealing Wax", "Soap"];
const ENTERTAINER = ["Backpack", "Bedroll", "Clothes, Costume x2", "Candle x5", "Rations (1 day) x5", "Waterskin", "Disguise Kit"];
const PRIEST = ["Backpack", "Blanket", "Candle x10", "Tinderbox", "Alms Box", "Block of Incense x2", "Censer", "Vestments", "Rations (1 day) x2", "Waterskin"];
const SCHOLAR = ["Backpack", "Book", "Ink (1 ounce bottle)", "Ink Pen", "Parchment (one sheet) x10", "Little Bag of Sand", "Small Knife"];
const BOLTS = ["Light Crossbow", "Crossbow Bolts x20"];

// Each class: its lines, each line its options, each option what it holds.
// "<martial-melee>" is "any martial melee weapon"; "if:heavy-armor" marks
// "(if proficient)".
const SRD_KITS = {
  barbarian: [
    [["Greataxe"], ["<martial-melee>"]],
    [["Handaxe x2"], ["<simple>"]],
    [[...EXPLORER, "Javelin x4"]],
  ],
  bard: [
    [["Rapier"], ["Longsword"], ["<simple>"]],
    [DIPLOMAT, ENTERTAINER],
    [["Lute"], ["<instrument except Lute>"]],
    [["Leather", "Dagger"]],
  ],
  cleric: [
    [["Mace"], ["Warhammer", "if:warhammer"]],
    [["Scale Mail"], ["Leather"], ["Chain Mail", "if:heavy-armor"]],
    [BOLTS, ["<simple>"]],
    [PRIEST, EXPLORER],
    [["Shield", "Holy Symbol"]],
  ],
  druid: [
    [["Wooden Shield"], ["<simple>"]],
    [["Scimitar"], ["<simple-melee>"]],
    [["Leather", ...EXPLORER, "Druidic Focus"]],
  ],
  fighter: [
    [["Chain Mail"], ["Leather", "Longbow", "Arrows x20"]],
    [["Shield", "<martial>"], ["<martial>", "<martial>"]],
    [BOLTS, ["Handaxe x2"]],
    [DUNGEONEER, EXPLORER],
  ],
  monk: [
    [["Shortsword"], ["<simple>"]],
    [DUNGEONEER, EXPLORER],
    [["Dart x10"]],
  ],
  paladin: [
    [["Shield", "<martial>"], ["<martial>", "<martial>"]],
    [["Javelin x5"], ["<simple-melee>"]],
    [PRIEST, EXPLORER],
    [["Chain Mail", "Holy Symbol"]],
  ],
  ranger: [
    [["Scale Mail"], ["Leather"]],
    [["Shortsword x2"], ["<simple-melee>", "<simple-melee>"]],
    [DUNGEONEER, EXPLORER],
    [["Longbow", "Quiver", "Arrows x20"]],
  ],
  rogue: [
    [["Rapier"], ["Shortsword"]],
    [["Shortbow", "Quiver", "Arrows x20"], ["Shortsword"]],
    [BURGLAR, DUNGEONEER, EXPLORER],
    [["Leather", "Dagger x2", "Thieves' Tools"]],
  ],
  sorcerer: [
    [BOLTS, ["<simple>"]],
    [["Component Pouch"], ["Arcane Focus"]],
    [DUNGEONEER, EXPLORER],
    [["Dagger x2"]],
  ],
  warlock: [
    [BOLTS, ["<simple>"]],
    [["Component Pouch"], ["Arcane Focus"]],
    [SCHOLAR, DUNGEONEER],
    [["Leather", "Dagger x2", "<simple>"]],
  ],
  wizard: [
    [["Quarterstaff"], ["Dagger"]],
    [["Component Pouch"], ["Arcane Focus"]],
    [SCHOLAR, EXPLORER],
    [["Spellbook"]],
  ],
  // Tasha's Cauldron of Everything, Artificer: any two simple weapons; a
  // light crossbow and 20 bolts; studded leather or scale mail; thieves'
  // tools and a dungeoneer's pack.
  artificer: [
    [["<simple>", "<simple>"]],
    [BOLTS],
    [["Studded Leather"], ["Scale Mail"]],
    [["Thieves' Tools", ...DUNGEONEER]],
  ],
};

const optionView = (option) => [
  ...option.items.map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name)),
  ...(option.slots ?? []).map((slot) => `<${slot.filter}${slot.except ? ` except ${slot.except.join(", ")}` : ""}>`),
  ...(option.requires ? [`if:${option.requires}`] : []),
];

await test("every SRD class's starting equipment is the SRD 5.1 list, choice for choice, with the packs written out as their contents", () => {
  for (const [classId, expected] of Object.entries(SRD_KITS)) {
    const kit = kits.classKitFor(classId);
    assert.ok(kit, classId);
    assert.equal(kit.source, classId === "artificer" ? "published" : "srd", classId);
    assert.deepEqual(kit.lines.map((line) => line.options.map(optionView)), expected, classId);
  }
});

await test("A barbarian's starting equipment (SRD 5.1) is a greataxe or a martial melee weapon, two handaxes or a simple weapon, an explorer's pack and four javelins: no armor and no shield.", () => {
  const barbarian = srd.findClass("barbarian");
  const kit = kits.classKitFor("barbarian");
  // Whatever the choices, nothing in it is armor.
  const everything = kit.lines.flatMap((line) => line.options.flatMap((option) => option.items.map((item) => item.name)));
  assert.deepEqual(everything.filter((name) => matchArmor(name)), []);
  const resolved = kits.startingKitFor(barbarian, null);
  assert.deepEqual(resolved.items.filter((item) => matchArmor(item.name)).map((item) => item.name), []);
  assert.deepEqual(
    resolved.items.filter((item) => matchWeapon(item.name)).map((item) => `${item.name} x${item.qty}`),
    ["Greataxe x1", "Handaxe x2", "Javelin x4"],
  );
});

await test("an 'any martial melee weapon' choice is a pick from the weapon table's martial melee weapons, and a weapon outside it is refused", () => {
  const slot = { filter: "martial-melee", default: "Battleaxe" };
  const offered = kits.slotChoices(slot);
  const expected = SRD_WEAPONS.filter((weapon) => weapon.category === "martial" && weapon.kind === "melee").map((weapon) => weapon.name);
  assert.deepEqual(offered, expected);
  assert.ok(!offered.includes("Longbow") && offered.includes("Greataxe"));
  // SRD simple weapons only: the setting's machete is not "any simple weapon".
  assert.ok(!kits.slotChoices({ filter: "simple", default: "Spear" }).includes("Machete"));
  const barbarian = srd.findClass("barbarian");
  const took = kits.startingKitFor(barbarian, { options: [1, 0, 0], picks: ["Maul"] });
  assert.deepEqual(took.problems, []);
  assert.ok(took.items.some((item) => item.name === "Maul") && !took.items.some((item) => item.name === "Greataxe"));
  const wrong = kits.startingKitFor(barbarian, { options: [1, 0, 0], picks: ["Longbow"] });
  assert.equal(wrong.problems.length, 1, wrong.problems.join(" "));
  const outside = kits.startingKitFor(barbarian, { options: [2, 0, 0], picks: [] });
  assert.equal(outside.problems.length, 1, outside.problems.join(" "));
});

await test("a cleric takes chain mail or a warhammer from the kit only when trained for it (SRD 5.1, '(if proficient)')", () => {
  const cleric = srd.findClass("cleric");
  const chain = { options: [0, 2, 0, 0, 0], picks: [] };
  assert.equal(kits.startingKitFor(cleric, chain).problems.length, 1);
  assert.deepEqual(kits.startingKitFor(cleric, chain, "Life Domain").problems, []);
  const hammer = { options: [1, 0, 0, 0, 0], picks: [] };
  assert.equal(kits.startingKitFor(cleric, hammer).problems.length, 1);
  assert.deepEqual(kits.startingKitFor(cleric, hammer, "War Domain").problems, []);
});

await test("each of ODM's setting classes starts with a small fixed kit of its own, every weapon and armor in it one its training covers", () => {
  const settingClasses = customClassOptions();
  assert.equal(settingClasses.length, 36);
  for (const klass of settingClasses) {
    const kit = kits.classKitFor(klass.id);
    assert.ok(kit, klass.id);
    assert.equal(kit.source, "odm", klass.id);
    assert.ok(kit.lines.every((line) => line.options.length === 1 && !line.options[0].slots), klass.id);
    const items = kits.startingKitFor(klass, null).items;
    const weapons = items.map((item) => matchWeapon(item.name)).filter(Boolean);
    assert.ok(weapons.length >= 1, `${klass.id} starts unarmed`);
    for (const weapon of weapons) {
      assert.ok(isWeaponProficient(klass.weapons, weapon), `${klass.id}: ${weapon.name}`);
    }
    for (const armor of items.map((item) => matchArmor(item.name)).filter(Boolean)) {
      assert.ok(isArmorProficient(klass.armor, armor), `${klass.id}: ${armor.name}`);
    }
  }
});

await test("a class no table describes (a content pack's own) starts with what its training suggests", () => {
  const packClass = { id: "marshal", armor: ["light", "medium", "shields"], weapons: ["simple", "martial"] };
  const kit = kits.startingKitFor(packClass, null);
  assert.equal(kit.tabled, false);
  assert.deepEqual(
    kit.items.map((item) => item.name),
    [...defaultLoadout(packClass.weapons), ...defaultArmor(packClass.armor)].map((item) => item.name),
  );
});

await test("a pack's hammer and censer are gear, not the light hammer or the censer mace", () => {
  assert.equal(matchWeapon("Hammer"), null);
  assert.equal(matchWeapon("Censer"), null);
  assert.equal(matchWeapon("Light Hammer")?.name, "Light Hammer");
  assert.equal(matchWeapon("Censer Mace")?.name, "Censer Mace");
});

// ---- the builder and the server ----

const HERO = {
  race: "dragonborn",
  background: "acolyte",
  racialAncestry: "red",
  bonusLanguages: ["Giant", "Sylvan"],
};

await test("a barbarian's armor class at creation is 10 + Dexterity + Constitution (Unarmored Defense), in the builder and on the stored sheet", async () => {
  const built = builder.build({ ...HERO, class: "barbarian", chosenSkills: ["athletics", "survival"] });
  assert.equal(built.blocker, null);
  const { dex, con } = built.sheet.abilities;
  const expected = 10 + abilityMod(dex) + abilityMod(con);
  assert.equal(built.derived.ac, expected);
  assert.ok(!built.sheet.equipment.some((item) => matchArmor(item.name)), JSON.stringify(built.sheet.equipment));
  const outcome = await atTable(built.sheet);
  assert.equal(outcome.status, 201, outcome.error);
  assert.equal(outcome.sheet.ac, expected);
  assert.ok(outcome.sheet.equipment.some((item) => item.name === "Greataxe"));
});

await test("a fighter who chooses chain mail and two martial weapons has armor class 16; leather and a longbow instead is 11 + Dexterity", async () => {
  const fighter = (kitChoices) =>
    builder.build({ ...HERO, class: "fighter", chosenSkills: ["athletics", "perception"], stylePicks: ["archery"], kitChoices });
  const mail = fighter({ options: [0, 1, 0, 0], picks: ["Longsword", "Battleaxe"] });
  assert.equal(mail.blocker, null);
  assert.equal(mail.derived.ac, 16);
  const names = mail.sheet.equipment.map((item) => item.name);
  assert.ok(names.includes("Chain Mail") && names.includes("Battleaxe") && !names.includes("Shield"), names.join(", "));
  const stored = await throughLibrary(mail.sheet);
  assert.equal(stored.status, 201, stored.error);
  assert.equal(stored.sheet.ac, 16);
  // The choices are stored with the library character, as racial choices are.
  assert.deepEqual(stored.character.sheet.kitChoices, { options: [0, 1, 0, 0], picks: ["Longsword", "Battleaxe"] });
  const leather = fighter({ options: [1, 0, 0, 0], picks: ["Longsword"] });
  assert.equal(leather.derived.ac, 11 + abilityMod(leather.sheet.abilities.dex) + 2);
  const posted = await atTable(leather.sheet);
  assert.equal(posted.status, 201, posted.error);
  assert.equal(posted.sheet.ac, 11 + abilityMod(leather.sheet.abilities.dex) + 2);
});

await test("a request claiming gear outside its class kit without the gold to buy it is refused, and nothing is stored", async () => {
  // Chain mail and the longbow of the other option, with the soldier's 10 gp.
  const both = await atTable({ ...LEGAL_FIGHTER, equipment: [...LEGAL_FIGHTER.equipment, { name: "Longbow", qty: 1 }] });
  assert.equal(both.status, 400);
  assert.equal(both.sheet, null);
  // A choice the book does not print.
  const invented = await atTable({ ...LEGAL_FIGHTER, kitChoices: { options: [3, 0, 0, 0], picks: [] } });
  assert.equal(invented.status, 400);
  assert.equal(invented.sheet, null);
  // "A martial weapon" named as a club, which is a simple one.
  const club = await atTable({ ...LEGAL_FIGHTER, kitChoices: { options: [0, 0, 0, 0], picks: ["Club"] } });
  assert.equal(club.status, 400);
  // A barbarian claiming the old training loadout: scale mail, a shield and a longbow.
  const oldLoadout = builder.build({ ...HERO, class: "barbarian", chosenSkills: ["athletics", "survival"] }).sheet;
  const claimed = await atTable({
    ...oldLoadout,
    equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Scale Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  });
  assert.equal(claimed.status, 400);
  assert.equal(claimed.sheet, null);
  // The legal fighter itself, with no choices sent, is the book's first options.
  const legal = await atTable(LEGAL_FIGHTER);
  assert.equal(legal.status, 201, legal.error);
  // Chain mail 16, a shield 2, and the Defense style's 1 while armored.
  assert.equal(legal.sheet.ac, 19);
});

await test("a library character stored before class kits keeps its gear when it comes to the table", async () => {
  // Written the way the old builder wrote a barbarian: the training loadout.
  const built = builder.build({ ...HERO, class: "barbarian", chosenSkills: ["athletics", "survival"] }).sheet;
  const old = {
    ...built,
    portrait: PORTRAIT,
    equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Scale Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  };
  delete old.kitChoices;
  const stored = characters.createCharacter(player.id, 1, old);
  clearSeat();
  world.signIn(player);
  const seated = await call(sheetRoute, "POST", { libraryCharacterId: stored.id }, { campaignId });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  const sheet = sheets.getSheetForUser(campaignId, player.id);
  assert.deepEqual(
    sheet.equipment.map((item) => item.name),
    ["Longsword", "Longbow", "Scale Mail", "Shield"],
  );
  // Its armor class follows the gear it kept: scale mail, Dexterity up to +2, a shield.
  assert.equal(sheet.ac, 14 + Math.min(2, abilityMod(old.abilities.dex)) + 2);
});

finish();
