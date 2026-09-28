// How a condition gets onto a creature, how long it stays, and how it leaves:
// set_condition and clear_condition, the names they accept, durations counted
// in rounds, saves that end a condition, and the immunities a stat block
// declares.
//
// SRD 5.1, Conditions: "A condition lasts either until it is countered or for
// a duration specified by the effect that imposed the condition. If multiple
// effects impose the same condition on a creature, each instance of the
// condition has its own duration, but the condition's effects don't get
// worse. A creature either has a condition or doesn't."
//
// ODM's own rules, pinned here as the code documents them:
//   - Durations count down when the initiative order WRAPS, once a round for
//     everybody, not at the end of the affected creature's own turn
//     (src/lib/dm/condition-logic.ts ConditionMeta, condition-tick.ts).
//   - A save-ends condition is re-saved at that same round wrap ("re-saved at
//     the end of each round", set_condition's own description). SRD 5.1 puts
//     the save at the end of each of the creature's turns.
//   - Names are stored lowercase; a near miss maps to the SRD name and an
//     unknown name is kept as a custom story condition (canonicalCondition).
//   - Minutes and hours are stored as rounds, ten to the minute.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod, proficiencyBonus } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-conditions-duration");
const world = await openWorld({ campaign: { difficulty: "deadly" } });
const kit = conditionsKit(world);

// The fourteen conditions of SRD 5.1 Appendix PH-A. Exhaustion is the
// fifteenth entry and is a track, not a flag (test-enforce-exhaustion.mjs).
const SRD_CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
];

const hero = world.addHero({ ...FIGHTER, level: 10 });
const ally = world.addHero({ ...FIGHTER, level: 10 });
const roster = world.hasPack
  ? [{ monster: "goblin" }, { monster: "skeleton" }, { monster: "ghoul" }]
  : [{ monster: "goblin", count: 3 }];
await world.beginFight(roster, { heroFaces: { [hero.id]: 20, [ally.id]: 18 } });
kit.offBoard();
const [goblin, skeleton, ghoul] = world.enemies();

const set = (args) => world.invoke("set_condition", { characterId: hero.id, ...args });
const clear = (condition) => world.invoke("clear_condition", { characterId: hero.id, condition });
const held = (id = hero.id) => world.sheet(id).conditions;
const meta = (id = hero.id) => world.sheet(id).conditionMeta;

// Skips turns until the round number moves, which is the tick.
function nextRound() {
  const round = world.encounter().round;
  for (let turn = 0; turn < 6 && world.encounter().round === round; turn += 1) {
    assert.equal(kit.skipTurn(), true);
  }
  assert.equal(world.encounter().round, round + 1);
}

// ---- names ----

for (const condition of SRD_CONDITIONS) {
  await test(`${condition}: set, stored under its SRD name, and cleared`, async () => {
    kit.reset(hero.id);
    const upper = await set({ condition: ` ${condition.toUpperCase()} ` });
    assert.equal(upper.ok, true, upper.error);
    assert.deepEqual(held(), [condition]);
    const again = await set({ condition });
    assert.equal(again.ok, true);
    assert.deepEqual(held(), [condition], "a creature either has a condition or does not");
    const gone = await clear(condition);
    assert.equal(gone.ok, true, gone.error);
    assert.deepEqual(held(), []);
    assert.deepEqual(meta(), {});
  });
}

await test("clearing a condition the character does not have is refused", async () => {
  kit.reset(hero.id, { conditions: ["prone"] });
  const out = await clear("stunned");
  assert.equal(out.ok, false);
  assert.deepEqual(held(), ["prone"]);
});

await test("an empty condition name is refused", async () => {
  kit.reset(hero.id);
  for (const condition of ["", "   "]) {
    const out = await set({ condition });
    assert.equal(out.ok, false);
  }
  assert.deepEqual(held(), []);
});

