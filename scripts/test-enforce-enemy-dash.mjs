// An enemy takes the Dash, the Disengage and the Dodge, and a creature that
// has to run runs the whole way (issue #621). SRD 5.1 opens Dash to every
// creature ("extra movement for the current turn ... equal to your speed,
// after applying any modifiers"); take_action resolved it for characters
// only, an enemy's walk always stopped at its speed, and the GM was told a
// turned undead "may only Dash". The enemy's turn now keeps its Dashes, its
// Disengage and what its action went on (src/lib/dm/enemy-turn-logic.ts),
// and every walk of its own reads them: move_token, enemy_attack's walk-up,
// standing from prone, the flight a turned or frightened creature makes.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-enemy-dash");
const world = await openWorld({ campaign: { maxPlayers: 4 } });
const kit = await combatKit(world);
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { autoActSkippedEnemies } = await import("../src/lib/dm/encounter-tools.ts");
const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");

const hero = world.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const priest = world.addHero({
  name: "Orin", class: "cleric", level: 2, maxHp: 30, proficiencies: TRAINED,
  abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }, { name: "Holy symbol", qty: 1, equipped: true }],
});

const NIMBLE = "Nimble Escape: The goblin can take the Disengage or Hide action as a bonus action on each of its turns.";

// One dummy (30 ft, AC 13, 40 HP) on an open field, both heroes far off.
async function stage(stats = {}, patch = {}) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [hero.id]: 20, [priest.id]: 18 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { stats: { ...DUMMY, ...stats }, maxHp: 400, ...patch });
  kit.place(hero.id, 19, 0);
  kit.place(priest.id, 19, 14);
  kit.place(enemy.id, 2, 7);
  return kit.enemy(enemy.id);
}

const act = (enemy, action, extra = {}) => world.invoke("take_action", { enemyId: enemy.id, action, ...extra });
const walk = (enemy, x, y, extra = {}) => world.invoke("move_token", { token: enemy.id, x, y, ...extra });
const attack = (enemy, target, extra = {}) => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id, ...extra });
const acted = (enemy) => {
  const ledger = world.encounter().legendary.acted;
  return Boolean(ledger && ledger.round === world.encounter().round && ledger.ids.includes(enemy.id));
};
const at = (enemy) => ({ x: kit.token(enemy.id).x, y: kit.token(enemy.id).y });
const apart = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// The model's call on a DM turn of the AI's own.
function aiTurn() {
  return createDmTurn(world.campaignId, [], "ai");
}
function ai(turn, name, args) {
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() });
}
// The turn's handoff, as end_turn writes it: these enemies are this DM turn's to play.
function handTo(turn, enemy) {
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, handoff: { turnId: turn.id, enemyIds: [enemy.id] } } });
}
function backstop(turn, enemy) {
  const sheets = listSheets(world.campaignId);
  autoActSkippedEnemies(world.campaign(), turn, world.encounter(), [enemy.id], sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
}
function enemyTurnEntryOf(enemy) {
  const encounter = world.encounter();
  const turns = encounter.legendary.turns;
  return turns && turns.round === encounter.round ? (turns.byId[enemy.id] ?? {}) : {};
}
function nextRound() {
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, round: encounter.round + 1 });
}

// ---- the Dash ----

await test("An enemy's Dash turns 30 ft into 60 ft: move_token walks it the whole way and the reply says so.", async () => {
  const goblin = await stage();
  const dash = await act(goblin, "dash");
  assert.equal(dash.ok, true, dash.error);
  assert.equal(dash.result.cost, "its action");
  assert.equal(dash.result.movementLeft, "Movement left this turn: 60 ft, counted by the board.");
  const run = await walk(goblin, 14, 7);
  assert.equal(run.ok, true, run.error);
  assert.deepEqual(at(goblin), { x: 14, y: 7 }, "the walk stopped at its speed");
  assert.equal(run.result.movementLeft, "Movement left this turn: 0 ft, counted by the board.");
  const more = await walk(goblin, 15, 7);
  assert.equal(more.refused, "rules");
  assert.match(more.error, /no movement left this turn \(speed 30 ft, 60 ft with its Dash\)/);
});

