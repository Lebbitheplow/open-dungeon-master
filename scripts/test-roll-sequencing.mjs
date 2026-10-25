// Issue #531: a local Qwen storyteller told what a check would find before the
// check was rolled. Asked for another way past a barred door, it described the
// loose stone, the crawl behind it, the flooded chamber, the missing bell and
// Aldo, and only then did the Investigation card appear; on a table with
// physical dice that text stood on screen until the player rolled. The same
// model also left "[roll:<id>]" markers in its narration and once wrote out
// its whole plan for calling request_roll beside the call.
//
// The text a reply writes beside a roll or a check is written before the dice,
// so the turn withholds it as it withholds the text beside an attack: the
// draft is emptied before the roll card shows, the passage is the one written
// from the result, and the model is told the table saw none of what it wrote
// (src/lib/dm/turn.ts OUTCOME_TOOLS, ROLL_RESULT_NOTE). A marker the model
// writes is cut from the stream and from the passage, whatever id it carries
// (src/lib/story-prompt.ts, src/lib/dm/tool-text.ts withoutRollMarkers).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-roll-sequencing");

const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
const model = await fakeModel();
model.pointAt(world);

const { subscribe } = await import("../src/lib/events.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { ROLL_RESULT_NOTE } = await import("../src/lib/dm/turn.ts");
const { withoutRollMarkers } = await import("../src/lib/dm/tool-text.ts");
const { createStreamingArtifactFilter } = await import("../src/lib/story-prompt.ts");

// The reported turn: what the check would find, told beside the check.
const SPOILER =
  "Your fingers find a loose stone low in the wall. Behind it a maintenance crawl runs to a flooded chamber, where the missing bell lies on its side and a figure turns toward you: Aldo.";
const investigate = (characterId) =>
  call("request_roll", { characterId, kind: "skill_check", skill: "investigation", difficulty: "moderate", reason: "another way past the barred door" });

// The draft events and roll cards the table is sent while `run` goes, in order.
async function watch(campaignId, run) {
  const events = [];
  const stop = subscribe(campaignId, (chunk) => {
    const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
    if (type === "dm_delta" || type === "dm_draft_reset" || type === "roll_pending") {
      events.push({ type, text: JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}").text });
    }
  });
  try {
    return { result: await run(), events };
  } finally {
    stop();
  }
}

// The draft as a client holds it after `events`: a delta appends, a reset replaces.
const draftOf = (events) =>
  events.reduce((text, event) => (event.type === "dm_delta" ? text + event.text : event.type === "dm_draft_reset" ? event.text : text), "");

const rollResult = (request) => model.results(request).map((entry) => entry.result).find((result) => typeof result.total === "number");

await test("A discovery written beside a physical-dice check never reaches the table: the draft is emptied before the card, and the passage is the one written from the player's roll.", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false, dicePolicy: "real_allowed" } });
  const rogue = table.addHero({ name: "Kara", class: "fighter", level: 1 });
  const userId = table.sheet(rogue.id).userId;
  setMemberRealDice(table.campaignId, userId, true);
  const dm = await fakeModel();
  dm.pointAt(table);
  const submitRoute = await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  const after = "You work along the mortar stone by stone, but every one sits tight. The barred door is still the only way in. What do you do?";
  dm.script([reply({ text: SPOILER, calls: [investigate(rogue.id)] }), reply({ text: after })]);
  dm.claims([[]]);

  const parked = await watch(table.campaignId, () => dm.turn(table, "I look for another way in.", rogue.id, userId));
  assert.equal(parked.result, null, "the turn narrated before the roll came in");
  const [pending] = listOpenPendingRolls(table.campaignId);
  assert.ok(pending, "no roll was parked for Kara's dice");
  const resetAt = parked.events.findIndex((event) => event.type === "dm_draft_reset");
  const cardAt = parked.events.findIndex((event) => event.type === "roll_pending");
  assert.ok(resetAt >= 0, "the streamed discovery was never taken back");
  assert.ok(cardAt > resetAt, "the roll card showed while the discovery was still in the draft");
  assert.match(parked.events.slice(0, resetAt).map((event) => event.text ?? "").join(""), /Aldo/, "the reply had streamed first");
  assert.equal(draftOf(parked.events), "", "the draft held text while the table waited on the dice");

  table.signIn({ id: userId });
  const resumed = await watch(table.campaignId, async () => {
    const answered = await callRoute(submitRoute, "POST", { dice: [3] }, { campaignId: table.campaignId, pendingRollId: pending.id });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    await settleQueue(table.campaignId);
  });
  assert.doesNotMatch(draftOf(resumed.events), /Aldo/);
  const said = listRecentMessages(table.campaignId, 50).filter((message) => message.authorType === "dm");
  assert.equal(said.length, 1, `expected one narration, found ${said.length}`);
  assert.doesNotMatch(said[0].content, /Aldo|flooded chamber|maintenance crawl/, "the discovery reached the passage");
  assert.match(said[0].content, /^\[roll:[0-9a-f-]{36}\]\s+You work along the mortar/, "the passage is not the card, then the narration from the roll");

  const last = dm.requests.at(-1);
  assert.equal(rollResult(last)?.note, ROLL_RESULT_NOTE, "the model was not told the table saw nothing it wrote beside the roll");
  assert.match(JSON.stringify(last.messages), /flooded chamber/, "the model lost its own reply");
  dm.close();
  table.close();
});

