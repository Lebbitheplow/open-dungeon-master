// What a player may do to their own sheet when they level up.
//
// The level-up dialog saves through one request, PATCH
// /api/campaigns/[id]/sheet, and the route's own comment states the rule:
// "Players may self-serve cosmetics any time; every other field in the
// player patch schema exists for the level-up flow, so gameplay stats only
// pass as part of a genuine level increase." This suite sends that request
// the way a client can, not the way the dialog does, and reads the stored
// sheet afterwards.
//
// The rules held against it, from SRD 5.1:
//   a level is earned with experience (300 for 2nd, 900 for 3rd, and so on),
//   never taken, and never more levels than the experience has reached;
//   a level adds one hit die and at most that die's highest face plus the
//   Constitution modifier in hit points;
//   ability scores rise only with an Ability Score Improvement, by two
//   points in all, and never past 20;
//   class features come from the class table, not from the player;
//   a subclass is chosen at the class's subclass level, from that class's
//   own list, once;
//   levelling refills nothing: spent uses, spent slots and spent hit dice
//   stay spent.
//
// The multiclass path of the same route (levelUpClass) is held to the same
// rules in test-enforce-multiclass-levelup.mjs, and the slot table in
// test-enforce-spell-slots.mjs.
//
// Each finding asserts the state a legal sheet would be in, so it closes
// whether the server refuses the request or corrects it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-levelup");

const { combatRiders } = await import("../src/lib/srd/feature-effects.ts");

const first = await openWorld();
const sheetRoute = await first.route("campaigns/[campaignId]/sheet");

// A table with one hero on it, the experience for `earned` awarded the way a
// DM awards it, and the player's request as a function.
async function table(hero, { xp = 0, status = "active" } = {}) {
  const world = await openWorld({ status });
  const made = world.addHero(hero);
  if (xp > 0) {
    let left = xp;
    while (left > 0) {
      const amount = Math.min(20000, left);
      const awarded = await world.invoke("award_xp", {
        characterIds: [made.id],
        amount,
        reason: "earned in play",
      });
      assert.equal(awarded.ok, true, awarded.error);
      left -= amount;
    }
  }
  return {
    world,
    id: made.id,
    sheet: () => world.sheet(made.id),
    patch: (body) => patchSheetAs(world, sheetRoute, world.owner, body),
  };
}

const FIGHTER = { class: "fighter", level: 1, maxHp: 12, abilities: { str: 16, con: 14 } };
const XP = { 2: 300, 3: 900, 4: 2700, 5: 6500 };

// What the dialog sends for a fighter taking one level at the fixed value.
const fighterLevel = (sheet, extra = {}) => ({
  level: sheet.level + 1,
  maxHp: sheet.maxHp + 6 + abilityMod(sheet.abilities.con),
  currentHp: sheet.currentHp + 6 + abilityMod(sheet.abilities.con),
  hitDice: { ...sheet.hitDice, total: sheet.level + 1 },
  ...extra,
});

// ---- enforced today ----

await test("an earned level is taken, and the stored sheet is the levelled one", async () => {
  const { sheet, patch } = await table(FIGHTER, { xp: XP[2] });
  const before = sheet();
  const response = await patch(fighterLevel(before));
  assert.equal(response.status, 200, response.json.error);
  const after = sheet();
  assert.equal(after.level, 2);
  assert.equal(after.maxHp, 20);
  assert.equal(after.hitDice.total, 2);
  assert.equal(after.xp, 300);
  assert.deepEqual(response.json.sheet, after);
});

// This case used to pin "experience for several levels lets them be taken in
// one request". The owner's rule is one level a request (ODM says the same of
// the DM's own correction, mutation-math.ts sheetBuffViolation), so the three
// earned levels are taken one after another, and a jump is refused.
await test("experience for several levels lets them be taken, one request each", async () => {
  const { sheet, patch } = await table(FIGHTER, { xp: XP[4] });
  const before = sheet();
  const jump = await patch({ level: 4, maxHp: 12 + 3 * 8, hitDice: { die: "d10", total: 4, spent: 0 } });
  assert.equal(jump.status, 400, JSON.stringify(jump.json));
  assert.deepEqual(sheet(), before);
  for (const level of [2, 3, 4]) {
    const response = await patch({ level });
    assert.equal(response.status, 200, response.json.error);
    assert.equal(sheet().level, level);
    assert.equal(sheet().maxHp, 12 + (level - 1) * 8);
    assert.equal(sheet().hitDice.total, level);
  }
  // The experience is for 4th level and no further.
  assert.equal((await patch({ level: 5 })).status, 403);
  assert.equal(sheet().level, 4);
});

