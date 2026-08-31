// The story-capture nudge and the shaping around a DM beat: when the console
// speaks up, what it says, and what a model's draft looks like once it has
// been cleaned up for a person to read.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  beatCadence,
  DEFAULT_BEAT_CADENCE,
  lastStoryCaptureAt,
  snoozeUntil,
} = await import("../src/lib/dm/beat-cadence.ts");
const {
  beatSourceText,
  BEAT_KINDS,
  BEAT_KIND_LABELS,
  hasBeatSource,
  normalizeBeatBody,
} = await import("../src/lib/dm/beat-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Timestamps as "t01".."t99": lexicographic order is chronological order,
// which is the only property the module relies on.
function at(n) {
  return `t${String(n).padStart(2, "0")}`;
}
function player(n) {
  return { authorType: "player", createdAt: at(n) };
}
function dm(n) {
  return { authorType: "dm", createdAt: at(n) };
}
function roll(n) {
  return { createdAt: at(n) };
}

const threshold = DEFAULT_BEAT_CADENCE;

test("a DM who types their scenes is never nudged", () => {
  const messages = [dm(1), ...Array.from({ length: 30 }, (_, i) => player(i + 2)), dm(40)];
  const cadence = beatCadence({ messages, rolls: [], threshold, now: at(41) });
  assert.equal(cadence.level, "quiet");
  assert.equal(cadence.playerMessages, 0);
});

test("both a beat and a narration reset the clock, because both are story text", () => {
  // Beats are published as dm-authored messages, so the module sees one kind.
  assert.equal(lastStoryCaptureAt([dm(3), player(9), dm(12)]), at(12));
  assert.equal(lastStoryCaptureAt([player(1), player(2)]), "");
});

test("ten player actions with nothing written down is due", () => {
  const messages = [dm(1), ...Array.from({ length: 10 }, (_, i) => player(i + 2))];
  const cadence = beatCadence({ messages, rolls: [], threshold, now: at(20) });
  assert.equal(cadence.level, "due");
  assert.equal(cadence.playerMessages, 10);
  assert.match(cadence.reason, /10 player actions/);
});

test("nine is still quiet: the threshold is a threshold", () => {
  const messages = [dm(1), ...Array.from({ length: 9 }, (_, i) => player(i + 2))];
  assert.equal(beatCadence({ messages, rolls: [], threshold, now: at(20) }).level, "quiet");
});

test("twice the threshold escalates the dot to a banner", () => {
  const messages = [dm(1), ...Array.from({ length: 20 }, (_, i) => player(i + 2))];
  assert.equal(beatCadence({ messages, rolls: [], threshold, now: at(30) }).level, "overdue");
});

test("a fight nobody typed is caught by the dice instead", () => {
  // One player message, but two rounds of rolls: the combat tempo.
  const messages = [dm(1), player(2)];
  const rolls = Array.from({ length: 13 }, (_, i) => roll(i + 3));
  const cadence = beatCadence({ messages, rolls, threshold, now: at(20) });
  assert.equal(cadence.level, "due");
  assert.equal(cadence.rolls, 13);
  assert.match(cadence.reason, /13 rolls/);
});

test("rolls from before the last capture do not count", () => {
  const messages = [player(1), dm(5)];
  const rolls = [roll(2), roll(3), roll(4)];
  const cadence = beatCadence({ messages, rolls, threshold, now: at(6) });
  assert.equal(cadence.rolls, 0);
  assert.equal(cadence.level, "quiet");
});

test("the reason names whichever signal is further past its threshold", () => {
  const messages = [dm(1), ...Array.from({ length: 11 }, (_, i) => player(i + 2))];
  const rolls = Array.from({ length: 30 }, (_, i) => roll(i + 20));
  const cadence = beatCadence({ messages, rolls, threshold, now: at(60) });
  assert.match(cadence.reason, /30 rolls/);
});

test("one action reads as an action, not actions", () => {
  const messages = [dm(1), player(2)];
  const cadence = beatCadence({
    messages,
    rolls: [],
    threshold: { messages: 1, rolls: 0 },
    now: at(3),
  });
  assert.equal(cadence.reason, "1 player action since anything was written down.");
});

test("a snooze silences the nudge until it expires", () => {
  const messages = [dm(1), ...Array.from({ length: 30 }, (_, i) => player(i + 2))];
  assert.equal(
    beatCadence({ messages, rolls: [], threshold, snoozedUntil: at(90), now: at(50) }).level,
    "quiet",
  );
  assert.equal(
    beatCadence({ messages, rolls: [], threshold, snoozedUntil: at(40), now: at(50) }).level,
    "overdue",
  );
});

test("zero thresholds turn the whole nudge off", () => {
  const messages = [dm(1), ...Array.from({ length: 50 }, (_, i) => player(i + 2))];
  const rolls = Array.from({ length: 50 }, (_, i) => roll(i + 60));
  assert.equal(
    beatCadence({ messages, rolls, threshold: { messages: 0, rolls: 0 }, now: at(99) }).level,
    "quiet",
  );
});

test("one unit can be silenced without silencing the other", () => {
  const messages = [dm(1), ...Array.from({ length: 50 }, (_, i) => player(i + 2))];
  assert.equal(
    beatCadence({ messages, rolls: [], threshold: { messages: 0, rolls: 12 }, now: at(99) }).level,
    "quiet",
  );
});

test("a campaign with no story text yet counts everything the party has done", () => {
  const messages = Array.from({ length: 12 }, (_, i) => player(i + 1));
  assert.equal(beatCadence({ messages, rolls: [], threshold, now: at(20) }).level, "due");
});

test("snoozing buys twenty minutes of quiet", () => {
  const until = snoozeUntil(Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(until, "2026-01-01T00:20:00.000Z");
});

test("a model's fences, labels and quotes never reach the transcript", () => {
  assert.equal(normalizeBeatBody("```\nThe party crossed the ford.\n```"), "The party crossed the ford.");
  assert.equal(normalizeBeatBody("Summary: The party crossed the ford."), "The party crossed the ford.");
  assert.equal(normalizeBeatBody('"The party crossed the ford."'), "The party crossed the ford.");
  assert.equal(normalizeBeatBody("One.\n\n\n\nTwo."), "One.\n\nTwo.");
});

test("a beat is capped so one paste cannot flood the log", () => {
  assert.equal(normalizeBeatBody("x".repeat(5_000)).length, 2_000);
});

test("the drafter reads the record in table order", () => {
  const text = beatSourceText([
    { at: at(3), text: "Roll: Bel rolled Perception for 18." },
    { at: at(1), text: "Bel: I check the door." },
    { at: at(2), text: "  " },
  ]);
  assert.equal(text, "Bel: I check the door.\nRoll: Bel rolled Perception for 18.");
});

test("an over-budget record loses its oldest lines, not its newest", () => {
  const lines = Array.from({ length: 50 }, (_, i) => ({ at: at(i + 1), text: `line ${i + 1}` }));
  const text = beatSourceText(lines, 40);
  assert.equal(text.length, 40);
  assert.ok(text.endsWith("line 50"));
  assert.ok(!text.includes("line 1\n"));
});

test("a quiet stretch is told no rather than handed a made-up summary", () => {
  assert.equal(hasBeatSource([{ at: at(1), text: "Bel: hello" }]), false);
  assert.equal(hasBeatSource([{ at: at(1), text: "a" }, { at: at(2), text: "   " }]), false);
  assert.equal(hasBeatSource([{ at: at(1), text: "a" }, { at: at(2), text: "b" }]), true);
});

test("every beat kind has a label the DM can read", () => {
  for (const kind of BEAT_KINDS) {
    assert.equal(typeof BEAT_KIND_LABELS[kind], "string");
    assert.ok(BEAT_KIND_LABELS[kind].length > 0);
  }
});

console.log(`beat cadence: ${passed} tests passed`);
