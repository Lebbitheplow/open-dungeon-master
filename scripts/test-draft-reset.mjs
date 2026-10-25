// The table's draft bubble after the turn withholds text it already streamed.
// Each model call's text reaches the draft as it streams (dm_delta), and the
// turn can then keep none or only part of it: the narrator's asides, a reply
// that was only a plan, a fight told in prose and sent back. That text used to
// stay in the draft, run into the next call's, until the turn ended. Now the
// turn sends dm_draft_reset with the narration kept so far, and the draft
// shows that instead (src/lib/dm/turn.ts, liveStore.ts replaceDmDraft).
//
// Each case records what the table was sent and plays it into a draft the way
// the stream hook does: a delta appends, a reset replaces.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-draft-reset");

const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
const model = await fakeModel();
model.pointAt(world);
const { subscribe } = await import("../src/lib/events.ts");

const aside = (quote) => ({ kind: "aside", quote });
const record = () => call("record_event", { characterId: kara.id, kind: "story", summary: "Kara took the council's job." });
const climbRoll = () =>
  call("request_roll", { characterId: kara.id, kind: "skill_check", skill: "athletics", dc: 12, reason: "the gorge wall" });

// One turn, with the draft events the table was sent during it, in order, and
// the draft as a client would hold it just before the passage lands.
async function draftTurn(line) {
  const sent = [];
  const stop = subscribe(world.campaignId, (chunk) => {
    const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
    if (type === "dm_delta" || type === "dm_draft_reset") {
      sent.push({ type, text: JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}").text });
    }
  });
  let message;
  try {
    message = await model.turn(world, line, kara.id);
  } finally {
    stop();
  }
  const draft = sent.reduce((text, event) => (event.type === "dm_delta" ? text + event.text : event.text), "");
  return { message, sent, resets: sent.filter((event) => event.type === "dm_draft_reset"), draft };
}

await test("An ordinary turn sends no reset: what streamed is what the table keeps.", async () => {
  const story = "A ferryman coils wet rope on the quay and will not meet your eye. What do you do?";
  model.script([reply({ text: story })]);
  model.claims([[]]);
  const { message, resets, draft } = await draftTurn("I look around the quay.");
  assert.deepEqual(resets, []);
  assert.equal(draft, story);
  assert.equal(message?.content.trim(), story);
});

await test("Text streamed beside a roll leaves the draft before the dice, and the draft holds the narration written from the result.", async () => {
  // Issue #531: the text beside a roll is written before the dice.
  const climb = "You find a handhold and start up the gorge wall.";
  const top = "You haul yourself onto the ledge, breathing hard. What now?";
  model.script([reply({ text: climb, calls: [climbRoll()] }), reply({ text: top })]);
  model.claims([[]]);
  const { message, sent, resets, draft } = await draftTurn("I climb the gorge wall.");
  assert.deepEqual(resets, [{ type: "dm_draft_reset", text: "" }], "one reset, to nothing kept");
  const resetAt = sent.findIndex((event) => event.type === "dm_draft_reset");
  assert.match(sent.slice(0, resetAt).map((event) => event.text).join(""), /You find a handhold/, "the set-up had streamed first");
  assert.doesNotMatch(sent.slice(resetAt + 1).map((event) => event.text).join(""), /You find a handhold/);
  assert.equal(draft, top);
  assert.doesNotMatch(message?.content ?? "", /You find a handhold/);
});

await test("A reply that was only a plan is taken out of the draft before the narration streams.", async () => {
  const plan = "I'll see who is actually standing there before Kara's question gets an answer.";
  const story = "A ferryman coils wet rope on the quay. \"Ask the council,\" he mutters. What do you do?";
  model.script([reply({ text: plan }), reply({ text: story })]);
  model.claims([[aside(plan)], []]);
  const { message, sent, resets, draft } = await draftTurn("I ask the nearest villager what is wrong.");
  assert.equal(model.served(), 2);
  assert.deepEqual(resets, [{ type: "dm_draft_reset", text: "" }], "one reset, to nothing kept");
  const resetAt = sent.findIndex((event) => event.type === "dm_draft_reset");
  assert.match(sent.slice(0, resetAt).map((event) => event.text).join(""), /I'll see who/, "the plan had streamed first");
  assert.doesNotMatch(draft, /I'll see who/, "the plan stayed in the draft");
  assert.equal(draft, story);
  assert.equal(message?.content.trim(), story);
});

await test("An aside cut from narration leaves the draft holding the narration kept.", async () => {
  const story = "Mother Hesk presses a cold iron key into your palm. Behind her the river fog swallows the quay.";
  const note = "I'll record that Kara took the job.";
  model.script([reply({ text: `${story} ${note}`, calls: [record()] })]);
  model.claims([[aside(note)]]);
  const { message, resets, draft } = await draftTurn("I take the key.");
  assert.deepEqual(resets, [{ type: "dm_draft_reset", text: story }]);
  assert.equal(draft, story);
  assert.equal(message?.content.trim(), story);
});

await test("A plan withheld after a kept call resets the draft to the earlier narration, not to nothing.", async () => {
  const advance = "Mother Hesk counts ten gold into your palm for the climb ahead.";
  const plan = "I'll move the party to the cave mouth before narrating the climb.";
  const arrival = " You haul yourself onto the ledge outside the cave mouth. Who follows you up?";
  model.script([
    reply({ text: advance, calls: [call("modify_gold", { characterId: kara.id, delta: 10, reason: "the council's advance" })] }),
    reply({ text: plan, calls: [call("move_party", { name: "Cave Ledge", layoutDescription: "A narrow ledge before a dark cave." })] }),
    reply({ text: arrival }),
  ]);
  model.claims([[], [aside(plan)], []]);
  const { resets, draft } = await draftTurn("I take the advance and climb the gorge wall.");
  assert.equal(model.served(), 3);
  assert.deepEqual(resets, [{ type: "dm_draft_reset", text: advance }]);
  assert.equal(draft, `${advance}${arrival}`);
});

await test("A fight announced in prose and sent back to start_encounter leaves the draft.", async () => {
  const announce = "Three goblins burst from the reeds, blades out. Roll initiative!";
  const story = "The reeds hiss and go still; whatever moved there is gone. What do you do?";
  model.script([reply({ text: announce }), reply({ text: story })]);
  model.claims([[{ kind: "fight_start", quote: "Roll initiative!" }], []]);
  const { message, resets, draft } = await draftTurn("I wade into the reeds.");
  assert.equal(model.served(), 2);
  assert.match(model.requests[1].messages.at(-1).content, /start_encounter/, "the announcement was not sent back");
  assert.deepEqual(resets, [{ type: "dm_draft_reset", text: "" }]);
  assert.doesNotMatch(draft, /goblins burst/);
  assert.equal(message?.content.trim(), story);
});

model.close();
world.close();
finish();
