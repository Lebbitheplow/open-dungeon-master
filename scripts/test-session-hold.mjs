// Between sessions (issue 586). A table that meets on a schedule could not
// say "that is where we stop until Friday": the campaign stayed in play all
// week, one player alone could carry the party's story on with the AI, the
// home called it "active", and a weekly group was nudged as idle every week.
// Ending the session holds the table at the break's gate under its own
// reason until whoever steers the story or the lead starts the next one,
// with a recap when the gap was long (src/lib/dm/session-hold.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-session-hold");
const logic = await import("../src/lib/dm/session-hold-logic.ts");
const hold = await import("../src/lib/dm/session-hold.ts");
const { refuseDuringBreak } = await import("../src/lib/dm/table-break.ts");
const { waitsForTable } = await import("../src/lib/dm/table-wait.ts");
const queue = await import("../src/lib/dm/queue.ts");
const messages = await import("../src/lib/db/messages.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const scheduling = await import("../src/lib/db/scheduling.ts");
const { homeGlanceFor } = await import("../src/lib/db/home-glance.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { runJobsOnce } = await import("../src/lib/jobs.ts");

await test("the rule: whoever steers the story or the lead ends and starts sessions; nobody else.", () => {
  assert.equal(logic.maySteerSessions({ steersStory: true, isLead: false }), true, "the GM");
  assert.equal(logic.maySteerSessions({ steersStory: false, isLead: true }), true, "the lead at a person's table");
  assert.equal(logic.maySteerSessions({ steersStory: false, isLead: false }), false, "a player");
});

await test("the rule: the next session is the earliest one not cancelled and not yet over.", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const sessions = [
    { id: "past", title: "", startsAt: "2026-11-03T18:00:00Z", durationMin: 180, cancelledAt: null, rsvps: [] },
    { id: "cancelled", title: "", startsAt: "2026-11-05T18:00:00Z", durationMin: 180, cancelledAt: "2026-11-01T00:00:00Z", rsvps: [] },
    { id: "later", title: "", startsAt: "2026-11-12T18:00:00Z", durationMin: 180, cancelledAt: null, rsvps: [] },
    { id: "friday", title: "Friday", startsAt: "2026-11-06T18:00:00Z", durationMin: 180, cancelledAt: null, rsvps: [{ response: "yes" }, { response: "no" }, { response: "yes" }] },
  ];
  assert.deepEqual(logic.pickNextSession(sessions, now), { id: "friday", title: "Friday", startsAt: "2026-11-06T18:00:00Z", durationMin: 180, coming: 2 });
  // Under way tonight still counts until it is over.
  const tonight = [{ id: "tonight", title: "", startsAt: "2026-11-04T11:00:00Z", durationMin: 180, cancelledAt: null, rsvps: [] }];
  assert.equal(logic.pickNextSession(tonight, now)?.id, "tonight");
  assert.equal(logic.pickNextSession(tonight, Date.parse("2026-11-04T14:01:00Z")), null);
  assert.equal(logic.nextSessionWords(null, ""), "No next session is set yet.");
  assert.equal(logic.nextSessionWords({ id: "a", title: "", startsAt: "", durationMin: 0, coming: 1 }, "Fri 7 PM"), "Next session: Fri 7 PM · 1 coming");
});

// A table in play: the owner leads it and steers its AI story, and one more
// player sits at it.
async function table() {
  const world = await openWorld();
  const lead = world.owner;
  const player = world.addUser("player");
  world.addHero({ user: lead, name: "Kara" });
  const hero = world.addHero({ user: player, name: "Brann" });
  async function post(user, body) {
    world.signIn(user);
    const mod = await world.route("campaigns/[campaignId]/session");
    const response = await mod.POST(
      new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, json: await response.json() };
  }
  async function snapshot(user) {
    world.signIn(user);
    const mod = await world.route("campaigns/[campaignId]");
    const response = await mod.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return response.json();
  }
  const lines = () => messages.listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "system").map((message) => message.content);
  return { world, lead, player, hero, post, snapshot, lines };
}

await test("a player cannot end the session; the lead can, once, and the table says so.", async () => {
  const t = await table();
  const refused = await t.post(t.player, { action: "end" });
  assert.equal(refused.status, 403);
  assert.equal(hold.sessionHoldOn(t.world.campaignId), null);

  const ended = await t.post(t.lead, { action: "end" });
  assert.equal(ended.status, 200, JSON.stringify(ended.json));
  assert.equal(ended.json.sessionHold.number, 1);
  // A second press, or a co-GM's at the same moment, counts nothing twice.
  const again = await t.post(t.lead, { action: "end" });
  assert.equal(again.json.already, true);
  assert.equal(again.json.sessionHold.number, 1);
  assert.equal(t.lines().filter((line) => line === "Session 1 ends.").length, 1);

  // Every seat's snapshot carries it, and the campaign is still in play.
  const seen = await t.snapshot(t.player);
  assert.equal(seen.sessionHold?.number, 1);
  assert.equal(seen.campaign.status, "active");
  t.world.close();
});

