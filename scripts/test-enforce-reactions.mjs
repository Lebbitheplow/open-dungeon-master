// Reactions that answer an attack after it has landed (src/lib/dm/last-hit.ts,
// src/lib/dm/reaction-tools.ts use_reaction).
//
// The engine rolls an enemy's attack and applies its damage in one call, so
// a reaction that answers a hit comes after the damage. The engine keeps the
// last attack against each character (its roll, the AC it was rolled
// against, the damage and type, the attacker, melee or ranged) and the
// reaction re-resolves that attack and gives back what the rules give back.
//
// SRD 5.1:
//   - Shield: +5 AC until the start of the caster's next turn, including
//     against the triggering attack.
//   - Uncanny Dodge (rogue 5): halve one attack's damage.
//   - Deflect Missiles (monk 3): a ranged weapon attack's damage drops by
//     1d10 + DEX modifier + monk level.
//   - Cutting Words (Lore bard 3): one Bardic Inspiration die, subtracted
//     from a creature's attack roll or damage roll.
//   - Protection (fighting style): with a shield, impose disadvantage on an
//     attack against an ally within 5 feet.
//   - Hellish Rebuke: the attacker makes a DEX save against 2d10 fire.
//   - Slow Fall (monk 4): falling damage drops by 5 x monk level.
//   - Feather Fall: a falling creature takes no falling damage.
//   - Only the holder of a feature uses it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-reactions");
const world = await openWorld();
const kit = await combatKit(world);

const caster = (spells, slots = { 1: { max: 4, used: 0 } }) => ({
  ability: "int", slots, prepared: spells, known: [], cantrips: [],
});

const wizard = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: caster(["Shield", "Feather Fall", "Counterspell"], { 1: { max: 4, used: 0 }, 3: { max: 2, used: 0 } }),
});
const rogue = world.addHero({ class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED });
const monk = world.addHero({ class: "monk", level: 5, maxHp: 30, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED });
const bard = world.addHero({
  class: "bard", subclass: "College of Lore", level: 3, maxHp: 30, abilities: { cha: 16 }, proficiencies: TRAINED,
});
const guard = world.addHero({
  class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Shield", qty: 1 }],
  features: [{ name: "Fighting Style: Protection", source: "class", level: 1 }],
});
const warlock = world.addHero({
  class: "warlock", level: 3, maxHp: 30, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: { 2: { max: 2, used: 0 } }, prepared: [], known: ["Hellish Rebuke"], cantrips: [] },
});
// The style is a choice made at level 1; written straight to the sheet so
// the test does not depend on the builder's pick list.
world.patch(guard.id, { features: [...world.sheet(guard.id).features, { name: "Fighting Style: Protection", source: "class", level: 1 }] });
const heroes = [wizard, rogue, monk, bard, guard, warlock];

// A fight with every hero at full health and AC 12, and the one dummy set up
// by the test. The pointer rests on the first hero; enemies attack off it.
async function stage() {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of heroes) {
    world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0, conditions: [], conditionMeta: {} });
  }
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  world.patch(wizard.id, {
    concentratingOn: null,
    spellcasting: { ...world.sheet(wizard.id).spellcasting, slots: { 1: { max: 4, used: 0 }, 3: { max: 2, used: 0 } } },
  });
  world.patch(monk.id, { resources: { ...world.sheet(monk.id).resources, ki: { max: 5, used: 0 } } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(enemy.id, 5, 6);
  return enemy;
}

// The enemy attacks `target` with its d20 and damage dice forced.
async function enemyHits(enemy, target, faces) {
  kit.freshRound();
  kit.place(target.id, 5, 5);
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out.result;
}

const react = (hero, feature, args = {}) =>
  world.invoke("use_reaction", { characterId: hero.id, feature, ...args });
const hp = (hero) => world.sheet(hero.id).currentHp;
const reacted = (hero) => world.encounter().reactionsUsed.includes(hero.id);

await test("Shield's +5 AC counts against the triggering attack: a hit it turns into a miss deals no damage.", async () => {
  const enemy = await stage();
  // 10 + 4 = 14 against AC 12 hits for 3 + 2.
  const hit = await enemyHits(enemy, wizard, [10, 3]);
  assert.equal(hit.hit, true);
  assert.equal(hp(wizard), 25);
  const out = await react(wizard, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(wizard), 30);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1);
});

await test("Shield does not undo a hit that still meets the higher AC", async () => {
  const enemy = await stage();
  // 15 + 4 = 19 against 12 + 5 still hits.
  await enemyHits(enemy, wizard, [15, 3]);
  const out = await react(wizard, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(wizard), 25);
});

