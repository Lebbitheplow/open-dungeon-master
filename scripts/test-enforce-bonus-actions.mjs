// The bonus action, and the parts of the Attack action that are not a swing
// (src/lib/dm/action-tools.ts take_action, src/lib/dm/bonus-actions.ts,
// src/lib/dm/resource-tools.ts use_resource Ki).
//
// SRD 5.1:
//   - Cunning Action (rogue 2): Dash, Disengage or Hide as a bonus action.
//   - Ki (monk 2): Flurry of Blows, two unarmed strikes as a bonus action
//     right after the Attack action; Patient Defense, Dodge as a bonus
//     action; Step of the Wind, Dash or Disengage as a bonus action. Each
//     costs 1 ki point.
//   - Grapple and Shove each replace one attack of the Attack action.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-bonus-actions");
const world = await openWorld();
const kit = await combatKit(world);

const rogue = world.addHero({
  class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const fighter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 },
  proficiencies: { ...TRAINED, skills: ["athletics"] },
  equipment: [{ name: "Longsword", qty: 1 }],
});
const monk = world.addHero({
  class: "monk", level: 5, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED,
});
const novice = world.addHero({
  class: "fighter", level: 1, abilities: { str: 16 },
  proficiencies: { ...TRAINED, skills: ["athletics"] },
  equipment: [{ name: "Longsword", qty: 1 }],
});
const heroes = [rogue, fighter, monk, novice];

function fillKi(used = 0) {
  world.patch(monk.id, { resources: { ...world.sheet(monk.id).resources, ki: { max: 5, used } } });
}

// The named hero at the pointer, toe to toe with a dummy that will not die.
async function stage(hero) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  fillKi();
  return enemy;
}

const act = (hero, action, args = {}) =>
  world.invoke("take_action", { characterId: hero.id, action, ...args });
const budget = () => world.encounter().turnBudget;
const swing = (hero, enemy, args = {}) => kit.swing(hero.id, enemy.id, [15, 4, 4, 4, 4], args);

// ---- Cunning Action ----

await test("A rogue with Cunning Action may Disengage as a bonus action after attacking.", async () => {
  const enemy = await stage(rogue);
  assert.equal((await swing(rogue, enemy)).ok, true);
  const out = await act(rogue, "disengage", { bonus: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().disengaged, true);
});

await test("A bonus-action Dash (Cunning Action) leaves the action free.", async () => {
  const enemy = await stage(rogue);
  const out = await act(rogue, "dash", { bonus: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, false);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().dashed, true);
  assert.equal((await swing(rogue, enemy)).ok, true, "the attack after a bonus-action Dash was refused");
});

await test("With the action spent, Cunning Action takes Hide as the bonus action.", async () => {
  const enemy = await stage(rogue);
  assert.equal((await swing(rogue, enemy)).ok, true);
  const board = kit.map();
  const wall = [];
  for (let x = 0; x < board.width; x += 1) {
    wall.push([x, 7, "#"]);
  }
  kit.openField(wall);
  kit.place(rogue.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.dice(20);
  const out = await act(rogue, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
});

await test("Only a feature makes Dash a bonus action.", async () => {
  await stage(fighter);
  const out = await act(fighter, "dash", { bonus: true });
  assert.equal(out.ok, false);
  assert.notEqual(budget()?.bonusUsed, true);
  assert.notEqual(budget()?.actionUsed, true);
});

await test("Cunning Action is one bonus action a turn", async () => {
  await stage(rogue);
  assert.equal((await act(rogue, "dash", { bonus: true })).ok, true);
  const again = await act(rogue, "disengage", { bonus: true });
  assert.equal(again.ok, false);
  assert.equal(budget().disengaged, false);
});

// ---- Ki ----

await test("Patient Defense spends 1 ki and the bonus action to Dodge.", async () => {
  const enemy = await stage(monk);
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  const out = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "patient defense" });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(monk.id).conditions.includes("dodging"));
  assert.equal(budget().bonusUsed, true);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
});

await test("Step of the Wind spends 1 ki and the bonus action to Disengage or Dash.", async () => {
  const enemy = await stage(monk);
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  const out = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "step of the wind" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().disengaged, true);
  assert.equal(budget().bonusUsed, true);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
});