await test("A walk before the Dash counts against the doubled movement, and the next round is back to its speed.", async () => {
  const goblin = await stage();
  assert.equal((await walk(goblin, 6, 7)).ok, true);
  const dash = await act(goblin, "dash");
  assert.equal(dash.result.movementLeft, "Movement left this turn: 40 ft, counted by the board.");
  nextRound();
  kit.place(goblin.id, 2, 7, 0);
  const plain = await walk(goblin, 19, 7);
  assert.equal(plain.ok, true, plain.error);
  assert.deepEqual(at(goblin), { x: 8, y: 7 }, "last round's Dash still counted");
});

await test("An enemy that Dashed makes no attack with its action, and the refusal names the Dash.", async () => {
  const goblin = await stage();
  assert.equal((await act(goblin, "dash")).ok, true);
  kit.place(hero.id, 3, 7);
  const swing = await attack(goblin, hero);
  assert.equal(swing.ok, false);
  assert.equal(swing.refused, "rules");
  assert.equal(swing.error, `${goblin.displayName} took the Dash action this turn: its action is spent, so it makes no attack with it. It can still move, or use a bonus action or reaction.`);
});

await test("An attack its block prints as a bonus action is still open after the Dash.", async () => {
  const goblin = await stage({ attacks: [...DUMMY.attacks, { name: "Shiv", toHit: 4, damage: "1d4", type: "piercing", bonusAction: true }] });
  assert.equal((await act(goblin, "dash")).ok, true);
  kit.place(hero.id, 3, 7);
  kit.dice(18, 2);
  const shiv = await attack(goblin, hero, { attack: "Shiv" });
  world.clearDice();
  assert.equal(shiv.ok, true, shiv.error);
});

await test("A Dash at speed 0 is refused by the rules and spends nothing.", async () => {
  const goblin = await stage({}, { conditions: ["grappled"], conditionMeta: { grappled: { source: hero.id } } });
  const dash = await act(goblin, "dash");
  assert.equal(dash.refused, "rules");
  assert.match(dash.error, /speed is 0 right now/);
  assert.equal(acted(goblin), false, "the action was spent on a refused Dash");
});

await test("The AI cannot Dash or free an enemy before its turn comes.", async () => {
  const goblin = await stage({}, { conditions: ["grappled"], conditionMeta: { grappled: { source: hero.id } } });
  kit.giveTurn(hero.id);
  const turn = aiTurn();
  for (const action of ["dash", "escape"]) {
    const early = await ai(turn, "take_action", { enemyId: goblin.id, action });
    assert.equal(early.retry, true, `${action}: ${JSON.stringify(early)}`);
    assert.match(early.error, /turn has not come yet/);
  }
  assert.equal(acted(goblin), false);
});

await test("take_action names one creature: both ids are a retry that says which to drop.", async () => {
  const goblin = await stage();
  const both = await world.invoke("take_action", { characterId: hero.id, enemyId: goblin.id, action: "dash" });
  assert.equal(both.retry, true);
  assert.match(both.error, /not both/);
  assert.equal(acted(goblin), false);
});

await test("An action enemies do not take here is a retry naming the ones they do, after what bars the act.", async () => {
  const goblin = await stage();
  const help = await act(goblin, "help");
  assert.equal(help.retry, true);
  assert.match(help.error, /dash, disengage, dodge or escape/);
  kit.setEnemy(goblin.id, { conditions: ["stunned"] });
  const stunned = await act(goblin, "help");
  assert.equal(stunned.refused, "rules");
  assert.match(stunned.error, /stunned/);
});

await test("A flying enemy aloft moves at its flying speed.", async () => {
  const hawk = await stage({ speed: "10 ft., fly 60 ft." });
  assert.equal((await world.invoke("set_movement", { token: hawk.id, movement: "fly" })).ok, true);
  const flight = await walk(hawk, 14, 7);
  assert.equal(flight.ok, true, flight.error);
  assert.deepEqual(at(hawk), { x: 14, y: 7 }, "it flew at its walking speed");
});

