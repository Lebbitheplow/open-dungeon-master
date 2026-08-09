// In-flight utility calls: the registry bookkeeping and the chip text.
import assert from "node:assert/strict";
import {
  ELAPSED_VISIBLE_MS,
  UTILITY_CALL_LABELS,
  addCall,
  describeCall,
  formatElapsed,
  removeCall,
  sortCalls,
} from "../src/lib/dm/call-tracker-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const call = (id, kind, startedAt) => ({ id, kind, startedAt });

check("every kind has a label", () => {
  for (const [kind, label] of Object.entries(UTILITY_CALL_LABELS)) {
    assert.ok(label.length > 0, `${kind} needs a label`);
    assert.equal(describeCall(kind), label);
  }
});

check("labels say what the engine is doing, not what runs", () => {
  // A player reads this strip, not an operator reading a log.
  for (const label of Object.values(UTILITY_CALL_LABELS)) {
    assert.ok(!/[_(]/.test(label), `"${label}" reads like an identifier`);
  }
});

check("an unknown kind degrades rather than rendering undefined", () => {
  assert.equal(describeCall("something-new"), "Working");
});

check("adding registers a call", () => {
  const calls = addCall([], call("a", "chapter", 1000));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "a");
});

check("two calls of the same kind coexist", () => {
  // The reason ids exist. Keying by kind would let the first seal to finish
  // clear the chip for a second one still running.
  const calls = addCall(addCall([], call("a", "chapter", 1)), call("b", "chapter", 2));
  assert.equal(calls.length, 2);
});

check("removing one leaves the other running", () => {
  const both = addCall(addCall([], call("a", "chapter", 1)), call("b", "chapter", 2));
  const left = removeCall(both, "a");
  assert.deepEqual(
    left.map((entry) => entry.id),
    ["b"],
  );
});

check("removing an id that is not there is a no-op", () => {
  // The finally in trackUtilityCall can run against a registry another
  // process already cleared; it must not throw or duplicate.
  const calls = addCall([], call("a", "ask", 1));
  assert.deepEqual(removeCall(calls, "zzz"), calls);
  assert.deepEqual(removeCall([], "a"), []);
});

check("re-adding the same id replaces rather than duplicating", () => {
  const calls = addCall(addCall([], call("a", "ask", 1)), call("a", "ask", 2));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startedAt, 2);
});

check("adding does not mutate the input", () => {
  const original = [call("a", "ask", 1)];
  addCall(original, call("b", "lore", 2));
  removeCall(original, "a");
  assert.equal(original.length, 1);
});

check("chips are ordered oldest first", () => {
  // So a chip does not jump position when a newer call finishes.
  const sorted = sortCalls([call("c", "ask", 30), call("a", "world", 10), call("b", "lore", 20)]);
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["a", "b", "c"],
  );
});

check("ties break deterministically", () => {
  const sorted = sortCalls([call("b", "ask", 5), call("a", "ask", 5)]);
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["a", "b"],
  );
});

check("sorting does not mutate the input", () => {
  const original = [call("b", "ask", 5), call("a", "ask", 1)];
  sortCalls(original);
  assert.equal(original[0].id, "b");
});

check("a fast call shows no elapsed time at all", () => {
  // A number that flickers 0s, 1s, 0s reads as instability.
  assert.equal(formatElapsed(1000, 1000), "");
  assert.equal(formatElapsed(1000, 1000 + ELAPSED_VISIBLE_MS - 1), "");
});

check("a slow call shows seconds", () => {
  assert.equal(formatElapsed(0, ELAPSED_VISIBLE_MS), `${ELAPSED_VISIBLE_MS / 1000}s`);
  assert.equal(formatElapsed(0, 42_000), "42s");
  assert.equal(formatElapsed(0, 59_999), "59s");
});

check("past a minute it reads as minutes and seconds", () => {
  assert.equal(formatElapsed(0, 60_000), "1m 0s");
  assert.equal(formatElapsed(0, 125_000), "2m 5s");
});

check("a clock that jumps backwards does not render nonsense", () => {
  assert.equal(formatElapsed(10_000, 0), "");
  assert.equal(formatElapsed(Number.NaN, 1000), "");
});

console.log(`call-tracker: ${passed} tests passed`);
