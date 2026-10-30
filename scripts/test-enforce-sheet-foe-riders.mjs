// What a failed save leaves on a character fighting on the other side
// (issue 588, after PR 601): the spell's condition was only the start. A
// party caster's Thunderwave, Harm, Heat Metal, Stinking Cloud and Divine
// Word, and the marks that act at the end of the target's turn (Phantasmal
// Killer, Acid Arrow), read an enemy row only and did nothing to a companion
// turned on the party. Each now lands on the turncoat's sheet, the way it
// lands on an enemy.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-sheet-foe-riders");
const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { tickClockConditions } = await import("../src/lib/dm/condition-tick.ts");
const { beginTurns, endTurns } = await import("../src/lib/dm/turn-end.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const mage = world.addHero({ name: "Sable", ...caster("wizard", "int", ["Thunderwave", "Stinking Cloud", "Phantasmal Killer"], [], 9), maxHp: 40, ac: 12, acOverride: true });
const priest = world.addHero({ name: "Thane", ...caster("cleric", "wis", ["Harm", "Divine Word"], [], 13), maxHp: 60, ac: 12, acOverride: true });
const druid = world.addHero({ name: "Rowan", ...caster("druid", "wis", ["Heat Metal"], [], 9), maxHp: 40, ac: 12, acOverride: true });

function fresh() {
  for (const sheet of [mage, priest, druid]) {
    // Every slot back, so each casting spends from a full set.
    world.patch(sheet.id, { currentHp: sheet.maxHp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, concentratingOn: null, spellcasting: sheet.spellcasting });
  }
}

// A fight with one turncoat (a guest who left with the fight), standing at
// (5,2) beside the casters' row.
async function stage(extra = {}) {
  await kit.endFight();
  fresh();
  const joined = await world.invoke("add_companion", {
    gender: "Unknown", name: "Aldric", class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const id = joined.result.characterId;
  world.patch(id, {
    abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 14, acOverride: true,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }], conditions: [], conditionMeta: {}, ...extra,
  });
  await kit.fight(1, { heroFaces: { [mage.id]: 19, [priest.id]: 18, [druid.id]: 17, [id]: 3 } });
  moveToSide(world.campaign(), id, "foe");
  kit.place(mage.id, 4, 2);
  kit.place(priest.id, 4, 4);
  kit.place(druid.id, 3, 3);
  kit.place(id, 5, 2);
  world.enemies().forEach((enemy, index) => kit.place(enemy.id, 14 + index * 2, 14));
  return world.sheet(id);
}

await test("A party wizard's Thunderwave pushes a turncoat who fails the save 10 feet away", async () => {
  const turncoat = await stage();
  kit.giveTurn(mage.id);
  // The turncoat's CON save: a d20 of 2; then 2d8 of 3 and 3.
  world.dice(2, 3, 3);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: turncoat.id, spell: "Thunderwave" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  assert.equal(world.sheet(turncoat.id).currentHp, 30 - 6);
  assert.deepEqual([kit.token(turncoat.id).x, kit.token(turncoat.id).y], [7, 2], JSON.stringify(out.result.effects));
  assert.match(String(out.result.effects), /pushed 10 feet/);
});

await test("A party cleric's Harm shrinks a turncoat's hit point maximum by the necrotic it took, for an hour", async () => {
  const turncoat = await stage();
  kit.giveTurn(priest.id);
  // The CON save: a d20 of 2; then 14d6 of all 1s, 14 necrotic.
  world.dice(2, ...new Array(14).fill(1));
  const out = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: turncoat.id, spell: "Harm" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  const harmed = world.sheet(turncoat.id);
  assert.equal(harmed.currentHp, 30 - 14);
  assert.equal(harmed.maxHp, 30 - 14, JSON.stringify(harmed.conditions));
  assert.equal(harmed.conditionMeta["max hp reduced (-14)"]?.spell, "Harm");
  assert.match(String(out.result.effects), /maximum drops by 14/);
  // An hour on the clock gives the maximum back.
  tickClockConditions(world.campaign(), 60);
  assert.equal(world.sheet(turncoat.id).maxHp, 30, JSON.stringify(world.sheet(turncoat.id).conditions));
});

await test("A party druid's Heat Metal on a turncoat in armor lays the searing grip's disadvantage on the turncoat's sheet", async () => {
  const turncoat = await stage();
  kit.giveTurn(druid.id);
  // 2d8 fire of 3 and 3, then the turncoat's CON save: a d20 of 2.
  world.dice(3, 3, 2);
  const out = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: turncoat.id, spell: "Heat Metal", condition: "armor" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(String(out.result.grip), /keeps hold/, JSON.stringify(out.result));
  assert.ok(world.sheet(turncoat.id).conditions.includes("searing metal"), JSON.stringify(world.sheet(turncoat.id).conditions));
});

await test("A party wizard's Stinking Cloud leaves a turncoat who fails the save retching", async () => {
  const turncoat = await stage();
  kit.giveTurn(mage.id);
  world.dice(2);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: turncoat.id, spell: "Stinking Cloud" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  assert.ok(world.sheet(turncoat.id).conditions.includes("retching"), JSON.stringify(out.result));
});

await test("Divine Word blinds, deafens and stuns a turncoat at 30 hit points or fewer, and slays one at 20 or fewer", async () => {
  let turncoat = await stage({ currentHp: 25 });
  kit.giveTurn(priest.id);
  world.dice(2);
  let out = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: turncoat.id, spell: "Divine Word" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const struck = world.sheet(turncoat.id);
  for (const condition of ["blinded", "deafened", "stunned"]) {
    assert.ok(struck.conditions.includes(condition), `${condition}: ${JSON.stringify(out.result)}`);
  }
  turncoat = await stage({ currentHp: 18 });
  kit.giveTurn(priest.id);
  world.dice(2);
  out = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: turncoat.id, spell: "Divine Word" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(turncoat.id).deathSaves?.dead, true, JSON.stringify(out.result));
});

