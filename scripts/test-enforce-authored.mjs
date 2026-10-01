// The authored subclass layer (src/lib/srd/subclasses.json): the features
// whose rules text states a number or a state (advantage, resistance,
// immunity, dice, a bonus action, a reaction, AC, speed, a save) and which
// the engine only handed to the model as text. Each effect kind is proved
// once through the engine (world.invoke), on a representative feature, and a
// data-level test holds every other row of the same kind to a reader that
// exists (src/lib/srd/authored-effects.ts).
//
// Kinds and their representatives:
//   passive  resist (Soul of the Forge), immune_damage (Saint of Forge and
//            Fire), immune_condition + crit_immune (Fungal Body), save_adv
//            (Unyielding Spirit), save_bonus + ac while concentrating
//            (Durable Magic), save_swap (Elegant Courtier), speed (Superior
//            Mobility), init_adv (Ambush Master), init_ability (Rakish
//            Audacity), attacked_disadv (Among the Dead), attack_adv and
//            auto_crit (Assassinate), rider (Gathered Swarm), mark (Ancestral
//            Protectors), init_refill (Relentless), kill_temp_hp (Touch of
//            Death), turn_heal (Protective Spirit), rest_temp_hp (Celestial
//            Resilience), bonus_route (Totem Spirit: Eagle), bonus_attack (War
//            Magic), enemy_save (Hound of Ill Omen)
//   spend    buff (Kensei's Shot), pool spend with temp HP (Symbiotic
//            Entity), save damage (Touch of the Long Death), reroll (Fanatical
//            Focus), choice (Totem Spirit), check advantage (Visage of the
//            Astral Self)
//   reaction reduce (Spectral Defense, Spirit Shield, Song of Defense), take
//            for an ally (Divine Allegiance), strike back (Storm's Fury),
//            reaction attack (Opportunist)
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-authored");
const world = await openWorld({ campaign: { maxPlayers: 80 } });
const kit = await combatKit(world);

const hero = (overrides) =>
  world.addHero({ maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, ...overrides });
const fresh = (id, patch = {}) =>
  world.patch(id, { conditions: [], conditionMeta: {}, exhaustion: 0, tempHp: 0, ...patch });
const hp = (who) => world.sheet(who.id).currentHp;
const facesOf = (result) => result?.dice?.find((term) => term.sides === 20)?.dice?.length ?? 0;
const diceOf = (roll, sides) =>
  (roll?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.dice.length, 0);
// Several rolls can share a timestamp, so a roll is found by what it is: its
// kind, the character it is about and, for an enemy's swing, the attack.
const rollOn = (kind, characterId, detail = "") =>
  kit.lastRolls(40).find((roll) => roll.kind === kind && roll.characterId === characterId && roll.detail.includes(detail)) ?? null;
const heroesSoFar = () => world.sheets();

// A fight with `first` at the pointer, a sturdy dummy beside them.
async function stage(first, { enemies = 1, hp: enemyHp = 300 } = {}) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(heroesSoFar().map((entry) => [entry.id, entry.id === first.id ? 19 : 3]));
  await kit.fight(enemies, { heroFaces });
  const list = world.enemies();
  for (const enemy of list) {
    kit.setEnemy(enemy.id, { maxHp: enemyHp });
  }
  kit.place(first.id, 5, 5);
  kit.place(list[0].id, 5, 6);
  kit.giveTurn(first.id);
  return list;
}

async function enemyHits(enemy, target, faces) {
  kit.freshRound();
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out.result;
}

const spend = (who, resource, args = {}) => world.invoke("use_resource", { characterId: who.id, resource, ...args });
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });

// ---- passive: damage and conditions ----

const forge = hero({
  class: "cleric", subclass: "Forge Domain", level: 6, acOverride: false,
  equipment: [{ name: "Plate", qty: 1, equipped: true }],
});
const life = hero({
  class: "cleric", subclass: "Life Domain", level: 6, acOverride: false,
  equipment: [{ name: "Plate", qty: 1, equipped: true }],
});

await test("Soul of the Forge: resistance to fire damage, and +1 AC while wearing heavy armor.", async () => {
  assert.equal(world.sheet(forge.id).ac, world.sheet(life.id).ac + 1);
  fresh(forge.id, { currentHp: 60 });
  const out = await world.invoke("apply_damage", { characterId: forge.id, amount: 10, type: "fire" });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(forge), 55);
});

