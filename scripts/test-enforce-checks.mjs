// Ability checks and saving throws as the engine rolls them (request_roll,
// group_check, check_notice): the modifier comes from the sheet and never
// from whoever asks, the DC comes from the difficulty ladder, and the roll
// succeeds when the total meets the DC. The saves an enemy forces are in
// test-enforce-forced-saves.mjs.
//
// The rules, from SRD 5.1:
//   - A check is d20 + ability modifier, + proficiency bonus when proficient,
//     twice that with expertise. A save is d20 + ability modifier, +
//     proficiency bonus when proficient in that save.
//   - Typical DCs: very easy 5, easy 10, medium 15, hard 20, very hard 25,
//     nearly impossible 30.
//   - A passive check is 10 + every modifier the check would have, +5 with
//     advantage and -5 with disadvantage.
//   - A natural 20 or a natural 1 decides nothing on a check or a save. Only
//     attack rolls have automatic hits and misses.
//   - A group check succeeds when at least half the group does.
//
// ODM's own rules, pinned here as it documents them:
//   - Strictness shifts a difficulty tier's DC: two lower when lenient, two
//     higher when harsh, never below 5 (src/lib/srd/dc.ts). An exact DC is
//     never shifted.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-checks");
const world = await openWorld();
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { handleCheckNotice } = await import("../src/lib/dm/check-tools.ts");

const SKILLS = {
  acrobatics: "dex", animal_handling: "wis", arcana: "int", athletics: "str",
  deception: "cha", history: "int", insight: "wis", intimidation: "cha",
  investigation: "int", medicine: "wis", nature: "int", perception: "wis",
  performance: "cha", persuasion: "cha", religion: "int", sleight_of_hand: "dex",
  stealth: "dex", survival: "wis",
};
const LADDER = { very_easy: 5, easy: 10, moderate: 15, hard: 20, very_hard: 25, nearly_impossible: 30 };
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

const SCORES = { str: 12, dex: 16, con: 14, int: 8, wis: 15, cha: 11 };
const scout = world.addHero({
  class: "ranger", level: 5, abilities: SCORES,
  proficiencies: { ...TRAINED, saves: ["str", "dex"], skills: ["stealth", "perception", "survival"], expertise: ["stealth"] },
});
const bard = world.addHero({
  class: "bard", level: 5, abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 16 },
  proficiencies: { ...TRAINED, saves: ["dex", "cha"], skills: ["persuasion"] },
});
const rogue = world.addHero({
  class: "rogue", level: 11, abilities: { dex: 16, wis: 12 },
  proficiencies: { ...TRAINED, saves: ["dex", "int"], skills: ["stealth"] },
});
const watcher = world.addHero({
  class: "fighter", level: 5, abilities: { wis: 14 }, feats: ["Observant"],
  proficiencies: { ...TRAINED, saves: ["str", "con"], skills: ["perception"] },
});
const party = [scout, bard, rogue, watcher];
const PB = proficiencyBonus(5);

const reset = () => {
  for (const hero of party) {
    world.patch(hero.id, { conditions: [], conditionMeta: {}, exhaustion: 0, currentHp: hero.maxHp });
  }
  world.clearDice();
  world.diceLog();
};

// One requested roll with its dice forced; `faces` are the d20s it took.
async function ask(hero, args, dice = [11, 17]) {
  world.clearDice();
  world.diceLog();
  world.dice(...dice);
  const out = await world.invoke("request_roll", { characterId: hero.id, ...args });
  world.clearDice();
  const faces = world.diceLog().filter((die) => die.sides === 20).map((die) => die.face);
  return { out, ok: out.ok, result: out.result ?? {}, faces };
}

await test("every skill: the sheet's ability, proficiency and expertise, nothing from the caller", async () => {
  reset();
  for (const [skill, ability] of Object.entries(SKILLS)) {
    const bonus =
      abilityMod(SCORES[ability]) +
      (skill === "stealth" ? 2 * PB : ["perception", "survival"].includes(skill) ? PB : 0);
    const roll = await ask(scout, { kind: "skill_check", skill, expression: "1d20+20", dc: 12 });
    assert.equal(roll.ok, true, roll.out.error);
    assert.deepEqual(roll.faces, [11], skill);
    assert.equal(roll.result.total, 11 + bonus, skill);
    assert.equal(roll.result.success, 11 + bonus >= 12, skill);
  }
});

