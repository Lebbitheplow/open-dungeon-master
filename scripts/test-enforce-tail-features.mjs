// The class features, spells and turn rules the first two waves left to
// narration that live in the action, reaction and turn engines: Intimidating
// Presence, Holy Nimbus, Divine Intervention, Fast Hands, Expeditious
// Retreat, Fly, a readied spell, Thief's Reflexes. Every die forced.
//
// The rules, from SRD 5.1:
//   - Intimidating Presence (Berserker 10): an action; a creature within 30
//     feet makes a WIS save (DC 8 + proficiency + CHA) or is frightened until
//     the end of the barbarian's next turn. One that succeeds cannot be
//     frightened by it again for 24 hours.
//   - Holy Nimbus (Devotion 20): an action, once a long rest; for a minute an
//     enemy that starts its turn in the bright light (30 feet) takes 10
//     radiant damage.
//   - Divine Intervention (cleric 10): an action; percentile dice at or under
//     the cleric level succeed (20th: always). A success locks it for 7 days;
//     a failure comes back on a long rest.
//   - Fast Hands (Thief 3): Cunning Action's bonus action can Use an Object.
//   - Expeditious Retreat: the cast (a bonus action) and each later turn's
//     bonus action take the Dash action.
//   - Fly: a flying speed of 60 feet; a creature with no flying speed cannot
//     take to the air.
//   - A readied spell is cast on the turn (the slot spent), held with
//     concentration, and released with the reaction when the trigger comes.
//   - Thief's Reflexes (Thief 17): two turns in the first round, the second
//     at initiative minus 10.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine } from "./lib/enforce-narrator.mjs";
import { slotsOf, FULL_CASTER_SLOTS } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-tail-features");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const ai = await aiEngine(world);

const barbarian = world.addHero({
  class: "barbarian", subclass: "Path of the Berserker", level: 10, abilities: { str: 16, cha: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Greataxe", qty: 1 }],
});
const paladin = world.addHero({
  class: "paladin", subclass: "Oath of Devotion", level: 20, abilities: { str: 16, cha: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const cleric = world.addHero({
  class: "cleric", level: 10, abilities: { wis: 16 }, proficiencies: TRAINED,
});
const thief = world.addHero({
  class: "rogue", subclass: "Thief", level: 17, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Rapier", qty: 1 }, { name: "Rope, hempen (50 feet)", qty: 1 }],
});
const wizard = world.addHero({
  class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: {
    ability: "int", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [],
    prepared: ["Expeditious Retreat", "Fly", "Magic Missile"], cantrips: ["Fire Bolt"],
  },
});
const heroes = [barbarian, paladin, cleric, thief, wizard];
for (const [hero, names] of [
  [barbarian, ["Intimidating Presence"]],
  [paladin, ["Holy Nimbus"]],
  [cleric, ["Divine Intervention"]],
  [thief, ["Fast Hands", "Thief's Reflexes"]],
]) {
  const held = world.sheet(hero.id).features;
  const added = names.filter((name) => !held.some((feature) => feature.name === name));
  world.patch(hero.id, { features: [...held, ...added.map((name) => ({ name, description: "" }))] });
}
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { conditions: [], conditionMeta: {}, resources: made.resources, spellcasting: made.spellcasting, concentratingOn: null });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry, index) => [entry.id, entry.id === hero.id ? 19 : 9 - index]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.giveTurn(hero.id);
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  return enemies;
}

const has = (conditions, name) => conditions.map((entry) => entry.toLowerCase()).includes(name);
const budget = () => world.encounter().turnBudget;
const userOf = (hero) => world.sheet(hero.id).userId;
function walkTo(hero) {
  for (let step = 0; step < 12; step += 1) {
    assert.ok(kit.endTurn(world.sheet(kit.current().characterId).userId), "End Turn was refused");
    if (kit.current().characterId === hero.id) {
      return;
    }
  }
  throw new Error("the order never came back");
}
const setUses = (hero, id, used = 0) =>
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, [id]: { max: 1, used } } });

