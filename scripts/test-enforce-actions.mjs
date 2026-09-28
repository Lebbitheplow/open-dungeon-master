// The actions of a turn that are not attacks (src/lib/dm/action-tools.ts
// take_action): each one spends the action and leaves its real effect in
// state. Dodge puts attackers at disadvantage and gives advantage on
// Dexterity saves; Help hands an ally advantage; Hide is a Stealth check
// against the enemies' passive Perception; Grapple and Shove are contests
// with a size cap, and a grappled creature's speed is 0.
//
// ODM's own rules, pinned here as it documents them:
//   - Ready, Search and Use an Object are not actions take_action knows.
//     They are refused rather than improvised.
//   - Grapple and Shove cost the whole action (ACTION_COST). SRD 5.1 lets
//     each replace one attack of the Attack action.
//   - In a grapple or shove contest the enemy rolls with the better of its
//     Strength and Dexterity modifiers from the stat block.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-actions");
const world = await openWorld();
const kit = await combatKit(world);

const brawler = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 12 },
  proficiencies: { ...TRAINED, skills: ["athletics"] },
  equipment: [{ name: "Longsword", qty: 1 }],
});
const sneak = world.addHero({
  class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const small = world.addHero({
  class: "fighter", level: 5, race: "lightfoot_halfling", abilities: { str: 16 },
  proficiencies: { ...TRAINED, skills: ["athletics"] },
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const heroes = [brawler, sneak, small];
const ATHLETICS = abilityMod(16) + proficiencyBonus(5);

// The named hero at the pointer, next to the first enemy; enemyFace places
// the enemies in the order.
async function stage(hero, { count = 1, enemyFace = 1 } = {}) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 3]));
  await kit.fight(count, { heroFaces, enemyFace });
  const enemies = world.enemies();
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemies;
}

// Nobody hides in plain sight, so a test about hiding puts a wall across the
// board first: the hider above it, every enemy below.
function hideout(hero) {
  const board = kit.map();
  const wall = [];
  for (let x = 0; x < board.width; x += 1) {
    wall.push([x, 7, "#"]);
  }
  kit.openField(wall);
  kit.place(hero.id, 5, 5);
  world.enemies().forEach((enemy, index) => kit.place(enemy.id, 3 + index * 2, 9));
}

const act = (hero, action, args = {}) =>
  world.invoke("take_action", { characterId: hero.id, action, ...args });

async function enemySwing(enemy, target, ...faces) {
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return world.diceLog().filter((die) => die.sides === 20).map((die) => die.face);
}

await test("every action spends the action", async () => {
  for (const action of ["dodge", "dash", "disengage", "hide"]) {
    await stage(brawler);
    if (action === "hide") {
      hideout(brawler);
    }
    world.dice(10);
    const out = await act(brawler, action);
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(world.encounter().turnBudget.actionUsed, true, action);
    const second = await act(brawler, "dash");
    assert.equal(second.ok, false, `${action} then a second action`);
  }
});

await test("Dash and Disengage are written on the turn", async () => {
  await stage(brawler);
  assert.equal((await act(brawler, "dash")).ok, true);
  assert.equal(world.encounter().turnBudget.dashed, true);
  assert.equal(world.encounter().turnBudget.disengaged, false);
  await stage(brawler);
  assert.equal((await act(brawler, "disengage")).ok, true);
  assert.equal(world.encounter().turnBudget.disengaged, true);
  assert.equal(world.encounter().turnBudget.dashed, false);
});

await test("Dodge: attacks against the dodger roll two dice and keep the lower", async () => {
  const [enemy] = await stage(brawler);
  world.patch(brawler.id, { ac: 12, acOverride: true });
  assert.equal((await act(brawler, "dodge")).ok, true);
  assert.ok(world.sheet(brawler.id).conditions.includes("dodging"));
  const hp = world.sheet(brawler.id).currentHp;
  // 18 and 3 at +4: the 3 stands, 7 against AC 12 is a miss.
  assert.deepEqual(await enemySwing(enemy, brawler, 18, 3), [18, 3]);
  assert.equal(world.sheet(brawler.id).currentHp, hp);
});

