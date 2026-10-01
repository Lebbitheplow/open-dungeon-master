// What the DM's and the builder's screens compute, held to what the engine
// does (wave 2 of the second rules-enforcement repair, workstream ui-dm).
//
// The screens used to keep their own copies of the rules, and the copies
// drifted: the level-up dialog never offered an Eldritch Knight a spell,
// counted a high elf's cantrip against the wizard's, read expertise from one
// class, and left the hill dwarf's hit point out of its preview; the lead's
// Adjust dialog wiped worn and attuned flags and capped spells by the wrong
// table. Each screen now calls a pure module; this suite drives those
// modules, and the one server change (a level-up leaves the race's innate
// cantrips out of the class count) through the real route.
import assert from "node:assert/strict";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-ui-dm");

const preview = await import("../src/app/campaigns/[campaignId]/level-up-preview.ts");
const leadEdit = await import("../src/app/campaigns/[campaignId]/lead-edit-logic.ts");
const { freeCantripCount } = await import("../src/lib/srd/free-cantrips.ts");
const { openOptionSlots } = await import("../src/lib/srd/options.ts");
const { heroInput } = await import("./lib/enforce-world.mjs");

const SCORES = { str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 10 };
const sheetOf = (overrides = {}) => ({
  id: "c1",
  userId: "u1",
  level: 1,
  xp: 0,
  currentHp: 10,
  tempHp: 0,
  racialChoices: undefined,
  ...heroInput({ abilities: SCORES, ...overrides }),
  // heroInput leaves the level to createSheet; a bare sheet carries it.
  level: overrides.level ?? 1,
  abilities: { ...SCORES, ...(overrides.abilities ?? {}) },
});

// ---- U:UB1 third casters get spells ----

await test("an Eldritch Knight at fighter 3 learns 2 wizard cantrips and 3 spells of 1st level", () => {
  const caster = preview.casterPreview({ classId: "fighter", subclass: "Eldritch Knight", level: 3, abilitiesAfter: SCORES });
  assert.equal(caster.casts, true);
  assert.equal(caster.list, "wizard");
  assert.equal(caster.ability, "int");
  assert.equal(caster.style, "known");
  assert.equal(caster.cantripCap, 2);
  assert.deepEqual(caster.spellCap?.count, 3);
  assert.equal(caster.maxLevel, 1);
});

await test("an Arcane Trickster knows one cantrip more (Mage Hand), and a fighter without the subclass casts nothing", () => {
  assert.equal(preview.casterPreview({ classId: "rogue", subclass: "Arcane Trickster", level: 3, abilitiesAfter: SCORES }).cantripCap, 3);
  assert.equal(preview.casterPreview({ classId: "fighter", subclass: "Champion", level: 3, abilitiesAfter: SCORES }).casts, false);
  assert.equal(preview.casterPreview({ classId: "fighter", subclass: "Eldritch Knight", level: 7, abilitiesAfter: SCORES }).maxLevel, 2);
});

const { builderCasting, builderSpellAdvice } = await import("../src/app/characters/builder/casting.ts");

await test("the builder builds an Eldritch Knight 3 with wizard spells: 2 cantrips, 3 spells, 1st-level slots", () => {
  const fighter = { id: "fighter", spellAbility: null, casterType: "none" };
  const casting = builderCasting(fighter, "Eldritch Knight", 3);
  assert.equal(casting.casts, true);
  assert.equal(casting.list, "wizard");
  assert.equal(casting.ability, "int");
  assert.equal(casting.cantripCap, 2);
  assert.equal(casting.maxSpellLevel, 1);
  assert.equal(builderSpellAdvice(casting, fighter, "Eldritch Knight", 3, SCORES)?.count, 3);
  assert.equal(builderCasting(fighter, "Champion", 3).casts, false);
  assert.equal(builderCasting({ id: "rogue", spellAbility: null, casterType: "none" }, "Arcane Trickster", 3).cantripCap, 3);
  // Every other class reads as it did.
  const wizard = builderCasting({ id: "wizard", spellAbility: "int", casterType: "full" }, "", 1);
  assert.deepEqual([wizard.casts, wizard.list, wizard.cantripCap, wizard.maxSpellLevel], [true, "wizard", 3, 1]);
  assert.equal(builderCasting({ id: "paladin", spellAbility: "cha", casterType: "half" }, "", 1).casts, false);
});

// ---- U:UB2 / UB3 racial and innate cantrips are free ----