await test("Beside a digital roll the same: the passage is the roll card, then the narration written from its result.", async () => {
  world.clearDice();
  world.dice(18);
  const found = "Low in the wall a stone shifts under your thumb, and cold air breathes through the gap behind it. What do you do?";
  model.script([reply({ text: SPOILER, calls: [investigate(kara.id)] }), reply({ text: found })]);
  model.claims([[]]);
  const message = await model.turn(world, "I search the wall for another way in.", kara.id);
  world.clearDice();
  assert.doesNotMatch(message?.content ?? "", /Aldo|flooded chamber/);
  assert.match(message?.content ?? "", /^\[roll:[0-9a-f-]{36}\]\s+Low in the wall/);
  assert.equal(rollResult(model.requests.at(-1))?.note, ROLL_RESULT_NOTE);
});

await test("The text beside a group check or a notice check is withheld the same way.", async () => {
  const checks = [
    call("group_check", { skill: "stealth", characterIds: [kara.id], difficulty: "moderate", reason: "slipping past the bell tower" }),
    call("check_notice", { characterIds: [kara.id], sense: "perception", difficulty: "hard", reason: "a tripwire across the stair" }),
  ];
  for (const check of checks) {
    const story = `The ${check.name === "group_check" ? "tower" : "stair"} keeps its secrets for now. What do you do?`;
    model.script([reply({ text: "PREMATURE: You slip past unseen and spot the wire at once.", calls: [check] }), reply({ text: story })]);
    model.claims([[]]);
    const message = await model.turn(world, "We move on carefully.", kara.id);
    assert.doesNotMatch(message?.content ?? "", /PREMATURE/, `the text beside ${check.name} reached the table`);
    assert.match(message?.content ?? "", /keeps its secrets/);
    const told = model.results(model.requests.at(-1)).find((entry) => entry.id === check.id)?.result;
    assert.match(String(told?.table ?? ""), /seen nothing you wrote beside this check/, `the ${check.name} result did not say the table saw none of it`);
  }
});

await test("A plan written out beside the roll call never reaches the table.", async () => {
  // Qwen3.6-35B, its thought cut at the reasoning budget, went on deliberating
  // in the reply and then made the call.
  const plan =
    "I need to call request_roll for an Investigation check here. Wait, would Perception fit better? Let me reconsider. Kara is searching on purpose, so Investigation it is. I'll make the call now.";
  const story = "The mortar crumbles under your nails, but nothing behind it moves. What do you do?";
  world.clearDice();
  world.dice(4);
  model.script([reply({ text: plan, calls: [investigate(kara.id)] }), reply({ text: story })]);
  model.claims([[]]);
  const message = await model.turn(world, "I search the wall again.", kara.id);
  world.clearDice();
  assert.doesNotMatch(message?.content ?? "", /reconsider|Investigation it is|make the call/);
  assert.match(message?.content ?? "", /The mortar crumbles/);
});

await test("A roll marker the model writes, even with a real-looking id, is never streamed or kept.", async () => {
  const copied = `[roll:${randomUUID()}]`;
  model.script([reply({ text: `The bell rope hangs still. ${copied} Far below, water drips into the dark. [roll:investigation] What do you do?` })]);
  model.claims([[]]);
  const { result: message, events } = await watch(world.campaignId, () => model.turn(world, "I listen at the stairwell.", kara.id));
  assert.doesNotMatch(events.map((event) => event.text ?? "").join(""), /\[roll:/, "a marker reached the draft");
  assert.doesNotMatch(message?.content ?? "", /\[roll:/, "a marker reached the passage");
  assert.match(message?.content ?? "", /The bell rope hangs still\. Far below, water drips/);
});

await test("The stream filter holds a marker split across chunks and never shows it; other brackets pass.", () => {
  const run = (chunks) => {
    const filter = createStreamingArtifactFilter();
    let out = "";
    for (const chunk of chunks) {
      out += filter.push(chunk);
    }
    return out + filter.flush();
  };
  assert.equal(run(["You see ", "[ro", "ll:123e4567-e89b-12d3-a456-4266141", "74000] a door."]), "You see a door.");
  assert.equal(run(["Dust settles. [roll:pc_attack] Then silence."]), "Dust settles. Then silence.");
  assert.equal(run(["The sign reads [CLOSED", "] in red."]), "The sign reads [CLOSED] in red.");
  assert.equal(run(["A bracket at the very end ["]), "A bracket at the very end [");
  const unclosed = `[roll:${"x".repeat(100)}`;
  assert.equal(run([unclosed, " and on."]), `${unclosed} and on.`, "an unclosed bracket was held for good");
});

await test("withoutRollMarkers takes every marker out of a reply, a real id's too.", () => {
  const id = randomUUID();
  assert.equal(withoutRollMarkers(`Dust. [roll:${id}] Silence. [roll:attack]`).trim(), "Dust. Silence.");
  assert.equal(withoutRollMarkers("No markers [here]."), "No markers [here].");
});

model.close();
world.close();
finish();