await test("every save: the ability modifier, and the proficiency bonus only where trained", async () => {
  reset();
  for (const ability of ABILITIES) {
    const bonus = abilityMod(SCORES[ability]) + (["str", "dex"].includes(ability) ? PB : 0);
    const roll = await ask(scout, { kind: "saving_throw", ability, dc: 10 });
    assert.equal(roll.result.total, 11 + bonus, ability);
    const check = await ask(scout, { kind: "ability_check", ability, dc: 10 });
    assert.equal(check.result.total, 11 + abilityMod(SCORES[ability]), ability);
  }
});

await test("the difficulty ladder is 5, 10, 15, 20, 25, 30", async () => {
  reset();
  for (const [difficulty, dc] of Object.entries(LADDER)) {
    const roll = await ask(scout, { kind: "ability_check", ability: "int", difficulty });
    assert.equal(roll.result.dc, dc, difficulty);
  }
});

await test("a roll succeeds when it meets the DC and fails one short", async () => {
  reset();
  // INT 8: -1.
  const met = await ask(scout, { kind: "ability_check", ability: "int", dc: 15 }, [16]);
  assert.equal(met.result.total, 15);
  assert.equal(met.result.success, true);
  const short = await ask(scout, { kind: "ability_check", ability: "int", dc: 15 }, [15]);
  assert.equal(short.result.success, false);
  const stored = listRecentRolls(world.campaignId, 1)[0];
  assert.equal(stored.dc, 15);
  assert.equal(stored.total, 14);
});

await test("a natural 20 is no automatic success and a natural 1 no automatic failure", async () => {
  reset();
  const twenty = await ask(scout, { kind: "ability_check", ability: "int", dc: 25 }, [20]);
  assert.equal(twenty.result.total, 19);
  assert.equal(twenty.result.success, false);
  const save = await ask(scout, { kind: "saving_throw", ability: "int", dc: 25 }, [20]);
  assert.equal(save.result.success, false);
  // Stealth with expertise: +9.
  const one = await ask(scout, { kind: "skill_check", skill: "stealth", dc: 10 }, [1]);
  assert.equal(one.result.total, 1 + abilityMod(16) + 2 * PB);
  assert.equal(one.result.success, true);
  const oneSave = await ask(scout, { kind: "saving_throw", ability: "dex", dc: 5 }, [1]);
  assert.equal(oneSave.result.success, true);
});

await test("advantage and disadvantage on a check: two dice, the higher or the lower", async () => {
  reset();
  const adv = await ask(scout, { kind: "ability_check", ability: "str", advantage: "advantage" }, [4, 15]);
  assert.deepEqual(adv.faces, [4, 15]);
  assert.equal(adv.result.total, 15 + abilityMod(12));
  const dis = await ask(scout, { kind: "ability_check", ability: "str", advantage: "disadvantage" }, [4, 15]);
  assert.equal(dis.result.total, 4 + abilityMod(12));
});

await test("poisoned, frightened and exhausted: disadvantage on checks", async () => {
  for (const patch of [{ conditions: ["poisoned"] }, { conditions: ["frightened"] }, { exhaustion: 1 }]) {
    reset();
    world.patch(scout.id, patch);
    const check = await ask(scout, { kind: "ability_check", ability: "str" }, [4, 15]);
    assert.deepEqual(check.faces, [4, 15], JSON.stringify(patch));
    assert.equal(check.result.total, 4 + abilityMod(12), JSON.stringify(patch));
    // None of them touches a saving throw.
    const save = await ask(scout, { kind: "saving_throw", ability: "con" }, [4, 15]);
    assert.deepEqual(save.faces, [4], JSON.stringify(patch));
  }
});

await test("exhaustion level 3: disadvantage on saves too", async () => {
  reset();
  world.patch(scout.id, { exhaustion: 3 });
  const save = await ask(scout, { kind: "saving_throw", ability: "con" }, [4, 15]);
  assert.deepEqual(save.faces, [4, 15]);
  assert.equal(save.result.total, 4 + abilityMod(14));
});

await test("restrained: disadvantage on Dexterity saves; paralyzed: Strength and Dexterity saves fail", async () => {
  reset();
  world.patch(scout.id, { conditions: ["restrained"] });
  const dex = await ask(scout, { kind: "saving_throw", ability: "dex" }, [4, 15]);
  assert.equal(dex.result.total, 4 + abilityMod(16) + PB);
  const wis = await ask(scout, { kind: "saving_throw", ability: "wis" }, [4, 15]);
  assert.deepEqual(wis.faces, [4]);
  for (const condition of ["paralyzed", "stunned", "unconscious", "petrified"]) {
    world.patch(scout.id, { conditions: [condition] });
    for (const ability of ["str", "dex"]) {
      const save = await ask(scout, { kind: "saving_throw", ability, dc: 1 }, [20]);
      assert.equal(save.result.success, false, `${condition} ${ability}`);
      assert.deepEqual(save.faces, [], `${condition} ${ability}`);
    }
    const con = await ask(scout, { kind: "saving_throw", ability: "con", dc: 1 }, [10]);
    assert.equal(con.result.success, true, condition);
  }
});