await test("a high elf's racial cantrip is left out of the wizard's count", () => {
  const elf = { race: "high_elf", level: 3, racialChoices: { cantrip: "Light" } };
  assert.equal(preview.freeCantripsIn(elf, ["Light", "Fire Bolt", "Mage Hand", "Prestidigitation"]), 1);
  // Not in this list (a second caster's), nothing to leave out beyond the
  // race's own count.
  assert.equal(freeCantripCount({ ...elf, spellcasting: null }, 0), 0);
});

await test("a tiefling's Thaumaturgy is left out of the warlock's count", () => {
  const tiefling = { race: "tiefling", level: 4, racialChoices: { cantrip: "" } };
  assert.equal(preview.freeCantripsIn(tiefling, ["Thaumaturgy", "Eldritch Blast", "Mage Hand"]), 1);
  assert.equal(preview.freeCantripsIn(tiefling, ["Eldritch Blast", "Mage Hand"]), 0);
});

if (hasPack) {
  const world = await openWorld();
  const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
  await test("the level-up route lets a tiefling warlock 4 learn her third class cantrip beside Thaumaturgy", async () => {
    const hero = world.addHero({
      race: "tiefling",
      class: "warlock",
      level: 3,
      abilities: { cha: 16, con: 14 },
      hitDice: { die: "d8", total: 3, spent: 0 },
      spellcasting: {
        ability: "cha",
        slots: {},
        pact: { level: 2, max: 2, used: 0 },
        known: ["Hex", "Armor of Agathys", "Hellish Rebuke", "Misty Step"],
        prepared: [],
        cantrips: ["Thaumaturgy", "Eldritch Blast", "Mage Hand"],
      },
    });
    const awarded = await world.invoke("award_xp", { characterIds: [hero.id], amount: 2700, reason: "earned" });
    assert.equal(awarded.ok, true, awarded.error);
    const out = await patchSheetAs(world, sheetRoute, world.owner, {
      level: 4,
      levelUpClass: "warlock",
      levelUpSpells: ["Minor Illusion"],
    });
    assert.equal(out.status, 200, out.json.error);
    const stored = world.sheet(hero.id);
    assert.ok(stored.spellcasting.cantrips.includes("Minor Illusion"), stored.spellcasting.cantrips.join(", "));
  });
}

// ---- U:UB4 expertise across classes ----

await test("a rogue 6 taking bard 3 has bard's two expertise picks on top of the rogue's four", () => {
  const rogue = sheetOf({ class: "rogue", proficiencies: { saves: [], skills: ["stealth", "acrobatics", "perception", "insight", "deception", "persuasion"], expertise: ["stealth", "acrobatics", "perception", "insight"], languages: [], tools: [], armor: [], weapons: [] } });
  assert.equal(preview.expertiseOpen(rogue, [{ id: "rogue", subclass: "", level: 6 }, { id: "bard", subclass: "", level: 3 }]), 2);
  assert.equal(preview.expertiseOpen(rogue, [{ id: "rogue", subclass: "", level: 6 }, { id: "bard", subclass: "", level: 2 }]), 0);
});

// ---- U:UB5 hit point preview with every per-level bonus ----

await test("a hill dwarf fighter's preview adds the dwarf's point: average 6 + CON 2 + 1", () => {
  const dwarf = sheetOf({ race: "hill_dwarf", class: "fighter", level: 3, hitDice: { die: "d10", total: 3, spent: 0 } });
  const hp = preview.levelUpHpPreview({
    sheet: dwarf, hitDie: 10, method: "average", abilitiesAfter: dwarf.abilities, featsAfter: [],
    classesAfter: [{ id: "fighter", subclass: "", level: 4 }], targetLevel: 4,
  });
  assert.equal(hp.fixed, 9);
  assert.equal(hp.min, 4);
  assert.equal(hp.max, 13);
});

await test("Tough taken this level adds two a level, the levels already held included", () => {
  const fighter = sheetOf({ class: "fighter", level: 3, hitDice: { die: "d10", total: 3, spent: 0 } });
  const after = preview.abilitiesAfterLevel(fighter, [{ mode: "feat", feat: "Tough" }], { id: "fighter", level: 4 });
  const hp = preview.levelUpHpPreview({
    sheet: fighter, hitDie: 10, method: "average", abilitiesAfter: after.abilities, featsAfter: after.feats,
    classesAfter: [{ id: "fighter", subclass: "", level: 4 }], targetLevel: 4,
  });
  // 6 + 2 + 2 for the new level, and 2 x 3 back pay.
  assert.equal(hp.fixed, 16);
});

