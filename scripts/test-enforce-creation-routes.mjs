// What the server accepts as a new character: the numbers on the sheet.
//
// A level 1 character under SRD 5.1 is arithmetic, not opinion. Six ability
// scores come from the standard array, the 27-point buy or 4d6-drop-lowest,
// so each sits between 3 and 18 before the race's bonus and none passes 20.
// Hit points are the class's hit die at its maximum plus the Constitution
// modifier. There is one hit die per level, of the class's size. The level is
// the table's starting level. Everything the engine owns afterwards (XP,
// current hit points, conditions, resource counters) starts where the engine
// puts it, whatever the request says.
//
// Two doors lead in, POST /api/campaigns/[campaignId]/sheet and
// POST /api/characters, and both take the sheet whole from the client
// (src/lib/schemas/sheet.ts createSheetSchema). The builder shows the right
// numbers; this file asks what a request that never went through the builder
// can store. Each gap() posts one illegal sheet and asserts that it is either
// refused or stored corrected; today it is stored as sent.
//
// ODM's own rule, pinned below: the builder lets a player type Max HP, AC and
// gold ("the player can adjust before saving", schemas/sheet.ts), and a typed
// AC pins the armor engine off (acOverride). SRD 5.1 has no such knob. The
// knobs are recorded as gaps because nothing bounds them: the same request
// that may nudge a number may set 500 hit points at level 1.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, LEGAL_WIZARD, openCreation } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-enforce-creation-routes");
const table = await openCreation();
const { world, campaignId, player, atTable, throughLibrary, call, sheetRoute, sheets } = table;

const scores = (value) => ({ str: value, dex: value, con: value, int: value, wis: value, cha: value });

// Refused, or stored as the rule has it: either is enforcement.
function holds(outcome, legal, message) {
  if (outcome.status >= 400) {
    assert.equal(outcome.sheet, null, "a refused character must not be stored");
    return;
  }
  assert.ok(outcome.sheet, "accepted but nothing stored");
  assert.ok(legal(outcome.sheet), `${message} (stored: ${JSON.stringify(legalView(outcome.sheet))})`);
}
const legalView = (sheet) => ({
  level: sheet.level, abilities: sheet.abilities, maxHp: sheet.maxHp, ac: sheet.ac,
  hitDice: sheet.hitDice, gold: sheet.gold, speed: sheet.speed,
});

// ---- what is enforced today ----

await test("a legal level 1 fighter is stored with what the engine grants", async () => {
  const { status, sheet } = await atTable(LEGAL_FIGHTER);
  assert.equal(status, 201);
  assert.equal(sheet.level, 1);
  assert.equal(sheet.xp, 0);
  // 10 (d10 at its maximum) + 2 (CON 14).
  assert.equal(sheet.maxHp, 10 + abilityMod(14));
  assert.equal(sheet.currentHp, sheet.maxHp);
  assert.equal(sheet.tempHp, 0);
  assert.deepEqual(sheet.conditions, []);
  assert.equal(sheet.deathSaves, null);
  assert.equal(sheet.exhaustion, 0);
  const names = sheet.features.map((feature) => feature.name);
  // SRD 5.1 fighter, level 1: Fighting Style and Second Wind.
  for (const granted of ["Fighting Style", "Second Wind", "Military Rank (Soldier)"]) {
    assert.ok(names.includes(granted), `missing ${granted}`);
  }
  assert.ok(!names.includes("Action Surge"), "Action Surge is a level 2 feature");
  assert.deepEqual(sheet.resources.second_wind, { max: 1, used: 0 });
});

await test("nobody signed in, and nobody from outside the table, makes a character here", async () => {
  table.clearSeat();
  globalThis.__odmTestToken = "";
  const anonymous = await call(sheetRoute, "POST", LEGAL_FIGHTER, { campaignId });
  assert.equal(anonymous.status, 401);
  const stranger = world.addUser("stranger");
  world.signIn(stranger);
  const outside = await call(sheetRoute, "POST", LEGAL_FIGHTER, { campaignId });
  assert.equal(outside.status, 404);
  assert.equal(sheets.listSheets(campaignId).length, 0);
});

