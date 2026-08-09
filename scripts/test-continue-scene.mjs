// Continue scene: word-count targeting, the continuation merge, echoed
// opening removal, length capping, and the variant-set invariant.
import assert from "node:assert/strict";
import {
  MAX_CONTINUE_WORDS,
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

check("the target follows the last paragraph, within bounds", () => {
  const short = "First paragraph is long enough to matter here.\n\nTiny tail.";
  assert.equal(lastParagraphWordCount(short), 2);
  assert.equal(targetContinueWords(short), MIN_CONTINUE_WORDS, "floors a short ending");

  const long = `intro\n\n${"word ".repeat(500)}`;
  assert.equal(targetContinueWords(long), MAX_CONTINUE_WORDS, "caps a long ending");

  const mid = `intro\n\n${"word ".repeat(120)}`;
  assert.equal(targetContinueWords(mid), 120, "matches a mid-length ending");
});

check("a single-paragraph take still targets sensibly", () => {
  const one = "The door gives way under his shoulder and the cold comes in.";
  assert.equal(targetContinueWords(one), MIN_CONTINUE_WORDS);
});

check("the directive forbids recapping, resolving, and ending the scene", () => {
  const text = buildContinueDirective("A short beat.");
  assert.match(text, /Do not repeat, restate, or summarise/i);
  assert.match(text, /Do not call any tool/i);
  assert.match(text, /Do not end the scene, skip time/i);
  assert.match(text, /more words/i);
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
