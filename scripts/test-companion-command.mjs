// A player commanding an AI companion in fights (src/lib/dm/companion-command.ts,
// PATCH companions/[characterId]). The DM plays a companion out of fights;
// in a fight its turns go to the player named on its sheet: the floor, End
// turn, the board's move and undo, and the actions route all treat the
// companion as that player's character on its own turn, and only then, and
// the DM is neither woken to play it nor does the server act for it. A party
// companion joining a one-player table the AI runs starts under that player.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-companion-command");

const { allocateSeq, getFloor, setDmMode } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { commanderOf, defaultCommander, turnUserId } = await import("../src/lib/dm/companion-command.ts");
const { finalizeNewCompanion } = await import("../src/lib/dm/companion-tools.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { characterAwaitingPlayer, characterCallUnasked } = await import("../src/lib/dm/player-word.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { initiativeCharacter, ownedCharacters, resolveActionCharacter } = await import("../src/lib/player-characters.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");

const wakes = [];
registerDmWaker((campaignId) => wakes.push(campaignId));
const wokenFor = (world) => wakes.filter((id) => id === world.campaignId).length;

// A one-player table the AI runs: Kara is the owner's character, Pip an AI
// companion who acts after her (commanded by `commandedBy`), a goblin last.
async function table({ commandedBy = null } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", abilities: { dex: 10, con: 10, wis: 10 } });
  const bot = createCompanionUser("Pip");
  const made = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(kara.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  setCompanionCommander(made.id, commandedBy === "owner" ? world.owner.id : commandedBy);
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  return { world, kit, kara, pip: world.sheet(made.id) };
}

const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};
const floorUsers = (world) => {
  const floor = getFloor(world.campaignId);
  return (floor.mode === "hold" ? floor.next : floor).userIds;
};

// Kara's turn ended by the model's end_turn, then its narration posted and
// the turn order settled, as finalize() does: where a landing on an AI
// companion wakes the DM to play it.
async function modelEndsKarasTurn(world, kara) {
  const turn = createDmTurn(world.campaignId, [], "ai");
  world.say("player", "That's my turn.", world.sheet(kara.id));
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: kara.id } });
  assert.equal(ended.ok, true, ended.error);
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "Kara steps back." });
  tools.advanceAfterTurn(world.campaign(), turn);
}

// The model's narration posted and the turn order settled, as finalize() does.
function dmTurnEnds(world) {
  const turn = createDmTurn(world.campaignId, [], "ai");
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "The fight goes on." });
  tools.advanceAfterTurn(world.campaign(), turn);
}

async function route(world, path, method, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${path.route}`);
  world.signIn({ id: user.id });
  const response = await handler[method](
    new Request(`http://odm.test/${path.route}`, { method, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...path.params }) },
  );
  return { status: response.status, body: await response.json() };
}
const command = (world, pip, commandedBy, user = world.owner) =>
  route(world, { route: "companions/[characterId]", params: { characterId: pip.id } }, "PATCH", { commandedBy }, user);

await test("A party companion joining a one-player table the AI runs follows that player; a guest, a shared table and a person's table keep the DM", async () => {
  const { world, kara } = await table();
  assert.equal(defaultCommander(world.campaign(), "party"), world.owner.id);
  assert.equal(defaultCommander(world.campaign(), "guest"), null);
  const made = finalizeNewCompanion(world.campaign(), 1, { ...world.sheet(kara.id), name: "Wren", portrait: { url: "/assets/portraits/wren.webp" } }, "party", "wry").sheet;
  assert.equal(made.commandedBy, world.owner.id, "the creation path left the companion to the DM");
  const guest = finalizeNewCompanion(world.campaign(), 1, { ...world.sheet(kara.id), name: "Guard" }, "guest", "stern").sheet;
  assert.equal(guest.commandedBy, null);
  world.addHero({ name: "Brom" });
  assert.equal(defaultCommander(world.campaign(), "party"), null, "two players share the table");
  const { world: run } = await table();
  setDmMode(run.campaignId, "human", run.owner.id);
  assert.equal(defaultCommander(run.campaign(), "party"), null, "a person narrates");
});

