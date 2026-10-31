// The SRD 5.1 class and race pages, held against the engine (issue #570, the
// SRD text audit, slice 4 of 6).
//
// The rules text is the bundled rulebook itself (src/lib/rulebook/srd-5.1.json):
// the twelve class pages (barbarian to wizard, each with its one SRD subclass)
// and the race pages (racial-traits, dwarf to tiefling). Two kinds of check:
//
//   - The class table columns at every level are read straight out of the
//     page's markdown table and compared with the engine's own functions, so a
//     number cannot be wrong in both the engine and a hand-written copy.
//   - Each gap() below is a finding of the #570 SRD text audit: a class
//     feature or racial trait whose text states a mechanic the engine does
//     not hold. Its fn asserts what the SRD sentence says and fails today; the
//     rule names the page id and heading it quotes. Fixes come in a later wave
//     and turn the gap into a test().
//
// Everything here runs without the content pack (the SRD fallback in
// src/lib/srd answers), so the suite is the same in CI and locally.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";
import { patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, gap, finish } = suite("test-enforce-srd-classes");
const world = await openWorld({ campaign: { maxPlayers: 40 } });
const kit = await combatKit(world);

const rulebook = (await import("../src/lib/rulebook/srd-5.1.json", { with: { type: "json" } })).default;
const srd = await import("../src/lib/srd/index.ts");
const { populateFeatures, populateFeaturesForClasses } = await import("../src/lib/srd/features.ts");
const { combatRiders, martialArtsDie, sneakAttackDice } = await import("../src/lib/srd/feature-effects.ts");
const { rageDamageBonus, resourceDef, isUnlimited } = await import("../src/lib/srd/class-resources.ts");
const { optionSlotsFor } = await import("../src/lib/srd/options.ts");
const { cantripCapOf, casterViewsOf, spellCapOf, spellListProblems } = await import("../src/lib/srd/spell-prep.ts");
const { conditionBlocksReactions } = await import("../src/lib/srd/condition-effects.ts");
const { spellAttackReach } = await import("../src/lib/dm/cast-reach.ts");
const { rollDeathSave } = await import("../src/lib/dm/death.ts");

const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");

// ---- helpers ----

const pageOf = (id) => {
  const page = rulebook.pages.find((entry) => entry.id === id);
  assert.ok(page, `the rulebook has no page "${id}"`);
  return page;
};

// The class table on a class page: the header cells and twenty level rows.
function classTable(classId) {
  const lines = pageOf(classId).md.split("\n");
  const start = lines.findIndex((line) => /^\|\s*Level\s*\|/.test(line));
  assert.ok(start >= 0, `${classId}: no class table`);
  const cells = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const header = cells(lines[start]);
  const rows = lines.slice(start + 2, start + 22).map(cells);
  assert.equal(rows.length, 20, `${classId}: the table has ${rows.length} rows`);
  return rows.map((row, index) => {
    assert.equal(parseInt(row[0], 10), index + 1, `${classId}: row ${index + 1} reads "${row[0]}"`);
    return Object.fromEntries(header.map((name, column) => [name, row[column]]));
  });
}

const SLOT_COLUMNS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const number = (cell) => (cell === "-" || cell === "" ? 0 : parseInt(cell.replace(/^\+/, ""), 10));
const CASTING = { bard: "cha", cleric: "wis", druid: "wis", paladin: "cha", ranger: "wis", sorcerer: "cha", warlock: "cha", wizard: "int" };

// A sheet-shaped value for the pure table functions, at one class and level.
function bareSheet(classId, level) {
  return {
    class: classId,
    level,
    subclass: "",
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    features: populateFeatures([], classId, "", "human", level),
    proficiencies: { saves: [], skills: [], expertise: [] },
    spellcasting: CASTING[classId]
      ? { ability: CASTING[classId], slots: {}, prepared: [], known: [], cantrips: [] }
      : null,
  };
}

// Adds features a player picks (an invocation, a pact boon, a fighting
// style) to a stored sheet, as the builder files them: source "choice".
function pick(hero, names) {
  const held = world.sheet(hero.id).features;
  world.patch(hero.id, {
    features: [...held, ...names.filter((name) => !held.some((feature) => feature.name === name)).map((name) => ({ name, source: "choice", description: "" }))],
  });
}

// A fresh fight against one 200 hit point dummy, the floor on `hero`, both
// standing side by side on an open field.
async function duel(hero, stats = {}) {
  await kit.endFight();
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200, stats: { ...DUMMY, ...stats } });
  kit.place(hero.id, 4, 4);
  kit.place(enemy.id, 5, 4);
  kit.giveTurn(hero.id);
  return kit.enemy(enemy.id);
}

