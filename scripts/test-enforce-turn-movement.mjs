// How far a combatant may still move on the turn it is taking, asked of
// every reader: the board's reachable tiles and the player's move route
// (pcMoveBudget, src/lib/battlemap/view.ts), an enemy's move_token and the
// walk-up inside enemy_attack (src/lib/dm/enemy-approach.ts), and the GAME
// STATE line the DM reads before it answers a typed move.
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
import { aiEngine, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-turn-movement");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const { editInitiative } = await import("../src/lib/dm/initiative.ts");
const { oweEnemiesAnAction } = await import("../src/lib/dm/can-act.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { removeTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");
const { moveTokenTool } = await import("../src/lib/dm/map-tools.ts");
const ai = await aiEngine(world);

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
const prone = (sheet) => world.sheet(sheet.id).conditions.includes("prone");
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

// ---- a move typed by the player ----

// A line in the transcript, as the actions route or the server writes it.
const say = (authorType, content, sheet) =>
  insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType,
    content,
    ...(sheet ? { userId: sheet.userId, characterId: sheet.id } : {}),
  });

async function typedMoveStage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 15 } });
  kit.place(fighter.id, 2, 2);
  kit.place(thief.id, 2, 6);
  say("dm", "The goblin bursts from the reeds. Kara, it's your turn.");
  ai.fresh();
}

