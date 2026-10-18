// Issue #383: a DM turn that never reached the model. The table sat on "DM
// at work" forever with no error, a reload still said so, and Rewind and
// every later turn waited behind it, because the prompt build ran
// unguarded and the per-campaign queue had no deadline. Each test here is
// one way that happened, run against a real database, the real queue and a
// scripted model (scripts/lib/enforce-narrator.mjs), plus the lead's Stop.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, held, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-turn-watchdog");

const { requestDmTurn } = await import("../src/lib/dm/loop.ts");
const { getDmStatus, setDmStatus } = await import("../src/lib/dm/status.ts");
const { configureDmWatchdog, enqueueDmJob, runningDmJob } = await import("../src/lib/dm/queue.ts");
const { configureEmbedTimeouts } = await import("../src/lib/embeddings.ts");
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { DM_HALTED_PREFIX } = await import("../src/lib/campaign-types.ts");
const { stalledReason, LEAD_STOPPED_REASON, DM_JOB_STAGE_DEADLINES_MS } = await import("../src/lib/dm/job-stage-logic.ts");
const { isUnbuiltTurn } = await import("../src/lib/dm/turn-halt.ts");

// The watchdog at test speed: deadlines scaled to a few hundred
// milliseconds, checked every 20.
configureDmWatchdog({ checkMs: 20, graceMs: 150, scale: 0.005 });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const model = await fakeModel();
const workingEmbedder = globalThis.__odmEmbedderPromise;

async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kara = world.addHero({ name: "Kara" });
  model.pointAt(world);
  model.script([]);
  return { world, kara };
}

// A player's action, the way the actions route asks for a turn.
function act(t, line) {
  t.world.say("player", line, t.world.sheet(t.kara.id));
  return requestDmTurn(t.world.campaignId);
}

const notices = (t) =>
  listRecentMessages(t.world.campaignId, 50).filter(
    (message) => message.authorType === "system" && message.content.startsWith(DM_HALTED_PREFIX),
  );
const narrations = (t) => listRecentMessages(t.world.campaignId, 50).filter((message) => message.authorType === "dm");