// One whole turn of the turncoat's: what waits on its end is begun, then ended.
function turncoatTurn(id) {
  beginTurns(world.campaign(), world.encounter().id, [id]);
  return endTurns(world.campaign(), world.encounter().id, [id]).lines;
}

await test("Phantasmal Killer on a turncoat deals its psychic at the end of each of its turns until a save ends it", async () => {
  const turncoat = await stage();
  kit.giveTurn(mage.id);
  // The WIS save at the casting: a d20 of 2 against DC 16.
  world.dice(2);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: turncoat.id, spell: "Phantasmal Killer" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(turncoat.id).conditions.includes("frightened"), JSON.stringify(out.result));
  // The end of its turn: a failed save (3), then 4d10 of 5s.
  world.dice(3, 5, 5, 5, 5);
  let lines = turncoatTurn(turncoat.id);
  world.clearDice();
  assert.equal(world.sheet(turncoat.id).currentHp, 30 - 20, lines.join(" "));
  assert.ok(world.sheet(turncoat.id).conditions.includes("frightened"), "a failed save keeps the dread");
  // The next turn's end: a made save (19) ends the spell for it.
  world.dice(19);
  lines = turncoatTurn(turncoat.id);
  world.clearDice();
  assert.ok(!world.sheet(turncoat.id).conditions.includes("frightened"), lines.join(" "));
  assert.equal(world.sheet(turncoat.id).currentHp, 30 - 20, "a made save deals nothing");
});

await test("Acid Arrow's mark on a turncoat burns again at the end of its next turn", async () => {
  const turncoat = await stage();
  // The mark a hit leaves (spell-attack-riders.ts applySpellHitCondition).
  world.patch(turncoat.id, { conditions: ["acid arrow"], conditionMeta: { "acid arrow": { untilTurnEndOf: turncoat.id, source: mage.id, slotLevel: 2 } } });
  world.dice(2, 2);
  const lines = turncoatTurn(turncoat.id);
  world.clearDice();
  assert.equal(world.sheet(turncoat.id).currentHp, 30 - 4, lines.join(" "));
  assert.ok(!world.sheet(turncoat.id).conditions.includes("acid arrow"));
});

await finish();