await test("The board's guess at a flying enemy's next move counts its wings: the claws, not the rock, for a mark ten squares off.", async () => {
  const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
  const hawk = await stage({
    speed: "10 ft., fly 60 ft.",
    attacks: [
      { name: "Talons", toHit: 4, damage: "1d6+2", type: "slashing", mode: "melee", reach: 5 },
      { name: "Dropped Rock", toHit: 4, damage: "1d4", type: "bludgeoning", mode: "ranged", range: { normal: 30, long: 60 } },
    ],
  });
  kit.place(hero.id, 12, 7);
  const guess = () => buildPlayerMapView(world.campaignId, world.owner.id)?.intents?.find((intent) => intent.actorTokenId === kit.token(hawk.id).id);
  assert.equal(guess()?.verb, "Dropped Rock", "on foot it walks ten feet");
  assert.equal((await world.invoke("set_movement", { token: hawk.id, movement: "fly" })).ok, true);
  assert.equal(guess()?.verb, "Talons", "the board guessed from its walking speed while it flew");
});

await test("A prone enemy that walked its speed and then Dashed has the movement to stand.", async () => {
  const goblin = await stage({}, { conditions: ["prone"] });
  kit.place(goblin.id, 2, 7, 6);
  assert.equal((await act(goblin, "dash")).ok, true);
  const up = await walk(goblin, 4, 7);
  assert.equal(up.ok, true, up.error);
  assert.equal(kit.enemy(goblin.id).conditions.includes("prone"), false, "it stayed prone with its Dash unspent");
  assert.equal(kit.token(goblin.id).movedThisRound, 6 + 3 + 2);
});

await test("A refused Disengage leaves a prone enemy as it was: still prone, no movement spent.", async () => {
  const goblin = await stage({}, { conditions: ["prone"] });
  kit.place(hero.id, 3, 7);
  kit.dice(18, 2);
  assert.equal((await attack(goblin, hero, {})).ok, true, "its action, spent on an attack");
  // The attack stood it up; it is knocked down again.
  kit.setEnemy(goblin.id, { conditions: ["prone"] });
  kit.place(goblin.id, 2, 7, 0);
  const refused = await walk(goblin, 0, 7, { disengage: true });
  assert.equal(refused.refused, "rules");
  assert.equal(kit.enemy(goblin.id).conditions.includes("prone"), true, "the refusal stood it up");
  assert.equal(kit.token(goblin.id).movedThisRound, 0);
});

// ---- Disengage ----

await test("A Disengage holds for the turn: a second walk and the attack's walk-up draw no opportunity attack.", async () => {
  const goblin = await stage({ traits: [NIMBLE] });
  kit.place(hero.id, 3, 7);
  kit.place(priest.id, 1, 7);
  const away = await walk(goblin, 2, 5, { disengage: true });
  assert.equal(away.ok, true, away.error);
  assert.match(away.result.disengaged, /Nimble Escape/);
  assert.equal(away.result.opportunityAttacks, undefined);
  // Back beside the two of them and away again, the Disengage not sent.
  assert.equal((await walk(goblin, 2, 6)).ok, true);
  const again = await walk(goblin, 2, 4);
  assert.equal(again.ok, true, again.error);
  assert.equal(again.result.opportunityAttacks, undefined, "the second walk provoked");
  assert.match(again.result.disengaged, /earlier this turn/);
  // Its attack walks it from beside the cleric to the fighter.
  kit.place(goblin.id, 1, 8, 0);
  kit.place(hero.id, 4, 8);
  kit.dice(18, 2);
  const swing = await attack(goblin, hero);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.opportunityAttacks, undefined, "the walk-up provoked the cleric");
  assert.equal(world.encounter().legendary.bonus.ids.includes(goblin.id), true, "Nimble Escape is its bonus action");
});

await test("Nimble Escape is a bonus action, refused while the goblin is incapacitated.", async () => {
  const goblin = await stage({ traits: [NIMBLE] }, { conditions: ["incapacitated"] });
  const moved = await walk(goblin, 2, 5, { disengage: true });
  assert.equal(moved.refused, "rules");
  assert.match(moved.error, /incapacitated/);
  const taken = await act(goblin, "disengage");
  assert.equal(taken.refused, "rules");
  assert.equal(world.encounter().legendary.bonus?.ids?.includes(goblin.id) ?? false, false);
});

await test("take_action disengage is the enemy's action without Nimble Escape, and move_token honours it.", async () => {
  const goblin = await stage();
  kit.place(hero.id, 3, 7);
  const off = await act(goblin, "disengage");
  assert.equal(off.ok, true, off.error);
  assert.equal(off.result.cost, "its action (Disengage)");
  assert.equal(acted(goblin), true);
  const away = await walk(goblin, 0, 7);
  assert.equal(away.result.opportunityAttacks, undefined);
  kit.place(goblin.id, 2, 7, 0);
  assert.match((await attack(goblin, hero)).error, /took the Disengage action this turn/);
});

