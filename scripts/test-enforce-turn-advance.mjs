// Every fight keeps advancing, whatever happens to the combatants, and
// whenever an order is ready the turn rests on a player character whose
// player holds the floor. Every die that matters is forced.
//
// The rules, from the engine's own contract (src/lib/dm/encounter-tools.ts):
//   - With nobody able to act (down, incapacitated, surprised) the turn still
//     goes round: End Turn, the lead's skip and the model's end_turn move it,
//     and after each DM turn the server ends a turn its owner cannot take, so
//     the enemies keep acting, timed conditions run out, save-ends ones are
//     saved against, and the downed roll death saves, until somebody can act
//     again or nothing more can change.
//   - The order locks when the last initiative lands, even with nobody able
//     to act.
//   - A combatant who leaves the order holding the turn (a companion
//     dismissed, a summon dropped or turned hostile, a PC the DM took out)
//     takes no turn with them: it passes on as End Turn would, and whoever
//     acted before them does not get theirs back.
//   - An edit around the one acting keeps their turn and what it spent.
//   - The enemies a pass outside the model's own end_turn walks past are
//     due, at every table: the floor waits for them, End Turn included; the
//     next DM turn may play them, and its end plays the ones it leaves.
//   - A turn is named by whose it is, so an entry spliced in above the one
//     acting does not re-arm what happens once a turn.
//   - The model's own pass is said once, after its narration, and every
//     wake the server asks for leaves a note for the woken turn to answer.
//   - Pointer, floor, the engine's turn gate, the Hand and the board always
//     name the same combatant.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY } from "./lib/enforce-combat.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { allocateSeq, getFloor, setFloor, setDmMode } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");
const { createDmTurn, getDmTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter, insertEnemy, turnKey } = await import("../src/lib/db/encounters.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { actingCombatantId } = await import("../src/lib/dm/can-act.ts");
const { freshBudget } = await import("../src/lib/dm/action-budget.ts");
const { editInitiative, newNpcEntryId } = await import("../src/lib/dm/initiative.ts");
const { enemyTurnRefusal } = await import("../src/lib/dm/enemy-turn-order.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { spawnSummons, endSpellSummons } = await import("../src/lib/dm/summon-store.ts");
const { freshLastHit } = await import("../src/lib/dm/last-hit.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { findSummonForm } = await import("../src/lib/srd/summon-forms.ts");
const { summonSchema } = await import("../src/lib/schemas/summon.ts");

const { test, finish } = suite("test-enforce-turn-advance");

// The DM wakes the server asks for, per campaign.
const wakes = [];
registerDmWaker((campaignId) => wakes.push(campaignId));
const wokenFor = (world) => wakes.filter((id) => id === world.campaignId).length;

// ---- staging ----

// A table of `names.length` heroes and `goblins` dummies. Heroes roll from
// 19 down in the order named, the dummies 1 unless `goblinFace` says where
// they stand: with 12, a goblin sits after the first hero.
async function table(names, { goblins = 1, goblinFace = 1, world: options = {} } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, ...options });
  const kit = await combatKit(world);
  const heroes = names.map((name) => world.addHero({ name, abilities: { dex: 10, con: 10, wis: 10 } }));
  const heroFaces = Object.fromEntries(heroes.map((hero, index) => [hero.id, 19 - index * 8]));
  await kit.fight(goblins, { heroFaces, enemyFace: goblinFace });
  return { world, kit, heroes, campaign: () => world.campaign() };
}

const userOf = (world, sheetId) => world.sheet(sheetId).userId;
const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};
const currentName = (world) => current(world)?.name ?? null;

// The DM turn that just finished, as finalize() runs it: its narration is
// posted, then the turn order is settled. A DM turn the server wakes runs
// only when something was posted after the last narration (startDmTurn), so
// every wake must leave a note behind it.
function dmTurnEnds(world, turn = createDmTurn(world.campaignId, [], "ai")) {
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "The fight goes on." });
  const woken = wokenFor(world);
  tools.advanceAfterTurn(world.campaign(), turn);
  if (wokenFor(world) > woken) {
    const [last] = listRecentMessages(world.campaignId, 1);
    assert.notEqual(last.authorType, "dm", "a wake with nothing posted since the narration would be a DM turn that never runs");
  }
  return turn;
}

// The model's end_turn, through the console façade with an AI actor.
async function aiEndTurn(world, characterId, turn = createDmTurn(world.campaignId, [], "ai")) {
  return invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId } });
}

