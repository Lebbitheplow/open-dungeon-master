// An active effect does what set_effect accepted it to do
// (docs/character-table-rules-audit-2026-10-17.md, workstream 5: F27, F28):
//
//   - a speed effect is the speed a creature moves with, a maximum-HP effect
//     is the stored maximum (and lifting it gives back exactly that), and an
//     enemy's attack, damage and check effects reach its rolls.
//   - a field and mode no roll reads is refused rather than stored.
//   - a save to end an effect is rolled at the end of the target's turn,
//     character or enemy, and once per stretch of time outside a fight.
//   - "rounds" and "minutes" are one lifetime: a round effect wears off on the
//     road, a minute effect ends mid-fight, and no time is counted twice.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-effect-contract");
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const { enemySpeedTiles } = await import("../src/lib/dm/enemy-speed.ts");
const { listEffects } = await import("../src/lib/db/active-effects.ts");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");
const { endTurnSaves, tickEncounterConditions } = await import("../src/lib/dm/condition-tick.ts");
const { contestOpponent, rollContest } = await import("../src/lib/dm/roll-gates.ts");

const effectsOn = (world, kind, id) => listEffects(world.campaignId, { kind, id });

await test("F27: a speed override of 5 is the speed a character and an enemy move with", async () => {
  const { world, sheets: [hero], enemies: [goblin] } = await table([FIGHTER]);
  const map = await layMap(world, ["......"], { [hero.id]: { x: 0, y: 0 }, [goblin.id]: { x: 5, y: 0 } });
  for (const [key, id] of [["characterId", hero.id], ["enemyId", goblin.id]]) {
    const set = await world.invoke("set_effect", { [key]: id, name: "Mired", modifiers: [{ field: "speed", mode: "override", value: 5 }] });
    assert.equal(set.ok, true, set.error);
  }
  const token = listTokens(map.id).find((entry) => entry.refId === hero.id);
  assert.equal(pcMoveBudget(world.campaignId, world.encounter(), map, world.sheet(hero.id), token).speed, 5);
  const enemy = world.enemies().find((entry) => entry.id === goblin.id);
  assert.equal(enemySpeedTiles(enemy), 1, "one square, not the printed six");
  const walk = await world.invoke("move_token", { tokenName: goblin.id, x: 1, y: 0 });
  assert.equal(listTokens(map.id).find((entry) => entry.refId === goblin.id).x, 4, walk.error ?? "one square of the walk");
});

await test("F27: a maximum-HP bonus raises the stored maximum, and lifting it gives back exactly that", async () => {
  const { world, sheets: [hero], enemies: [goblin] } = await table([{ ...FIGHTER, maxHp: 30 }]);
  world.patch(hero.id, { currentHp: 25 });
  for (const [key, id] of [["characterId", hero.id], ["enemyId", goblin.id]]) {
    const set = await world.invoke("set_effect", { [key]: id, name: "Heroes' Feast", modifiers: [{ field: "maxHp", mode: "add", value: 20 }] });
    assert.equal(set.ok, true, set.error);
  }
  assert.equal(world.sheet(hero.id).maxHp, 50);
  assert.equal(world.sheet(hero.id).currentHp, 45);
  assert.equal(world.enemies().find((entry) => entry.id === goblin.id).maxHp, 110);
  await world.invoke("clear_effect", { characterId: hero.id, name: "Heroes' Feast" });
  await world.invoke("clear_effect", { enemyId: goblin.id, name: "Heroes' Feast" });
  assert.equal(world.sheet(hero.id).maxHp, 30);
  assert.equal(world.sheet(hero.id).currentHp, 30);
  assert.equal(world.enemies().find((entry) => entry.id === goblin.id).maxHp, 90);
});

await test("F27: an enemy's +20 attack and +10 damage effects reach its roll and its blow", async () => {
  const { world, sheets: [hero], enemies: [goblin] } = await table([{ ...FIGHTER, maxHp: 40 }], 1, {
    attacks: [{ name: "Claw", toHit: 4, damage: "1d6", type: "slashing" }],
  });
  world.patch(hero.id, { currentHp: 40 });
  const set = await world.invoke("set_effect", {
    enemyId: goblin.id,
    name: "Blood Frenzy",
    modifiers: [{ field: "attack", mode: "add", value: 20 }, { field: "damage", mode: "add", value: 10 }],
  });
  assert.equal(set.ok, true, set.error);
  world.dice(5, 4);
  const out = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, true, "5 + 4 + 20 = 29 hits AC 12");
  assert.equal(world.sheet(hero.id).currentHp, 26, "4 + 10 damage");
});

await test("F27: an enemy's check effect rides its side of a contest", async () => {
  const { world, enemies: [goblin] } = await table([FIGHTER]);
  const opponent = () => contestOpponent(world.campaign(), { enemyId: goblin.id });
  world.dice(10);
  const plain = rollContest(world.campaign(), null, opponent(), { skill: "athletics" });
  world.clearDice();
  await world.invoke("set_effect", { enemyId: goblin.id, name: "Giant Strength", modifiers: [{ field: "check", mode: "add", value: 5 }] });
  world.dice(10);
  const raised = rollContest(world.campaign(), null, opponent(), { skill: "athletics" });
  world.clearDice();
  assert.equal(raised.total, plain.total + 5);
});

