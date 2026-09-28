// What a condition lets a creature DO: act, react, cast, move, and how it
// rolls checks and saves. Every refusal is asked of the real handler and the
// state is read back to show nothing moved.
//
// SRD 5.1, Conditions:
//   incapacitated  no actions, no reactions
//   paralyzed, petrified, stunned, unconscious  incapacitated, cannot move,
//                  automatically fail Strength and Dexterity saves
//   grappled, restrained  speed 0; restrained has disadvantage on DEX saves
//   poisoned       disadvantage on attack rolls and ability checks, NOT saves
//   frightened     disadvantage on ability checks and attack rolls
//   prone          standing up costs half the speed; crawling costs double
//   Concentration ends when the caster is incapacitated or killed
//   (SRD 5.1, Spellcasting, Concentration).
//
// ODM's own rules, pinned here as the code documents them:
//   - A character at 0 hit points is refused by every acting handler on the
//     hit points alone; no unconscious condition is written for it.
//   - The initiative pointer stops only on player characters, and passes one
//     who cannot act (src/lib/dm/encounter-tools.ts entryAlive).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";
import { onTurnOf } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-conditions-actions");
const world = await openWorld();
const kit = conditionsKit(world);
const maps = await import("../src/lib/db/battle-maps.ts");
const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");

const NO_ACTIONS = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];
const STILL_ACTS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "invisible", "poisoned", "prone",
  "restrained",
];
const AUTO_FAIL_STR_DEX = ["paralyzed", "petrified", "stunned", "unconscious"];
const SPEED_ZERO = ["grappled", "restrained", "paralyzed", "petrified", "stunned", "unconscious"];

const hero = world.addHero(FIGHTER);
const caster = world.addHero({
  class: "cleric",
  level: 5,
  abilities: { wis: 16 },
  maxHp: 30,
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Bless", "Hold Person", "Shield of Faith"],
    known: [],
    cantrips: ["Sacred Flame"],
  },
});
const casterUser = { id: caster.userId };
await world.beginFight([{ monster: "goblin", count: 2 }], {
  heroFaces: { [hero.id]: 20, [caster.id]: 18 },
});
const [goblin] = world.enemies();

// ---- movement, while the board still has its tokens ----

async function walk(user, x, y) {
  world.signIn(user);
  const response = await moveRoute.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return response.status;
}
const board = maps.getBattleMapForEncounter(world.encounter().id);
const tokenOf = (id) => maps.getTokenByRef(board.id, id);
// The board places its tokens at random. The enemies come off it so that no
// step here can walk out of a reach and draw an opportunity attack.
for (const token of maps.listTokens(board.id)) {
  if (token.refId !== hero.id && token.refId !== caster.id) {
    maps.deleteToken(token.id);
  }
}
const home = { x: tokenOf(hero.id).x, y: tokenOf(hero.id).y };
function goHome() {
  maps.moveToken(tokenOf(hero.id).id, home.x, home.y, 0);
}
// One open tile beside the hero, found by walking to it.
let step = null;
for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
  if ((await walk(world.owner, home.x + dx, home.y + dy)) === 200) {
    step = { x: home.x + dx, y: home.y + dy };
    break;
  }
}
goHome();

await test("an unhindered character walks their own token on their own turn", async () => {
  assert.ok(step, "no open tile beside the hero on the generated board");
  assert.equal(await walk(world.owner, step.x, step.y), 200);
  assert.deepEqual([tokenOf(hero.id).x, tokenOf(hero.id).y], [step.x, step.y]);
  goHome();
});

for (const condition of SPEED_ZERO) {
  await test(`${condition}: speed 0, the move is refused and the token stays`, async () => {
    kit.reset(hero.id, { conditions: [condition] });
    assert.equal(await walk(world.owner, step.x, step.y), 409);
    assert.deepEqual([tokenOf(hero.id).x, tokenOf(hero.id).y], [home.x, home.y]);
    kit.reset(hero.id);
  });
}

await test("a character at 0 hit points cannot move", async () => {
  kit.reset(hero.id, { currentHp: 0 });
  assert.equal(await walk(world.owner, step.x, step.y), 409);
  kit.reset(hero.id);
});

await test("a character cannot move on somebody else's turn", async () => {
  assert.equal(await walk(casterUser, tokenOf(caster.id).x + 1, tokenOf(caster.id).y), 409);
});