function stun(world, sheetId, condition) {
  if (condition === "0 hp") {
    world.patch(sheetId, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  } else {
    world.patch(sheetId, { conditions: [condition] });
  }
}

const deathSavesOf = (world, sheetId) =>
  listRecentRolls(world.campaignId, 200).filter((roll) => roll.characterId === sheetId && /death save/.test(roll.detail ?? ""));
const enemyRollsOf = (world, enemyId) =>
  listRecentRolls(world.campaignId, 200).filter((roll) => roll.attacker?.kind === "enemy" && roll.attacker.id === enemyId);

function killEnemy(enemyId) {
  getDatabase().prepare(`UPDATE encounter_enemies SET status = 'dead', current_hp = 0 WHERE id = ?`).run(enemyId);
}

// Pointer, floor, the engine's gate, the Hand and the board name the same
// player character, and only that character's player may end the turn.
function agree(world, kit, label) {
  const encounter = world.encounter();
  if (!encounter?.orderReady) {
    return;
  }
  const entry = encounter.order[encounter.turnIndex];
  assert.equal(entry?.kind, "pc", `${label}: the pointer rests on a player character, not ${entry?.kind} ${entry?.name}`);
  const floor = getFloor(world.campaignId);
  const fight = floor.mode === "hold" ? floor.next : floor;
  assert.equal(fight.mode, "initiative", `${label}: the fight holds the floor`);
  assert.deepEqual(fight.userIds, [entry.userId], `${label}: the floor names ${entry.name}'s player`);
  assert.equal(actingCombatantId(encounter), entry.characterId, `${label}: the engine's turn gate`);
  const shown = activePublicEncounter(world.campaignId);
  for (const sheet of world.sheets()) {
    const hand = turnFromEncounter(shown, sheet, { myTurn: false, currentName: "" });
    assert.equal(hand.myTurn, sheet.id === entry.characterId, `${label}: ${sheet.name}'s Hand`);
  }
  if (kit.map()) {
    const board = buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true });
    // A hero who joined mid-fight has no token yet, and the board marks none.
    assert.equal(board?.turn?.tokenId ?? null, kit.token(entry.characterId)?.id ?? null, `${label}: the board's turn token`);
  }
  for (const other of new Set(encounter.order.filter((one) => one.kind === "pc").map((one) => one.userId))) {
    if (other !== entry.userId) {
      assert.equal(tools.endOwnTurn(world.campaignId, other), false, `${label}: End Turn refused to another player`);
    }
  }
}

// A summoned wolf of Kara's, placed in the order as `initiative` says.
function summonWolf(world, caster, { initiative = "caster", rounds = 10, hostileOnBreak = false, spell = "Conjure Animals" } = {}) {
  const form = findSummonForm("wolf");
  const record = summonSchema.parse({
    spell,
    casterId: caster.id,
    casterName: caster.name,
    form: form.name,
    concentration: true,
    ...(hostileOnBreak ? { hostileOnBreak: true } : {}),
  });
  const [wolf] = spawnSummons(world.campaign(), world.sheet(caster.id), { form, count: 1, record, rounds, slotLevel: 3, initiative });
  return wolf;
}

// An AI companion, with the bot user behind it, rolled into the order.
function companion(world, name, initiative, template) {
  const bot = createCompanionUser(name);
  const sheet = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(template.id), name });
  markSheetAsCompanion(sheet.id, "party", "cheerful");
  tools.recordInitiativeRoll(world.campaignId, sheet.id, initiative);
  return world.sheet(sheet.id);
}

const orderNames = (world) => world.encounter().order.map((entry) => entry.name);
const due = (world) => world.encounter().legendary.due ?? [];
const handoff = (world) => world.encounter().legendary.handoff ?? null;

// ---- nobody able to act never freezes a fight ----
// (Some tests below hold on upstream too: they guard behaviour this change
// reroutes, a companion's turn or a newcomer who can act.)

const STOPS = ["0 hp", "stunned", "paralyzed", "unconscious", "incapacitated", "petrified"];

for (const stop of STOPS) {
  await test(`A solo hero ${stop} on their own turn can still hand it on, three ways`, async () => {
    const { world, kit, heroes: [kara] } = await table(["Kara"]);
    stun(world, kara.id, stop);
    // Death saves fail-safe: no run of failures kills her mid-test.
    world.dice(new Array(6).fill(10));
    assert.equal(kit.endTurn(userOf(world, kara.id)), true, "the player's End Turn");
    agree(world, kit, "after End Turn");
    assert.equal(world.encounter().round, 2, "the round went round");
    // The goblin the wrap walked past takes its turn before hers.
    kit.handOnEnemies();
    const ai = await aiEndTurn(world, kara.id);
    assert.equal(ai.ok, true, `the model's end_turn: ${ai.error ?? ""}`);
    agree(world, kit, "after end_turn");
    assert.equal(tools.skipCurrentTurn(world.campaignId), true, "the lead's skip");
    agree(world, kit, "after the skip");
    assert.equal(world.encounter().round, 4);
    world.clearDice();
  });

  await test(`With Brom already down, Kara ${stop} on her own turn can still hand it on`, async () => {
    const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"]);
    stun(world, brom.id, "0 hp");
    stun(world, kara.id, stop);
    // Death saves fail-safe: no natural 20 brings anyone back mid-test.
    world.dice(new Array(6).fill(10));
    assert.equal(kit.endTurn(userOf(world, kara.id)), true, "the player's End Turn");
    assert.equal(currentName(world), "Brom", "the turn comes to Brom, who cannot take it either");
    agree(world, kit, "on Brom");
    const ai = await aiEndTurn(world, brom.id);
    assert.equal(ai.ok, true, `the model's end_turn: ${ai.error ?? ""}`);
    assert.equal(currentName(world), "Kara");
    assert.equal(tools.skipCurrentTurn(world.campaignId), true, "the lead's skip");
    agree(world, kit, "after the skip");
    world.clearDice();
  });
}

