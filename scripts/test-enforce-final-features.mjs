// The 181-unit features recount of the final round (FIXBRIEF.md, wave 3,
// "final-engine"): the SRD class, subclass and racial features the recount
// still found open that have an engine hook. Each rule was first written as
// a gap() and recorded against the tree (/tmp/odm-enf2/fixes/final-engine/).
//
//   Retaliation (Berserker 14): when a creature within 5 feet damages the
//     barbarian, a reaction makes one melee weapon attack against it.
//   Stand Against the Tide (Hunter 15): a hostile creature that misses the
//     ranger with a melee attack repeats it against another creature.
//   Whirlwind Attack / Volley (Hunter 11): the action makes one attack
//     against each creature within 5 feet (a melee weapon) or within 10 feet
//     of a point (a ranged weapon).
//   Peerless Skill (Lore 14): a Bardic Inspiration die on the bard's own
//     ability check.
//   Quivering Palm (Open Hand 17): 3 ki on an unarmed hit set the
//     vibrations; the action ends them: a CON save or 0 hit points, 10d10
//     necrotic on a success.
//   Tranquility (Open Hand 11): after a long rest, Sanctuary until the next
//     one (DC 8 + WIS + proficiency).
//   Draconic Presence (Draconic 18): 5 sorcery points, the action: creatures
//     within 60 feet save (WIS) or are charmed or frightened for a minute.
//   Hide in Plain Sight (ranger 10): camouflaged, +10 to Stealth checks.
//   Supreme Sneak (Thief 9): advantage on Stealth after moving no more than
//     half their speed that turn.
//   Nature's Sanctuary (Land 14): a beast or plant attacking the druid saves
//     (WIS) first or must choose another target.
//   Favored Enemy, Natural Explorer (ranger 1); Stonecunning (dwarf),
//     Artificer's Lore (rock gnome), Stone Camouflage (deep gnome): the check
//     riders keyed to what the check is about.
//   Primeval Awareness (ranger 3): a spell slot spent.
//   Dragon Wings (Draconic 14): a flying speed equal to the walking speed.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, proficiencyBonus } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-final-features");
const world = await openWorld({ campaign: { maxPlayers: 40 } });
const kit = await combatKit(world);
const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");

const hero = (overrides) =>
  world.addHero({ maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, ...overrides });
// createSheet writes the class's own features; a pick or a trait a test
// needs is added after.
const withFeatures = (who, ...names) =>
  world.patch(who.id, { features: [...world.sheet(who.id).features, ...names.map((name) => ({ name, description: "" }))] });
const newRolls = (before) => kit.lastRolls(80).filter((roll) => !before.has(roll.id));
const snapshot = () => new Set(kit.lastRolls(80).map((roll) => roll.id));
const diceOf = (roll, sides) =>
  (roll?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.dice.length, 0);
const spend = (who, resource, args = {}) => world.invoke("use_resource", { characterId: who.id, resource, ...args });
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });

async function stage(first, { enemies = 1, hp: enemyHp = 300, stats = {} } = {}) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(world.sheets().map((entry) => [entry.id, entry.id === first.id ? 19 : 3]));
  await kit.fight(enemies, { heroFaces });
  const list = world.enemies();
  for (const enemy of list) {
    kit.setEnemy(enemy.id, { maxHp: enemyHp, stats });
  }
  kit.place(first.id, 5, 5);
  kit.place(list[0].id, 5, 6);
  kit.giveTurn(first.id);
  return world.enemies();
}

async function enemyAttacks(enemy, target, faces) {
  kit.freshRound();
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  return out;
}

// One roll of a check with a forced face, and the roll it stored.
async function check(who, args, faces = [10]) {
  const before = snapshot();
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("request_roll", { characterId: who.id, dc: 10, ...args });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return newRolls(before).find((roll) => roll.characterId === who.id) ?? null;
}

// ---- reactions ----

const berserker = hero({ class: "barbarian", subclass: "Path of the Berserker", level: 14, abilities: { str: 16 }, equipment: [{ name: "Greataxe", qty: 1 }] });

