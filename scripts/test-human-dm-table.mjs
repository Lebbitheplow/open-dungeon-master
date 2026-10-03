// A table a person runs, outside combat (the audit behind issue 63).
//
// The rules:
//   - A player's private message reaches the person in the DM seat (their
//     inbox), and answering it with send_whisper marks it answered, so the
//     player may send more. Before, nobody could read it and the player was
//     capped at two forever.
//   - An AI turn left waiting on a roll when a person takes the seat closes
//     when the roll lands; it never narrates at their table.
//   - The console honours inventoryApprovals as the AI's turn does: an item
//     for a player character is an offer they answer.
//   - The DM's "waiting on you" queue is rebuilt from the transcript after a
//     reload: player actions (table talk aside) after the last DM passage
//     that answered them; a beat answers nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-human-dm-table");
const { countPendingPlayerWhispers } = await import("../src/lib/db/dm-whispers.ts");
const { createDmTurn, getDmTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { resumeDmTurn } = await import("../src/lib/dm/turn.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");

const world = await openWorld({ gameSettings: { dmMode: "human", inventoryApprovals: true } });
const player = world.addUser();
const hero = world.addHero({ user: player, class: "rogue", level: 2 });

async function call(user, route, method, body) {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler[method](
    new Request("http://test/", method === "GET" ? {} : { method, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("a player's whisper reaches the DM's inbox, and the DM's reply answers it", async () => {
  const sent = await call(player, "campaigns/[campaignId]/whispers", "POST", { message: "I pocket the key." });
  assert.equal(sent.status, 202, sent.body.error);
  const dmView = await call(world.owner, "campaigns/[campaignId]/whispers", "GET");
  assert.equal(dmView.body.inbox?.length, 1, "the DM never saw the whisper");
  assert.equal(dmView.body.inbox[0].content, "I pocket the key.");
  assert.equal(dmView.body.inbox[0].answered, false);
  // A player never gets the inbox.
  const playerView = await call(player, "campaigns/[campaignId]/whispers", "GET");
  assert.equal(playerView.body.inbox, undefined);

  const reply = await world.invoke("send_whisper", { characterIds: [hero.id], message: "Nobody saw." });
  assert.equal(reply.ok, true, reply.error);
  assert.equal(countPendingPlayerWhispers(world.campaignId, player.id), 0);
  const after = await call(world.owner, "campaigns/[campaignId]/whispers", "GET");
  assert.equal(after.body.inbox[0].answered, true);
});

await test("an AI turn waiting on a roll closes when a person holds the seat, without narrating", async () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  turn.status = "awaiting_rolls";
  saveDmTurn(turn);
  await resumeDmTurn(world.campaignId, turn.id);
  assert.equal(getDmTurn(turn.id).status, "done");
});

await test("the console's item for a player character is an offer under inventoryApprovals", async () => {
  const before = world.sheet(hero.id).equipment.length;
  const out = await world.invoke("grant_item", { characterId: hero.id, name: "Rope", reason: "found" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).equipment.length, before, "the item landed without the player's say");
});

await test("the waiting-on-you queue is rebuilt from the transcript; table talk and beats do not count", () => {
  const messages = [
    { id: "m1", seq: 1, authorType: "player", userId: "u1", characterId: "c1", content: "I open the door." },
    { id: "m2", seq: 2, authorType: "dm", userId: "dm", characterId: null, content: "It creaks." },
    { id: "m3", seq: 3, authorType: "player", userId: "u1", characterId: "c1", content: "I step in." },
    { id: "m4", seq: 4, authorType: "player", userId: "u2", characterId: "c2", content: "(ooc) brb" },
    { id: "m5", seq: 5, authorType: "dm", userId: "dm", characterId: null, content: "Beat: the party crossed the river." },
    { id: "m6", seq: 6, authorType: "player", userId: "u2", characterId: "c2", content: "I follow." },
  ];
  assert.deepEqual(
    queuedIntents(messages, ["m5"]).map((intent) => intent.messageId),
    ["m3", "m6"],
  );
  assert.deepEqual(queuedIntents(messages, []).map((intent) => intent.messageId), ["m6"]);
});

finish();