await test("outside a level-up only portrait, notes and backstory can be written", async () => {
  const { sheet, patch } = await table({ ...FIGHTER, level: 3 }, { xp: XP[3] });
  const before = sheet();
  const attempts = [
    { maxHp: 200 },
    { currentHp: 1 },
    { gold: 5000 },
    { xp: 355000 },
    { abilities: { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 } },
    { feats: ["Lucky"] },
    { features: [{ name: "Extra Attack (3)", source: "story" }] },
    { subclass: "Champion" },
    { hitDice: { die: "d12", total: 20, spent: 0 } },
    { level: 3, maxHp: 200 },
    { level: 2 },
    { level: 1, gold: 9 },
  ];
  for (const body of attempts) {
    const response = await patch(body);
    assert.equal(response.status, 403, JSON.stringify(body));
    assert.deepEqual(sheet(), before, JSON.stringify(body));
  }
  const notes = await patch({ notes: "a note", backstory: "a past" });
  assert.equal(notes.status, 200);
  assert.equal(sheet().notes, "a note");
  assert.equal(sheet().level, 3);
});

await test("no sheet passes level 20, and a level is a whole number from 1", async () => {
  const { sheet, patch } = await table({ ...FIGHTER, level: 19 }, { xp: 20000 });
  const before = sheet();
  for (const level of [21, 25, 0, -1, 19.5, "20"]) {
    const response = await patch({ level });
    assert.ok(response.status >= 400, `level ${level} answered ${response.status}`);
    assert.deepEqual(sheet(), before);
  }
});

await test("a player reaches only their own sheet, and nobody levels a companion through it", async () => {
  const { world, sheet, id } = await table(FIGHTER, { xp: XP[2] });
  const before = sheet();
  const stranger = world.addUser("stranger");
  const refused = await patchSheetAs(world, sheetRoute, stranger, fighterLevel(before));
  assert.ok(refused.status >= 400);
  const named = await patchSheetAs(world, sheetRoute, world.owner, { sheetId: id, level: 2 });
  assert.ok(named.status >= 400);
  assert.deepEqual(sheet(), before);
});

await test("a level-up leaves spent uses spent, and sizes the counters for the new level", async () => {
  const { world, id, sheet, patch } = await table(
    { class: "monk", level: 4, maxHp: 27, abilities: { dex: 16, wis: 14 } },
    { xp: XP[5] },
  );
  const spent = await world.invoke("use_resource", { characterId: id, resource: "ki", amount: 3, reason: "flurry" });
  assert.equal(spent.ok, true, spent.error);
  assert.deepEqual(sheet().resources.ki, { max: 4, used: 3 });
  const response = await patch({ level: 5, maxHp: 32, features: sheet().features });
  assert.equal(response.status, 200, response.json.error);
  assert.deepEqual(sheet().resources.ki, { max: 5, used: 3 });
});

await test("a level set with features beside it regrants the class's and keeps every other entry", async () => {
  // The DM's correction, the lead's edit and the engine's own patches reach
  // patchSheet with a level and a feature list together. The class and race
  // entries are the tables' for the new level; a pick, a feat, a background
  // feature and a story boon are kept, the ones arriving in the same patch
  // included.
  const { world, id, sheet } = await table({ ...FIGHTER, level: 2, maxHp: 20 });
  world.patch(id, {
    level: 3,
    subclass: "Battle Master",
    features: [
      ...sheet().features,
      { name: "Rage", source: "class" },
      { name: "Maneuver: Riposte", source: "choice" },
      { name: "Maneuver: Parry", source: "choice" },
      { name: "Maneuver: Trip Attack", source: "choice" },
      { name: "Keen Mind", source: "feat" },
      { name: "Military Rank (Soldier)", source: "background" },
      { name: "Blessing of the Tide", source: "story" },
    ],
  });
  const names = sheet().features.map((feature) => feature.name);
  for (const kept of [
    "Maneuver: Riposte", "Maneuver: Parry", "Maneuver: Trip Attack", "Keen Mind",
    "Military Rank (Soldier)", "Blessing of the Tide", "Combat Superiority", "Action Surge (1 use)",
  ]) {
    assert.ok(names.includes(kept), `${kept} is missing from ${names.join(", ")}`);
  }
  assert.ok(!names.includes("Rage"), "a class feature of another class was kept");
  assert.equal(sheet().hitDice.total, 3);
  assert.equal(sheet().xp, XP[3]);
});

