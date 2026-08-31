// Per-listener voice volume: the sliders each person gets over what they hear.
//
// The formula is worth locking down because it sits between two things that
// must not be confused. The server's audibility gain is a rule (distance,
// walls, side rooms); the sliders are comfort. A slider that could override
// the gain would quietly turn a wall into a suggestion, so every case below
// checks the server term survives.

import assert from "node:assert/strict";
import {
  DEFAULT_PEER_VOLUME,
  DEFAULT_VOLUME_PREFS,
  MAX_PEER_ENTRIES,
  PEER_VOLUME_MAX,
  clampVolume,
  effectiveVolume,
  isDefaultPeer,
  masterGain,
  parseVolumePrefs,
  peerGain,
  pruneVolumes,
  silenced,
} from "../src/lib/voice/volume.ts";

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n    ${error.message}`);
  }
}

const prefs = (overrides = {}) => ({ ...DEFAULT_VOLUME_PREFS, ...overrides });
const peer = (overrides = {}) => ({ ...DEFAULT_PEER_VOLUME, ...overrides });

check("everything at its default plays at full volume", () => {
  assert.equal(effectiveVolume(1, DEFAULT_PEER_VOLUME, DEFAULT_VOLUME_PREFS), 1);
});

check("the server's gain survives a listener who changed nothing", () => {
  // The regression this whole module exists for: the previous code assigned
  // gains[userId] ?? 1 straight onto the element, so any listener setting had
  // to replace the server's, not multiply with it.
  assert.equal(effectiveVolume(0.5, DEFAULT_PEER_VOLUME, DEFAULT_VOLUME_PREFS), 0.5);
});

check("audibility, peer slider and master all multiply", () => {
  assert.equal(effectiveVolume(0.5, peer({ volume: 0.5 }), prefs({ master: 0.5 })), 0.125);
});

check("a wall still wins when the listener turned that player up", () => {
  // Nothing a slider can do reaches above the server's gain.
  assert.equal(effectiveVolume(0, peer({ volume: PEER_VOLUME_MAX }), DEFAULT_VOLUME_PREFS), 0);
  assert.equal(effectiveVolume(0.25, peer({ volume: 1 }), DEFAULT_VOLUME_PREFS), 0.25);
});

check("deafen silences everyone, whatever the other terms say", () => {
  assert.equal(effectiveVolume(1, peer({ volume: 1 }), prefs({ deafened: true, master: 1 })), 0);
  assert.equal(masterGain(prefs({ deafened: true, master: 1 })), 0);
});

check("a local mute silences that speaker only", () => {
  const muted = peer({ muted: true });
  assert.equal(effectiveVolume(1, muted, DEFAULT_VOLUME_PREFS), 0);
  assert.equal(peerGain(1, muted), 0);
  // The master bus is untouched, so everyone else is still heard.
  assert.equal(effectiveVolume(1, DEFAULT_PEER_VOLUME, DEFAULT_VOLUME_PREFS), 1);
});

check("sliders attenuate but never amplify", () => {
  assert.equal(clampVolume(3, PEER_VOLUME_MAX), PEER_VOLUME_MAX);
  assert.equal(clampVolume(-1, PEER_VOLUME_MAX), 0);
  assert.equal(effectiveVolume(1, peer({ volume: 5 }), DEFAULT_VOLUME_PREFS), PEER_VOLUME_MAX);
});

check("garbage never reaches the audio element as NaN", () => {
  // element.volume = NaN throws a TypeError in the browser, which mid-call
  // would break consumer sync rather than merely sound wrong.
  for (const bad of [NaN, undefined, "loud", Infinity, -Infinity, {}]) {
    const level = effectiveVolume(bad, peer({ volume: bad }), prefs({ master: bad }));
    assert.ok(Number.isFinite(level), `${String(bad)} produced ${level}`);
    assert.ok(level >= 0 && level <= 1, `${String(bad)} produced ${level}`);
  }
});

check("silenced separates deliberate silence from a slider at zero", () => {
  assert.equal(silenced(DEFAULT_PEER_VOLUME, true), true);
  assert.equal(silenced(peer({ muted: true }), false), true);
  assert.equal(silenced(peer({ volume: 0 }), false), false);
  assert.equal(silenced(DEFAULT_PEER_VOLUME, false), false);
});

check("isDefaultPeer is true only for an untouched entry", () => {
  assert.equal(isDefaultPeer(DEFAULT_PEER_VOLUME), true);
  assert.equal(isDefaultPeer(peer({ volume: 0.5 })), false);
  assert.equal(isDefaultPeer(peer({ muted: true })), false);
});

check("unreadable storage returns the shared default reference", () => {
  // Reference equality, not deep equality: useSyncExternalStore re-renders
  // forever if getSnapshot hands back a fresh object each read.
  assert.equal(parseVolumePrefs(""), DEFAULT_VOLUME_PREFS);
  assert.equal(parseVolumePrefs("{{"), DEFAULT_VOLUME_PREFS);
  assert.equal(parseVolumePrefs("null"), DEFAULT_VOLUME_PREFS);
  assert.equal(parseVolumePrefs("7"), DEFAULT_VOLUME_PREFS);
});

check("stored prefs are read back, coerced and clamped", () => {
  const parsed = parseVolumePrefs(
    JSON.stringify({ master: 5, deafened: 1, peers: { a: { volume: 0.25, muted: true } } }),
  );
  assert.equal(parsed.master, 1);
  assert.equal(parsed.deafened, true);
  assert.deepEqual(parsed.peers.a, { volume: 0.25, muted: true });
  // Missing fields fall back rather than arriving as undefined.
  const partial = parseVolumePrefs(JSON.stringify({ peers: { a: { volume: 0.5 } } }));
  assert.equal(partial.master, 1);
  assert.equal(partial.deafened, false);
  assert.deepEqual(partial.peers.a, { volume: 0.5, muted: false });
});

check("a corrupt peer entry is dropped rather than coerced", () => {
  const parsed = parseVolumePrefs(
    JSON.stringify({ peers: { a: { volume: "loud" }, b: null, c: { volume: 0.5 } } }),
  );
  assert.deepEqual(Object.keys(parsed.peers), ["c"]);
});

check("pruning drops entries that carry no information", () => {
  const pruned = pruneVolumes(
    { a: { volume: 1, muted: false }, b: { volume: 0.5, muted: false } },
    ["a", "b"],
  );
  assert.deepEqual(Object.keys(pruned), ["b"]);
});

check("pruning trims to the cap and keeps the call in front of you", () => {
  const peers = {};
  for (let index = 0; index < MAX_PEER_ENTRIES + 50; index += 1) {
    peers[`old-${index}`] = { volume: 0.5, muted: false };
  }
  // Written last, so insertion order would evict them first without the
  // presence rule.
  peers["here-1"] = { volume: 0.5, muted: false };
  peers["here-2"] = { volume: 0.5, muted: false };
  const pruned = pruneVolumes(peers, ["here-1", "here-2"]);
  assert.equal(Object.keys(pruned).length, MAX_PEER_ENTRIES);
  assert.ok(pruned["here-1"], "somebody on the call should never be evicted");
  assert.ok(pruned["here-2"], "somebody on the call should never be evicted");
  assert.ok(!pruned["old-0"], "the oldest absent entry should be evicted first");
});

if (failures) {
  console.error(`\n${failures} voice volume check(s) failed.`);
  process.exit(1);
}
console.log("voice volume checks passed.");
