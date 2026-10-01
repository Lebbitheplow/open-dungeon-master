// What a character's features add to an attack (src/lib/dm/pc-attack.ts with
// src/lib/srd/feature-effects.ts), every die forced: the fighting styles,
// Sneak Attack, Divine Smite, Rage, the widened critical range of the
// Champion, and the extra critical dice of Savage Attacks and Brutal
// Critical.
//
// The rules, from SRD 5.1:
//   - Archery: +2 to attack rolls with ranged weapons.
//   - Dueling: +2 damage with a melee weapon in one hand and no other weapon.
//   - Great Weapon Fighting: a 1 or 2 on a damage die of a two-handed or
//     versatile melee weapon is rerolled once, and the new roll stands.
//   - Sneak Attack: once per turn, a finesse or ranged weapon, with advantage
//     or with an enemy of the target within 5 feet of it, never with
//     disadvantage. 1d6 per two rogue levels, rounded up.
//   - Divine Smite: a spell slot for 2d8 radiant on a melee weapon hit, 1d8
//     more per slot level above 1st to a maximum of 5d8, and 1d8 more against
//     an undead or a fiend.
//   - Rage: +2 damage (+3 from 9th level, +4 from 16th) on melee weapon
//     attacks using Strength.
//   - Improved Critical: weapon attacks crit on a 19 or 20.
//   - Savage Attacks and Brutal Critical: extra weapon dice on a critical hit
//     with a melee weapon attack.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-attack-riders");
const world = await openWorld();
const kit = await combatKit(world);

const style = (name) => ({ name: `Fighting Style: ${name}`, source: "choice" });
const SLOTS = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 }, 5: { max: 2, used: 0 } };