async function route(t, name, body, user = t.world.owner) {
  const handler = await t.world.route(name);
  t.world.signIn(user);
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

// Lore with a stored vector, so the turn's retrieval asks the embedder.
function embeddedLore(t) {
  const entry = insertLoreEntry({ campaignId: t.world.campaignId, category: "geography", title: "The Door", body: "An old oak door.", tags: [] });
  const vector = Buffer.from(new Float32Array(384).fill(0.05).buffer);
  getDatabase().prepare(`UPDATE lore_entries SET embedding = ? WHERE id = ?`).run(vector, entry.id);
}

await test("A throw while the prompt is built halts the turn with a notice and Retry, and leaves the table idle; Retry starts the turn over.", async () => {
  const t = await table();
  getDatabase().exec(`ALTER TABLE campaign_pins RENAME TO campaign_pins_gone`);
  try {
    act(t, "I open the door.");
    await settleQueue(t.world.campaignId);
  } finally {
    getDatabase().exec(`ALTER TABLE campaign_pins_gone RENAME TO campaign_pins`);
  }
  assert.equal(model.requests.length, 0, "the model was asked anyway");
  assert.equal(getDmStatus(t.world.campaignId), "idle", "the table was left on 'DM at work'");
  const [notice] = notices(t);
  assert.ok(notice, "the table was never told the turn stopped");
  assert.match(notice.content, /setting the scene, before the model was asked/);
  assert.ok(notice.dmTurnId, "the notice offers no Retry");
  assert.ok(isUnbuiltTurn(getDmTurn(notice.dmTurnId)), "the halted row is not marked as a turn with no prompt");

  model.script([reply({ text: "The door groans open onto a cold stair." })]);
  const retried = await route(t, "campaigns/[campaignId]/dm-turn/retry", { turnId: notice.dmTurnId });
  assert.equal(retried.status, 200, JSON.stringify(retried.json));
  await settleQueue(t.world.campaignId);
  assert.equal(model.requests.length, 1, "Retry did not run the turn");
  assert.match(narrations(t).at(-1)?.content ?? "", /cold stair/);
  assert.equal(getDmStatus(t.world.campaignId), "idle");
  assert.equal(getDmTurn(notice.dmTurnId).status, "done", "the stand-in row stayed retryable");
});

await test("An embedding model that never answers costs the turn its lore match, not the turn: keyword search carries on and the DM narrates.", async () => {
  const t = await table();
  embeddedLore(t);
  configureEmbedTimeouts({ foregroundMs: 100 });
  globalThis.__odmEmbedderPromise = new Promise(() => {});
  try {
    model.script([reply({ text: "Beyond the door, dust and quiet." })]);
    act(t, "I open the old door.");
    await settleQueue(t.world.campaignId);
  } finally {
    globalThis.__odmEmbedderPromise = workingEmbedder;
    globalThis.__odmEmbedderFailure = undefined;
    configureEmbedTimeouts({ foregroundMs: 20_000 });
  }
  assert.equal(model.requests.length, 1, "the turn never reached the model");
  assert.match(narrations(t).at(-1)?.content ?? "", /dust and quiet/);
  assert.equal(getDmStatus(t.world.campaignId), "idle");
});

await test("A turn stuck on something that never answers is stopped by the watchdog, halted with Retry, and the queue moves on; if it ever wakes it writes nothing.", async () => {
  const t = await table();
  embeddedLore(t);
  // The embedder hangs and the foreground deadline is out of reach, so only
  // the queue's watchdog can end the wait.
  configureEmbedTimeouts({ foregroundMs: 60_000 });
  let wake = () => {};
  const resumed = new Promise((resolve) => {
    wake = resolve;
  });
  globalThis.__odmEmbedderPromise = resumed.then(() => (texts) => Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }));
  try {
    act(t, "I open the door.");
    // A second job behind it, as Rewind or Ask would queue.
    let behindRan = false;
    const behind = enqueueDmJob(t.world.campaignId, async () => {
      behindRan = true;
    });
    await Promise.race([behind, wait(5_000)]);
    assert.ok(behindRan, "the job queued behind the stuck turn never ran");
    assert.equal(model.requests.length, 0);
    assert.equal(getDmStatus(t.world.campaignId), "idle", "the table was left on 'DM at work'");
    const [notice] = notices(t);
    assert.ok(notice, "the table was never told the turn stopped");
    assert.match(notice.content, /without progress while searching the lore/);
    assert.ok(notice.dmTurnId, "the notice offers no Retry");

    // The stuck wait answers at last: the abandoned turn must not go on to
    // build a prompt, ask the model or write a second notice.
    const turnsBefore = getLatestDmTurnId(t.world.campaignId);
    wake();
    await wait(200);
    await settleQueue(t.world.campaignId);
    assert.equal(model.requests.length, 0, "the abandoned turn went on to ask the model");
    assert.equal(notices(t).length, 1, "the abandoned turn wrote another notice");
    assert.equal(getLatestDmTurnId(t.world.campaignId), turnsBefore, "the abandoned turn opened a row");
  } finally {
    wake();
    globalThis.__odmEmbedderPromise = workingEmbedder;
    globalThis.__odmEmbedderFailure = undefined;
    globalThis.__odmEmbedTasks = undefined;
    configureEmbedTimeouts({ foregroundMs: 20_000 });
  }
});

