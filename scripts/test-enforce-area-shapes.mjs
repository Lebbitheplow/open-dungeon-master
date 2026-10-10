// An area spell catches only the creatures inside one placement of its
// shape (docs/dnd-rules-audit-2026-10-09-extent.md, F13; src/lib/dm/aoe-shape.ts).
//
//   - Fireball (SRD 5.1): "Each creature in a 20-foot-radius sphere centered
//     on that point". Two creatures 100 feet apart are never in one sphere.
//   - Burning Hands: "Each creature in a 15-foot cone". A cone points one way
//     from its caster; creatures on both sides are not in it.
//   - Lightning Bolt: "A stroke of lightning forming a line 100 feet long and
//     5 feet wide blasts out from you in a direction you choose."
//   - A point of origin sits within the spell's range (Shatter: 60 feet).
//
// A refusal spends nothing. Every check reads a refusal, a slot or an enemy.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf } from "./lib/enforce-spell-kit.mjs";
import { board } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-area-shapes");

const WIZARD = caster("wizard", "int", ["Fireball", "Burning Hands", "Lightning Bolt", "Shatter"], [], 9);
const slots = (world, id, level) => world.sheet(id).spellcasting.slots[String(level)].used;

await test("Fireball refuses two creatures 110 feet apart, and spends no slot.", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await board([WIZARD], { 0: { x: 12, y: 0 }, e0: { x: 1, y: 4 }, e1: { x: 23, y: 4 } }, { count: 2 });
  const out = await world.invoke("aoe_damage", { casterId: mage.id, spell: "Fireball", level: 3, enemyIds: [a.id, b.id] });
  assert.equal(out.ok, false, "one sphere caught creatures 110 feet apart");
  assert.match(String(out.error), /sphere/);
  assert.equal(slots(world, mage.id, 3), 0);
});

await test("Fireball catches two creatures 10 feet apart in one sphere.", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await board([WIZARD], { 0: { x: 2, y: 0 }, e0: { x: 10, y: 4 }, e1: { x: 12, y: 4 } }, { count: 2 });
  world.dice(...new Array(8).fill(1), 20, 20);
  const out = await world.invoke("aoe_damage", { casterId: mage.id, spell: "Fireball", level: 3, enemyIds: [a.id, b.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(slots(world, mage.id, 3), 1);
});

await test("Shatter placed beyond its 60-foot range is refused; within it, cast.", async () => {
  const { world, sheets: [mage], enemies: [a] } = await board([WIZARD], { 0: { x: 0, y: 0 }, e0: { x: 20, y: 4 } });
  // (20, 4) is 100 feet from the caster in the corner.
  const far = await world.invoke("aoe_damage", { casterId: mage.id, spell: "Shatter", level: 2, enemyIds: [a.id], atX: 20, atY: 4 });
  assert.equal(far.ok, false, "a point 100 feet off took a 60-foot spell");
  assert.match(String(far.error), /range/);
  assert.equal(slots(world, mage.id, 2), 0);
  const { world: near, sheets: [caster2], enemies: [b] } = await board([WIZARD], { 0: { x: 0, y: 0 }, e0: { x: 10, y: 4 } });
  near.dice(1, 1, 1, 20);
  const cast = await near.invoke("aoe_damage", { casterId: caster2.id, spell: "Shatter", level: 2, enemyIds: [b.id], atX: 10, atY: 4 });
  near.clearDice();
  assert.equal(cast.ok, true, cast.error);
});

await test("Burning Hands refuses creatures on both sides of its caster; one side is one cone.", async () => {
  const both = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 10, y: 4 }, e1: { x: 14, y: 4 } }, { count: 2 });
  const refused = await both.world.invoke("aoe_damage", { casterId: both.sheets[0].id, spell: "Burning Hands", level: 1, enemyIds: both.enemies.map((enemy) => enemy.id) });
  assert.equal(refused.ok, false, "one cone caught creatures east and west of its caster");
  assert.match(String(refused.error), /cone/);
  assert.equal(slots(both.world, both.sheets[0].id, 1), 0);
  const one = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 13, y: 4 }, e1: { x: 14, y: 4 } }, { count: 2 });
  one.world.dice(1, 1, 1, 20, 20);
  const cast = await one.world.invoke("aoe_damage", { casterId: one.sheets[0].id, spell: "Burning Hands", level: 1, enemyIds: one.enemies.map((enemy) => enemy.id) });
  one.world.clearDice();
  assert.equal(cast.ok, true, cast.error);
});

await test("Lightning Bolt refuses creatures in opposite directions; one line holds creatures along it.", async () => {
  const split = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 8, y: 4 }, e1: { x: 16, y: 4 } }, { count: 2 });
  const refused = await split.world.invoke("aoe_damage", { casterId: split.sheets[0].id, spell: "Lightning Bolt", level: 3, enemyIds: split.enemies.map((enemy) => enemy.id) });
  assert.equal(refused.ok, false, "one line ran both ways from its caster");
  assert.match(String(refused.error), /line/);
  const along = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 14, y: 4 }, e1: { x: 18, y: 4 } }, { count: 2 });
  along.world.dice(...new Array(8).fill(1), 20, 20);
  const cast = await along.world.invoke("aoe_damage", { casterId: along.sheets[0].id, spell: "Lightning Bolt", level: 3, enemyIds: along.enemies.map((enemy) => enemy.id) });
  along.world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(along.world, along.enemies[1].id).currentHp < enemyOf(along.world, along.enemies[1].id).maxHp);
});

closeTables();
finish();
