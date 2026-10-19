// What each option of a pool costs of the turn, and the Battle Master's
// maneuvers taken where their text says (issue 233, section 2):
//
//   - Font of Magic: either conversion is a bonus action.
//   - Channel Divinity: each option its own cost (Vow of Enmity a bonus
//     action, Abjure Enemy an action, Artisan's Blessing no fight at all), and
//     a call in a fight names the option.
//   - Psionic Energy: Telekinetic Movement is an action.
//   - Maneuvers: Parry, Riposte and Brace are reactions, Rally and
//     Commander's Strike bonus actions, Feinting Attack and Quick Toss take
//     the bonus action with the swing, and Grappling Strike's die waits for
//     the grapple.
//   - The Hand deals each option as its own card at its own cost.
//
// Dice forced; every check reads a sheet, the turn budget or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-option-costs");
const world = await openWorld();
const kit = await combatKit(world);
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { optionCost } = await import("../src/lib/dm/option-costs.ts");

const LONGSWORD = [{ name: "Longsword", qty: 1, equipped: true }];
const fighter = world.addHero({
  class: "fighter", subclass: "Battle Master", level: 15, maxHp: 44, abilities: { str: 16, dex: 14, cha: 14 }, proficiencies: TRAINED,
  equipment: [...LONGSWORD, { name: "Handaxe", qty: 2, equipped: false }],
  features: ["Parry", "Riposte", "Rally", "Commander's Strike", "Feinting Attack", "Grappling Strike", "Trip Attack", "Quick Toss"].map((name) => ({ name: `Maneuver: ${name}`, source: "choice" })),
});
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED, equipment: LONGSWORD });
const sorcerer = world.addHero({
  class: "sorcerer", level: 5, maxHp: 30, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 2 } }, prepared: [], known: [], cantrips: [] },
});
const paladin = world.addHero({
  class: "paladin", subclass: "Oath of Vengeance", level: 5, maxHp: 44, abilities: { str: 16, cha: 14 }, proficiencies: TRAINED,
  equipment: LONGSWORD,
  features: [{ name: "Channel Divinity: Vow of Enmity", classId: "paladin" }, { name: "Channel Divinity: Abjure Enemy", classId: "paladin" }],
});
const forge = world.addHero({
  class: "cleric", subclass: "Forge Domain", level: 2, maxHp: 18, abilities: { wis: 16 }, proficiencies: TRAINED,
  features: [{ name: "Channel Divinity: Artisan's Blessing", classId: "cleric" }],
});
const psi = world.addHero({
  class: "fighter", subclass: "Psi Warrior", level: 3, maxHp: 28, abilities: { str: 16, int: 14 }, proficiencies: TRAINED,
  equipment: LONGSWORD,
  features: [{ name: "Telekinetic Movement", classId: "fighter" }, { name: "Psionic Strike", classId: "fighter" }],
});

const POOLS = {
  [fighter.id]: { sub_superiority_dice: { max: 4, used: 0 } },
  [sorcerer.id]: { sorcery_points: { max: 5, used: 0 } },
  [paladin.id]: { channel_divinity: { max: 1, used: 0 } },
  [forge.id]: { channel_divinity: { max: 1, used: 0 } },
  [psi.id]: { sub_psionic_energy: { max: 4, used: 0 } },
};

async function stage(first) {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of [fighter, ally, sorcerer, paladin, forge, psi]) {
    world.patch(hero.id, { currentHp: world.sheet(hero.id).maxHp, tempHp: 0, conditions: [], conditionMeta: {}, ac: 12, acOverride: true, resources: POOLS[hero.id] ?? {} });
  }
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200, ac: 10 });
  kit.place(fighter.id, 5, 5);
  kit.place(ally.id, 5, 6);
  kit.place(enemy.id, 6, 5);
  if (first) kit.giveTurn(first.id);
  return enemy;
}

const budget = () => world.encounter().turnBudget ?? {};
const spend = (hero, resource, extra = {}) => world.invoke("use_resource", { characterId: hero.id, resource, ...extra });
const dice = (hero) => world.sheet(hero.id).resources.sub_superiority_dice?.used ?? 0;

// ---- the pools ----

