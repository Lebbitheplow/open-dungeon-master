// Falling, traps, suffocation and extreme weather, through apply_hazard with
// every die forced. scripts/test-hazards.mjs covers the pure tables in
// src/lib/srd/hazards.ts; this file is the handler, the dice it rolls and
// the state it leaves on the sheet.
//
// SRD 5.1:
//   Falling      1d6 bludgeoning for every 10 feet fallen, to a maximum of
//                20d6. "The creature lands prone, unless it avoids taking
//                damage from the fall."
//   Suffocating  a creature out of breath survives a number of rounds equal
//                to its Constitution modifier (minimum 1 round); at the start
//                of its next turn it drops to 0 hit points and is dying.
//   Traps        save DC by severity: setback 10 to 11, dangerous 12 to 15,
//                deadly 16 to 20. Damage by character level and severity,
//                the table below.
//
// ODM's own rules, pinned here as the code documents them:
//   - A trap uses one DC for its severity (11, 13, 18), a Dexterity save
//     unless told otherwise, and half damage on a save
//     (src/lib/srd/hazards.ts).
//   - Extreme cold and heat are the Dungeon Master's Guide rule, not the
//     SRD's: a Constitution save an hour, DC 10 for cold and DC 5 for heat,
//     a level of exhaustion on a failure, and a fitting resistance is
//     immunity to the weather (src/lib/dm/hazard-tools.ts).
//   - roundsWithoutAir is told to the engine; it does not count rounds.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-hazards");
const world = await openWorld();
const kit = conditionsKit(world);

// SRD 5.1, Damage Severity by Level, in d10s.
const TRAP_DICE = {
  setback: { 1: 1, 5: 2, 11: 4, 17: 10 },
  dangerous: { 1: 2, 5: 4, 11: 10, 17: 18 },
  deadly: { 1: 4, 5: 10, 11: 18, 17: 24 },
};
const TRAP_DC = { setback: [10, 11], dangerous: [12, 15], deadly: [16, 20] };

const hardy = world.addHero({ ...FIGHTER, maxHp: 200 });
const frail = world.addHero({ ...FIGHTER, abilities: { str: 16, dex: 14, con: 8 }, maxHp: 200 });
const tiefling = world.addHero({ ...FIGHTER, race: "tiefling", maxHp: 200 });
const byLevel = {
  1: world.addHero({ ...FIGHTER, level: 1, maxHp: 200 }),
  5: hardy,
  11: world.addHero({ ...FIGHTER, level: 11, maxHp: 200 }),
  17: world.addHero({ ...FIGHTER, level: 17, maxHp: 200 }),
};

const hazard = (faces, args) => kit.withDice(faces, "apply_hazard", args);
const lost = (id) => world.sheet(id).maxHp - world.sheet(id).currentHp;
const sixes = new Array(30).fill(6);

// ---- falling ----

const FALLS = [[0, 0], [9, 0], [10, 1], [19, 1], [20, 2], [55, 5], [199, 19], [200, 20], [210, 20], [1000, 20]];
for (const [feet, dice] of FALLS) {
  await test(`a fall of ${feet} ft rolls ${dice}d6`, async () => {
    kit.reset(hardy.id);
    const out = await hazard(sixes, { type: "falling", characterIds: [hardy.id], feet });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    assert.equal(out.dice.length, dice);
    assert.ok(out.dice.every((die) => die.startsWith("d6:")));
    assert.equal(lost(hardy.id), dice * 6);
  });
}

await test("a fall of less than nothing, or of more than the engine takes, is refused", async () => {
  kit.reset(hardy.id);
  for (const feet of [-10, 1001]) {
    const out = await hazard(sixes, { type: "falling", characterIds: [hardy.id], feet });
    assert.equal(out.outcome.ok, false);
    assert.deepEqual(out.dice, []);
  }
  assert.equal(lost(hardy.id), 0);
});

await test("falling damage is bludgeoning: rage halves it, temporary hit points take it first", async () => {
  kit.reset(hardy.id, { conditions: ["raging"], tempHp: 4 });
  await hazard(sixes, { type: "falling", characterIds: [hardy.id], feet: 30 });
  // 3d6 of sixes is 18, halved to 9: 4 off the buffer and 5 off the body.
  assert.equal(world.sheet(hardy.id).tempHp, 0);
  assert.equal(lost(hardy.id), 5);
});