await test("Jack of All Trades: half the proficiency bonus where there is none", async () => {
  reset();
  const half = Math.floor(PB / 2);
  const raw = await ask(bard, { kind: "ability_check", ability: "str" });
  assert.equal(raw.result.total, 11 + abilityMod(10) + half);
  const untrained = await ask(bard, { kind: "skill_check", skill: "athletics" });
  assert.equal(untrained.result.total, 11 + abilityMod(10) + half);
  const trained = await ask(bard, { kind: "skill_check", skill: "persuasion" });
  assert.equal(trained.result.total, 11 + abilityMod(16) + PB);
  // Never on a saving throw.
  const save = await ask(bard, { kind: "saving_throw", ability: "str" });
  assert.equal(save.result.total, 11 + abilityMod(10));
});

await test("Reliable Talent: a 9 or lower counts as 10 on a proficient check only", async () => {
  reset();
  const pb = proficiencyBonus(11);
  const low = await ask(rogue, { kind: "skill_check", skill: "stealth" }, [3]);
  assert.equal(low.result.total, 10 + abilityMod(16) + pb);
  const high = await ask(rogue, { kind: "skill_check", skill: "stealth" }, [14]);
  assert.equal(high.result.total, 14 + abilityMod(16) + pb);
  const untrained = await ask(rogue, { kind: "skill_check", skill: "perception" }, [3]);
  assert.equal(untrained.result.total, 3 + abilityMod(12));
  const save = await ask(rogue, { kind: "saving_throw", ability: "dex" }, [3]);
  assert.equal(save.result.total, 3 + abilityMod(16) + pb);
});

await test("a lasting effect is added to a raw ability check and a saving throw", async () => {
  reset();
  const set = await world.invoke("set_effect", {
    characterId: scout.id, name: "Charm of Luck", field: "check",
    modifiers: [{ field: "check", mode: "add", value: 2 }, { field: "save", mode: "add", value: 3 }],
  });
  assert.equal(set.ok, true, set.error);
  const check = await ask(scout, { kind: "ability_check", ability: "str" });
  assert.equal(check.result.total, 11 + abilityMod(12) + 2);
  const save = await ask(scout, { kind: "saving_throw", ability: "con" });
  assert.equal(save.result.total, 11 + abilityMod(14) + 3);
  await world.invoke("clear_effect", { characterId: scout.id, name: "Charm of Luck" });
});

// Passive Perception: 10 + WIS + proficiency, +5 for Observant.
const PASSIVE = {
  [scout.id]: 10 + abilityMod(15) + PB,
  [bard.id]: 10 + abilityMod(10) + Math.floor(PB / 2),
  [rogue.id]: 10 + abilityMod(12),
  [watcher.id]: 10 + abilityMod(14) + PB + 5,
};

await test("passive Perception is 10 plus the check's modifiers, and meets the DC to notice", async () => {
  reset();
  for (const hero of party) {
    const passive = PASSIVE[hero.id];
    const met = await world.invoke("check_notice", { sense: "perception", dc: passive, characterIds: [hero.id] });
    assert.equal(met.ok, true, met.error);
    assert.deepEqual(met.result.noticedBy, [hero.name], `${hero.name} at ${passive}`);
    const short = await world.invoke("check_notice", { sense: "perception", dc: passive + 1, characterIds: [hero.id] });
    assert.deepEqual(short.result.missedBy, [hero.name], `${hero.name} at ${passive + 1}`);
  }
  assert.deepEqual(world.diceLog(), []);
});

await test("passive Insight and Investigation are 10 plus the skill", async () => {
  reset();
  const insight = 10 + abilityMod(15);
  const met = await world.invoke("check_notice", { sense: "insight", dc: insight, characterIds: [scout.id] });
  assert.equal(met.result.anyNoticed, true);
  const short = await world.invoke("check_notice", { sense: "insight", dc: insight + 1, characterIds: [scout.id] });
  assert.equal(short.result.anyNoticed, false);
  const investigation = 10 + abilityMod(8);
  const found = await world.invoke("check_notice", { sense: "investigation", dc: investigation, characterIds: [scout.id] });
  assert.equal(found.result.anyNoticed, true);
});