await test("Uncanny Dodge halves the damage of the attack that hit.", async () => {
  const enemy = await stage();
  await enemyHits(enemy, rogue, [15, 6]);
  assert.equal(hp(rogue), 22);
  const out = await react(rogue, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(rogue), 26);
  assert.ok(reacted(rogue));
});

await test("Only a character with Uncanny Dodge uses it; a refusal spends no reaction.", async () => {
  const enemy = await stage();
  await enemyHits(enemy, wizard, [15, 6]);
  const out = await react(wizard, "Uncanny Dodge");
  assert.equal(out.ok, false);
  assert.equal(hp(wizard), 22);
  assert.equal(reacted(wizard), false);
});

await test("Uncanny Dodge answers a hit; with no attack against the rogue this turn it is refused.", async () => {
  await stage();
  const out = await react(rogue, "Uncanny Dodge");
  assert.equal(out.ok, false);
  assert.equal(reacted(rogue), false);
});

await test("Deflect Missiles reduces a ranged weapon attack's damage by 1d10 + DEX + monk level.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.freshRound();
  kit.place(monk.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.dice(15, 6);
  const shot = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: monk.id });
  world.clearDice();
  assert.equal(shot.ok, true, shot.error);
  assert.equal(hp(monk), 22);
  world.dice(1);
  const out = await react(monk, "Deflect Missiles");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // 1 + 3 + 5 = 9 off 8: nothing lands.
  assert.equal(hp(monk), 30);
});

await test("Deflect Missiles answers a ranged weapon attack only.", async () => {
  const enemy = await stage();
  await enemyHits(enemy, monk, [15, 6]);
  const out = await react(monk, "Deflect Missiles");
  assert.equal(out.ok, false);
  assert.equal(hp(monk), 22);
  assert.equal(reacted(monk), false);
});

await test("Cutting Words spends a Bardic Inspiration die and subtracts it from the attack roll; a hit it turns into a miss deals no damage.", async () => {
  const enemy = await stage();
  kit.place(bard.id, 4, 4);
  // 10 + 4 = 14 against 12; a d6 of 6 takes it to 8.
  await enemyHits(enemy, guard, [10, 4]);
  assert.equal(hp(guard), 24);
  world.dice(6);
  const out = await react(bard, "Cutting Words", { targetCharacterId: guard.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(guard), 30);
  assert.equal(world.sheet(bard.id).resources.bardic_inspiration.used, 1);
  assert.ok(reacted(bard));
});

await test("Only a College of Lore bard has Cutting Words.", async () => {
  const enemy = await stage();
  await enemyHits(enemy, guard, [10, 4]);
  const out = await react(rogue, "Cutting Words", { targetCharacterId: guard.id });
  assert.equal(out.ok, false);
  assert.equal(hp(guard), 24);
});

await test("Only a character with the Protection fighting style and a shield imposes it.", async () => {
  await stage();
  kit.place(wizard.id, 5, 5);
  kit.place(rogue.id, 6, 5);
  const out = await react(wizard, "Protection", { targetCharacterId: rogue.id });
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(rogue.id).conditions.includes("protected"));
  assert.equal(reacted(wizard), false);
});

await test("the Protection style with a shield covers an ally within 5 feet", async () => {
  await stage();
  kit.place(guard.id, 5, 5);
  kit.place(rogue.id, 6, 5);
  const out = await react(guard, "Protection", { targetCharacterId: rogue.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(rogue.id).conditions.includes("protected"));
});

await test("Protection covers an ally within 5 feet of the protector.", async () => {
  await stage();
  kit.place(guard.id, 1, 1);
  kit.place(rogue.id, 9, 9);
  const out = await react(guard, "Protection", { targetCharacterId: rogue.id });
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(rogue.id).conditions.includes("protected"));
});

await test("Hellish Rebuke through use_reaction rolls the attacker's DEX save and deals the 2d10 fire.", async () => {
  const enemy = await stage();
  await enemyHits(enemy, warlock, [15, 3]);
  const before = kit.enemy(enemy.id).currentHp;
  // Level 2 slot: 3d10. The save rolls 1, the damage 5, 5, 5.
  world.dice(1, 5, 5, 5);
  const out = await react(warlock, "Hellish Rebuke", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, before - 15);
  assert.equal(out.result.saved, false);
  assert.equal(world.sheet(warlock.id).spellcasting.slots["2"].used, 1);
  assert.ok(reacted(warlock));
});

