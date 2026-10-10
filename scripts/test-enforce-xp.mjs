// Experience, and what earning it does.
//
// ODM levels by experience points. There is no milestone setting: the DM
// awards XP (award_xp, party_award), the engine adds a slice itself when a
// chapter closes, and a sheet whose total has reached the next row of the
// SRD table is offered its level. The award never raises the level; the
// player takes it in the level-up dialog. A companion has no dialog, so the
// engine levels it on the spot (src/lib/dm/companion-tools.ts
// autoLevelCompanion).
//
// The rules held here:
//   the SRD 5.1 experience table, every row and both sides of every row;
//   an award adds to the stored total and changes nothing else;
//   an award is a whole positive number, at most 20000 at once (ODM's own
//   ceiling, stated in src/lib/dm/mutations.ts);
//   the DM's sheet correction moves a level by one at most, and cannot set
//   experience that is worth more than that
//   (src/lib/dm/mutation-math.ts sheetBuffViolation);
//   a companion levelled by the engine holds a legal sheet at every level.
//
// Companions are recruited as guests here: a lasting companion queues a
// portrait render, which a test has no business starting.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import {
  PROFICIENCY_BY_LEVEL,
  SRD_CLASSES,
  XP_BY_LEVEL,
  averageHp,
  cleanName,
  expectedFeatureNames,
  expectedResourceMax,
  topSlotLevel,
} from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-xp");
const world = await openWorld();
const { XP_THRESHOLDS, levelForXp, computeSheetDerived } = await import("../src/lib/srd/index.ts");

const levelOf = (xp) => {
  let level = 1;
  XP_BY_LEVEL.forEach((needed, index) => {
    if (xp >= needed) {
      level = index + 1;
    }
  });
  return level;
};

const award = (ids, amount) =>
  world.invoke("award_xp", { characterIds: ids, amount, reason: "earned in play" });

// ---- the table ----

await test("the experience table is the SRD's, row for row", () => {
  assert.deepEqual([...XP_THRESHOLDS], XP_BY_LEVEL);
});

await test("a level is reached on the exact point, and not one point sooner", () => {
  for (let level = 2; level <= 20; level += 1) {
    const needed = XP_BY_LEVEL[level - 1];
    assert.equal(levelForXp(needed - 1), level - 1, `${needed - 1} XP`);
    assert.equal(levelForXp(needed), level, `${needed} XP`);
    assert.equal(levelForXp(needed + 1), level, `${needed + 1} XP`);
  }
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(1000000), 20);
});

// ---- awards ----

const fighter = world.addHero({ class: "fighter", level: 1, maxHp: 12, abilities: { str: 16, con: 14 } });
const rogue = world.addHero({ class: "rogue", level: 1, maxHp: 9, abilities: { dex: 16 } });

await test("an award adds to the total, and the level waits for the player", async () => {
  const before = world.sheet(fighter.id);
  const short = await award([fighter.id], 299);
  assert.equal(short.ok, true, short.error);
  assert.equal(short.result.levelUpAvailable, undefined);
  assert.equal(world.sheet(fighter.id).xp, 299);

  const crossed = await award([fighter.id], 1);
  assert.deepEqual(crossed.result.levelUpAvailable, [before.name]);
  const after = world.sheet(fighter.id);
  assert.equal(after.xp, 300);
  // Everything but the total is as it was.
  assert.deepEqual({ ...after, xp: 0, updatedAt: "" }, { ...before, xp: 0, updatedAt: "" });
});

await test("an award is a whole positive number no larger than 20000", async () => {
  const before = world.sheet(fighter.id);
  for (const amount of [0, -1, -300, 1.5, 20001, 1000000, "many"]) {
    const refused = await award([fighter.id], amount);
    assert.equal(refused.ok, false, `an award of ${amount} was accepted`);
    assert.deepEqual(world.sheet(fighter.id), before, `an award of ${amount} changed the sheet`);
  }
  const unknown = await award(["nobody"], 50);
  assert.equal(unknown.ok, false);
  const most = await award([fighter.id], 20000);
  assert.equal(most.ok, true, most.error);
  assert.equal(world.sheet(fighter.id).xp, before.xp + 20000);
});

