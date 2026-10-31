// A Dash or Disengage given somewhere to go walks the mover in the same call
// (src/lib/dm/action-walk.ts, issue #666). The playtest this guards: the
// player asked for Spiritual Weapon and a Dash to Vesper for the cleric
// Rowan, a companion they commanded; the GM said Rowan "commits his action
// to a dash ... but has not yet left his position". The Dash only added
// speed, and it also ended the companion's turn where he stood, so nobody
// could walk him after.
//   - A commanded companion's "Dash to Kara" walks it beside Kara.
//   - A commanded companion's Dash with nowhere named keeps its turn open
//     for the commander, as a player's own character's does.
//   - A companion the GM plays Dashes toward someone and is walked.
//   - The Hand's Dash card for a commanded companion leaves the turn open.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-companion-dash");

const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { createDmTurn, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
const { tilesApart } = await import("../src/lib/dm/board-reach.ts");

registerDmWaker(() => {});

// A one-player table the AI runs: Kara, then Rowan, a companion cleric
// (commanded by the owner when `commanded`), then a goblin far off. The
// turn is Rowan's, and Kara stands eight squares away.
async function table({ commanded = true } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", abilities: { dex: 10, con: 10, wis: 10 } });
  const bot = createCompanionUser("Rowan");
  const made = createSheet(world.campaignId, bot.id, 3, {
    ...world.sheet(kara.id),
    name: "Rowan",
    class: "cleric",
    level: 3,
    abilities: { str: 12, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
    proficiencies: TRAINED,
    speed: 30,
    equipment: [{ name: "Mace", qty: 1 }],
    hitDice: { die: "d8", total: 3, spent: 0 },
  });
  markSheetAsCompanion(made.id, "party", "steady");
  setCompanionCommander(made.id, commanded ? world.owner.id : null);
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  kit.openField();
  const [goblin] = world.enemies();
  kit.place(made.id, 2, 2);
  kit.place(kara.id, 10, 2);
  kit.place(goblin.id, 20, 14);
  assert.equal(kit.endTurn(world.owner.id), true, "Kara's turn ends");
  assert.equal(current(world)?.characterId, made.id, "the turn is Rowan's");
  return { world, kit, kara, rowan: world.sheet(made.id), goblin };
}

const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};

function dash(world, turn, args) {
  return invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "take_action", args: { action: "dash", ...args } });
}

// The DM turn's narration posted and the turn order settled, as finalize() does.
function dmTurnEnds(world, turn) {
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "Rowan runs." });
  tools.advanceAfterTurn(world.campaign(), getDmTurn(turn.id));
}

await test("A commanded companion's typed Dash to Kara walks it beside her in the same call, and its turn then ends", async () => {
  const { world, kit, kara, rowan } = await table();
  world.say("player", "Rowan dashes to Kara.", world.sheet(rowan.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const done = await dash(world, turn, { characterId: rowan.id, toward: "Kara" });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.walked?.toward, "Kara", JSON.stringify(done.result));
  assert.equal(tilesApart(kit.token(rowan.id), kit.token(kara.id)), 1, "Rowan stands beside Kara");
  assert.equal(done.result.moveOwed, undefined);
  dmTurnEnds(world, turn);
  assert.notEqual(current(world)?.characterId, rowan.id, "the Dash and its walk were the turn");
});

await test("A commanded companion's Dash with nowhere named keeps its turn for the commander, with the doubled movement", async () => {
  const { world, kit, rowan } = await table();
  world.say("player", "Rowan dashes.", world.sheet(rowan.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const done = await dash(world, turn, { characterId: rowan.id });
  assert.equal(done.ok, true, done.error);
  assert.match(String(done.result.moveOwed), /Nothing has moved yet: walk Rowan with move_token/);
  assert.deepEqual([kit.token(rowan.id).x, kit.token(rowan.id).y], [2, 2], "nobody walked him");
  dmTurnEnds(world, turn);
  assert.equal(current(world)?.characterId, rowan.id, "the turn waits on the commander's walk and End Turn");
  assert.match(String(done.result.applied), /Movement left this turn: 60 ft/);
});

await test("A companion the GM plays Dashes toward Kara and is walked; its turn ends with the action", async () => {
  const { world, kit, kara, rowan } = await table({ commanded: false });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const done = await dash(world, turn, { characterId: rowan.id, toward: kara.id });
  assert.equal(done.ok, true, done.error);
  assert.equal(tilesApart(kit.token(rowan.id), kit.token(kara.id)), 1);
  dmTurnEnds(world, turn);
  assert.notEqual(current(world)?.characterId, rowan.id);
});

await test("The Hand's Dash card for a commanded companion leaves its turn open for the walk", async () => {
  const { world, rowan } = await table();
  const card = directCardCall({ card: "basic", action: "dash" }, rowan.id);
  assert.ok(card, "the Dash card is a direct call");
  // The card's own sentence, posted for Rowan as the Hand posts it.
  world.say("player", "Rowan takes the Dash action.", world.sheet(rowan.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const done = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: card.name, args: card.args });
  assert.equal(done.ok, true, done.error);
  dmTurnEnds(world, turn);
  assert.equal(current(world)?.characterId, rowan.id, "the commander still walks and ends the turn");
});

await test("A destination nobody can reach is refused before the Dash is spent", async () => {
  const { world, rowan } = await table();
  world.say("player", "Rowan dashes to the ogre.", world.sheet(rowan.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const unknown = await dash(world, turn, { characterId: rowan.id, toward: "the ogre" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /toward names nobody else on the board: "the ogre"\. Use one of: .*Kara/);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "the action is still Rowan's");
  const dodge = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "take_action", args: { characterId: rowan.id, action: "dodge", toward: "Kara" } });
  assert.equal(dodge.ok, false);
  assert.match(dodge.error, /toward goes with a Dash or a Disengage only/);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false);
});

finish();