await test("between sessions every play route refuses in its own words, the DM queue holds, and a break cannot be called.", async () => {
  const t = await table();
  await t.post(t.lead, { action: "end" });
  const refusal = refuseDuringBreak(t.world.campaignId);
  assert.equal(refusal?.status, 409);
  const body = await refusal.json();
  assert.equal(body.error, "Session 1 is over. Use OOC for table talk until the next session starts.");
  assert.equal(queue.dmQueuePausedFor(t.world.campaignId, hold.SESSION_REASON), true);
  // A table that waits for everyone runs no clock between sessions.
  assert.equal(waitsForTable(campaigns.getCampaignById(t.world.campaignId)), false);

  t.world.signIn(t.player);
  const breakRoute = await t.world.route("campaigns/[campaignId]/table-break");
  const pause = await breakRoute.POST(new Request("http://test/", { method: "POST" }), { params: Promise.resolve({ campaignId: t.world.campaignId }) });
  assert.equal(pause.status, 400);
  t.world.close();
});

await test("a storyteller turn under way lands before the session can end.", async () => {
  const t = await table();
  let release;
  queue.enqueueDmJob(t.world.campaignId, () => new Promise((resolve) => { release = resolve; }), { kind: "turn" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const refused = await t.post(t.lead, { action: "end" });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /still being told/);
  assert.equal(hold.sessionHoldOn(t.world.campaignId), null);
  release();
  await settleQueue(t.world.campaignId);
  const ended = await t.post(t.lead, { action: "end" });
  assert.equal(ended.status, 200);
  t.world.close();
});

await test("ending the session lifts a break that was on, without opening the queue.", async () => {
  const t = await table();
  const { pauseTable, tableBreakOn } = await import("../src/lib/dm/table-break.ts");
  pauseTable(t.world.campaignId, { id: t.player.id, username: t.player.username });
  await t.post(t.lead, { action: "end" });
  assert.equal(tableBreakOn(t.world.campaignId), null);
  assert.equal(queue.dmQueuePausedFor(t.world.campaignId, hold.SESSION_REASON), true);
  t.world.close();
});

await test("starting the next session picks up where play stopped; a quick restart needs no recap.", async () => {
  const t = await table();
  await t.post(t.lead, { action: "end" });
  const refused = await t.post(t.player, { action: "start" });
  assert.equal(refused.status, 403);
  const started = await t.post(t.lead, { action: "start" });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.number, 2);
  assert.equal(hold.sessionHoldOn(t.world.campaignId), null);
  assert.equal(refuseDuringBreak(t.world.campaignId), null);
  assert.ok(t.lines().includes("Session 2 begins."));
  assert.ok(!t.lines().some((line) => line.startsWith("Previously:")), "a recap after a minute away");
  const again = await t.post(t.lead, { action: "start" });
  assert.equal(again.json.already, true);
  // The next end is the second session's.
  const second = await t.post(t.lead, { action: "end" });
  assert.equal(second.json.sessionHold.number, 2);
  t.world.close();
});

await test("after a long gap the next session opens with a recap, and table talk in between asked for none.", async () => {
  const t = await table();
  const model = await fakeModel();
  await model.pointAt(t.world);
  await t.post(t.lead, { action: "end" });
  // A week ago.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  getDatabase()
    .prepare(`UPDATE campaign_events SET payload_json = json_set(payload_json, '$.at', ?) WHERE campaign_id = ? AND type = 'session_ended'`)
    .run(weekAgo, t.world.campaignId);
  getDatabase()
    .prepare(`UPDATE campaign_messages SET created_at = ? WHERE campaign_id = ?`)
    .run(new Date(weekAgo).toISOString(), t.world.campaignId);

  // Table talk while the session is over: no recap of its own.
  t.world.signIn(t.player);
  const actions = await t.world.route("campaigns/[campaignId]/actions");
  const talk = await actions.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ooc", content: "Same time next week?" }) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  assert.ok(talk.status < 300, `table talk between sessions: ${talk.status}`);

  model.script([reply({ text: "Last time, you reached the drowned gate." })]);
  await t.post(t.lead, { action: "start" });
  await settleQueue(t.world.campaignId);
  const recaps = t.lines().filter((line) => line.startsWith("Previously:"));
  assert.equal(recaps.length, 1, JSON.stringify(t.lines()));
  assert.match(recaps[0], /drowned gate/);
  // The recap reads the story, not the week's table talk or the table's own notes.
  const asked = JSON.stringify(model.requests.find((body) => JSON.stringify(body).includes("Previously, on")) ?? {});
  assert.ok(asked.includes("Previously, on"), "the recap was asked for");
  assert.ok(!asked.includes("Same time next week"), "table talk reached the recap");
  assert.ok(!asked.includes("Session 1 ends"), "the table's notes reached the recap");
  model.close();
  t.world.close();
});