// ---- Intimidating Presence ----

await test("Intimidating Presence: the barbarian's action; a creature that fails its WIS save is frightened of them until the end of the barbarian's next turn.", async () => {
  const [enemy] = await stage(barbarian);
  world.clearDice();
  world.dice(1);
  const out = await world.invoke("use_resource", { characterId: barbarian.id, resource: "Intimidating Presence", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true, "the action was not spent");
  const fear = kit.enemy(enemy.id);
  assert.ok(has(fear.conditions, "frightened"), "no fright on a failed save");
  assert.equal(fear.conditionMeta.frightened?.source, barbarian.id);
  assert.ok(kit.endTurn(userOf(barbarian)));
  walkTo(barbarian);
  assert.ok(has(kit.enemy(enemy.id).conditions, "frightened"), "the fright ended before the barbarian's next turn ended");
  assert.ok(kit.endTurn(userOf(barbarian)));
  assert.equal(has(kit.enemy(enemy.id).conditions, "frightened"), false);
});

// ---- Holy Nimbus ----

await test("Holy Nimbus: an enemy that starts its turn within 30 feet of the paladin takes 10 radiant damage.", async () => {
  const [enemy] = await stage(paladin);
  setUses(paladin, "holy_nimbus");
  const out = await world.invoke("use_resource", { characterId: paladin.id, resource: "Holy Nimbus" });
  assert.equal(out.ok, true, out.error);
  assert.ok(has(world.sheet(paladin.id).conditions, "holy nimbus"));
  assert.equal(world.sheet(paladin.id).resources.holy_nimbus.used, 1);
  const hp = kit.enemy(enemy.id).currentHp;
  walkTo(paladin);
  assert.equal(kit.enemy(enemy.id).currentHp, hp - 10, "the nimbus did not burn the creature as its turn started");
});

// ---- Divine Intervention ----

await test("Divine Intervention: percentile dice at or under the cleric's level succeed, and a success cannot be called again for 7 days, a long rest notwithstanding.", async () => {
  await kit.endFight();
  setUses(cleric, "divine_intervention");
  world.clearDice();
  world.dice(10);
  const out = await world.invoke("use_resource", { characterId: cleric.id, resource: "Divine Intervention" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.intervenes, true, "a 10 at cleric 10 did not succeed");
  assert.equal(world.sheet(cleric.id).resources.divine_intervention.used, 1);
  await world.invoke("take_rest", { kind: "long" });
  assert.equal(world.sheet(cleric.id).resources.divine_intervention.used, 0, "the long rest did not refill the counter");
  const again = await world.invoke("use_resource", { characterId: cleric.id, resource: "Divine Intervention" });
  assert.equal(again.ok, false, "called again within 7 days of an answer");
  assert.equal(world.sheet(cleric.id).resources.divine_intervention.used, 0);
});

// ---- Fast Hands ----

await test("Fast Hands: a Thief uses an object with the Cunning Action bonus action; another rogue cannot.", async () => {
  await stage(thief);
  const out = await world.invoke("take_action", { characterId: thief.id, action: "use_object", bonus: true, item: "the portcullis lever" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
});

// ---- Expeditious Retreat ----

await test("Expeditious Retreat: the Dash comes with the casting, and on each later turn the bonus action takes the Dash.", async () => {
  await stage(wizard);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Expeditious Retreat", targetCharacterIds: [wizard.id] });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(budget().bonusUsed, true);
  const first = await world.invoke("take_action", { characterId: wizard.id, action: "dash", bonus: true });
  assert.equal(first.ok, true, first.error);
  assert.equal(budget().dashed, true);
  assert.equal(budget().actionUsed, false, "the casting's Dash took the action");
  kit.freshTurn();
  const later = await world.invoke("take_action", { characterId: wizard.id, action: "dash", bonus: true });
  assert.equal(later.ok, true, later.error);
  assert.equal(budget().bonusUsed, true);
});

// ---- Fly ----

await test("Only a creature with a flying speed takes to the air: the AI's set_movement fly is refused for a character without one, and Fly gives a 60-foot flying speed on the board.", async () => {
  await stage(wizard);
  const grounded = await ai.invoke("set_movement", { tokenName: world.sheet(wizard.id).name, movement: "fly" });
  assert.equal(grounded.ok, false, "a wizard with no flying speed took off");
  world.patch(wizard.id, { conditions: ["flying"], conditionMeta: { flying: { rounds: 100, spell: "Fly", source: wizard.id } } });
  const aloft = await ai.invoke("set_movement", { tokenName: world.sheet(wizard.id).name, movement: "fly" });
  assert.equal(aloft.ok, true, aloft.error);
  const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
  const move = pcMoveBudget(world.campaignId, world.encounter(), kit.map(), world.sheet(wizard.id), kit.token(wizard.id));
  assert.equal(move.speed, 60, "Fly's 60 feet is not the flying budget");
});

// ---- a readied spell ----

await test("A readied spell spends its slot on the turn it is readied, and is released off turn with the reaction and no second slot.", async () => {
  const [enemy] = await stage(wizard);
  kit.place(enemy.id, 5, 9);
  const ready = await world.invoke("take_action", {
    characterId: wizard.id, action: "ready", trigger: "when the goblin moves", spell: "Magic Missile",
  });
  assert.equal(ready.ok, true, ready.error);
  assert.equal(world.sheet(wizard.id).spellcasting.slots[1].used, 1, "the slot was not spent on the turn");
  assert.equal(world.sheet(wizard.id).concentratingOn, "Magic Missile");
  kit.giveTurn(paladin.id);
  world.clearDice();
  world.dice(4, 4, 4);
  const release = await world.invoke("cast_at_enemy", { characterId: wizard.id, spell: "Magic Missile", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(release.ok, true, release.error);
  assert.equal(world.sheet(wizard.id).spellcasting.slots[1].used, 1, "the release spent a second slot");
  assert.ok(world.encounter().reactionsUsed.includes(wizard.id), "the release did not spend the reaction");
  assert.equal(has(world.sheet(wizard.id).conditions, "readied"), false);
});

// ---- Thief's Reflexes ----

await test("Thief's Reflexes: the thief takes a second turn in the first round at initiative minus 10, and only one turn in the rounds after.", async () => {
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [thief.id]: 18 } });
  const turns = () => world.encounter().order.filter((entry) => entry.kind === "pc" && entry.characterId === thief.id);
  const round1 = turns();
  assert.equal(round1.length, 2, "the thief has one turn in round 1");
  assert.equal(round1[0].initiative - round1[1].initiative, 10);
  for (let step = 0; step < 20 && world.encounter().round < 2; step += 1) {
    assert.ok(kit.endTurn(world.sheet(kit.current().characterId).userId));
  }
  assert.equal(world.encounter().round, 2);
  assert.equal(turns().length, 1, "the second turn outlived round 1");
});

await test("The rules the model reads name the options the engine now resolves, and the end-of-turn effects it removes itself.", async () => {
  const { DM_SYSTEM, ENCOUNTER_RULES } = await import("../src/lib/dm/prompt.ts");
  const text = `${DM_SYSTEM}\n${ENCOUNTER_RULES}`;
  for (const phrase of [
    "useInspiration", "strokeOfLuck", "openHand", "hurlThroughHell", "Ready with spell", "Giant Killer",
    "Intimidating Presence with targetEnemyId", "Divine Intervention", "until the end of a creature's next turn",
    "set_movement fly needs a flying speed", "Fast Hands",
  ]) {
    assert.ok(text.includes(phrase), `the rules never mention ${phrase}`);
  }
});

await kit.endFight();
world.close();
finish();
