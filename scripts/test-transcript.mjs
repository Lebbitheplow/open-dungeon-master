// Transcription (docs/vtt-parity-implementation-plan.md 13.3): rings are
// batched in the order they were spoken and only when they hold speech;
// lines come back labelled with who was producing; adjacent lines from one
// speaker read as a turn; the last five minutes are what a beat is drafted
// from. And the dual-track recap (13.4) gives each seat only its own facts.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { batchRings, labelLines, mergeAdjacent, recentLines, renderTranscript, RING_SECONDS, MIN_RING_SECONDS } = await import("../src/lib/voice/transcript.ts");
const { recapMaterial, renderRecapMaterial } = await import("../src/lib/dm/recap-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("rings are sent in spoken order and silence is not sent", () => {
  const now = 100_000;
  const rings = batchRings(
    [
      { speaker: "Pike", startedAt: 60_000, seconds: RING_SECONDS, bytes: 4000 },
      { speaker: "Marla", startedAt: 30_000, seconds: RING_SECONDS, bytes: 4000 },
      { speaker: "Marla", startedAt: 90_000, seconds: 1, bytes: 100 },
      { speaker: "Pike", startedAt: 95_000, seconds: 10, bytes: 0 },
      { speaker: "Late", startedAt: 200_000, seconds: 10, bytes: 100 },
    ],
    now,
  );
  assert.deepEqual(rings.map((ring) => ring.speaker), ["Marla", "Pike"]);
  assert.ok(MIN_RING_SECONDS < RING_SECONDS);
});

test("lines are labelled, cleaned of markers and split on sentences", () => {
  const lines = labelLines("[BLANK_AUDIO] We go in quiet. Marla, you first! Fine.", "Pike", "2026-09-14T10:00:00.000Z", "Day 3, dusk");
  assert.deepEqual(lines.map((line) => line.text), ["We go in quiet.", "Marla, you first!", "Fine."]);
  assert.ok(lines.every((line) => line.speaker === "Pike" && line.clockLabel === "Day 3, dusk"));
  assert.deepEqual(labelLines("   [BLANK_AUDIO]  ", "Pike", "x", "y"), []);
});

test("adjacent lines from one speaker merge into a turn", () => {
  const merged = mergeAdjacent([
    { speaker: "Pike", text: "We go in quiet.", startedAt: "a", clockLabel: "c" },
    { speaker: "Pike", text: "Marla first.", startedAt: "a", clockLabel: "c" },
    { speaker: "Marla", text: "Fine.", startedAt: "b", clockLabel: "c" },
    { speaker: "Pike", text: "Good.", startedAt: "b", clockLabel: "c" },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].text, "We go in quiet. Marla first.");
  assert.equal(renderTranscript(merged), "Pike: We go in quiet. Marla first.\nMarla: Fine.\nPike: Good.");
  assert.equal(renderTranscript(merged, 12).length, 12);
});

test("the last five minutes are what a beat is drafted from", () => {
  const now = Date.parse("2026-09-14T10:10:00.000Z");
  const lines = [
    { speaker: "Pike", text: "old", startedAt: "2026-09-14T10:00:00.000Z", clockLabel: "" },
    { speaker: "Pike", text: "new", startedAt: "2026-09-14T10:07:00.000Z", clockLabel: "" },
  ];
  assert.deepEqual(recentLines(lines, now).map((line) => line.text), ["new"]);
  assert.equal(recentLines(lines, now, 20).length, 2);
});

test("the party recap never sees a secret; the DM recap sees the arcs", () => {
  const input = {
    facts: [
      { subject: "the ferry", fact: "It runs at dawn.", knownBy: "party" },
      { subject: "the cult", fact: "They own the ferryman.", knownBy: "dm" },
    ],
    quests: [{ title: "Cross the marsh", source: "dm", objectives: [{ text: "Find the ferry", done: true }, { text: "Pay", done: false }] }],
    arcs: [{ name: "The Drowning", rung: 1, rungs: ["stirs", "rises", "breaks"], status: "active" }],
  };
  const party = recapMaterial(input, false);
  assert.deepEqual(party.facts, ["the ferry: It runs at dawn."]);
  assert.deepEqual(party.quests, ["Cross the marsh (1 of 2 done)"]);
  assert.deepEqual(party.arcs, []);
  const dm = recapMaterial(input, true);
  assert.equal(dm.facts.length, 2);
  assert.match(dm.facts[1], /does not know/);
  assert.deepEqual(dm.arcs, ["The Drowning: rises"]);
  assert.match(renderRecapMaterial(dm), /World arcs \(secret\)/);
  assert.doesNotMatch(renderRecapMaterial(party), /secret/);
});

console.log(`transcript: ${passed} tests passed`);