await test("Dodge: Dexterity saves roll two dice and keep the higher", async () => {
  world.diceLog();
  world.dice(4, 15);
  const save = await world.invoke("request_roll", {
    characterId: brawler.id, kind: "saving_throw", ability: "dex", dc: 10,
  });
  world.clearDice();
  assert.equal(save.ok, true, save.error);
  assert.equal(save.result.total, 15 + abilityMod(12));
  // A Strength save is a straight roll.
  world.dice(4, 15);
  const other = await world.invoke("request_roll", {
    characterId: brawler.id, kind: "saving_throw", ability: "str", dc: 10,
  });
  assert.equal(world.clearDice(), 1);
  assert.equal(other.ok, true, other.error);
});

await test("Dodge does nothing for a dodger who is incapacitated", async () => {
  const [enemy] = await stage(brawler);
  assert.equal((await act(brawler, "dodge")).ok, true);
  world.patch(brawler.id, { conditions: ["dodging", "stunned"] });
  // Stunned: attackers have advantage, and the dodge is no answer to it.
  const faces = await enemySwing(enemy, brawler, 2, 3, 1);
  assert.deepEqual(faces, [2, 3]);
  assert.equal(kit.lastRolls(3).find((roll) => roll.kind === "attack").advantage, "advantage");
});

await test("Help: the ally's next check has advantage and spends the help", async () => {
  await stage(brawler);
  const out = await act(brawler, "help", { targetCharacterId: sneak.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(sneak.id).conditions.includes("helped"));
  world.dice(3, 16);
  const check = await world.invoke("request_roll", {
    characterId: sneak.id, kind: "ability_check", ability: "dex", dc: 10,
  });
  assert.equal(world.clearDice(), 0);
  assert.equal(check.result.total, 16 + abilityMod(16));
  assert.ok(!world.sheet(sneak.id).conditions.includes("helped"));
  // Spent: the check after it is a straight roll.
  world.dice(3, 16);
  const next = await world.invoke("request_roll", {
    characterId: sneak.id, kind: "ability_check", ability: "dex", dc: 10,
  });
  assert.equal(world.clearDice(), 1);
  assert.equal(next.result.total, 3 + abilityMod(16));
});

await test("Help cannot be given to oneself", async () => {
  await stage(brawler);
  const out = await act(brawler, "help", { targetCharacterId: brawler.id });
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(brawler.id).conditions.includes("helped"));
});

await test("Hide: Stealth against the sharpest passive Perception, met or beaten", async () => {
  const [enemy, keen] = await stage(sneak, { count: 2 });
  hideout(sneak);
  kit.setEnemy(keen.id, { stats: { senses: { passivePerception: 14 } } });
  kit.setEnemy(enemy.id, { stats: { senses: { passivePerception: 9 } } });
  // 10 on the die, +3: 13 does not reach 14.
  world.dice(10);
  const short = await act(sneak, "hide");
  world.clearDice();
  assert.equal(short.ok, true, short.error);
  assert.equal(short.result.stealth, 10 + abilityMod(16));
  assert.equal(short.result.hidden, false);
  assert.ok(!world.sheet(sneak.id).conditions.includes("hidden"));

  await stage(sneak, { count: 2 });
  hideout(sneak);
  kit.setEnemy(world.enemies()[1].id, { stats: { senses: { passivePerception: 14 } } });
  world.dice(11);
  const met = await act(sneak, "hide");
  world.clearDice();
  assert.equal(met.result.hidden, true);
  assert.ok(world.sheet(sneak.id).conditions.includes("hidden"));
});

await test("an attack from hiding has advantage and gives the attacker away, hit or miss", async () => {
  const [enemy] = await stage(sneak);
  world.patch(sneak.id, { conditions: ["hidden"] });
  world.dice(2, 3);
  const out = await kit.attack(sneak.id, enemy.id);
  assert.equal(world.clearDice(), 0);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, false);
  assert.deepEqual(d20Faces(kit.lastRolls(1)[0]), [2, 3]);
  assert.ok(!world.sheet(sneak.id).conditions.includes("hidden"));
});