await test("experience for several levels at once offers them all, and takes none", async () => {
  // 20300 XP is 6th level (14000); the sheet is still 1st.
  const sheet = world.sheet(fighter.id);
  assert.equal(sheet.xp, 20300);
  assert.equal(sheet.level, 1);
  assert.equal(levelForXp(sheet.xp), levelOf(sheet.xp));
  assert.equal(levelOf(sheet.xp), 6);
});

await test("the party's spoils: experience each, the purse split, the remainder to the first", async () => {
  const before = [world.sheet(fighter.id), world.sheet(rogue.id)];
  const shared = await world.invoke("party_award", {
    characterIds: [fighter.id, rogue.id],
    amount: 150,
    delta: 11,
    reason: "the hoard",
  });
  assert.equal(shared.ok, true, shared.error);
  const after = [world.sheet(fighter.id), world.sheet(rogue.id)];
  assert.deepEqual(after.map((sheet) => sheet.xp), before.map((sheet) => sheet.xp + 150));
  assert.deepEqual(after.map((sheet) => sheet.gold), [before[0].gold + 6, before[1].gold + 5]);
  assert.deepEqual(after.map((sheet) => sheet.level), [1, 1]);
  const empty = await world.invoke("party_award", { characterIds: [fighter.id, rogue.id], reason: "nothing" });
  assert.equal(empty.ok, false);
});

await test("a level 20 character still earns experience and is offered nothing", async () => {
  const table = await openWorld();
  const legend = table.addHero({ class: "fighter", level: 20, maxHp: 164 });
  const awarded = await table.invoke("award_xp", { characterIds: [legend.id], amount: 20000, reason: "x" });
  assert.equal(awarded.ok, true, awarded.error);
  assert.equal(awarded.result.levelUpAvailable, undefined);
  assert.equal(table.sheet(legend.id).level, 20);
  // A 20th level character starts with the 355000 that level takes.
  assert.equal(table.sheet(legend.id).xp, XP_BY_LEVEL[19] + 20000);
});

// The console's form for update_sheet asks for `field` and `value`, which
// the façade insists on; the handler reads the sheet's own keys, so both are
// sent (see the finding at the end).
const correct = (table, id, patch) =>
  table.invoke("update_sheet", {
    characterId: id,
    field: Object.keys(patch)[0],
    value: String(Object.values(patch)[0]),
    reason: "a correction",
    ...patch,
  });

await test("the DM's correction moves a level by one, and cannot set experience worth more", async () => {
  const table = await openWorld();
  const hero = table.addHero({ class: "fighter", level: 4, maxHp: 36 });
  for (const patch of [{ level: 6 }, { level: 20 }, { xp: XP_BY_LEVEL[5] }, { xp: 355000 }]) {
    const refused = await correct(table, hero.id, patch);
    assert.equal(refused.ok, false, JSON.stringify(patch));
    assert.equal(table.sheet(hero.id).level, 4);
    // What 4th level takes, which the hero was made with.
    assert.equal(table.sheet(hero.id).xp, XP_BY_LEVEL[3]);
  }
  const one = await correct(table, hero.id, { level: 5 });
  assert.equal(one.ok, true, one.error);
  assert.equal(table.sheet(hero.id).level, 5);
});

// ---- companions ----