await test("The lead's Stop on a turn waiting on the model halts it in the lead's words with Retry; a player cannot press it, nor stop a job that already finished.", async () => {
  const t = await table();
  const slow = held(reply({ text: "Too late." }));
  model.script([slow.entry]);
  act(t, "I wait for the ferryman.");
  let job = null;
  for (let tries = 0; tries < 100 && !(job = runningDmJob(t.world.campaignId))?.stage?.includes("model"); tries += 1) {
    await wait(20);
  }
  assert.equal(job?.stage, "waiting_model", `the job never showed it was waiting on the model (${job?.stage})`);
  assert.equal(job.kind, "turn");

  const player = t.world.addUser("player");
  const refused = await route(t, "campaigns/[campaignId]/dm-turn/stop", { jobId: job.id }, player);
  assert.ok(refused.status >= 400, "a stranger stopped the DM");

  const stopped = await route(t, "campaigns/[campaignId]/dm-turn/stop", { jobId: job.id });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.json));
  await settleQueue(t.world.campaignId);
  slow.release();
  const [notice] = notices(t);
  assert.ok(notice, "the stopped turn left no notice");
  assert.ok(notice.content.endsWith(LEAD_STOPPED_REASON), notice.content);
  assert.equal(getDmTurn(notice.dmTurnId).status, "failed");
  assert.equal(getDmStatus(t.world.campaignId), "idle");
  assert.equal(narrations(t).length, 0, "the stopped turn narrated anyway");

  const late = await route(t, "campaigns/[campaignId]/dm-turn/stop", { jobId: job.id });
  assert.equal(late.status, 409, "a stop for a finished job was taken");

  model.script([reply({ text: "The ferryman's lamp swings out of the fog." })]);
  const retried = await route(t, "campaigns/[campaignId]/dm-turn/retry", { turnId: notice.dmTurnId });
  assert.equal(retried.status, 200, JSON.stringify(retried.json));
  await settleQueue(t.world.campaignId);
  assert.match(narrations(t).at(-1)?.content ?? "", /ferryman's lamp/);
});

await test("A turn asked of a table back in the lobby does not leave it on 'DM at work'.", async () => {
  const t = await table();
  setCampaignStatus(t.world.campaignId, "lobby");
  act(t, "Ready when you are.");
  await settleQueue(t.world.campaignId);
  assert.equal(getDmStatus(t.world.campaignId), "idle");
  assert.equal(model.requests.length, 0);
});

await test("Whatever status a job leaves behind, the queue running dry sets the table back to idle.", async () => {
  const t = await table();
  enqueueDmJob(t.world.campaignId, async () => {
    setDmStatus(t.world.campaignId, "narrating");
  });
  await settleQueue(t.world.campaignId);
  assert.equal(getDmStatus(t.world.campaignId), "idle");
});

await test("The snapshot a reload reads carries the running job, and nothing once it is done.", async () => {
  const t = await table();
  const slow = held(reply({ text: "The bells ring." }));
  model.script([slow.entry]);
  act(t, "I listen.");
  await wait(150);
  const snapshotRoute = await t.world.route("campaigns/[campaignId]");
  t.world.signIn(t.world.owner);
  const during = await (await snapshotRoute.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: t.world.campaignId }) })).json();
  assert.equal(during.dmJob?.kind, "turn", JSON.stringify(during.dmJob));
  assert.equal(during.dmStatus, "thinking");
  slow.release();
  await settleQueue(t.world.campaignId);
  const after = await (await snapshotRoute.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: t.world.campaignId }) })).json();
  assert.equal(after.dmJob, null);
  assert.equal(after.dmStatus, "idle");
});

await test("The stop wording names the stage and the quiet time, and every engine stage has a deadline.", () => {
  assert.equal(
    stalledReason("searching_lore", 61_000),
    "it went 61 seconds without progress while searching the lore, so the turn was stopped. Retry it, or send a new action.",
  );
  assert.match(stalledReason("waiting_model", 5 * 60_000), /5 minutes without progress while waiting on the model/);
  for (const stage of ["starting", "setting_scene", "searching_lore", "resolving", "closing_chapter"]) {
    assert.ok(DM_JOB_STAGE_DEADLINES_MS[stage] > 0, stage);
  }
});

model.close();
finish();
