// Mesh voice: the pure rules, the in-memory registry, and the signal
// mailbox relay, without any WebRTC or network. Follows the workshop
// integration pattern: a throwaway encrypted database and the @/ alias hook,
// so the real modules run unmodified.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mesh-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { politeIn, stalePeerIds, meshRosterEntries, MESH_STALE_MS } = await import(
  "../src/lib/voice/mesh-logic.ts"
);
const { meshJoin, meshLeave, meshHeartbeat, meshSignal, meshSetState, meshRosterFor, meshJoined } =
  await import("../src/lib/voice/mesh.ts");
const { subscribe } = await import("../src/lib/events.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const CAMPAIGN = "mesh-test-campaign";

test("politeness is asymmetric and deterministic", () => {
  assert.notEqual(politeIn("alice", "bob"), politeIn("bob", "alice"));
  assert.equal(politeIn("alice", "bob"), politeIn("alice", "bob"));
  assert.equal(politeIn("bob", "alice"), true);
});

test("stalePeerIds flags only peers past the timeout", () => {
  const now = Date.now();
  const stale = stalePeerIds(
    [
      { userId: "fresh", lastSeenAt: now - 1000 },
      { userId: "gone", lastSeenAt: now - MESH_STALE_MS - 1 },
    ],
    now,
  );
  assert.deepEqual(stale, ["gone"]);
});

test("roster entries carry the SFU shape, sorted by join time", () => {
  const entries = meshRosterEntries([
    {
      userId: "b",
      username: "Bee",
      muted: true,
      sayRange: "shout",
      joinedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: 0,
    },
    {
      userId: "a",
      username: "Ay",
      muted: false,
      sayRange: "normal",
      joinedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: 0,
    },
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.userId),
    ["a", "b"],
  );
  assert.equal(entries[1].muted, true);
  assert.equal(entries[1].sayRange, "shout");
  assert.equal(entries[0].channelId, "table");
  assert.equal(entries[0].forceMuted, false);
  assert.equal(entries[0].producing, true);
  assert.equal(entries[0].handRaisedAt, null);
});

test("join seats a peer and publishes the roster", () => {
  const chunks = [];
  const unsubscribe = subscribe(CAMPAIGN, (chunk) => chunks.push(chunk));
  const peers = meshJoin(CAMPAIGN, "alice", "Alice");
  unsubscribe();
  assert.equal(peers.length, 1);
  assert.equal(meshJoined(CAMPAIGN, "alice"), true);
  assert.ok(chunks.some((chunk) => chunk.includes("voice_roster")));
});

test("a second join for the same user replaces the seat", () => {
  meshJoin(CAMPAIGN, "alice", "Alice");
  assert.equal(meshRosterFor(CAMPAIGN).length, 1);
});

test("signals land in the target mailbox and drain via heartbeat", () => {
  meshJoin(CAMPAIGN, "bob", "Bob");
  const chunks = [];
  const unsubscribe = subscribe(CAMPAIGN, (chunk) => chunks.push(chunk));
  assert.equal(meshSignal(CAMPAIGN, "alice", "bob", { description: { type: "offer" } }), true);
  unsubscribe();
  assert.ok(chunks.some((chunk) => chunk.includes("voice_mesh_signal")));
  const signals = meshHeartbeat(CAMPAIGN, "bob");
  assert.equal(signals.length, 1);
  assert.equal(signals[0].from, "alice");
  assert.deepEqual(meshHeartbeat(CAMPAIGN, "bob"), []);
});

test("signaling to or from someone off the call is refused", () => {
  assert.equal(meshSignal(CAMPAIGN, "alice", "nobody", {}), false);
  assert.equal(meshSignal(CAMPAIGN, "nobody", "alice", {}), false);
});

test("state updates reach the roster", () => {
  assert.equal(meshSetState(CAMPAIGN, "alice", { muted: true, sayRange: "whisper" }), true);
  const alice = meshRosterFor(CAMPAIGN).find((entry) => entry.userId === "alice");
  assert.equal(alice.muted, true);
  assert.equal(alice.sayRange, "whisper");
  assert.equal(meshSetState(CAMPAIGN, "nobody", { muted: true }), false);
});

test("a heartbeat for a reaped or absent seat says so", () => {
  assert.equal(meshHeartbeat(CAMPAIGN, "nobody"), null);
});

test("leave drops the seat; the last leave clears the room", () => {
  meshLeave(CAMPAIGN, "alice");
  assert.equal(meshJoined(CAMPAIGN, "alice"), false);
  meshLeave(CAMPAIGN, "bob");
  assert.deepEqual(meshRosterFor(CAMPAIGN), []);
});

test("stale peers are reaped on the next touch", () => {
  meshJoin(CAMPAIGN, "alice", "Alice");
  meshJoin(CAMPAIGN, "bob", "Bob");
  const registry = globalThis.__odmMeshRegistry;
  registry.get(CAMPAIGN).peers.get("bob").lastSeenAt = Date.now() - MESH_STALE_MS - 1;
  meshHeartbeat(CAMPAIGN, "alice");
  assert.equal(meshJoined(CAMPAIGN, "bob"), false);
  assert.equal(meshJoined(CAMPAIGN, "alice"), true);
  meshLeave(CAMPAIGN, "alice");
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\ntest-voice-mesh: ${passed} passed`);