await test("everyone who falls rolls their own dice", async () => {
  kit.reset(hardy.id);
  kit.reset(frail.id);
  const out = await hazard([1, 2, 5, 6], {
    type: "falling", characterIds: [hardy.id, frail.id], feet: 20,
  });
  assert.deepEqual(out.dice, ["d6:1", "d6:2", "d6:5", "d6:6"]);
  assert.equal(lost(hardy.id), 3);
  assert.equal(lost(frail.id), 11);
});

await test("a fall can kill outright", async () => {
  kit.reset(byLevel[1].id, { maxHp: 12, currentHp: 12 });
  await hazard(sixes, { type: "falling", characterIds: [byLevel[1].id], feet: 40 });
  // 24 damage on 12 of 12: 12 left over, equal to the maximum.
  assert.equal(world.sheet(byLevel[1].id).deathSaves?.dead, true);
  world.patch(byLevel[1].id, { maxHp: 200 });
  kit.reset(byLevel[1].id);
});

await test("a character no one at the table knows is refused", async () => {
  const out = await hazard(sixes, { type: "falling", characterIds: ["nobody"], feet: 30 });
  assert.equal(out.outcome.ok, false);
});

// ---- suffocation ----

await test("out of air: Constitution modifier rounds, then 0 hit points and dying", async () => {
  const limit = abilityMod(14);
  for (let rounds = 0; rounds <= limit; rounds += 1) {
    kit.reset(hardy.id);
    const out = await hazard([], { type: "suffocation", characterIds: [hardy.id], roundsWithoutAir: rounds });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    assert.equal(lost(hardy.id), 0, `round ${rounds}`);
  }
  kit.reset(hardy.id, { tempHp: 0 });
  await hazard([], { type: "suffocation", characterIds: [hardy.id], roundsWithoutAir: limit + 1 });
  assert.equal(world.sheet(hardy.id).currentHp, 0);
  assert.deepEqual(world.sheet(hardy.id).deathSaves, {
    successes: 0, failures: 0, stable: false, dead: false,
  });
});

await test("a negative Constitution modifier still buys one round", async () => {
  kit.reset(frail.id);
  await hazard([], { type: "drowning", characterIds: [frail.id], roundsWithoutAir: 1 });
  assert.equal(lost(frail.id), 0);
  await hazard([], { type: "drowning", characterIds: [frail.id], roundsWithoutAir: 2 });
  assert.equal(world.sheet(frail.id).currentHp, 0);
  assert.notEqual(world.sheet(frail.id).deathSaves, null);
});

await test("suffocation drops to 0 and no further: it is never massive damage", async () => {
  kit.reset(byLevel[1].id, { maxHp: 8, currentHp: 8 });
  await hazard([], { type: "suffocation", characterIds: [byLevel[1].id], roundsWithoutAir: 9 });
  assert.equal(world.sheet(byLevel[1].id).deathSaves?.dead, false);
  world.patch(byLevel[1].id, { maxHp: 200 });
  kit.reset(byLevel[1].id);
});

// ---- extreme weather ----

const CON = abilityMod(14) + 3;

await test("extreme cold: a DC 10 Constitution save, and a level of exhaustion on a failure", async () => {
  kit.reset(hardy.id);
  const failed = await hazard([10 - CON - 1], { type: "extreme_cold", characterIds: [hardy.id] });
  assert.deepEqual(failed.dice, [`d20:${10 - CON - 1}`]);
  assert.equal(world.sheet(hardy.id).exhaustion, 1);
  await hazard([10 - CON], { type: "extreme_cold", characterIds: [hardy.id] });
  assert.equal(world.sheet(hardy.id).exhaustion, 1);
  await hazard([1], { type: "extreme_cold", characterIds: [hardy.id] });
  assert.equal(world.sheet(hardy.id).exhaustion, 2);
  assert.deepEqual(world.sheet(hardy.id).conditions, []);
});

await test("extreme heat: a DC 5 Constitution save, or the DC the caller gives for a later hour", async () => {
  kit.reset(frail.id);
  // CON 8 and proficient: +2. A 3 makes DC 5 and a 2 does not.
  await hazard([3], { type: "extreme_heat", characterIds: [frail.id] });
  assert.equal(world.sheet(frail.id).exhaustion, 0);
  await hazard([2], { type: "extreme_heat", characterIds: [frail.id] });
  assert.equal(world.sheet(frail.id).exhaustion, 1);
  await hazard([3], { type: "extreme_heat", characterIds: [frail.id], dc: 6 });
  assert.equal(world.sheet(frail.id).exhaustion, 2);
});