await test("The AI walks the acting character the move their player just typed, from their own movement, as a board move would.", async () => {
  await typedMoveStage();
  say("player", "Kara hurries 20 feet east.", fighter);
  const out = await ai.invoke("move_token", { tokenName: fighter.id, x: 6, y: 2 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([kit.token(fighter.id).x, kit.token(fighter.id).y], [6, 2]);
  assert.equal(lit(fighter), 2, "the walk did not spend the character's movement");
  const far = await ai.invoke("move_token", { tokenName: fighter.id, x: 12, y: 2 });
  assert.equal(kit.token(fighter.id).x <= 8, true, `the walk went past the movement left: ${JSON.stringify(far)}`);
});

await test("The walk's result gives the new distances and the movement left, so the reply narrates the board's numbers.", async () => {
  await typedMoveStage();
  const [goblin] = world.enemies();
  kit.place(goblin.id, 10, 2);
  say("player", "Kara hurries 20 feet east.", fighter);
  const out = await ai.invoke("move_token", { tokenName: fighter.id, x: 6, y: 2 });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.movementLeft, "10 ft");
  // Grouped as the Combatants legend names them; the thief stands at (2,6),
  // four squares from (6,2).
  assert.equal(out.result.distancesNow, `Enemies: Goblin 20 ft. PCs: ${world.sheet(thief.id).name} 20 ft.`);
  // An enemy's move reads the same way, from where it landed.
  const moved = await ai.invoke("move_token", { tokenName: goblin.id, x: 9, y: 2 });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(moved.result.distancesNow, `PCs: ${world.sheet(thief.id).name} 35 ft; Kara 15 ft.`);
});

await test("A walk refused for want of movement says where the mover still stands and the board's distances from there.", async () => {
  await typedMoveStage();
  const [goblin] = world.enemies();
  kit.place(goblin.id, 10, 2, 6);
  kit.place(fighter.id, 2, 2, 6);
  say("player", "Kara charges another 15 feet east.", fighter);
  const out = await ai.invoke("move_token", { tokenName: fighter.id, x: 5, y: 2 });
  assert.equal(out.ok, false, "a walk with no movement left was accepted");
  assert.equal(out.error.endsWith(` Still at (2,2): Enemies: Goblin 40 ft. PCs: ${world.sheet(thief.id).name} 20 ft.`), true, out.error);
  const stuck = await ai.invoke("move_token", { tokenName: goblin.id, x: 8, y: 2 });
  assert.equal(stuck.ok, false, "an enemy walk with no movement left was accepted");
  assert.equal(stuck.error.endsWith(` Still at (10,2): PCs: ${world.sheet(thief.id).name} 40 ft; Kara 40 ft.`), true, stuck.error);
});

await test("A typed 'I get up' walked to the character's own square stands them up for half their speed; standing there already is refused.", async () => {
  await typedMoveStage();
  world.patch(fighter.id, { conditions: ["prone"] });
  say("player", "Kara gets up.", fighter);
  const stood = await ai.invoke("move_token", { tokenName: fighter.id, x: 2, y: 2 });
  assert.equal(stood.ok, true, stood.error);
  assert.equal(prone(fighter), false);
  assert.equal(lit(fighter), 3, "standing up cost no movement");
  const again = await ai.invoke("move_token", { tokenName: fighter.id, x: 2, y: 2 });
  assert.equal(again.ok, false, "a walk to where they already stand was accepted");
});

await test("A typed move walks nobody when the player said nothing this DM turn, only talked out of character, or it is somebody else's character.", async () => {
  await typedMoveStage();
  say("system", "Brom ends their turn. It is now Kara's turn.");
  const unasked = await ai.invoke("move_token", { tokenName: fighter.id, x: 6, y: 2 });
  assert.equal(unasked.ok, false, "a turn the player did not speak in walked their token");
  // The refusal and the tool's description say when a typed move walks.
  assert.match(unasked.error, /on their own turn, for the move their player just declared/);
  assert.match(moveTokenTool.function.description, /walking the move their player just declared/);
  say("player", "(ooc) brb, getting a drink", fighter);
  assert.equal((await ai.invoke("move_token", { tokenName: fighter.id, x: 6, y: 2 })).ok, false, "table talk walked the token");
  say("player", "Kara hurries 20 feet east.", fighter);
  assert.equal((await ai.invoke("move_token", { tokenName: thief.id, x: 6, y: 6 })).ok, false, "the acting player's message walked another character");
  assert.equal((await ai.invoke("move_token", { tokenName: fighter.id, x: 6, y: 2, forced: true })).ok, false, "a forced move on their own turn was allowed");
  // The human DM's console keeps today's rule: players walk their own tokens.
  assert.equal((await world.invoke("move_token", { tokenName: fighter.id, x: 6, y: 2 })).ok, false, "the console walked a player's token");
  assert.deepEqual([kit.token(fighter.id).x, kit.token(fighter.id).y], [2, 2]);
  assert.deepEqual([kit.token(thief.id).x, kit.token(thief.id).y], [2, 6]);
});

await test("A typed move does not walk a character off their turn.", async () => {
  await typedMoveStage();
  say("player", "Vex darts 20 feet east.", thief);
  assert.equal((await ai.invoke("move_token", { tokenName: thief.id, x: 6, y: 6 })).ok, false);
  assert.deepEqual([kit.token(thief.id).x, kit.token(thief.id).y], [2, 6]);
});

// ---- standing up ----

await test("The AI clearing a prone character on their own turn stands them up for half their speed, as the board does.", async () => {
  await typedMoveStage();
  world.patch(fighter.id, { conditions: ["prone"] });
  const out = await ai.invoke("clear_condition", { characterId: fighter.id, condition: "prone" });
  assert.equal(out.ok, true, out.error);
  assert.equal(prone(fighter), false);
  assert.equal(lit(fighter), 3, "standing up cost no movement");
});

await test("A character cannot stand up with less than half their speed left, at speed 0, or off their own turn; the human DM's console still clears prone freely.", async () => {
  await typedMoveStage();
  assert.equal(await walk(fighter, 6, 2), 200);
  world.patch(fighter.id, { conditions: ["prone"] });
  assert.equal((await ai.invoke("clear_condition", { characterId: fighter.id, condition: "prone" })).ok, false, "stood up with 2 squares left");
  assert.equal(prone(fighter), true);
  await typedMoveStage();
  world.patch(fighter.id, { conditions: ["prone", "grappled"] });
  assert.equal((await ai.invoke("clear_condition", { characterId: fighter.id, condition: "prone" })).ok, false, "stood up at speed 0");
  assert.equal(prone(fighter), true);
  world.patch(fighter.id, { conditions: [] });
  world.patch(thief.id, { conditions: ["prone"] });
  assert.equal((await ai.invoke("clear_condition", { characterId: thief.id, condition: "prone" })).ok, false, "stood up off their turn");
  assert.equal(prone(thief), true);
  assert.equal((await world.invoke("clear_condition", { characterId: thief.id, condition: "prone" })).ok, true, "the console lost its free hand");
  assert.equal(prone(thief), false);
});

await test("The Hand's Stand up card is judged as movement, not an action: allowed while only incapacitated, refused off the character's turn.", async () => {
  await typedMoveStage();
  const standUp = { card: "basic", action: "stand-up" };
  // Bare incapacitation takes actions, not movement (SRD 5.1).
  world.patch(fighter.id, { conditions: ["prone", "incapacitated"] });
  assert.equal(intentRefusal(world.campaign(), world.sheet(fighter.id), standUp), null, "standing up was judged as an action");
  world.patch(fighter.id, { conditions: [] });
  world.patch(thief.id, { conditions: ["prone"] });
  assert.match(String(intentRefusal(world.campaign(), world.sheet(thief.id), standUp)), /turn/);
  world.patch(thief.id, { conditions: [] });
});

// ---- what the DM is told ----

await test("GAME STATE gives the acting character's movement left this turn, the number the board lights.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 15 } });
  kit.place(fighter.id, 2, 2);
  assert.equal(await walk(fighter, 4, 2), 200);
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: "Kara holds her ground." })]);
  await model.turn(world, "Kara hurries 20 feet further west.", fighter.id, fighter.userId);
  const sent = model.requests[0].messages.map((message) => message.content).join("\n");
  model.close();
  assert.match(sent, /Movement left this turn: Kara 20 ft \(speed 30 ft\)/);
  // The Distances block gives each character their allies too.
  assert.match(sent, /- Kara: Enemies: [^\n]*\. PCs: [^\n]*\./);
  assert.equal(lit(fighter), 4);
});