await test("an unknown name is kept as a custom condition and carries no SRD mechanics", async () => {
  kit.reset(hero.id);
  const out = await set({ condition: "Marked by the Crone" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(held(), ["marked by the crone"]);
  kit.resetEnemy(goblin.id);
  const swing = await kit.swing([3, 17, 4], hero.id, goblin.id, { weapon: "Longsword" });
  assert.equal(kit.d20s(swing.dice), 1);
});

if (world.hasPack) {
  // The near misses a model writes, and the SRD name each one means.
  const SYNONYMS = {
    poison: "poisoned", blind: "blinded", frighten: "frightened", charm: "charmed",
    deaf: "deafened", grapple: "grappled", restrain: "restrained", stun: "stunned",
    "Poisoned by the dart": "poisoned", "paralyzed (hold person)": "paralyzed",
  };
  for (const [written, stored] of Object.entries(SYNONYMS)) {
    await test(`"${written}" is stored as ${stored}`, async () => {
      kit.reset(hero.id);
      const out = await set({ condition: written });
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(held(), [stored]);
    });
  }
}

await test("several conditions sit side by side and clear one at a time", async () => {
  kit.reset(hero.id);
  for (const condition of ["prone", "poisoned", "blinded"]) {
    await set({ condition, rounds: 3 });
  }
  assert.deepEqual(held(), ["prone", "poisoned", "blinded"]);
  await clear("poisoned");
  assert.deepEqual(held(), ["prone", "blinded"]);
  assert.deepEqual(Object.keys(meta()), ["prone", "blinded"]);
});

// ---- durations ----

await test("a duration outside its bounds is refused", async () => {
  kit.reset(hero.id);
  for (const args of [{ rounds: 0 }, { rounds: -1 }, { rounds: 101 }, { minutes: 0 }, { hours: 25 },
    { saveAbility: "wis", saveDc: 0 }, { saveAbility: "wis", saveDc: 31 }]) {
    const out = await set({ condition: "poisoned", ...args });
    assert.equal(out.ok, false, JSON.stringify(args));
    assert.deepEqual(held(), []);
  }
});

await test("minutes and hours are stored as rounds, ten to the minute", async () => {
  kit.reset(hero.id);
  await set({ condition: "poisoned", minutes: 1 });
  assert.equal(meta().poisoned.rounds, 10);
  kit.reset(hero.id);
  await set({ condition: "poisoned", hours: 1 });
  assert.equal(meta().poisoned.rounds, 600);
  kit.reset(hero.id);
  await set({ condition: "poisoned", rounds: 3, minutes: 1 });
  assert.equal(meta().poisoned.rounds, 13);
});

await test("a timed condition counts down once a round and ends at zero", async () => {
  kit.reset(hero.id);
  kit.reset(ally.id);
  await set({ condition: "poisoned", rounds: 2 });
  assert.equal(meta().poisoned.rounds, 2);
  nextRound();
  assert.deepEqual(held(), ["poisoned"]);
  assert.equal(meta().poisoned.rounds, 1);
  nextRound();
  assert.deepEqual(held(), []);
  assert.deepEqual(meta(), {});
});

await test("an untimed condition never expires on its own", async () => {
  kit.reset(hero.id);
  await set({ condition: "prone" });
  nextRound();
  nextRound();
  assert.deepEqual(held(), ["prone"]);
});

await test("ending a turn inside the round does not tick the clock", async () => {
  kit.reset(hero.id);
  kit.reset(ally.id);
  await set({ condition: "poisoned", rounds: 2 });
  if (kit.pointer().id !== hero.id) {
    kit.skipTurn();
  }
  assert.equal(kit.pointer().id, hero.id);
  const round = world.encounter().round;
  assert.equal(kit.endOwnTurn(world.owner.id), true);
  assert.equal(world.encounter().round, round);
  assert.equal(meta().poisoned.rounds, 2);
});

// ---- saves that end a condition ----

const CON_SAVE = abilityMod(14) + proficiencyBonus(10);
const WIS_SAVE = abilityMod(10);

async function saveEnds(ability, dc, face) {
  kit.reset(hero.id);
  kit.reset(ally.id);
  await set({ condition: "frightened", saveAbility: ability, saveDc: dc });
  assert.deepEqual(meta().frightened, { saveEnds: { ability, dc } });
  world.clearDice();
  world.diceLog();
  world.dice(face);
  nextRound();
  world.clearDice();
  return { dice: kit.rolled(), held: held() };
}

await test("a save that ends a condition is rolled once a round with the right ability", async () => {
  // Proficient CON save: 10 on the die makes DC 10 + modifier exactly.
  const con = await saveEnds("con", 10 + CON_SAVE, 10);
  assert.deepEqual(con.dice, ["d20:10"]);
  assert.deepEqual(con.held, []);
  // The same die against the same DC with an unproficient WIS save fails.
  const wis = await saveEnds("wis", 10 + CON_SAVE, 10);
  assert.deepEqual(wis.held, ["frightened"]);
});

await test("the save meets the DC to succeed: one short keeps the condition", async () => {
  const short = await saveEnds("wis", 12, 12 - WIS_SAVE - 1);
  assert.deepEqual(short.held, ["frightened"]);
  const met = await saveEnds("wis", 12, 12 - WIS_SAVE);
  assert.deepEqual(met.held, []);
});

await test("a failed save keeps the condition and the save comes round again", async () => {
  const first = await saveEnds("wis", 15, 2);
  assert.deepEqual(first.held, ["frightened"]);
  world.dice(20);
  nextRound();
  world.clearDice();
  assert.deepEqual(held(), []);
});

await test("a condition with rounds and a save ends on whichever comes first", async () => {
  kit.reset(hero.id);
  await set({ condition: "restrained", rounds: 2, saveAbility: "str", saveDc: 30 });
  world.dice(1);
  nextRound();
  assert.deepEqual(held(), ["restrained"]);
  world.dice(1);
  nextRound();
  world.clearDice();
  assert.deepEqual(held(), []);
});

// ---- enemies ----

const enemySet = (enemyId, args) => world.invoke("set_enemy_condition", { enemyId, ...args });

await test("an enemy's timed condition and its save run on the same clock", async () => {
  kit.reset(hero.id);
  kit.reset(ally.id);
  kit.resetEnemy(goblin.id);
  const timed = await enemySet(goblin.id, { condition: "Blinded", rounds: 1 });
  assert.equal(timed.ok, true, timed.error);
  const saved = await enemySet(goblin.id, { condition: "restrain", saveAbility: "str", saveDc: 30 });
  assert.equal(saved.ok, true, saved.error);
  if (world.hasPack) {
    assert.deepEqual(kit.enemy(goblin.id).conditions, ["blinded", "restrained"]);
  }
  world.clearDice();
  world.diceLog();
  world.dice(19);
  nextRound();
  world.clearDice();
  assert.deepEqual(kit.rolled(), ["d20:19"]);
  assert.equal(kit.enemy(goblin.id).conditions.includes("blinded"), false);
  assert.equal(kit.enemy(goblin.id).conditions.length, 1);
  const cleared = await world.invoke("clear_enemy_condition", {
    enemyId: goblin.id,
    condition: kit.enemy(goblin.id).conditions[0],
  });
  assert.equal(cleared.ok, true, cleared.error);
  assert.deepEqual(kit.enemy(goblin.id).conditions, []);
});

await test("a stat block's condition immunities refuse the condition, however it is applied", async () => {
  // Stated on the encounter's own snapshot, so this holds without the pack.
  kit.setEnemyStats(goblin.id, { conditionImmune: "charmed, poisoned, grappled, prone" });
  try {
    for (const condition of ["poisoned", "Charmed", "prone"]) {
      kit.resetEnemy(goblin.id);
      const out = await enemySet(goblin.id, { condition });
      assert.equal(out.ok, false, condition);
      assert.deepEqual(kit.enemy(goblin.id).conditions, []);
    }
    for (let turn = 0; turn < 6 && kit.pointer().id !== hero.id; turn += 1) {
      kit.skipTurn();
    }
    for (const action of ["grapple", "shove"]) {
      kit.reset(hero.id);
      kit.resetEnemy(goblin.id);
      kit.freshTurn();
      // The contest is won outright and the condition still does not land.
      const out = await kit.withDice([20, 1], "take_action", {
        characterId: hero.id, action, targetEnemyId: goblin.id,
      });
      assert.equal(out.outcome.ok, true, out.outcome.error);
      assert.equal(out.result.success, false, action);
      assert.deepEqual(kit.enemy(goblin.id).conditions, [], action);
    }
    const other = await enemySet(goblin.id, { condition: "stunned" });
    assert.equal(other.ok, true, other.error);
    assert.deepEqual(kit.enemy(goblin.id).conditions, ["stunned"]);
  } finally {
    kit.setEnemyStats(goblin.id, { conditionImmune: "" });
    kit.resetEnemy(goblin.id);
    kit.freshTurn();
  }
});

if (world.hasPack) {
  // SRD 5.1 stat blocks: Skeleton "Condition Immunities exhaustion, poisoned",
  // Ghoul "Condition Immunities charmed, exhaustion, poisoned".
  const IMMUNE = [
    [skeleton, "poisoned"], [skeleton, "exhaustion"],
    [ghoul, "charmed"], [ghoul, "poisoned"], [ghoul, "exhaustion"],
  ];
  for (const [enemy, condition] of IMMUNE) {
    await test(`${enemy.displayName} is immune to ${condition}: set_enemy_condition refuses`, async () => {
      kit.resetEnemy(enemy.id);
      const out = await enemySet(enemy.id, { condition });
      assert.equal(out.ok, false);
      assert.deepEqual(kit.enemy(enemy.id).conditions, []);
    });
  }

  await test("an immunity stops a spell's condition and the slot is not spent", async () => {
    const caster = world.addHero({
      class: "wizard", level: 10, abilities: { int: 16 }, maxHp: 40,
      spellcasting: {
        ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Ray of Sickness"],
        known: [], cantrips: [],
      },
    });
    kit.resetEnemy(skeleton.id);
    const out = await kit.withDice([1, 8, 8], "cast_at_enemy", {
      characterId: caster.id, targetEnemyId: skeleton.id, spell: "Homebrew Venom",
      saveAbility: "con", condition: "poisoned", rounds: 2,
    });
    assert.equal(out.outcome.ok, false);
    assert.deepEqual(out.dice, []);
    assert.deepEqual(kit.enemy(skeleton.id).conditions, []);
    assert.equal(world.sheet(caster.id).spellcasting.slots[1].used, 0);
  });

  await test("a condition the stat block does not list still lands", async () => {
    kit.resetEnemy(skeleton.id);
    const out = await enemySet(skeleton.id, { condition: "prone" });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(kit.enemy(skeleton.id).conditions, ["prone"]);
    kit.resetEnemy(skeleton.id);
  });
}

// ---- gaps ----

await test("If multiple effects impose the same condition, each instance has its own duration; the creature keeps the condition until the last one ends (SRD 5.1, Conditions).", async () => {
  kit.reset(hero.id);
  await set({ condition: "poisoned", rounds: 1, reason: "a weak venom" });
  await set({ condition: "poisoned", rounds: 10, reason: "a wyvern's sting" });
  nextRound();
  assert.deepEqual(held(), ["poisoned"], "the ten-round poison ended with the one-round poison");
});

await test("A condition the engine reports as applied is on the sheet, with its mechanics.", async () => {
  kit.reset(hero.id, {
    conditions: Array.from({ length: 15 }, (_, index) => `mark ${index + 1}`),
  });
  const out = await set({ condition: "stunned" });
  assert.equal(
    out.ok && !held().includes("stunned"),
    false,
    "set_condition answered ok and stored nothing",
  );
  kit.reset(hero.id);
});

await test("Exhaustion is one track of six levels, whatever word the caller used for it.", async () => {
  kit.reset(hero.id);
  const out = await set({ condition: "exhausted" });
  assert.equal(out.ok, true, out.error);
  const level = world.sheet(hero.id).exhaustion;
  assert.equal(level, 1, `'exhausted' left the exhaustion level at ${level}`);
});
kit.reset(hero.id);

await test("a shorter second source does not cut the first one short, and an open-ended one outlasts both", async () => {
  kit.reset(hero.id);
  await set({ condition: "poisoned", rounds: 10 });
  await set({ condition: "poisoned", rounds: 2 });
  assert.equal(meta().poisoned.rounds, 10);
  // No duration at all is until something ends it.
  await set({ condition: "poisoned" });
  assert.deepEqual(meta(), {});
  await set({ condition: "poisoned", rounds: 3 });
  assert.deepEqual(meta(), {});
  assert.deepEqual(held(), ["poisoned"]);
});

await test("a condition keeps the id of whoever caused it", async () => {
  kit.reset(hero.id);
  const [first] = world.enemies();
  const out = await set({ condition: "frightened", rounds: 5, sourceEnemyId: first.id });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(meta().frightened, { rounds: 5, source: first.id });
  // With no duration the source alone is kept, and the condition does not expire.
  await set({ condition: "charmed", sourceEnemyId: first.id });
  assert.deepEqual(meta().charmed, { source: first.id });
  nextRound();
  assert.deepEqual(held(), ["frightened", "charmed"]);
  assert.equal(meta().frightened.source, first.id);
});

await test("a grapple ends when the one holding it is incapacitated", async () => {
  kit.reset(hero.id);
  const [first, second] = world.enemies();
  // The hero holds the first enemy; the second is held by somebody else.
  kit.resetEnemy(first.id, ["grappled"], { grappled: { source: hero.id } });
  kit.resetEnemy(second.id, ["grappled"], { grappled: { source: "somebody-else" } });
  await set({ condition: "stunned", rounds: 1 });
  assert.deepEqual(kit.enemy(first.id).conditions, []);
  assert.deepEqual(kit.enemy(second.id).conditions, ["grappled"]);
  kit.resetEnemy(first.id);
  kit.resetEnemy(second.id);
});

await test("the dead take no new conditions", async () => {
  kit.reset(hero.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  for (const condition of ["poisoned", "exhaustion", "a custom mark"]) {
    const out = await set({ condition });
    assert.equal(out.ok, false, condition);
  }
  assert.deepEqual(held(), []);
  assert.equal(world.sheet(hero.id).exhaustion, 0);
});
kit.reset(hero.id);

// ---- the clock outside a fight ----
//
// ODM's rule (src/lib/dm/condition-tick.ts tickClockConditions): with no
// fight running the in-world clock counts the rounds, ten to the minute, and
// a save that ends a condition is rolled once for each stretch of time that
// passes, not once for each round inside it.

const truce = await world.invoke("end_encounter", { outcome: "truce" });
const wait = (amount, unit = "minutes") => world.invoke("pass_time", { amount, unit });

await test("outside a fight a timed condition counts down against the in-world clock", async () => {
  assert.equal(truce.ok, true, truce.error);
  kit.reset(hero.id);
  await set({ condition: "poisoned", minutes: 10 });
  assert.equal((await wait(4)).ok, true);
  assert.equal(meta().poisoned.rounds, 60);
  await wait(5);
  assert.deepEqual(held(), ["poisoned"]);
  assert.equal(meta().poisoned.rounds, 10);
  await wait(1);
  assert.deepEqual(held(), []);
  assert.deepEqual(meta(), {});
});

await test("an untimed condition outlasts any amount of time", async () => {
  kit.reset(hero.id);
  await set({ condition: "blinded" });
  await wait(3, "days");
  assert.deepEqual(held(), ["blinded"]);
});

await test("outside a fight the save that ends a condition is rolled once for the stretch", async () => {
  kit.reset(hero.id);
  await set({ condition: "frightened", saveAbility: "wis", saveDc: 12 });
  world.clearDice();
  world.diceLog();
  world.dice(12 - WIS_SAVE - 1, 20, 20);
  await wait(10);
  world.clearDice();
  assert.deepEqual(kit.rolled().filter((die) => die.startsWith("d20:")), [`d20:${12 - WIS_SAVE - 1}`]);
  assert.deepEqual(held(), ["frightened"]);
  world.dice(12 - WIS_SAVE);
  await wait(1);
  world.clearDice();
  assert.deepEqual(held(), []);
});

await test("a rest moves the clock: an hour's poison is gone after a short rest", async () => {
  kit.reset(hero.id);
  await set({ condition: "poisoned", hours: 1 });
  await set({ condition: "prone" });
  const out = await world.invoke("take_rest", { kind: "short" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(held(), ["prone"]);
});
kit.reset(hero.id);

world.close();
finish();
