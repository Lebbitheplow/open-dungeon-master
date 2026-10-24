// Begin, end to end: a table started through the campaign route reaches its
// first DM narration through the real queue, in the order the kickoff
// promises. Every other suite opens its world already active, or calls the
// setup pass by itself, so the start that every campaign goes through (the
// lobby rule, the kickoff note, setup, then the arc, then chapter 1's rewind
// point, then the opening turn) was never run whole. Quick Start, the first
// thing a new player presses, gets the same walk from POST /api/starter.
//
// The model is the scripted fake (scripts/lib/enforce-narrator.mjs). It
// hands its replies out in request order, so a planning call added or
// skipped ahead of them would hand one pass's JSON to the next and degrade
// quietly; each pass is therefore found by its system prompt and the test
// checks every scripted reply reached the call it was written for. The
// turn's own requests are the ones that carry the DM's tools.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, held, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { standInStoryteller } from "./lib/stand-in-storyteller.mjs";

// An AI-run table through the routes needs a storyteller set up (the routes
// refuse one otherwise, and seat a person when none is named); this one never
// answers.
standInStoryteller();

const { test, finish } = suite("test-begin-first-turn");

// No speech server, whatever the environment says: Quick Start's table asks
// whether narration can be read aloud, and the answer must not depend on
// what runs on this machine.
process.env.TTS_PROVIDER = "off";