await test("a player fields one character: the second is refused and the first untouched", async () => {
  const first = await atTable(LEGAL_FIGHTER);
  assert.equal(first.status, 201);
  world.signIn(player);
  const second = await call(sheetRoute, "POST", { ...LEGAL_WIZARD, name: "Second" }, { campaignId });
  assert.equal(second.status, 409);
  const held = sheets.listSheetsForUser(campaignId, player.id);
  assert.equal(held.length, 1);
  assert.equal(held[0].id, first.sheet.id);
  assert.equal(held[0].name, LEGAL_FIGHTER.name);
});

await test("values outside the sheet's hard bounds are refused and nothing is stored", async () => {
  const bad = {
    "an ability score of 0": { abilities: { ...LEGAL_FIGHTER.abilities, str: 0 } },
    "an ability score of 31": { abilities: { ...LEGAL_FIGHTER.abilities, str: 31 } },
    "a fractional ability score": { abilities: { ...LEGAL_FIGHTER.abilities, str: 15.5 } },
    "a negative ability score": { abilities: { ...LEGAL_FIGHTER.abilities, str: -4 } },
    "five ability scores": { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10 } },
    "no hit points": { maxHp: 0 },
    "501 hit points": { maxHp: 501 },
    "armor class 0": { ac: 0 },
    "armor class 31": { ac: 31 },
    "a d20 hit die": { hitDice: { die: "d20", total: 1, spent: 0 } },
    "a d4 hit die": { hitDice: { die: "d4", total: 1, spent: 0 } },
    "no hit dice": { hitDice: { die: "d10", total: 0, spent: 0 } },
    "21 hit dice": { hitDice: { die: "d10", total: 21, spent: 0 } },
    "negative hit dice spent": { hitDice: { die: "d10", total: 1, spent: -1 } },
    "negative gold": { gold: -1 },
    "fractional gold": { gold: 10.5 },
    "100 copper": { copper: 100 },
    "negative speed": { speed: -5 },
    "a seventh saving throw": { proficiencies: { ...LEGAL_FIGHTER.proficiencies, saves: ["str", "dex", "con", "int", "wis", "cha", "str"] } },
    "a save in an ability that does not exist": { proficiencies: { ...LEGAL_FIGHTER.proficiencies, saves: ["luck"] } },
    "a nineteenth skill": { proficiencies: { ...LEGAL_FIGHTER.proficiencies, skills: Array.from({ length: 19 }, (_, index) => `skill_${index}`) } },
    "no name": { name: "   " },
    "no race": { race: "" },
    "no class": { class: "" },
    "an item carried zero times": { equipment: [{ name: "Rope", qty: 0 }] },
    "a sixth ability score improvement": { asiChoices: Array.from({ length: 6 }, () => ({ mode: "plus2", ability: "str" })) },
  };
  for (const [label, overrides] of Object.entries(bad)) {
    const outcome = await atTable({ ...LEGAL_FIGHTER, ...overrides });
    assert.equal(outcome.status, 400, `${label} was answered ${outcome.status}`);
    assert.equal(outcome.sheet, null, `${label} was stored`);
  }
});

