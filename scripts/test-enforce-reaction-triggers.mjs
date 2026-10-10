// Reactions answer their trigger, and the monsters take theirs
// (docs/dnd-rules-audit-2026-10-09-extent.md, F16, F26, N06, N10).
//
//   - Shield (SRD 5.1): "which you take when you are hit by an attack or
//     targeted by the magic missile spell". With no hit to answer it is
//     refused and nothing is spent.
//   - Absorb Elements: "you have resistance to the triggering damage type
//     until the start of your next turn. Also, the first time you hit with a
//     melee attack on your next turn, the target takes an extra 1d6 damage of
//     the triggering type", 1d6 more per slot level above 1st.
//   - A monster whose block lists Shield casts it when +5 AC turns a hit into
//     a miss; one that lists Counterspell answers a spell cast at its side
//     within 60 feet, spending its slot and its reaction.
//
// Dice forced; every check reads a sheet, an enemy row or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-reaction-triggers");
const world = await openWorld();
const kit = await combatKit(world);
const { conditionOnHitDice } = await import("../src/lib/srd/condition-effects.ts");

const wizard = world.addHero({
  class: "wizard", level: 9, maxHp: 40, abilities: { int: 18, dex: 14 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: ["Shield", "Hold Person", "Absorb Elements"], known: [], cantrips: [] },
});
const fighter = world.addHero({
  class: "fighter", level: 5, maxHp: 40, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});

async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [wizard.id]: 20, [fighter.id]: 15 } });
  for (const hero of [wizard, fighter]) {
    world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {}, concentratingOn: null });
  }
  world.patch(wizard.id, { spellcasting: { ...world.sheet(wizard.id).spellcasting, slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } } } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(wizard.id, 5, 5);
  kit.place(fighter.id, 6, 5);
  kit.place(enemy.id, 6, 6);
  return enemy;
}

// ---- triggers ----

await test("Shield with no hit to answer is refused, and neither the slot nor the reaction is spent.", async () => {
  await stage();
  const out = await world.invoke("use_reaction", { characterId: wizard.id, feature: "Shield" });
  assert.equal(out.ok, false, "Shield was cast with nothing to answer");
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.encounter().reactionsUsed.includes(wizard.id), false);
  assert.equal(world.sheet(wizard.id).conditions.includes("shielded"), false);
});

await test("Absorb Elements' stored strike rides a melee hit only, with the dice and type of its slot, and is spent by it.", () => {
  const melee = conditionOnHitDice(["absorbed strike (2d6 fire)"], { weapon: true, melee: true });
  assert.equal(melee.suffix, "+2d6");
  assert.deepEqual(melee.typed, [{ dice: "2d6", type: "fire" }]);
  assert.deepEqual(melee.hitSpent, ["absorbed strike (2d6 fire)"]);
  const ranged = conditionOnHitDice(["absorbed strike (2d6 fire)"], { weapon: true, melee: false });
  assert.equal(ranged.suffix, "");
});

if (world.hasPack) {
  await test("Absorb Elements answers elemental damage: resistance until the next turn, half the hit back, and the charged strike.", async () => {
    const enemy = await stage();
    const refused = await world.invoke("use_reaction", { characterId: wizard.id, feature: "Absorb Elements" });
    assert.equal(refused.ok, false, "Absorb Elements was cast with no elemental damage to answer");
    // A fire bolt that took 10 of the wizard's 40.
    await world.hitBy(wizard.id, { enemyId: enemy.id, raw: 10, type: "fire", attack: "Fire Bolt" });
    world.patch(wizard.id, { currentHp: 30 });
    const out = await world.invoke("use_reaction", { characterId: wizard.id, feature: "Absorb Elements", level: 2 });
    assert.equal(out.ok, true, out.error);
    const held = world.sheet(wizard.id).conditions;
    assert.ok(held.includes("absorb elements (fire)"), held.join(", "));
    assert.ok(held.includes("absorbed strike (2d6 fire)"), held.join(", "));
    assert.equal(world.sheet(wizard.id).currentHp, 35, "half of the 10 came back");
  });
}

// ---- the monsters' reaction spells ----

const MAGE = (spells, slots) => ({ dc: 14, attack: 6, ability: "int", slots, spells });

await test("A monster whose block lists Shield casts it when +5 AC turns a hit into a miss, and spends its slot and reaction.", async () => {
  const enemy = await stage();
  kit.giveTurn(fighter.id);
  // The fighter's bonus, read off a probe swing at the bare block.
  const probe = await kit.swing(fighter.id, enemy.id, [10, 1]);
  const bonus = probe.toHit.total - 10;
  kit.setEnemy(enemy.id, { ac: 10 + bonus - 2, stats: { spellcasting: MAGE([{ name: "Shield", level: 1 }], { 1: 2 }) } });
  kit.giveTurn(fighter.id);
  const before = kit.enemy(enemy.id).currentHp;
  const out = await kit.swing(fighter.id, enemy.id, [10, 1]);
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, before, "the shielded hit still dealt damage");
  assert.ok(kit.enemy(enemy.id).conditions.includes("shielded"));
  assert.ok(world.encounter().reactionsUsed.includes(enemy.id));
  assert.deepEqual(world.encounter().legendary.abilities?.[enemy.id]?.slots, { 1: 1 });
});

await test("A monster whose block lists Counterspell answers a spell cast at it: the caster's slot and action are spent and the spell fails.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { spellcasting: MAGE([{ name: "Counterspell", level: 3 }], { 3: 2 }) } });
  kit.giveTurn(wizard.id);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  assert.equal(out.ok, false, "the countered spell resolved");
  assert.match(String(out.error), /Counterspell/);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["2"].used, 1, "the countered spell's slot was not spent");
  assert.equal(kit.enemy(enemy.id).conditions.includes("paralyzed"), false);
  assert.ok(world.encounter().reactionsUsed.includes(enemy.id));
  assert.deepEqual(world.encounter().legendary.abilities?.[enemy.id]?.slots, { 3: 1 });
});

await test("A monster that has used its reaction this round cannot counter.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { spellcasting: MAGE([{ name: "Counterspell", level: 3 }], { 3: 2 }) } });
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, reactionsUsed: [enemy.id] });
  kit.giveTurn(wizard.id);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(kit.enemy(enemy.id).conditions.includes("paralyzed"));
});

world.close();
finish();