await test("Paralyzed for 3 rounds, a solo hero sits them out with no input: the enemy acts, the condition runs out, the turn comes back", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  const set = await world.invoke("set_condition", { characterId: kara.id, condition: "paralyzed", rounds: 3 });
  assert.equal(set.ok, true, set.error);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.deepEqual(due(world), [goblin.id], "the goblin's turn is due, the floor held for it");
  const woken = wokenFor(world);
  // Round 2: still paralyzed. The DM turn the End Turn asked for ends, and
  // with it the turn Kara cannot take.
  for (let round = 0; round < 4 && current(world) && world.sheet(kara.id).conditions.includes("paralyzed"); round += 1) {
    world.dice(1, 1);
    dmTurnEnds(world);
    agree(world, kit, `round ${world.encounter().round}`);
  }
  assert.equal(world.sheet(kara.id).conditions.includes("paralyzed"), false, "the paralysis ran out");
  assert.equal(currentName(world), "Kara", "the turn is Kara's again, to take");
  assert.ok(enemyRollsOf(world, goblin.id).length >= 1, "the goblin acted while she could not");
  assert.ok(wokenFor(world) > woken, "the DM was woken to play the rounds");
  const settled = wokenFor(world);
  dmTurnEnds(world);
  assert.equal(currentName(world), "Kara", "a turn she can take is hers to end");
  assert.equal(wokenFor(world), settled, "and nobody is woken for it");
});

await test("The pass that brings the turn back to a hero who can act wakes the DM for the goblin it passed, so it acts before her", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const [goblin] = world.enemies();
  const set = await world.invoke("set_condition", { characterId: kara.id, condition: "paralyzed", rounds: 2 });
  assert.equal(set.ok, true, set.error);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(world.sheet(kara.id).conditions.includes("paralyzed"), true, "round 2, still paralyzed");
  const before = wokenFor(world);
  dmTurnEnds(world);
  assert.equal(world.sheet(kara.id).conditions.includes("paralyzed"), false, "round 3, free");
  assert.equal(currentName(world), "Kara");
  assert.deepEqual(due(world), [goblin.id], "the goblin's round-2 turn is due");
  assert.equal(getFloor(world.campaignId).mode, "hold", "Kara waits for it");
  assert.equal(wokenFor(world), before + 1, "and a DM turn is woken to play it before Kara's");
});

await test("A save-ends condition is saved against at the wrap while the fight goes round alone", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const set = await world.invoke("set_condition", { characterId: kara.id, condition: "stunned", saveAbility: "con", saveDc: 1 });
  assert.equal(set.ok, true, set.error);
  world.dice(10);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  world.clearDice();
  assert.equal(world.sheet(kara.id).conditions.includes("stunned"), false, "the save at the wrap ended it");
  assert.equal(currentName(world), "Kara");
  agree(world, kit, "after the save");
});

await test("The downed roll a death save each round the fight goes round; once all are stable the wakes stop", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"]);
  stun(world, brom.id, "0 hp");
  stun(world, kara.id, "0 hp");
  world.dice(15);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), "Brom");
  assert.equal(deathSavesOf(world, brom.id).length, 1, "Brom rolled as his turn came");
  for (let step = 0; step < 8 && !(world.sheet(kara.id).deathSaves.stable && world.sheet(brom.id).deathSaves.stable); step += 1) {
    world.dice(15);
    dmTurnEnds(world);
    agree(world, kit, `step ${step}`);
  }
  world.clearDice();
  assert.equal(world.sheet(kara.id).deathSaves.stable, true, "Kara stabilized on her third success");
  assert.equal(world.sheet(brom.id).deathSaves.stable, true, "so did Brom");
  assert.equal(deathSavesOf(world, kara.id).length, 3);
  assert.equal(deathSavesOf(world, brom.id).length, 3);
  const before = wokenFor(world);
  dmTurnEnds(world);
  dmTurnEnds(world);
  assert.equal(wokenFor(world), before, "the rounds stop waking the DM");
});

await test("A natural 20 on the death save the turn brings gives a real turn, and nobody is woken", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"]);
  stun(world, brom.id, "0 hp");
  stun(world, kara.id, "0 hp");
  world.dice(20);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  world.clearDice();
  assert.equal(currentName(world), "Brom");
  assert.equal(world.sheet(brom.id).currentHp, 1, "Brom is back on his feet");
  const before = wokenFor(world);
  dmTurnEnds(world);
  assert.equal(currentName(world), "Brom", "his turn stays his to take");
  assert.equal(wokenFor(world), before);
  agree(world, kit, "Brom revived");
});

await test("Healed while the turn rests on her, a downed hero takes it", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  stun(world, kara.id, "0 hp");
  world.dice(15);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  world.clearDice();
  const healed = await world.invoke("heal", { characterId: kara.id, amount: 30 });
  assert.equal(healed.ok, true, healed.error);
  const round = world.encounter().round;
  dmTurnEnds(world);
  assert.equal(world.encounter().round, round, "the turn did not go on without her");
  assert.equal(currentName(world), "Kara");
});

await test("With no enemy left standing the server stops waking the DM", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const [goblin] = world.enemies();
  stun(world, kara.id, "paralyzed");
  killEnemy(goblin.id);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  const before = wokenFor(world);
  dmTurnEnds(world);
  assert.equal(wokenFor(world), before, "nothing left to play");
  agree(world, kit, "no enemy left");
});

await test("The next hero drops during the enemies' turns before theirs: their turn is passed at once", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  assert.deepEqual(orderNames(world), ["Kara", goblin.displayName, "Brom"]);
  world.patch(brom.id, { currentHp: 1 });
  kit.place(kara.id, 1, 1);
  kit.place(brom.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ended = await aiEndTurn(world, kara.id, turn);
  assert.equal(ended.ok, true, ended.error);
  assert.equal(currentName(world), "Brom");
  const before = wokenFor(world);
  world.dice(20, 6, 6);
  dmTurnEnds(world, getDmTurn(turn.id));
  world.clearDice();
  assert.equal(world.sheet(brom.id).currentHp, 0, "the goblin the model left dropped Brom");
  assert.equal(currentName(world), "Kara", "Brom's turn, which he cannot take, was ended for him there and then");
  assert.equal(deathSavesOf(world, brom.id).length, 0, "no death save: his turn began before he fell");
  assert.equal(wokenFor(world), before, "Kara can act: nobody to wake");
  agree(world, kit, "back on Kara");
});

