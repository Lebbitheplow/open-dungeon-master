// The event log's list and its "Revert this turn" (src/app/campaigns/
// [campaignId]/event-log-logic.ts), issue #622: a turn that moved the clock
// is offered back even with fewer than two sheet changes (an undo of one
// change never moves the clock back), its time is listed where it fell, and
// a run of changes that only counted time down reads as one line. A host
// that sends no clock turns keeps the old rule.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildFeed, revertableTurns, turnOfItem } = await import("../src/app/campaigns/[campaignId]/event-log-logic.ts");
const { changesWindow, quietTick } = await import("../src/lib/sheet-audit-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

let seq = 0;
function entry(turnId, kind = "apply_damage", delta = {}, extra = {}) {
  seq += 1;
  return {
    id: `a${seq}`,
    campaignId: "c",
    characterId: "kara",
    characterName: "Kara",
    turnId,
    actor: "dm",
    kind,
    delta,
    reason: "",
    seq,
    createdAt: "",
    undoable: true,
    patchKeys: [],
    revertedBy: null,
    revertedAt: null,
    ...extra,
  };
}

test("without clock turns the old rule holds: two live changes offer the turn back, one does not", () => {
  const log = [entry("t1"), entry("t1"), entry("t2")];
  assert.deepEqual([...revertableTurns(log)], [["t1", 2]]);
  assert.deepEqual([...revertableTurns(log, [])], [["t1", 2]]);
});

test("a turn that moved the clock is offered back with one sheet change, or with none", () => {
  const log = [entry("t1"), entry("t2", "death_state")];
  const clock = [
    { turnId: "t2", seq: 50, passed: "8 hours" },
    { turnId: "t3", seq: 60, passed: "2 hours" },
  ];
  const turns = revertableTurns(log, clock);
  assert.equal(turns.has("t1"), false, "a lone change with no time moved is the single undo's");
  assert.equal(turns.get("t2"), 1);
  assert.equal(turns.get("t3"), 0, "a turn that only moved the clock cannot be put back from the log");
});

test("undone changes and undo rows do not count toward a turn's revert", () => {
  const log = [entry("t1"), entry("t1", "apply_damage", {}, { revertedAt: "x" }), entry("t1", "undo")];
  assert.equal(revertableTurns(log).has("t1"), false);
});

test("the time a turn moved on is listed where it fell, and belongs to that turn", () => {
  seq = 0;
  const log = [entry("t1"), entry("t1")];
  const feed = buildFeed(log, [], [{ turnId: "t9", seq: 2, passed: "3 hours" }]);
  assert.deepEqual(feed.map((item) => item.type), ["audit", "time", "audit"]);
  assert.equal(turnOfItem(feed[1]), "t9");
});

test("a run of one turn's quiet ticks folds into one line; changes that end or add a condition stay their own", () => {
  seq = 0;
  const log = [
    entry("t1", "condition_clock", { ended: [], added: [] }),
    entry("t1", "concentration", { spell: "Bless", roundsLeft: 9 }),
    entry("t1", "condition_clock", { ended: ["poisoned"], added: [] }),
    entry("t2", "condition_clock", { ended: [], added: [] }),
    entry("t2", "condition_clock", { ended: [], added: [] }),
  ];
  assert.equal(quietTick(log[0]), true);
  assert.equal(quietTick(log[1]), true);
  assert.equal(quietTick(log[2]), false);
  const feed = buildFeed(log, []);
  assert.deepEqual(
    feed.map((item) => (item.type === "ticks" ? `ticks:${item.turnId}:${item.entries.length}` : item.type)),
    ["ticks:t2:2", "audit", "ticks:t1:2"],
  );
  assert.equal(turnOfItem(feed[0]), "t2");
  // Folded ticks still count toward the turn's revert.
  assert.equal(revertableTurns(log).get("t2"), 2);
});

test("a window of recent changes counts real changes only: the ticks among them ride along, older ones go, and the whole is bounded", () => {
  seq = 0;
  const log = [];
  for (let n = 0; n < 5; n += 1) log.push(entry("t0", "condition_clock", { ended: [], added: [] }));
  for (let n = 0; n < 60; n += 1) {
    log.push(entry("t1"));
    log.push(entry("t1", "concentration", { spell: "Bless", roundsLeft: 9 }));
  }
  for (let n = 0; n < 300; n += 1) log.push(entry("t2", "condition_clock", { ended: [], added: [] }));
  const window = changesWindow(log, 50);
  assert.equal(window.filter((row) => !quietTick(row)).length, 50, "the window does not hold fifty changes");
  assert.equal(window[0].kind, "apply_damage", "the window opens before its oldest change");
  // Fifty changes, the tick after each, and the three hundred after the last.
  assert.equal(window.length, 50 + 50 + 300, "a tick among the changes, or after them, was dropped");
  assert.deepEqual(changesWindow(log.slice(0, 7), 50), log.slice(0, 7), "a short log is kept whole");
  assert.equal(changesWindow(log, 50, 100).length, 100, "the bound on the whole did not hold");
  assert.equal(changesWindow(log, 50, 100).at(-1), log.at(-1), "the bound kept the oldest rows, not the newest");
});

console.log(`\n${passed} event-log tests passed.`);