await test("Saint of Forge and Fire and Oceanic Soul: immunity to fire and to cold damage.", async () => {
  const saint = hero({ class: "cleric", subclass: "Forge Domain", level: 17 });
  const deep = hero({ class: "warlock", subclass: "The Fathomless", level: 6 });
  fresh(saint.id, { currentHp: 60 });
  fresh(deep.id, { currentHp: 60 });
  await world.invoke("apply_damage", { characterId: saint.id, amount: 12, type: "fire" });
  await world.invoke("apply_damage", { characterId: deep.id, amount: 12, type: "cold" });
  assert.equal(hp(saint), 60);
  assert.equal(hp(deep), 60);
});

const spore = hero({ class: "druid", subclass: "Circle of Spores", level: 14 });

await test("Fungal Body: the druid cannot be frightened, and a critical hit against them is a normal hit.", async () => {
  const scared = await world.invoke("set_condition", { characterId: spore.id, condition: "frightened", rounds: 3 });
  assert.equal(scared.ok, false, "Fungal Body refuses frightened");
  assert.ok(!world.sheet(spore.id).conditions.includes("frightened"));
  const [enemy] = await stage(spore);
  world.patch(spore.id, { ac: 12, acOverride: true });
  kit.place(spore.id, 5, 5);
  const hit = await enemyHits(enemy, spore, [20, 3, 3]);
  const damage = rollOn("damage", spore.id, "Club vs");
  assert.ok(damage, "the hit rolled damage");
  assert.equal(diceOf(damage, 6), 1, "a critical doubles the dice; Fungal Body keeps them single");
  assert.notEqual(hit.swings?.[0]?.crit, true);
});

await test("Unyielding Spirit: advantage on saving throws against being paralyzed or stunned.", async () => {
  const crown = hero({ class: "paladin", subclass: "Oath of the Crown", level: 15 });
  await kit.endFight();
  const rolled = await world.invoke("request_roll", { characterId: crown.id, kind: "saving_throw", ability: "con", dc: 15, against: "stunned", reason: "stunning blow" });
  assert.equal(rolled.ok, true, rolled.error);
  assert.equal(facesOf(rolled.result), 2);
  const plain = await world.invoke("request_roll", { characterId: crown.id, kind: "saving_throw", ability: "con", dc: 15, against: "poisoned", reason: "venom" });
  assert.equal(facesOf(plain.result), 1);
});

// ---- passive: derived numbers ----

await test("Durable Magic: while concentrating, +2 AC and +2 on every saving throw.", async () => {
  const war = hero({ class: "wizard", subclass: "War Magic", level: 10, abilities: { dex: 14 }, acOverride: false });
  const before = world.sheet(war.id).ac;
  world.patch(war.id, { concentratingOn: "Haste" });
  assert.equal(world.sheet(war.id).ac, before + 2);
  // A paladin's aura elsewhere at the table adds to every save alike, so the
  // rule is read as the difference concentration makes.
  const dexSave = async () => {
    world.clearDice();
    world.dice(10);
    const rolled = await world.invoke("request_roll", { characterId: war.id, kind: "saving_throw", ability: "dex", dc: 10, reason: "trap" });
    world.clearDice();
    return rolled.result.total;
  };
  const focused = await dexSave();
  world.patch(war.id, { concentratingOn: null });
  assert.equal(world.sheet(war.id).ac, before);
  assert.equal(focused - (await dexSave()), 2);
});

await test("Elegant Courtier: a Wisdom saving throw uses the Charisma modifier when it is the better one.", async () => {
  const samurai = hero({ class: "fighter", subclass: "Samurai", level: 7, abilities: { wis: 10, cha: 16 } });
  const plain = hero({ class: "fighter", subclass: "Champion", level: 7, abilities: { wis: 10, cha: 16 } });
  const wisSave = async (who) => {
    world.clearDice();
    world.dice(10);
    const rolled = await world.invoke("request_roll", { characterId: who.id, kind: "saving_throw", ability: "wis", dc: 10, reason: "fear" });
    world.clearDice();
    return rolled.result.total;
  };
  assert.equal((await wisSave(samurai)) - (await wisSave(plain)), abilityMod(16) - abilityMod(10));
});

await test("Superior Mobility: +10 feet of walking speed.", async () => {
  const scout = hero({ class: "rogue", subclass: "Scout", level: 9 });
  const { speedFor } = await import("../src/lib/srd/index.ts");
  assert.equal(speedFor(world.sheet(scout.id)), 40);
});