await test("A companion who cannot act has its turn ended, not played", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const pip = companion(world, "Pip", 18, kara);
  assert.deepEqual(orderNames(world).slice(0, 2), ["Kara", "Pip"]);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), "Pip");
  stun(world, pip.id, "stunned");
  dmTurnEnds(world);
  assert.equal(currentName(world), "Kara", "Pip's turn passed");
  assert.equal(
    listRecentRolls(world.campaignId, 200).filter((roll) => roll.characterId === pip.id && roll.kind === "attack").length,
    0,
    "no attack was taken for a stunned companion",
  );
  agree(world, kit, "after Pip");
});

await test("A hero joining while nobody can act gets the turn when it reaches them", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  stun(world, kara.id, "paralyzed");
  const lia = world.addHero({ name: "Lia" });
  tools.recordInitiativeRoll(world.campaignId, lia.id, 2);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), "Lia", "the newcomer, who can act, takes the next turn");
  agree(world, kit, "Lia joined");
});

await test("The DM's goto onto a downed hero hands the turn on after the next DM turn", async () => {
  const { world, kit, heroes: [, brom] } = await table(["Kara", "Brom"]);
  stun(world, brom.id, "0 hp");
  const gone = editInitiative(world.campaign(), { op: "goto", id: brom.id });
  assert.equal(gone.ok, true, gone.error);
  agree(world, kit, "on downed Brom");
  world.dice(15);
  dmTurnEnds(world);
  world.clearDice();
  assert.equal(currentName(world), "Kara");
});

await test("The DM's step forward goes round with nobody able to act", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  stun(world, kara.id, "paralyzed");
  const stepped = editInitiative(world.campaign(), { op: "step", direction: "forward" });
  assert.equal(stepped.ok, true, stepped.error);
  assert.equal(world.encounter().round, 2);
  agree(world, kit, "stepped");
});

await test("Under held responses the fight goes round the same, the hold wrapping each new turn", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  stun(world, kara.id, "paralyzed");
  setFloor(world.campaignId, { mode: "hold", next: getFloor(world.campaignId) });
  assert.equal(tools.skipCurrentTurn(world.campaignId), true, "the lead's skip");
  assert.equal(getFloor(world.campaignId).mode, "hold");
  agree(world, kit, "skip under a hold");
  dmTurnEnds(world);
  assert.equal(getFloor(world.campaignId).mode, "hold");
  agree(world, kit, "the chain under a hold");
});

await test("End Turn says the pass before the death save it brings", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"]);
  stun(world, kara.id, "paralyzed");
  stun(world, brom.id, "0 hp");
  world.dice(5);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  world.clearDice();
  const [passed, saved] = listRecentMessages(world.campaignId, 2).map((message) => message.content);
  assert.match(passed, /^Kara ends their turn\. It is now Brom's turn\./, "the pass is said first");
  assert.match(saved, /^Brom death save/, "then the death save that begins his turn");
});

await test("Every wake leaves a note: the model's end_turn landing on a companion wakes the DM to play it", async () => {
  const { world, heroes: [kara] } = await table(["Kara"]);
  const pip = companion(world, "Pip", 18, kara);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ended = await aiEndTurn(world, kara.id, turn);
  assert.equal(ended.ok, true, ended.error);
  assert.equal(currentName(world), pip.name);
  const before = wokenFor(world);
  dmTurnEnds(world, getDmTurn(turn.id));
  assert.equal(wokenFor(world), before + 1, "Pip's turn wakes the DM");
  const transcript = listRecentMessages(world.campaignId, 20);
  const lines = transcript.filter((message) => /It is now Pip's turn/.test(message.content));
  assert.equal(lines.length, 1, "the move is said once");
  assert.equal(transcript.at(-1).content, lines[0].content, "after the narration, where the woken turn finds it");
});

// ---- the order always locks ----

for (const ambushed of [true, false]) {
  await test(`The order locks with nobody able to act when the last initiative lands (${ambushed ? "ambushed" : "not ambushed"})`, async () => {
    const world = await openWorld({ campaign: { maxPlayers: 8 } });
    const kit = await combatKit(world);
    const kara = world.addHero({ name: "Kara" });
    world.patch(kara.id, { conditions: ["paralyzed"] });
    const encounter = createEncounter(world.campaignId, "Ambush");
    insertEnemy({ encounterId: encounter.id, campaignId: world.campaignId, slug: "goblin", displayName: "Goblin", initiative: 12, stats: DUMMY });
    encounter.surprisedIds = ambushed ? [kara.id] : [];
    kit.saveEncounter(encounter);
    assert.ok(tools.recordInitiativeRoll(world.campaignId, kara.id, 15), "combat begins");
    assert.equal(world.encounter().orderReady, true, "the order locked");
    agree(world, kit, "locked");
    assert.equal(kit.endTurn(userOf(world, kara.id)), true, "and the turn moves on");
    agree(world, kit, "moved on");
  });
}

// ---- a combatant who leaves takes no turn with them ----

await test("A companion dismissed on its own turn hands it on: Brom gets the turn, Kara does not get hers back", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  const pip = companion(world, "Pip", 18, kara);
  assert.deepEqual(orderNames(world), ["Kara", "Pip", goblin.displayName, "Brom"]);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), "Pip");
  const dismissed = await world.invoke("dismiss_companion", { characterId: pip.id });
  assert.equal(dismissed.ok, true, dismissed.error);
  assert.equal(currentName(world), "Brom");
  assert.deepEqual(due(world), [goblin.id], "the goblin's turn began and is due");
  agree(world, kit, "after the dismissal");
});

