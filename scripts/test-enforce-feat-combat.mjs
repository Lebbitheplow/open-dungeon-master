// The combat feats at the table (issue #125, src/lib/srd/feat-combat.ts):
// Great Weapon Master's and Sharpshooter's -5/+10 through pc_attack's
// powerAttack, Great Weapon Master's bonus-action attack after a critical
// hit, Gunner shooting with a foe at the elbow, Elemental Adept's floored
// dice through a resistant creature, Defensive Duelist's reaction turning a
// hit into a miss, Mage Slayer's reaction attack, and Dungeon Delver's traps
// and passive notice.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-feat-combat");
const world = await openWorld({ campaign: { maxPlayers: 12 } });
const kit = await combatKit(world);
const encounters = await import("../src/lib/db/encounters.ts");

// Puts the initiative pointer on the enemy: what a character does now is a
// reaction, not their action.
function enemyTurn(enemy) {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => encounters.orderEntryId(entry) === enemy.id);
  assert.ok(place >= 0, "the enemy is in the order");
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null });
}

const greatWeapon = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }, { name: "Longsword", qty: 1 }],
  feats: ["Great Weapon Master"],
});
const plain = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const sharpshooter = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 10, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1 }],
  feats: ["Sharpshooter"],
});
const gunner = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 10, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1 }],
  feats: ["Gunner"],
});
const adept = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
  feats: ["Elemental Adept"],
  // The pick as the judge writes it to the sheet (see test-enforce-feats).
  features: [{ name: "Elemental Adept: fire", source: "story" }],
});
const evoker = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});
const duelist = world.addHero({
  class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Rapier", qty: 1, equipped: true }],
  feats: ["Defensive Duelist"],
});
const slayer = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  feats: ["Mage Slayer"],
});
const heroes = [greatWeapon, plain, sharpshooter, gunner, adept, evoker, duelist, slayer];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

async function stage(hero, { count = 1, apart = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { features: made.features, equipment: made.equipment, resources: made.resources, feats: made.feats, currentHp: made.maxHp, conditions: [] });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 5 + apart);
  assert.equal(kit.current().characterId, hero.id);
  return enemies;
}

const PB = proficiencyBonus(5);
const hp = (hero) => world.sheet(hero.id).currentHp;
const enemyHp = (enemy) => world.enemies().find((entry) => entry.id === enemy.id).currentHp;