const campaigns = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { requestDmTurn } = await import("../src/lib/dm/loop.ts");
const { getBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");
const { getDmStatus } = await import("../src/lib/dm/status.ts");
const { dmQueueDepth } = await import("../src/lib/dm/queue.ts");
const { STARTER_ONE_SHOT } = await import("../src/lib/starter/one-shot.ts");

const OUTLINE = "1. The sexton rang the bell for the smugglers. 2. The crypt opens on the river.";
const SETUP = JSON.stringify({
  premise: "The chapel bell has stopped and the sexton is gone.",
  openingScene: "The council room above the granary, at dusk.",
  secretOutline: OUTLINE,
});
const ARC = JSON.stringify({
  premise: "The chapel bell has stopped and the sexton is gone.",
  stakes: "The village loses its nerve and its river trade.",
  antagonist: "The Hook, a smuggling crew working under the chapel.",
  acts: [
    { beats: ["The council hires the party", "The sexton's ledger is found", "The crypt gate is forced"] },
    { beats: ["The Hook's cache under the chapel", "The bell is raised again"] },
  ],
  finale: "Ring the bell again with the Hook driven off.",
});

async function send(world, user, name, method, body, campaignId = world.campaignId) {
  const route = await world.route(name);
  world.signIn(user);
  const response = await route[method](
    new Request("http://test/", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const begin = (world, user, campaignId) =>
  send(world, user, "campaigns/[campaignId]", "PATCH", { status: "active" }, campaignId);
const ready = (world, user, campaignId) =>
  send(world, user, "campaigns/[campaignId]/ready", "POST", { ready: true }, campaignId);

// A DM turn's request offers the DM's tools; setup and the arc ask for JSON,
// each under its own system prompt (src/lib/dm/setup.ts, src/lib/dm/arc.ts).
const isTurnRequest = (body) => Array.isArray(body.tools) && body.tools.length > 0;
const systemPrompt = (body) => String(body?.messages?.[0]?.content ?? "");
const SETUP_PROMPT = /You design the seed/;
const ARC_PROMPT = /You plot the secret story saga/;
// What the fake model narrates once its script runs out: the opening turn's
// own words, which the empty-turn fallback line would not contain.
const OPENING = /The moment settles, and the table waits/;

function transcript(campaignId) {
  const all = listRecentMessages(campaignId, 50);
  return {
    kickoff: all.filter((message) => message.authorType === "system"),
    dm: all.filter((message) => message.authorType === "dm"),
  };
}

await test("Begin is refused until the table is ready, then runs setup, the arc, chapter 1's rewind point and one opening narration, in that order.", async () => {
  const world = await openWorld({ status: "lobby", gameSettings: { ttsEnabled: false, aiStorySetup: true } });
  world.addHero({ name: "Kara", class: "fighter", level: 1 });
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: SETUP }), reply({ text: ARC })]);

  const early = await begin(world, world.owner);
  assert.equal(early.status, 400, JSON.stringify(early.json));
  assert.match(early.json.error ?? "", /ready up/);
  assert.equal(world.campaign().status, "lobby");
  // The route returns before any job it queued reaches the model, so the
  // queue is read first, then given the time a queued job would need.
  assert.equal(dmQueueDepth(world.campaignId), 0, "a refused start queued DM work");
  await settleQueue(world.campaignId);
  assert.equal(model.requests.length, 0, "a refused start reached the model");

  assert.equal((await ready(world, world.owner)).status, 200);
  const started = await begin(world, world.owner);
  assert.equal(started.status, 200, JSON.stringify(started.json));
  await settleQueue(world.campaignId);

  const campaign = world.campaign();
  assert.equal(campaign.status, "active");
  assert.equal(campaign.dmOutline, OUTLINE, "the setup pass did not run");
  assert.ok(campaign.storyArc, "the arc planner wrote no arc");

  const { kickoff, dm } = transcript(world.campaignId);
  assert.equal(kickoff.length, 1, "one kickoff note");
  assert.match(kickoff[0].content, /The party is assembled/);
  // The table reads the note; the instruction for the opening is the
  // model's alone (found playing Quick Start: it showed in the story log).
  assert.doesNotMatch(kickoff[0].content, /Introduce the opening scene/, "the DM's instruction is in the table's note");
  const opening = model.requests.find(isTurnRequest);
  assert.match(JSON.stringify(opening?.messages ?? []), /The party is assembled and the adventure begins\. Introduce the opening scene/, "the opening turn was not asked for the opening scene");
  assert.equal(dm.length, 1, `expected one opening narration, found ${dm.length}`);
  assert.match(dm[0].content, OPENING, "the opening turn narrated nothing of its own");
  assert.ok(dm[0].seq > kickoff[0].seq, "the narration came before the kickoff");

  // Chapter 1's rewind point is the world before the opening scene, and
  // after setup and the arc, so a rewind to chapter 1 keeps both.
  const snapshot = getBoundarySnapshot(world.campaignId, 1);
  assert.ok(snapshot, "no chapter 1 rewind point");
  assert.ok(snapshot.meta.boundarySeq < dm[0].seq, "the rewind point was taken after the opening");
  assert.equal(snapshot.payload.campaign.dm_outline, OUTLINE, "the rewind point was taken before the setup pass");
  assert.match(String(snapshot.payload.campaign.story_arc_json ?? ""), /The sexton's ledger is found/, "the rewind point was taken before the arc");

  // Each scripted reply reached the call it was written for: setup first,
  // then the arc.
  assert.match(systemPrompt(model.requests[0]), SETUP_PROMPT, "the first call was not the setup pass");
  assert.match(systemPrompt(model.requests[1]), ARC_PROMPT, "the second call was not the arc planner");
  // Both ran before the turn, and the turn read what they wrote: with an arc
  // in place the prompt carries the arc instead of the outline
  // (src/lib/dm/prompt.ts), so the arc's beats are the proof.
  const firstTurn = model.requests.findIndex(isTurnRequest);
  assert.ok(firstTurn >= 2, `the turn ran before setup and the arc (request ${firstTurn})`);
  assert.match(JSON.stringify(model.requests[firstTurn].messages), /The sexton's ledger is found/);
  assert.equal(getDmStatus(world.campaignId), "idle");

  // A second Begin changes nothing.
  const again = await begin(world, world.owner);
  assert.equal(again.status, 400);
  assert.match(again.json.error ?? "", /already started/);
  await settleQueue(world.campaignId);
  assert.equal(transcript(world.campaignId).dm.length, 1, "a second Begin narrated again");
  model.close();
  world.close();
});

await test("Quick Start: the starter route, a ready-made hero, Begin, and the opening narration.", async () => {
  const world = await openWorld({ status: "lobby" });
  const created = await send(world, world.owner, "starter", "POST", { solo: true });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.campaign.role, "owner", "the starter told its creator they are a player");
  const campaignId = created.json.campaign.id;
  assert.equal(campaigns.getCampaignById(campaignId).status, "lobby");

  const model = await fakeModel();
  model.pointAt({ owner: world.owner, campaignId });
  // The starter's outline is written before Begin, so the setup pass stands
  // aside (src/lib/dm/setup.ts) and the arc planner is the first call.
  model.script([reply({ text: ARC })]);

  const seated = await send(world, world.owner, "campaigns/[campaignId]/sheet/pregen", "POST", { id: "kara" }, campaignId);
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  assert.match(seated.json.sheet?.name ?? "", /Kara/);

  assert.equal((await ready(world, world.owner, campaignId)).status, 200);
  const started = await begin(world, world.owner, campaignId);
  assert.equal(started.status, 200, JSON.stringify(started.json));
  await settleQueue(campaignId);

  const table = campaigns.getCampaignById(campaignId);
  assert.equal(table.status, "active");
  assert.equal(table.dmOutline, STARTER_ONE_SHOT.outline, "the starter's outline was replaced");
  assert.ok(table.storyArc, "the arc planner wrote no arc");
  assert.ok(!model.requests.some((body) => SETUP_PROMPT.test(systemPrompt(body))), "the setup pass ran over the starter's outline");
  assert.match(systemPrompt(model.requests[0]), ARC_PROMPT, "the arc's reply went to another call");
  assert.match(JSON.stringify(model.requests[0].messages), /Aldo Merrin/, "the arc planner never read the starter's outline");

  const { kickoff, dm } = transcript(campaignId);
  assert.equal(kickoff.length, 1);
  assert.equal(dm.length, 1, `expected one opening narration, found ${dm.length}`);
  assert.ok(dm[0].seq > kickoff[0].seq);
  assert.match(dm[0].content, OPENING, "the opening turn narrated nothing of its own");
  const firstTurn = model.requests.findIndex(isTurnRequest);
  assert.ok(firstTurn > 0, "the opening turn never asked the model");
  assert.match(JSON.stringify(model.requests[firstTurn].messages), /The sexton's ledger is found/, "the opening turn did not read the arc");
  // The premise has them arrive at dusk, and the opening turn is told so.
  assert.match(JSON.stringify(model.requests[firstTurn].messages), /Date and time: Midweek, Greening 1, year 1 \(18:00\), evening/);
  model.close();
  world.close();
});

// A table begun the whole way, its opening narrated: setup, the arc, then
// the opening turn's own words.
async function begun() {
  const world = await openWorld({ status: "lobby", gameSettings: { ttsEnabled: false, aiStorySetup: true } });
  world.addHero({ name: "Kara", class: "fighter", level: 1 });
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: SETUP }), reply({ text: ARC })]);
  assert.equal((await ready(world, world.owner)).status, 200);
  assert.equal((await begin(world, world.owner)).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(transcript(world.campaignId).dm.length, 1, "the table never got its opening");
  return { world, model };
}

