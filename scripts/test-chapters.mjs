// Chapter trigger thresholds and the never-wedge JSON parse fallback.
import assert from "node:assert/strict";
import { parseChapterJson, shouldCloseChapter } from "../src/lib/dm/chapter-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const limits = { min: 8, max: 80 };

test("no close below the floor even when a beat finished", () => {
  assert.equal(shouldCloseChapter(7, true, limits), false);
});

test("a finished beat past the floor closes", () => {
  assert.equal(shouldCloseChapter(8, true, limits), true);
});

// The whole point of beat pacing: a party that spends a long scene
// searching, shopping, or talking finishes no beat and keeps its chapter.
test("a long chapter with no finished beat stays open under the cap", () => {
  assert.equal(shouldCloseChapter(79, false, limits), false);
});

test("hard cap closes even when no beat ever finished", () => {
  assert.equal(shouldCloseChapter(80, false, limits), true);
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