await test("A companion dismissed on its own turn with an enemy before it: the turn does not fall on the enemy", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"], { goblinFace: 20 });
  const [goblin] = world.enemies();
  const pip = companion(world, "Pip", 12, kara);
  assert.deepEqual(orderNames(world), [goblin.displayName, "Kara", "Pip"]);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), "Pip");
  const dismissed = await world.invoke("dismiss_companion", { characterId: pip.id });
  assert.equal(dismissed.ok, true, dismissed.error);
  assert.equal(currentName(world), "Kara", "round 2 comes round to Kara");
  assert.equal(world.encounter().round, 2);
  agree(world, kit, "after the dismissal");
});

await test("A summon dropped to 0 hit points on its own turn hands it on", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  const wolf = summonWolf(world, kara);
  assert.deepEqual(orderNames(world), ["Kara", wolf.name, goblin.displayName, "Brom"]);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), wolf.name);
  const hit = await world.invoke("apply_damage", { characterId: wolf.id, amount: 200 });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(world.sheet(wolf.id), null, "the wolf is gone");
  assert.equal(currentName(world), "Brom");
  assert.deepEqual(due(world), [goblin.id]);
  agree(world, kit, "after the wolf");
});

await test("A summon turned hostile on its own turn hands it on, and its new self acts at its count next round", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  const wolf = summonWolf(world, kara, { hostileOnBreak: true, spell: "Conjure Fey" });
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), wolf.name);
  const before = tools.turnHolder(world.campaignId);
  endSpellSummons(world.campaign(), "Conjure Fey", kara.id);
  tools.settleTurn(world.campaign(), before);
  const hostile = world.enemies().find((enemy) => enemy.id !== goblin.id);
  assert.ok(hostile, "the wolf is an enemy now");
  assert.equal(orderNames(world)[1], hostile.displayName, "in the wolf's place");
  assert.equal(currentName(world), "Brom");
  assert.deepEqual(due(world), [goblin.id], "the goblin is due, the hostile wolf is not");
  agree(world, kit, "after the wolf turned");
});

await test("The enemy the backstop plays dropping the summon whose turn it is hands the turn on", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  const wolf = summonWolf(world, kara);
  assert.equal(editInitiative(world.campaign(), { op: "set-initiative", id: wolf.id, initiative: 5 }).ok, true);
  assert.deepEqual(orderNames(world), ["Kara", goblin.displayName, wolf.name]);
  kit.place(kara.id, 1, 1);
  kit.place(goblin.id, 6, 6);
  kit.place(wolf.id, 6, 7);
  world.patch(wolf.id, { currentHp: 1 });
  const turn = createDmTurn(world.campaignId, [], "ai");
  assert.equal((await aiEndTurn(world, kara.id, turn)).ok, true);
  assert.equal(currentName(world), wolf.name);
  world.dice(20, 6, 6, 6);
  dmTurnEnds(world, getDmTurn(turn.id));
  world.clearDice();
  assert.equal(world.sheet(wolf.id), null, "the goblin the model left killed the wolf");
  assert.equal(currentName(world), "Kara");
  agree(world, kit, "after the backstop");
});

await test("The DM taking out the hero whose turn it is passes it on, and the floor follows", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara", "Brom"], { goblinFace: 20 });
  const [goblin] = world.enemies();
  assert.deepEqual(orderNames(world), [goblin.displayName, "Kara", "Brom"]);
  assert.equal(currentName(world), "Kara");
  // Brom slides into Kara's slot: the slot number alone would not say the
  // turn changed hands.
  const removed = editInitiative(world.campaign(), { op: "remove", id: kara.id });
  assert.equal(removed.ok, true, removed.error);
  assert.equal(currentName(world), "Brom");
  agree(world, kit, "after the removal");
});

await test("A summon whose spell runs out at the wrap, just as the turn reaches it, hands it on", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const wolf = summonWolf(world, kara, { initiative: "group", rounds: 1 });
  const [goblin] = world.enemies();
  // The wolf at the top, the goblin under it: once the wolf goes, the slot
  // it leaves falls to the goblin.
  const encounter = world.encounter();
  const by = (id) => encounter.order.find((entry) => (entry.characterId ?? entry.enemyId) === id);
  kit.saveEncounter({ ...encounter, order: [by(wolf.id), by(goblin.id), by(kara.id)], turnIndex: 2 });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(world.sheet(wolf.id), null, "the wolf faded at the wrap");
  assert.equal(currentName(world), "Kara", "the turn passed over the goblin back to Kara");
  assert.equal(world.encounter().round, 2);
  agree(world, kit, "after the wolf faded");
});

await test("At a person's table, a pass that goes on past a summon gone as its turn began holds the enemies of both legs", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"], { goblins: 2 });
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the DM seat");
  const wolf = summonWolf(world, kara, { initiative: "group", rounds: 1 });
  const [first, second] = world.enemies();
  const encounter = world.encounter();
  const by = (id) => encounter.order.find((entry) => (entry.characterId ?? entry.enemyId) === id);
  kit.saveEncounter({ ...encounter, order: [by(first.id), by(wolf.id), by(second.id), by(kara.id), by(brom.id)], turnIndex: 4 });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  assert.equal(kit.endTurn(userOf(world, brom.id)), true);
  assert.equal(world.sheet(wolf.id), null, "the wolf faded at the wrap");
  assert.equal(currentName(world), "Kara");
  assert.deepEqual(world.encounter().legendary.due, [first.id, second.id], "the goblin before the wolf and the one after it");
  assert.equal(getFloor(world.campaignId).mode, "hold");
  agree(world, kit, "held for both");
});

