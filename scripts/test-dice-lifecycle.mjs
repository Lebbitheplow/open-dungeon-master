// The 3D dice tray's deadlines (issue 668): a throw the library never
// finishes must still be cleared, and rolls that waited too long behind
// others are dropped instead of replayed after the fight. Run via: npm test
import assert from "node:assert/strict";
import {
  DICE_INIT_TRIES,
  DICE_QUEUE_MAX,
  DICE_ROLL_DEADLINE_MS,
  DICE_STALE_MS,
  freshRolls,
  holdAfterThrow,
  settleWithin,
  trayBuildAllowed,
} from "../src/lib/dice/dice-box-lifecycle.ts";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Timers the test fires by hand, so a deadline passes without waiting.
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    timers: {
      set(run, ms) {
        const id = next++;
        pending.set(id, { run, ms });
        return id;
      },
      clear(id) {
        pending.delete(id);
      },
    },
    fireAll() {
      for (const [id, entry] of [...pending]) {
        pending.delete(id);
        entry.run();
      }
    },
    pending,
  };
}

await test("a throw that never settles is reported as timed out", async () => {
  const clock = fakeTimers();
  const outcome = settleWithin(new Promise(() => {}), DICE_ROLL_DEADLINE_MS, clock.timers);
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0].ms, DICE_ROLL_DEADLINE_MS);
  clock.fireAll();
  assert.equal(await outcome, "timeout");
});

await test("a finished throw is done and its deadline is cancelled", async () => {
  const clock = fakeTimers();
  const outcome = await settleWithin(Promise.resolve("landed"), 1_000, clock.timers);
  assert.equal(outcome, "done");
  assert.equal(clock.pending.size, 0);
});

await test("a throw that rejects is failed, never a thrown error", async () => {
  const clock = fakeTimers();
  const outcome = await settleWithin(Promise.reject(new Error("frame threw")), 1_000, clock.timers);
  assert.equal(outcome, "failed");
  assert.equal(clock.pending.size, 0);
});

await test("a late result after the deadline changes nothing", async () => {
  const clock = fakeTimers();
  let land;
  const outcome = settleWithin(new Promise((resolve) => { land = resolve; }), 1_000, clock.timers);
  clock.fireAll();
  land("late");
  assert.equal(await outcome, "timeout");
});

await test("the real timer path settles too", async () => {
  assert.equal(await settleWithin(new Promise(() => {}), 5), "timeout");
});

await test("rolls older than the stale window are dropped, the newest kept", async () => {
  const now = 100_000;
  const queue = [
    { at: now - DICE_STALE_MS - 1, notations: ["1d20@1"] },
    { at: now - 10, notations: ["1d20@2"] },
    { at: now - 5, notations: ["1d20@3"] },
    { at: now - 4, notations: ["1d20@4"] },
    { at: now - 1, notations: ["1d20@5"] },
  ];
  const kept = freshRolls(queue, now);
  assert.equal(kept.length, DICE_QUEUE_MAX);
  assert.deepEqual(kept.map((entry) => entry.notations[0]), ["1d20@3", "1d20@4", "1d20@5"]);
  assert.equal(queue.length, 5, "the input is left alone");
});

await test("a tray build is retried once, never without WebGL", async () => {
  assert.equal(trayBuildAllowed(0, true), true);
  assert.equal(trayBuildAllowed(DICE_INIT_TRIES - 1, true), true);
  assert.equal(trayBuildAllowed(DICE_INIT_TRIES, true), false);
  assert.equal(trayBuildAllowed(0, false), false);
});

await test("a landed throw holds briefly when another roll waits", async () => {
  assert.ok(holdAfterThrow(1) < holdAfterThrow(0));
  assert.ok(holdAfterThrow(0) >= 1_000);
});

await test("the deadline sits past a real throw and the library's own frame cap", async () => {
  assert.ok(DICE_ROLL_DEADLINE_MS >= 5_000 && DICE_ROLL_DEADLINE_MS <= 20_000);
  assert.ok(DICE_STALE_MS < DICE_ROLL_DEADLINE_MS);
});

console.log(`${passed} dice lifecycle tests passed`);
