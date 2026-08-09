// House-rule activation: the verbatim threshold, trigger-keyword admission,
// and how those interact with pinning and ordinary retrieval.
import assert from "node:assert/strict";
import {
  VERBATIM_HEADROOM,
  matchesTrigger,
  parseTriggerKeywords,
  rulesVerbatimThreshold,
  selectRuleChunks,
  serializeTriggerKeywords,
  shouldSendVerbatim,
} from "../src/lib/dm/rules-activation-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const chunk = (id, extra = {}) => ({
  id,
  text: `Rule ${id} body.`,
  enabled: true,
  pinned: false,
  triggerKeywords: "",
  ...extra,
});
// Roughly `tokens` tokens at four characters each.
const big = (tokens) => "x".repeat(tokens * 4);

check("keyword lists round-trip through the stored text column", () => {
  assert.deepEqual(parseTriggerKeywords("flanking, long rest ,  "), ["flanking", "long rest"]);
  assert.deepEqual(parseTriggerKeywords(""), []);
  assert.equal(serializeTriggerKeywords([" flanking ", "", "long rest"]), "flanking, long rest");
});

check("trigger matching is word-bounded", () => {
  // "rest" must not fire on "arrest" or "restrain".
  assert.equal(matchesTrigger("we arrest the thief", ["rest"]), null);
  assert.equal(matchesTrigger("we take a long rest", ["rest"]), "rest");
});

check("multi-word triggers match as a phrase", () => {
  assert.equal(matchesTrigger("we take a long rest here", ["long rest"]), "long rest");
  assert.equal(matchesTrigger("a long and weary rest", ["long rest"]), null);
});

check("matching returns which keyword fired, for the manager UI", () => {
  assert.equal(matchesTrigger("I flank the ogre", ["flanking", "flank"]), "flank");
});

check("the verbatim threshold is the budget plus NE-P's headroom", () => {
  assert.equal(rulesVerbatimThreshold(1_000), Math.floor(1_000 * VERBATIM_HEADROOM));
  assert.equal(shouldSendVerbatim(big(1_100), 1_000), true, "within headroom rides whole");
  assert.equal(shouldSendVerbatim(big(1_300), 1_000), false, "past headroom needs retrieval");
});

check("a small rules document is sent whole and skips retrieval entirely", () => {
  // Three fragments of a document beat nothing, but the whole document beats
  // three fragments, so retrieval is not worth running when it all fits.
  const result = selectRuleChunks([chunk("a"), chunk("b"), chunk("c")], "anything", 1_000);
  assert.equal(result.verbatim, true);
  assert.equal(result.forced.length, 3);
  assert.deepEqual(result.retrievable, []);
});

check("a large document falls back to pinned plus retrievable", () => {
  const chunks = [
    chunk("pinned", { pinned: true, text: big(200) }),
    chunk("ordinary", { text: big(200) }),
  ];
  const result = selectRuleChunks(chunks, "anything", 100);
  assert.equal(result.verbatim, false);
  assert.deepEqual(result.forced.map((entry) => entry.id), ["pinned"]);
  assert.deepEqual(result.retrievable.map((entry) => entry.id), ["ordinary"]);
});

check("a trigger keyword admits its chunk without spending a retrieval slot", () => {
  // The whole point: "we play with flanking" is relevant when someone says
  // flanking, whether or not it out-scores three vector hits.
  const chunks = [
    chunk("flank", { triggerKeywords: "flanking, flank", text: big(200) }),
    chunk("other", { text: big(200) }),
  ];
  const result = selectRuleChunks(chunks, "I move to flank the ogre", 100);
  assert.deepEqual(result.forced.map((entry) => entry.id), ["flank"]);
  assert.equal(result.triggeredBy.flank, "flank");
  assert.deepEqual(result.retrievable.map((entry) => entry.id), ["other"]);
});

check("an unmatched trigger leaves the chunk to ordinary retrieval", () => {
  const chunks = [chunk("flank", { triggerKeywords: "flanking", text: big(200) })];
  const result = selectRuleChunks(chunks, "I talk to the innkeeper", 100);
  assert.deepEqual(result.forced, []);
  assert.deepEqual(result.retrievable.map((entry) => entry.id), ["flank"]);
  assert.deepEqual(result.triggeredBy, {});
});

check("pinning wins over triggers and is never double-counted", () => {
  const chunks = [
    chunk("both", { pinned: true, triggerKeywords: "flanking", text: big(200) }),
    chunk("filler", { text: big(200) }),
  ];
  const result = selectRuleChunks(chunks, "flanking rules", 100);
  assert.equal(result.forced.filter((entry) => entry.id === "both").length, 1);
  assert.equal(result.triggeredBy.both, undefined, "pinned short-circuits before the trigger");
});

check("disabled chunks never appear anywhere", () => {
  const chunks = [
    chunk("off", { enabled: false, pinned: true, triggerKeywords: "flanking", text: big(200) }),
    chunk("on", { text: big(200) }),
  ];
  const result = selectRuleChunks(chunks, "flanking", 100);
  assert.equal(result.forced.length, 0);
  assert.deepEqual(result.retrievable.map((entry) => entry.id), ["on"]);
});

check("no chunks at all is verbatim-empty rather than a crash", () => {
  const result = selectRuleChunks([], "anything", 100);
  assert.equal(result.verbatim, true);
  assert.deepEqual(result.forced, []);
});

console.log(`rules-activation: ${passed} tests passed`);
