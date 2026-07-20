// Assert-based tests for the SSE delta batcher. Run via: npm test
import assert from "node:assert/strict";
import { createDeltaBatcher } from "../src/lib/dm/delta-buffer.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Manual timer harness: timers fire only when tick() is called.
function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    set: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clear: (id) => pending.delete(id),
    tick: () => {
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) {
        job.fn();
      }
    },
    count: () => pending.size,
  };
}

test("coalesces pushes into one emit per interval", () => {
  const timers = fakeTimers();
  const emitted = [];
  const batcher = createDeltaBatcher((text) => emitted.push(text), 75, timers);
  batcher.push("The ");
  batcher.push("goblin ");
  batcher.push("snarls");
  assert.equal(emitted.length, 0);
  assert.equal(timers.count(), 1);
  timers.tick();
  assert.deepEqual(emitted, ["The goblin snarls"]);
});

test("explicit flush emits immediately and cancels the timer", () => {
  const timers = fakeTimers();
  const emitted = [];
  const batcher = createDeltaBatcher((text) => emitted.push(text), 75, timers);
  batcher.push("a");
  batcher.flush();
  assert.deepEqual(emitted, ["a"]);
  assert.equal(timers.count(), 0);
  timers.tick();
  assert.deepEqual(emitted, ["a"], "no double emit after flush");
});

test("flush with nothing buffered emits nothing", () => {
  const timers = fakeTimers();
  const emitted = [];
  const batcher = createDeltaBatcher((text) => emitted.push(text), 75, timers);
  batcher.flush();
  assert.equal(emitted.length, 0);
});

test("empty pushes are ignored", () => {
  const timers = fakeTimers();
  const emitted = [];
  const batcher = createDeltaBatcher((text) => emitted.push(text), 75, timers);
  batcher.push("");
  assert.equal(timers.count(), 0);
});

test("text ordering is preserved across intervals", () => {
  const timers = fakeTimers();
  const emitted = [];
  const batcher = createDeltaBatcher((text) => emitted.push(text), 75, timers);
  batcher.push("one ");
  timers.tick();
  batcher.push("two ");
  batcher.push("three");
  timers.tick();
  assert.deepEqual(emitted, ["one ", "two three"]);
  assert.equal(emitted.join(""), "one two three");
});

console.log(`\n${passed} delta-buffer tests passed.`);