await test("On a commanded companion's turn the floor is the commander's, the DM is not woken, and nobody acts for it", async () => {
  const { world, kit, kara, pip } = await table({ commandedBy: "owner" });
  assert.equal(current(world).characterId, kara.id);
  const woken = wokenFor(world);
  await modelEndsKarasTurn(world, kara);
  assert.equal(current(world).characterId, pip.id);
  assert.deepEqual(floorUsers(world), [world.owner.id], "the floor went to the bot, not the commander");
  assert.equal(wokenFor(world), woken, "the DM was woken to play a commanded companion");
  assert.equal(activePublicEncounter(world.campaignId, { enemyNumbers: true })?.companionTurn, undefined);
  const rolls = world.encounter().turnBudget;
  dmTurnEnds(world);
  assert.equal(current(world).characterId, pip.id, "the server took Pip's turn for the player");
  assert.deepEqual(world.encounter().turnBudget, rolls, "the backstop spent Pip's action");
  assert.equal(turnUserId(world.campaign(), current(world)), world.owner.id);
  assert.equal(kit.endTurn(world.owner.id), true, "the commander ends Pip's turn");
  assert.notEqual(current(world)?.characterId, pip.id);
});

await test("Until its commander gives an order the AI may not spend, walk or end a commanded companion's turn; one nobody commands stays the AI's", async () => {
  const { world, kit, pip } = await table({ commandedBy: "owner" });
  assert.equal(kit.endTurn(world.owner.id), true);
  assert.equal(current(world).characterId, pip.id);
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, pip.id, "GAME STATE does not say the turn waits on Pip's commander");
  const refused = characterCallUnasked(world.campaignId, { actor: "ai" }, JSON.stringify({ characterId: pip.id }), "characterId");
  assert.match(refused?.error ?? "", /^Pip has not acted: their player hasn't declared an action this turn\./);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: pip.id } });
  assert.equal(ended.ok, false, "the AI ended a commanded companion's turn nobody had given an order for");
  assert.equal(current(world).characterId, pip.id);
  world.say("player", "Pip throws a dagger at the goblin.", world.sheet(pip.id));
  assert.equal(characterAwaitingPlayer(world.campaignId), null, "the order was not read as Pip's");
  assert.equal(characterCallUnasked(world.campaignId, { actor: "ai" }, JSON.stringify({ characterId: pip.id }), "characterId"), null);

  const { world: free, kit: freeKit, pip: freePip } = await table();
  assert.equal(freeKit.endTurn(free.owner.id), true);
  assert.equal(current(free).characterId, freePip.id);
  assert.equal(characterAwaitingPlayer(free.campaignId), null, "an uncommanded companion waited on a player");
  assert.equal(characterCallUnasked(free.campaignId, { actor: "ai" }, JSON.stringify({ characterId: freePip.id }), "characterId"), null);
});

await test("An uncommanded companion's turn still goes to the DM", async () => {
  const { world, kit, kara, pip } = await table();
  const woken = wokenFor(world);
  await modelEndsKarasTurn(world, kara);
  assert.equal(current(world).characterId, pip.id);
  assert.deepEqual(floorUsers(world), [pip.userId]);
  assert.ok(wokenFor(world) > woken, "the DM was not woken for its companion");
  assert.ok(activePublicEncounter(world.campaignId, { enemyNumbers: true })?.companionTurn);
  assert.equal(kit.endTurn(world.owner.id), false, "a player ended the DM's companion's turn");
  dmTurnEnds(world);
  assert.notEqual(current(world)?.characterId, pip.id, "the backstop did not play the companion's turn");
});