// ---- Dodge ----

await test("A dodging enemy is attacked at disadvantage and saves DEX at advantage until its next turn starts.", async () => {
  const goblin = await stage();
  const dodge = await act(goblin, "dodge");
  assert.equal(dodge.ok, true, dodge.error);
  assert.equal(kit.enemy(goblin.id).conditions.includes("dodging"), true);
  kit.place(hero.id, 3, 7);
  kit.giveTurn(hero.id);
  const swing = await kit.swing(hero.id, goblin.id, [15, 3, 5]);
  assert.equal(d20Faces(swing.toHit).length, 2, "the attack against it rolled one d20");
  assert.equal(swing.out.result.hit, false, "the lower die was not kept");
  // The damage first (3 + 6), then the DEX save: 3 and 19, the 19 kept.
  kit.dice(3, 6, 3, 19);
  const blast = await world.invoke("aoe_damage", { saveAbility: "dex", dc: 15, damage: "2d6", type: "fire", enemyIds: [goblin.id], reason: "a burst" });
  world.clearDice();
  assert.equal(blast.ok, true, blast.error);
  assert.equal(kit.enemy(goblin.id).currentHp, 400 - 4, "the DEX save was not made with advantage");
  // The priest ends the round's last character turn: the goblin's comes, and the Dodge ends.
  kit.giveTurn(priest.id);
  kit.endTurn(priest.userId);
  assert.equal(kit.enemy(goblin.id).conditions.includes("dodging"), false, "the Dodge outlasted the start of its turn");
});

// ---- a creature that has to run ----

const FEAR = (source) => ({
  conditions: ["frightened", "fleeing"],
  conditionMeta: { frightened: { spell: "Fear", source, rounds: 10 }, fleeing: { spell: "Fear", source, rounds: 10 } },
});

await test("A creature fleeing Fear Dashes and is moved its whole doubled speed away; it makes no attack.", async () => {
  const goblin = await stage({}, FEAR(priest.id));
  kit.place(priest.id, 0, 7);
  assert.match((await attack(goblin, priest)).error, /fleeing and makes no attacks while it lasts\. It can take another action: take_action with its enemyId/);
  assert.equal((await act(goblin, "dash")).ok, true);
  const run = await walk(goblin, 14, 7);
  assert.equal(run.ok, true, run.error);
  assert.equal(apart(at(goblin), { x: 0, y: 7 }), 14);
});

await test("A fleeing creature's turn played by the server Dashes it and runs it as far as it can.", async () => {
  const goblin = await stage({}, FEAR(priest.id));
  kit.place(priest.id, 0, 7);
  const turn = aiTurn();
  handTo(turn, goblin);
  backstop(turn, goblin);
  assert.equal(acted(goblin), true, "its turn took no action");
  assert.equal(apart(at(goblin), { x: 0, y: 7 }), 14, "it ran its speed, not twice it");
});