await test("F27: a modifier no roll reads is refused, not stored", async () => {
  const { world, sheets: [hero], enemies: [goblin] } = await table([FIGHTER]);
  const asks = [
    { characterId: hero.id, modifiers: [{ field: "save", mode: "override", value: 15 }] },
    { characterId: hero.id, modifiers: [{ field: "damage", mode: "advantage" }] },
    { characterId: hero.id, modifiers: [{ field: "maxHp", mode: "override", value: 5 }] },
    { enemyId: goblin.id, modifiers: [{ field: "initiative", mode: "add", value: 5 }] },
  ];
  for (const ask of asks) {
    const out = await world.invoke("set_effect", { name: "Odd", ...ask });
    assert.equal(out.ok, false, JSON.stringify(ask.modifiers));
  }
  assert.equal(effectsOn(world, "character", hero.id).length, 0);
  assert.equal(effectsOn(world, "enemy", goblin.id).length, 0);
});

const CURSE = (dc) => ({ name: "Witch's Curse", modifiers: [{ field: "attack", mode: "add", value: -2 }], saveAbility: "wis", saveDc: dc, visible: true });

await test("F28: a character's save to end an effect is rolled at the end of their turn", async () => {
  const { world, sheets: [hero] } = await table([FIGHTER]);
  await world.invoke("set_effect", { characterId: hero.id, ...CURSE(12) });
  world.dice(1);
  endTurnSaves(world.campaign(), world.encounter(), [hero.id]);
  world.clearDice();
  assert.equal(effectsOn(world, "character", hero.id).length, 1, "a failed save keeps it");
  world.dice(20);
  endTurnSaves(world.campaign(), world.encounter(), [hero.id]);
  const rolled = world.diceLog();
  world.clearDice();
  assert.ok(rolled.length >= 1, "a die was rolled");
  assert.equal(effectsOn(world, "character", hero.id).length, 0, "and a success lifts it");
});

await test("F28: an enemy's save to end an effect is rolled at the end of its turn", async () => {
  const { world, enemies: [goblin] } = await table([FIGHTER]);
  await world.invoke("set_effect", { enemyId: goblin.id, ...CURSE(2) });
  world.dice(20);
  endTurnSaves(world.campaign(), world.encounter(), [goblin.id]);
  world.clearDice();
  assert.equal(effectsOn(world, "enemy", goblin.id).length, 0);
});

await test("F28: outside a fight, a stretch of time is one save to end it", async () => {
  const world = await openWorld();
  const hero = world.addHero(FIGHTER);
  await world.invoke("set_effect", { characterId: hero.id, ...CURSE(2) });
  world.dice(20);
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  world.clearDice();
  assert.equal(effectsOn(world, "character", hero.id).length, 0);
  world.close();
});

await test("F28: round effects wear off on the road, ten rounds to the minute", async () => {
  const world = await openWorld();
  const hero = world.addHero(FIGHTER);
  for (const [name, remaining] of [["Short", 5], ["Ten", 100], ["Long", 700]]) {
    const set = await world.invoke("set_effect", { characterId: hero.id, name, modifiers: [{ field: "ac", mode: "add", value: 1 }], duration: "rounds", remaining });
    assert.equal(set.ok, true, set.error);
  }
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  const left = effectsOn(world, "character", hero.id);
  assert.deepEqual(left.map((effect) => effect.name), ["Long"]);
  assert.equal(left[0].remaining, 600);
  world.close();
});

await test("F28: a one-minute effect ends after ten rounds of a fight, and the clock in a fight counts nothing twice", async () => {
  const { world, sheets: [hero] } = await table([FIGHTER]);
  await world.invoke("set_effect", { characterId: hero.id, name: "Minute", modifiers: [{ field: "ac", mode: "add", value: 1 }], duration: "minutes", remaining: 1 });
  await world.invoke("set_effect", { characterId: hero.id, name: "Rounds", modifiers: [{ field: "ac", mode: "add", value: 1 }], duration: "rounds", remaining: 30 });
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(effectsOn(world, "character", hero.id).length, 2, "the round wrap owns time in a fight");
  const encounter = world.encounter();
  for (let round = 2; round <= 10; round++) {
    tickEncounterConditions(world.campaign(), { ...encounter, round });
  }
  assert.ok(effectsOn(world, "character", hero.id).some((effect) => effect.name === "Minute"), "nine rounds are not a minute");
  tickEncounterConditions(world.campaign(), { ...encounter, round: 11 });
  const left = effectsOn(world, "character", hero.id);
  assert.deepEqual(left.map((effect) => effect.name), ["Rounds"]);
  assert.equal(left[0].remaining, 20);
});

closeTables();
finish();