await test("resistance to fire is immunity to the heat, and rolls nothing", async () => {
  kit.reset(tiefling.id);
  const out = await hazard([1], { type: "extreme_heat", characterIds: [tiefling.id] });
  assert.deepEqual(out.dice, []);
  assert.equal(world.sheet(tiefling.id).exhaustion, 0);
  const cold = await hazard([1], { type: "extreme_cold", characterIds: [tiefling.id] });
  assert.equal(kit.d20s(cold.dice), 1);
  assert.equal(world.sheet(tiefling.id).exhaustion, 1);
});

await test("the sixth level of exhaustion from the weather kills", async () => {
  kit.reset(hardy.id, { exhaustion: 5 });
  await hazard([1], { type: "extreme_cold", characterIds: [hardy.id] });
  assert.equal(world.sheet(hardy.id).exhaustion, 6);
  assert.equal(world.sheet(hardy.id).deathSaves?.dead, true);
  kit.reset(hardy.id);
});

// ---- traps ----

for (const [severity, tiers] of Object.entries(TRAP_DICE)) {
  for (const [level, dice] of Object.entries(tiers)) {
    await test(`a ${severity} trap against level ${level} rolls ${dice}d10`, async () => {
      const victim = byLevel[level];
      kit.reset(victim.id);
      const out = await hazard([1, ...new Array(dice + 4).fill(5)], {
        type: "trap", characterIds: [victim.id], severity,
      });
      assert.equal(out.outcome.ok, true, out.outcome.error);
      assert.equal(out.dice[0], "d20:1");
      assert.deepEqual(out.dice.slice(1), new Array(dice).fill("d10:5"));
      assert.equal(lost(victim.id), dice * 5);
      const [low, high] = TRAP_DC[severity];
      const dc = out.result.results[0].dc;
      assert.ok(dc >= low && dc <= high, `${severity} DC ${dc}`);
    });
  }
}

await test("a trap's save is Dexterity, met on the DC, and a save halves rounding down", async () => {
  kit.reset(hardy.id);
  const dex = abilityMod(14);
  const probe = await hazard([1, 5, 5, 5, 5], { type: "trap", characterIds: [hardy.id], severity: "dangerous" });
  const dc = probe.result.results[0].dc;
  kit.reset(hardy.id);
  const made = await hazard([dc - dex, 5, 5, 5, 4], { type: "trap", characterIds: [hardy.id], severity: "dangerous" });
  assert.equal(made.result.results[0].saved, true);
  assert.equal(lost(hardy.id), Math.floor(19 / 2));
  kit.reset(hardy.id);
  const missed = await hazard([dc - dex - 1, 5, 5, 5, 4], { type: "trap", characterIds: [hardy.id], severity: "dangerous" });
  assert.equal(missed.result.results[0].saved, false);
  assert.equal(lost(hardy.id), 19);
});

await test("a restrained victim saves at disadvantage and a paralyzed one not at all", async () => {
  kit.reset(hardy.id, { conditions: ["restrained"] });
  const held = await hazard([20, 1, 5, 5, 5, 5], { type: "trap", characterIds: [hardy.id], severity: "dangerous" });
  assert.equal(kit.d20s(held.dice), 2);
  assert.equal(held.result.results[0].saved, false);
  kit.reset(hardy.id, { conditions: ["paralyzed"] });
  const frozen = await hazard([5, 5, 5, 5], { type: "trap", characterIds: [hardy.id], severity: "dangerous" });
  assert.equal(kit.d20s(frozen.dice), 0);
  assert.equal(lost(hardy.id), 20);
  kit.reset(hardy.id);
});