await test("Retaliation: when a creature within 5 feet damages the Berserker, their reaction makes one melee weapon attack against it; with no such damage there is nothing to answer.", async () => {
  const [enemy] = await stage(berserker);
  const early = await react(berserker, "Retaliation", { targetEnemyId: enemy.id });
  assert.equal(early.ok, false, "nothing damaged the barbarian");
  world.patch(berserker.id, { ac: 10, acOverride: true });
  const hit = await enemyAttacks(enemy, berserker, [18, 4]);
  assert.equal(hit.ok, true, hit.error);
  const before = snapshot();
  world.dice(15, 6);
  const out = await react(berserker, "Retaliation", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(newRolls(before).some((roll) => roll.kind === "attack" && roll.characterId === berserker.id), "no attack roll");
  assert.ok(world.encounter().reactionsUsed.includes(berserker.id), "the reaction is spent");
});

const hunter15 = hero({ class: "ranger", subclass: "Hunter", level: 15, abilities: { dex: 16 }, equipment: [{ name: "Shortsword", qty: 1 }] });
withFeatures(hunter15, "Superior Hunter's Defense: Stand Against the Tide");

await test("Stand Against the Tide: when a hostile creature misses the Hunter with a melee attack, their reaction makes it repeat the attack against another creature they choose.", async () => {
  const [attacker, other] = await stage(hunter15, { enemies: 2 });
  kit.place(other.id, 4, 5);
  kit.setEnemy(other.id, { ac: 5 });
  world.patch(hunter15.id, { ac: 30, acOverride: true });
  const miss = await enemyAttacks(attacker, hunter15, [2]);
  assert.equal(miss.ok, true, miss.error);
  const hp = kit.enemy(other.id).currentHp;
  world.dice(18, 5);
  const out = await react(hunter15, "Stand Against the Tide", { targetEnemyId: other.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(kit.enemy(other.id).currentHp < hp, "the repeated attack did not land on the other creature");
});

// ---- the Hunter's Multiattack ----

const hunter11 = hero({ class: "ranger", subclass: "Hunter", level: 11, abilities: { str: 16, dex: 16 }, equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }] });
withFeatures(hunter11, "Multiattack: Whirlwind Attack");

await test("Whirlwind Attack: the action makes one melee weapon attack against each creature within 5 feet, whatever Extra Attack allows; the same creature twice is refused.", async () => {
  const list = await stage(hunter11, { enemies: 3 });
  kit.place(list[1].id, 4, 6);
  kit.place(list[2].id, 6, 6);
  for (const enemy of list) {
    const out = await kit.swing(hunter11.id, enemy.id, [15, 4], { weapon: "Longsword", whirlwind: true });
    assert.equal(out.ok, true, `${enemy.displayName}: ${out.error}`);
  }
  const again = await kit.swing(hunter11.id, list[0].id, [15, 4], { weapon: "Longsword", whirlwind: true });
  assert.equal(again.ok, false, "one attack a creature");
});

// ---- Peerless Skill ----

const lore = hero({ class: "bard", subclass: "College of Lore", level: 14, abilities: { cha: 16 } });

await test("Peerless Skill: the Lore bard spends a Bardic Inspiration use and adds the die to their own next ability check.", async () => {
  await kit.endFight();
  const pool = world.sheet(lore.id).resources.bardic_inspiration;
  const out = await spend(lore, "Peerless Skill");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(lore.id).resources.bardic_inspiration.used, pool.used + 1);
  const roll = await check(lore, { kind: "skill_check", skill: "persuasion", reason: "the guard" }, [10, 5]);
  assert.equal(diceOf(roll, 10), 1, "the d10 on the check");
});

// ---- Quivering Palm, Tranquility ----

const openHand = hero({ class: "monk", subclass: "Way of the Open Hand", level: 17, abilities: { dex: 16, wis: 16 } });

