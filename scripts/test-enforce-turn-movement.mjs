// How far a combatant may still move on the turn it is taking, asked of
// every reader: the board's reachable tiles and the player's move route
// (pcMoveBudget, src/lib/battlemap/view.ts), and an enemy's move_token and
// the walk-up inside enemy_attack (src/lib/dm/enemy-approach.ts).
//
// SRD 5.1, Movement and Position: "On your turn, you can move a distance up
// to your speed." Movement belongs to a turn, so a creature with two turns
// in a round (a Thief's Reflexes, an ambusher playing the round the party
// lost and then its own) moves on each of them; one with one turn a round
// moves once. A human DM's rewind or goto moves the pointer and refills
// nothing (src/lib/dm/initiative-edit.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-turn-movement");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const { editInitiative } = await import("../src/lib/dm/initiative.ts");
const { oweEnemiesAnAction } = await import("../src/lib/dm/can-act.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");

const thief = world.addHero({
  class: "rogue", subclass: "Thief", level: 17, abilities: { dex: 10 }, proficiencies: TRAINED, maxHp: 200, speed: 30,
});
const fighter = world.addHero({
  name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }], maxHp: 200, speed: 30,
});

const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
async function walk(sheet, x, y) {
  world.signIn({ id: sheet.userId });
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return response.status;
}

// What the board lights for a character right now, in squares.
const lit = (sheet) => pcMoveBudget(world.campaignId, world.encounter(), kit.map(), world.sheet(sheet.id), kit.token(sheet.id)).tiles;
const current = () => {
  const entry = world.encounter().order[world.encounter().turnIndex];
  return entry.kind === "pc" ? entry.characterId : null;
};
const stepTo = (sheet) => {
  for (let turn = 0; turn < 10 && current() !== sheet.id; turn += 1) {
    const entry = world.encounter().order[world.encounter().turnIndex];
    kit.endTurn(entry.userId);
  }
  assert.equal(current(), sheet.id, "the pointer never reached the character");
};
const walkEnemy = async (enemy, x, y) => {
  const out = await world.invoke("move_token", { tokenName: enemy.id, x, y });
  return out.ok ? kit.token(enemy.id).x : out.error;
};

// ---- a second turn in the same round ----

await test("Thief's Reflexes: the thief's second turn in round 1 brings the thief's full movement, spent square by square like the first.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [thief.id]: 20, [fighter.id]: 15 } });
  kit.place(thief.id, 0, 0);
  assert.equal(await walk(thief, 6, 0), 200);
  kit.endTurn(thief.userId);
  kit.endTurn(fighter.userId);
  const reflex = world.encounter().order[world.encounter().turnIndex];
  assert.equal(reflex.reflex, true, "the pointer is not on the reflex turn");
  assert.equal(lit(thief), 6, "the board lights no movement on the reflex turn");
  assert.equal(await walk(thief, 10, 0), 200, "the move route refused the reflex turn's movement");
  assert.equal(lit(thief), 2);
  assert.ok((await walk(thief, 13, 0)) >= 400, "movement spent on the reflex turn came back within it");
});

await test("A combatant with one turn a round keeps one budget a round: what it walked stays spent through everyone else's turns and comes back on its own next turn.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 10 } });
  kit.place(fighter.id, 0, 0);
  assert.equal(await walk(fighter, 6, 0), 200);
  kit.endTurn(fighter.userId);
  assert.equal(lit(fighter), 0, "another turn starting gave the fighter movement");
  stepTo(fighter);
  assert.equal(lit(fighter), 6);
});

await test("A human DM's goto and step back move the pointer and refill nothing.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 10 } });
  kit.place(fighter.id, 0, 0);
  assert.equal(await walk(fighter, 6, 0), 200);
  kit.endTurn(fighter.userId);
  const goto = editInitiative(world.campaign(), { op: "goto", id: fighter.id });
  assert.equal("error" in goto, false, goto.error);
  assert.equal(lit(fighter), 0, "goto refilled the fighter's movement");
  kit.endTurn(fighter.userId);
  const back = editInitiative(world.campaign(), { op: "step", direction: "back" });
  assert.equal("error" in back, false, back.error);
  assert.equal(current(), fighter.id);
  assert.equal(lit(fighter), 0, "step back refilled the fighter's movement");
});