await test("a hazard of the DM's own uses the dice, save, type and condition it is given", async () => {
  kit.reset(tiefling.id);
  const out = await hazard([1, 6, 6, 6], {
    type: "generic", characterIds: [tiefling.id], damage: "3d6", damageType: "fire",
    saveAbility: "con", dc: 12, condition: "poisoned", halfOnSave: true,
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.deepEqual(out.dice, ["d20:1", "d6:6", "d6:6", "d6:6"]);
  // 18 fire, halved by Hellish Resistance.
  assert.equal(lost(tiefling.id), 9);
  assert.deepEqual(world.sheet(tiefling.id).conditions, ["poisoned"]);
  assert.deepEqual(world.sheet(tiefling.id).conditionMeta.poisoned, {
    saveEnds: { ability: "con", dc: 12 },
  });
  kit.reset(tiefling.id);
  const bad = await hazard([1, 6], {
    type: "generic", characterIds: [tiefling.id], damage: "lots", dc: 12,
  });
  assert.equal(lost(tiefling.id), 0);
  assert.notEqual(bad.result?.results?.[0]?.ok, true);
});

// ---- once gaps, now held ----

await test("A creature that takes damage from a fall lands prone (SRD 5.1, Falling).", async () => {
  kit.reset(hardy.id);
  await hazard(sixes, { type: "falling", characterIds: [hardy.id], feet: 30 });
  const held = world.sheet(hardy.id).conditions;
  assert.deepEqual(held, ["prone"], `after an 18 point fall the conditions are [${held.join(", ")}]`);
});
kit.reset(hardy.id);

await test("Damage lands as rolled. A creature out of air drops to 0 hit points however many it had.", async () => {
  kit.reset(hardy.id, { maxHp: 230, currentHp: 230 });
  try {
    await hazard([], { type: "suffocation", characterIds: [hardy.id], roundsWithoutAir: 9 });
    const left = world.sheet(hardy.id).currentHp;
    assert.equal(left, 0, `suffocated past the limit with ${left} hit points left`);
  } finally {
    world.patch(hardy.id, { maxHp: 200 });
    kit.reset(hardy.id);
  }
});

await test("A suffocating creature at 0 hit points cannot regain hit points or be stabilized until it can breathe again (SRD 5.1, Suffocating).", async () => {
  kit.reset(hardy.id);
  await hazard([], { type: "drowning", characterIds: [hardy.id], roundsWithoutAir: 9 });
  assert.equal(world.sheet(hardy.id).currentHp, 0);
  const out = await world.invoke("heal", { characterId: hardy.id, amount: 5 });
  assert.equal(out.ok, false, "a character still under water was healed to 5 hit points");
});

await test("a fall the engine rolled lands whole, past the 200 a typed amount is held to", async () => {
  // A raging barbarian halves the fall; a plain fighter takes all 20d6.
  kit.reset(hardy.id, { maxHp: 230, currentHp: 230 });
  try {
    await hazard(new Array(40).fill(6), { type: "falling", characterIds: [hardy.id], feet: 200 });
    assert.equal(world.sheet(hardy.id).currentHp, 230 - 120);
    // The typed door is still held to its declared bound.
    kit.reset(hardy.id, { maxHp: 230, currentHp: 230 });
    await world.invoke("apply_damage", { characterId: hardy.id, amount: 500 });
    assert.equal(world.sheet(hardy.id).currentHp, 30);
  } finally {
    world.patch(hardy.id, { maxHp: 200 });
    kit.reset(hardy.id);
  }
});

await test("a creature that drowned is healed and stabilized only once it can breathe", async () => {
  kit.reset(hardy.id);
  kit.reset(frail.id);
  await hazard([], { type: "drowning", characterIds: [hardy.id], roundsWithoutAir: 9 });
  const down = world.sheet(hardy.id);
  assert.deepEqual(down.conditions, ["unconscious", "prone", "suffocating"]);
  const tended = await kit.withDice([20, 1], "stabilize", { characterId: hardy.id, healerId: frail.id });
  assert.equal(tended.outcome.ok, false, "stabilized under water");
  assert.deepEqual(tended.dice, []);
  assert.equal(world.sheet(hardy.id).deathSaves.stable, false);
  // Temporary hit points are not healing and are not refused.
  const warded = await world.invoke("heal", { characterId: hardy.id, amount: 5, temp: true });
  assert.equal(warded.ok, true, warded.error);
  // Air: the condition is cleared, and healing works again.
  const air = await world.invoke("clear_condition", { characterId: hardy.id, condition: "suffocating" });
  assert.equal(air.ok, true, air.error);
  const healed = await world.invoke("heal", { characterId: hardy.id, amount: 5 });
  assert.equal(healed.ok, true, healed.error);
  assert.equal(world.sheet(hardy.id).currentHp, 5);
  assert.deepEqual(world.sheet(hardy.id).conditions, ["prone"]);
  kit.reset(hardy.id);
});

world.close();
finish();