await test("GAME STATE says nothing of movement for a character with no token on the board.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 20, [thief.id]: 15 } });
  removeTokenByRef(kit.map().id, fighter.id);
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: "Kara looks around." })]);
  await model.turn(world, "Kara looks around.", fighter.id, fighter.userId);
  const sent = model.requests[0].messages.map((message) => message.content).join("\n");
  model.close();
  assert.doesNotMatch(sent, /Movement left this turn/);
});

// ---- every action an ambusher spends closes the turn it was owed ----

// A table of its own: a wizard to counterspell, a fighter to grapple, and a
// Drunken Master whose Tipsy Sway makes standing up cost 5 feet.
const second = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit2 = await combatKit(second);
const kara2 = second.addHero({ name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 200, speed: 30 });
const wren = second.addHero({
  name: "Wren", class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED, maxHp: 200, speed: 30,
  spellcasting: { ability: "int", slots: { 3: { max: 2, used: 0 } }, prepared: ["Counterspell"], known: [], cantrips: [] },
});
const drunkard = second.addHero({ name: "Mei", class: "monk", subclass: "Way of the Drunken Master", level: 6, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED, maxHp: 200 });

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

await test("A typed move stands a character up for what their features make standing cost: Tipsy Sway's 5 feet, as on the board.", async () => {
  await kit2.endFight();
  await kit2.fight(1, { heroFaces: { [drunkard.id]: 20 } });
  kit2.place(drunkard.id, 4, 4);
  second.patch(drunkard.id, { conditions: ["prone"] });
  insertCampaignMessage({ campaignId: second.campaignId, seq: allocateSeq(second.campaignId), authorType: "player", content: "Mei gets up.", userId: drunkard.userId, characterId: drunkard.id });
  const ai2 = await aiEngine(second);
  const stood = await ai2.invoke("move_token", { tokenName: drunkard.id, x: 4, y: 4 });
  assert.equal(stood.ok, true, stood.error);
  assert.equal(kit2.token(drunkard.id).movedThisRound, 1, "standing did not cost Tipsy Sway's 5 feet");
});

await kit2.endFight();
second.close();
await kit.endFight();
world.close();
finish();