await test("Grapple: Athletics against the enemy, a win grapples and pins its speed at 0", async () => {
  const [enemy] = await stage(brawler);
  world.diceLog();
  world.dice(10, 10);
  const out = await act(brawler, "grapple", { targetEnemyId: enemy.id });
  assert.equal(world.clearDice(), 0);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.equal(out.result.contest, `${10 + ATHLETICS} vs ${10 + 1}`);
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["grappled"]);
  const before = kit.token(enemy.id);
  const moved = await world.invoke("move_token", { tokenName: enemy.id, x: 9, y: 9 });
  assert.equal(moved.ok, false);
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [before.x, before.y]);
});

await test("Grapple: a tie goes to the defender", async () => {
  const [enemy] = await stage(brawler);
  // 5 + 6 against 10 + 1.
  world.dice(5, 10);
  const out = await act(brawler, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, false);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
  assert.equal(world.encounter().turnBudget.actionUsed, true);
});

await test("Grapple and Shove: the target is at most one size larger", async () => {
  const sizes = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
  for (const [hero, own] of [[brawler, "Medium"], [small, "Small"]]) {
    for (const size of sizes) {
      for (const action of ["grapple", "shove"]) {
        const [enemy] = await stage(hero);
        kit.setEnemy(enemy.id, { stats: { size } });
        world.dice(20, 1);
        const out = await act(hero, action, { targetEnemyId: enemy.id });
        world.clearDice();
        const legal = sizes.indexOf(size) <= sizes.indexOf(own) + 1;
        assert.equal(out.ok, legal, `${own} ${action} ${size}`);
        assert.deepEqual(
          kit.enemy(enemy.id).conditions,
          legal ? [action === "grapple" ? "grappled" : "prone"] : [],
          `${own} ${action} ${size}`,
        );
      }
    }
  }
});

await test("Shove: a win knocks the target prone", async () => {
  const [enemy] = await stage(brawler);
  world.dice(12, 3);
  const out = await act(brawler, "shove", { targetEnemyId: enemy.id, shove: "prone" });
  world.clearDice();
  assert.equal(out.result.success, true);
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["prone"]);
});

await test("a creature immune to the condition cannot be grappled", async () => {
  const [enemy] = await stage(brawler);
  kit.setEnemy(enemy.id, { stats: { conditionImmune: "grappled, prone" } });
  world.dice(20, 1);
  const out = await act(brawler, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.result.success, false);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
});

await test("nobody at 0 hit points takes an action", async () => {
  await stage(brawler);
  world.patch(brawler.id, { currentHp: 0 });
  const out = await act(brawler, "dodge");
  assert.equal(out.ok, false);
  assert.deepEqual(world.sheet(brawler.id).conditions, []);
});

await test("Ready, Search and Use an Object are refused, not improvised", async () => {
  await stage(brawler);
  for (const action of ["ready", "search", "use_object", "use an object"]) {
    const out = await act(brawler, action);
    assert.equal(out.ok, false, action);
  }
  assert.equal(world.encounter().turnBudget, null);
});

await test(
  "Dodge lasts until the start of the dodger's next turn, through the round wrap",
  async () => {
    const [enemy] = await stage(brawler, { enemyFace: 10 });
    // Order: brawler, the enemy, then the other two.
    assert.equal(kit.endTurn(brawler.userId), true);
    const dodger = world.sheet(kit.current().characterId);
    assert.equal((await act(dodger, "dodge")).ok, true);
    while (world.encounter().round === 1) {
      assert.equal(kit.endTurn(kit.current().userId), true);
    }
    // Round 2, the brawler's turn: the enemy acts before the dodger does.
    assert.equal(kit.current().characterId, brawler.id);
    kit.place(dodger.id, 6, 6);
    const faces = await enemySwing(enemy, dodger, 18, 3, 1);
    assert.equal(faces.length, 2, "the attack was a straight roll: the Dodge had already ended");
    // Their own turn starting is what ends it.
    assert.equal(kit.endTurn(brawler.userId), true);
    assert.equal(kit.current().characterId, dodger.id);
    assert.equal(world.sheet(dodger.id).conditions.includes("dodging"), false);
  },
);

await test("The benefit of Dodge is lost if the dodger is incapacitated or their speed drops to 0.", async () => {
  const [enemy] = await stage(brawler);
  assert.equal((await act(brawler, "dodge")).ok, true);
  world.patch(brawler.id, { conditions: ["dodging", "grappled"] });
  const faces = await enemySwing(enemy, brawler, 18, 3, 1);
  assert.equal(faces.length, 1, "a grappled dodger still put the attacker at disadvantage");
});