await test("Great Weapon Master's -5/+10 rides a heavy melee weapon; a plain fighter and a longsword are refused", async () => {
  const [enemy] = await stage(greatWeapon);
  const swing = await kit.swing(greatWeapon.id, enemy.id, [15, 3, 3], { weapon: "Greatsword", powerAttack: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.total, 15 + abilityMod(16) + PB - 5, "to hit less 5");
  assert.equal(swing.result.hit, true, JSON.stringify(swing.result));
  assert.equal(swing.damage.total, 3 + 3 + abilityMod(16) + 10, "damage plus 10");
  const light = await kit.swing(greatWeapon.id, enemy.id, [10, 3], { weapon: "Longsword", powerAttack: true });
  assert.equal(light.ok, false, "a longsword is not heavy");
  assert.match(light.error ?? "", /heavy melee weapon/);
  const [other] = await stage(plain);
  const none = await kit.swing(plain.id, other.id, [10, 3, 3], { weapon: "Greatsword", powerAttack: true });
  assert.equal(none.ok, false, "no feat, no trade");
  assert.match(none.error ?? "", /neither/);
});

await test("a melee critical hit opens Great Weapon Master's bonus-action attack; without one it is refused", async () => {
  const [enemy] = await stage(greatWeapon);
  const early = await kit.swing(greatWeapon.id, enemy.id, [10, 3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(early.ok, false, "a bonus attack before any crit or kill");
  assert.match(early.error ?? "", /critical hit or a kill/);
  const crit = await kit.swing(greatWeapon.id, enemy.id, [20, 3, 3, 3, 3], { weapon: "Greatsword" });
  assert.equal(crit.ok, true, crit.error);
  assert.equal(crit.result.crit, true);
  assert.ok((crit.result.conditionEffects ?? []).some((note) => /Great Weapon Master/.test(note)), JSON.stringify(crit.result.conditionEffects));
  const bonus = await kit.swing(greatWeapon.id, enemy.id, [10, 3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("Sharpshooter's -5/+10 rides a ranged weapon; Gunner shoots with a foe at the elbow at no disadvantage", async () => {
  const [enemy] = await stage(sharpshooter, { apart: 3 });
  const shot = await kit.swing(sharpshooter.id, enemy.id, [15, 4], { weapon: "Longbow", powerAttack: true });
  assert.equal(shot.ok, true, shot.error);
  assert.equal(shot.toHit.total, 15 + abilityMod(16) + PB - 5);
  assert.equal(shot.result.hit, true, JSON.stringify(shot.result));
  assert.equal(shot.damage.total, 4 + abilityMod(16) + 10);
  // A hostile creature within 5 feet: disadvantage for most, not for Gunner.
  const [near] = await stage(plain, { apart: 1 });
  const crowded = await kit.swing(plain.id, near.id, [10, 10, 4], { weapon: "Longbow" });
  assert.equal(crowded.ok, true, crowded.error);
  assert.equal(d20Faces(crowded.toHit).length, 2, "two d20s: disadvantage at the elbow");
  const [beside] = await stage(gunner, { apart: 1 });
  const free = await kit.swing(gunner.id, beside.id, [10, 4], { weapon: "Longbow" });
  assert.equal(free.ok, true, free.error);
  assert.equal(d20Faces(free.toHit).length, 1, "Gunner: one d20 with a foe at the elbow");
});

await test("Elemental Adept: a fire bolt's 1s count as 2 and the creature's fire resistance is ignored; another caster's is halved", async () => {
  const [enemy] = await stage(adept, { apart: 3 });
  kit.setEnemy(enemy.id, { stats: { resist: "fire" } });
  const before = enemyHp(enemy);
  const bolt = await kit.swing(adept.id, enemy.id, [15, 1, 1], { spell: "Fire Bolt", damage: "2d10", damageType: "fire" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(bolt.result.hit, true);
  assert.equal(bolt.damage.total, 4, "two 1s floored to 2 each");
  assert.equal(before - enemyHp(enemy), 4, "resistance ignored");
  const [other] = await stage(evoker, { apart: 3 });
  kit.setEnemy(other.id, { stats: { resist: "fire" } });
  const start = enemyHp(other);
  const plainBolt = await kit.swing(evoker.id, other.id, [15, 1, 1], { spell: "Fire Bolt", damage: "2d10", damageType: "fire" });
  assert.equal(plainBolt.ok, true, plainBolt.error);
  assert.equal(plainBolt.damage.total, 2);
  assert.equal(start - enemyHp(other), 1, "halved by resistance");
});

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
const react = (hero, feature, args = {}) => world.invoke("use_reaction", { characterId: hero.id, feature, ...args });

await test("Defensive Duelist adds the proficiency bonus to AC against the melee hit it answers", async () => {
  const [enemy] = await stage(duelist);
  // AC 13 (no armor, DEX 16); the goblin's +4: 10 + 4 = 14 hits for 3 + 2.
  const hit = await enemyHits(enemy, duelist, [10, 3]);
  assert.equal(hit.hit, true, JSON.stringify(hit));
  assert.equal(hp(duelist), 25);
  const out = await react(duelist, "Defensive Duelist");
  assert.equal(out.ok, true, out.error);
  assert.match(String(out.result.applied), /now misses/);
  assert.equal(hp(duelist), 30, "the hit the higher AC turned away deals nothing");
  assert.ok(world.encounter().reactionsUsed.includes(duelist.id), "the reaction is spent");
  // A hit that still meets AC 16 stands.
  const [again] = await stage(duelist);
  await enemyHits(again, duelist, [15, 3]);
  const stands = await react(duelist, "Defensive Duelist");
  assert.equal(stands.ok, true, stands.error);
  assert.equal(hp(duelist), 25);
  // Without the feat, or without a finesse weapon in hand, nothing happens.
  const [third] = await stage(slayer);
  await enemyHits(third, slayer, [10, 3]);
  const none = await react(slayer, "Defensive Duelist");
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /takes the feat and a finesse weapon/);
});

await test("Mage Slayer's reaction is one melee weapon attack on a caster within 5 feet; nobody else has it", async () => {
  const [enemy] = await stage(slayer);
  // On the caster's turn, not the fighter's: a reaction.
  enemyTurn(enemy);
  const out = await react(slayer, "Mage Slayer", { targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.reaction, "Mage Slayer");
  assert.ok(world.encounter().reactionsUsed.includes(slayer.id), "the reaction is spent");
  const [far] = await stage(slayer, { apart: 3 });
  enemyTurn(far);
  const away = await react(slayer, "Mage Slayer", { targetEnemyId: far.id });
  assert.equal(away.ok, false, "a caster 15 ft away");
  assert.match(away.error ?? "", /within 5 feet/);
  const [other] = await stage(plain);
  enemyTurn(other);
  const none = await react(plain, "Mage Slayer", { targetEnemyId: other.id });
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /has no Mage Slayer/);
});

await test("Dungeon Delver saves against a trap at advantage and takes half its damage, and notices a trap at +5 passive", async () => {
  await kit.endFight();
  const delver = world.addHero({
    class: "fighter", level: 5, maxHp: 200, abilities: { str: 16, dex: 14, con: 14, wis: 10 }, proficiencies: TRAINED,
    feats: ["Dungeon Delver"],
  });
  const careless = world.addHero({
    class: "fighter", level: 5, maxHp: 200, abilities: { str: 16, dex: 14, con: 14, wis: 10 }, proficiencies: TRAINED,
  });
  // A dangerous trap at level 5 rolls 4d10; a failed save takes it all.
  world.diceLog();
  world.dice(1, 5, 5, 5, 5);
  const plainTrap = await world.invoke("apply_hazard", { type: "trap", characterIds: [careless.id], severity: "dangerous", dc: 30 });
  world.clearDice();
  assert.equal(plainTrap.ok, true, plainTrap.error);
  assert.equal(plainTrap.result.results[0].saved, false);
  assert.equal(200 - hp(careless), 20);
  // Advantage: two d20 faces are read; the 1 and the 2 both fail DC 30, and
  // the damage is halved by the feat's resistance.
  world.diceLog();
  world.dice(1, 2, 5, 5, 5, 5);
  const warded = await world.invoke("apply_hazard", { type: "trap", characterIds: [delver.id], severity: "dangerous", dc: 30 });
  world.clearDice();
  assert.equal(warded.ok, true, warded.error);
  assert.equal(warded.result.results[0].saved, false);
  assert.equal(warded.result.results[0].featAdvantage, "Dungeon Delver: a trap");
  assert.equal(200 - hp(delver), 10, "trap damage halved");
  assert.equal(d20Faces(kit.lastRolls(8).find((roll) => roll.kind === "saving_throw" && roll.characterId === delver.id)).length, 2, "the save rolled two d20s");
  // Passive Perception 10 + 0: a DC 13 trap is missed without the feat and
  // noticed with it.
  const missed = await world.invoke("check_notice", { sense: "perception", dc: 13, characterIds: [careless.id], reason: "a pressure plate trap under the rug" });
  assert.equal(missed.ok, true, missed.error);
  assert.deepEqual(missed.result.noticedBy, []);
  const found = await world.invoke("check_notice", { sense: "perception", dc: 13, characterIds: [delver.id], reason: "a pressure plate trap under the rug" });
  assert.equal(found.ok, true, found.error);
  assert.deepEqual(found.result.noticedBy, [world.sheet(delver.id).name]);
  const ambush = await world.invoke("check_notice", { sense: "perception", dc: 13, characterIds: [delver.id], reason: "an archer in the rafters" });
  assert.deepEqual(ambush.result.noticedBy, [], "the feat is about traps and secret doors only");
});

world.close();
finish();