await test("A summon ending its own turn as its spell runs out at the wrap is passed once, not twice", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"]);
  const wolf = summonWolf(world, kara, { initiative: "group", rounds: 1 });
  const encounter = world.encounter();
  const by = (id) => encounter.order.find((entry) => (entry.characterId ?? entry.enemyId) === id);
  const [goblin] = world.enemies();
  kit.saveEncounter({ ...encounter, order: [by(kara.id), by(brom.id), by(goblin.id), by(wolf.id)], turnIndex: 3 });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  const ended = await aiEndTurn(world, wolf.id);
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.sheet(wolf.id), null, "the wolf faded at the wrap its own turn ended in");
  assert.equal(currentName(world), "Kara", "round 2 opens on Kara");
  assert.equal(world.encounter().round, 2);
  agree(world, kit, "after the wolf's last turn");
});

// ---- an edit around the one acting keeps their turn ----

await test("Inserting, moving and re-scoring around the hero acting keeps what her turn spent", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara", "Brom"], { goblins: 2, goblinFace: 12 });
  const [goblin] = world.enemies();
  const encounter = world.encounter();
  const spent = {
    ...freshBudget({ ownerId: kara.id, round: encounter.round }),
    actionUsed: true,
    bonusUsed: true,
    attacksMade: 1,
    dashed: true,
  };
  kit.saveEncounter({ ...encounter, turnBudget: spent, reactionsUsed: [kara.id] });
  for (const edit of [
    { op: "insert", id: newNpcEntryId(), name: "Captain", initiative: 30 },
    { op: "move", id: goblin.id, direction: "up" },
    { op: "set-initiative", id: goblin.id, initiative: 25 },
  ]) {
    const done = editInitiative(world.campaign(), edit);
    assert.equal(done.ok, true, `${edit.op}: ${done.error ?? ""}`);
    assert.equal(currentName(world), "Kara", `${edit.op}: still Kara's turn`);
    assert.deepEqual(world.encounter().turnBudget, spent, `${edit.op}: her spent action, bonus action, attack and Dash stay spent`);
    assert.deepEqual(world.encounter().reactionsUsed, [kara.id], `${edit.op}: and so does her reaction`);
    agree(world, kit, edit.op);
  }
});

await test("The DM delaying the hero acting hands the floor to the one who slides into her place", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara", "Brom"], { goblinFace: 20 });
  assert.deepEqual(orderNames(world).slice(1), ["Kara", "Brom"]);
  const delayed = editInitiative(world.campaign(), { op: "delay", id: kara.id });
  assert.equal(delayed.ok, true, delayed.error);
  assert.equal(currentName(world), "Brom");
  agree(world, kit, "after the delay");
});

// ---- the enemies a pass walks past get their turn ----

await test("A solo hero's End Turn wraps the round, and the goblin after her is due: the model may play it, the server does if it does not", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.deepEqual(due(world), [goblin.id]);
  const turn = createDmTurn(world.campaignId, [], "ai");
  assert.equal(enemyTurnRefusal(world.encounter(), goblin, turn), null, "the model may play the goblin");
  world.dice(20, 6);
  dmTurnEnds(world, turn);
  world.clearDice();
  assert.ok(enemyRollsOf(world, goblin.id).length >= 1, "the goblin the model left was acted by the server");
  assert.deepEqual(due(world), []);
  assert.equal(getFloor(world.campaignId).mode, "initiative", "and the hold is lifted");
  agree(world, kit, "the goblin played");
});

await test("With a goblin between two heroes, End Turn holds the floor for it and Brom's turn opens once it has acted", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  kit.place(brom.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.deepEqual(due(world), [goblin.id]);
  assert.equal(getFloor(world.campaignId).mode, "hold", "Brom waits for the goblin");
  assert.equal(tools.endOwnTurn(world.campaignId, userOf(world, brom.id)), false, "and cannot end a turn that has not begun");
  world.dice(20, 6);
  dmTurnEnds(world);
  world.clearDice();
  assert.ok(enemyRollsOf(world, goblin.id).length >= 1);
  assert.equal(getFloor(world.campaignId).mode, "initiative");
  assert.equal(kit.endTurn(userOf(world, brom.id)), true, "now Brom's turn is his to end");
});

await test("The lead's skip leaves the enemies it passes due", async () => {
  const { world } = await table(["Kara"]);
  const [goblin] = world.enemies();
  assert.equal(tools.skipCurrentTurn(world.campaignId), true);
  assert.deepEqual(due(world), [goblin.id]);
});

await test("A departure inside the AI's turn leaves the enemies its pass reaches due, for that same turn to play", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  const wolf = summonWolf(world, kara);
  kit.place(brom.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(currentName(world), wolf.name);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const hit = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "apply_damage", args: { characterId: wolf.id, amount: 200 } });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(currentName(world), "Brom");
  assert.equal(enemyTurnRefusal(world.encounter(), goblin, turn), null, "the model may play the goblin in this turn");
  world.dice(20, 6);
  dmTurnEnds(world, getDmTurn(turn.id));
  world.clearDice();
  assert.ok(enemyRollsOf(world, goblin.id).length >= 1, "and the server does when it does not");
});

