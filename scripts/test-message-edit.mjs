// Lead-only narration edit: the roll-marker guard, length bounds, and the
// variant-set invariant.
import assert from "node:assert/strict";
import {
  MAX_EDITED_LENGTH,
  checkEdit,
  extractRollMarkers,
  replaceSelectedTake,
} from "../src/lib/dm/message-edit-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const A = "[roll:11111111-1111-4111-8111-111111111111]";
const B = "[roll:22222222-2222-4222-8222-222222222222]";
const original = `He swings.\n\n${A}\n${B}\n\nThe blade bites deep.`;

check("markers are extracted in order", () => {
  assert.deepEqual(extractRollMarkers(original), [A, B]);
  assert.deepEqual(extractRollMarkers("no rolls here"), []);
});

check("a plain prose fix is accepted", () => {
  const edited = `He swings hard.\n\n${A}\n${B}\n\nThe blade bites deep into the shoulder.`;
  const result = checkEdit(original, edited);
  assert.equal(result.ok, true);
  assert.equal(result.content, edited);
});

check("dropping a roll marker is refused and names it", () => {
  // The marker is the only link between the prose and the dice record; lose
  // it and the roll card vanishes from the transcript.
  const edited = `He swings.\n\n${A}\n\nThe blade bites deep.`;
  const result = checkEdit(original, edited);
  assert.equal(result.ok, false);
  assert.match(result.reason, /drops a dice roll/i);
  assert.ok(result.reason.includes(B), "says which roll");
});

check("dropping every marker is refused", () => {
  const result = checkEdit(original, "He swings and hits.");
  assert.equal(result.ok, false);
  assert.match(result.reason, /drops a dice roll/i);
});

check("duplicating a marker is refused", () => {
  const edited = `He swings.\n\n${A}\n${A}\n${B}\n\nThe blade bites.`;
  const result = checkEdit(original, edited);
  assert.equal(result.ok, false);
  assert.match(result.reason, /repeats a dice roll/i);
});

check("inventing a marker the turn never rolled is refused", () => {
  const C = "[roll:33333333-3333-4333-8333-333333333333]";
  const edited = `He swings.\n\n${A}\n${B}\n${C}\n\nThe blade bites.`;
  const result = checkEdit(original, edited);
  assert.equal(result.ok, false);
  assert.match(result.reason, /adds a dice roll/i);
});

check("reordering markers is allowed", () => {
  // A lead moving paragraphs around a roll card is doing something
  // legitimate; the cards render wherever the markers sit.
  const edited = `He swings.\n\n${B}\n${A}\n\nThe blade bites deep.`;
  const result = checkEdit(original, edited);
  assert.equal(result.ok, true);
});

check("a message with no rolls edits freely", () => {
  const plain = "The tavern is quiet tonight.";
  const result = checkEdit(plain, "The tavern is very quiet tonight.");
  assert.equal(result.ok, true);
});

check("an empty edit is refused", () => {
  assert.equal(checkEdit(original, "   ").ok, false);
  assert.match(checkEdit(original, "").reason, /cannot be empty/i);
});

check("an over-long edit is refused", () => {
  const result = checkEdit("short", "x".repeat(MAX_EDITED_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.match(result.reason, /longer than/i);
});

check("the edit is trimmed before storing", () => {
  const result = checkEdit("a", "   spaced out   ");
  assert.equal(result.ok, true);
  assert.equal(result.content, "spaced out");
});

check("editing replaces only the selected take", () => {
  const variants = ["take one", "take two", "take three"];
  assert.deepEqual(replaceSelectedTake(variants, 1, "take two, fixed"), [
    "take one",
    "take two, fixed",
    "take three",
  ]);
  assert.deepEqual(variants, ["take one", "take two", "take three"], "input untouched");
});

check("an out-of-range take index changes nothing", () => {
  const variants = ["only"];
  assert.deepEqual(replaceSelectedTake(variants, 3, "nope"), variants);
  assert.deepEqual(replaceSelectedTake(variants, -1, "nope"), variants);
});

console.log(`message-edit: ${passed} tests passed`);
