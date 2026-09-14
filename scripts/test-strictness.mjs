// Strictness and tone (docs/vtt-parity-implementation-plan.md 9.2): the
// DC ladder shifts, reactions lean, the prompt says so, and the tone
// finds a bed when the scene names none.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { dcForDifficulty } = await import("../src/lib/srd/dc.ts");
const { normalizeGm, reactionBias, renderGmBlock, strictnessShift, toneBedBias } = await import("../src/lib/dm/safety-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the ladder shifts by two either way and never drops under five", () => {
  assert.equal(strictnessShift("lenient"), -2);
  assert.equal(strictnessShift("standard"), 0);
  assert.equal(strictnessShift("harsh"), 2);
  assert.equal(dcForDifficulty("moderate"), 15);
  assert.equal(dcForDifficulty("moderate", strictnessShift("harsh")), 17);
  assert.equal(dcForDifficulty("very_easy", strictnessShift("lenient")), 5);
});

test("reactions lean a step and the block names the lean and the tone", () => {
  assert.equal(reactionBias("lenient"), 1);
  assert.equal(reactionBias("harsh"), -1);
  assert.equal(reactionBias("standard"), 0);
  const gm = normalizeGm({ strictness: "harsh", tone: ["grim", "eerie", "epic", "pulpy", "nope"] });
  assert.deepEqual(gm.tone, ["grim", "eerie", "epic"], "three tones at most, unknown ones dropped");
  const block = renderGmBlock(gm);
  assert.match(block, /Rulings lean hard/);
  assert.match(block, /grim and unsparing/);
  assert.equal(renderGmBlock(normalizeGm({})), "", "nothing to say by the book with no tone");
});

test("tone picks a bed when the scene names none", () => {
  assert.equal(toneBedBias(["eerie"]), "cave");
  assert.equal(toneBedBias(["hopeful"]), null);
  assert.equal(toneBedBias(["hopeful", "epic"]), "wind");
});

console.log(`test-strictness: ${passed} passed`);
