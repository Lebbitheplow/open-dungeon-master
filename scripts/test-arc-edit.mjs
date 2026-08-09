// The lead's beat editor. The load-bearing property is that settled beats are
// untouchable: they are a record of what happened at the table, not a plan.
import assert from "node:assert/strict";
import {
  MAX_BEAT_TEXT,
  MAX_TOTAL_BEATS,
  applyBeatEdit,
  clampBeatText,
  isEditError,
} from "../src/lib/dm/arc-edit-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

function arc(beats, acts = 2) {
  return {
    version: 3,
    premise: "p",
    stakes: "s",
    antagonist: "a",
    beats: beats.map((beat) => ({ act: 1, ...beat })),
    acts,
    finale: "f",
    saga: null,
    cast: [],
    events: [],
    subArcs: [],
    worldArcs: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ok(result) {
  assert.equal(isEditError(result), false, `expected success, got ${result.error}`);
  return result.arc;
}

const SAMPLE = arc([
  { text: "one", status: "done" },
  { text: "two", status: "active" },
  { text: "three", status: "pending" },
  { text: "four", status: "pending", act: 2 },
]);

check("a pending beat can be renamed", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "rename", beat: 3, text: "  three  bis " }));
  assert.equal(next.beats[2].text, "three bis", "whitespace-collapsed");
  assert.equal(SAMPLE.beats[2].text, "three", "the input arc is not mutated");
});

check("a settled beat's text is part of the record", () => {
  // The immutability rule arc-logic.ts states in its header. The lead is not
  // an exception to it: renaming a played beat would rewrite history.
  const done = applyBeatEdit(SAMPLE, { op: "rename", beat: 1, text: "nope" });
  assert.ok(isEditError(done));
  assert.match(done.error, /already played/i);
  const skipped = applyBeatEdit(
    arc([{ text: "one", status: "skipped" }]),
    { op: "rename", beat: 1, text: "nope" },
  );
  assert.ok(isEditError(skipped));
});

check("an empty rename is refused rather than blanking the beat", () => {
  assert.ok(isEditError(applyBeatEdit(SAMPLE, { op: "rename", beat: 3, text: "   " })));
});

check("beat text is clamped", () => {
  assert.equal(clampBeatText("x".repeat(MAX_BEAT_TEXT + 50)).length, MAX_BEAT_TEXT);
  const next = ok(
    applyBeatEdit(SAMPLE, { op: "rename", beat: 3, text: "y".repeat(MAX_BEAT_TEXT + 50) }),
  );
  assert.equal(next.beats[2].text.length, MAX_BEAT_TEXT);
});

check("skipping the [NOW] beat hands the cursor onward", () => {
  // Otherwise the arc stalls with no active beat and the DM steers by nothing.
  const next = ok(applyBeatEdit(SAMPLE, { op: "skip", beat: 2 }));
  assert.equal(next.beats[1].status, "skipped");
  assert.equal(next.beats[2].status, "active");
});

check("skipping a later beat leaves [NOW] where it is", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "skip", beat: 3 }));
  assert.equal(next.beats[1].status, "active");
  assert.equal(next.beats[2].status, "skipped");
});

check("a settled beat cannot be skipped again", () => {
  assert.ok(isEditError(applyBeatEdit(SAMPLE, { op: "skip", beat: 1 })));
});

check("setNow moves the cursor and clears the old one", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "setNow", beat: 4 }));
  assert.equal(next.beats[3].status, "active");
  assert.equal(next.beats[1].status, "pending", "the old [NOW] demotes to pending");
  assert.equal(next.beats.filter((beat) => beat.status === "active").length, 1);
});

check("setNow cannot reopen a played beat", () => {
  // Monotonic completion: a done beat never becomes the thing the DM is
  // steering toward again.
  const result = applyBeatEdit(SAMPLE, { op: "setNow", beat: 1 });
  assert.ok(isEditError(result));
  assert.match(result.error, /cannot go back/i);
});

check("moving swaps two unsettled beats within an act", () => {
  const source = arc([
    { text: "a", status: "active" },
    { text: "b", status: "pending" },
    { text: "c", status: "pending" },
  ]);
  const next = ok(applyBeatEdit(source, { op: "move", beat: 3, direction: "up" }));
  assert.deepEqual(
    next.beats.map((beat) => beat.text),
    ["a", "c", "b"],
  );
  assert.deepEqual(
    next.beats.map((beat) => beat.status),
    ["active", "pending", "pending"],
    "statuses stay with positions, not with the text",
  );
});