async function recruit(table, classId) {
  const joined = await table.invoke("add_companion", {
    gender: "Unknown",
    name: `The ${classId}`,
    class: classId,
    race: "human",
    level: 1,
    personality: "Dry, loyal, counts the exits.",
    kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  return joined.result.characterId;
}

// What a companion's sheet must satisfy at a level. No subclass: the engine
// never picks one for a companion (see the pinned rule below).
function companionProblems(classId, sheet, level) {
  const table = SRD_CLASSES[classId];
  const problems = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) {
      problems.push(`L${level} ${label}: ${JSON.stringify(actual)}, the table says ${JSON.stringify(expected)}`);
    }
  };
  expect("level", sheet.level, level);
  expect("proficiency bonus", computeSheetDerived(sheet).proficiencyBonus, PROFICIENCY_BY_LEVEL[level - 1]);
  expect("hit dice", `${sheet.hitDice.total}${sheet.hitDice.die}`, `${level}d${table.hitDie}`);
  expect("hit points", sheet.maxHp, averageHp(table.hitDie, abilityMod(sheet.abilities.con), level));
  const expected = expectedFeatureNames(classId, level, false);
  const held = sheet.features.filter((feature) => feature.source === "class").map((feature) => cleanName(feature.name));
  for (const name of held) {
    if (!expected.has(name)) {
      problems.push(`L${level} holds "${name}" early`);
    }
  }
  for (const name of expected.keys()) {
    if (held.filter((entry) => entry === name).length !== 1) {
      problems.push(`L${level} holds "${name}" ${held.filter((entry) => entry === name).length} times`);
    }
  }
  for (const [id, spec] of Object.entries(table.resources ?? {})) {
    const want = expectedResourceMax(spec, level);
    if (Number.isFinite(want) || want === null) {
      expect(`${id} max`, sheet.resources[id]?.max ?? null, want);
    }
  }
  for (const [id, state] of Object.entries(sheet.resources)) {
    if (!(state.used >= 0 && state.used <= state.max)) {
      problems.push(`L${level} ${id} holds ${state.used} used of ${state.max}`);
    }
  }
  if (table.caster === "full") {
    const open = Object.entries(sheet.spellcasting?.slots ?? {}).filter(([, slot]) => slot.max > 0);
    expect("top slot level", Math.max(0, ...open.map(([slotLevel]) => Number(slotLevel))), topSlotLevel("full", level));
  }
  return problems;
}

for (const classId of ["fighter", "wizard", "monk"]) {
  await test(`a ${classId} companion levels with its experience and holds a legal sheet at every level`, async () => {
    const table = await openWorld();
    table.addHero({ class: "fighter", level: 1, maxHp: 12 });
    const id = await recruit(table, classId);
    const problems = companionProblems(classId, table.sheet(id), 1);
    for (let level = 2; level <= 20; level += 1) {
      // Exactly the experience the next row asks for, in awards of 20000.
      let owed = XP_BY_LEVEL[level - 1] - table.sheet(id).xp;
      while (owed > 0) {
        const amount = Math.min(20000, owed);
        const awarded = await table.invoke("award_xp", { characterIds: [id], amount, reason: "x" });
        assert.equal(awarded.ok, true, awarded.error);
        owed -= amount;
      }
      problems.push(...companionProblems(classId, table.sheet(id), level));
    }
    assert.equal(problems.length, 0, problems.slice(0, 30).join("; "));
  });
}

await test("a companion's level-up returns nothing spent, and takes several levels in one award", async () => {
  const table = await openWorld();
  table.addHero({ class: "fighter", level: 1, maxHp: 12 });
  const id = await recruit(table, "fighter");
  const spent = await table.invoke("use_resource", { characterId: id, resource: "second wind", reason: "x" });
  assert.equal(spent.ok, true, spent.error);
  await table.invoke("apply_damage", { characterId: id, amount: 5, reason: "x" });
  const before = table.sheet(id);
  table.patch(id, { hitDice: { ...before.hitDice, spent: 1 } });

  const jumped = await table.invoke("award_xp", { characterIds: [id], amount: 14000, reason: "x" });
  assert.equal(jumped.result.companionLevelUps.length, 1);
  assert.equal(jumped.result.levelUpAvailable, undefined);
  const after = table.sheet(id);
  assert.equal(after.level, 6);
  assert.deepEqual(after.resources.second_wind, { max: 1, used: 1 });
  assert.deepEqual(after.hitDice, { die: "d10", total: 6, spent: 1 });
  // Still five short of full, on the larger maximum.
  assert.equal(after.maxHp - after.currentHp, before.maxHp - before.currentHp);
});

