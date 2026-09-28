// What a cast needs besides a slot: the slot itself when the caller leaves
// its level out, the spell's components, a legal target, and the one
// levelled spell a turn allows beside a bonus action spell.
//
// The rules (SRD 5.1, "Casting a Spell"): a spell of 1st level or higher
// always expends a slot; a verbal component needs a voice, so a caster who
// is gagged or inside a Silence spell casts nothing with a V in it; a
// material component with a cost must be in hand, and one the spell consumes
// is gone afterwards; a spell cast as a bonus action leaves only a cantrip
// with a casting time of one action for the rest of the turn; a spell
// affects only what its text lets it target (Hold Person: a humanoid), and a
// creature that is dead, gone or immune is no target at all.
//
// ODM models no components and no hands (docs/rules-coverage.md lists
// neither), so those rules are gaps here rather than refusals. The target
// checks the cast tools do make are pinned as tests.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { castingState, cleric, fightDummies, wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-casting-components");
const worlds = [];

async function table(heroes, count = 1, options = {}) {
  const world = await openWorld();
  worlds.push(world);
  const sheets = heroes.map((hero) => world.addHero(hero));
  const enemies = await fightDummies(world, count, { heroFaces: { [sheets[0].id]: 20 }, ...options });
  return { world, sheets, enemies };
}

const enemyState = (world) => JSON.stringify(world.enemies().map((enemy) => [enemy.currentHp, enemy.conditions]));

// A call that must be refused, leaving the caster and the enemies alone.
async function refused(world, hero, name, args, label) {
  const before = castingState(world.sheet(hero.id));
  const enemies = enemyState(world);
  world.dice(1, 1, 1, 1, 1, 1, 1, 1);
  const out = await world.invoke(name, args);
  world.clearDice();
  assert.equal(out.ok, false, `${label} was allowed: ${JSON.stringify(out.result ?? {}).slice(0, 200)}`);
  assert.equal(castingState(world.sheet(hero.id)), before, `${label} was refused but changed the caster`);
  assert.equal(enemyState(world), enemies, `${label} was refused but changed an enemy`);
}

const hold = (hero, enemy, extra = {}) => ({
  characterId: hero.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2, ...extra,
});

// ---- the slot ----

await test("a levelled spell cast with no level named spends a slot of its own level", async () => {
  const { world, sheets: [mage], enemies: [first, second] } = await table([wizard(5)], 2);
  const slots = JSON.stringify(world.sheet(mage.id).spellcasting.slots);
  world.dice(1);
  const held = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: first.id, spell: "Hold Person", saveAbility: "wis" });
  world.clearDice();
  world.dice(1, 6, 6, 6);
  const burned = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: second.id, spell: "Burning Hands", saveAbility: "dex", damage: "3d6" });
  world.clearDice();
  const free = [held, burned].filter((out) => out.ok).length;
  assert.ok(
    free === 0 || JSON.stringify(world.sheet(mage.id).spellcasting.slots) !== slots,
    `${free} levelled spells were cast and the slots still read ${slots}`,
  );
});

// ---- targets ----

await test("a spell cannot be cast at an enemy that is dead, gone or not there", async () => {
  const { world, sheets: [mage], enemies: [first, second] } = await table([wizard(5)], 2);
  await world.invoke("damage_enemy", { enemyId: first.id, amount: 200 });
  assert.notEqual(world.enemies().find((enemy) => enemy.id === first.id).status, "alive");
  await refused(world, mage, "cast_at_enemy", hold(mage, first), "Hold Person on a dead enemy");
  await refused(world, mage, "cast_at_enemy", hold(mage, { id: "no-such-enemy" }), "Hold Person on nobody");
  await refused(world, mage, "pc_attack", { characterId: mage.id, enemyId: first.id, targetEnemyId: first.id, spell: "Fire Bolt", damage: "1d10" }, "Fire Bolt at a dead enemy");
  world.dice(1);
  const live = await world.invoke("cast_at_enemy", hold(mage, second));
  world.clearDice();
  assert.equal(live.ok, true, live.error);
});

await test("an enemy immune to the condition is no target, and the slot is kept", async () => {
  const { world, sheets: [mage], enemies: [golem] } = await table([wizard(5)], 1, { stats: { conditionImmune: "charmed, paralyzed, poisoned" } });
  await refused(world, mage, "cast_at_enemy", hold(mage, golem), "Hold Person on a creature immune to paralysis");
});

await test("with no fight on there is nobody to cast at", async () => {
  const world = await openWorld();
  worlds.push(world);
  const mage = world.addHero(wizard(5));
  const before = castingState(world.sheet(mage.id));
  const out = await world.invoke("cast_at_enemy", hold(mage, { id: "goblin-1" }));
  assert.equal(out.ok, false);
  assert.equal(castingState(world.sheet(mage.id)), before);
});

await test("Hold Person takes hold of a humanoid only", async () => {
  const { world, sheets: [mage], enemies: [bear] } = await table([wizard(5)], 1, { stats: { type: "beast" } });
  assert.equal(world.enemies()[0].stats.type, "beast");
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", hold(mage, bear));
  world.clearDice();
  assert.ok(
    out.ok === false || !world.enemies()[0].conditions.includes("paralyzed"),
    "Hold Person paralyzed a beast",
  );
});

// ---- components ----

await test("a silenced caster cannot cast a spell with a verbal component", async () => {
  const { world, sheets: [mage], enemies: [enemy] } = await table([wizard(5)]);
  const gagged = await world.invoke("set_condition", { characterId: mage.id, condition: "silenced", rounds: 10, reason: "inside a Silence spell" });
  assert.equal(gagged.ok, true, gagged.error);
  // Magic Missile is V, S; Hold Person is V, S, M.
  await refused(world, mage, "use_spell_slot", { characterId: mage.id, level: 1, spell: "Magic Missile" }, "Magic Missile while silenced");
  await refused(world, mage, "cast_at_enemy", hold(mage, enemy), "Hold Person while silenced");
});

await test("Revivify consumes the diamond it is cast with", async () => {
  const world = await openWorld();
  worlds.push(world);
  const priest = world.addHero(cleric(5, { equipment: [{ name: "Diamond (300 gp)", qty: 1 }], gold: 0 }));
  const out = await world.invoke("use_spell_slot", { characterId: priest.id, level: 3, spell: "Revivify" });
  assert.equal(out.ok, true, out.error);
  const left = world.sheet(priest.id).equipment.filter((item) => /diamond/i.test(item.name));
  assert.deepEqual(left, [], "the diamond is still in the pack");
});

// ---- the bonus action rule ----

await test("after a bonus action spell the only other spell that turn is a cantrip", async () => {
  const { world, sheets: [priest], enemies: [enemy] } = await table([cleric(5)]);
  const quick = await world.invoke("use_spell_slot", { characterId: priest.id, level: 1, spell: "Healing Word" });
  assert.equal(quick.ok, true, quick.error);
  await refused(world, priest, "cast_at_enemy", hold(priest, enemy), "Hold Person after Healing Word");
  // A cantrip is still allowed.
  world.dice(1, 4, 4);
  const flame = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Sacred Flame", saveAbility: "dex", damage: "2d8" });
  world.clearDice();
  assert.equal(flame.ok, true, flame.error);
});

for (const world of worlds) {
  world.clearDice();
}
worlds[0].close();
finish();