// The whole party surprised: round 2 opens at once and each goblin is owed
// the round-1 turn it took from them. `early` comes before the first
// character in the order, so its own round-2 turn is under way too; `late`
// comes after, and its own turn waits for the pointer.
async function ambush() {
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 2 }], { surprised: "party", enemyFace: 20 });
  kit.openField();
  kit.scatter();
  const [early, late] = world.enemies();
  const encounter = world.encounter();
  const lateEntry = encounter.order.find((entry) => entry.kind === "enemy" && entry.enemyId === late.id);
  const order = [...encounter.order.filter((entry) => entry !== lateEntry), { ...lateEntry, initiative: 0 }];
  kit.saveEncounter({ ...encounter, order, turnIndex: order.findIndex((entry) => entry.kind === "pc") });
  for (const enemy of [early, late]) {
    kit.setEnemy(enemy.id, { stats: { speed: "30 ft." }, maxHp: 400 });
  }
  kit.place(early.id, 0, 2);
  kit.place(late.id, 0, 8);
  kit.place(fighter.id, 7, 2);
  kit.place(thief.id, 7, 8);
  return { early, late };
}

await test("An ambusher ahead of the first character walks its speed on the round-1 turn it is owed and its speed again on its own round-2 turn.", async () => {
  const { early } = await ambush();
  assert.equal(await walkEnemy(early, 6, 2), 6);
  const owed = await world.invoke("enemy_attack", { enemyId: early.id, targetCharacterId: fighter.id });
  assert.equal(owed.ok, true, owed.error);
  assert.equal(await walkEnemy(early, 12, 2), 12, "the ambusher's own round-2 turn brought no movement");
  assert.equal(typeof (await walkEnemy(early, 13, 2)), "string", "the own turn's movement came back within it");
});

await test("An ambusher after the pointer walks on its owed turn only; its own turn's movement comes when the pointer passes it.", async () => {
  const { late } = await ambush();
  assert.equal(await walkEnemy(late, 6, 8), 6);
  const owed = await world.invoke("enemy_attack", { enemyId: late.id, targetCharacterId: thief.id });
  assert.equal(owed.ok, true, owed.error);
  assert.equal(typeof (await walkEnemy(late, 8, 8)), "string", "the owed turn's end gave a goblin whose own turn has not come movement");
  // Both characters end their turns: the pointer passes the goblin.
  const round = world.encounter().round;
  for (let turn = 0; turn < 4 && world.encounter().round === round; turn += 1) {
    kit.endTurn(world.encounter().order[world.encounter().turnIndex].userId);
  }
  assert.equal(await walkEnemy(late, 4, 8), 4, "the goblin's own turn brought no movement");
});

await test("An attack bought with a legendary action is not a turn: the enemy's movement stays spent.", async () => {
  const { early } = await ambush();
  // Both of its turns taken next to the fighter, its speed walked on each.
  for (const turn of ["owed", "own"]) {
    kit.place(early.id, 6, 2, 6);
    const swing = await world.invoke("enemy_attack", { enemyId: early.id, targetCharacterId: fighter.id });
    assert.equal(swing.ok, true, `${turn}: ${swing.error}`);
  }
  kit.place(early.id, 6, 2, 6);
  // What legendary_action records when its line names an attack
  // (src/lib/dm/legendary-tools.ts).
  const encounter = world.encounter();
  oweEnemiesAnAction(encounter, [early.id]);
  kit.saveEncounter(encounter);
  const strike = await world.invoke("enemy_attack", { enemyId: early.id, targetCharacterId: fighter.id });
  assert.equal(strike.ok, true, strike.error);
  assert.equal(typeof (await walkEnemy(early, 5, 2)), "string", "a legendary attack refilled the enemy's movement");
});

// ---- the speed an enemy moves at ----

for (const [label, conditions, tiles] of [
  ["no condition", [], 6],
  ["slowed (half speed)", ["slowed"], 3],
  ["hasted (double speed)", ["hasted"], 12],
  ["under Longstrider (+10 ft)", ["longstrider"], 8],
  ["at exhaustion 2 (half speed)", ["exhaustion 2"], 3],
  ["grappled (speed 0)", ["grappled"], 0],
]) {
  await test(`A goblin (30 ft) ${label} moves ${tiles} squares by move_token and by enemy_attack's walk-up, as a character would.`, async () => {
    await kit.endFight();
    await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 15 } });
    const [goblin] = world.enemies();
    kit.setEnemy(goblin.id, { stats: { speed: "30 ft." }, conditions });
    kit.place(goblin.id, 2, 10);
    await world.invoke("move_token", { tokenName: goblin.id, x: 16, y: 10 });
    assert.equal(kit.token(goblin.id).x - 2, tiles, "move_token");
    kit.place(goblin.id, 2, 14);
    kit.place(fighter.id, 17, 14);
    kit.freshRound();
    await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
    assert.equal(kit.token(goblin.id).x - 2, tiles, "enemy_attack's walk-up");
  });
}