await test("A turned undead attacks no one, takes no opportunity attack, runs from the cleric on its turn, and damage ends the turning.", async () => {
  const zombie = await stage({ type: "undead", cr: 2 }, { cr: 2 });
  kit.place(zombie.id, 8, 7);
  kit.place(priest.id, 9, 7);
  const resources = world.sheet(priest.id).resources ?? {};
  world.patch(priest.id, { resources: { ...resources, channel_divinity: { ...(resources.channel_divinity ?? {}), max: 1, used: 0 } } });
  kit.giveTurn(priest.id);
  kit.dice(1);
  const turned = await world.invoke("use_resource", { characterId: priest.id, resource: "Channel Divinity", variant: "turn undead" });
  world.clearDice();
  assert.equal(turned.ok, true, turned.error);
  assert.equal(kit.enemy(zombie.id).conditions.includes("turned"), true, JSON.stringify(turned.result));
  assert.equal(kit.enemy(zombie.id).conditionMeta.turned.endsOnDamage, true);
  // No attack, on either side.
  const swing = await attack(zombie, priest);
  assert.equal(swing.refused, "rules");
  assert.match(swing.error, /turned and makes no attacks/);
  // The cleric walks out of its reach: no opportunity attack.
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: priest.userId });
  const hp = world.sheet(priest.id).currentHp;
  kit.dice(20, 6);
  const response = await route.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 12, y: 7 }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const unused = world.clearDice();
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(world.sheet(priest.id).currentHp, hp, "the turned zombie struck as the cleric left");
  assert.ok(unused >= 1, "an opportunity attack was rolled");
  // Its turn: it runs from the cleric, never closer.
  const before = apart(at(zombie), { x: 12, y: 7 });
  const turn = aiTurn();
  handTo(turn, zombie);
  backstop(turn, zombie);
  assert.ok(apart(at(zombie), { x: 12, y: 7 }) >= before + 6, `it ran ${apart(at(zombie), { x: 12, y: 7 }) - before} squares`);
  // Any damage ends it.
  const hurt = await world.invoke("apply_damage", { enemyId: zombie.id, amount: 3, type: "radiant", source: "hazard", reason: "sunlight" });
  assert.equal(hurt.ok, true, hurt.error);
  assert.equal(kit.enemy(zombie.id).conditions.includes("turned"), false, "damage left it turned");
});

await test("A turned undead with nowhere farther to run takes the Dodge.", async () => {
  const zombie = await stage({ type: "undead" }, { conditions: ["turned"], conditionMeta: { turned: { source: priest.id, rounds: 10, endsOnDamage: true } } });
  // In the corner, the cleric on the diagonal: every reachable square is nearer or as near.
  const board = kit.map();
  kit.place(zombie.id, 0, 0);
  kit.place(priest.id, 1, 1);
  kit.openField([[2, 0, "#"], [0, 2, "#"], [2, 1, "#"], [1, 2, "#"], [2, 2, "#"]].filter(([x, y]) => x < board.width && y < board.height));
  kit.place(hero.id, 19, 14);
  const turn = aiTurn();
  handTo(turn, zombie);
  backstop(turn, zombie);
  assert.equal(kit.enemy(zombie.id).conditions.includes("dodging"), true);
});

await test("Command's flee lays fleeing beside commanded, and the creature's turn runs it from the caster.", async () => {
  const goblin = await stage();
  kit.place(priest.id, 4, 7);
  const casting = world.sheet(priest.id).spellcasting;
  world.patch(priest.id, { spellcasting: { ...casting, ability: "wis", prepared: [...new Set([...(casting?.prepared ?? []), "Command"])], slots: { ...(casting?.slots ?? {}), 1: { max: 3, used: 0 } } } });
  kit.giveTurn(priest.id);
  world.say("player", "I command it to flee.", world.sheet(priest.id));
  kit.dice(1, 1);
  const cast = await world.invoke("cast_at_enemy", { characterId: priest.id, spell: "Command", targetEnemyId: goblin.id, condition: "flee", saveAbility: "wis" });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(kit.enemy(goblin.id).conditions.includes("fleeing"), true, JSON.stringify(kit.enemy(goblin.id).conditions));
  const turn = aiTurn();
  handTo(turn, goblin);
  backstop(turn, goblin);
  assert.ok(apart(at(goblin), { x: 4, y: 7 }) >= 2 + 6, "it did not run from the caster");
});

await test("A calmed creature's turn played by the server holds; it neither attacks nor runs.", async () => {
  const goblin = await stage({}, { conditions: ["calmed"], conditionMeta: { calmed: { spell: "Calm Emotions", source: priest.id, rounds: 10 } } });
  kit.place(hero.id, 3, 7);
  const hp = world.sheet(hero.id).currentHp;
  const turn = aiTurn();
  handTo(turn, goblin);
  backstop(turn, goblin);
  assert.deepEqual(at(goblin), { x: 2, y: 7 });
  assert.equal(world.sheet(hero.id).currentHp, hp);
});