await test("a restart holds a table between sessions again, and leaves a started one alone.", async () => {
  const t = await table();
  await t.post(t.lead, { action: "end" });
  // What a restart loses: the queue's gate lives in memory.
  queue.resumeDmQueue(t.world.campaignId);
  assert.equal(hold.sessionHoldOn(t.world.campaignId), null);
  assert.ok(hold.restoreSessionHolds().includes(t.world.campaignId));
  assert.equal(hold.sessionHoldOn(t.world.campaignId)?.number, 1);
  await t.post(t.lead, { action: "start" });
  queue.resumeDmQueue(t.world.campaignId);
  assert.ok(!hold.restoreSessionHolds().includes(t.world.campaignId));
  t.world.close();
});

await test("the home says between sessions and when the table meets next; a booked table is not nudged as idle.", async () => {
  const t = await table();
  assert.deepEqual(homeGlanceFor(t.world.campaignId, []).session, { between: false, next: null });
  await t.post(t.lead, { action: "end" });
  const friday = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const booked = scheduling.createScheduledSession(t.world.campaignId, t.lead.id, { title: "Friday", startsAt: friday, durationMin: 180, note: "" });
  scheduling.setRsvp(booked.id, t.player.id, "yes");
  const glance = homeGlanceFor(t.world.campaignId, []).session;
  assert.equal(glance.between, true);
  assert.equal(glance.next?.id, booked.id);
  assert.equal(glance.next?.coming, 1);

  // Quiet for five days with Friday booked: no "the table misses you".
  const quiet = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  getDatabase().prepare(`UPDATE campaigns SET updated_at = ?, idle_nudged_at = NULL WHERE id = ?`).run(quiet, t.world.campaignId);
  runJobsOnce(Date.now());
  const nudges = getDatabase().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'campaign_idle'`).get();
  assert.equal(nudges.n, 0);
  // Without one booked, the nudge still comes.
  scheduling.cancelScheduledSession(t.world.campaignId, booked.id);
  runJobsOnce(Date.now());
  const after = getDatabase().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'campaign_idle'`).get();
  assert.ok(after.n > 0, "an unbooked quiet table is still nudged");
  t.world.close();
});

await test("between sessions nothing wakes the storyteller, and work that waits on it is answered at once.", async () => {
  const t = await table();
  await t.post(t.lead, { action: "end" });
  const { requestDmTurn } = await import("../src/lib/dm/loop.ts");
  const { getDmStatus } = await import("../src/lib/dm/status.ts");
  // An "@GM" question or a whisper left between sessions: no turn queued, no "thinking" for days.
  assert.equal(requestDmTurn(t.world.campaignId), false);
  assert.equal(getDmStatus(t.world.campaignId), "idle");
  assert.equal(queue.dmQueueDepth(t.world.campaignId), 0);
  const route = async (name, user, body) => {
    t.world.signIn(user);
    const mod = await t.world.route(name);
    const response = await mod.POST(
      new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: t.world.campaignId }) },
    );
    return { status: response.status, json: await response.json() };
  };
  // Ask waits on the queue: answered now, not on Friday.
  const ask = await route("campaigns/[campaignId]/ask", t.player, { question: "How does grappling work?" });
  assert.equal(ask.status, 409);
  assert.match(ask.json.error, /storyteller rests until the next session/);
  // A coordinated plan neither opens nor resolves; setting one aside still works.
  const open = await route("campaigns/[campaignId]/coordination", t.lead, { action: "open" });
  assert.equal(open.status, 409);
  assert.match(open.json.error, /Session 1 is over/);
  assert.equal((await route("campaigns/[campaignId]/coordination", t.lead, { action: "cancel" })).status < 500, true);
  t.world.close();
});

await test("ending the campaign between sessions lets the queue go, and a restart does not hold it again.", async () => {
  const t = await table();
  await t.post(t.lead, { action: "end" });
  t.world.signIn(t.lead);
  const mod = await t.world.route("campaigns/[campaignId]");
  const ended = await mod.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ended" }) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  assert.equal(ended.status, 200);
  assert.equal(queue.dmQueuePausedFor(t.world.campaignId, hold.SESSION_REASON), false);
  assert.ok(!hold.restoreSessionHolds().includes(t.world.campaignId));
  t.world.close();
});

await test("the host says it has sessions, so the apps show the controls only where they work.", async () => {
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  assert.equal(SERVER_FEATURES.sessions, true);
  assert.equal(hostOffers({ features: {} }, "sessions"), false, "an older host hides them");
});

finish();
