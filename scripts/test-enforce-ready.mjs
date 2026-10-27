// Ready commits to one action, and every readied action can be released
// (issue 264): src/lib/dm/readied-kinds.ts, readied-release.ts, the doors in
// action-tools.ts, object-actions.ts and token-rules.ts, and the decision
// point inside an enemy's turn in enemy-approach.ts.
//
// SRD 5.1, Ready: "First, you decide what perceivable circumstance will
// trigger your reaction. Then, you choose the action you will take in
// response to that trigger, or you choose to move up to your speed in
// response to it. Examples include 'If the cultist steps on the trapdoor,
// I'll pull the lever that opens it,' and 'If the goblin steps next to me,
// I move away.' When the trigger occurs, you can either take your reaction
// right after the trigger finishes or ignore the trigger."
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
const { test, finish } = suite("test-enforce-ready");
const world = await openWorld();
const kit = await combatKit(world);
const { autoActSkippedEnemies } = await import("../src/lib/dm/encounter-tools.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { handExtraArgs } = await import("../src/lib/battlemap/hand-intent.ts");

const PACK = [
  { name: "Longsword", qty: 1 },
  { name: "Potion of Healing", qty: 2 },
];
const fighter = world.addHero({
  class: "fighter", level: 1, maxHp: 30, abilities: { str: 16 },
  proficiencies: { ...TRAINED, skills: ["athletics"] }, equipment: PACK,
});
const ally = world.addHero({
  class: "rogue", level: 1, maxHp: 30, abilities: { dex: 16 },
  proficiencies: TRAINED, equipment: [{ name: "Shortsword", qty: 1 }],
});
const heroes = [fighter, ally];

// A fight on `hero`'s turn, on open ground: the fighter at (5,5), the ally
// at (2,5), the enemy adjacent to the fighter unless `enemyAt` says where.
async function stage(hero, enemyAt = [5, 6]) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { currentHp: 30, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  world.patch(fighter.id, { equipment: PACK });
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.openField();
  kit.place(fighter.id, 5, 5);
  kit.place(ally.id, 2, 5);
  kit.place(enemy.id, ...enemyAt);
  assert.equal(kit.current().characterId, hero.id);
  return enemy;
}
// Puts the pointer on the enemy's slot with a fresh turn, as kit.giveTurn
// does for a character, so the enemy's own turn is where the test looks.
function toEnemyTurn(enemy) {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id);
  assert.ok(place >= 0, "the enemy has a place in the order");
  kit.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null });
  assert.equal(kit.current()?.kind, "enemy");
}
// The acting character's own action, which a release must not touch.
function actionUntouched(hero) {
  const budget = world.encounter().turnBudget;
  assert.ok(!budget || budget.ownerId !== hero.id || budget.actionUsed === false, "the acting character's action is untouched");
}
const act = (hero, action, args = {}) => world.invoke("take_action", { characterId: hero.id, action, ...args });
const name = (hero) => world.sheet(hero.id).name;
const held = (hero) => world.sheet(hero.id).conditions.includes("readied");
const reacted = (hero) => world.encounter().reactionsUsed.includes(hero.id);
const at = (refId) => [kit.token(refId).x, kit.token(refId).y];
const lastNote = () =>
  getDatabase().prepare(`SELECT content FROM campaign_messages WHERE campaign_id = ? ORDER BY seq DESC LIMIT 1`).get(world.campaignId)?.content ?? "";

await test("Ready names what it holds: an attack unless readied says otherwise, and the reply names the tool that releases it.", async () => {
  await stage(fighter);
  const move = await act(fighter, "ready", { trigger: "when the goblin steps next to me", readied: "move" });
  assert.equal(move.ok, true, move.error);
  assert.equal(move.result.readied, "move");
  assert.match(String(move.result.applied), /move_token/);
  assert.equal(world.encounter().turnBudget.actionUsed, true, "Ready is the action");
  assert.ok(held(fighter));
  assert.equal(world.sheet(fighter.id).conditionMeta.readied.holds, "move");

  await stage(fighter);
  const plain = await act(fighter, "ready", { trigger: "when it moves" });
  assert.equal(plain.ok, true, plain.error);
  assert.equal(plain.result.readied, "attack");
  assert.match(String(plain.result.applied), /pc_attack/);
  assert.equal(world.sheet(fighter.id).conditionMeta.readied.holds, undefined, "an attack is the default, written as before");
});

