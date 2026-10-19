// Ask reads the latest narration the table just read, end included (issue
// 250). It used to get the first 300 characters of each recent message, so
// a dog the DM introduced at the end of a long passage was missing from the
// record and the answer said it was never there. Pure allocation tests on
// src/lib/dm/ask-logic.ts, then runAsk against a fake model.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { OMITTED_MARK, clipKeepingEnds, recentTranscript, transcriptPassages } from "../src/lib/dm/ask-logic.ts";
import { stopWordsFor } from "../src/lib/language/language.ts";

const { test, finish } = suite("test-ask-recent");

const filler = (n) => Array.from({ length: n }, (_, i) => `The trail climbs past stone ${i} where old hoofprints run toward the cave mouth.`).join(" ");
const DOG = "A lean grey dog slips out from behind the rocks and stares at Tavi, ears flat.";

await test("A long text keeps its opening and its end, and says how much it left out.", () => {
  const text = `Opening words of the scene. ${filler(40)} ${DOG}`;
  const clipped = clipKeepingEnds(text, 600);
  assert.ok(clipped.length <= 600 + 60, `too long: ${clipped.length}`);
  assert.ok(clipped.startsWith("Opening words"), "the opening is gone");
  assert.ok(clipped.endsWith(DOG), "the end is gone");
  assert.match(clipped, new RegExp(`\\[\\.\\.\\. [\\d,]+ ${OMITTED_MARK} \\.\\.\\.\\]`));
  assert.equal(clipKeepingEnds("short", 600), "short");
});

await test("The newest message is whole where the budget allows, and older ones share the rest.", () => {
  const lines = [
    ...Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, who: i % 2 ? "DM" : "Tavi", content: filler(8) })),
    { seq: 31, who: "DM", content: `${filler(14)} ${DOG}` },
  ];
  const { lines: out, dropped } = recentTranscript(lines, 9_000);
  const total = out.reduce((sum, line) => sum + line.length + 1, 0);
  assert.ok(total <= 9_000, `over budget: ${total}`);
  const last = out.at(-1);
  assert.ok(last.startsWith("[recent:31] DM: "), last.slice(0, 40));
  assert.ok(last.includes(DOG), "the dog at the end of the newest narration is missing");
  assert.ok(!last.includes(OMITTED_MARK), "the newest message was cut although it fits");
  assert.ok(dropped >= 0 && out.length + dropped === lines.length, "every message is either shown or counted as left out");
  // Oldest first, as the record reads.
  const seqs = out.map((line) => Number(/^\[recent:(\d+)\]/.exec(line)[1]));
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
});

await test("A newest message longer than its share still ends on what just happened.", () => {
  const lines = [
    { seq: 1, who: "Tavi", content: "I follow the hoofprints." },
    { seq: 2, who: "DM", content: `The scene opens on the ridge. ${filler(120)} ${DOG}` },
  ];
  const { lines: out } = recentTranscript(lines, 4_000);
  const last = out.at(-1);
  assert.ok(last.includes("The scene opens on the ridge"), "the newest message lost its opening");
  assert.ok(last.endsWith(DOG), "the newest message lost its end");
  assert.ok(last.includes(OMITTED_MARK), "the gap is not marked");
  assert.ok(out.join("\n").length <= 4_000);
});

await test("A search finds the passage inside a long message, not only its start.", () => {
  const lines = [
    { seq: 7, who: "DM", content: `${filler(60)} ${DOG} ${filler(10)}` },
    { seq: 8, who: "Tavi", content: "I keep walking." },
  ];
  const found = transcriptPassages(lines, "has the grey dog noticed Tavi?", stopWordsFor("english"));
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith("[recent:7] DM: "));
  assert.ok(found[0].includes("grey dog slips out"), found[0].slice(0, 200));
  assert.deepEqual(transcriptPassages(lines, "the and was", stopWordsFor("english")), []);
});

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const tavi = world.addHero({ name: "Tavi", class: "rogue", level: 3 });
const { runAsk } = await import("../src/lib/dm/ask.ts");

await test("Ask's model reads the dog at the end of the narration the player just read.", async () => {
  world.say("player", "I follow the hoofprints toward the cave.", tavi);
  world.say("dm", `You reach the cave mouth. ${filler(25)} ${DOG}`);
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: '{"answer":"It is watching Tavi.","scope":"story","citations":[]}' })]);
  const result = await runAsk({ campaignId: world.campaignId, userId: world.owner.id, question: "Has the dog noticed me?", scope: "story" });
  assert.equal(result.answer, "It is watching Tavi.");
  const evidence = model.requests[0].messages.at(-1).content;
  assert.ok(evidence.includes(DOG), "the dog never reached Ask's model");
  assert.match(evidence, /\[recent:\d+\] Tavi: I follow the hoofprints/, "the player's line is not named for its character");
  assert.ok(model.requests[0].messages[0].content.includes(OMITTED_MARK), "the system prompt does not explain the gap marker");
  model.close();
});

await test("The search hop reads the exchange in progress, whole.", async () => {
  // Push the dog's passage out of the up-front window with a run of later
  // lines, then let the model ask for it.
  for (let i = 0; i < 45; i += 1) {
    world.say(i % 2 ? "dm" : "player", `Later line ${i}: ${filler(6)}`, i % 2 ? undefined : tavi);
  }
  const model = await fakeModel();
  model.pointAt(world);
  model.script([
    reply({ calls: [call("search_campaign_records", { query: "grey dog behind the rocks" })] }),
    reply({ text: '{"answer":"A grey dog came out from the rocks.","scope":"story","citations":[]}' }),
  ]);
  const result = await runAsk({ campaignId: world.campaignId, userId: world.owner.id, question: "What came out of the rocks earlier?", scope: "story" });
  assert.equal(result.answer, "A grey dog came out from the rocks.");
  const tool = model.requests[1].messages.find((message) => message.role === "tool");
  assert.ok(tool, "the search never ran");
  assert.ok(tool.content.includes("grey dog slips out from behind the rocks"), "the search did not find the passage in the transcript");
  model.close();
});

world.close();
finish();