await test("An opportunity attack on a mapped fight is rolled by the server; use_reaction refuses it and keeps the reaction.", async () => {
  await stage();
  const out = await react(guard, "Opportunity attack");
  assert.equal(out.ok, false);
  assert.equal(reacted(guard), false);
});

await test("Slow Fall reduces falling damage by five times the monk's level.", async () => {
  await kit.endFight();
  world.patch(monk.id, { currentHp: 30, conditions: [], conditionMeta: {} });
  world.dice(6, 6, 6);
  const fall = await world.invoke("apply_hazard", { type: "falling", characterIds: [monk.id], feet: 30 });
  world.clearDice();
  assert.equal(fall.ok, true, fall.error);
  assert.equal(hp(monk), 12);
  const out = await react(monk, "Slow Fall");
  assert.equal(out.ok, true, out.error);
  // 5 x 5 = 25 off 18.
  assert.equal(hp(monk), 30);
  assert.ok(!world.sheet(monk.id).conditions.includes("prone"));
});

await test("Feather Fall saves a falling creature every point of falling damage, and spends the slot.", async () => {
  await kit.endFight();
  world.patch(rogue.id, { currentHp: 30, conditions: [], conditionMeta: {} });
  world.dice(6, 6, 6);
  await world.invoke("apply_hazard", { type: "falling", characterIds: [rogue.id], feet: 30 });
  world.clearDice();
  assert.equal(hp(rogue), 12);
  const out = await react(wizard, "Feather Fall", { targetCharacterId: rogue.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(rogue), 30);
  assert.ok(!world.sheet(rogue.id).conditions.includes("prone"));
});


// ---- what the record makes possible besides the audited findings ----

await test("Shield turns away every swing of the attack that the higher AC beats, not only the last", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { attacksPerTurn: 2 } });
  // Two hits: 10 + 4 = 14 for 3 + 2, and 11 + 4 = 15 for 4 + 2.
  await enemyHits(enemy, wizard, [10, 3, 11, 4]);
  assert.equal(hp(wizard), 19);
  assert.equal((await react(wizard, "Shield")).ok, true);
  assert.equal(hp(wizard), 30);
});

await test("a reaction that turns a dropping blow into a lighter one undoes the drop: the character is up, not dying", async () => {
  const enemy = await stage();
  world.patch(rogue.id, { currentHp: 5 });
  await enemyHits(enemy, rogue, [15, 6]);
  const down = world.sheet(rogue.id);
  assert.equal(down.currentHp, 0);
  assert.ok(down.conditions.includes("unconscious"));
  // Uncanny Dodge: 8 becomes 4, and 5 - 4 = 1.
  const out = await react(rogue, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  const up = world.sheet(rogue.id);
  assert.equal(up.currentHp, 1);
  assert.ok(!up.conditions.includes("unconscious"));
  assert.ok(!up.conditions.includes("prone"));
  assert.equal(up.deathSaves, null);
});

await test("Shield is cast as the hit lands: a caster the hit dropped still casts it, and a miss leaves them standing", async () => {
  const enemy = await stage();
  world.patch(wizard.id, { currentHp: 4 });
  await enemyHits(enemy, wizard, [10, 3]);
  assert.equal(hp(wizard), 0);
  const out = await react(wizard, "Shield");
  assert.equal(out.ok, true, out.error);
  const up = world.sheet(wizard.id);
  assert.equal(up.currentHp, 4);
  assert.ok(!up.conditions.includes("unconscious"));
  assert.equal(up.spellcasting.slots["1"].used, 1);
});

await test("a hit Shield turns into a miss asked no concentration save: a concentration it broke comes back with its effects", async () => {
  const enemy = await stage();
  world.patch(wizard.id, { concentratingOn: "Bless" });
  world.patch(rogue.id, { conditions: ["blessed"], conditionMeta: { blessed: { rounds: 10 } } });
  // 10 + 4 hits for 5; the CON save rolls a 1 and Bless ends.
  await enemyHits(enemy, wizard, [10, 3, 1]);
  assert.equal(world.sheet(wizard.id).concentratingOn, null);
  assert.ok(!world.sheet(rogue.id).conditions.includes("blessed"));
  const shield = await react(wizard, "Shield");
  assert.equal(shield.ok, true, shield.error);
  assert.equal(world.sheet(wizard.id).concentratingOn, "Bless");
  assert.ok(world.sheet(rogue.id).conditions.includes("blessed"));
});

await test("Protection rolls the attack that just came again at disadvantage, and a miss gives the damage back", async () => {
  const enemy = await stage();
  kit.place(guard.id, 5, 4);
  // 10 + 4 = 14 hits the rogue (AC 12) for 3 + 2; again at disadvantage, a 2.
  await enemyHits(enemy, rogue, [10, 3]);
  kit.place(guard.id, 5, 4);
  assert.equal(hp(rogue), 25);
  world.dice(2);
  const out = await react(guard, "Protection", { targetCharacterId: rogue.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(rogue), 30);
});

await test("Deflect Missiles with the missile caught throws it back for 1 ki", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.freshRound();
  kit.place(monk.id, 5, 5);
  kit.place(enemy.id, 5, 8);
  world.dice(15, 6);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: monk.id });
  world.clearDice();
  const before = kit.enemy(enemy.id).currentHp;
  // The d10, then the throw: 15 to hit, a 4 on the Martial Arts d6, + DEX 3.
  world.dice(10, 15, 4);
  const out = await react(monk, "Deflect Missiles", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(monk), 30);
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
  assert.equal(kit.enemy(enemy.id).currentHp, before - 7);
});