await test("a Constitution raised by this level's improvement pays back every level held", () => {
  const fighter = sheetOf({ class: "fighter", level: 3, abilities: { con: 15 }, hitDice: { die: "d10", total: 3, spent: 0 } });
  const after = preview.abilitiesAfterLevel(fighter, [{ mode: "plus1x2", abilities: ["con", "str"] }], { id: "fighter", level: 4 });
  assert.equal(after.abilities.con, 16);
  const hp = preview.levelUpHpPreview({
    sheet: fighter, hitDie: 10, method: "average", abilitiesAfter: after.abilities, featsAfter: [],
    classesAfter: [{ id: "fighter", subclass: "", level: 4 }], targetLevel: 4,
  });
  assert.equal(hp.fixed, 6 + 3 + 3);
});

await test("Draconic Resilience adds one for the sorcerer's new level", () => {
  const sorcerer = sheetOf({ class: "sorcerer", subclass: "Draconic Bloodline", level: 2, hitDice: { die: "d6", total: 2, spent: 0 }, features: [{ name: "Draconic Resilience", source: "class" }] });
  const hp = preview.levelUpHpPreview({
    sheet: sorcerer, hitDie: 6, method: "average", abilitiesAfter: sorcerer.abilities, featsAfter: [],
    classesAfter: [{ id: "sorcerer", subclass: "Draconic Bloodline", level: 3 }], targetLevel: 3,
  });
  assert.equal(hp.fixed, 4 + 2 + 1);
  assert.ok(hp.extras.some((line) => /Draconic Resilience/.test(line)));
});

await test("Primal Champion at barbarian 20 raises STR and CON by 4 before the hit points", () => {
  const barbarian = sheetOf({ class: "barbarian", level: 19, abilities: { str: 20, con: 18 }, hitDice: { die: "d12", total: 19, spent: 0 } });
  const after = preview.abilitiesAfterLevel(barbarian, [], { id: "barbarian", level: 20 });
  assert.equal(after.primalChampion, true);
  assert.equal(after.abilities.str, 24);
  assert.equal(after.abilities.con, 22);
  const hp = preview.levelUpHpPreview({
    sheet: barbarian, hitDie: 12, method: "average", abilitiesAfter: after.abilities, featsAfter: [],
    classesAfter: [{ id: "barbarian", subclass: "", level: 20 }], targetLevel: 20,
  });
  // 7 + 6 for the new level, and +2 CON modifier back pay on 19 levels.
  assert.equal(hp.fixed, 13 + 38);
});

// ---- U:UB6 the ASI taken this level counts for the spell allowance ----

await test("a cleric who raises Wisdom this level may prepare one more spell", () => {
  const cleric = sheetOf({ class: "cleric", level: 3, abilities: { wis: 15 } });
  const before = preview.casterPreview({ classId: "cleric", subclass: "", level: 4, abilitiesAfter: cleric.abilities });
  const after = preview.abilitiesAfterLevel(cleric, [{ mode: "plus1x2", abilities: ["wis", "con"] }], { id: "cleric", level: 4 });
  const raised = preview.casterPreview({ classId: "cleric", subclass: "", level: 4, abilitiesAfter: after.abilities });
  assert.equal(raised.spellCap.count, before.spellCap.count + 1);
});

// ---- Hunter's Prey ----

await test("a Hunter ranger at 3rd level is offered the Hunter's Prey pick", () => {
  const slots = openOptionSlots({ classId: "ranger", subclass: "Hunter", level: 3, features: [] });
  assert.ok(slots.some((slot) => slot.remaining > 0 && /prey/i.test(`${slot.kind} ${slot.label ?? ""}`)), JSON.stringify(slots));
});

// ---- U:UC1 / UC5 the lead's Adjust dialog ----

await test("an Adjust save keeps worn, attuned, identified and charges on every item", () => {
  const equipment = [
    { name: "Plate", qty: 1, equipped: true, weight: 65 },
    { name: "Ring of Protection", qty: 1, attuned: true, identified: true },
    { name: "Wand of Magic Missiles", qty: 1, charges: 4, attuned: false },
    { name: "odd ring", qty: 1, identified: false },
  ];
  const rows = leadEdit.itemRowsOf(equipment);
  rows[0].qty = "1";
  rows[3].name = "odd silver ring";
  const saved = leadEdit.equipmentFrom(rows);
  assert.equal(saved[0].equipped, true);
  assert.equal(saved[1].attuned, true);
  assert.equal(saved[2].charges, 4);
  assert.equal(saved[3].identified, false);
  assert.equal(saved[3].name, "odd silver ring");
  // Unchanged rows compare equal, so nothing is sent for them.
  assert.equal(JSON.stringify(leadEdit.equipmentFrom(leadEdit.itemRowsOf(equipment))), JSON.stringify(equipment));
});