for (const dmMode of ["ai", "human"]) {
  await test(`End Turn is refused while the enemies before it are due, so a second pass cannot leave them behind (${dmMode} DM)`, async () => {
    const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"], { goblinFace: 12 });
    if (dmMode === "human") {
      assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the DM seat");
    }
    const [goblin] = world.enemies();
    assert.equal(kit.endTurn(userOf(world, kara.id)), true);
    assert.equal(current(world).characterId, brom.id, "the pointer is on Brom, the board offering him End Turn");
    assert.equal(tools.endOwnTurn(world.campaignId, userOf(world, brom.id)), false, "refused while the goblin is due");
    assert.deepEqual(due(world), [goblin.id], "the goblin is still due");
    agree(world, kit, "held");
  });
}

await test("The model's end_turn waits for the enemies due before it; played, the turn passes and the next round's turns are taken too", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"], { goblins: 2, world: { campaign: { maxPlayers: 8, difficulty: "deadly" } } });
  const goblins = world.enemies();
  world.patch(kara.id, { maxHp: 200, currentHp: 200 });
  kit.place(kara.id, 5, 5);
  goblins.forEach((goblin, index) => kit.place(goblin.id, 4 + index * 2, 6));
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const early = await aiEndTurn(world, kara.id, turn);
  assert.match(early.error ?? "", /Goblin 1 and Goblin 2 act before Kara/, "the round-1 goblins come first");
  for (const goblin of goblins) {
    world.dice(1);
    const played = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "enemy_attack", args: { enemyId: goblin.id, targetCharacterId: kara.id } });
    world.clearDice();
    assert.equal(played.ok, true, played.error);
  }
  const ended = await aiEndTurn(world, kara.id, turn);
  assert.equal(ended.ok, true, ended.error);
  assert.equal(handoff(world).turnId, turn.id, "the model's own pass is handed to it, not held");
  world.dice(1, 1);
  dmTurnEnds(world, getDmTurn(turn.id));
  world.clearDice();
  const attacks = goblins.map((goblin) => enemyRollsOf(world, goblin.id).filter((roll) => roll.kind === "attack").length);
  assert.deepEqual(attacks, [2, 2], "each goblin's round-1 turn, played by the model, and its round-2 turn, by the server");
});

await test("A person at the console ends no turn while the enemies before it still have their action", async () => {
  const { world, kit, heroes: [kara, brom] } = await table(["Kara", "Brom"], { goblinFace: 12 });
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the DM seat");
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  const early = await world.invoke("end_turn", { characterId: brom.id });
  assert.match(early.error ?? "", /acts before Brom/);
  kit.handOnEnemies();
  const ended = await world.invoke("end_turn", { characterId: brom.id });
  assert.equal(ended.ok, true, ended.error);
});

await test("The AI's fight opening on enemies ahead of the first hero leaves them due, and its turn's end plays the ones the model left", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"], { goblinFace: 20 });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  assert.deepEqual(orderNames(world), [goblin.displayName, "Kara"]);
  assert.deepEqual(due(world), [goblin.id]);
  assert.equal(tools.endOwnTurn(world.campaignId, userOf(world, kara.id)), false, "Kara's turn waits for the goblin");
  world.dice(20, 6);
  dmTurnEnds(world);
  world.clearDice();
  assert.ok(enemyRollsOf(world, goblin.id).length >= 1);
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
});

await test("At a human DM's table a pass leaves no handoff: the DM runs the enemies", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the DM seat");
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.equal(handoff(world), null);
});

// ---- a turn is named by whose it is ----

await test("An insert above the hero acting keeps her turn's key and a fresh hit on her answerable; her next turn does not", async () => {
  const { world, kit, heroes: [kara] } = await table(["Kara"]);
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  world.dice(20, 6);
  const swung = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(swung.ok, true, swung.error);
  assert.ok(freshLastHit(world.campaignId, kara.id), "the hit is answerable this turn");
  const key = turnKey(world.encounter());
  const inserted = editInitiative(world.campaign(), { op: "insert", id: newNpcEntryId(), name: "Captain", initiative: 30 });
  assert.equal(inserted.ok, true, inserted.error);
  assert.equal(turnKey(world.encounter()), key, "the same turn");
  assert.ok(freshLastHit(world.campaignId, kara.id), "still answerable after the insert");
  assert.equal(kit.endTurn(userOf(world, kara.id)), true);
  assert.notEqual(turnKey(world.encounter()), key, "her next turn is another");
  assert.equal(freshLastHit(world.campaignId, kara.id), null);
});

await test("No once-a-turn stamp is built from the slot number", () => {
  const root = path.join(import.meta.dirname, "..", "src");
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && /round\}:\$\{[a-zA-Z.]*turnIndex\}/.test(fs.readFileSync(full, "utf8"))) {
        offenders.push(path.relative(root, full));
      }
    }
  })(root);
  assert.deepEqual(offenders, [], "use turnKey (src/lib/db/encounters.ts)");
});

// ---- one answer everywhere ----