await test("A prone creature's only movement is to crawl at double cost, unless it spends half its speed to stand, which ends the condition (SRD 5.1, Conditions and Movement).", async () => {
  // The board is random, so the step may be rough ground: what it costs a
  // character on their feet is measured first.
  kit.reset(hero.id);
  goHome();
  assert.equal(await walk(world.owner, step.x, step.y), 200);
  const upright = tokenOf(hero.id).movedThisRound;
  kit.reset(hero.id, { conditions: ["prone"] });
  goHome();
  try {
    assert.equal(await walk(world.owner, step.x, step.y), 200);
    const spent = tokenOf(hero.id).movedThisRound;
    const stood = !world.sheet(hero.id).conditions.includes("prone");
    // Standing from speed 30 costs 15 ft (three tiles) before the step;
    // crawling costs the step twice over.
    assert.ok(
      stood ? spent >= upright + 3 : spent >= upright * 2,
      `prone, and the step cost ${spent} where it costs ${upright} standing`,
    );
  } finally {
    kit.reset(hero.id);
    goHome();
  }
});

kit.offBoard();

// ---- actions ----

const snapshot = () => ({
  enemyHp: kit.enemy(goblin.id).currentHp,
  enemyConditions: kit.enemy(goblin.id).conditions,
  conditions: world.sheet(hero.id).conditions,
  budget: world.encounter().turnBudget,
  reactions: world.encounter().reactionsUsed,
});

for (const condition of NO_ACTIONS) {
  await test(`${condition}: pc_attack is refused and no die is rolled`, async () => {
    kit.reset(hero.id, { conditions: [condition] });
    kit.resetEnemy(goblin.id);
    kit.freshTurn();
    const before = snapshot();
    const out = await kit.swing([17, 4], hero.id, goblin.id, { weapon: "Longsword" });
    assert.equal(out.outcome.ok, false);
    assert.deepEqual(out.dice, []);
    assert.deepEqual(snapshot(), before);
  });
  await test(`${condition}: an enemy under it cannot attack`, async () => {
    kit.reset(hero.id);
    kit.resetEnemy(goblin.id, [condition]);
    const out = await kit.withDice([17, 4], "enemy_attack", {
      enemyId: goblin.id,
      targetCharacterId: hero.id,
    });
    assert.equal(out.outcome.ok, false);
    assert.deepEqual(out.dice, []);
    assert.equal(world.sheet(hero.id).currentHp, hero.maxHp);
    kit.resetEnemy(goblin.id);
  });
}

for (const condition of STILL_ACTS) {
  await test(`${condition}: the character can still attack`, async () => {
    kit.reset(hero.id, { conditions: [condition] });
    kit.resetEnemy(goblin.id);
    const out = await kit.swing([17, 17, 4], hero.id, goblin.id, { weapon: "Longsword" });
    assert.equal(out.outcome.ok, true, out.outcome.error);
  });
}

await test("at 0 hit points every acting handler refuses", async () => {
  kit.reset(hero.id, { currentHp: 0 });
  kit.reset(caster.id, { currentHp: 0 });
  kit.freshTurn();
  const calls = [
    ["pc_attack", { characterId: hero.id, enemyId: goblin.id, targetEnemyId: goblin.id }],
    ["take_action", { characterId: hero.id, action: "dodge" }],
    ["use_reaction", { characterId: hero.id, feature: "Opportunity attack" }],
    ["cast_at_enemy", {
      characterId: caster.id, targetEnemyId: goblin.id, spell: "Sacred Flame",
      saveAbility: "dex", damage: "1d8",
    }],
    ["cast_buff", { characterId: caster.id, spell: "Bless", level: 1 }],
  ];
  for (const [name, args] of calls) {
    const out = await kit.withDice([17, 4], name, args);
    assert.equal(out.outcome.ok, false, `${name} went through at 0 hit points`);
    assert.deepEqual(out.dice, [], name);
  }
  assert.deepEqual(world.sheet(hero.id).conditions, []);
  assert.equal(world.sheet(caster.id).spellcasting.slots[1].used, 0);
  kit.reset(hero.id);
  kit.reset(caster.id);
});

await test("the initiative pointer passes a character who cannot act", async () => {
  kit.reset(hero.id);
  kit.reset(caster.id, { conditions: ["stunned"] });
  assert.equal(kit.pointer().id, hero.id);
  assert.equal(kit.endOwnTurn(world.owner.id), true);
  // The stunned cleric is passed over and the fighter is up again, a round on.
  assert.equal(kit.pointer().id, hero.id);
  assert.equal(kit.endOwnTurn(caster.userId), false);
  kit.reset(caster.id);
});