// The player's own move on the battle map (a jump when body.jump is set).
async function walk(hero, body) {
  world.signIn({ id: world.sheet(hero.id).userId });
  const response = await moveRoute.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// One level taken through the player's level-up route, with the spell lists
// and features the dialog would send.
async function levelUp(hero, level, { spellcasting = {}, features = [] } = {}) {
  const before = world.sheet(hero.id);
  const entry = { id: before.class, subclass: before.subclass ?? "", level };
  const gain = Math.floor(srd.findClass(before.class).hitDie / 2) + 1 + abilityMod(before.abilities.con);
  // Signed in as the hero's own player: the route levels the caller's sheet.
  return patchSheetAs(world, sheetRoute, { id: before.userId }, {
    level,
    maxHp: before.maxHp + gain,
    currentHp: before.currentHp + gain,
    hitDice: { ...before.hitDice, total: level },
    features: [...populateFeaturesForClasses(before.features, [entry], before.race), ...features],
    ...(before.spellcasting
      ? {
          spellcasting: {
            ...before.spellcasting,
            slots: Object.fromEntries(
              Object.entries(srd.spellSlotsFor(before.class, level)).map(([slot, max]) => [slot, { max, used: 0 }]),
            ),
            ...spellcasting,
          },
        }
      : {}),
  });
}

const slotsOf = (classId, level) =>
  Object.fromEntries(Object.entries(srd.spellSlotsFor(classId, level)).map(([slot, max]) => [slot, { max, used: 0 }]));

// ---- the class tables, read from the rulebook ----

for (const classId of ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]) {
  await test(`${classId}: every column of the class table on the SRD page matches the engine at all 20 levels`, () => {
    const problems = [];
    const expect = (level, label, actual, wanted) => {
      if (actual !== wanted) {
        problems.push(`L${level} ${label}: engine ${JSON.stringify(actual)}, the page ${JSON.stringify(wanted)}`);
      }
    };
    for (const [index, row] of classTable(classId).entries()) {
      const level = index + 1;
      const sheet = bareSheet(classId, level);
      expect(level, "proficiency bonus", srd.computeSheetDerived(sheet).proficiencyBonus, number(row["Proficiency Bonus"]));
      if (row["Cantrips Known"] !== undefined) {
        expect(level, "cantrips known", cantripCapOf({ classId, level }), number(row["Cantrips Known"]));
      }
      if (row["Spells Known"] !== undefined) {
        const [view] = casterViewsOf(sheet);
        expect(level, "spells known", spellCapOf(view, sheet.abilities)?.count ?? 0, number(row["Spells Known"]));
      }
      const slots = srd.spellSlotsFor(classId, level);
      if (row["Spell Slots"] !== undefined) {
        // Pact Magic: a count of slots, all of one level.
        const open = Object.entries(slots).filter(([, max]) => max > 0);
        expect(level, "pact slot levels", open.length, 1);
        expect(level, "pact slots", open[0]?.[1], number(row["Spell Slots"]));
        expect(level, "pact slot level", Number(open[0]?.[0]), number(row["Slot Level"]));
      } else if (row["1st"] !== undefined) {
        SLOT_COLUMNS.filter((column) => row[column] !== undefined).forEach((column, slot) => {
          expect(level, `${column} slots`, slots[String(slot + 1)] ?? 0, number(row[column]));
        });
      }
      if (row.Rages !== undefined) {
        const rages = resourceDef("rage").maxFor(level, {});
        expect(level, "rages", isUnlimited({ max: rages }) ? "Unlimited" : String(rages), row.Rages);
        expect(level, "rage damage", rageDamageBonus(level), number(row["Rage Damage"]));
      }
      if (row["Martial Arts"] !== undefined) {
        expect(level, "martial arts", `1${martialArtsDie(level)}`, row["Martial Arts"]);
        expect(level, "ki points", level >= 2 ? resourceDef("ki").maxFor(level, {}) : 0, number(row["Ki Points"]));
        expect(level, "unarmored movement", combatRiders(sheet).unarmoredSpeedBonus, number(row["Unarmored Movement"].replace(/\s*ft\.?$/, "")));
      }
      if (row["Sneak Attack"] !== undefined) {
        expect(level, "sneak attack", `${sneakAttackDice(level)}d6`, row["Sneak Attack"]);
      }
      if (row["Sorcery Points"] !== undefined) {
        expect(level, "sorcery points", level >= 2 ? resourceDef("sorcery_points").maxFor(level, {}) : 0, number(row["Sorcery Points"]));
      }
      if (row["Invocations Known"] !== undefined) {
        expect(level, "invocations known", optionSlotsFor("warlock", "", level, "invocation"), number(row["Invocations Known"]));
      }
    }
    assert.deepEqual(problems, []);
  });
}

await test("each class's hit die, its hit points at 1st level and its saving throws are the ones its SRD page prints", () => {
  const SAVE = { Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha" };
  for (const classId of ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]) {
    const md = pageOf(classId).md;
    const die = Number(/\*\*Hit Dice:\*\*\s*1d(\d+)/.exec(md)?.[1]);
    assert.equal(srd.findClass(classId).hitDie, die, `${classId} hit die`);
    assert.equal(Number(/\*\*Hit Points at 1st Level:\*\*\s*(\d+)/.exec(md)?.[1]), die, `${classId} level 1 hit points`);
    const saves = /\*\*Saving Throws:\*\*\s*([^\n]+)/.exec(md)[1].split(/,\s*/).map((name) => SAVE[name.trim()]);
    assert.deepEqual([...srd.findClass(classId).saves].sort(), saves.sort(), `${classId} saving throws`);
  }
});

