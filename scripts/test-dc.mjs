// DMG difficulty ladder: tier -> DC, DC -> tier label, and the loose-spelling
// normalizer the tools feed the model's difficulty word through.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { DIFFICULTY_TIERS, dcForDifficulty, difficultyOfDc, normalizeDifficulty } = await import(
  "../src/lib/srd/dc.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("each tier maps to its canonical DMG DC", () => {
  assert.equal(dcForDifficulty("very_easy"), 5);
  assert.equal(dcForDifficulty("easy"), 10);
  assert.equal(dcForDifficulty("moderate"), 15);
  assert.equal(dcForDifficulty("hard"), 20);
  assert.equal(dcForDifficulty("very_hard"), 25);
  assert.equal(dcForDifficulty("nearly_impossible"), 30);
});

test("the ladder is strictly increasing across all tiers", () => {
  let previous = -Infinity;
  for (const tier of DIFFICULTY_TIERS) {
    const dc = dcForDifficulty(tier);
    assert.ok(dc > previous, `${tier} should exceed the previous tier`);
    previous = dc;
  }
});

test("a raw DC reads back as the hardest tier it reaches", () => {
  assert.equal(difficultyOfDc(20), "hard");
  assert.equal(difficultyOfDc(22), "hard");
  assert.equal(difficultyOfDc(25), "very_hard");
  assert.equal(difficultyOfDc(3), "very_easy");
  assert.equal(difficultyOfDc(100), "nearly_impossible");
});

test("normalizer accepts spaces, hyphens, camelCase, and synonyms", () => {
  assert.equal(normalizeDifficulty("very hard"), "very_hard");
  assert.equal(normalizeDifficulty("very-hard"), "very_hard");
  assert.equal(normalizeDifficulty("veryHard"), "very_hard");
  assert.equal(normalizeDifficulty("VERY_HARD"), "very_hard");
  assert.equal(normalizeDifficulty("medium"), "moderate");
  assert.equal(normalizeDifficulty("trivial"), "very_easy");
  assert.equal(normalizeDifficulty("impossible"), "nearly_impossible");
});

test("normalizer rejects non-difficulty input", () => {
  assert.equal(normalizeDifficulty("banana"), null);
  assert.equal(normalizeDifficulty(""), null);
  assert.equal(normalizeDifficulty(20), null);
  assert.equal(normalizeDifficulty(undefined), null);
});

console.log(`test-dc: ${passed} suites passed.`);