await test("A Font of Magic conversion in a fight is the sorcerer's bonus action.", async () => {
  await stage(sorcerer);
  const out = await spend(sorcerer, "Sorcery Points", { variant: "create slot", amount: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
  const again = await spend(sorcerer, "Sorcery Points", { variant: "convert slot", amount: 1 });
  assert.equal(again.ok, false, "a second bonus action went through");
});

await test("Channel Divinity in a fight names its option, and each option costs its own.", async () => {
  await stage(paladin);
  const nameless = await spend(paladin, "Channel Divinity");
  assert.equal(nameless.ok, false);
  assert.match(nameless.error, /Vow of Enmity \(bonus action\)/);
  assert.match(nameless.error, /Abjure Enemy \(action\)/);
  assert.equal(world.sheet(paladin.id).resources.channel_divinity.used, 0);
  const vow = await spend(paladin, "Channel Divinity", { variant: "Vow of Enmity" });
  assert.equal(vow.ok, true, vow.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
});

await test("Artisan's Blessing is an hour's ritual: refused in a fight, and nothing is spent.", async () => {
  await stage(forge);
  const out = await spend(forge, "Channel Divinity", { variant: "Artisan's Blessing" });
  assert.equal(out.ok, false);
  assert.match(out.error, /ritual/);
  assert.equal(world.sheet(forge.id).resources.channel_divinity.used, 0);
});

await test("The cost table reads the option from the variant or the resource's own name.", () => {
  assert.deepEqual(optionCost("channel_divinity", "Channel Divinity: War God's Blessing", true), { option: "war god's blessing", cost: "reaction" });
  assert.deepEqual(optionCost("channel_divinity", "guided strike", true), { option: "guided strike", cost: "none" });
  assert.deepEqual(optionCost("channel_divinity", "champion challenge", true), { option: "champion challenge", cost: "bonus" });
  assert.equal(optionCost("channel_divinity", "something new", true), null);
});

await test("Telekinetic Movement is the Psi Warrior's action.", async () => {
  await stage(psi);
  const out = await spend(psi, "Psionic Energy", { variant: "telekinetic movement" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
});

// ---- the maneuvers ----

await test("A reaction or bonus-action maneuver named on a swing is refused, and nothing is spent.", async () => {
  const enemy = await stage(fighter);
  for (const maneuver of ["Parry", "Rally", "Commander's Strike"]) {
    const out = await kit.swing(fighter.id, enemy.id, [15, 4, 4], { maneuver });
    assert.equal(out.ok, false, `${maneuver} rode the swing`);
  }
  assert.equal(dice(fighter), 0);
  assert.equal(budget().attacksMade ?? 0, 0);
});

await test("Feinting Attack is the bonus action, gives the swing advantage, and wants the target within 5 feet.", async () => {
  const enemy = await stage(fighter);
  const out = await kit.swing(fighter.id, enemy.id, [3, 15, 4, 4], { maneuver: "Feinting Attack" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.toHit.expression.startsWith("2d20kh1"), true, out.toHit.expression);
  assert.equal(budget().bonusUsed, true);
  assert.equal(dice(fighter), 1);
  const second = await stage(fighter);
  kit.place(second.id, 9, 9);
  const far = await kit.swing(fighter.id, second.id, [15, 4], { maneuver: "Feinting Attack" });
  assert.equal(far.ok, false);
  assert.equal(budget().bonusUsed ?? false, false);
});

await test("Quick Toss is a thrown weapon's attack, as the bonus action.", async () => {
  const enemy = await stage(fighter);
  const sword = await kit.swing(fighter.id, enemy.id, [15, 4, 4], { maneuver: "Quick Toss" });
  assert.equal(sword.ok, false, "a longsword swing was a Quick Toss");
  kit.place(enemy.id, 8, 5);
  const toss = await kit.swing(fighter.id, enemy.id, [15, 4, 4], { maneuver: "Quick Toss", weapon: "Handaxe" });
  assert.equal(toss.ok, true, toss.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().attacksMade ?? 0, 0, "Quick Toss spent an attack of the Attack action");
});

await test("Grappling Strike saves the die for the grapple, which follows as the bonus action with the die on the check.", async () => {
  const enemy = await stage(fighter);
  const hit = await kit.swing(fighter.id, enemy.id, [15, 4], { maneuver: "Grappling Strike" });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(dice(fighter), 0, "the die was spent on the hit");
  assert.ok(world.sheet(fighter.id).conditions.some((entry) => entry.startsWith("grappling strike (")));
  world.dice(10, 5, 1, 1);
  const grapple = await world.invoke("take_action", { characterId: fighter.id, action: "grapple", bonus: true, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(grapple.ok, true, grapple.error);
  assert.match(String(grapple.result.superiorityDie), /Grappling Strike: \+5/, JSON.stringify(grapple));
  assert.equal(dice(fighter), 1);
  assert.equal(budget().bonusUsed, true);
});

await test("Parry takes the die plus Dexterity off a melee hit, with the reaction and a die.", async () => {
  const enemy = await stage(ally);
  await world.hitBy(fighter.id, { enemyId: enemy.id, raw: 12, total: 18, vsAc: 12 });
  world.patch(fighter.id, { currentHp: 32 });
  const { freshLastHit, writeLastHit } = await import("../src/lib/dm/last-hit.ts");
  writeLastHit(world.campaignId, { ...freshLastHit(world.campaignId, fighter.id), after: { currentHp: 32, tempHp: 0, beastHp: null } });
  world.dice(6);
  const out = await world.invoke("use_reaction", { characterId: fighter.id, feature: "Parry" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // 6 + Dex 2 = 8 of the 12 back (a d10 at fighter 15).
  assert.equal(world.sheet(fighter.id).currentHp, 40);
  assert.equal(dice(fighter), 1);
  assert.ok(world.encounter().reactionsUsed.includes(fighter.id));
});

await test("Riposte answers a melee miss with an attack, the die on its hit.", async () => {
  const enemy = await stage(ally);
  const before = kit.enemy(enemy.id).currentHp;
  await world.hitBy(fighter.id, { enemyId: enemy.id, raw: 0, total: 5, vsAc: 12 });
  world.dice(15, 4, 5);
  const out = await world.invoke("use_reaction", { characterId: fighter.id, feature: "Riposte" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(dice(fighter), 1);
  assert.ok(world.encounter().reactionsUsed.includes(fighter.id));
  // Longsword 4 + Str 3 + the die's 5.
  assert.equal(before - kit.enemy(enemy.id).currentHp, 12);
  assert.equal(world.sheet(fighter.id).conditions.some((entry) => entry.startsWith("superiority strike")), false);
});

await test("Rally is the bonus action: the die plus Charisma in temporary hit points for a companion.", async () => {
  await stage(fighter);
  world.dice(5);
  const out = await spend(fighter, "Superiority Dice", { variant: "rally", targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).tempHp, 7);
  assert.equal(budget().bonusUsed, true);
  assert.equal(dice(fighter), 1);
});

await test("Commander's Strike forgoes an attack and the bonus action; the companion strikes with its reaction and the die.", async () => {
  const enemy = await stage(fighter);
  const out = await spend(fighter, "Superiority Dice", { variant: "commander's strike", targetCharacterId: ally.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().attacksMade, 1);
  assert.equal(budget().bonusUsed, true);
  assert.equal(dice(fighter), 1);
  assert.ok(world.sheet(ally.id).conditions.includes("commander's strike"));
  const before = kit.enemy(enemy.id).currentHp;
  world.dice(15, 4, 6);
  const strike = await world.invoke("use_reaction", { characterId: ally.id, feature: "Commander's Strike", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(strike.ok, true, strike.error);
  assert.ok(world.encounter().reactionsUsed.includes(ally.id));
  assert.equal(before - kit.enemy(enemy.id).currentHp, 13, "longsword 4 + Str 3 + the die's 6");
  assert.equal(world.sheet(ally.id).conditions.includes("commander's strike"), false);
});

// ---- the Hand ----

const TURN = { myTurn: true, actionUsed: false, bonusUsed: false, reactionUsed: false, attacksMade: 0 };

await test("The Hand deals each Channel Divinity option at its own cost, and no nameless card.", async () => {
  await stage();
  const hand = deriveHand(world.sheet(paladin.id), TURN);
  const vow = hand.find((card) => card.id === "option:channel_divinity:vow-of-enmity");
  const abjure = hand.find((card) => card.id === "option:channel_divinity:abjure-enemy");
  assert.equal(vow?.cost, "bonus");
  assert.equal(abjure?.cost, "action");
  assert.equal(vow?.intent.variant, "vow of enmity");
  assert.equal(hand.some((card) => card.id === "feature:channel_divinity"), false);
});

await test("The Hand deals swing maneuvers as riders, Rally and Commander's Strike as bonus actions, Parry as a reaction to a melee hit.", async () => {
  await stage();
  const hand = deriveHand(world.sheet(fighter.id), TURN);
  const riders = hand.filter((card) => card.intent.card === "rider").map((card) => card.name);
  assert.ok(riders.includes("Trip Attack") && riders.includes("Feinting Attack"), riders.join(", "));
  for (const name of ["Parry", "Riposte", "Rally", "Commander's Strike"]) {
    assert.equal(riders.includes(name), false, `${name} dealt as a rider`);
  }
  assert.equal(hand.find((card) => card.name === "Rally")?.cost, "bonus");
  const hits = [{ characterId: fighter.id, attacker: "Goblin", attackerId: "e1", attack: "Scimitar", type: "slashing", ranged: false, source: "attack", hit: true, damage: 6, answered: [] }];
  const reactions = reactionCards(world.sheet(fighter.id), { ...TURN, myTurn: false }, hits, []);
  assert.ok(reactions.some((card) => card.name === "Parry"), reactions.map((card) => card.name).join(", "));
});

world.close();
finish();