await test("the engine's own state cannot be written through the creation request", async () => {
  const { status, sheet } = await atTable({
    ...LEGAL_FIGHTER,
    level: 20,
    xp: 355000,
    currentHp: 400,
    tempHp: 50,
    conditions: ["invisible"],
    conditionMeta: { invisible: { rounds: 100 } },
    resources: { second_wind: { max: 9, used: 0 }, rage: { max: 6, used: 0 } },
    exhaustion: 3,
    deathSaves: { successes: 3, failures: 0, stable: true, dead: false },
    concentratingOn: "Haste",
    wildShape: { form: "Dragon", beastHp: 300, beastMaxHp: 300, beastAc: 22 },
    pets: [{ name: "Rex", kind: "other", form: "tyrannosaurus", hp: 136, maxHp: 136, ac: 13, speed: 50 }],
    isCompanion: true,
    userId: world.owner.id,
    campaignId: "another-campaign",
  });
  assert.equal(status, 201);
  assert.equal(sheet.level, 1);
  assert.equal(sheet.xp, 0);
  assert.equal(sheet.currentHp, 12);
  assert.equal(sheet.tempHp, 0);
  assert.deepEqual(sheet.conditions, []);
  assert.deepEqual(sheet.conditionMeta, {});
  assert.deepEqual(sheet.resources, { second_wind: { max: 1, used: 0 } });
  assert.equal(sheet.exhaustion, 0);
  assert.equal(sheet.deathSaves, null);
  assert.equal(sheet.concentratingOn, null);
  assert.equal(sheet.wildShape, null);
  assert.deepEqual(sheet.pets, []);
  assert.equal(sheet.isCompanion, false);
  assert.equal(sheet.userId, player.id);
  assert.equal(sheet.campaignId, campaignId);
});

await test("an unpinned armor class is the engine's, whatever number the request carries", async () => {
  // Chain mail 16, shield +2, the Defense fighting style +1.
  const { sheet } = await atTable({ ...LEGAL_FIGHTER, ac: 30, acOverride: false });
  assert.equal(sheet.ac, 16 + 2 + 1);
  assert.equal(sheet.acOverride, false);
  // Out of the armor: 10 + DEX 15's +2, and the style no longer counts.
  const bare = await atTable({ ...LEGAL_FIGHTER, ac: 30, acOverride: false, equipment: [] });
  assert.equal(bare.sheet.ac, 10 + abilityMod(15));
});

const veterans = await openCreation({ campaign: { startingLevel: 5 } });

await test("the table's starting level is the character's level, with that level's features", async () => {
  const { status, sheet } = await veterans.atTable({ ...LEGAL_FIGHTER, subclass: "Champion", level: 1 });
  assert.equal(status, 201);
  assert.equal(sheet.level, 5);
  const names = sheet.features.map((feature) => feature.name);
  // SRD 5.1 fighter: Action Surge at 2, the archetype at 3 (Champion's
  // Improved Critical), an improvement at 4, Extra Attack at 5.
  for (const granted of ["Second Wind", "Action Surge", "Improved Critical", "Extra Attack"]) {
    assert.ok(names.some((name) => name.startsWith(granted)), `missing ${granted}`);
  }
  assert.ok(!names.some((name) => name.startsWith("Indomitable")), "Indomitable is a level 9 feature");
  assert.deepEqual(sheet.resources.action_surge, { max: 1, used: 0 });
});

// ---- ability scores ----

await test("No ability score passes 20 at creation: 18 is the most any method gives, a race adds at most 2, and improvements stop at 20.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, abilities: scores(30) });
  holds(outcome, (sheet) => Object.values(sheet.abilities).every((score) => score <= 20), "scores above 20 at level 1");
});

await test("The cap is 20 exactly: a single score of 21 is already over it.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, abilities: { ...LEGAL_FIGHTER.abilities, str: 21 } });
  holds(outcome, (sheet) => sheet.abilities.str <= 20, "STR 21 at level 1");
});

await test("Ability scores are the standard array, a 27-point buy or six 4d6-drop-lowest rolls, plus the race's bonus: the server holds a character to one of them.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, abilities: scores(19) });
  holds(outcome, (sheet) => Object.values(sheet.abilities).some((score) => score < 19), "six 19s with no roll on record");
});

await test("No method produces a score under 3 (three 1s on the kept dice), and no SRD race lowers one.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, abilities: { ...LEGAL_FIGHTER.abilities, cha: 1 } });
  holds(outcome, (sheet) => sheet.abilities.cha >= 3, "CHA 1 at level 1");
});

// ---- hit points and hit dice ----