await test("A monk Dashes as a bonus action by spending 1 ki.", async () => {
  await stage(monk);
  const out = await act(monk, "dash", { bonus: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().dashed, true);
  assert.equal(budget().actionUsed, false);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
});

await test("A ki variant needing a spent bonus action is refused before the ki is spent.", async () => {
  const enemy = await stage(monk);
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  assert.equal((await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "patient defense" })).ok, true);
  const again = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "step of the wind" });
  assert.equal(again.ok, false);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
});

await test("Flurry of Blows: two bonus-action unarmed strikes after the Attack action for 1 ki.", async () => {
  const enemy = await stage(monk);
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  const out = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "flurry of blows" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
  const one = await swing(monk, enemy, { weapon: "unarmed strike" });
  assert.equal(one.ok, true, one.error);
  const two = await swing(monk, enemy, { weapon: "unarmed strike" });
  assert.equal(two.ok, true, two.error);
  const hp = kit.enemy(enemy.id).currentHp;
  const three = await swing(monk, enemy, { weapon: "unarmed strike" });
  assert.equal(three.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("Flurry of Blows needs the Attack action taken first.", async () => {
  await stage(monk);
  const out = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "flurry of blows" });
  assert.equal(out.ok, false);
  assert.equal(world.sheet(monk.id).resources.ki.used, 0);
});

// ---- grapple and shove inside the Attack action ----

await test("A grapple replaces one attack of the Attack action.", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  const grabbed = await act(fighter, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(grabbed.ok, true, grabbed.error);
  assert.equal(budget().attacksMade, 1);
  const hit = await swing(fighter, enemy);
  assert.equal(hit.ok, true, hit.error);
  assert.equal(budget().attacksMade, 2);
  const third = await swing(fighter, enemy);
  assert.equal(third.ok, false);
});

await test("A shove may be the second attack of Extra Attack.", async () => {
  const enemy = await stage(fighter);
  assert.equal((await swing(fighter, enemy)).ok, true);
  world.dice(20, 1);
  const shoved = await act(fighter, "shove", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(shoved.ok, true, shoved.error);
  assert.equal(budget().attacksMade, 2);
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["prone"]);
});

await test("with one attack, a grapple is the whole Attack action", async () => {
  const enemy = await stage(novice);
  world.dice(20, 1);
  assert.equal((await act(novice, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  assert.equal((await swing(novice, enemy)).ok, false);
  const shove = await act(novice, "shove", { targetEnemyId: enemy.id });
  assert.equal(shove.ok, false);
});


await test("Flurry of Blows strikes are unarmed strikes: a weapon attack does not spend them", async () => {
  const enemy = await stage(monk);
  world.patch(monk.id, { equipment: [{ name: "Shortsword", qty: 1 }] });
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  assert.equal((await swing(monk, enemy, { weapon: "unarmed strike" })).ok, true);
  assert.equal((await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "flurry of blows" })).ok, true);
  const blade = await swing(monk, enemy, { weapon: "Shortsword" });
  assert.equal(blade.ok, false);
  assert.equal(budget().flurryStrikes, 2);
  world.patch(monk.id, { equipment: [] });
});

await test("Patient Defense through take_action: a monk's bonus-action Dodge spends 1 ki", async () => {
  await stage(monk);
  const out = await act(monk, "dodge", { bonus: true });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(monk.id).conditions.includes("dodging"));
  assert.equal(budget().actionUsed, false);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
});

await test("a ki route with no ki left is refused and spends nothing", async () => {
  await stage(monk);
  fillKi(5);
  const out = await act(monk, "dash", { bonus: true });
  assert.equal(out.ok, false);
  assert.notEqual(budget()?.bonusUsed, true);
  assert.equal(world.sheet(monk.id).resources.ki.used, 5);
});

await test("with the action spent, a fighter's second action is refused, never moved to the bonus action", async () => {
  const enemy = await stage(fighter);
  assert.equal((await swing(fighter, enemy)).ok, true);
  assert.equal((await swing(fighter, enemy)).ok, true);
  const out = await act(fighter, "disengage");
  assert.equal(out.ok, false);
  assert.equal(budget().bonusUsed, false);
});

await kit.endFight();
world.close();
finish();