// A goblin shaman: the spells Counterspell answers are on its block.
const SHAMAN = { dc: 13, attack: 5, ability: "int", slots: { 3: 2, 5: 1 }, spells: [{ name: "Fireball", level: 3 }, { name: "Cone of Cold", level: 5 }, { name: "Misty Step", level: 2 }] };

await test("Counterspell of the slot's level or lower counters the spell, and the enemy's action for the round is spent", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { spellcasting: SHAMAN } });
  kit.place(wizard.id, 5, 5);
  const out = await react(wizard, "Counterspell", { targetEnemyId: enemy.id, spell: "Fireball" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.countered, true);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, 1);
  // The countered spell is spent all the same: the shaman's 3rd-level slot.
  assert.deepEqual(world.encounter().legendary.abilities?.[enemy.id]?.slots, { 3: 1 });
  const after = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: wizard.id });
  assert.equal(after.ok, false, "the countered enemy acted again in the same round");
});

await test("Counterspell against a higher spell rolls the caster's ability check against DC 10 + its level", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { spellcasting: SHAMAN } });
  kit.place(wizard.id, 5, 5);
  // Cone of Cold is 5th level: DC 15; a 1 + INT 3 fails.
  world.dice(1);
  const out = await react(wizard, "Counterspell", { targetEnemyId: enemy.id, spell: "Cone of Cold" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.countered, false);
  assert.ok(reacted(wizard));
});

await test("Counterspell answers only a spell on the creature's block, and spends nothing otherwise", async () => {
  const enemy = await stage();
  kit.place(wizard.id, 5, 5);
  const slots = world.sheet(wizard.id).spellcasting.slots["3"].used;
  const out = await react(wizard, "Counterspell", { targetEnemyId: enemy.id, spell: "Fireball" });
  assert.equal(out.ok, false, "a goblin with no spells was countered");
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, slots);
  assert.equal(reacted(wizard), false);
});

await test("Counterspell on a bonus-action spell spends the creature's bonus action, not its action", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { spellcasting: SHAMAN } });
  kit.place(wizard.id, 5, 5);
  const out = await react(wizard, "Counterspell", { targetEnemyId: enemy.id, spell: "Misty Step" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.countered, true);
  assert.ok(world.encounter().legendary.bonus?.ids.includes(enemy.id), "the bonus action was not spent");
  const after = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: wizard.id });
  assert.equal(after.ok, true, "the countered bonus action took the creature's action too");
});

await test("Counterspell after the enemy has acted is refused, and spends no slot", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { spellcasting: SHAMAN } });
  await enemyHits(enemy, rogue, [2, 1]);
  const slots = world.sheet(wizard.id).spellcasting.slots["3"].used;
  const out = await react(wizard, "Counterspell", { targetEnemyId: enemy.id, spell: "Fireball" });
  assert.equal(out.ok, false);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, slots);
  assert.equal(reacted(wizard), false);
});

await test("off the battle map, an opportunity attack through use_reaction is one attack with the reaction", async () => {
  const enemy = await stage();
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("DELETE FROM battle_tokens WHERE map_id = ?").run(kit.map().id);
  getDatabase().prepare("DELETE FROM battle_maps WHERE id = ?").run(kit.map().id);
  world.patch(guard.id, { conditions: [], conditionMeta: {} });
  const hpBefore = kit.enemy(enemy.id).currentHp;
  world.dice(15, 5);
  const out = await react(guard, "Opportunity attack", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(kit.enemy(enemy.id).currentHp < hpBefore);
  assert.ok(reacted(guard));
  assert.ok(!world.sheet(guard.id).conditions.includes("readied"));
});

await kit.endFight();
world.close();
finish();