await test("The console's run-the-monsters helper runs a fleeing creature and holds a calmed one, asking no model.", async () => {
  const { playMonsterTurns } = await import("../src/lib/dm/delegate.ts");
  const due = (enemy) => {
    const encounter = world.encounter();
    kit.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [enemy.id] } });
  };
  const goblin = await stage({}, FEAR(priest.id));
  kit.place(priest.id, 0, 7);
  due(goblin);
  const ran = await playMonsterTurns(world.campaign());
  assert.match(ran.notes.join(" "), /is fleeing: it takes the Dash action and runs to/);
  assert.equal(apart(at(goblin), { x: 0, y: 7 }), 14);
  const calm = await stage({}, { conditions: ["calmed"], conditionMeta: { calmed: { spell: "Calm Emotions", source: priest.id, rounds: 10 } } });
  due(calm);
  const held = await playMonsterTurns(world.campaign());
  assert.deepEqual(held.notes, [`${calm.displayName} is calmed and holds.`]);
});

// ---- an ambusher's owed turn, Haste, Aggressive ----

await test("An ambusher's Dash on the round it was owed carries that turn's movement into its own: three speeds in all.", async () => {
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 1 }], { surprised: "party", enemyFace: 20 });
  kit.openField();
  kit.scatter();
  const [early] = world.enemies();
  kit.setEnemy(early.id, { stats: { ...DUMMY }, maxHp: 400 });
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.kind === "pc") });
  kit.place(early.id, 0, 7);
  kit.place(hero.id, 19, 0);
  kit.place(priest.id, 19, 14);
  assert.equal((await walk(early, 2, 7)).ok, true);
  const dash = await act(early, "dash");
  assert.equal(dash.ok, true, dash.error);
  // 4 squares the owed turn had left, its Dash's 6, its own turn's 6.
  assert.equal(dash.result.movementLeft, "Movement left this turn: 80 ft, counted by the board.");
  assert.equal((await walk(early, 18, 7)).ok, true);
  assert.deepEqual(at(early), { x: 18, y: 7 });
  // Its own action is still its own.
  kit.place(hero.id, 19, 7);
  kit.dice(18, 2);
  assert.equal((await attack(early, hero)).ok, true);
});

await test("A hasted enemy's extra action Dashes, or makes one weapon attack, once.", async () => {
  const goblin = await stage({}, { conditions: ["hasted"] });
  kit.place(hero.id, 3, 7);
  kit.dice(18, 2);
  assert.equal((await attack(goblin, hero)).ok, true);
  const dash = await act(goblin, "dash");
  assert.equal(dash.ok, true, dash.error);
  assert.equal(dash.result.cost, "Haste's extra action");
  // Hasted: 60 ft, twice with the Dash.
  assert.equal(dash.result.movementLeft, "Movement left this turn: 120 ft, counted by the board.");
  assert.equal((await act(goblin, "dash")).refused, "rules");
  nextRound();
  assert.equal((await attack(goblin, hero)).ok, true);
  kit.dice(18, 2);
  const extra = await attack(goblin, hero);
  assert.equal(extra.ok, true, extra.error);
  assert.equal(extra.result.swings.length, 1);
  assert.equal((await attack(goblin, hero)).refused, "rules");
});

const AGGRESSIVE = "Aggressive: As a bonus action, the orc can move up to its speed toward a hostile creature that it can see.";

await test("An orc's Aggressive is a bonus-action Dash that leaves its action for the attack.", async () => {
  const orc = await stage({ traits: [AGGRESSIVE] });
  const rush = await act(orc, "dash", { bonus: true });
  assert.equal(rush.ok, true, rush.error);
  assert.match(rush.result.cost, /bonus action \(Aggressive\)/);
  assert.equal(acted(orc), false);
  const plain = await stage();
  assert.equal((await act(plain, "dash", { bonus: true })).refused, "rules", "a bonus-action Dash with no trait for it");
});

await test("Aggressive's speed carries the orc only toward a hostile it can see: its own speed goes anywhere, the rest only closer.", async () => {
  const orc = await stage({ traits: [AGGRESSIVE] });
  kit.place(orc.id, 8, 7);
  kit.place(hero.id, 15, 7);
  kit.place(priest.id, 15, 8);
  assert.equal((await act(orc, "dash", { bonus: true })).ok, true);
  // Eight squares away from the fighter: its own six, then Aggressive's
  // speed would carry it farther, so the walk stops.
  const back = await walk(orc, 0, 7);
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(at(orc), { x: 2, y: 7 });
  assert.match(back.result.note, /Aggressive carries .* only toward a hostile creature it can see/);
  const farther = await walk(orc, 1, 7);
  assert.equal(farther.refused, "rules");
  assert.match(farther.error, /Aggressive carries it only toward a hostile creature it can see/);
  // Toward the fighter it runs its whole Aggressive speed.
  const rush = await walk(orc, 8, 7);
  assert.equal(rush.ok, true, rush.error);
  assert.deepEqual(at(orc), { x: 8, y: 7 });
});

