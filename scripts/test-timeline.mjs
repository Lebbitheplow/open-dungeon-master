// The campaign timeline (docs/vtt-parity-implementation-plan.md section
// 5.5): rows in story order, the party marker at now, secrets only for
// the DM seat.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildTimeline } = await import("../src/lib/dm/timeline-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const sources = {
  chapters: [
    { id: "c1", index: 1, title: "The Road", summary: "They left. Then more.", seqEnd: 40, clockLabel: "Greening 3", status: "closed" },
    { id: "c2", index: 2, title: "", summary: "Open still", seqEnd: null, clockLabel: "", status: "open" },
  ],
  facts: [{ id: "f1", subject: "Marla", fact: "Owns the mill.", sourceSeq: 12, createdAt: "" }],
  sessions: [
    { id: "s1", title: "Session 1", startsAt: "2020-01-01T18:00:00.000Z" },
    { id: "s2", title: "Session 9", startsAt: "2999-01-01T18:00:00.000Z" },
    { id: "s3", title: "Cancelled", startsAt: "2999-01-02T18:00:00.000Z", status: "cancelled" },
  ],
  arcs: [
    { id: "wa1", name: "The Flood", rung: 1, rungs: ["Rain", "The river rises"], status: "active" },
    { id: "wa2", name: "Unbegun", rung: -1, rungs: ["x"], status: "active" },
  ],
  now: { seq: 60, clockLabel: "Greening 5, morning" },
};

test("rows sort into story order with now near the end and the future after", () => {
  const rows = buildTimeline(sources, true);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["fact-f1", "chapter-c1", "session-s1", "arc-wa1", "now", "session-s2"],
  );
  assert.equal(rows.find((row) => row.id === "chapter-c1").detail, "They left.");
  assert.equal(rows.find((row) => row.id === "chapter-c1").when, "Greening 3");
  assert.equal(rows.find((row) => row.id === "now").detail, "Greening 5, morning");
});

test("a player's timeline has no world arcs and no cancelled sessions", () => {
  const rows = buildTimeline(sources, false);
  assert.ok(!rows.some((row) => row.kind === "arc"));
  assert.ok(!rows.some((row) => row.id === "session-s3"));
  assert.ok(!rows.some((row) => row.secret));
});

console.log(`test-timeline: ${passed} passed`);
