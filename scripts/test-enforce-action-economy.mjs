// The action economy of one turn (src/lib/dm/action-budget.ts), reached the
// way play reaches it: one action, one bonus action, one reaction a round,
// and as many attacks inside the Attack action as Extra Attack gives.
// Nothing carries over: the budget belongs to whoever the pointer is on and
// is thrown away when it moves.
//
// A reaction comes back at the start of its owner's own turn (SRD 5.1), not
// when the round wraps.
//
// ODM's own rules, pinned here as it documents them:
//   - Hide, Dash and Disengage always cost the action slot, even for a rogue
//     with Cunning Action (src/lib/dm/action-tools.ts ACTION_COST).
import assert from "node:assert/strict";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-action-economy");
const barracks = await openWorld();
const world = await openWorld();
const kit = await combatKit(world);
const { attacksAllowedFor } = await import("../src/lib/dm/action-tools.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");

// SRD 5.1: attacks per Attack action. Extra Attack comes at 5th level for the
// barbarian, fighter, monk, paladin and ranger; the fighter alone grows to
// three at 11th and four at 20th.
const ATTACKS = {
  barbarian: (level) => (level >= 5 ? 2 : 1),
  fighter: (level) => (level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1),
  monk: (level) => (level >= 5 ? 2 : 1),
  paladin: (level) => (level >= 5 ? 2 : 1),
  ranger: (level) => (level >= 5 ? 2 : 1),
  bard: () => 1,
  cleric: () => 1,
  druid: () => 1,
  rogue: () => 1,
  sorcerer: () => 1,
  warlock: () => 1,
  wizard: () => 1,
};