await test("ODM's rule: a companion's level-up picks no subclass", async () => {
  // autoLevelCompanion's header: "a plain headless level-up (average HP,
  // refreshed features and slots; subclass choices stay as they are)". The
  // SRD has every fighter choose an archetype at 3rd level.
  const table = await openWorld();
  table.addHero({ class: "fighter", level: 1, maxHp: 12 });
  const id = await recruit(table, "fighter");
  await table.invoke("award_xp", { characterIds: [id], amount: XP_BY_LEVEL[4], reason: "x" });
  assert.equal(table.sheet(id).level, 5);
  assert.equal(table.sheet(id).subclass, "");
});

// ---- findings ----

await test(
  "A character of 5th level has 6500 experience points, and reaches 6th at 14000: 7500 more.",
  async () => {
    const table = await openWorld({ campaign: { startingLevel: 5 } });
    const hero = table.addHero({ class: "fighter", level: 5, maxHp: 44 });
    const awarded = await table.invoke("award_xp", {
      characterIds: [hero.id],
      amount: XP_BY_LEVEL[5] - XP_BY_LEVEL[4],
      reason: "a level's worth of play",
    });
    assert.equal(awarded.ok, true, awarded.error);
    assert.deepEqual(
      awarded.result.levelUpAvailable,
      [hero.name],
      `a level 5 hero with ${table.sheet(hero.id).xp} XP is offered nothing`,
    );
  },
);

await test(
  "A character of a level holds that level's hit dice and class features, however the level was reached.",
  async () => {
    const table = await openWorld();
    const hero = table.addHero({ class: "fighter", level: 4, maxHp: 36 });
    const raised = await correct(table, hero.id, { level: 5 });
    assert.equal(raised.ok, true, raised.error);
    const sheet = table.sheet(hero.id);
    const names = sheet.features.map((feature) => feature.name);
    assert.equal(sheet.hitDice.total, 5, `a fighter 5 holds ${sheet.hitDice.total} hit dice`);
    assert.ok(names.includes("Extra Attack"), `a fighter 5 holds ${names.join(", ")}`);
  },
);

await test(
  "Every class improves its ability scores at its own levels, a companion's included: two points, or a feat, for each.",
  async () => {
    const table = await openWorld();
    table.addHero({ class: "fighter", level: 1, maxHp: 12 });
    const id = await recruit(table, "fighter");
    const before = table.sheet(id);
    await table.invoke("award_xp", { characterIds: [id], amount: XP_BY_LEVEL[3], reason: "x" });
    const after = table.sheet(id);
    assert.equal(after.level, 4);
    const total = (scores) => Object.values(scores).reduce((sum, score) => sum + score, 0);
    assert.equal(
      total(after.abilities) + 2 * after.feats.length,
      total(before.abilities) + 2,
      "a companion reached 4th level with the scores it had at 1st and no feat",
    );
  },
);

await test(
  "The DM console's Correct a sheet changes the field it names: a level typed as text raises the level.",
  async () => {
    const table = await openWorld();
    const hero = table.addHero({ class: "fighter", level: 4, maxHp: 36 });
    const raised = await table.invoke("update_sheet", {
      characterId: hero.id,
      field: "level",
      value: "5",
      reason: "the table agreed",
    });
    assert.equal(raised.ok, true, raised.error);
    assert.equal(table.sheet(hero.id).level, 5);
  },
);

world.close();
finish();