await test("a group check succeeds when at least half succeed", async () => {
  reset();
  // Strength checks: scout +1, bard +1 (Jack of All Trades), rogue +0.
  const group = async (ids, faces) => {
    world.clearDice();
    world.dice(...faces);
    const out = await world.invoke("group_check", { ability: "str", dc: 12, characterIds: ids });
    assert.equal(world.clearDice(), 0);
    assert.equal(out.ok, true, out.error);
    return out.result;
  };
  let result = await group([scout.id, bard.id], [11, 2]);
  assert.equal(result.successes, 1);
  assert.equal(result.passed, true);
  result = await group([scout.id, bard.id, rogue.id], [11, 2, 2]);
  assert.equal(result.successes, 1);
  assert.equal(result.passed, false);
  result = await group([scout.id, bard.id, rogue.id], [11, 11, 2]);
  assert.equal(result.passed, true);
  // A natural 20 that falls short is a failure in a group too.
  world.dice(20);
  const out = await world.invoke("group_check", { ability: "str", dc: 25, characterIds: [scout.id] });
  world.clearDice();
  assert.equal(out.result.passed, false);
});

await test("strictness shifts a tier by two and leaves an exact DC alone", async () => {
  for (const [strictness, shift] of [["lenient", -2], ["standard", 0], ["harsh", 2]]) {
    const table = await openWorld({ gameSettings: { gm: { strictness } } });
    assert.equal(table.campaign().gameSettings.gm.strictness, strictness);
    const hero = table.addHero({ class: "fighter", level: 5 });
    for (const [difficulty, dc] of Object.entries(LADDER)) {
      const expected = Math.max(5, dc + shift);
      table.dice(10);
      const group = await table.invoke("group_check", { ability: "str", difficulty, characterIds: [hero.id] });
      table.clearDice();
      assert.equal(group.result.dc, expected, `${strictness} ${difficulty} group_check`);
      // The console's form insists on an exact DC, so the tier goes to the
      // handler the model's call reaches.
      const notice = handleCheckNotice(
        table.campaign(),
        JSON.stringify({ difficulty, characterIds: [hero.id] }),
        table.sheets(),
        new Map(table.sheets().map((sheet) => [sheet.id, sheet])),
      );
      assert.equal(notice.dc, expected, `${strictness} ${difficulty} check_notice`);
    }
    table.dice(10);
    const exact = await table.invoke("group_check", { ability: "str", dc: 13, characterIds: [hero.id] });
    table.clearDice();
    assert.equal(exact.result.dc, 13, strictness);
  }
});

// Held elsewhere: request_roll ignores the table's strictness
// (test-enforce-variant-rules.mjs, variant-strictness-request-roll).

await test("A lasting effect on ability checks applies to skill checks, which are ability checks.", async () => {
  reset();
  await world.invoke("set_effect", {
    characterId: scout.id, name: "Charm of Luck", field: "check",
    modifiers: [{ field: "check", mode: "add", value: 2 }],
  });
  try {
    const roll = await ask(scout, { kind: "skill_check", skill: "athletics" });
    assert.equal(roll.result.total, 11 + abilityMod(12) + 2, `Athletics came to ${roll.result.total} under a +2 effect`);
  } finally {
    await world.invoke("clear_effect", { characterId: scout.id, name: "Charm of Luck" });
  }
});

await test("Help gives advantage on an ability check or an attack roll, never on a saving throw.", async () => {
  reset();
  world.patch(scout.id, { conditions: ["helped"] });
  const save = await ask(scout, { kind: "saving_throw", ability: "con" }, [4, 15]);
  assert.deepEqual(save.faces, [4], "a helped character rolled a save with advantage");
});

await test("A passive check takes -5 when the character would have disadvantage on the check, and +5 with advantage.", async () => {
  reset();
  world.patch(scout.id, { conditions: ["poisoned"] });
  const out = await world.invoke("check_notice", { sense: "perception", dc: PASSIVE[scout.id], characterIds: [scout.id] });
  assert.equal(out.result.anyNoticed, false, "a poisoned lookout noticed at their full passive Perception");
});

await test("The DM console's passive check uses the sense the DM picked.", async () => {
  reset();
  const out = await world.invoke("check_notice", { dc: 10, skill: "investigation", characterIds: [scout.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.sense, "investigation", `the check was made with passive ${out.result.sense}`);
});

reset();
world.close();
finish();