const fighter = world.addHero({
  class: "fighter", subclass: "champion", level: 5, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Greatsword", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const rogue = world.addHero({
  class: "rogue", level: 5, abilities: { str: 14, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Shortsword", qty: 2 }, { name: "Shortbow", qty: 1 }, { name: "Mace", qty: 1 }],
});
// Level 9: below Improved Divine Smite, which would add a d8 of its own.
const paladin = world.addHero({
  class: "paladin", level: 9, abilities: { str: 16, cha: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }],
  spellcasting: { ability: "cha", slots: SLOTS, prepared: [], known: [], cantrips: [] },
});
const barbarian = world.addHero({
  class: "barbarian", level: 9, race: "half_orc", abilities: { str: 16, dex: 18 }, proficiencies: TRAINED,
  equipment: [{ name: "Greataxe", qty: 1 }, { name: "Rapier", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const heroes = [fighter, rogue, paladin, barbarian];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

// The named hero at the pointer, toe to toe with the first dummy; everyone
// else far away, their sheets as they were made.
async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, {
      features: made.features,
      equipment: made.equipment,
      spellcasting: made.spellcasting,
      resources: made.resources,
    });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  // The hero holds the floor whatever the other heroes rolled: a barbarian's
  // Feral Instinct rolls initiative with a second, unforced d20.
  kit.giveTurn(hero.id);
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemies;
}

const withStyle = (hero, name) =>
  world.patch(hero.id, { features: [...base.get(hero.id).features, style(name)] });
const dieCount = (roll, sides) =>
  roll.breakdown.terms.filter((term) => term.sides === sides).reduce((sum, term) => sum + term.count, 0);

await test("Archery: +2 to hit with a ranged weapon, nothing on a melee one", async () => {
  const [enemy] = await stage(fighter);
  withStyle(fighter, "Archery");
  kit.place(enemy.id, 5, 9);
  const bow = await kit.swing(fighter.id, enemy.id, [10, 4], { weapon: "Longbow" });
  assert.equal(bow.toHit.total, 10 + abilityMod(14) + proficiencyBonus(5) + 2);
  assert.equal(bow.damage.total, 4 + abilityMod(14));
  kit.place(enemy.id, 5, 6);
  const sword = await kit.swing(fighter.id, enemy.id, [10, 4], { weapon: "Longsword" });
  assert.equal(sword.toHit.total, 10 + abilityMod(16) + proficiencyBonus(5));
});

await test("Dueling: +2 damage in one hand, nothing in two", async () => {
  const [enemy] = await stage(fighter);
  withStyle(fighter, "Dueling");
  const one = await kit.swing(fighter.id, enemy.id, [10, 4], { weapon: "Longsword" });
  assert.equal(one.damage.total, 4 + abilityMod(16) + 2);
  const two = await kit.swing(fighter.id, enemy.id, [10, 4], { weapon: "Longsword", twoHanded: true });
  assert.equal(two.damage.total, 4 + abilityMod(16));
  await stage(fighter);
  withStyle(fighter, "Dueling");
  const great = await kit.swing(fighter.id, world.enemies()[0].id, [10, 4, 4], { weapon: "Greatsword" });
  assert.equal(great.damage.total, 8 + abilityMod(16));
  kit.place(world.enemies()[0].id, 5, 9);
  const bow = await kit.swing(fighter.id, world.enemies()[0].id, [10, 4], { weapon: "Longbow" });
  assert.equal(bow.damage.total, 4 + abilityMod(14));
});

await test("Great Weapon Fighting: a 1 or a 2 is rerolled once and the new roll stands", async () => {
  const [enemy] = await stage(fighter);
  withStyle(fighter, "Great Weapon Fighting");
  // First die a 1, rerolled into a 2 that stands; second die a 5.
  const swing = await kit.swing(fighter.id, enemy.id, [10, 1, 2, 5], { weapon: "Greatsword" });
  assert.equal(swing.unused, 0);
  assert.equal(swing.damage.total, 2 + 5 + abilityMod(16));
  // A 3 is kept.
  const kept = await kit.swing(fighter.id, enemy.id, [10, 3, 3, 6], { weapon: "Greatsword" });
  assert.equal(kept.unused, 1);
  assert.equal(kept.damage.total, 6 + abilityMod(16));
});

await test("Great Weapon Fighting: not in one hand, and not with a bow", async () => {
  const [enemy] = await stage(fighter);
  withStyle(fighter, "Great Weapon Fighting");
  const one = await kit.swing(fighter.id, enemy.id, [10, 1, 6], { weapon: "Longsword" });
  assert.equal(one.unused, 1);
  assert.equal(one.damage.total, 1 + abilityMod(16));
  const two = await kit.swing(fighter.id, enemy.id, [10, 1, 6], { weapon: "Longsword", twoHanded: true });
  assert.equal(two.unused, 0);
  assert.equal(two.damage.total, 6 + abilityMod(16));
  await stage(fighter);
  withStyle(fighter, "Great Weapon Fighting");
  kit.place(world.enemies()[0].id, 5, 9);
  const bow = await kit.swing(fighter.id, world.enemies()[0].id, [10, 1, 6], { weapon: "Longbow" });
  assert.equal(bow.unused, 1);
});

await test("Improved Critical: a 19 is a critical hit, an 18 is not, and a 19 still has to hit", async () => {
  const [enemy] = await stage(fighter);
  const nineteen = await kit.swing(fighter.id, enemy.id, [19, 3, 4], { weapon: "Longsword" });
  assert.equal(nineteen.result.crit, true);
  assert.equal(nineteen.damage.total, 3 + 4 + abilityMod(16));
  const eighteen = await kit.swing(fighter.id, enemy.id, [18, 3, 4], { weapon: "Longsword" });
  assert.notEqual(eighteen.result.crit, true);
  assert.equal(eighteen.unused, 1);
  await stage(fighter);
  kit.setEnemy(world.enemies()[0].id, { ac: 30 });
  const high = await kit.swing(fighter.id, world.enemies()[0].id, [19, 3, 4], { weapon: "Longsword" });
  assert.equal(high.result.hit, false);
});

await test("Sneak Attack: 3d6 at level 5, with an ally next to the target", async () => {
  const [enemy] = await stage(rogue);
  // Nobody else near: no dice.
  const alone = await kit.swing(rogue.id, enemy.id, [10, 4, 1, 1, 1], { weapon: "Shortsword" });
  assert.equal(alone.unused, 3);
  assert.equal(alone.damage.total, 4 + abilityMod(16));
  await stage(rogue);
  kit.place(fighter.id, 5, 7);
  const flanked = await kit.swing(rogue.id, world.enemies()[0].id, [10, 4, 1, 2, 3], { weapon: "Shortsword" });
  assert.equal(flanked.unused, 0);
  assert.equal(dieCount(flanked.damage, 6), 1 + 3);
  assert.equal(flanked.damage.total, 4 + 1 + 2 + 3 + abilityMod(16));
});

await test("Sneak Attack: with advantage, and never with disadvantage", async () => {
  const [enemy] = await stage(rogue);
  const adv = await kit.swing(rogue.id, enemy.id, [4, 12, 4, 1, 2, 3], { weapon: "Shortsword", advantage: "advantage" });
  assert.equal(adv.unused, 0);
  assert.equal(dieCount(adv.damage, 6), 4);
  await stage(rogue);
  kit.place(fighter.id, 5, 7);
  const dis = await kit.swing(rogue.id, world.enemies()[0].id, [15, 16, 4, 1, 2, 3], {
    weapon: "Shortsword", advantage: "disadvantage",
  });
  assert.equal(dis.result.hit, true);
  assert.equal(dis.unused, 3);
  assert.equal(dieCount(dis.damage, 6), 1);
});

await test("Sneak Attack: finesse or ranged only", async () => {
  const [enemy] = await stage(rogue);
  kit.place(fighter.id, 5, 7);
  const mace = await kit.swing(rogue.id, enemy.id, [15, 4, 1, 2, 3], { weapon: "Mace" });
  assert.equal(mace.unused, 3);
  assert.equal(mace.damage.total, 4 + abilityMod(14));
  await stage(rogue);
  kit.place(fighter.id, 5, 7);
  kit.place(rogue.id, 5, 2);
  const bow = await kit.swing(rogue.id, world.enemies()[0].id, [15, 4, 1, 2, 3], { weapon: "Shortbow" });
  assert.equal(bow.unused, 0);
  assert.equal(dieCount(bow.damage, 6), 4);
});

await test("Sneak Attack: once per turn, and again on the next", async () => {
  const [enemy] = await stage(rogue);
  kit.place(fighter.id, 5, 7);
  const first = await kit.swing(rogue.id, enemy.id, [15, 4, 1, 2, 3], { weapon: "Shortsword" });
  assert.equal(dieCount(first.damage, 6), 4);
  assert.deepEqual(world.encounter().turnBudget.oncePerTurn, ["sneak_attack"]);
  const off = await kit.swing(rogue.id, enemy.id, [15, 4, 1, 2, 3], { weapon: "Shortsword", offHand: true });
  assert.equal(off.ok, true, off.error);
  assert.equal(off.unused, 3);
  assert.equal(off.damage.total, 4);
  // Walk the order to the rogue's next turn (a barbarian's Feral Instinct
  // rolls initiative with an unforced second d20, so the order may vary).
  while (world.encounter().round === 1 || kit.current().characterId !== rogue.id) {
    assert.equal(kit.endTurn(kit.current().userId), true);
  }
  assert.equal(kit.current().characterId, rogue.id);
  const next = await kit.swing(rogue.id, enemy.id, [15, 4, 1, 2, 3], { weapon: "Shortsword" });
  assert.equal(dieCount(next.damage, 6), 4);
});

await test("a critical hit doubles the Sneak Attack dice with the weapon's", async () => {
  const [enemy] = await stage(rogue);
  kit.place(fighter.id, 5, 7);
  const crit = await kit.swing(rogue.id, enemy.id, [20, 1, 1, 1, 1, 1, 1, 1, 1], { weapon: "Shortsword" });
  assert.equal(crit.unused, 0);
  assert.equal(dieCount(crit.damage, 6), 2 * (1 + 3));
  assert.equal(crit.damage.total, 8 + abilityMod(16));
});

// SRD: slot level to d8s.
const SMITE = { 1: 2, 2: 3, 3: 4, 4: 5 };

await test("Divine Smite: 2d8 and one more per slot level, the slot spent", async () => {
  for (const [level, dice] of Object.entries(SMITE)) {
    const [enemy] = await stage(paladin);
    const faces = [15, 4, ...new Array(dice).fill(3)];
    const swing = await kit.swing(paladin.id, enemy.id, faces, { weapon: "Longsword", smite: Number(level) });
    assert.equal(swing.ok, true, swing.error);
    assert.equal(swing.unused, 0, `slot ${level}`);
    assert.equal(dieCount(swing.damage, 8), 1 + dice, `slot ${level}`);
    assert.equal(swing.damage.total, 4 + 3 * dice + abilityMod(16), `slot ${level}`);
    assert.equal(world.sheet(paladin.id).spellcasting.slots[level].used, 1, `slot ${level}`);
  }
});

await test("Divine Smite: refused with no slot, with no feature, and at range", async () => {
  let [enemy] = await stage(paladin);
  world.patch(paladin.id, { spellcasting: { ...base.get(paladin.id).spellcasting, slots: { 1: { max: 4, used: 4 } } } });
  const empty = await kit.swing(paladin.id, enemy.id, [15, 4, 3, 3], { weapon: "Longsword", smite: 1 });
  assert.equal(empty.ok, false);
  assert.equal(empty.unused, 4);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
  assert.equal(world.sheet(paladin.id).spellcasting.slots[1].used, 4);

  [enemy] = await stage(paladin);
  kit.place(enemy.id, 5, 9);
  const ranged = await kit.swing(paladin.id, enemy.id, [15, 4, 3, 3], { weapon: "Longbow", smite: 1 });
  assert.equal(ranged.ok, false);
  assert.equal(world.sheet(paladin.id).spellcasting.slots[1].used, 0);

  [enemy] = await stage(fighter);
  const none = await kit.swing(fighter.id, enemy.id, [15, 4, 3, 3], { weapon: "Longsword", smite: 1 });
  assert.equal(none.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("a critical hit doubles the smite dice", async () => {
  const [enemy] = await stage(paladin);
  const crit = await kit.swing(paladin.id, enemy.id, [20, 1, 1, 1, 1, 1, 1], { weapon: "Longsword", smite: 1 });
  assert.equal(crit.unused, 0);
  assert.equal(dieCount(crit.damage, 8), 2 * (1 + 2));
  assert.equal(crit.damage.total, 6 + abilityMod(16));
});

await test("Rage: its bonus on a Strength melee attack and on nothing else", async () => {
  const [enemy] = await stage(barbarian);
  world.patch(barbarian.id, { conditions: ["raging"] });
  // Level 9: +3.
  const axe = await kit.swing(barbarian.id, enemy.id, [10, 4], { weapon: "Greataxe" });
  assert.equal(axe.damage.total, 4 + abilityMod(16) + 3);
  // DEX 18 beats STR 16, so the rapier is swung with Dexterity.
  const rapier = await kit.swing(barbarian.id, enemy.id, [10, 4], { weapon: "Rapier" });
  assert.equal(rapier.damage.total, 4 + abilityMod(18));
  await stage(barbarian);
  world.patch(barbarian.id, { conditions: ["raging"] });
  kit.place(world.enemies()[0].id, 5, 9);
  const bow = await kit.swing(barbarian.id, world.enemies()[0].id, [10, 4], { weapon: "Longbow" });
  assert.equal(bow.damage.total, 4 + abilityMod(18));
  world.patch(barbarian.id, { conditions: [] });
});

await test("no Rage, no bonus", async () => {
  const [enemy] = await stage(barbarian);
  const axe = await kit.swing(barbarian.id, enemy.id, [10, 4], { weapon: "Greataxe" });
  assert.equal(axe.damage.total, 4 + abilityMod(16));
});

await test("Savage Attacks and Brutal Critical: one more weapon die each on a melee critical hit", async () => {
  const [enemy] = await stage(barbarian);
  const crit = await kit.swing(barbarian.id, enemy.id, [20, 2, 3, 4, 5], { weapon: "Greataxe" });
  assert.equal(crit.unused, 0);
  assert.equal(dieCount(crit.damage, 12), 4);
  assert.equal(crit.damage.total, 2 + 3 + 4 + 5 + abilityMod(16));
  // Nothing extra on an ordinary hit.
  const hit = await kit.swing(barbarian.id, enemy.id, [15, 2, 3], { weapon: "Greataxe" });
  assert.equal(hit.unused, 1);
});

await test("Divine Smite deals at most 5d8, before the extra die against undead and fiends.", async () => {
  const [enemy] = await stage(paladin);
  const swing = await kit.swing(paladin.id, enemy.id, [15, 4, 1, 1, 1, 1, 1, 1], { weapon: "Longsword", smite: 5 });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(dieCount(swing.damage, 8) - 1, 5, `a 5th level slot smote for ${dieCount(swing.damage, 8) - 1}d8`);
});

await test("Divine Smite is declared when the attack hits; a miss spends nothing.", async () => {
  const [enemy] = await stage(paladin);
  const swing = await kit.swing(paladin.id, enemy.id, [2], { weapon: "Longsword", smite: 2 });
  assert.equal(swing.result.hit, false);
  assert.equal(world.sheet(paladin.id).spellcasting.slots[2].used, 0, "the miss spent a 2nd level slot");
});

await test("A refused attack never happened: it spends no spell slot (src/lib/dm/engine-boundary.ts: a tool that errors means the attempt failed).", async () => {
  const [enemy] = await stage(paladin);
  assert.equal((await kit.swing(paladin.id, enemy.id, [15, 4])).ok, true);
  assert.equal((await kit.swing(paladin.id, enemy.id, [15, 4])).ok, true);
  const third = await kit.swing(paladin.id, enemy.id, [15, 4, 3, 3], { weapon: "Longsword", smite: 1 });
  assert.equal(third.ok, false);
  assert.equal(world.sheet(paladin.id).spellcasting.slots[1].used, 0, "the refused attack spent a slot");
});

await test("Divine Smite deals 1d8 more when the target is an undead or a fiend.", async () => {
  const [enemy] = await stage(paladin);
  kit.setEnemy(enemy.id, { stats: { type: "undead" } });
  const swing = await kit.swing(paladin.id, enemy.id, [15, 4, 1, 1, 1], { weapon: "Longsword", smite: 1 });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(dieCount(swing.damage, 8) - 1, 3, `an undead was smitten for ${dieCount(swing.damage, 8) - 1}d8`);
});

await test("Savage Attacks and Brutal Critical add their dice to a critical hit with a melee weapon attack.", async () => {
  const [enemy] = await stage(barbarian);
  kit.place(enemy.id, 5, 9);
  const crit = await kit.swing(barbarian.id, enemy.id, [20, 1, 1, 1, 1], { weapon: "Longbow" });
  assert.equal(crit.result.crit, true);
  assert.equal(dieCount(crit.damage, 8), 2, `a longbow critical rolled ${dieCount(crit.damage, 8)}d8`);
});

await test("Dueling applies while the character wields a melee weapon in one hand and no other weapon.", async () => {
  const [enemy] = await stage(rogue);
  world.patch(rogue.id, {
    features: [...base.get(rogue.id).features, style("Dueling")],
    equipment: [
      { name: "Shortsword", qty: 1, equipped: true },
      { name: "Dagger", qty: 1, equipped: true },
    ],
  });
  // A dagger in the other hand: the main hand goes without the +2.
  const main = await kit.swing(rogue.id, enemy.id, [15, 4], { weapon: "Shortsword" });
  assert.equal(main.ok, true, main.error);
  assert.equal(main.damage.total, 4 + abilityMod(16), `the main hand dealt ${main.damage.total} with a dagger in the other`);
  const off = await kit.swing(rogue.id, enemy.id, [15, 4], { weapon: "Dagger", offHand: true });
  assert.equal(off.ok, true, off.error);
  assert.equal(off.damage.total, 4);
  // The dagger put away, the same swing carries it.
  await stage(rogue);
  world.patch(rogue.id, {
    features: [...base.get(rogue.id).features, style("Dueling")],
    equipment: [{ name: "Shortsword", qty: 1, equipped: true }, { name: "Dagger", qty: 1 }],
  });
  const alone = await kit.swing(rogue.id, world.enemies()[0].id, [15, 4], { weapon: "Shortsword" });
  assert.equal(alone.damage.total, 4 + abilityMod(16) + 2);
});

// Last in the file: it leaves parked rolls behind it.
await test("with physical dice the smite slot waits for the player's own d20: kept on a miss, spent on a hit", async () => {
  const { handlePcAttack, resolvePendingPcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
  const { createDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
  const { insertRoll } = await import("../src/lib/db/rolls.ts");
  const { rollExpression } = await import("../src/lib/dice.ts");
  for (const [face, spent] of [[2, 0], [15, 1]]) {
    const [enemy] = await stage(paladin);
    const turn = createDmTurn(world.campaignId, [], "human_dm");
    const sheets = world.sheets();
    const seen = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const parked = handlePcAttack(
      world.campaign(),
      turn,
      JSON.stringify({ characterId: paladin.id, targetEnemyId: enemy.id, weapon: "Longsword", smite: 2 }),
      sheets,
      new Map(sheets.map((sheet) => [sheet.id, sheet])),
      new Set([paladin.userId]),
      null,
    );
    assert.equal(parked[PC_ATTACK_PARKED], true, JSON.stringify(parked));
    // Parked: nothing is spent while the die is still in the player's hand.
    assert.equal(world.sheet(paladin.id).spellcasting.slots[2].used, 0);
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => !seen.has(entry.id));
    assert.equal(pending.kind, "attack");
    world.clearDice();
    world.dice(face);
    const roll = insertRoll({
      campaignId: world.campaignId,
      characterId: paladin.id,
      requestedBy: "dm",
      kind: "attack",
      detail: pending.detail,
      result: rollExpression(pending.expression),
    });
    world.clearDice();
    resolvePendingPcAttack(pending, roll);
    assert.equal(world.sheet(paladin.id).spellcasting.slots[2].used, spent, `a d20 of ${face}`);
    const damage = listOpenPendingRolls(world.campaignId).find(
      (entry) => !seen.has(entry.id) && entry.kind === "damage",
    );
    if (spent) {
      // Longsword 1d8+3 and the smite's 3d8.
      assert.equal(damage.expression, "1d8+3+3d8");
    } else {
      assert.equal(damage, undefined);
    }
  }
});

await kit.endFight();
world.close();
finish();