await test("An incapacitated creature cannot take actions: no Dodge, Dash, Disengage, Hide, Help, Grapple or Shove (SRD 5.1, Conditions).", async () => {
  for (const condition of NO_ACTIONS) {
    kit.reset(hero.id, { conditions: [condition] });
    kit.freshTurn();
    const out = await world.invoke("take_action", { characterId: hero.id, action: "dodge" });
    assert.equal(out.ok, false, `${condition} character took the Dodge action`);
    assert.deepEqual(world.sheet(hero.id).conditions, [condition]);
  }
});

await test("An incapacitated creature cannot take reactions (SRD 5.1, Conditions).", async () => {
  for (const condition of NO_ACTIONS) {
    kit.reset(hero.id, { conditions: [condition] });
    kit.freshTurn();
    const out = await world.invoke("use_reaction", {
      characterId: hero.id,
      feature: "Opportunity attack",
    });
    assert.equal(out.ok, false, `${condition} character spent a reaction`);
    assert.deepEqual(world.encounter().reactionsUsed, []);
  }
});

await test("an incapacitated caster casts nothing, cantrips included", async () => {
  for (const condition of NO_ACTIONS) {
    kit.reset(caster.id, { conditions: [condition] });
    kit.resetEnemy(goblin.id);
    const cantrip = await kit.withDice([1, 8], "cast_at_enemy", {
      characterId: caster.id, targetEnemyId: goblin.id, spell: "Sacred Flame",
      saveAbility: "dex", damage: "1d8",
    });
    assert.equal(cantrip.outcome.ok, false, `${condition} caster cast Sacred Flame`);
    const slot = await world.invoke("use_spell_slot", {
      characterId: caster.id, level: 1, spell: "Bless",
    });
    assert.equal(slot.ok, false, `${condition} caster spent a slot`);
  }
});
kit.reset(caster.id);
world.patch(caster.id, { spellcasting: caster.spellcasting });
kit.resetEnemy(goblin.id);

if (world.hasPack) {
  await test("Concentration on a spell ends when the caster is incapacitated (SRD 5.1, Spellcasting, Concentration).", async () => {
    kit.reset(caster.id);
    // Cast on the caster's own turn: a spell is (src/lib/dm/cast-guard.ts).
    const cast = await onTurnOf(world, caster.id, () =>
      world.invoke("cast_buff", { characterId: caster.id, spell: "Bless", level: 1 }),
    );
    assert.equal(cast.ok, true, cast.error);
    assert.equal(world.sheet(caster.id).concentratingOn, "Bless");
    try {
      await world.invoke("set_condition", { characterId: caster.id, condition: "stunned", rounds: 1 });
      const held = world.sheet(caster.id).concentratingOn;
      assert.equal(held, null, `stunned and still concentrating on ${held}`);
      assert.equal(world.sheet(caster.id).conditions.includes("blessed"), false);
    } finally {
      kit.reset(caster.id);
      world.patch(caster.id, { spellcasting: caster.spellcasting });
    }
  });
}

// ---- checks and saves ----

async function roll(conditions, args, faces = [17, 3]) {
  kit.reset(hero.id, { conditions });
  return kit.withDice(faces, "request_roll", { characterId: hero.id, dc: 10, ...args });
}

await test("poisoned: disadvantage on ability and skill checks, never on saves", async () => {
  const check = await roll(["poisoned"], { kind: "ability_check", ability: "str" });
  assert.equal(kit.d20s(check.dice), 2);
  assert.equal(check.result.total, 3 + 3);
  const skill = await roll(["poisoned"], { kind: "skill_check", skill: "athletics" });
  assert.equal(kit.d20s(skill.dice), 2);
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    const save = await roll(["poisoned"], { kind: "saving_throw", ability });
    assert.equal(kit.d20s(save.dice), 1, `poisoned ${ability} save`);
  }
});

await test("frightened: disadvantage on ability checks, not on saves", async () => {
  const check = await roll(["frightened"], { kind: "ability_check", ability: "wis" });
  assert.equal(kit.d20s(check.dice), 2);
  const save = await roll(["frightened"], { kind: "saving_throw", ability: "wis" });
  assert.equal(kit.d20s(save.dice), 1);
});

