// Continue scene: word-count targeting, the continuation merge, echoed
// opening removal, length capping, and the variant-set invariant; then whole
// continues against a scripted fake model, for the narrator's asides a
// continuation must not add.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";
import {
  CONTINUE_LOWER_RATIO,
  MAX_CONTINUED_LENGTH,
  MIN_CONTINUE_WORDS,
  buildContinueDirective,
  buildContinueMessages,
  countWords,
  lastParagraphWordCount,
  mergeContinuation,
  replaceSelectedVariant,
  stripEchoedOpening,
  targetContinueWords,
} from "../src/lib/dm/continue-logic.ts";
import { assembleVariantContent, extractFinalTake } from "../src/lib/dm/renarrate-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

check("word counting handles empty and padded text", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n  "), 0);
  assert.equal(countWords("one two   three\nfour"), 4);
});

check("a short ending floors at the death-spiral guard", () => {
  // NE-P's reason for the floor: without it one clipped ending makes every
  // subsequent continue shorter than the last.
  const short = "First paragraph is long enough to matter here.\n\nTiny tail.";
  assert.equal(lastParagraphWordCount(short), 2);
  const target = targetContinueWords(short);
  assert.equal(target.lower, MIN_CONTINUE_WORDS);
  assert.equal(target.upper, MIN_CONTINUE_WORDS);
});

check("a long ending targets a 70 to 100 percent band with no ceiling", () => {
  const long = `intro\n\n${"word ".repeat(500)}`;
  const target = targetContinueWords(long);
  assert.equal(target.upper, 500, "no cap; it matches what it extends");
  assert.equal(target.lower, Math.round(500 * CONTINUE_LOWER_RATIO));
  assert.ok(target.lower < target.upper, "a real band, not a single number");
});

check("a single-paragraph take still targets sensibly", () => {
  const one = "The door gives way under his shoulder and the cold comes in.";
  assert.equal(targetContinueWords(one).upper, MIN_CONTINUE_WORDS);
});

check("the directive carries NE-P's load-bearing instructions", () => {
  const text = buildContinueDirective("A short beat.");
  // The anti-meta rule: a reply that ended with "what do you do?" would
  // otherwise get continued as more meta commentary.
  assert.match(text, /NEVER write meta commentary/i);
  assert.match(text, /ignore that ending entirely/i);
  // The framing that keeps a continue from stalling into scenery.
  assert.match(text, /EXCEPT the player characters may act/i);
  // PC agency, which ODM needs at least as much as NE-P does.
  assert.match(text, /Do not act, speak, or decide for any player character/i);
  assert.match(text, /invites a response, never an explicit prompt for input/i);
  // Scope and engine boundary.
  assert.match(text, /Do not open a new scene, skip time/i);
  assert.match(text, /do not call any tool/i);
  assert.match(text, /words of new story/i);
});

check("the prompt replays the current take as the assistant turn", () => {
  const conversation = [
    { role: "system", content: "rules" },
    { role: "user", content: "I open the door." },
  ];
  const built = buildContinueMessages(conversation, "The door opens.");
  assert.equal(built.length, 4);
  assert.equal(built[2].role, "assistant");
  assert.equal(built[2].content, "The door opens.");
  assert.equal(built[3].role, "user");
});

check("trailing assistant turns are stripped before the replay", () => {
  const conversation = [
    { role: "user", content: "I look around." },
    { role: "assistant", content: "stale echo" },
  ];
  const built = buildContinueMessages(conversation, "current take");
  assert.equal(built.length, 3);
  assert.equal(built[0].content, "I look around.");
  assert.equal(built[1].content, "current take", "the stale echo is gone");
});

check("an echoed final sentence is trimmed off the continuation", () => {
  const take = "He steps into the hall. The lantern gutters and goes out.";
  const echoed = "The lantern gutters and goes out. Then something moves.";
  assert.equal(stripEchoedOpening(take, echoed), "Then something moves.");
});

check("a short final sentence is never treated as an echo", () => {
  // Short sentences repeat legitimately ("He runs."), so trimming on them
  // would eat real prose.
  const take = "He runs.";
  assert.equal(stripEchoedOpening(take, "He runs. And keeps running."), "He runs. And keeps running.");
});

check("merging appends with a paragraph break and keeps the original", () => {
  const merged = mergeContinuation("First beat.", "Second beat.");
  assert.equal(merged.appended, true);
  assert.equal(merged.take, "First beat.\n\nSecond beat.");
});

check("an empty continuation is refused rather than silently accepted", () => {
  const merged = mergeContinuation("First beat.", "   ");
  assert.equal(merged.appended, false);
  assert.ok(merged.reason);
  assert.equal(merged.take, "First beat.");
});

check("a continuation that is pure echo is refused", () => {
  const take = "The bridge groans under their combined weight and holds.";
  const merged = mergeContinuation(take, take);
  assert.equal(merged.appended, false, "nothing new survived the echo strip");
});