await test("the Adjust spell pickers reach the highest slot stored, pact slots included", () => {
  assert.equal(leadEdit.highestStoredSlot({ ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 1 }, 3: { max: 0, used: 0 } }, prepared: [], known: [], cantrips: [] }), 2);
  assert.equal(leadEdit.highestStoredSlot({ ability: "cha", slots: {}, pact: { level: 3, max: 2, used: 0 }, prepared: [], known: [], cantrips: [] }), 3);
  assert.equal(leadEdit.highestStoredSlot(null), 0);
  assert.equal(leadEdit.spellListOf({ class: "fighter", subclass: "Eldritch Knight" }), "wizard");
  assert.equal(leadEdit.spellListOf({ class: "cleric", subclass: "" }), "cleric");
});

// ---- U:UD9 the human DM corrects an enemy's hit points ----

const { enemyHpCorrection } = await import("../src/lib/dm/catalog-enemy-hp.ts");

await test("an enemy's hit points are corrected within 1 and its maximum, never for the dead", () => {
  const troll = { displayName: "Troll", status: "alive", currentHp: 20, maxHp: 84, conditions: [] };
  assert.deepEqual(enemyHpCorrection(troll, 50), { currentHp: 50, wakes: false });
  assert.match(enemyHpCorrection(troll, 90).error, /84 hit points at most/);
  assert.match(enemyHpCorrection(troll, 0).error, /Damage an enemy/);
  assert.match(enemyHpCorrection({ ...troll, status: "dead" }, 10).error, /Troll is dead/);
  // Knocked out at 0, it wakes on the first hit point back.
  assert.equal(enemyHpCorrection({ ...troll, currentHp: 0, conditions: ["unconscious"] }, 5).wakes, true);
});

if (hasPack) {
  await test("only the DM seat corrects an enemy, and the stored enemy has the new hit points", async () => {
    const campaigns = await import("../src/lib/db/campaigns.ts");
    const { getEnemy, listEnemies, getActiveEncounter } = await import("../src/lib/db/encounters.ts");
    const world = await openWorld({ gameSettings: { dmMode: "human" } });
    const route = await world.route("campaigns/[campaignId]/dm/enemy-hp");
    world.addHero({ class: "fighter", level: 3 });
    const dm = world.addUser("dm");
    world.addHero({ class: "fighter", level: 1, user: dm });
    assert.equal(campaigns.setHumanDm(world.campaignId, dm.id), true);
    await world.beginFight([{ monster: "goblin", count: 1 }]);
    const [goblin] = listEnemies(getActiveEncounter(world.campaignId).id);
    const call = async (user, body) => {
      world.signIn(user);
      const response = await route.POST(
        new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        { params: Promise.resolve({ campaignId: world.campaignId }) },
      );
      return { status: response.status, json: await response.json() };
    };
    const player = await call(world.owner, { enemyId: goblin.id, currentHp: 3 });
    assert.equal(player.status, 403, JSON.stringify(player.json));
    const set = await call(dm, { enemyId: goblin.id, currentHp: 3 });
    assert.equal(set.status, 200, set.json.error);
    assert.equal(getEnemy(goblin.id).currentHp, 3);
    const over = await call(dm, { enemyId: goblin.id, currentHp: goblin.maxHp + 5 });
    assert.equal(over.status, 409);
    assert.match(over.json.error, /at most/);
  });
}

// ---- settings: every variant rule the engine reads has a switch ----

const { gameSettingsSchema } = await import("../src/lib/schemas/game-settings.ts");
const { readFileSync } = await import("node:fs");

await test("the settings screen and the create-campaign wizard offer every on/off variant rule, food and water included", () => {
  const defaults = gameSettingsSchema.parse({}).variantRules;
  const booleans = Object.entries(defaults).filter(([, value]) => typeof value === "boolean").map(([key]) => key).sort();
  assert.ok(booleans.includes("supplies"), "the supplies variant is in the schema");
  const panel = readFileSync(new URL("../src/app/campaigns/[campaignId]/RulesPanel.tsx", import.meta.url), "utf8");
  const block = /VARIANT_TOGGLES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(panel);
  assert.ok(block, "VARIANT_TOGGLES not found");
  const offered = [...block[1].matchAll(/key:\s*"([A-Za-z]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(offered, booleans);
});

finish();