const rewindToChapterOne = (world) =>
  send(world, world.owner, "campaigns/[campaignId]/chapters/rollback", "POST", { chapterIndex: 1, confirm: true });

await test("A rewind to chapter 1 takes the opening with it, and the DM tells the opening again on its own.", async () => {
  const { world, model } = await begun();
  model.script([]);
  const rewound = await rewindToChapterOne(world);
  assert.equal(rewound.status, 200, JSON.stringify(rewound.json));
  await settleQueue(world.campaignId);

  const all = listRecentMessages(world.campaignId, 50);
  const note = all.find((message) => /The story rewinds to the start of Chapter 1/.test(message.content));
  assert.ok(note, "no rewind note");
  const dm = all.filter((message) => message.authorType === "dm");
  // Found on 2026-10-23: the table read the note and then sat silent for 25
  // minutes, the opening gone and nothing asking for another.
  assert.equal(dm.length, 1, `expected one new opening narration, found ${dm.length}`);
  assert.ok(dm[0].seq > note.seq, "the narration is not the new opening");
  const turn = model.requests.find(isTurnRequest);
  assert.ok(turn, "no turn reached the model after the rewind");
  assert.match(JSON.stringify(turn.messages), /The party is assembled and the adventure begins\. Introduce the opening scene/, "the new turn was not asked for the opening scene");
  assert.equal(getDmStatus(world.campaignId), "idle");
  model.close();
  world.close();
});

await test("A rewind goes ahead of the work queued behind the turn it stops, and that work runs after it.", async () => {
  const { world, model } = await begun();
  const ARC_AGAIN = ARC.replace("The sexton's ledger is found", "The bell-rope is found cut");
  const slow = held(reply({ text: "The council falls quiet as" }));
  model.script([slow.entry, reply({ text: ARC_AGAIN })]);
  // A player speaks; the DM's answer is still being written.
  const seq = campaigns.allocateSeq(world.campaignId);
  insertCampaignMessage({ campaignId: world.campaignId, seq, authorType: "player", userId: world.owner.id, content: "I ask the council what they need." });
  requestDmTurn(world.campaignId);
  while (!model.requests.some(isTurnRequest)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // The lead asks for a new story plan (queued behind the turn), then rewinds.
  assert.equal((await send(world, world.owner, "campaigns/[campaignId]/arc", "POST", {})).status, 202);
  const rewound = await rewindToChapterOne(world);
  assert.equal(rewound.status, 200, JSON.stringify(rewound.json));
  slow.release();
  await settleQueue(world.campaignId);

  // The rewind restores the arc of chapter 1's rewind point. Behind the
  // queue it ran after the new plan and put the old one back; first, it
  // runs before, and the plan the lead asked for is the one that stands.
  const arc = JSON.stringify(world.campaign().storyArc);
  assert.match(arc, /The bell-rope is found cut/, "the new plan was undone by the rewind behind it");
  const arcAt = model.requests.findIndex((body) => ARC_PROMPT.test(systemPrompt(body)));
  const openingAt = model.requests.findIndex((body, index) => index > arcAt && isTurnRequest(body));
  assert.ok(arcAt > 0 && openingAt > arcAt, "the opening was not told after the new plan");
  assert.match(JSON.stringify(model.requests[openingAt].messages), /The bell-rope is found cut/, "the new opening did not read the new plan");
  const dm = transcript(world.campaignId).dm;
  assert.equal(dm.length, 1, `expected the one new opening, found ${dm.length}`);
  assert.doesNotMatch(dm[0].content, /The council falls quiet as/, "the stopped turn's words survived the rewind");
  model.close();
  world.close();
});

finish();