// ---- findings: the level itself ----

await test(
  "A character reaches 2nd level at 300 experience points; a level is earned, not taken.",
  async () => {
    for (const status of ["active", "lobby"]) {
      const { sheet, patch } = await table(FIGHTER, { status });
      await patch(fighterLevel(sheet()));
      assert.equal(sheet().level, 1, `${status} table: level ${sheet().level} on 0 XP`);
    }
  },
);

await test(
  "A character holds the level their experience has reached and no higher: 300 XP is 2nd level, not 20th.",
  async () => {
    const { sheet, patch } = await table(FIGHTER, { xp: XP[2] });
    await patch({ level: 20 });
    assert.ok(sheet().level <= 2, `a fighter with 300 XP reached level ${sheet().level}`);
  },
);

// ---- findings: hit points and hit dice ----

await test(
  "A level adds at most the hit die's highest face plus the Constitution modifier to the hit point maximum (d10 and CON 14: 12).",
  async () => {
    const { sheet, patch } = await table(FIGHTER, { xp: XP[2] });
    await patch({ ...fighterLevel(sheet()), maxHp: 500, currentHp: 500 });
    assert.ok(sheet().maxHp <= 12 + 10 + 2, `max HP is ${sheet().maxHp}`);
  },
);

await test(
  "Levelling raises the hit point maximum; it is not a rest, so current hit points rise by the gain and no more.",
  async () => {
    const { world, id, sheet, patch } = await table({ ...FIGHTER, level: 3, maxHp: 28 }, { xp: XP[4] });
    await world.invoke("apply_damage", { characterId: id, amount: 20, reason: "a bad fight" });
    assert.equal(sheet().currentHp, 8);
    await patch({ ...fighterLevel(sheet()), currentHp: 36, tempHp: 50 });
    assert.ok(sheet().currentHp <= 8 + 12, `current HP is ${sheet().currentHp}`);
    assert.equal(sheet().tempHp, 0);
  },
);

await test(
  "A character at 0 hit points is dying until healed or stabilized; a sheet holds hit points or a death-save track, never both.",
  async () => {
    const { world, id, sheet, patch } = await table({ ...FIGHTER, level: 3, maxHp: 28 }, { xp: XP[4] });
    await world.invoke("apply_damage", { characterId: id, amount: 28, reason: "felled" });
    assert.equal(sheet().currentHp, 0);
    assert.ok(sheet().deathSaves);
    await patch(fighterLevel(sheet()));
    const after = sheet();
    assert.ok(after.currentHp === 0 || after.deathSaves === null, `HP ${after.currentHp} with ${JSON.stringify(after.deathSaves)}`);
  },
);

await test(
  "A character has one hit die per level, of the class's die, and levelling does not return spent ones.",
  async () => {
    const wizard = await table({ class: "wizard", level: 1, maxHp: 6, hitDice: { die: "d6", total: 1, spent: 1 } }, { xp: XP[2] });
    await wizard.patch({ level: 2, maxHp: 10, hitDice: { die: "d12", total: 20, spent: 0 } });
    const held = wizard.sheet().hitDice;
    assert.deepEqual(held, { die: "d6", total: 2, spent: 1 }, `a wizard 2 holds ${JSON.stringify(held)}`);
    const bare = await table(FIGHTER, { xp: XP[2] });
    await bare.patch({ level: 2, maxHp: 20 });
    assert.equal(bare.sheet().hitDice.total, bare.sheet().level);
  },
);

// ---- findings: what the class grants ----