await test("attacks per Attack action, every class at every level", () => {
  const wrong = [];
  for (const [classId, expected] of Object.entries(ATTACKS)) {
    for (let level = 1; level <= 20; level += 1) {
      // Straight into the table: a campaign seats six, and this is 240 sheets.
      const sheet = createSheet(
        barracks.campaignId,
        barracks.addUser().id,
        level,
        heroInput({ class: classId, level, name: `${classId} ${level}` }),
      );
      const allowed = attacksAllowedFor(sheet);
      if (allowed !== expected(level)) {
        wrong.push(`${classId} ${level}: ${allowed}, not ${expected(level)}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

const novice = world.addHero({
  class: "fighter", level: 1, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const veteran = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 14, int: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Shortsword", qty: 2 }],
  spellcasting: {
    ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: [], known: [],
    cantrips: ["Fire Bolt", "Acid Splash"],
  },
});

// One fight, the named hero at the pointer, toe to toe with a dummy that
// will not die.
async function stage(hero) {
  await kit.endFight();
  await kit.fight(1, {
    heroFaces: { [novice.id]: hero.id === novice.id ? 19 : 2, [veteran.id]: hero.id === veteran.id ? 19 : 2 },
  });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemy;
}

const hit = async (hero, enemy, args = {}) => {
  world.dice(15, 4, 4, 4);
  const out = await kit.attack(hero.id, enemy.id, args);
  world.clearDice();
  return out;
};

await test("one Attack action: a second attack at level 1 is refused and lands nothing", async () => {
  const enemy = await stage(novice);
  assert.equal((await hit(novice, enemy)).ok, true);
  const hp = kit.enemy(enemy.id).currentHp;
  const again = await hit(novice, enemy);
  assert.equal(again.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
  const budget = world.encounter().turnBudget;
  assert.equal(budget.attacksMade, 1);
  assert.equal(budget.attacksAllowed, 1);
  assert.equal(budget.actionUsed, true);
});

await test("Extra Attack at level 5 is exactly two attacks inside one action", async () => {
  const enemy = await stage(veteran);
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal(world.encounter().turnBudget.actionUsed, true);
  assert.equal((await hit(veteran, enemy)).ok, true);
  const hp = kit.enemy(enemy.id).currentHp;
  assert.equal((await hit(veteran, enemy)).ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
  assert.equal(world.encounter().turnBudget.attacksMade, 2);
});

await test("the action is one: after attacking, no other action can be taken", async () => {
  const enemy = await stage(novice);
  assert.equal((await hit(novice, enemy)).ok, true);
  for (const action of ["dodge", "dash", "disengage", "hide"]) {
    const out = await world.invoke("take_action", { characterId: novice.id, action });
    assert.equal(out.ok, false, `${action} was allowed after the Attack action`);
  }
  assert.deepEqual(world.sheet(novice.id).conditions, []);
});

await test("after another action the Attack action is gone", async () => {
  const enemy = await stage(veteran);
  const dashed = await world.invoke("take_action", { characterId: veteran.id, action: "dash" });
  assert.equal(dashed.ok, true, dashed.error);
  const hp = kit.enemy(enemy.id).currentHp;
  assert.equal((await hit(veteran, enemy)).ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("the budget is rebuilt each turn and nothing carries over", async () => {
  const enemy = await stage(veteran);
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal(kit.endTurn(veteran.userId), true);
  assert.equal(world.encounter().turnBudget, null);
  assert.equal(kit.endTurn(novice.userId), true);
  assert.equal(kit.current().characterId, veteran.id);
  // The one unspent attack of the turn before is not owed: two again, not three.
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal((await hit(veteran, enemy)).ok, false);
});

await test("two-weapon fighting spends the bonus action, and there is one", async () => {
  const enemy = await stage(veteran);
  assert.equal((await hit(veteran, enemy, { weapon: "Shortsword" })).ok, true);
  const off = await hit(veteran, enemy, { weapon: "Shortsword", offHand: true });
  assert.equal(off.ok, true, off.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  const hp = kit.enemy(enemy.id).currentHp;
  assert.equal((await hit(veteran, enemy, { weapon: "Shortsword", offHand: true })).ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("the off-hand attack adds no ability modifier to its damage", async () => {
  const enemy = await stage(veteran);
  assert.equal((await hit(veteran, enemy, { weapon: "Shortsword" })).ok, true);
  world.dice(15, 4);
  const off = await kit.attack(veteran.id, enemy.id, { weapon: "Shortsword", offHand: true });
  world.clearDice();
  assert.equal(off.ok, true, off.error);
  // 1d6 on a 4, and nothing else.
  assert.equal(off.result.damage, 4);
});

await test("one reaction a round", async () => {
  await stage(veteran);
  const one = await world.invoke("use_reaction", { characterId: novice.id, feature: "Opportunity attack" });
  assert.equal(one.ok, true, one.error);
  assert.deepEqual(world.encounter().reactionsUsed, [novice.id]);
  const two = await world.invoke("use_reaction", { characterId: novice.id, feature: "Opportunity attack" });
  assert.equal(two.ok, false);
  assert.deepEqual(world.encounter().reactionsUsed, [novice.id]);
});

await test("a reaction comes back at the start of its owner's turn, not at the round wrap", async () => {
  // Order: the veteran, the novice, the enemy. The novice reacted on the
  // veteran's turn above; their own turn starting hands it back.
  assert.equal(kit.endTurn(veteran.userId), true);
  assert.equal(world.encounter().round, 1);
  assert.equal(kit.current().characterId, novice.id);
  assert.deepEqual(world.encounter().reactionsUsed, []);
  // Spent on their own turn, it stays spent through the round wrap and
  // the veteran's whole next turn.
  const spent = await world.invoke("use_reaction", { characterId: novice.id, feature: "Opportunity attack" });
  assert.equal(spent.ok, true, spent.error);
  assert.equal(kit.endTurn(novice.userId), true);
  assert.equal(world.encounter().round, 2);
  assert.equal(kit.current().characterId, veteran.id);
  assert.deepEqual(world.encounter().reactionsUsed, [novice.id]);
  assert.equal(kit.endTurn(veteran.userId), true);
  assert.deepEqual(world.encounter().reactionsUsed, []);
});

await test("Action Surge is one use, refused at none", async () => {
  await stage(veteran);
  world.patch(veteran.id, { resources: { ...world.sheet(veteran.id).resources, action_surge: { max: 1, used: 0 } } });
  const one = await world.invoke("use_resource", { characterId: veteran.id, resource: "Action Surge" });
  assert.equal(one.ok, true, one.error);
  assert.deepEqual(world.sheet(veteran.id).resources.action_surge, { max: 1, used: 1 });
  const two = await world.invoke("use_resource", { characterId: veteran.id, resource: "Action Surge" });
  assert.equal(two.ok, false);
  assert.deepEqual(world.sheet(veteran.id).resources.action_surge, { max: 1, used: 1 });
});

await test("Haste's extra action buys exactly one weapon attack", async () => {
  const enemy = await stage(veteran);
  world.patch(veteran.id, { conditions: ["hasted"] });
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal((await hit(veteran, enemy)).ok, true);
  // The Attack action is spent; the third swing is the hasted one.
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal(world.encounter().turnBudget.extraActions, 0);
  const hp = kit.enemy(enemy.id).currentHp;
  assert.equal((await hit(veteran, enemy)).ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("Haste's extra action can be a Dash, and then it is gone", async () => {
  const enemy = await stage(veteran);
  world.patch(veteran.id, { conditions: ["hasted"] });
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal((await hit(veteran, enemy)).ok, true);
  const dash = await world.invoke("take_action", { characterId: veteran.id, action: "dash" });
  assert.equal(dash.ok, true, dash.error);
  assert.equal(world.encounter().turnBudget.dashed, true);
  const more = await world.invoke("take_action", { characterId: veteran.id, action: "disengage" });
  assert.equal(more.ok, false);
});

await test("Action Surge gives one additional action on the turn it is used.", async () => {
  const enemy = await stage(veteran);
  world.patch(veteran.id, { resources: { ...world.sheet(veteran.id).resources, action_surge: { max: 1, used: 0 } } });
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal((await hit(veteran, enemy)).ok, true);
  const surge = await world.invoke("use_resource", { characterId: veteran.id, resource: "Action Surge" });
  assert.equal(surge.ok, true, surge.error);
  const third = await hit(veteran, enemy);
  assert.equal(third.ok, true, "the surged action was refused");
});

await test("Haste's extra action is one weapon attack, Dash, Disengage, Hide or Use an Object, and nothing else.", async () => {
  const enemy = await stage(veteran);
  world.patch(veteran.id, { conditions: ["hasted"] });
  assert.equal((await hit(veteran, enemy)).ok, true);
  assert.equal((await hit(veteran, enemy)).ok, true);
  const dodge = await world.invoke("take_action", { characterId: veteran.id, action: "dodge" });
  assert.equal(dodge.ok, false, "the hasted action bought a Dodge");
});

await test("Casting a spell is its own action. Extra Attack belongs to the Attack action and gives no second casting.", async () => {
  const enemy = await stage(veteran);
  world.dice(15, 5, 5);
  const one = await kit.attack(veteran.id, enemy.id, { spell: "Fire Bolt", damage: "1d10" });
  world.clearDice();
  assert.equal(one.ok, true, one.error);
  world.dice(15, 5, 5);
  const two = await kit.attack(veteran.id, enemy.id, { spell: "Fire Bolt", damage: "1d10" });
  world.clearDice();
  assert.equal(two.ok, false, "a second Fire Bolt was cast in the same action");
});

// Held elsewhere, so not repeated here: a spell cast through cast_at_enemy,
// cast_buff or aoe_damage spends no action (test-enforce-casting-limits.mjs,
// limit-casting-spends-no-action), and the off-hand attack asks neither for
// the Attack action nor for a light weapon (test-enforce-weapon-rules.mjs,
// twf-needs-the-attack-action and twf-light-weapons-only).

await kit.endFight();
world.close();
finish();
