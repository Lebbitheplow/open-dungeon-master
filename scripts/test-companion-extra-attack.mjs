// A companion with Extra Attack makes its whole Attack action before its
// turn ends (src/lib/dm/encounter-tools.ts markResolvedFromArgs and
// companionAutoAct). A companion's attack used to mark its turn resolved on
// the first swing, so the turn passed on after the narration with the
// second swing still owed. Now:
//   - A companion under a player's orders keeps the turn while swings are
//     left, as a player's own character does: the commander picks the next
//     target, or ends the turn.
//   - A companion the GM plays has the swings the model left made by the
//     server before the turn passes, on the creature it last struck while
//     that one stands, and every swing when the model made none.
//   - A companion with one attack still has its turn end on that attack.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-companion-extra-attack");

const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { createDmTurn, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");

registerDmWaker(() => {});

// A one-player table the AI runs: Kara, the owner's character, then Tamsin,
// a companion ranger of `level` with a longsword (commanded by the owner
// when `commanded`), then a goblin too tough to fall. Everyone stands next
// to each other, and the turn is Tamsin's.
async function table({ level = 5, commanded = false, equipment = [{ name: "Longsword", qty: 1 }] } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", abilities: { dex: 10, con: 10, wis: 10 } });
  const bot = createCompanionUser("Tamsin");
  const made = createSheet(world.campaignId, bot.id, level, {
    ...world.sheet(kara.id),
    name: "Tamsin",
    class: "ranger",
    level,
    abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencies: TRAINED,
    equipment,
    hitDice: { die: "d10", total: level, spent: 0 },
  });
  markSheetAsCompanion(made.id, "party", "steady");
  setCompanionCommander(made.id, commanded ? world.owner.id : null);
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 400 });
  kit.place(made.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(kara.id, 4, 6);
  assert.equal(kit.endTurn(world.owner.id), true, "Kara's turn ends");
  assert.equal(current(world)?.characterId, made.id, "the turn is Tamsin's");
  return { world, kit, kara, tamsin: world.sheet(made.id), goblin };
}

const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};

const swingsBy = (world, sheetId) =>
  listRecentRolls(world.campaignId, 200).filter((roll) => roll.characterId === sheetId && roll.kind === "attack");

// The model's pc_attack for Tamsin inside one AI DM turn.
function modelAttacks(world, turn, tamsin, goblin) {
  return invokeEngine(
    world.campaign(),
    { kind: "ai", turnId: turn.id },
    { name: "pc_attack", args: { characterId: tamsin.id, targetEnemyId: goblin.id } },
  );
}

// That DM turn's narration posted and the turn order settled, as finalize()
// does.
function dmTurnEnds(world, turn) {
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "Tamsin looses." });
  tools.advanceAfterTurn(world.campaign(), getDmTurn(turn.id));
}

await test("A commanded companion with Extra Attack keeps the turn after its first attack, and the second ends it", async () => {
  const { world, tamsin, goblin } = await table({ commanded: true });
  world.say("player", "Tamsin attacks the goblin.", world.sheet(tamsin.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const first = await modelAttacks(world, turn, tamsin, goblin);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.attacksRemaining, 1, "the engine says one attack is left");
  dmTurnEnds(world, turn);
  assert.equal(current(world)?.characterId, tamsin.id, "the turn passed on with Tamsin's second attack still owed");
  assert.equal(swingsBy(world, tamsin.id).length, 1, "nobody swung for the commander");
  assert.equal(
    listRecentMessages(world.campaignId, 10).some((message) => /It is now Kara's turn/.test(message.content)),
    false,
    "the table was told the turn moved on",
  );

  world.say("player", "Tamsin attacks the goblin again.", world.sheet(tamsin.id));
  const next = createDmTurn(world.campaignId, [], "ai");
  const second = await modelAttacks(world, next, tamsin, goblin);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.result.attacksRemaining, undefined, "no attack is left");
  dmTurnEnds(world, next);
  assert.notEqual(current(world)?.characterId, tamsin.id, "the turn ends with the Attack action spent");
  assert.equal(swingsBy(world, tamsin.id).length, 2);
});

await test("A companion the GM plays makes the attack the model left, at the same target, before the turn passes", async () => {
  const { world, tamsin, goblin } = await table();
  const turn = createDmTurn(world.campaignId, [], "ai");
  const first = await modelAttacks(world, turn, tamsin, goblin);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.attacksRemaining, 1);
  dmTurnEnds(world, turn);
  const swings = swingsBy(world, tamsin.id);
  assert.equal(swings.length, 2, "the second attack of Extra Attack was lost");
  assert.notEqual(current(world)?.characterId, tamsin.id, "the turn passed on");
  const note = listRecentMessages(world.campaignId, 20).find((message) => /^Tamsin's turn resolves automatically/.test(message.content));
  assert.ok(note, "the table is told what the server did for Tamsin");
  assert.match(note.content, new RegExp(`attacks ${goblin.displayName}`), "the second attack went at the goblin she struck");
});

await test("A companion the GM plays and the model never acted for makes both attacks", async () => {
  const { world, tamsin } = await table();
  const turn = createDmTurn(world.campaignId, [], "ai");
  dmTurnEnds(world, turn);
  assert.equal(swingsBy(world, tamsin.id).length, 2, "the backstop made one attack for an Extra Attack companion");
  assert.notEqual(current(world)?.characterId, tamsin.id);
});

await test("A companion the GM plays whose sword cannot reach the goblin this turn shoots its bow from where it stands", async () => {
  const { world, kit, tamsin, goblin } = await table({ level: 1, equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }] });
  // 40 ft off: 30 ft of walking leaves her 10 ft short of the sword.
  kit.place(goblin.id, 13, 5);
  dmTurnEnds(world, createDmTurn(world.campaignId, [], "ai"));
  // Her own swings, not the goblin's at her.
  const swings = swingsBy(world, tamsin.id).filter((roll) => roll.detail.includes(`vs ${goblin.displayName}`));
  assert.equal(swings.length, 1, "she walked short and made no attack");
  assert.match(swings[0].detail, /Longbow/);
  assert.deepEqual([kit.token(tamsin.id).x, kit.token(tamsin.id).y], [5, 5], "she walked up for nothing");
});

await test("A companion with one attack still has its turn end on it, commanded or not", async () => {
  for (const commanded of [true, false]) {
    const { world, tamsin, goblin } = await table({ level: 1, commanded });
    if (commanded) {
      world.say("player", "Tamsin attacks the goblin.", world.sheet(tamsin.id));
    }
    const turn = createDmTurn(world.campaignId, [], "ai");
    const first = await modelAttacks(world, turn, tamsin, goblin);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.result.attacksRemaining, undefined);
    dmTurnEnds(world, turn);
    assert.notEqual(current(world)?.characterId, tamsin.id, `the turn stayed (${commanded ? "commanded" : "GM's"})`);
    assert.equal(swingsBy(world, tamsin.id).length, 1, `a second attack was made (${commanded ? "commanded" : "GM's"})`);
  }
});

finish();