await test(
  "Class features come from the class table at the class's level; a player cannot add one.",
  async () => {
    const wizard = await table({ class: "wizard", level: 1, maxHp: 6 }, { xp: XP[2] });
    await wizard.patch({
      level: 2,
      maxHp: 10,
      features: [
        { name: "Rage", source: "class" },
        { name: "Sneak Attack", source: "class" },
        { name: "Extra Attack (3)", source: "story" },
      ],
    });
    const after = wizard.sheet();
    const riders = combatRiders(after);
    assert.equal(after.resources.rage, undefined, "a wizard holds a Rage counter");
    assert.equal(riders.sneakAttackDice, 0);
    assert.equal(riders.extraAttacks, 0);
  },
);

await test(
  "Reaching a level grants that level's class features: a fighter 5 has Extra Attack.",
  async () => {
    // One level a request, and no feature list sent with any of them.
    const { sheet, patch } = await table(FIGHTER, { xp: XP[5] });
    for (const level of [2, 3, 4, 5]) {
      await patch({ level, maxHp: 44, hitDice: { die: "d10", total: level, spent: 0 } });
    }
    assert.equal(sheet().level, 5);
    const names = sheet().features.map((feature) => feature.name);
    assert.ok(names.includes("Extra Attack"), `a fighter 5 holds ${names.join(", ")}`);
    assert.equal(sheet().resources.action_surge?.max, 1);
  },
);

await test(
  "Experience, coin, gear, armor class and conditions are the engine's and the DM's to change, in a level-up as at any other time.",
  async () => {
    const { world, id, sheet, patch } = await table({ ...FIGHTER, gold: 10 }, { xp: XP[2] });
    await world.invoke("set_condition", { characterId: id, condition: "poisoned", reason: "a bad mushroom" });
    const before = sheet();
    await patch({
      ...fighterLevel(before),
      xp: 355000,
      gold: 1000000,
      ac: 30,
      conditions: [],
      equipment: [{ name: "Vorpal Sword", qty: 1 }],
    });
    const owned = ({ xp, gold, ac, conditions, equipment }) => ({
      xp,
      gold,
      ac,
      conditions,
      equipment: equipment.map((item) => item.name),
    });
    assert.deepEqual(before.conditions, ["poisoned"]);
    assert.deepEqual(owned(sheet()), owned(before), `the sheet now holds ${JSON.stringify(owned(sheet()))}`);
  },
);

await test(
  "Levelling is not a rest: a spell slot spent before the level-up is still spent after it.",
  async () => {
    const { sheet, patch } = await table(
      {
        class: "wizard",
        level: 3,
        maxHp: 14,
        spellcasting: {
          ability: "int",
          slots: { 1: { max: 4, used: 4 }, 2: { max: 2, used: 2 } },
          prepared: [],
          known: [],
          cantrips: [],
        },
      },
      { xp: XP[4] },
    );
    await patch({
      level: 4,
      maxHp: 18,
      spellcasting: {
        ...sheet().spellcasting,
        slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
      },
    });
    const slots = sheet().spellcasting.slots;
    assert.deepEqual(
      slots,
      { 1: { max: 4, used: 4 }, 2: { max: 3, used: 2 } },
      `a wizard with every slot spent levels up holding ${JSON.stringify(slots)}`,
    );
  },
);

// ---- findings: the subclass ----

await test(
  "A fighter chooses a Martial Archetype at 3rd level, not before.",
  async () => {
    const { sheet, patch } = await table(FIGHTER, { xp: XP[2] });
    await patch({ ...fighterLevel(sheet()), subclass: "Champion" });
    assert.equal(sheet().subclass, "", `a fighter 2 holds the subclass "${sheet().subclass}"`);
  },
);

await test(
  "A subclass belongs to one class: a fighter cannot take the cleric's Life Domain.",
  async () => {
    const { sheet, patch } = await table({ ...FIGHTER, level: 2, maxHp: 20 }, { xp: XP[3] });
    await patch({ ...fighterLevel(sheet()), subclass: "Life Domain" });
    assert.notEqual(sheet().subclass, "Life Domain", "a fighter 3 holds the subclass Life Domain");
  },
);

await test(
  "A subclass is chosen once; later levels build on it.",
  async () => {
    const { sheet, patch } = await table({ ...FIGHTER, level: 3, maxHp: 28, subclass: "Champion" }, { xp: XP[4] });
    await patch({ ...fighterLevel(sheet()), subclass: "Battle Master" });
    assert.equal(sheet().subclass, "Champion", `the Champion is now a ${sheet().subclass}`);
  },
);

first.close();
finish();