await test("A readied move releases off turn through move_token: the reaction, the full speed, the turn's own movement untouched, once.", async () => {
  await stage(fighter, [5, 9]);
  // Twenty feet already walked this turn: a turn's walk would have ten left.
  kit.place(fighter.id, 5, 5, 4);
  assert.equal((await act(fighter, "ready", { trigger: "when it comes next to me", readied: "move" })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  assert.equal(kit.current().characterId, ally.id);
  const walk = await world.invoke("move_token", { token: name(fighter), x: 5, y: 1 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual(at(fighter.id), [5, 1], "thirty feet, the character's full speed");
  assert.equal(kit.token(fighter.id).movedThisRound, 4, "their own turn's movement is as it was");
  assert.equal(walk.result.released, true);
  assert.ok(reacted(fighter));
  assert.ok(!held(fighter));
  const again = await world.invoke("move_token", { token: name(fighter), x: 5, y: 2 });
  assert.equal(again.ok, false, "a second move: nothing readied, not their turn");
  assert.deepEqual(at(fighter.id), [5, 1]);
});

await test("A readied Help releases through take_action help with the reaction, and the acting character's turn keeps its action.", async () => {
  const enemy = await stage(fighter);
  assert.equal((await act(fighter, "ready", { trigger: "when Pip lines up a strike", readied: "help" })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  const help = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(help.ok, true, help.error);
  assert.match(String(help.result.cost), /reaction/);
  assert.ok(reacted(fighter));
  assert.ok(!held(fighter));
  actionUntouched(ally);
});

await test("Releasing a different action than the one readied is refused and spends nothing; so is a release with the reaction gone.", async () => {
  const enemy = await stage(fighter);
  assert.equal((await act(fighter, "ready", { trigger: "when the ogre swings at Pip", readied: "help" })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  const hp = kit.enemy(enemy.id).currentHp;
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, false);
  assert.match(swing.error, /readied is Help .*not an attack/);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
  const lever = await act(fighter, "use_object", { item: "the lever" });
  assert.equal(lever.ok, false);
  assert.match(lever.error, /readied is Help .*not Use an Object/);
  const potion = await world.invoke("use_item", { characterId: fighter.id, item: "Potion of Healing" });
  assert.equal(potion.ok, false);
  assert.match(potion.error, /readied is Help/);
  assert.ok(held(fighter), "still readied");
  assert.ok(!reacted(fighter), "nothing spent");
  const encounter = world.encounter();
  encounter.reactionsUsed = [...encounter.reactionsUsed, fighter.id];
  kit.saveEncounter(encounter);
  const late = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(late.ok, false);
  assert.match(late.error, /already used their reaction/);
  assert.ok(held(fighter));
});

await test("A readied attack still releases only through pc_attack; a readied item through use_item.", async () => {
  const enemy = await stage(fighter);
  assert.equal((await act(fighter, "ready", { trigger: "when it moves" })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  const help = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(help.ok, false);
  assert.match(help.error, /readied is an attack .*not Help/);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.ok(reacted(fighter));
  assert.ok(!held(fighter));

  await stage(fighter);
  world.patch(fighter.id, { currentHp: 10 });
  assert.equal((await act(fighter, "ready", { trigger: "when the fire reaches me", readied: "item" })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  world.dice(1, 1);
  const drink = await world.invoke("use_item", { characterId: fighter.id, item: "Potion of Healing" });
  world.clearDice();
  assert.equal(drink.ok, true, drink.error);
  assert.equal(world.sheet(fighter.id).equipment.find((item) => item.name === "Potion of Healing")?.qty, 1);
  assert.ok(world.sheet(fighter.id).currentHp > 10, "the potion healed");
  assert.ok(reacted(fighter));
  assert.ok(!held(fighter));
  actionUntouched(ally);
});

await test("While a character holds a readied action, an enemy out of reach does not walk in and swing: the DM moves it, the trigger is answered, then it attacks.", async () => {
  const enemy = await stage(fighter, [5, 9]);
  assert.equal((await act(fighter, "ready", { trigger: "when it comes next to me" })).ok, true);
  toEnemyTurn(enemy);
  const heldBack = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id });
  assert.equal(heldBack.ok, false);
  assert.match(heldBack.error, /holds a readied action \(when it comes next to me\)/);
  assert.match(heldBack.error, /move_token/);
  assert.match(heldBack.error, new RegExp(name(fighter)));
  assert.deepEqual(at(enemy.id), [5, 9], "it did not walk");
  assert.equal(world.sheet(fighter.id).currentHp, 30, "and did not swing");
  // The DM walks it in; the trigger has come, and the readied attack answers it.
  const walk = await world.invoke("move_token", { token: enemy.displayName, x: 5, y: 6 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual(at(enemy.id), [5, 6]);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.ok(!held(fighter));
  // Then the enemy's own attack, its action still unspent.
  world.dice(15, 3);
  const attack = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id });
  world.clearDice();
  assert.equal(attack.ok, true, attack.error);
});

await test("An enemy already in reach attacks as before while a readied action is held; with nothing held the walk-up is as it was.", async () => {
  const enemy = await stage(fighter);
  assert.equal((await act(fighter, "ready", { trigger: "when it comes next to me" })).ok, true);
  toEnemyTurn(enemy);
  world.dice(15, 3);
  const attack = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id });
  world.clearDice();
  assert.equal(attack.ok, true, attack.error);

  const far = await stage(fighter, [5, 9]);
  toEnemyTurn(far);
  world.dice(15, 3);
  const walked = await world.invoke("enemy_attack", { enemyId: far.id, targetCharacterId: fighter.id });
  world.clearDice();
  assert.equal(walked.ok, true, walked.error);
  assert.deepEqual(at(far.id), [5, 6], "it walked in");
});

await test("The pass for skipped enemies holds an enemy out of reach too, and the table is told.", async () => {
  const enemy = await stage(fighter, [5, 9]);
  assert.equal((await act(fighter, "ready", { trigger: "when it closes" })).ok, true);
  toEnemyTurn(enemy);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const sheets = heroes.map((hero) => world.sheet(hero.id));
  autoActSkippedEnemies(world.campaign(), turn, world.encounter(), [enemy.id], sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  assert.deepEqual(at(enemy.id), [5, 9], "it did not walk");
  assert.equal(world.sheet(fighter.id).currentHp, 30);
  assert.match(lastNote(), new RegExp(`${enemy.displayName} does not close in while ${name(fighter)} holds a readied action`));
});

await test("The Hand's play line carries what was readied as take_action's readied.", () => {
  assert.deepEqual(handExtraArgs({ trigger: "when it steps next to me", readyAction: "move" }), ["trigger=when it steps next to me", "readied=move"]);
  assert.deepEqual(handExtraArgs({ trigger: "x", readySpell: "Magic Missile", readyLevel: 2 }), ["trigger=x", "spell=Magic Missile", "level=2"]);
});

await kit.endFight();
world.close();
finish();