for (const condition of AUTO_FAIL_STR_DEX) {
  await test(`${condition}: Strength and Dexterity saves fail with no die rolled`, async () => {
    for (const ability of ["str", "dex"]) {
      const save = await roll([condition], { kind: "saving_throw", ability }, [20]);
      assert.equal(save.outcome.ok, true, save.outcome.error);
      assert.equal(save.result.success, false);
      assert.deepEqual(save.dice, []);
    }
    const other = await roll([condition], { kind: "saving_throw", ability: "con" }, [20]);
    assert.equal(other.result.success, true);
    assert.equal(kit.d20s(other.dice), 1);
  });
  await test(`${condition}: an area effect lands in full, and a forced save fails`, async () => {
    kit.reset(hero.id, { conditions: [condition] });
    const blast = await kit.withDice([6, 20], "aoe_damage", {
      damage: "1d6", saveAbility: "dex", dc: 5, halfOnSave: true, characterIds: [hero.id],
    });
    assert.deepEqual(blast.dice, ["d6:6"]);
    assert.equal(world.sheet(hero.id).currentHp, hero.maxHp - 6);
    kit.reset(hero.id, { conditions: [condition] });
    const forced = await kit.withDice([20, 4], "cast_at_player", {
      characterId: hero.id, spell: "Trap", source: "a net", saveAbility: "str", dc: 5,
      damage: "1d4", halfOnSave: true,
    });
    assert.equal(forced.result.saved, false);
    assert.equal(world.sheet(hero.id).currentHp, hero.maxHp - 4);
  });
}

await test("restrained: disadvantage on Dexterity saves only", async () => {
  const dex = await roll(["restrained"], { kind: "saving_throw", ability: "dex" });
  assert.equal(kit.d20s(dex.dice), 2);
  assert.equal(dex.result.total, 3 + 2);
  const str = await roll(["restrained"], { kind: "saving_throw", ability: "str" });
  assert.equal(kit.d20s(str.dice), 1);
});

await test("grappled, prone, blinded and deafened leave checks and saves alone", async () => {
  for (const condition of ["grappled", "prone", "blinded", "deafened"]) {
    const save = await roll([condition], { kind: "saving_throw", ability: "dex" });
    assert.equal(kit.d20s(save.dice), 1, condition);
    const check = await roll([condition], { kind: "ability_check", ability: "str" });
    assert.equal(kit.d20s(check.dice), 1, condition);
  }
});

await test("A grapple or a shove is a Strength (Athletics) check and hiding is a Dexterity (Stealth) check, so poisoned and frightened impose disadvantage on them (SRD 5.1, Conditions).", async () => {
  kit.reset(hero.id, { conditions: ["poisoned"] });
  kit.resetEnemy(goblin.id);
  kit.freshTurn();
  const out = await kit.withDice([17, 3, 2, 2], "take_action", {
    characterId: hero.id, action: "grapple", targetEnemyId: goblin.id,
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  // Two d20s for the poisoned grappler and one for the defender.
  assert.equal(kit.d20s(out.dice), 3, `a poisoned grappler rolled ${out.dice.join(" ")}`);
});

await test("A paralyzed, petrified, stunned or unconscious creature automatically fails Strength and Dexterity saving throws, monster or not (SRD 5.1, Conditions).", async () => {
  for (const condition of AUTO_FAIL_STR_DEX) {
    kit.resetEnemy(goblin.id, [condition]);
    const out = await kit.withDice([1, 20], "aoe_damage", {
      damage: "1d6", saveAbility: "dex", dc: 5, halfOnSave: false, enemyIds: [goblin.id],
    });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    assert.equal(out.result.results[0].success, false, `${condition} enemy made a DEX save`);
  }
});

await test("A restrained creature has disadvantage on Dexterity saving throws (SRD 5.1, Conditions).", async () => {
  kit.resetEnemy(goblin.id, ["restrained"]);
  const out = await kit.withDice([1, 20, 2], "aoe_damage", {
    damage: "1d6", saveAbility: "dex", dc: 25, halfOnSave: false, enemyIds: [goblin.id],
  });
  assert.equal(kit.d20s(out.dice), 2, `a restrained enemy's DEX save rolled ${out.dice.join(" ")}`);
});
kit.resetEnemy(goblin.id);

await test("The grappled condition ends if the grappler is incapacitated (SRD 5.1, Conditions).", async () => {
  kit.reset(hero.id);
  kit.freshTurn();
  const seized = await kit.withDice([20, 1], "take_action", {
    characterId: hero.id, action: "grapple", targetEnemyId: goblin.id,
  });
  assert.equal(seized.result.success, true);
  assert.deepEqual(kit.enemy(goblin.id).conditions, ["grappled"]);
  await world.invoke("set_condition", { characterId: hero.id, condition: "stunned" });
  const held = kit.enemy(goblin.id).conditions;
  assert.deepEqual(held, [], `the grappler is stunned and the enemy is still ${held.join(", ")}`);
});

world.close();
finish();