check("the total length cap stops runaway continues", () => {
  const take = "x".repeat(MAX_CONTINUED_LENGTH - 10);
  const merged = mergeContinuation(take, "y".repeat(200));
  assert.equal(merged.appended, false);
  assert.match(merged.reason, /as long as it can get/i);
  assert.equal(merged.take, take, "the take is left untouched");
});

check("roll markers survive a continue byte-identically", () => {
  const narrationParts = ["Opening beat.", "Closing beat."];
  const rollIds = ["roll-a", "roll-b"];
  const content = assembleVariantContent(narrationParts, rollIds, "Closing beat.");
  const before = content.match(/\[roll:[^\]]+\]/g);

  const take = extractFinalTake(narrationParts, rollIds, content);
  const merged = mergeContinuation(take, "The torch finally catches.");
  assert.equal(merged.appended, true);
  const extended = assembleVariantContent(narrationParts, rollIds, merged.take);

  assert.deepEqual(extended.match(/\[roll:[^\]]+\]/g), before, "same markers, same order");
  assert.ok(extended.includes("The torch finally catches."), "the continuation landed");
  assert.ok(extended.includes("Opening beat."), "the earlier segment survived");
});

check("continuing replaces only the selected variant", () => {
  const variants = ["take one", "take two", "take three"];
  const next = replaceSelectedVariant(variants, 1, "take two, extended");
  assert.deepEqual(next, ["take one", "take two, extended", "take three"]);
  assert.deepEqual(variants, ["take one", "take two", "take three"], "input untouched");
});

check("an out-of-range index leaves the variant set alone", () => {
  const variants = ["only take"];
  assert.deepEqual(replaceSelectedVariant(variants, 5, "nope"), variants);
  assert.deepEqual(replaceSelectedVariant(variants, -1, "nope"), variants);
});

check("the reroll invariant holds after a continue", () => {
  // content must always equal variants[variantIndex]; a continue that broke
  // that would make the variant counter show prose nobody can select.
  const variants = ["first take", "second take"];
  const index = 1;
  const extended = "second take\n\nand then more";
  const next = replaceSelectedVariant(variants, index, extended);
  assert.equal(next[index], extended, "content mirrors the selected entry");
});

console.log(`continue-scene: ${passed} tests passed`);

// A continuation is read for the narrator's asides like the turn loop's final
// call (src/lib/dm/turn.ts): the reader is asked for asides alone, the
// sentences it quotes are cut, and a continuation that was only the model's
// plan is refused as an empty one, with the message left as it was.
{
  const continues = suite("test-continue-scene");
  const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
  const model = await fakeModel();
  model.pointAt(world);
  const messages = await import("../src/lib/db/messages.ts");
  const { runContinueScene } = await import("../src/lib/dm/continue-scene.ts");
  const aside = (quote) => ({ kind: "aside", quote });
  const asked = (index) => model.readerRequests[index]?.messages.at(-1)?.content ?? "";

  const opening = "The ferryman coils wet rope on the quay.";
  model.script([reply({ text: opening })]);
  model.claims([]);
  const first = await model.turn(world, "I walk down to the water.", kara.id);
  assert.ok(first, "the turn wrote its narration");

  await continues.test("An aside in a continuation is cut and the rest of it is added.", async () => {
    const story = "Fog rolls off the river and he will not meet your eye.";
    const note = "I'll set the hour before anyone speaks.";
    model.script([reply({ text: `${story} ${note}` })]);
    model.claims([[aside(note)]]);
    const continued = await runContinueScene({ campaignId: world.campaignId, messageId: first.id });
    assert.ok("message" in continued, continued.error);
    assert.equal(continued.message.content, `${opening}\n\n${story}`);
    assert.match(asked(0), /^Ask: aside$/m, "the reader was asked for asides alone");
  });

  await continues.test("A continuation that is only the model's plan is refused as an empty one, and the message is left as it was.", async () => {
    const before = messages.getCampaignMessage(first.id);
    const plan = "I will set the landing and the hour first.";
    model.script([reply({ text: plan })]);
    model.claims([[aside(plan)]]);
    const continued = await runContinueScene({ campaignId: world.campaignId, messageId: first.id });
    assert.deepEqual(continued, { error: "The GM returned nothing; try again.", status: 502 });
    const after = messages.getCampaignMessage(first.id);
    assert.equal(after.content, before.content, "a plan was added to the narration");
    assert.deepEqual(after.variants, before.variants);
  });

  await continues.test("A continuation with no aside in it is read for asides and added whole.", async () => {
    const before = messages.getCampaignMessage(first.id);
    const story = "A bell tolls once across the water. Then the quay is silent.";
    model.script([reply({ text: story })]);
    model.claims([[]]);
    const continued = await runContinueScene({ campaignId: world.campaignId, messageId: first.id });
    assert.ok("message" in continued, continued.error);
    assert.equal(continued.message.content, `${before.content}\n\n${story}`);
    assert.equal(model.readerRequests.length, 1, "the continuation was read for asides");
  });

  model.close();
  world.close();
  continues.finish();
}