await test("Help gives the ally advantage on their next ability check or, against a creature within 5 feet of the helper, their next attack roll.", async () => {
  const [enemy] = await stage(brawler);
  assert.equal((await act(brawler, "help", { targetCharacterId: sneak.id })).ok, true);
  assert.equal(kit.endTurn(brawler.userId), true);
  kit.place(sneak.id, 6, 6);
  world.dice(3, 17, 1, 1, 1, 1);
  const out = await kit.attack(sneak.id, enemy.id);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(d20Faces(kit.lastRolls(2).find((roll) => roll.kind === "attack")).length, 2, "the helped attack was a straight roll");
});

await test("A creature cannot hide from a creature that can see it clearly.", async () => {
  await stage(sneak);
  world.dice(20);
  const out = await act(sneak, "hide");
  assert.equal(world.clearDice(), 1, "the Stealth die was rolled for a character in plain sight");
  assert.ok(!out.ok || out.result.hidden === false, "hidden while standing next to the enemy in the open");
  assert.ok(!world.sheet(sneak.id).conditions.includes("hidden"));
  // Refused, so the action is still theirs.
  assert.notEqual(world.encounter().turnBudget?.actionUsed, true);
});

await test("out of every enemy's sight, the same character hides", async () => {
  await stage(sneak);
  hideout(sneak);
  world.dice(20);
  const out = await act(sneak, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hidden, true);
});

await test("a blinded enemy sees nobody clearly", async () => {
  const [enemy] = await stage(sneak);
  kit.setEnemy(enemy.id, { conditions: ["blinded"] });
  world.dice(20);
  const out = await act(sneak, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

await test("A grapple or shove is made against a creature within reach.", async () => {
  const [enemy] = await stage(brawler);
  kit.place(brawler.id, 1, 1);
  kit.place(enemy.id, 15, 10);
  world.dice(20, 1);
  const out = await act(brawler, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, false, "grappled from 70 feet away");
});

await test("A refused action never happened, so it costs nothing (src/lib/dm/engine-boundary.ts: a tool that errors means the attempt failed).", async () => {
  const [enemy] = await stage(brawler);
  kit.setEnemy(enemy.id, { stats: { size: "Huge" } });
  const out = await act(brawler, "grapple", { targetEnemyId: enemy.id });
  assert.equal(out.ok, false);
  assert.notEqual(world.encounter().turnBudget?.actionUsed, true, "the refused grapple spent the action");
});

await test("The target of a grapple contests with Strength (Athletics) or Dexterity (Acrobatics).", async () => {
  const [enemy] = await stage(brawler);
  kit.setEnemy(enemy.id, { stats: { skills: { athletics: 9 } } });
  world.dice(10, 10);
  const out = await act(brawler, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.result.contest, `${10 + ATHLETICS} vs ${10 + 9}`, `the contest was ${out.result.contest}`);
});

await test("A won shove pushes the target 5 feet away.", async () => {
  const [enemy] = await stage(brawler);
  world.dice(20, 1);
  const out = await act(brawler, "shove", { targetEnemyId: enemy.id, shove: "push" });
  world.clearDice();
  assert.equal(out.result.success, true);
  const token = kit.token(enemy.id);
  assert.deepEqual([token.x, token.y], [5, 7], `the shoved enemy stands at ${token.x},${token.y}`);
  // Forced movement: no movement of its own was spent, nothing was provoked.
  assert.equal(token.movedThisRound, 0);
  assert.deepEqual(world.encounter().reactionsUsed, []);
});

await test("a shove into a wall wins the contest and moves nothing", async () => {
  const [enemy] = await stage(brawler);
  kit.openField([[5, 7, "#"]]);
  world.dice(20, 1);
  const out = await act(brawler, "shove", { targetEnemyId: enemy.id, shove: "push" });
  world.clearDice();
  assert.equal(out.result.success, true);
  const token = kit.token(enemy.id);
  assert.deepEqual([token.x, token.y], [5, 6]);
});

// Held elsewhere: an incapacitated character still takes actions and
// reactions (test-enforce-conditions-actions.mjs).

await kit.endFight();
world.close();
finish();