await test("Ambush Master gives advantage on initiative; Rakish Audacity adds Charisma to it.", async () => {
  const scout = hero({ class: "rogue", subclass: "Scout", level: 13 });
  const dashing = hero({ class: "rogue", subclass: "Swashbuckler", level: 3, abilities: { dex: 14, cha: 16 } });
  await kit.endFight();
  const rolled = await world.invoke("request_roll", { characterId: scout.id, kind: "initiative", reason: "ambush" });
  assert.equal(facesOf(rolled.result), 2);
  world.clearDice();
  world.dice(10);
  const bold = await world.invoke("request_roll", { characterId: dashing.id, kind: "initiative", reason: "duel" });
  world.clearDice();
  assert.equal(bold.result.total, 10 + abilityMod(14) + abilityMod(16));
});

// ---- passive: attacks ----

await test("Among the Dead: an undead creature attacks the warlock at disadvantage.", async () => {
  const undying = hero({ class: "warlock", subclass: "The Undying", level: 1 });
  const [enemy] = await stage(undying);
  kit.setEnemy(enemy.id, { stats: { type: "undead" } });
  world.patch(undying.id, { ac: 12, acOverride: true });
  await enemyHits(enemy, undying, [15, 12, 3]);
  const roll = rollOn("attack", undying.id, "Club vs");
  assert.equal(roll.advantage, "disadvantage");
  assert.equal(d20Faces(roll).length, 2);
});

const assassin = hero({ class: "rogue", subclass: "Assassin", level: 3, abilities: { dex: 16 }, equipment: [{ name: "Shortsword", qty: 1 }] });

await test("Assassinate: advantage against a creature that has not taken a turn, and a hit on a surprised creature is a critical hit.", async () => {
  const [enemy] = await stage(assassin);
  const first = await kit.swing(assassin.id, enemy.id, [15, 15, 3, 3, 3, 3]);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.toHit.advantage, "advantage");
  kit.freshTurn();
  kit.saveEncounter({ ...world.encounter(), surprisedIds: [enemy.id] });
  const second = await kit.swing(assassin.id, enemy.id, [15, 15, 3, 3, 3, 3, 3, 3]);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.result.crit, true);
});