await test("A blinded orc sees no hostile to rush: its Aggressive Dash is refused, nothing spent.", async () => {
  const orc = await stage({ traits: [AGGRESSIVE] }, { conditions: ["blinded"] });
  const rush = await act(orc, "dash", { bonus: true });
  assert.equal(rush.refused, "rules");
  assert.match(rush.error, /sees no hostile creature/);
  assert.equal(world.encounter().legendary.bonus?.ids?.includes(orc.id) ?? false, false);
});

await test("A bonus-action attack on a creature fighting for the other side spends the bonus action, not the action.", async () => {
  const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [hero.id]: 20, [priest.id]: 18 } });
  const [goblin, thrall] = world.enemies();
  kit.setEnemy(goblin.id, { stats: { ...DUMMY, attacks: [...DUMMY.attacks, { name: "Shiv", toHit: 4, damage: "1d4", type: "piercing", bonusAction: true }] }, maxHp: 400 });
  kit.setEnemy(thrall.id, { stats: { ...DUMMY }, maxHp: 400 });
  moveToSide(world.campaign(), thrall.id, "party");
  kit.place(goblin.id, 2, 7);
  kit.place(thrall.id, 3, 7);
  kit.dice(18, 2);
  const shiv = await attack(kit.enemy(goblin.id), kit.enemy(thrall.id), { attack: "Shiv" });
  world.clearDice();
  assert.equal(shiv.ok, true, shiv.error);
  assert.equal(acted(goblin), false, "the bonus swing spent its action");
  assert.equal(world.encounter().legendary.bonus.ids.includes(goblin.id), true);
});

await test("Haste's extra swing at a creature fighting for the other side is a weapon attack too: a spell attack is refused, nothing spent.", async () => {
  const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [hero.id]: 20, [priest.id]: 18 } });
  const [mage, thrall] = world.enemies();
  kit.setEnemy(mage.id, { stats: { ...DUMMY, attacks: [...DUMMY.attacks, { name: "Fire Bolt", toHit: 5, damage: "1d10", type: "fire", spellAttack: true, mode: "ranged", range: { normal: 120, long: 120 } }] }, maxHp: 400, conditions: ["hasted"] });
  kit.setEnemy(thrall.id, { stats: { ...DUMMY }, maxHp: 400 });
  moveToSide(world.campaign(), thrall.id, "party");
  kit.place(mage.id, 2, 7);
  kit.place(thrall.id, 3, 7);
  kit.dice(18, 2);
  assert.equal((await attack(kit.enemy(mage.id), kit.enemy(thrall.id), { attack: "Club" })).ok, true, "its own action");
  world.clearDice();
  const bolt = await attack(kit.enemy(mage.id), kit.enemy(thrall.id), { attack: "Fire Bolt" });
  assert.equal(bolt.refused, "rules", JSON.stringify(bolt));
  assert.match(bolt.error, /one weapon attack/);
  assert.equal(enemyTurnEntryOf(mage).hasteUsed, undefined, "the refused bolt spent the extra action");
  kit.dice(18, 2);
  assert.equal((await attack(kit.enemy(mage.id), kit.enemy(thrall.id), { attack: "Club" })).ok, true, "the extra action's weapon swing");
  world.clearDice();
  assert.equal(enemyTurnEntryOf(mage).hasteUsed, true);
});

// ---- the GM's view ----

await test("The GM's view of an enemy says how far it may still walk and that it Dashed.", async () => {
  const goblin = await stage();
  assert.equal((await act(goblin, "dash")).ok, true);
  assert.equal((await walk(goblin, 6, 7)).ok, true);
  const view = publicEncounter(world.encounter(), world.enemies(), { enemyNumbers: true });
  assert.deepEqual(view.enemies[0].actions.movement, { speedFeet: 30, leftFeet: 40, dashes: 1, disengaged: false });
  const players = publicEncounter(world.encounter(), world.enemies(), {});
  assert.equal(players.enemies[0].actions, undefined, "a player was shown the enemy's movement");
});

await finish();