// ---- held rows the other suites do not state ----

await test("Dueling (SRD 5.1 fighter, Fighting Style): a one-handed longsword with a shield on the other arm still adds +2 damage, since a shield is no weapon", async () => {
  const duelist = world.addHero({
    class: "fighter", level: 1, abilities: { str: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }],
  });
  pick(duelist, ["Fighting Style: Dueling"]);
  const enemy = await duel(duelist);
  const swing = await kit.swing(duelist.id, enemy.id, [15, 5]);
  assert.equal(swing.ok, true, swing.error);
  // 1d8 (5) + STR 3 + Dueling 2.
  assert.equal(swing.result.damage, 10);
});

// ---- the findings ----

// Fighter, Action Surge.
const surger = world.addHero({
  class: "fighter", subclass: "Champion", level: 17, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 150,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});

// SRD 5.1 fighter, Action Surge: "Starting at 17th level, you can use it
// twice before a rest, but only once on the same turn."
await test("CLS-01", async () => {
  await duel(surger);
  world.patch(surger.id, { resources: { ...world.sheet(surger.id).resources, action_surge: { max: 2, used: 0 } } });
  const first = await world.invoke("use_resource", { characterId: surger.id, resource: "Action Surge" });
  assert.equal(first.ok, true, first.error);
  const second = await world.invoke("use_resource", { characterId: surger.id, resource: "Action Surge" });
  assert.equal(second.ok, false, "a second Action Surge on the same turn was taken: three actions in one turn");
});

// Cleric, Channel Divinity: Turn Undead (and the paladin's Turn the Unholy,
// which turns the same way).
const turner = world.addHero({
  class: "cleric", level: 3, abilities: { wis: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "wis", slots: slotsOf("cleric", 3), prepared: [], known: [], cantrips: [] },
});
const smiter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});

// Turns the one dummy, a CR 1 undead: its WIS save is forced to a 1.
async function turnedUndead() {
  const enemy = await duel(turner, { type: "undead", cr: 1 });
  kit.place(turner.id, 2, 2);
  kit.place(enemy.id, 4, 2);
  kit.place(smiter.id, 5, 2);
  world.patch(turner.id, { resources: { ...world.sheet(turner.id).resources, channel_divinity: { max: 1, used: 0 } } });
  world.clearDice();
  world.dice(1);
  const out = await world.invoke("use_resource", { characterId: turner.id, resource: "Channel Divinity", variant: "turn undead" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(kit.enemy(enemy.id).conditions.includes("turned"), "setup: the undead was not turned");
  return enemy;
}

// SRD 5.1 cleric, Channel Divinity: Turn Undead: "If the creature fails its
// saving throw, it is turned for 1 minute or until it takes any damage." (Turn
// the Unholy on the paladin page: "or until it takes damage")
await test("CLS-02", async () => {
  const enemy = await turnedUndead();
  kit.giveTurn(smiter.id);
  const swing = await kit.swing(smiter.id, enemy.id, [18, 5]);
  assert.equal(swing.ok, true, swing.error);
  assert.ok(kit.enemy(enemy.id).currentHp < 200, "setup: the hit did no damage");
  assert.equal(kit.enemy(enemy.id).conditions.includes("turned"), false, "the undead took damage and is still turned");
});

// SRD 5.1 cleric, Channel Divinity: Turn Undead: "For its action, it can use
// only the Dash action or try to escape from an effect that prevents it from
// moving. If there's nowhere to move, the creature can use the Dodge action."
await test("CLS-03", async () => {
  const enemy = await turnedUndead();
  kit.freshRound();
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: turner.id });
  world.clearDice();
  assert.equal(out.ok, false, "a turned undead made an attack");
});

// SRD 5.1 cleric, Channel Divinity: Turn Undead: "It also can't take
// reactions."
await test("CLS-04", async () => {
  assert.equal(conditionBlocksReactions(["turned"]), "turned", "a turned creature keeps its reactions (opportunity attacks included)");
});

// Bard, Bardic Inspiration.
const bardFour = world.addHero({ class: "bard", level: 4, abilities: { cha: 16 }, proficiencies: TRAINED });
const bardFive = world.addHero({ class: "bard", level: 5, abilities: { cha: 16 }, proficiencies: TRAINED });

// SRD 5.1 bard, Bardic Inspiration: "A creature can have only one Bardic
// Inspiration die at a time."
await test("CLS-05", async () => {
  await duel(bardFour);
  kit.place(smiter.id, 4, 5);
  const first = await world.invoke("use_resource", { characterId: bardFour.id, resource: "Bardic Inspiration", targetCharacterId: smiter.id });
  assert.equal(first.ok, true, first.error);
  kit.giveTurn(bardFive.id);
  await world.invoke("use_resource", { characterId: bardFive.id, resource: "Bardic Inspiration", targetCharacterId: smiter.id });
  const held = world.sheet(smiter.id).conditions.filter((name) => /^bardic inspiration/i.test(name));
  assert.equal(held.length, 1, `the ally holds ${held.join(" and ")}`);
});