await test("Gathered Swarm: once a turn a weapon hit deals an extra 1d6 piercing.", async () => {
  const swarm = hero({ class: "ranger", subclass: "Swarmkeeper", level: 5, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
  const [enemy] = await stage(swarm);
  const first = await kit.swing(swarm.id, enemy.id, [18, 4, 4]);
  assert.equal(first.ok, true, first.error);
  assert.equal(diceOf(first.damage, 6), 1, "the first hit carries the swarm's 1d6");
  const second = await kit.swing(swarm.id, enemy.id, [18, 4, 4]);
  assert.equal(second.ok, true, second.error);
  assert.equal(diceOf(second.damage, 6), 0, "the second hit that turn does not");
});

await test("Ancestral Protectors: the first creature a raging barbarian hits attacks anyone else at disadvantage.", async () => {
  const guardian = hero({ class: "barbarian", subclass: "Path of the Ancestral Guardian", level: 3, abilities: { str: 16 }, equipment: [{ name: "Greataxe", qty: 1 }] });
  const ally = hero({ class: "fighter", level: 3 });
  const [enemy] = await stage(guardian);
  kit.place(ally.id, 6, 6);
  const rage = await spend(guardian, "Rage");
  assert.equal(rage.ok, true, rage.error);
  const hit = await kit.swing(guardian.id, enemy.id, [18, 5]);
  assert.equal(hit.result.hit, true, hit.error);
  world.patch(ally.id, { ac: 12, acOverride: true });
  await enemyHits(enemy, ally, [15, 12, 3]);
  assert.equal(rollOn("attack", ally.id, "Club vs").advantage, "disadvantage");
  world.patch(guardian.id, { ac: 12, acOverride: true });
  await enemyHits(enemy, guardian, [15, 3]);
  assert.equal(rollOn("attack", guardian.id, "Club vs").advantage, "none");
});

await test("Rakish Audacity: Sneak Attack with no ally and no advantage when the rogue duels one creature alone.", async () => {
  const duelist = hero({ class: "rogue", subclass: "Swashbuckler", level: 3, abilities: { dex: 16 }, equipment: [{ name: "Rapier", qty: 1 }] });
  const [enemy] = await stage(duelist);
  const out = await kit.swing(duelist.id, enemy.id, [15, 4, 3, 3]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, true);
  assert.equal(diceOf(out.damage, 6), 2, "Sneak Attack's 2d6 ride the rapier's d8");
});

await test("Circle of Mortality: a healing spell on a creature at 0 hit points heals the maximum.", async () => {
  const grave = hero({
    class: "cleric", subclass: "Grave Domain", level: 1, abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: [] },
  });
  const fallen = hero({ class: "fighter", level: 1 });
  await kit.endFight();
  world.patch(fallen.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const out = await world.invoke("heal", { characterId: fallen.id, casterId: grave.id, spell: "Cure Wounds", level: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(fallen), 8 + abilityMod(16), "the d8 at its maximum, plus WIS");
});

// ---- passive: moments ----

await test("Relentless: rolling initiative with no superiority dice left gives one back.", async () => {
  const master = hero({ class: "fighter", subclass: "Battle Master", level: 15 });
  const dice = world.sheet(master.id).resources.sub_superiority_dice;
  assert.ok(dice, "a Battle Master holds superiority dice");
  world.patch(master.id, { resources: { ...world.sheet(master.id).resources, sub_superiority_dice: { max: dice.max, used: dice.max } } });
  await kit.endFight();
  await world.invoke("request_roll", { characterId: master.id, kind: "initiative", reason: "fight" });
  assert.equal(world.sheet(master.id).resources.sub_superiority_dice.used, dice.max - 1);
});

await test("Touch of Death: a creature within 5 feet dropping to 0 gives the monk WIS + monk level temporary hit points.", async () => {
  const death = hero({ class: "monk", subclass: "Way of the Long Death", level: 3, abilities: { dex: 16, wis: 14 } });
  const [enemy] = await stage(death, { hp: 1 });
  kit.setEnemy(enemy.id, { currentHp: 1, maxHp: 1 });
  fresh(death.id);
  const out = await kit.swing(death.id, enemy.id, [18, 4], { weapon: "unarmed strike" });
  assert.equal(out.result.dead, true, out.error);
  assert.equal(world.sheet(death.id).tempHp, abilityMod(14) + 3);
});

await test("Protective Spirit: ending a turn in a fight below half hit points restores 1d6 + half the paladin level.", async () => {
  const redeemer = hero({ class: "paladin", subclass: "Oath of Redemption", level: 15 });
  await stage(redeemer);
  world.patch(redeemer.id, { currentHp: 10 });
  world.clearDice();
  world.dice(4);
  assert.equal(kit.endTurn(world.sheet(redeemer.id).userId), true);
  world.clearDice();
  assert.equal(hp(redeemer), 10 + 4 + 7);
});

await test("Celestial Resilience: a rest gives the warlock level + CHA temporary hit points, and allies half the level + CHA.", async () => {
  const celestial = hero({ class: "warlock", subclass: "The Celestial", level: 10, abilities: { cha: 16 } });
  await kit.endFight();
  for (const sheet of world.sheets()) {
    fresh(sheet.id, { currentHp: sheet.maxHp });
  }
  const rest = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(world.sheet(celestial.id).tempHp, 10 + 3);
  assert.equal(world.sheet(forge.id).tempHp, 5 + 3, "an ally gains half the warlock level + CHA");
});

// ---- spends ----

await test("Totem Spirit: the bear totem, once chosen, resists every damage type but psychic while raging.", async () => {
  const totem = hero({ class: "barbarian", subclass: "Path of the Totem Warrior", level: 3 });
  await kit.endFight();
  const chose = await spend(totem, "Totem Spirit", { variant: "bear" });
  assert.equal(chose.ok, true, chose.error);
  assert.ok(world.sheet(totem.id).features.some((feature) => feature.name === "Totem Spirit (Bear)"));
  fresh(totem.id, { currentHp: 60 });
  await spend(totem, "Rage");
  await world.invoke("apply_damage", { characterId: totem.id, amount: 10, type: "fire" });
  assert.equal(hp(totem), 55);
  await world.invoke("apply_damage", { characterId: totem.id, amount: 10, type: "psychic" });
  assert.equal(hp(totem), 45);
});

await test("Totem Spirit (Eagle): a raging barbarian may Dash as a bonus action.", async () => {
  const eagle = hero({ class: "barbarian", subclass: "Path of the Totem Warrior", level: 3 });
  await kit.endFight();
  await spend(eagle, "Totem Spirit", { variant: "eagle" });
  await stage(eagle);
  await spend(eagle, "Rage");
  kit.freshTurn();
  const dash = await world.invoke("take_action", { characterId: eagle.id, action: "dash", bonus: true });
  assert.equal(dash.ok, true, dash.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  assert.equal(world.encounter().turnBudget.actionUsed, false);
});

await test("Kensei's Shot: a bonus action that adds 1d4 to the monk's ranged weapon hits this turn.", async () => {
  const kensei = hero({ class: "monk", subclass: "Way of the Kensei", level: 3, abilities: { dex: 16 }, equipment: [{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }] });
  const [enemy] = await stage(kensei);
  kit.place(enemy.id, 5, 10);
  const shot = await spend(kensei, "Kensei's Shot");
  assert.equal(shot.ok, true, shot.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  const hit = await kit.swing(kensei.id, enemy.id, [18, 4, 2], { weapon: "Longbow" });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(diceOf(hit.damage, 4), 1);
});

await test("Symbiotic Entity: spends a Wild Shape use for four temporary hit points per druid level and 1d6 necrotic on melee weapon hits.", async () => {
  const spores = hero({ class: "druid", subclass: "Circle of Spores", level: 2 });
  await kit.endFight();
  fresh(spores.id);
  const out = await spend(spores, "Symbiotic Entity");
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(spores.id);
  assert.equal(sheet.resources.wild_shape.used, 1);
  assert.equal(sheet.tempHp, 8);
  assert.ok(sheet.conditions.includes("symbiotic entity"));
});

await test("Touch of the Long Death: each ki point buys 2d10 necrotic, a CON save halving it.", async () => {
  const longDeath = hero({ class: "monk", subclass: "Way of the Long Death", level: 17, abilities: { wis: 16 } });
  const [enemy] = await stage(longDeath);
  world.patch(longDeath.id, { resources: { ...world.sheet(longDeath.id).resources, ki: { max: 17, used: 0 } } });
  world.clearDice();
  world.dice(1, 5, 5, 5, 5, 5, 5);
  const out = await spend(longDeath, "Touch of the Long Death", { amount: 3, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(longDeath.id).resources.ki.used, 3);
  assert.equal(kit.enemy(enemy.id).currentHp, 300 - 30);
});

await test("Fanatical Focus: once per rage, the last failed save is rolled again.", async () => {
  const zealot = hero({ class: "barbarian", subclass: "Path of the Zealot", level: 6 });
  await kit.endFight();
  fresh(zealot.id);
  await spend(zealot, "Rage");
  world.clearDice();
  world.dice(2);
  const failed = await world.invoke("request_roll", { characterId: zealot.id, kind: "saving_throw", ability: "wis", dc: 15, reason: "fear" });
  world.clearDice();
  assert.equal(failed.result.success, false);
  world.dice(18);
  const reroll = await spend(zealot, "Fanatical Focus");
  world.clearDice();
  assert.equal(reroll.ok, true, reroll.error);
  const rerolled = rollOn("saving_throw", zealot.id, "Fanatical Focus");
  assert.ok(rerolled && rerolled.total >= 15, "the reroll stands");
  const again = await spend(zealot, "Fanatical Focus");
  assert.equal(again.ok, false, "once per rage");
});

await test("Visage of the Astral Self: 1 ki as a bonus action, and advantage on Insight and Intimidation checks while it lasts.", async () => {
  const astral = hero({ class: "monk", subclass: "Way of the Astral Self", level: 6 });
  await stage(astral);
  const out = await spend(astral, "Visage of the Astral Self");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(astral.id).resources.ki.used, 1);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  const rolled = await world.invoke("request_roll", { characterId: astral.id, kind: "skill_check", skill: "intimidation", reason: "glare" });
  assert.equal(facesOf(rolled.result), 2);
});

await test("Hound of Ill Omen: 3 sorcery points, and the hunted creature saves at disadvantage against the sorcerer.", async () => {
  const shadow = hero({
    class: "sorcerer", subclass: "Shadow Magic", level: 6, abilities: { cha: 16 },
    spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Burning Hands"], cantrips: [] },
  });
  const [enemy] = await stage(shadow);
  const out = await spend(shadow, "Hound of Ill Omen", { targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(shadow.id).resources.sorcery_points.used, 3);
  kit.freshTurn();
  world.clearDice();
  // Burning Hands' 3d6, then the creature's save: 18 and 2, the lower kept.
  world.dice(5, 5, 5, 18, 2);
  const blast = await world.invoke("aoe_damage", { casterId: shadow.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id], saveAbility: "dex", dc: 14 });
  world.clearDice();
  assert.equal(blast.ok, true, blast.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 300 - 15, "the lower die stands: a failed save, full damage");
});

await test("War Magic: after casting a cantrip, one weapon attack as a bonus action; not before.", async () => {
  const knight = hero({ class: "fighter", subclass: "Eldritch Knight", level: 7, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
  const [enemy] = await stage(knight);
  const early = await kit.swing(knight.id, enemy.id, [15, 3], { bonusAttack: "feature" });
  assert.equal(early.ok, false, "no spell cast yet");
  // The action went on a cantrip (the budget a cast leaves: cast-rules.ts
  // turnCharge marks castThisAction, and no "spell:levelled" for a cantrip).
  kit.saveEncounter({
    ...world.encounter(),
    turnBudget: {
      ownerId: knight.id, round: world.encounter().round, actionUsed: true, bonusUsed: false, reactionUsed: false,
      attacksMade: 0, attacksAllowed: 2, oncePerTurn: [], dashed: false, disengaged: false, castThisAction: true,
    },
  });
  const out = await kit.swing(knight.id, enemy.id, [15, 3], { bonusAttack: "feature" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

// ---- reactions ----

async function hitThen(target, faces) {
  const [enemy] = await stage(target);
  fresh(target.id, { currentHp: 60, ac: 12, acOverride: true });
  kit.place(target.id, 5, 5);
  await enemyHits(enemy, target, faces);
  return enemy;
}

await test("Spectral Defense: a reaction halves the damage of the attack that hit.", async () => {
  const walker = hero({ class: "ranger", subclass: "Horizon Walker", level: 15 });
  await hitThen(walker, [15, 6]);
  assert.equal(hp(walker), 52);
  const out = await react(walker, "Spectral Defense");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(walker), 56);
});

await test("Spirit Shield: a raging Ancestral Guardian's reaction takes 2d6 off an ally's hit.", async () => {
  const warden = hero({ class: "barbarian", subclass: "Path of the Ancestral Guardian", level: 6 });
  const friend = hero({ class: "fighter", level: 6 });
  const [enemy] = await stage(friend);
  fresh(friend.id, { currentHp: 60, ac: 12, acOverride: true });
  kit.place(friend.id, 5, 5);
  kit.place(warden.id, 7, 5);
  // Raging since the barbarian's own turn (the pointer is on the friend now).
  world.patch(warden.id, { conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  await enemyHits(enemy, friend, [15, 6]);
  assert.equal(hp(friend), 52);
  world.clearDice();
  world.dice(3, 3);
  const out = await react(warden, "Spirit Shield", { targetCharacterId: friend.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(friend), 58);
});

await test("Song of Defense: while bladesinging, a spell slot takes five times its level off the damage.", async () => {
  const singer = hero({
    class: "wizard", subclass: "Bladesinging", level: 10,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: [], known: [], cantrips: [] },
  });
  const [enemy] = await stage(singer);
  fresh(singer.id, { currentHp: 60, ac: 12, acOverride: true, conditions: ["bladesong"], conditionMeta: { bladesong: { rounds: 10 } } });
  kit.place(singer.id, 5, 5);
  await enemyHits(enemy, singer, [15, 6]);
  assert.equal(hp(singer), 52);
  const out = await react(singer, "Song of Defense", { level: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(singer), 57);
  assert.equal(world.sheet(singer.id).spellcasting.slots["1"].used, 1);
});

await test("Divine Allegiance: the paladin takes the hit an ally within 5 feet took.", async () => {
  const crownsworn = hero({ class: "paladin", subclass: "Oath of the Crown", level: 7 });
  const ward = hero({ class: "wizard", level: 7 });
  const [enemy] = await stage(ward);
  fresh(ward.id, { currentHp: 60, ac: 12, acOverride: true });
  fresh(crownsworn.id, { currentHp: 60 });
  kit.place(ward.id, 5, 5);
  kit.place(crownsworn.id, 4, 5);
  await enemyHits(enemy, ward, [15, 6]);
  assert.equal(hp(ward), 52);
  const out = await react(crownsworn, "Divine Allegiance", { targetCharacterId: ward.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(ward), 60);
  assert.equal(hp(crownsworn), 52);
});

await test("Storm's Fury: a melee attacker that hits takes the sorcerer's level in lightning damage.", async () => {
  const storm = hero({ class: "sorcerer", subclass: "Storm Sorcery", level: 14 });
  const enemy = await hitThen(storm, [15, 6]);
  const before = kit.enemy(enemy.id).currentHp;
  const out = await react(storm, "Storm's Fury", { targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, before - 14);
});

await test("Opportunist: a reaction melee attack against a creature within 5 feet.", async () => {
  const shade = hero({ class: "monk", subclass: "Way of Shadow", level: 17, abilities: { dex: 18 } });
  const friend = hero({ class: "fighter", level: 17 });
  const [enemy] = await stage(friend);
  kit.place(shade.id, 5, 7);
  world.clearDice();
  world.dice(18, 5);
  const out = await react(shade, "Opportunist", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.encounter().reactionsUsed.includes(shade.id));
  assert.ok(kit.enemy(enemy.id).currentHp < 300, "the attack landed");
});

// ---- data ----

await test("Every authored subclass feature that states a mechanical effect is typed, a counter, or on the narrated list with a reason.", async () => {
  const { authoredCoverage } = await import("../src/lib/srd/authored-coverage.ts");
  const coverage = authoredCoverage();
  assert.deepEqual(coverage.uncovered, [], "these state a number or a state and have no engine hook");
  assert.deepEqual(coverage.stale, [], "these table entries name no authored feature");
  for (const entry of coverage.narrated) {
    assert.ok(entry.reason.length >= 20, `${entry.key}: a narrated feature says why`);
  }
});

await test("Every typed authored effect kind is read by the engine file that names it.", async () => {
  const { AUTHORED_READERS, authoredEffectKinds } = await import("../src/lib/srd/authored-coverage.ts");
  const { readFileSync } = await import("node:fs");
  const missing = [];
  for (const kind of authoredEffectKinds()) {
    const reader = AUTHORED_READERS[kind];
    if (!reader) {
      missing.push(`${kind}: no reader`);
      continue;
    }
    const text = readFileSync(new URL(`../${reader.file}`, import.meta.url), "utf8");
    if (!text.includes(reader.call)) {
      missing.push(`${kind}: ${reader.file} does not call ${reader.call}`);
    }
  }
  assert.deepEqual(missing, []);
});

await test("Every condition an authored spend, reaction or mark writes has a meaning the engines read: a registry row or an SRD condition.", async () => {
  const { authoredRows } = await import("../src/lib/srd/authored-effects.ts");
  const { conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");
  const SRD = new Set(["prone", "frightened", "charmed", "restrained", "stunned", "poisoned", "blinded", "deafened"]);
  const names = new Set();
  const addBuff = (does) => {
    const bases = Array.isArray(does.condition) ? does.condition.map(([, name]) => name) : [does.condition];
    for (const base of [...bases, ...Object.values(does.variants ?? {})]) {
      names.add(base.replace("{bardic}", "d6").replace("{units}", "1"));
    }
    if (does.burst?.condition) names.add(does.burst.condition);
  };
  for (const { entry } of authoredRows()) {
    for (const spend of entry.spends ?? []) {
      const options = spend.does.kind === "variants" ? Object.values(spend.does.options).map((option) => option.does) : [spend.does];
      for (const does of options) {
        if (does.kind === "buff") addBuff(does);
        if (does.kind === "save_effect" && does.condition) names.add(does.condition);
        if (does.kind === "insight_contest") names.add(does.condition);
      }
    }
    for (const reaction of entry.reactions ?? []) {
      const does = reaction.does;
      if (does.kind === "save_condition") [does.condition, ...Object.values(does.variants ?? {})].forEach((name) => names.add(name));
      if (does.kind === "gain_condition") names.add(does.condition);
      if (does.kind === "attack" && does.onHitCondition) names.add(does.onHitCondition.name);
    }
    for (const effect of entry.effects ?? []) {
      if (effect.kind === "mark") names.add(effect.condition);
    }
  }
  names.add("storm aura (desert)");
  names.add("defensive flourish (+4)");
  const meaningless = [...names].filter((name) => !SRD.has(name) && !conditionEffectsFor(name));
  assert.deepEqual(meaningless, []);
});

world.close();
finish();