await test("Hit points at 1st level are the hit die's maximum plus the Constitution modifier; each later level adds at most one more die and modifier.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, maxHp: 500 });
  // The most the dice could ever give: a full die and modifier every level,
  // with room for Tough (+2 a level) and Dwarven Toughness (+1 a level).
  const ceiling = (sheet) => sheet.level * (10 + abilityMod(sheet.abilities.con) + 3);
  holds(outcome, (sheet) => sheet.maxHp <= ceiling(sheet), "hit points beyond anything the dice allow");
});

await test("A class has one hit die: d6 for a wizard or sorcerer, d12 for a barbarian alone.", async () => {
  const outcome = await atTable({ ...LEGAL_WIZARD, hitDice: { die: "d12", total: 1, spent: 0 } });
  holds(outcome, (sheet) => sheet.hitDice.die === "d6", "a wizard with a d12 hit die");
});

await test("A character has as many hit dice as levels.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, hitDice: { die: "d10", total: 20, spent: 0 } });
  holds(outcome, (sheet) => sheet.hitDice.total === sheet.level, "20 hit dice at level 1");
  const veteran = await veterans.atTable({ ...LEGAL_FIGHTER, subclass: "Champion" });
  assert.equal(veteran.sheet.hitDice.total, 5, "a level 5 character stored with one hit die");
});

await test("Hit dice spent never exceed hit dice held.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, hitDice: { die: "d10", total: 1, spent: 20 } });
  holds(outcome, (sheet) => sheet.hitDice.spent <= sheet.hitDice.total, "20 of 1 hit dice spent");
});

// ---- the knobs ----

await test("Armor class is what the armor, shield and Dexterity make it; at level 1 no SRD combination passes 21.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, ac: 30, acOverride: true });
  // Plate 18, shield +2, Defense +1: the best a level 1 character can wear.
  holds(outcome, (sheet) => sheet.ac <= 21, "AC 30 at level 1");
  const unflagged = await atTable({ ...LEGAL_FIGHTER, ac: 30, acOverride: undefined });
  holds(unflagged, (sheet) => sheet.ac <= 21, "AC 30 with no flag sent");
});

await test("A new character carries the background's purse (5 to 25 gp), or rolls starting wealth instead of equipment: at most 5d4 x 10 = 200 gp.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, gold: 1000000 });
  holds(outcome, (sheet) => sheet.gold <= 225, "a million gold pieces at level 1");
});

await test("Walking speed comes from the race: 30 feet for a human, 25 for a dwarf, halfling or gnome, 35 for a wood elf.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, speed: 120 });
  holds(outcome, (sheet) => sheet.speed === 30, "a human with 120 feet of speed");
});

// ---- the library door ----

await test("A character made in the library is held to the same rules when it sits down at a table.", async () => {
  const same = await throughLibrary({ ...LEGAL_FIGHTER, abilities: scores(30), maxHp: 500 }, 1);
  holds(same, (sheet) => sheet.maxHp <= 20 && Object.values(sheet.abilities).every((score) => score <= 20), "a library character at its own level");
});

await test("a library character built at level 20 joins a level 1 table at level 1", async () => {
  const { status, sheet, character } = await throughLibrary(
    { ...LEGAL_FIGHTER, subclass: "Champion", maxHp: 204, hitDice: { die: "d10", total: 20, spent: 0 } },
    20,
  );
  assert.equal(status, 201);
  assert.equal(character.level, 20);
  assert.equal(sheet.level, 1);
  assert.deepEqual(sheet.hitDice, { die: "d10", total: 1, spent: 0 });
  assert.equal(sheet.maxHp, 10 + abilityMod(14));
  const names = sheet.features.map((feature) => feature.name);
  assert.ok(!names.some((name) => name.startsWith("Extra Attack")), "Extra Attack at level 1");
  assert.deepEqual(Object.keys(sheet.resources), ["second_wind"]);
});

veterans.world.close();
world.close();
finish();
