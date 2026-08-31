// Voice turn-taking: who may speak, per floor mode and enforcement level.
//
// These rules decide whether somebody's microphone works, so a wrong branch
// either silences a player who should be talking or lets one talk over the DM.
// src/lib/voice/turn-logic.ts is pure for exactly this reason.

import assert from "node:assert/strict";
import {
  FLOOR_VOICE_LABELS,
  TRANSMIT_BLOCK_LABELS,
  VOICE_FLOOR_MODES,
  forcedSilentUserIds,
  handQueue,
  handsToLower,
  mayTransmit,
  nextInLine,
} from "../src/lib/voice/turn-logic.ts";

const dm = { userId: "dm", adjudicates: true };
const alice = { userId: "alice", adjudicates: false };
const bob = { userId: "bob", adjudicates: false };
const party = [dm, alice, bob];

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

// ---- enforcement off ----

check("enforcement off lets everyone speak in every mode", () => {
  for (const mode of VOICE_FLOOR_MODES) {
    for (const seat of party) {
      assert.equal(
        mayTransmit(mode, [], seat, "off").mayTransmit,
        true,
        `${seat.userId} should speak under ${mode}`,
      );
    }
  }
});

// ---- the DM exemption ----

// The DM controls the floor, so they are never subject to it. Getting this
// wrong would mute the person running the game during their own hold.
check("the DM speaks in every mode, at every enforcement", () => {
  for (const mode of VOICE_FLOOR_MODES) {
    for (const enforcement of ["soft", "strict"]) {
      assert.equal(
        mayTransmit(mode, [], dm, enforcement).mayTransmit,
        true,
        `DM should speak under ${mode}/${enforcement}`,
      );
    }
  }
});

// ---- per-mode rules ----

check("open lets every player speak", () => {
  assert.equal(mayTransmit("open", [], alice, "strict").mayTransmit, true);
  assert.equal(mayTransmit("open", [], bob, "strict").mayTransmit, true);
});

check("hold silences players and says why", () => {
  const verdict = mayTransmit("hold", [], alice, "strict");
  assert.equal(verdict.mayTransmit, false);
  assert.equal(verdict.block, "dm_holds_floor");
});

check("spotlight allows only the named players", () => {
  assert.equal(mayTransmit("spotlight", ["alice"], alice, "strict").mayTransmit, true);
  const denied = mayTransmit("spotlight", ["alice"], bob, "strict");
  assert.equal(denied.mayTransmit, false);
  assert.equal(denied.block, "spotlight_elsewhere");
});

check("initiative allows only the current turn's player", () => {
  assert.equal(mayTransmit("initiative", ["bob"], bob, "strict").mayTransmit, true);
  const denied = mayTransmit("initiative", ["bob"], alice, "strict");
  assert.equal(denied.mayTransmit, false);
  // The two denials are worded differently on purpose: "wait your turn" and
  // "the spotlight is elsewhere" are not the same situation.
  assert.equal(denied.block, "not_your_turn");
});

// ---- soft vs strict ----

// This is the distinction the whole feature rests on. Soft still returns a
// verdict (the UI shows whose turn it is) but the server must not act on it.
check("soft returns a verdict but silences nobody", () => {
  const verdict = mayTransmit("hold", [], alice, "soft");
  assert.equal(verdict.mayTransmit, false, "soft still reports the block");
  assert.deepEqual(forcedSilentUserIds("hold", [], party, "soft"), []);
});

check("strict silences exactly the blocked players", () => {
  assert.deepEqual(forcedSilentUserIds("hold", [], party, "strict").sort(), ["alice", "bob"]);
  assert.deepEqual(forcedSilentUserIds("spotlight", ["alice"], party, "strict"), ["bob"]);
  assert.deepEqual(forcedSilentUserIds("initiative", ["bob"], party, "strict"), ["alice"]);
});

check("strict silences nobody when the floor is open", () => {
  assert.deepEqual(forcedSilentUserIds("open", [], party, "strict"), []);
});

check("off silences nobody even when the floor is held", () => {
  assert.deepEqual(forcedSilentUserIds("hold", [], party, "off"), []);
});

// The DM must never appear in the forced-silent set, at any mode.
check("the DM is never force-muted", () => {
  for (const mode of VOICE_FLOOR_MODES) {
    assert.ok(
      !forcedSilentUserIds(mode, [], party, "strict").includes("dm"),
      `DM was muted under ${mode}`,
    );
  }
});

// ---- hand raising ----

const hands = [
  { userId: "bob", raisedAt: "2026-01-01T10:00:02.000Z" },
  { userId: "alice", raisedAt: "2026-01-01T10:00:01.000Z" },
  { userId: "carol", raisedAt: null },
];

check("the hand queue is oldest first and drops lowered hands", () => {
  assert.deepEqual(handQueue(hands).map((hand) => hand.userId), ["alice", "bob"]);
});

check("next in line is the longest waiting", () => {
  assert.equal(nextInLine(hands)?.userId, "alice");
  assert.equal(nextInLine([{ userId: "x", raisedAt: null }]), null);
});

// A hand that stays up after its owner gets the floor would leave the queue
// full of stale entries nobody remembers raising.
check("getting the floor lowers your hand", () => {
  assert.deepEqual(handsToLower(["alice"], hands), ["alice"]);
  assert.deepEqual(handsToLower([], hands), []);
  // Someone who never raised does not appear just because they hold the floor.
  assert.deepEqual(handsToLower(["carol"], hands), []);
});

// ---- labels ----

check("every mode and block has wording", () => {
  for (const mode of VOICE_FLOOR_MODES) {
    assert.ok(FLOOR_VOICE_LABELS[mode], `no label for ${mode}`);
  }
  for (const block of ["dm_holds_floor", "not_your_turn", "spotlight_elsewhere"]) {
    assert.ok(TRANSMIT_BLOCK_LABELS[block], `no label for ${block}`);
  }
});

if (failures) {
  console.error(`\n${failures} voice turn check(s) failed.`);
  process.exit(1);
}
console.log("voice turn checks passed.");