check("moving a beat into the [NOW] slot makes it the beat in play", () => {
  // This is the whole reason to allow the move: the lead wants a different
  // beat next, without regenerating the arc.
  const source = arc([
    { text: "a", status: "active" },
    { text: "b", status: "pending" },
  ]);
  const next = ok(applyBeatEdit(source, { op: "move", beat: 2, direction: "up" }));
  assert.equal(next.beats[0].text, "b");
  assert.equal(next.beats[0].status, "active");
});

check("played beats stay where they are", () => {
  const intoDone = applyBeatEdit(SAMPLE, { op: "move", beat: 2, direction: "up" });
  assert.ok(isEditError(intoDone), "cannot swap with the done beat above");
  assert.match(intoDone.error, /stay where they are/i);
});

check("beats cannot cross an act boundary", () => {
  const result = applyBeatEdit(SAMPLE, { op: "move", beat: 3, direction: "down" });
  assert.ok(isEditError(result));
  assert.match(result.error, /own act/i);
});

check("moving off either end is refused", () => {
  const source = arc([{ text: "a", status: "active" }]);
  assert.ok(isEditError(applyBeatEdit(source, { op: "move", beat: 1, direction: "up" })));
  assert.ok(isEditError(applyBeatEdit(source, { op: "move", beat: 1, direction: "down" })));
});

check("a new beat lands at the end of its own act, not the arc", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "add", act: 1, text: "three and a half" }));
  assert.deepEqual(
    next.beats.map((beat) => beat.text),
    ["one", "two", "three", "three and a half", "four"],
  );
  assert.equal(next.beats[3].act, 1);
  assert.equal(next.beats[3].status, "pending");
});

check("a new beat in a later act appends after it", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "add", act: 2, text: "five" }));
  assert.equal(next.beats[4].text, "five");
  assert.equal(next.beats[4].act, 2);
});

check("adding to an act that does not exist yet is refused", () => {
  assert.ok(isEditError(applyBeatEdit(SAMPLE, { op: "add", act: 3, text: "x" })));
  assert.ok(isEditError(applyBeatEdit(SAMPLE, { op: "add", act: 0, text: "x" })));
});

check("a first beat added to an exhausted arc becomes [NOW]", () => {
  const spent = arc([
    { text: "one", status: "done" },
    { text: "two", status: "skipped" },
  ]);
  const next = ok(applyBeatEdit(spent, { op: "add", act: 1, text: "three" }));
  assert.equal(next.beats[2].status, "active");
});

check("adding never steals [NOW] from a beat in play", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "add", act: 1, text: "extra" }));
  assert.equal(next.beats[1].status, "active", "beat two is still the one in play");
  assert.equal(next.beats.filter((beat) => beat.status === "active").length, 1);
});

check("the beat cap holds against one-at-a-time additions", () => {
  const full = arc(
    Array.from({ length: MAX_TOTAL_BEATS }, (_, index) => ({
      text: `b${index}`,
      status: index === 0 ? "active" : "pending",
    })),
  );
  const result = applyBeatEdit(full, { op: "add", act: 1, text: "one more" });
  assert.ok(isEditError(result));
  assert.match(result.error, new RegExp(String(MAX_TOTAL_BEATS)));
});

check("an out-of-range beat number is an error, not a crash", () => {
  for (const beat of [0, 99, -1]) {
    assert.ok(isEditError(applyBeatEdit(SAMPLE, { op: "rename", beat, text: "x" })));
  }
});

check("every edit leaves the rest of the arc alone", () => {
  const source = arc([{ text: "a", status: "active" }]);
  source.cast = [{ name: "Marla" }];
  source.events = [{ kind: "twist" }];
  for (const edit of [
    { op: "rename", beat: 1, text: "b" },
    { op: "skip", beat: 1 },
    { op: "setNow", beat: 1 },
    { op: "add", act: 1, text: "c" },
  ]) {
    const next = ok(applyBeatEdit(source, edit));
    assert.deepEqual(next.cast, source.cast);
    assert.deepEqual(next.events, source.events);
    assert.equal(next.antagonist, source.antagonist);
    assert.equal(next.finale, source.finale);
  }
});

check("updatedAt moves on a successful edit", () => {
  const next = ok(applyBeatEdit(SAMPLE, { op: "rename", beat: 3, text: "x" }));
  assert.notEqual(next.updatedAt, SAMPLE.updatedAt);
});

console.log(`arc-edit: ${passed} tests passed`);
