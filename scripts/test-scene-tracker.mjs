// Structured non-combat scenes: the clock, what fills it, and how it ends.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  abandonTracker,
  advanceRound,
  checkTracker,
  DEFAULT_FAILURES,
  DEFAULT_SUCCESSES,
  describeTracker,
  MAX_CLOCK,
  normalizeTracker,
  recordCheck,
  TRACKER_KINDS,
  TRACKER_KIND_HINTS,
  TRACKER_KIND_LABELS,
  trackerProgress,
  trackerPromptBlock,
} = await import("../src/lib/dm/scene-tracker-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function tracker(overrides = {}) {
  const checked = checkTracker({
    kind: "social",
    title: "Talking the reeve round",
    successesNeeded: 2,
    failuresAllowed: 2,
    onSuccess: "He waives the toll",
    onFailure: "He calls the watch",
    ...overrides,
  });
  assert.ok(!("error" in checked));
  return { id: "t1", campaignId: "c1", createdAt: "t0", ...checked.tracker };
}

const attempt = (success) => ({
  characterId: "pc1",
  characterName: "Brann",
  approach: "reasoned with him",
  skill: "persuasion",
  dc: 14,
  total: success ? 18 : 8,
  success,
});

test("every kind has a label and a hint", () => {
  for (const kind of TRACKER_KINDS) {
    assert.ok(TRACKER_KIND_LABELS[kind]);
    assert.ok(TRACKER_KIND_HINTS[kind]);
  }
});

test("a scene needs a real kind and a title", () => {
  assert.ok("error" in checkTracker({ kind: "brawl", title: "x" }));
  assert.ok("error" in checkTracker({ kind: "social", title: "   " }));
});

test("the clock defaults to the shape that works", () => {
  const fresh = checkTracker({ kind: "chase", title: "Down the alley" });
  assert.equal(fresh.tracker.successesNeeded, DEFAULT_SUCCESSES);
  assert.equal(fresh.tracker.failuresAllowed, DEFAULT_FAILURES);
  assert.equal(fresh.tracker.round, 1);
  assert.equal(fresh.tracker.status, "running");
});

test("a clock is capped and never zero", () => {
  const big = checkTracker({ kind: "chase", title: "x", successesNeeded: 99, failuresAllowed: 0 });
  assert.equal(big.tracker.successesNeeded, MAX_CLOCK);
  assert.equal(big.tracker.failuresAllowed, DEFAULT_FAILURES);
});

test("a success fills the success clock and nothing else", () => {
  const advanced = recordCheck(tracker(), attempt(true));
  assert.equal(advanced.tracker.successes, 1);
  assert.equal(advanced.tracker.failures, 0);
  assert.equal(advanced.resolved, false);
  assert.equal(advanced.tracker.log.length, 1);
});

test("enough successes wins it", () => {
  let current = tracker();
  current = recordCheck(current, attempt(true)).tracker;
  const last = recordCheck(current, attempt(true));
  assert.equal(last.resolved, true);
  assert.equal(last.outcome, "won");
  assert.equal(last.tracker.status, "won");
});

test("enough failures loses it", () => {
  let current = tracker();
  current = recordCheck(current, attempt(false)).tracker;
  const last = recordCheck(current, attempt(false));
  assert.equal(last.outcome, "lost");
});

test("a check that fills both clocks at once is a loss", () => {
  // The failure that ended it happened, so it ended.
  let current = tracker({ successesNeeded: 2, failuresAllowed: 1 });
  current = recordCheck(current, attempt(true)).tracker;
  const last = recordCheck(current, attempt(false));
  assert.equal(last.outcome, "lost");
});

test("a finished scene takes no more checks", () => {
  let current = tracker();
  current = recordCheck(current, attempt(true)).tracker;
  current = recordCheck(current, attempt(true)).tracker;
  assert.ok("error" in recordCheck(current, attempt(true)));
});

test("recording does not move the round; the caller does", () => {
  const current = recordCheck(tracker(), attempt(true)).tracker;
  assert.equal(current.round, 1);
  assert.equal(advanceRound(current).round, 2);
  // Two players acting in the same round both land on that round.
  assert.equal(recordCheck(current, attempt(false)).tracker.log[1].round, 1);
});

test("a finished scene's round does not move", () => {
  let current = tracker({ successesNeeded: 1 });
  current = recordCheck(current, attempt(true)).tracker;
  assert.equal(advanceRound(current).round, current.round);
});

test("calling it off is its own outcome", () => {
  const called = abandonTracker(tracker());
  assert.equal(called.status, "abandoned");
  assert.match(describeTracker(called), /called off/);
});

test("progress is reported in both directions", () => {
  let current = tracker({ successesNeeded: 4, failuresAllowed: 2 });
  current = recordCheck(current, attempt(true)).tracker;
  current = recordCheck(current, attempt(false)).tracker;
  const progress = trackerProgress(current);
  assert.equal(progress.success, 0.25);
  assert.equal(progress.failure, 0.5);
});

test("the line the table reads says the count, not the odds", () => {
  const line = describeTracker(tracker());
  assert.match(line, /0 of 2 successes/);
  assert.match(line, /round 1/);
  assert.ok(!line.includes("%"));
});

test("a resolved scene says what it meant", () => {
  let current = tracker({ successesNeeded: 1 });
  current = recordCheck(current, attempt(true)).tracker;
  assert.match(describeTracker(current), /He waives the toll/);
});

test("the prompt block is empty unless a scene is running", () => {
  assert.equal(trackerPromptBlock(null), "");
  assert.equal(trackerPromptBlock(abandonTracker(tracker())), "");
});

test("the prompt block carries the stakes and what has been tried", () => {
  const current = recordCheck(tracker(), attempt(true)).tracker;
  const block = trackerPromptBlock(current);
  assert.match(block, /Talking the reeve round/);
  assert.match(block, /He waives the toll/);
  assert.match(block, /He calls the watch/);
  assert.match(block, /Brann/);
});

test("an unreadable stored tracker reads as none", () => {
  assert.equal(normalizeTracker(null), null);
  assert.equal(normalizeTracker({ kind: "brawl", status: "running" }), null);
  assert.equal(normalizeTracker({ kind: "social", status: "exploded" }), null);
});

test("a stored tracker survives a round trip", () => {
  const restored = normalizeTracker(JSON.parse(JSON.stringify(recordCheck(tracker(), attempt(true)).tracker)));
  assert.equal(restored.title, "Talking the reeve round");
  assert.equal(restored.successes, 1);
  assert.equal(restored.log[0].characterName, "Brann");
});

console.log(`scene-tracker: ${passed} tests passed`);