// Paladin, Aura of Protection and Sacred Weapon.
const devoted = world.addHero({
  class: "paladin", subclass: "Oath of Devotion", level: 6, abilities: { str: 16, cha: 16 }, proficiencies: TRAINED, maxHp: 60,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  spellcasting: { ability: "cha", slots: slotsOf("paladin", 6), prepared: [], known: [], cantrips: [] },
});

// SRD 5.1 paladin, Aura of Protection: "the creature gains a bonus to the
// saving throw equal to your Charisma modifier (with a minimum bonus of +1).
// You must be conscious to grant this bonus."
await test("CLS-06", async () => {
  await kit.endFight();
  world.patch(devoted.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.clearDice();
  world.dice(7);
  rollDeathSave(world.campaign(), devoted.id);
  world.clearDice();
  const track = world.sheet(devoted.id).deathSaves;
  world.patch(devoted.id, { currentHp: 60, conditions: [], deathSaves: null });
  assert.equal(track.successes, 0, "a 7 on the d20 became a success: the unconscious paladin's own aura added +3");
});

// SRD 5.1 paladin, Oath of Devotion, Channel Divinity, Sacred Weapon: "If the
// weapon is not already magical, it becomes magical for the duration."
await test("CLS-07", async () => {
  const enemy = await duel(devoted, { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" });
  world.patch(devoted.id, { resources: { ...world.sheet(devoted.id).resources, channel_divinity: { max: 1, used: 0 } } });
  const out = await world.invoke("use_resource", { characterId: devoted.id, resource: "Channel Divinity", variant: "sacred weapon" });
  assert.equal(out.ok, true, out.error);
  kit.freshTurn();
  const swing = await kit.swing(devoted.id, enemy.id, [15, 8]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(200 - kit.enemy(enemy.id).currentHp, swing.result.damage, `the sacred weapon's ${swing.result.damage} was halved to ${200 - kit.enemy(enemy.id).currentHp} as a nonmagical attack`);
});

// Monk, Step of the Wind; fighter (Champion), Remarkable Athlete; rogue
// (Thief), Second-Story Work: three features that lengthen a jump.
const leaper = world.addHero({ class: "monk", level: 2, abilities: { str: 8, dex: 14 }, proficiencies: TRAINED });
const athlete = world.addHero({ class: "fighter", subclass: "Champion", level: 7, abilities: { str: 14 }, proficiencies: TRAINED });
const climber = world.addHero({ class: "rogue", subclass: "Thief", level: 3, abilities: { str: 11, dex: 18 }, proficiencies: TRAINED });

// A running start (two squares moved this turn), then a 15-foot jump north.
async function runningJump(hero) {
  await duel(hero);
  kit.openField();
  kit.place(hero.id, 5, 8, 2);
  return walk(hero, { x: 5, y: 5, jump: true });
}

// SRD 5.1 monk, Ki, Step of the Wind: "You can spend 1 ki point to take the
// Disengage or Dash action as a bonus action on your turn, and your jump
// distance is doubled for the turn."
await test("CLS-08", async () => {
  await duel(leaper);
  kit.openField();
  kit.place(leaper.id, 5, 8, 2);
  const wind = await world.invoke("use_resource", { characterId: leaper.id, resource: "Ki", variant: "step of the wind" });
  assert.equal(wind.ok, true, wind.error);
  const jumped = await walk(leaper, { x: 5, y: 5, jump: true });
  assert.equal(jumped.status, 200, `the doubled 16-foot jump was refused: ${jumped.body.error}`);
});

// SRD 5.1 fighter, Champion, Remarkable Athlete: "In addition, when you make a
// running long jump, the distance you can cover increases by a number of feet
// equal to your Strength modifier."
await test("CLS-09", async () => {
  const jumped = await runningJump(athlete);
  assert.equal(jumped.status, 200, `the 16-foot running jump was refused: ${jumped.body.error}`);
});

// SRD 5.1 rogue, Thief, Second-Story Work: "In addition, when you make a
// running jump, the distance you cover increases by a number of feet equal to
// your Dexterity modifier."
await test("CLS-10", async () => {
  const jumped = await runningJump(climber);
  assert.equal(jumped.status, 200, `the 15-foot running jump was refused: ${jumped.body.error}`);
});

// Sorcerer, Metamagic.
const sorcerer = world.addHero({
  class: "sorcerer", level: 5, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: slotsOf("sorcerer", 5), prepared: [], known: [], cantrips: [] },
});
pick(sorcerer, ["Metamagic: Quickened Spell", "Metamagic: Twinned Spell"]);

// SRD 5.1 sorcerer, Metamagic: "You gain two of the following Metamagic
// options of your choice." Heightened Spell: "you can spend 3 sorcery points".
await test("CLS-11", async () => {
  await duel(sorcerer);
  world.patch(sorcerer.id, { resources: { ...world.sheet(sorcerer.id).resources, sorcery_points: { max: 5, used: 0 } } });
  const out = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Sorcery Points", variant: "Heightened Spell", amount: 1 });
  const spent = world.sheet(sorcerer.id).resources.sorcery_points.used;
  assert.ok(!out.ok || spent === 3, `Heightened Spell, never learned, was bought for ${spent} sorcery point(s)`);
  assert.equal(out.ok, false, "Heightened Spell was used by a sorcerer who did not learn it");
  // Learned, it costs its own 3 points whatever amount the call names; a
  // Twinned Spell costs the amount given, the spell's level.
  pick(sorcerer, ["Metamagic: Heightened Spell"]);
  const heightened = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Sorcery Points", variant: "Heightened Spell", amount: 1 });
  assert.equal(heightened.ok, true, heightened.error);
  assert.equal(world.sheet(sorcerer.id).resources.sorcery_points.used, 3);
  const twinned = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Sorcery Points", variant: "Twinned Spell", amount: 2 });
  assert.equal(twinned.ok, true, twinned.error);
  assert.equal(world.sheet(sorcerer.id).resources.sorcery_points.used, 5);
});

// Warlock, Pact Boon and Eldritch Invocations.
const bladelock = world.addHero({
  class: "warlock", level: 12, abilities: { str: 16, cha: 16 }, proficiencies: TRAINED, maxHp: 80,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  spellcasting: { ability: "cha", slots: slotsOf("warlock", 12), prepared: [], known: [], cantrips: ["Eldritch Blast"] },
});
pick(bladelock, ["Pact Boon: Pact of the Blade", "Invocation: Thirsting Blade", "Invocation: Lifedrinker", "Invocation: Beguiling Influence", "Invocation: Eldritch Spear"]);

// SRD 5.1 warlock, Eldritch Invocations, Thirsting Blade: "You can attack with your pact weapon twice, instead of once, whenever you take the Attack action on your turn."
await test("CLS-12", async () => {
  const enemy = await duel(bladelock);
  const first = await kit.swing(bladelock.id, enemy.id, [15, 5]);
  assert.equal(first.ok, true, first.error);
  const second = await kit.swing(bladelock.id, enemy.id, [15, 5]);
  assert.equal(second.ok, true, `the second pact weapon attack was refused: ${second.error}`);
  const third = await kit.swing(bladelock.id, enemy.id, [15, 5]);
  assert.notEqual(third.ok, true, "Thirsting Blade gave a third attack");
});

// SRD 5.1 warlock, Eldritch Invocations, Lifedrinker: "When you hit a creature with your pact weapon, the creature takes extra necrotic damage equal to your Charisma modifier (minimum 1)."
await test("CLS-13", async () => {
  const enemy = await duel(bladelock);
  const swing = await kit.swing(bladelock.id, enemy.id, [15, 5]);
  assert.equal(swing.ok, true, swing.error);
  // 1d8 (5) + STR 3 + CHA 3 necrotic.
  assert.equal(swing.result.damage, 11, `the pact weapon hit dealt ${swing.result.damage}, no necrotic rider`);
});

// SRD 5.1 warlock, Pact Boon, Pact of the Blade: "This weapon counts as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage."
await test("CLS-14", async () => {
  const enemy = await duel(bladelock, { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" });
  const swing = await kit.swing(bladelock.id, enemy.id, [15, 5]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(200 - kit.enemy(enemy.id).currentHp, swing.result.damage, `the pact weapon's ${swing.result.damage} was halved as a nonmagical attack`);
});

// SRD 5.1 warlock, Eldritch Invocations, Beguiling Influence: "You gain proficiency in the Deception and Persuasion skills."
await test("CLS-15", async () => {
  const derived = srd.computeSheetDerived(world.sheet(bladelock.id));
  const proficient = derived.abilityMods.cha + derived.proficiencyBonus;
  assert.equal(derived.skills.deception, proficient, `Deception is +${derived.skills.deception}, no proficiency`);
  assert.equal(derived.skills.persuasion, proficient, `Persuasion is +${derived.skills.persuasion}, no proficiency`);
});

// SRD 5.1 warlock, Eldritch Invocations, Eldritch Spear: "When you cast eldritch blast, its range is 300 feet."
await test("CLS-16", async () => {
  const profile = { rangeTiles: 24, longRangeTiles: 24, damageExpression: "1d10" };
  const reach = spellAttackReach(world.campaign(), world.sheet(bladelock.id), "Eldritch Blast", profile, null);
  assert.equal(reach.rangeTiles, 60, `eldritch blast reaches ${reach.rangeTiles * 5} feet with Eldritch Spear`);
});

const blaster = world.addHero({
  class: "warlock", level: 2, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: slotsOf("warlock", 2), prepared: [], known: ["Hex"], cantrips: ["Eldritch Blast", "Minor Illusion"] },
});
pick(blaster, ["Invocation: Repelling Blast", "Invocation: Agonizing Blast"]);

// SRD 5.1 warlock, Eldritch Invocations, Repelling Blast: "When you hit a creature with eldritch blast, you can push the creature up to 10 feet away from you in a straight line."
await test("CLS-25", async () => {
  const enemy = await duel(blaster);
  kit.openField();
  kit.place(blaster.id, 4, 4);
  kit.place(enemy.id, 4, 7);
  const swing = await kit.swing(blaster.id, enemy.id, [18, 6], { spell: "Eldritch Blast" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true, "setup: the beam missed");
  const at = kit.token(enemy.id);
  assert.equal(at.y, 9, `the creature was not pushed 10 feet: it stands at (${at.x},${at.y})`);
});

const shadowlock = world.addHero({
  class: "warlock", level: 5, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: slotsOf("warlock", 5), prepared: [], known: ["Hex"], cantrips: ["Eldritch Blast", "Minor Illusion"] },
});
pick(shadowlock, ["Invocation: One with Shadows", "Invocation: Agonizing Blast", "Invocation: Devil's Sight"]);

// SRD 5.1 warlock, Eldritch Invocations, One with Shadows: "When you are in an area of dim light or darkness, you can use your action to become invisible until you move or take an action or a reaction."
await test("CLS-26", async () => {
  await duel(shadowlock);
  kit.openField();
  kit.place(shadowlock.id, 4, 4);
  // The light the board is lit with, indoors so the clock's sky does not
  // answer for it.
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const light = (ambient) => getDatabase().prepare("UPDATE battle_maps SET ambient = ?, outdoors = 0 WHERE id = ?").run(ambient, kit.map().id);
  light("bright");
  const bright = await world.invoke("use_resource", { characterId: shadowlock.id, resource: "One with Shadows" });
  assert.equal(bright.refused, "rules", "One with Shadows worked in bright light");
  light("dim");
  const out = await world.invoke("use_resource", { characterId: shadowlock.id, resource: "One with Shadows" });
  assert.equal(out.ok, true, `One with Shadows could not be used: ${out.error}`);
  assert.ok(world.sheet(shadowlock.id).conditions.map((name) => name.toLowerCase()).includes("invisible"), "One with Shadows left the warlock visible");
  // Moving ends it.
  const moved = await walk(shadowlock, { x: 4, y: 5 });
  assert.equal(moved.status, 200, moved.body.error);
  assert.ok(!world.sheet(shadowlock.id).conditions.map((name) => name.toLowerCase()).includes("invisible"), "the warlock moved and stayed invisible");
  // "You can use your action": no limit, so nothing counts it. A counter of
  // 99 read "Uses 99/99" on the Hand card and on the party card, and the
  // sheet listed it among the limited uses.
  const sheet = world.sheet(shadowlock.id);
  assert.equal(sheet.resources.one_with_shadows, undefined, `the sheet counts One with Shadows: ${JSON.stringify(sheet.resources.one_with_shadows)}`);
  const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
  const card = deriveHand(sheet).find((entry) => entry.name === "One with Shadows");
  assert.ok(card, "the Hand deals no One with Shadows card");
  assert.equal(card.resource, "", `the One with Shadows card counts uses: "${card.resource}"`);
  assert.equal(card.cost, "action");
});

// Druid, Archdruid.
const archdruid = world.addHero({
  class: "druid", subclass: "Circle of the Land", level: 20, abilities: { wis: 18 }, proficiencies: TRAINED, maxHp: 120,
  spellcasting: { ability: "wis", slots: slotsOf("druid", 20), prepared: ["Goodberry", "Cure Wounds"], known: [], cantrips: ["Druidcraft"] },
});
// No component pouch and no druidic focus: Archdruid needs neither for a
// material with no cost.
world.patch(archdruid.id, { equipment: [] });

// SRD 5.1 druid, Archdruid: "you can ignore the verbal and somatic components of your druid spells, as well as any material components that lack a cost and aren't consumed by a spell."
await test("CLS-27", async () => {
  await kit.endFight();
  const out = await world.invoke("use_spell_slot", { characterId: archdruid.id, spell: "Goodberry", level: 1 });
  assert.equal(out.ok, true, `a 20th level druid with no focus was refused goodberry: ${out.error}`);
});

const tomelock = world.addHero({
  class: "warlock", level: 2, abilities: { cha: 16, con: 14 }, proficiencies: TRAINED, maxHp: 17,
  spellcasting: { ability: "cha", slots: slotsOf("warlock", 2), prepared: [], known: ["Hex", "Armor of Agathys", "Hellish Rebuke"], cantrips: ["Eldritch Blast", "Minor Illusion"] },
});
pick(tomelock, ["Invocation: Armor of Shadows", "Invocation: Thief of Five Fates"]);
world.patch(tomelock.id, { xp: 355000 });
// Its twin for the Pact of the Chain, so neither level-up depends on the other.
const chainlock = world.addHero({
  class: "warlock", level: 2, abilities: { cha: 16, con: 14 }, proficiencies: TRAINED, maxHp: 17,
  spellcasting: { ability: "cha", slots: slotsOf("warlock", 2), prepared: [], known: ["Hex", "Armor of Agathys", "Hellish Rebuke"], cantrips: ["Eldritch Blast", "Minor Illusion"] },
});
pick(chainlock, ["Invocation: Armor of Shadows", "Invocation: Thief of Five Fates"]);
world.patch(chainlock.id, { xp: 355000 });

// SRD 5.1 warlock, Eldritch Invocations, Armor of Shadows: "You can cast mage armor on yourself at will, without expending a spell slot or material components." (and the other at-will invocations: Fiendish Vigor, Mask of Many Faces, Misty Visions, Beast Speech, Eldritch Sight, Ascendant Step, Otherworldly Leap...)
await test("CLS-17", async () => {
  await kit.endFight();
  world.patch(tomelock.id, { spellcasting: { ...world.sheet(tomelock.id).spellcasting, slots: { 1: { max: 2, used: 2 } } } });
  // On an ally it is refused: the invocation casts it on the warlock alone.
  const onAlly = await world.invoke("cast_buff", { characterId: tomelock.id, spell: "Mage Armor", targetCharacterIds: [smiter.id] });
  const out = await world.invoke("cast_buff", { characterId: tomelock.id, spell: "Mage Armor", targetCharacterId: tomelock.id });
  const after = world.sheet(tomelock.id);
  world.patch(tomelock.id, { spellcasting: { ...world.sheet(tomelock.id).spellcasting, slots: slotsOf("warlock", 2) } });
  assert.equal(out.ok, true, `mage armor at will was refused: ${out.error}`);
  assert.equal(after.spellcasting.slots["1"].used, 2, "the at-will mage armor spent a slot");
  assert.ok(after.conditions.some((name) => /mage armor/i.test(name)), `mage armor did not land: ${after.conditions.join(", ")}`);
  assert.match(String(onAlly.error), /on themselves only/, `Armor of Shadows on an ally: ${onAlly.error ?? "cast"}`);
  assert.ok(!world.sheet(smiter.id).conditions.some((name) => /mage armor/i.test(name)), "the ally holds the warlock's mage armor");
});

// SRD 5.1 warlock, Eldritch Invocations, Thief of Five Fates: "You can cast bane once using a warlock spell slot. You can't do so again until you finish a long rest." (and Bewitching Whispers, Dreadful Word, Minions of Chaos, Mire the Mind, Sculptor of Flesh, Sign of Ill Omen)
await test("CLS-18", async () => {
  await kit.endFight();
  const out = await world.invoke("use_spell_slot", { characterId: tomelock.id, spell: "Bane", level: 1 });
  assert.equal(out.ok, true, `bane through Thief of Five Fates was refused: ${out.error}`);
  assert.equal(world.sheet(tomelock.id).spellcasting.slots["1"].used, 1, "the warlock slot was not spent");
  const again = await world.invoke("use_spell_slot", { characterId: tomelock.id, spell: "Bane", level: 1 });
  world.patch(tomelock.id, { spellcasting: { ...world.sheet(tomelock.id).spellcasting, slots: slotsOf("warlock", 2) } });
  assert.equal(again.refused, "rules", "bane was cast twice through Thief of Five Fates before a long rest");
});

// SRD 5.1 warlock, Pact Boon, Pact of the Tome: "choose three cantrips from any class's spell list ... They don't count against your number of cantrips known. If they don't appear on the warlock spell list, they are nonetheless warlock spells for you."
await test("CLS-19", async () => {
  const sheet = world.sheet(tomelock.id);
  const cantrips = [...sheet.spellcasting.cantrips, "Guidance", "Sacred Flame", "Shillelagh"];
  const leveled = await levelUp(tomelock, 3, {
    features: [{ name: "Pact Boon: Pact of the Tome", source: "choice", description: "" }],
    spellcasting: { known: [...sheet.spellcasting.known, "Misty Step"], cantrips },
  });
  assert.equal(leveled.status, 200, `the level-up with the Book of Shadows was refused: ${leveled.json.error}`);
  assert.deepEqual(
    spellListProblems({ ...sheet, level: 3, features: [...sheet.features, { name: "Pact Boon: Pact of the Tome", source: "choice" }], spellcasting: { ...sheet.spellcasting, cantrips } }),
    [],
    "the three Book of Shadows cantrips count against the cantrips known",
  );
});

// SRD 5.1 warlock, Pact Boon, Pact of the Chain: "You learn the find familiar spell and can cast it as a ritual. The spell doesn't count against your number of spells known."
await test("CLS-20", async () => {
  const sheet = world.sheet(chainlock.id);
  const leveled = await levelUp(chainlock, 3, {
    features: [{ name: "Pact Boon: Pact of the Chain", source: "choice", description: "" }],
    spellcasting: { known: [...sheet.spellcasting.known, "Misty Step", "Find Familiar"] },
  });
  assert.equal(leveled.status, 200, `the level-up with find familiar was refused: ${leveled.json.error}`);
  assert.ok(world.sheet(chainlock.id).spellcasting.known.includes("Find Familiar"), "find familiar did not land on the sheet");
});

// Bard, Magical Secrets and the College of Lore's Additional Magical Secrets.
const BARD_SPELLS = ["Charm Person", "Cure Wounds", "Healing Word", "Sleep", "Hold Person", "Invisibility", "Shatter", "Dispel Magic", "Hypnotic Pattern", "Polymorph", "Dimension Door", "Hold Monster"];
const secretBard = world.addHero({
  class: "bard", subclass: "College of Lore", level: 9, abilities: { cha: 16, con: 14 }, proficiencies: TRAINED, maxHp: 63,
  spellcasting: { ability: "cha", slots: slotsOf("bard", 9), prepared: [], known: BARD_SPELLS.slice(0, 12), cantrips: ["Vicious Mockery", "Minor Illusion", "Light"] },
});
world.patch(secretBard.id, { xp: 355000 });
const loreBard = world.addHero({
  class: "bard", subclass: "College of Lore", level: 5, abilities: { cha: 16, con: 14 }, proficiencies: TRAINED, maxHp: 38,
  spellcasting: { ability: "cha", slots: slotsOf("bard", 5), prepared: [], known: BARD_SPELLS.slice(0, 8), cantrips: ["Vicious Mockery", "Minor Illusion", "Light"] },
});
world.patch(loreBard.id, { xp: 355000 });

// SRD 5.1 bard, Magical Secrets: "By 10th level ... Choose two spells from any classes, including this one. ... The chosen spells count as bard spells for you and are included in the number in the Spells Known column of the Bard table."
await test("CLS-21", async () => {
  const leveled = await levelUp(secretBard, 10, {
    spellcasting: { known: [...BARD_SPELLS.slice(0, 12), "Fireball", "Counterspell"], cantrips: ["Vicious Mockery", "Minor Illusion", "Light", "Mage Hand"] },
  });
  assert.equal(leveled.status, 200, `the bard's Magical Secrets were refused: ${leveled.json.error}`);
  const known = world.sheet(secretBard.id).spellcasting.known;
  assert.ok(known.includes("Fireball") && known.includes("Counterspell"), `the Magical Secrets did not land on the sheet: ${known.join(", ")}`);
});

// SRD 5.1 bard, College of Lore, Additional Magical Secrets: "At 6th level, you learn two spells of your choice from any class. ... The chosen spells count as bard spells for you but don't count against the number of bard spells you know."
await test("CLS-22", async () => {
  const leveled = await levelUp(loreBard, 6, {
    spellcasting: { known: [...BARD_SPELLS.slice(0, 9), "Fireball", "Counterspell"] },
  });
  assert.equal(leveled.status, 200, `the Lore bard's Additional Magical Secrets were refused: ${leveled.json.error}`);
});

// Races: the tiefling's Infernal Legacy and the high elf's Cantrip.
const tiefling = world.addHero({ class: "fighter", race: "tiefling", level: 3, abilities: { str: 16, cha: 16 }, proficiencies: TRAINED, maxHp: 30 });
const highElf = world.addHero({
  class: "cleric", race: "high_elf", level: 1, abilities: { int: 18, wis: 10 }, proficiencies: TRAINED, maxHp: 30,
  racialChoices: { cantrips: ["Fire Bolt"], cantrip: "Fire Bolt" },
  spellcasting: { ability: "wis", slots: slotsOf("cleric", 1), prepared: [], known: [], cantrips: ["Sacred Flame", "Guidance", "Light", "Fire Bolt"] },
});

// SRD 5.1 tiefling, Infernal Legacy: "When you reach 3rd level, you can cast the hellish rebuke spell as a 2nd-level spell once with this trait and regain the ability to do so when you finish a long rest. ... Charisma is your spellcasting ability for these spells."
await test("CLS-23", async () => {
  const enemy = await duel(smiter);
  kit.place(tiefling.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.deepEqual(world.sheet(tiefling.id).resources.racial_hellish_rebuke, { max: 1, used: 0 }, "setup: no racial counter");
  kit.freshRound();
  world.dice(15, 3);
  const hit = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tiefling.id });
  assert.equal(hit.ok, true, hit.error);
  world.dice(1, 5, 5, 5);
  const out = await world.invoke("use_reaction", { characterId: tiefling.id, feature: "Hellish Rebuke", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, `the tiefling's Infernal Legacy rebuke was refused: ${out.error}`);
  // As a 2nd-level spell: 3d10 (5 + 5 + 5) on the failed save.
  assert.equal(200 - kit.enemy(enemy.id).currentHp, 15, `the rebuke dealt ${200 - kit.enemy(enemy.id).currentHp}, not 3d10`);
  assert.deepEqual(world.sheet(tiefling.id).resources.racial_hellish_rebuke, { max: 1, used: 1 }, "the racial use was not spent");
});

// SRD 5.1 elf, High Elf, Cantrip: "You know one cantrip of your choice from the wizard spell list. Intelligence is your spellcasting ability for it."
await test("CLS-24", async () => {
  const enemy = await duel(highElf);
  // Out of reach, so the ranged spell attack has no disadvantage.
  kit.place(enemy.id, 4, 9);
  const swing = await kit.swing(highElf.id, enemy.id, [10, 5], { spell: "Fire Bolt" });
  assert.equal(swing.ok, true, swing.error);
  // d20 10 + proficiency 2 + INT 4.
  assert.equal(swing.result.rolled, 16, `the racial Fire Bolt rolled ${swing.result.rolled}: the class's Wisdom, not Intelligence`);
});

world.close();
finish();
