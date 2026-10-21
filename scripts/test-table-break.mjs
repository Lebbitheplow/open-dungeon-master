// A table break (src/lib/dm/table-break.ts): anyone at the table pauses it
// for a coffee or the door, and play waits for them. These are the rules
// Albert set for it, each driven through the routes a table uses:
// - any person in a seat may pause; an agent program may neither pause nor
//   resume;
// - the person who paused, the party lead or the DM may resume; nobody else;
// - the X-card wins: a break and a raised card hold the DM queue side by
//   side, and lowering one never lowers the other;
// - a restart pauses the table again, as it raises the X-card again;
// - in character is refused under a break and table talk is not, and the
//   floor underneath is untouched, so Resume picks up exactly there;
// - connected agents read the table as paused (webhooks, poll links and
//   the opportunities tool share one state) and see who paused.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";

process.env.ODM_PLAYER_WEBHOOK_ORIGINS = "https://receiver.example";

const { openWorld } = await import("./lib/enforce-world.mjs");
const { suite } = await import("./lib/enforce-harness.mjs");
const { call, seats } = await import("./lib/enforce-campaign.mjs");

const { test, finish } = suite("test-table-break");

const { getFloor, setFloor } = await import("../src/lib/db/campaigns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { dmQueuePaused, enqueueDmJob } = await import("../src/lib/dm/queue.ts");
const { raiseXCard, resumeAfterXCard, xCardRaised } = await import("../src/lib/dm/safety.ts");
const { BREAK_REASON, resumeTable, tableBreakOn } = await import("../src/lib/dm/table-break.ts");
const { breakElapsed, breakRefusal, mayResumeBreak } = await import("../src/lib/dm/table-break-logic.ts");
const { recoverDmAfterRestart } = await import("../src/lib/dm/restart-recovery.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { createPlayerWebhook, playerWebhookState } = await import("../src/lib/agents/webhooks.ts");
const { workbenchTools } = await import("../src/lib/agents/workbench.ts");
const { campaignForAgent } = await import("../src/lib/agents/agent-results.ts");
const { setMemberMuted } = await import("../src/lib/db/moderation.ts");

// A route call as a connected agent program sends it (workbench.ts).
async function asAgent(mod, method, params) {
  const request = new Request("http://test/", { method, headers: { "x-odm-client": "agent" } });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

// A human-run table: the owner in the DM seat, a separate party lead, and
// two players.
async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const people = await seats(world);
  const breakRoute = await world.route("campaigns/[campaignId]/table-break");
  const params = { campaignId: world.campaignId };
  const pause = (user) => {
    world.signIn(user);
    return call(breakRoute, "POST", undefined, params);
  };
  const resume = (user) => {
    world.signIn(user);
    return call(breakRoute, "DELETE", undefined, params);
  };
  return { world, ...people, breakRoute, params, pause, resume };
}

await test("the rules: who may resume, what a refusal says, and how the clock reads", () => {
  const taken = { userId: "bree" };
  assert.equal(mayResumeBreak(taken, { userId: "bree", isLead: false, isDm: false }), true, "the one who paused");
  assert.equal(mayResumeBreak(taken, { userId: "lead", isLead: true, isDm: false }), true, "the lead");
  assert.equal(mayResumeBreak(taken, { userId: "dm", isLead: false, isDm: true }), true, "the DM");
  assert.equal(mayResumeBreak(taken, { userId: "cal", isLead: false, isDm: false }), false, "anyone else");
  assert.match(breakRefusal({ name: "Bree" }), /Bree called a break\. Use OOC/);
  assert.equal(breakElapsed(0, 42_000), "42 s");
  assert.equal(breakElapsed(0, 4 * 60_000 + 5_000), "4 min");
  assert.equal(breakElapsed(0, 65 * 60_000), "1 h 05 min");
  assert.equal(breakElapsed(10_000, 0), "0 s", "a clock skewed into the future reads zero");
});

await test("any player pauses; only they, the lead or the DM resume; a second pause keeps the first", async () => {
  const { world, dm, lead, player, other, pause, resume } = await table();
  const paused = await pause(player);
  assert.equal(paused.status, 200, JSON.stringify(paused.json));
  assert.equal(paused.json.tableBreak.userId, player.id);
  assert.equal(paused.json.tableBreak.name, player.username, "the table is told who paused");
  assert.equal(dmQueuePaused(world.campaignId), BREAK_REASON);

  const again = await pause(other);
  assert.equal(again.json.already, true);
  assert.equal(tableBreakOn(world.campaignId).userId, player.id, "the first break stands, with its name");

  const cut = await resume(other);
  assert.equal(cut.status, 403, "another player cut the break short");
  assert.match(cut.json.error, new RegExp(`${player.username} paused the table`));
  assert.ok(tableBreakOn(world.campaignId));

  for (const who of [player, lead, dm]) {
    if (!tableBreakOn(world.campaignId)) {
      assert.equal((await pause(other)).status, 200);
    }
    const lifted = await resume(who);
    assert.equal(lifted.status, 200, `${who.username}: ${JSON.stringify(lifted.json)}`);
    assert.equal(tableBreakOn(world.campaignId), null, `${who.username} could not resume`);
    assert.equal(dmQueuePaused(world.campaignId), null);
  }
  assert.equal((await resume(player)).json.already, true, "resuming an unpaused table is a no-op");
  world.close();
});

await test("a player the lead has muted cannot call a break, as they cannot post", async () => {
  const { world, player, lead, pause } = await table();
  setMemberMuted(world.campaignId, player.id, true);
  const refused = await pause(player);
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.equal(tableBreakOn(world.campaignId), null);
  assert.equal((await pause(lead)).status, 200, "the lead still can");
  world.close();
});

await test("an agent program can neither pause nor resume, and has no tool for it", async () => {
  const { world, player, breakRoute, params, pause } = await table();
  world.signIn(player);
  const refused = await asAgent(breakRoute, "POST", params);
  assert.equal(refused.status, 403);
  assert.equal(tableBreakOn(world.campaignId), null);

  await pause(player);
  world.signIn(player);
  const stuck = await asAgent(breakRoute, "DELETE", params);
  assert.equal(stuck.status, 403, "an agent ended a break, even its own player's");
  assert.ok(tableBreakOn(world.campaignId));

  const grant = createConnectionGrant({ userId: player.id, name: "Agent", scopes: ["read", "play", "characters", "campaigns", "dm"], campaignId: null }).grant;
  const tools = workbenchTools(grant).map((tool) => tool.name);
  assert.ok(!tools.some((name) => /pause|break|resume/i.test(name)), `a tool reaches the break: ${tools.join(", ")}`);
  world.close();
});

await test("a table that is not playing has nothing to pause", async () => {
  const world = await openWorld({ status: "lobby" });
  const route = await world.route("campaigns/[campaignId]/table-break");
  world.signIn(world.owner);
  const refused = await call(route, "POST", undefined, { campaignId: world.campaignId });
  assert.equal(refused.status, 400);
  assert.equal(tableBreakOn(world.campaignId), null);
  world.close();
});

await test("the X-card wins: a break and a raised card hold the queue side by side, and neither lowers the other", async () => {
  const { world, player, pause, resume } = await table();
  const ran = [];
  // A break, then the card raised during it.
  await pause(player);
  raiseXCard(world.campaignId);
  assert.equal(xCardRaised(world.campaignId), true, "a break hid the card raised during it");
  const first = enqueueDmJob(world.campaignId, async () => {
    ran.push("first");
  });
  await resume(player);
  await tick();
  assert.equal(xCardRaised(world.campaignId), true, "resuming the break lowered the X-card");
  assert.deepEqual(ran, [], "the queue ran under a raised X-card");
  await resumeAfterXCard(world.campaignId, "continue");
  await first;
  assert.deepEqual(ran, ["first"]);

  // The card first, then a break: the card coming down leaves the break up.
  raiseXCard(world.campaignId);
  await pause(player);
  const second = enqueueDmJob(world.campaignId, async () => {
    ran.push("second");
  });
  await resumeAfterXCard(world.campaignId, "continue");
  await tick();
  assert.equal(xCardRaised(world.campaignId), false);
  assert.ok(tableBreakOn(world.campaignId), "lowering the X-card ended the break");
  assert.deepEqual(ran, ["first"], "the queue ran with the break still up");
  await resume(player);
  await second;
  assert.deepEqual(ran, ["first", "second"]);
  world.close();
});

await test("in character is refused under a break, table talk is not, and the floor is left as it was", async () => {
  const { world, player, sheet, pause, resume, params } = await table();
  const actions = await world.route("campaigns/[campaignId]/actions");
  const endTurn = await world.route("campaigns/[campaignId]/encounter/end-turn");
  const spotlight = { mode: "spotlight", userIds: [player.id], prompt: "What do you do?", respondedUserIds: [] };
  setFloor(world.campaignId, spotlight);
  await pause(player);

  world.signIn(player);
  for (const kind of ["do", "say"]) {
    const refused = await call(actions, "POST", { content: "I pick the lock.", kind, characterId: sheet.id }, params);
    assert.equal(refused.status, 409, `${kind}: ${JSON.stringify(refused.json)}`);
    assert.match(refused.json.error, /called a break\. Use OOC/);
    assert.equal(refused.json.tableBreak.userId, player.id);
  }
  const ended = await call(endTurn, "POST", undefined, params);
  assert.equal(ended.status, 409);
  assert.match(ended.json.error, /called a break/);

  const talk = await call(actions, "POST", { content: "brb, coffee", kind: "ooc", characterId: sheet.id }, params);
  assert.equal(talk.status, 202, JSON.stringify(talk.json));
  assert.ok(listRecentMessages(world.campaignId, 5).some((message) => message.content === "(ooc) brb, coffee"));
  assert.ok(!listRecentMessages(world.campaignId, 5).some((message) => message.content === "I pick the lock."));
  assert.deepEqual(getFloor(world.campaignId), spotlight, "the break touched the floor");

  await resume(player);
  assert.deepEqual(getFloor(world.campaignId), spotlight, "resuming moved the floor");
  world.signIn(player);
  const after = await call(actions, "POST", { content: "I pick the lock.", kind: "do", characterId: sheet.id }, params);
  assert.equal(after.status, 202, JSON.stringify(after.json));
  world.close();
});

await test("a restart pauses the table again, and a break already resumed stays down", async () => {
  const { world, player, pause, resume } = await table();
  const restart = () => {
    globalThis.__odmDmPauses = undefined;
    globalThis.__odmDmRecovered = undefined;
    return recoverDmAfterRestart();
  };
  await pause(player);
  const recovery = restart();
  assert.ok(recovery.breaks >= 1, JSON.stringify(recovery));
  const held = tableBreakOn(world.campaignId);
  assert.ok(held, "the restart ended the break");
  assert.equal(held.userId, player.id, "the restored break lost who paused");
  const ran = [];
  const job = enqueueDmJob(world.campaignId, async () => {
    ran.push("turn");
  });
  await tick();
  assert.deepEqual(ran, [], "the next turn ran with the player still away");
  await resume(player);
  await job;
  assert.deepEqual(ran, ["turn"]);
  restart();
  assert.equal(tableBreakOn(world.campaignId), null, "the restart paused a table already resumed");

  // A card raised during a break comes back with it.
  await pause(player);
  raiseXCard(world.campaignId);
  restart();
  assert.equal(xCardRaised(world.campaignId), true);
  assert.ok(tableBreakOn(world.campaignId));
  await resumeAfterXCard(world.campaignId, "continue");
  resumeTable(world.campaignId, player);
  world.close();
});

await test("agents read the table as paused, with who paused, and play again after Resume", async () => {
  const { world, player, sheet, pause, resume, params } = await table();
  const grant = createConnectionGrant({ userId: player.id, name: "Player agent", scopes: ["read", "play"], campaignId: world.campaignId }).grant;
  const sub = createPlayerWebhook(grant, { campaignId: world.campaignId, characterId: sheet.id, url: "https://receiver.example/odm" });
  assert.equal(playerWebhookState(grant, sub.id).lifecycle, "active");

  await pause(player);
  const during = playerWebhookState(grant, sub.id);
  assert.equal(during.lifecycle, "paused", "the webhook lifecycle missed the break");
  assert.deepEqual(during.opportunities, [], "an agent was offered a move during the break");

  // Across a restart the in-memory pause is gone until recovery runs; the
  // persisted event still says paused.
  globalThis.__odmDmPauses = undefined;
  assert.equal(playerWebhookState(grant, sub.id).lifecycle, "paused", "a lost in-memory pause read as active");
  globalThis.__odmDmRecovered = undefined;
  recoverDmAfterRestart();

  const campaignRoute = await world.route("campaigns/[campaignId]");
  world.signIn(player);
  const snapshot = await call(campaignRoute, "GET", undefined, params);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.json.tableBreak.userId, player.id);
  for (const options of [{}, { view: "status" }]) {
    const view = JSON.parse(campaignForAgent(JSON.stringify(snapshot.json), undefined, options));
    assert.equal(view.tableBreak?.name, player.username, `the ${options.view ?? "full"} view hides the break`);
  }

  await resume(player);
  assert.equal(playerWebhookState(grant, sub.id).lifecycle, "active");
  world.close();
});

finish();
