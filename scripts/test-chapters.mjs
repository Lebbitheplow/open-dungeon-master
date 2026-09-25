// Chapter trigger thresholds, beat spacing, the judge gate, and the
// never-wedge JSON parse fallback.
import assert from "node:assert/strict";
import {
  beatCountsToward,
  parseChapterJson,
  shouldCloseChapter,
  shouldJudgeBeat,
} from "../src/lib/dm/chapter-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const limits = { min: 8, max: 80, beatsRequired: 2 };

test("no close below the floor even with enough beats finished", () => {
  assert.equal(shouldCloseChapter(7, 2, false, limits), false);
  assert.equal(shouldCloseChapter(7, 5, true, limits), false);
});

test("one finished beat past the floor is not yet a chapter", () => {
  assert.equal(shouldCloseChapter(8, 1, false, limits), false);
  assert.equal(shouldCloseChapter(40, 1, false, limits), false);
});

test("the required beat count past the floor closes", () => {
  assert.equal(shouldCloseChapter(8, 2, false, limits), true);
  assert.equal(shouldCloseChapter(8, 3, false, limits), true);
});

test("a single required beat behaves like the old pacing", () => {
  assert.equal(shouldCloseChapter(8, 1, false, { ...limits, beatsRequired: 1 }), true);
});

// The whole point of beat pacing: a party that spends a long scene
// searching, shopping, or talking finishes no beat and keeps its chapter.
test("a long chapter with no finished beat stays open under the cap", () => {
  assert.equal(shouldCloseChapter(79, 0, false, limits), false);
});

test("hard cap closes even when no beat ever finished", () => {
  assert.equal(shouldCloseChapter(80, 0, false, limits), true);
});

// An act this chapter finished must close promptly: the next act (or sequel
// saga) is planned at chapter close, even when the beat count is short.
test("an exhausted arc past the floor closes on a single beat", () => {
  assert.equal(shouldCloseChapter(8, 1, true, limits), true);
});

// Issue #31: a chapter that OPENS exhausted (planning failed at the last
// close) must not close again as its retry, or a flaky arc model yields a
// run of eight-message stub chapters. chapter-close.ts plans in place.
test("an exhausted arc with no beat this chapter stays open under the cap", () => {
  assert.equal(shouldCloseChapter(8, 0, true, limits), false);
  assert.equal(shouldCloseChapter(79, 0, true, limits), false);
  assert.equal(shouldCloseChapter(80, 0, true, limits), true);
});

test("an exhausted arc below the floor still waits for the floor", () => {
  assert.equal(shouldCloseChapter(5, 1, true, limits), false);
});

// Two beats inside one stretch of play are one moment ("reach the
// village", then "speak to its elder") and count once.
test("a beat counts when it is the chapter's first or far enough from the last", () => {
  assert.equal(beatCountsToward(null, 8), true);
  assert.equal(beatCountsToward(8, 8), true);
  assert.equal(beatCountsToward(20, 8), true);
});

test("a beat landing within the spacing of the last one does not count", () => {
  assert.equal(beatCountsToward(0, 8), false);
  assert.equal(beatCountsToward(2, 8), false);
  assert.equal(beatCountsToward(7, 8), false);
});

test("zero spacing restores one chapter beat per arc beat", () => {
  assert.equal(beatCountsToward(0, 0), true);
});

const judgeOptions = { min: 16, beatsRequired: 2, judgeEvery: 6, spacing: 8 };
const readyToJudge = {
  messageCount: 24,
  beatsDone: 1,
  beatCompletedThisTurn: false,
  messagesSinceLastBeat: 10,
  messagesSinceLastJudge: 6,
  options: judgeOptions,
};

test("the judge runs past the floor, past the spacing, on its cadence", () => {
  assert.equal(shouldJudgeBeat(readyToJudge), true);
  assert.equal(shouldJudgeBeat({ ...readyToJudge, messagesSinceLastBeat: null }), true);
});

// The core of issue #31: complete_beat moved [NOW] to the next beat, and the
// judge was asked about that one against the very same messages.
test("the judge never runs in the turn a beat was just completed", () => {
  assert.equal(shouldJudgeBeat({ ...readyToJudge, beatCompletedThisTurn: true }), false);
});

test("the judge waits out the spacing after the last beat", () => {
  assert.equal(shouldJudgeBeat({ ...readyToJudge, messagesSinceLastBeat: 7 }), false);
  assert.equal(shouldJudgeBeat({ ...readyToJudge, messagesSinceLastBeat: 8 }), true);
});

test("the judge is idle below the floor, on its cadence, and once the quota is met", () => {
  assert.equal(shouldJudgeBeat({ ...readyToJudge, messageCount: 15 }), false);
  assert.equal(shouldJudgeBeat({ ...readyToJudge, messagesSinceLastJudge: 5 }), false);
  assert.equal(shouldJudgeBeat({ ...readyToJudge, beatsDone: 2 }), false);
});

test("clean JSON parses fully", () => {
  const parsed = parseChapterJson(
    '{"title":"The Ember Road","summary":"The party crossed the pass.","highlights":["Fought wolves","Met Yara"]}',
    3,
  );
  assert.equal(parsed.title, "The Ember Road");
  assert.equal(parsed.summary, "The party crossed the pass.");
  assert.deepEqual(parsed.highlights, ["Fought wolves", "Met Yara"]);
});

test("code-fenced JSON with chatter still parses", () => {
  const parsed = parseChapterJson(
    'Here is the chapter:\n```json\n{"title":"Deep Cells","summary":"Escape.","highlights":["Broke out"]}\n```',
    2,
  );
  assert.equal(parsed.title, "Deep Cells");
});

test("garbage falls back to Chapter N and still closes", () => {
  const parsed = parseChapterJson("the model rambled with no json at all", 4);
  assert.equal(parsed.title, "Chapter 4");
  assert.equal(parsed.summary, "");
  assert.deepEqual(parsed.highlights, []);
});

test("oversized fields are clamped", () => {
  const parsed = parseChapterJson(
    JSON.stringify({
      title: "x".repeat(200),
      summary: "ok",
      highlights: Array.from({ length: 12 }, (_, index) => `h${index}`),
    }),
    1,
  );
  assert.equal(parsed.title.length, 80);
  assert.equal(parsed.highlights.length, 6);
});

console.log(`${passed} chapter tests passed`);