await test("One answer everywhere: a mixed order walked through every path that moves the turn", async () => {
  const { world, kit, heroes: [kara, brom, cora] } = await table(["Kara", "Brom", "Cora"], { goblinFace: 12 });
  const [goblin] = world.enemies();
  const pip = companion(world, "Pip", 15, kara);
  const wolf = summonWolf(world, kara);
  editInitiative(world.campaign(), { op: "insert", id: newNpcEntryId(), name: "Captain", initiative: 8 });
  stun(world, brom.id, "0 hp");
  stun(world, cora.id, "incapacitated");
  kit.saveEncounter({ ...world.encounter(), surprisedIds: [goblin.id] });
  agree(world, kit, "staged");

  // The current player's End Turn, once the enemies the last pass left due
  // have been handed on.
  function endTurn(label) {
    kit.handOnEnemies();
    agree(world, kit, `${label}: the enemies handed on`);
    assert.equal(tools.endOwnTurn(world.campaignId, current(world).userId), true, `${label}: End Turn`);
  }
  // Ends turns with the current player's own button until `sheetId` holds
  // the turn, checking every step on the way.
  function walkTo(sheetId, label) {
    for (let step = 0; step < 12 && current(world)?.characterId !== sheetId; step += 1) {
      endTurn(label);
      agree(world, kit, `${label}: walking`);
    }
    assert.equal(current(world)?.characterId, sheetId, `${label}: the turn reached them`);
  }
  const steps = [
    ["the lead's skip", () => assert.equal(tools.skipCurrentTurn(world.campaignId), true)],
    ["the model's end_turn", async () => assert.equal((await aiEndTurn(world, current(world).characterId)).ok, true)],
    ["move", () => editInitiative(world.campaign(), { op: "move", id: goblin.id, direction: "up" })],
    ["insert", () => editInitiative(world.campaign(), { op: "insert", id: newNpcEntryId(), name: "Sergeant", initiative: 30 })],
    ["delay", () => editInitiative(world.campaign(), { op: "delay", id: current(world).characterId })],
    ["goto", () => editInitiative(world.campaign(), { op: "goto", id: current(world).characterId === kara.id ? pip.id : kara.id })],
    ["step forward", () => editInitiative(world.campaign(), { op: "step", direction: "forward" })],
    ["step back", () => editInitiative(world.campaign(), { op: "step", direction: "back" })],
    ["set-initiative", () => editInitiative(world.campaign(), { op: "set-initiative", id: goblin.id, initiative: 2 })],
    ["a companion dismissed on its turn", async () => {
      walkTo(pip.id, "to Pip");
      assert.equal((await world.invoke("dismiss_companion", { characterId: pip.id })).ok, true);
    }],
    ["a summon dropped on its turn", async () => {
      walkTo(wolf.id, "to the wolf");
      assert.equal((await world.invoke("apply_damage", { characterId: wolf.id, amount: 200 })).ok, true);
    }],
    ["a summon turned hostile on its turn", () => {
      const fey = summonWolf(world, kara, { hostileOnBreak: true, spell: "Conjure Fey" });
      walkTo(fey.id, "to the fey wolf");
      const before = tools.turnHolder(world.campaignId);
      endSpellSummons(world.campaign(), "Conjure Fey", kara.id);
      tools.settleTurn(world.campaign(), before);
    }],
    ["remove the hero acting", () => editInitiative(world.campaign(), { op: "remove", id: current(world).characterId })],
  ];
  const rounds = new Set();
  for (const [label, step] of steps) {
    await step();
    agree(world, kit, label);
    rounds.add(world.encounter().round);
    endTurn(`${label}, then the current player's`);
    agree(world, kit, `${label}, then End Turn`);
    rounds.add(world.encounter().round);
  }
  assert.ok(rounds.size > 1, "the walk wrapped the round");
});

// ---- every engine entry point settles the turn ----

await test("Every route that runs the engine directly settles the turn after it", () => {
  const api = path.join(import.meta.dirname, "..", "src", "app", "api");
  const engine = /\b(dispatchAdjudication|applyEncounterCall|applyDmMutation|applyCompanionCall|handleDismissCompanion|resolvePendingPcAttack|applyPendingDamageRoll|recordInitiativeRoll)\(/;
  const unsettled = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "route.ts") {
        const source = fs.readFileSync(full, "utf8");
        if (engine.test(source) && !source.includes("settleTurn(")) {
          unsettled.push(path.relative(api, full));
        }
      }
    }
  })(api);
  assert.deepEqual(unsettled, []);
  const lib = path.join(import.meta.dirname, "..", "src", "lib", "dm");
  // turn.ts each model call, invoke.ts the console and the DM's controls,
  // initiative.ts each edit, encounter-tools.ts the backstop.
  for (const [file, places] of [["turn.ts", 1], ["invoke.ts", 2], ["initiative.ts", 2], ["encounter-tools.ts", 2]]) {
    const calls = fs.readFileSync(path.join(lib, file), "utf8").match(/(?<!function )\bsettleTurn\(/g) ?? [];
    assert.equal(calls.length, places, `${file} settles the turn after each engine call it makes`);
  }
});

// Last: it adds the column to the one database every test here shares.
await test("A new database gets no column for the enemies a DM turn acted, and one upgraded with it still saves DM turns", async () => {
  const { world } = await table(["Kara"]);
  const columns = () => getDatabase().prepare("PRAGMA table_info(dm_turns)").all().map((column) => column.name);
  assert.ok(!columns().includes("acted_enemy_ids_json"));
  getDatabase().exec(`ALTER TABLE dm_turns ADD COLUMN acted_enemy_ids_json TEXT NOT NULL DEFAULT '[]'`);
  const turn = createDmTurn(world.campaignId, [], "ai");
  turn.status = "done";
  saveDmTurn(turn);
  assert.equal(getDmTurn(turn.id).status, "done");
});

finish();