await test("The commander moves the companion on its turn, and can take the walk back", async () => {
  const { world, kit, kara, pip } = await table({ commandedBy: "owner" });
  assert.equal(kit.endTurn(world.owner.id), true);
  kit.place(pip.id, 4, 4);
  const [enemy] = world.enemies();
  kit.place(enemy.id, 20, 12);
  const view = buildPlayerMapView(world.campaignId, world.owner.id);
  assert.equal(view.myTokenId, kit.token(pip.id).id, "the board did not follow the turn to Pip");
  const moved = await route(world, { route: "battle-map/move" }, "POST", { x: 6, y: 4 }, world.owner);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual([kit.token(pip.id).x, kit.token(pip.id).y], [6, 4]);
  assert.equal(kit.token(kara.id).x === 6 && kit.token(kara.id).y === 4, false);
  const back = await route(world, { route: "battle-map/undo" }, "POST", {}, world.owner);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual([kit.token(pip.id).x, kit.token(pip.id).y], [4, 4]);
});

await test("A commanded companion acts as its player's only on its own turn", async () => {
  const { world, kara, pip } = await table({ commandedBy: "owner" });
  const sheets = world.sheets();
  assert.deepEqual(ownedCharacters(sheets, world.owner.id).map((sheet) => sheet.id), [kara.id], "a companion counted as owned");
  assert.equal(initiativeCharacter(sheets, world.owner.id, pip.id)?.id, pip.id);
  const onTurn = resolveActionCharacter({ sheets, userId: world.owner.id, selectedId: kara.id, characterId: pip.id, initiativeId: pip.id });
  assert.equal(onTurn.sheet?.id, pip.id, JSON.stringify(onTurn));
  const offTurn = resolveActionCharacter({ sheets, userId: world.owner.id, selectedId: kara.id, characterId: pip.id, initiativeId: kara.id });
  assert.equal(offTurn.status, 409);
  assert.match(offTurn.error, /^Pip follows your orders on their own turn in a fight/);
  const outOfFight = resolveActionCharacter({ sheets, userId: world.owner.id, selectedId: kara.id, characterId: pip.id });
  assert.equal(outOfFight.status, 409, "out of a fight the DM plays Pip");
  const reaction = resolveActionCharacter({ sheets, userId: world.owner.id, selectedId: kara.id, characterId: pip.id, initiativeId: pip.id, reaction: true });
  assert.equal(reaction.status, 409);
  const stranger = world.addUser();
  assert.equal(initiativeCharacter(sheets, stranger.id, pip.id), null);
});

await test("Whoever runs the story hands the companion's fights to a player or back to the DM, and the floor follows mid-turn", async () => {
  const { world, kit, kara, pip } = await table({ commandedBy: "owner" });
  const brom = world.addHero({ name: "Brom" });
  assert.equal(kit.endTurn(world.owner.id), true);
  assert.equal(current(world).characterId, pip.id);
  const refusedBrom = await command(world, pip, null, { id: brom.userId });
  assert.equal(refusedBrom.status, 403, "a player who does not run the story changed it");
  const toDm = await command(world, pip, null);
  assert.equal(toDm.status, 200, JSON.stringify(toDm.body));
  assert.equal(toDm.body.sheet.commandedBy, null);
  assert.deepEqual(floorUsers(world), [pip.userId], "the turn handed back stayed with the player");
  const toBrom = await command(world, pip, brom.userId);
  assert.equal(toBrom.status, 200, JSON.stringify(toBrom.body));
  assert.deepEqual(floorUsers(world), [brom.userId]);
  assert.equal(kit.endTurn(world.owner.id), false, "the old commander ended the turn");
  const stranger = world.addUser();
  assert.equal((await command(world, pip, stranger.id)).status, 400, "somebody not at the table took command");
  assert.equal((await command(world, kara, world.owner.id)).status, 404, "a player character was put under command");
});

await test("A commander who leaves the table, or takes the DM's seat, commands nobody", async () => {
  const { world, pip } = await table();
  const stranger = world.addUser();
  setCompanionCommander(pip.id, stranger.id);
  assert.equal(commanderOf(world.campaign(), world.sheet(pip.id)), null);
  setCompanionCommander(pip.id, world.owner.id);
  assert.equal(commanderOf(world.campaign(), world.sheet(pip.id)), world.owner.id);
  setDmMode(world.campaignId, "human", world.owner.id);
  assert.equal(commanderOf(world.campaign(), world.sheet(pip.id)), null);
});

finish();
