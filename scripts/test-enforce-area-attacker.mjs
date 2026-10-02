// Who an area's damage card names, past the cases test-enforce-roll-attacker
// pins: a character's area that names no spell (a dragonborn's breath) is
// still theirs, a caster whose token the players cannot see is not named,
// and a spell that lays its area over the fallen alone is still cast.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-area-attacker");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

const since = (world, before) =>
  listRecentRolls(world.campaignId, 200).filter((roll) => !before.has(roll.id) && roll.kind === "damage");
const snapshot = (world) => new Set(listRecentRolls(world.campaignId, 200).map((roll) => roll.id));
const DEAD = { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } };

await test("A character's area that names no spell (a breath weapon) is theirs.", async () => {
  const { world, sheets: [breather], enemies: [goblin] } = await table([{ ...FIGHTER, name: "Drax" }]);
  const before = snapshot(world);
  world.dice(3, 3, 1);
  const out = await world.invoke("aoe_damage", { casterId: breather.id, enemyIds: [goblin.id], saveAbility: "dex", dc: 13, damage: "2d6", type: "fire", reason: "Breath Weapon" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = since(world, before);
  assert.deepEqual(blast.attacker, { kind: "sheet", id: breather.id, name: "Drax" });
  assert.equal(blast.detail, `area effect (fire) on ${goblin.displayName}`);
});

await test("An enemy whose token the players cannot see is not named on its area's card; its id is kept.", async () => {
  const { world, sheets: [aria], enemies: [mage] } = await table([{ ...FIGHTER, name: "Aria" }], 1, { spells: ["Fireball"] });
  await layMap(world, ["..........", "..........", ".........."], { [aria.id]: { x: 0, y: 0 }, [mage.id]: { x: 7, y: 1 } });
  getDatabase().prepare("UPDATE battle_tokens SET hidden = 1 WHERE ref_id = ?").run(mage.id);
  const before = snapshot(world);
  world.dice(...new Array(8).fill(3), 1);
  const out = await world.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Fireball", characterIds: [aria.id], saveAbility: "dex", dc: 15, damage: "8d6", type: "fire" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = since(world, before);
  assert.deepEqual(blast.attacker, { kind: "enemy", id: mage.id, name: "Someone unseen" });
  assert.equal(blast.detail, "Fireball on Aria");
});

await test("A spell that lays its area over the fallen alone is still cast; the dead are skipped.", async () => {
  const { world, sheets: [, bren], enemies: [mage] } = await table(
    [{ ...FIGHTER, name: "Aria" }, { ...FIGHTER, name: "Bren" }], 1, { spells: ["Web"] },
  );
  await layMap(world, ["..........", "..........", ".........."], { [bren.id]: { x: 2, y: 1 }, [mage.id]: { x: 7, y: 1 } });
  world.patch(bren.id, DEAD);
  const dead = world.sheet(bren.id);
  const out = await world.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Web", characterIds: [bren.id], saveAbility: "dex", dc: 12, atX: 2, atY: 1 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result.skippedDead, ["Bren"]);
  assert.deepEqual(world.sheet(bren.id), dead);
});

closeTables();
finish();