await test("Quivering Palm: 3 ki after an unarmed hit set the vibrations; the monk's action ends them: a failed CON save drops the creature to 0 hit points.", async () => {
  const [enemy] = await stage(openHand);
  const hit = await kit.swing(openHand.id, enemy.id, [18, 4], { weapon: "unarmed strike" });
  assert.equal(hit.result.hit, true, hit.error);
  const ki = world.sheet(openHand.id).resources.ki.used;
  const set = await spend(openHand, "Quivering Palm", { targetEnemyId: enemy.id });
  assert.equal(set.ok, true, set.error);
  assert.equal(world.sheet(openHand.id).resources.ki.used, ki + 3, "3 ki");
  kit.freshTurn();
  world.dice(1);
  const end = await spend(openHand, "Quivering Palm", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(end.ok, true, end.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 0, "the failed save drops it to 0");
});

const tranquil = hero({ class: "monk", subclass: "Way of the Open Hand", level: 11, abilities: { dex: 16, wis: 16 } });

await test("Tranquility: after a long rest the Open Hand monk is under Sanctuary until the next (DC 8 + WIS + proficiency): an attacker failing the WIS save cannot attack them.", async () => {
  await kit.endFight();
  const rest = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  assert.ok(world.sheet(tranquil.id).conditions.includes("sanctuary"), "no Sanctuary after the long rest");
  const [enemy] = await stage(tranquil);
  world.patch(tranquil.id, { conditions: ["sanctuary"], conditionMeta: { sanctuary: { source: tranquil.id } } });
  const out = await enemyAttacks(enemy, tranquil, [1, 18, 5]);
  assert.equal(out.ok, false, "the failed save leaves the attack refused");
  assert.match(out.error, /DC 15/, "DC 8 + WIS 3 + proficiency 4 (the monk's, not the default 13)");
});

// ---- Draconic Presence, Dragon Wings ----

const dragon = hero({ class: "sorcerer", subclass: "Draconic Bloodline", level: 18, abilities: { cha: 18 } });

await test("Draconic Presence: 5 sorcery points and the action: each creature of the sorcerer's choice within 60 feet makes a WIS save or is frightened (or charmed) for a minute.", async () => {
  const [enemy] = await stage(dragon);
  const points = world.sheet(dragon.id).resources.sorcery_points.used;
  world.dice(1);
  const out = await spend(dragon, "Draconic Presence", { variant: "fear", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(dragon.id).resources.sorcery_points.used, points + 5);
  assert.ok(kit.enemy(enemy.id).conditions.includes("frightened"));
});

await test("Dragon Wings: a Draconic sorcerer's wings give a flying speed equal to the walking speed.", () => {
  assert.equal(flyingSpeedOf({ features: [{ name: "Dragon Wings" }], walkingFeet: 30 }), 30);
});

// ---- the ranger's and the rogue's stealth ----

const ranger10 = hero({ class: "ranger", level: 10, abilities: { dex: 16, wis: 14 } });

await test("Hide in Plain Sight: the ranger camouflages and adds 10 to Dexterity (Stealth) checks while it lasts.", async () => {
  await kit.endFight();
  const plain = await check(ranger10, { kind: "skill_check", skill: "stealth", reason: "sneak" });
  const out = await spend(ranger10, "Hide in Plain Sight");
  assert.equal(out.ok, true, out.error);
  const hidden = await check(ranger10, { kind: "skill_check", skill: "stealth", reason: "sneak" });
  assert.equal(hidden.total - plain.total, 10);
});

const thief = hero({ class: "rogue", subclass: "Thief", level: 9, abilities: { dex: 16 } });

await test("Supreme Sneak: the Thief's Stealth check has advantage when they moved no more than half their speed this turn.", async () => {
  await stage(thief);
  kit.place(thief.id, 5, 5, 1);
  const slow = await check(thief, { kind: "skill_check", skill: "stealth", reason: "creep" }, [10, 4]);
  assert.equal(d20Faces(slow).length, 2, "a short move keeps the advantage");
  kit.place(thief.id, 5, 5, 5);
  const fast = await check(thief, { kind: "skill_check", skill: "stealth", reason: "creep" }, [10, 4]);
  assert.equal(d20Faces(fast).length, 1, "more than half the speed moved");
});

// ---- Nature's Sanctuary ----

const landDruid = hero({ class: "druid", subclass: "Circle of the Land", level: 14, abilities: { wis: 18 } });

await test("Nature's Sanctuary: a beast or plant that attacks the Land druid first makes a WIS save against their spell save DC; on a failure it must choose another target.", async () => {
  const [beast, bandit] = await stage(landDruid, { enemies: 2, stats: { type: "beast" } });
  kit.setEnemy(bandit.id, { stats: { type: "humanoid" } });
  kit.place(bandit.id, 4, 5);
  const before = snapshot();
  const out = await enemyAttacks(beast, landDruid, [1, 18, 5]);
  assert.equal(out.ok, false, "the beast attacked after failing its save");
  assert.ok(!newRolls(before).some((roll) => roll.kind === "attack"), "no attack roll");
  const man = await enemyAttacks(bandit, landDruid, [18, 5]);
  assert.equal(man.ok, true, man.error);
});

// ---- the check riders ----

const tracker = hero({ class: "ranger", level: 3, abilities: { wis: 14, int: 12 } });
withFeatures(tracker, "Favored Enemy: undead", "Natural Explorer: forest");

await test("Favored Enemy: advantage on Survival checks to track the favored enemy and INT checks to recall lore about it; Natural Explorer: double proficiency on INT and WIS checks tied to the favored terrain.", async () => {
  await kit.endFight();
  const tracking = await check(tracker, { kind: "skill_check", skill: "survival", reason: "tracking the undead" }, [10, 4]);
  assert.equal(d20Faces(tracking).length, 2, "advantage to track the favored enemy");
  const deer = await check(tracker, { kind: "skill_check", skill: "survival", reason: "tracking a deer" }, [10, 4]);
  assert.equal(d20Faces(deer).length, 1);
  world.patch(tracker.id, { proficiencies: { ...TRAINED, skills: ["survival"] } });
  const forest = await check(tracker, { kind: "skill_check", skill: "survival", reason: "foraging in the forest" });
  const town = await check(tracker, { kind: "skill_check", skill: "survival", reason: "foraging in the town" });
  assert.equal(forest.total - town.total, proficiencyBonus(3), "double proficiency in the favored terrain");
});

const dwarf = hero({ class: "fighter", level: 5, race: "hill dwarf" });
const gnome = hero({ class: "wizard", level: 5, race: "rock gnome" });
const deepGnome = hero({ class: "rogue", level: 5, race: "deep gnome" });

await test("Stonecunning (History on stonework) and Artificer's Lore (History on magic items and devices) add twice the proficiency bonus; Stone Camouflage gives advantage on Stealth in rocky terrain.", async () => {
  await kit.endFight();
  const stone = await check(dwarf, { kind: "skill_check", skill: "history", reason: "who built this stonework" });
  const court = await check(dwarf, { kind: "skill_check", skill: "history", reason: "the old court" });
  assert.equal(stone.total - court.total, 2 * proficiencyBonus(5), "Stonecunning");
  const wand = await check(gnome, { kind: "skill_check", skill: "history", reason: "the maker of this magic wand" });
  const king = await check(gnome, { kind: "skill_check", skill: "history", reason: "the old king" });
  assert.equal(wand.total - king.total, 2 * proficiencyBonus(5), "Artificer's Lore");
  const rocks = await check(deepGnome, { kind: "skill_check", skill: "stealth", reason: "among the rocks of the cave" }, [10, 4]);
  assert.equal(d20Faces(rocks).length, 2, "Stone Camouflage");
});

// ---- Primeval Awareness ----

const aware = hero({
  class: "ranger", level: 3, abilities: { wis: 14 },
  spellcasting: { ability: "wis", slots: { 1: { max: 3, used: 0 } }, prepared: [], known: ["Hunter's Mark"], cantrips: [] },
});

await test("Primeval Awareness: the ranger spends a spell slot to sense the favored creature types nearby; with no slot left it does not happen.", async () => {
  await kit.endFight();
  const out = await spend(aware, "Primeval Awareness", { amount: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(aware.id).spellcasting.slots["1"].used, 1, "a 1st level slot");
  world.patch(aware.id, { spellcasting: { ...world.sheet(aware.id).spellcasting, slots: { 1: { max: 3, used: 3 } } } });
  const none = await spend(aware, "Primeval Awareness", { amount: 1 });
  assert.equal(none.ok, false, "no slot left");
});

const volleyer = hero({ class: "ranger", subclass: "Hunter", level: 11, abilities: { dex: 16 }, equipment: [{ name: "Longbow", qty: 1 }] });
withFeatures(volleyer, "Multiattack: Volley");

await test("Volley: the action makes one ranged weapon attack against each creature within 10 feet of the first target; one farther away is refused.", async () => {
  const list = await stage(volleyer, { enemies: 4 });
  kit.place(list[0].id, 5, 10);
  kit.place(list[1].id, 6, 11);
  kit.place(list[2].id, 4, 12);
  kit.place(list[3].id, 12, 12);
  for (const enemy of list.slice(0, 3)) {
    const out = await kit.swing(volleyer.id, enemy.id, [15, 4], { weapon: "Longbow", volley: true });
    assert.equal(out.ok, true, `${enemy.displayName}: ${out.error}`);
  }
  const far = await kit.swing(volleyer.id, list[3].id, [15, 4], { weapon: "Longbow", volley: true });
  assert.equal(far.ok, false, "more than 10 feet from the first target");
});

const lifeCleric = hero({
  class: "cleric", subclass: "Life Domain", level: 6, abilities: { wis: 16 },
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: [] },
});

await test("Blessed Healer: a Life cleric's spell of 1st level or higher that heals another creature heals the cleric 2 + the slot's level.", async () => {
  const friend = hero({ class: "fighter", level: 6 });
  await kit.endFight();
  world.patch(friend.id, { currentHp: 10 });
  world.patch(lifeCleric.id, { currentHp: 20 });
  const out = await world.invoke("heal", { characterId: friend.id, casterId: lifeCleric.id, spell: "Cure Wounds", level: 2 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(lifeCleric.id).currentHp, 20 + 2 + 2, "2 + the slot's level");
});

// ---- what the model is told ----

const { buildDmMessages, requestRollTool } = await import("../src/lib/dm/prompt.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");

await test("The prompt and the tool schemas teach the recount's features: the Multiattack picks, the new reactions and spends, and the check reason the traits read.", () => {
  const encounter = { round: 1, orderReady: true, order: [{ name: "Hero", current: true }], awaitingInitiative: [], turnBudget: null, enemies: [], map: null };
  const text = buildDmMessages(
    { campaign: world.campaign(), members: listMembers(world.campaignId), sheets: world.sheets(), encounter, recentRolls: [], storySummary: "" },
    [],
  )[0].content;
  assert.match(text, /whirlwind or volley is a Hunter's Multiattack, one pc_attack per creature/);
  assert.match(text, /Retaliation \(a Berserker just damaged by a creature within 5 feet\) and Stand Against the Tide/);
  assert.match(text, /Peerless Skill, Quivering Palm \(targetEnemyId; once to set the vibrations after an unarmed hit, again to end them\), Draconic Presence/);
  assert.match(text, /the server applies Favored Enemy, Natural Explorer, Stonecunning, Artificer's Lore, Stone Camouflage and Supreme Sneak from it/);
  assert.match(requestRollTool.function.parameters.properties.reason.description, /naming what a check is about/);
  const tools = dmTurnToolCatalogue(world.campaign(), true, false);
  const tool = (name) => tools.find((entry) => entry.function.name === name)?.function;
  const attack = tool("pc_attack").parameters.properties;
  assert.ok(attack.whirlwind && attack.volley, "pc_attack takes no whirlwind or volley");
  const reaction = tool("use_reaction").description;
  assert.ok(reaction.includes("Retaliation") && reaction.includes("Stand Against the Tide"));
  const resource = JSON.stringify(tool("use_resource"));
  for (const name of ["Peerless Skill", "Quivering Palm", "Draconic Presence", "Hide in Plain Sight", "Primeval Awareness"]) {
    assert.ok(resource.includes(name), `use_resource never names ${name}`);
  }
});

finish();