await test("A prone goblin slowed to 15 ft stands for half of that and walks the rest.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 15 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { stats: { speed: "30 ft." }, conditions: ["prone", "slowed"] });
  kit.place(goblin.id, 2, 10);
  await world.invoke("move_token", { tokenName: goblin.id, x: 16, y: 10 });
  assert.equal(kit.enemy(goblin.id).conditions.includes("prone"), false, "the goblin stayed down");
  // Three squares slowed: one to stand, two to walk.
  assert.equal(kit.token(goblin.id).x - 2, 2);
});

await test("The board's intent for an enemy reads the speed it really has: a slowed goblin seven squares off reaches for its bow.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 15 } });
  const [goblin] = world.enemies();
  const attacks = [{ name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" }, { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }];
  kit.setEnemy(goblin.id, { stats: { speed: "30 ft.", attacks } });
  kit.place(goblin.id, 2, 10);
  kit.place(fighter.id, 9, 10);
  kit.place(thief.id, 18, 2);
  const intentOf = () => buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true, enemyNumbers: true }).intents
    .find((entry) => entry.actorTokenId === kit.token(goblin.id).id);
  assert.equal(intentOf().verb, "Scimitar");
  kit.setEnemy(goblin.id, { conditions: ["slowed"] });
  assert.equal(intentOf().verb, "Shortbow");
});

// ---- every action an ambusher spends closes the turn it was owed ----

// A table of its own: a wizard to counterspell, and a fighter to grapple.
const second = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit2 = await combatKit(second);
const kara2 = second.addHero({ name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 200, speed: 30 });
const wren = second.addHero({
  name: "Wren", class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED, maxHp: 200, speed: 30,
  spellcasting: { ability: "int", slots: { 3: { max: 2, used: 0 } }, prepared: ["Counterspell"], known: [], cantrips: [] },
});

// The goblin ahead of both characters has walked its speed on the turn it
// is owed; `act` spends that turn's action, and its own turn must walk again.
async function owedTurnClosedBy(label, act) {
  await kit2.endFight();
  await second.beginFight([{ monster: "goblin", count: 1 }], { surprised: "party", enemyFace: 20 });
  kit2.openField();
  kit2.scatter();
  const [goblin] = second.enemies();
  kit2.setEnemy(goblin.id, { stats: { speed: "30 ft." }, maxHp: 400 });
  kit2.place(kara2.id, 9, 2);
  kit2.place(wren.id, 9, 6);
  kit2.place(goblin.id, 8, 4, 6);
  const acted = await act(goblin);
  assert.equal(acted.ok, true, `${label}: ${acted.error}`);
  const live = second.enemies().find((entry) => entry.id === goblin.id);
  kit2.setEnemy(goblin.id, { conditions: [], conditionMeta: {} });
  const walked = await second.invoke("move_token", { tokenName: goblin.id, x: 2, y: 4 });
  assert.equal(walked.ok, true, `${label}: the own turn brought no movement (${walked.error})`);
  assert.equal(kit2.token(goblin.id).x, 2, label);
  return live;
}

await test("An ambusher's owed turn closed by a spell, a grapple escape, a spell's hold broken, or a countered spell gives its own turn fresh movement.", async () => {
  await owedTurnClosedBy("a spell", (goblin) =>
    second.invoke("cast_at_player", { characterId: kara2.id, casterEnemyId: goblin.id, saveAbility: "dex", dc: 12, damage: "1d6" }));
  await owedTurnClosedBy("a grapple escape", (goblin) => {
    kit2.setEnemy(goblin.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: kara2.id } } });
    return second.invoke("take_action", { action: "escape", enemyId: goblin.id });
  });
  await owedTurnClosedBy("a spell's hold", (goblin) => {
    kit2.setEnemy(goblin.id, { conditions: ["restrained"], conditionMeta: { restrained: { spell: "Entangle", source: wren.id } } });
    return second.invoke("take_action", { action: "escape", enemyId: goblin.id });
  });
  await owedTurnClosedBy("a countered spell", (goblin) =>
    second.invoke("use_reaction", { characterId: wren.id, feature: "Counterspell", targetEnemyId: goblin.id, spell: "Fireball" }));
});

await kit2.endFight();
second.close();
await kit.endFight();
world.close();
finish();
