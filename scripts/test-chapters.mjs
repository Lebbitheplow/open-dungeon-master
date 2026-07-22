// Chapter trigger thresholds and the never-wedge JSON parse fallback.
import assert from "node:assert/strict";
import { parseChapterJson, shouldCloseChapter } from "../src/lib/dm/chapter-logic.ts";

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

// An exhausted act must close promptly: the next act (or sequel saga) is
// only planned at chapter close, even when the beat count is short, and
// even at zero beats (a chapter can open exhausted after a failed planning
// pass; closing again is the retry).
test("an exhausted arc past the floor closes regardless of beat count", () => {
  assert.equal(shouldCloseChapter(8, 1, true, limits), true);
  assert.equal(shouldCloseChapter(8, 0, true, limits), true);
});

test("an exhausted arc below the floor still waits for the floor", () => {
  assert.equal(shouldCloseChapter(5, 1, true, limits), false);
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
