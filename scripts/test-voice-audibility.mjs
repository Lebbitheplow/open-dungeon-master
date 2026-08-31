// The audibility engine: who hears whom, and how loudly.
//
// This decides whether one player's audio reaches another player's laptop, so
// a wrong branch is either a privacy leak (a private conversation heard by the
// table) or broken audio. src/lib/voice/audibility.ts is pure for this reason.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_AUDIBLE_GAIN,
  SAY_RANGES,
  TILE_FEET,
  WALL_ATTENUATION,
  computeAudibility,
  diffAudibility,
  tileDistance,
} from "../src/lib/voice/audibility.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RULES_OFF = {
  proximity: false,
  hearingRangeFeet: 30,
  sayRange: false,
  wallsAttenuate: false,
  downedGoDeaf: false,
};
const RULES_PROXIMITY = { ...RULES_OFF, proximity: true };

function seat(userId, overrides = {}) {
  return {
    userId,
    channelId: "table",
    adjudicates: false,
    position: null,
    sayRange: "normal",
    downed: false,
    ...overrides,
  };
}

// Tiles are 5 feet, so 30 feet is 6 tiles away.
const at = (x, y) => ({ x, y });

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

const hears = (matrix, listener, speaker) => matrix.get(listener)?.get(speaker) ?? 0;

// ---- the geometry restated in the pure module must match the battle map ----

check("TILE_FEET agrees with the battle map", () => {
  const types = readFileSync(path.join(root, "src/lib/battlemap/types.ts"), "utf8");
  assert.match(types, new RegExp(`export const TILE_FEET = ${TILE_FEET};`));
});

check("tileDistance is Chebyshev, so diagonals cost one square", () => {
  assert.equal(tileDistance(0, 0, 3, 0), 3);
  assert.equal(tileDistance(0, 0, 3, 3), 3);
  assert.equal(tileDistance(0, 0, 3, 4), 4);
});

// ---- the default: everyone hears everyone ----

check("with no rules on, the whole table hears each other", () => {
  const matrix = computeAudibility([seat("a"), seat("b"), seat("c")], RULES_OFF);
  assert.equal(hears(matrix, "a", "b"), 1);
  assert.equal(hears(matrix, "c", "a"), 1);
});

check("nobody hears themselves", () => {
  const matrix = computeAudibility([seat("a"), seat("b")], RULES_OFF);
  assert.equal(matrix.get("a").has("a"), false);
});

// ---- channels ----

check("different channels cannot hear each other", () => {
  const matrix = computeAudibility(
    [seat("a"), seat("b", { channelId: "library" })],
    RULES_OFF,
  );
  assert.equal(hears(matrix, "a", "b"), 0);
  assert.equal(hears(matrix, "b", "a"), 0);
});

check("the same breakout channel hears itself", () => {
  const matrix = computeAudibility(
    [seat("a", { channelId: "library" }), seat("b", { channelId: "library" })],
    RULES_OFF,
  );
  assert.equal(hears(matrix, "a", "b"), 1);
});

// ---- the DM exemption ----

// The headline requirement: "The DM can hear everyone, but players only hear
// people within 30 feet." Both halves, including across channels and walls.
check("the DM hears everyone and is heard by everyone", () => {
  const matrix = computeAudibility(
    [
      seat("dm", { adjudicates: true, channelId: "table", position: at(0, 0) }),
      seat("far", { channelId: "library", position: at(50, 50) }),
    ],
    { ...RULES_PROXIMITY, wallsAttenuate: true },
    { blocked: () => true },
  );
  assert.equal(hears(matrix, "dm", "far"), 1, "DM should hear a distant player in another room");
  assert.equal(hears(matrix, "far", "dm"), 1, "the DM should be heard everywhere");
});

// ---- proximity ----

check("proximity does nothing without positions", () => {
  const matrix = computeAudibility([seat("a"), seat("b")], RULES_PROXIMITY);
  assert.equal(hears(matrix, "a", "b"), 1);
});

check("inside 30 feet is full volume", () => {
  // 3 tiles = 15 feet, inside the two-thirds full-volume band (20 feet).
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(3, 0) })],
    RULES_PROXIMITY,
  );
  assert.equal(hears(matrix, "a", "b"), 1);
});

check("beyond 30 feet is silent", () => {
  // 7 tiles = 35 feet.
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(7, 0) })],
    RULES_PROXIMITY,
  );
  assert.equal(hears(matrix, "a", "b"), 0);
});

// The boundary itself: 6 tiles is exactly 30 feet and must still be audible,
// because "within 30 feet" includes 30.
check("exactly 30 feet is still audible, but faded", () => {
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(6, 0) })],
    RULES_PROXIMITY,
  );
  const gain = hears(matrix, "a", "b");
  assert.ok(gain > 0, "30 feet should be audible");
  assert.ok(gain < 1, "30 feet should be faded, not full volume");
});

check("the fade is monotonic with distance", () => {
  const gains = [4, 5, 6].map((tiles) => {
    const matrix = computeAudibility(
      [seat("a", { position: at(0, 0) }), seat("b", { position: at(tiles, 0) })],
      RULES_PROXIMITY,
    );
    return hears(matrix, "a", "b");
  });
  assert.ok(gains[0] >= gains[1] && gains[1] >= gains[2], `not monotonic: ${gains}`);
});

check("diagonals use Chebyshev, so 6 tiles diagonally is still 30 feet", () => {
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(6, 6) })],
    RULES_PROXIMITY,
  );
  assert.ok(hears(matrix, "a", "b") > 0);
});

// ---- say range ----

check("say range is the speaker's choice, not the listener's", () => {
  // 10 tiles = 50 feet: out of normal range, inside a shout.
  const shouter = seat("b", { position: at(10, 0), sayRange: "shout" });
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), shouter],
    { ...RULES_PROXIMITY, sayRange: true },
  );
  assert.ok(hears(matrix, "a", "b") > 0, "a shout should carry 50 feet");
  assert.equal(hears(matrix, "b", "a"), 0, "the normal voice back should not");
});

check("a whisper carries only 5 feet", () => {
  const near = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(1, 0), sayRange: "whisper" })],
    { ...RULES_PROXIMITY, sayRange: true },
  );
  assert.ok(hears(near, "a", "b") > 0);
  const far = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(3, 0), sayRange: "whisper" })],
    { ...RULES_PROXIMITY, sayRange: true },
  );
  assert.equal(hears(far, "a", "b"), 0, "15 feet is out of whisper range");
});

check("say range is ignored while the rule is off", () => {
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(10, 0), sayRange: "shout" })],
    RULES_PROXIMITY,
  );
  assert.equal(hears(matrix, "a", "b"), 0, "shouting should not carry when the rule is off");
});

check("SAY_RANGES covers whisper and shout", () => {
  assert.equal(SAY_RANGES.whisper, 5);
  assert.equal(SAY_RANGES.shout, 120);
});

// ---- walls ----

check("a wall muffles rather than blocks", () => {
  const seats = [seat("a", { position: at(0, 0) }), seat("b", { position: at(2, 0) })];
  const open = computeAudibility(seats, RULES_PROXIMITY);
  const walled = computeAudibility(
    seats,
    { ...RULES_PROXIMITY, wallsAttenuate: true },
    { blocked: () => true },
  );
  assert.equal(open.get("a").get("b"), 1);
  assert.ok(walled.get("a").get("b") > 0, "a wall must not silence entirely");
  assert.ok(walled.get("a").get("b") < 1, "a wall must reduce the volume");
  assert.equal(walled.get("a").get("b"), WALL_ATTENUATION);
});

check("walls are ignored while the rule is off", () => {
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(2, 0) })],
    RULES_PROXIMITY,
    { blocked: () => true },
  );
  assert.equal(hears(matrix, "a", "b"), 1);
});

// A wall plus near-maximum distance can fall under the audible floor, which is
// correct: forwarding it would spend bandwidth to deliver silence.
check("a muffled voice past the fade drops below the audible floor", () => {
  const matrix = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(6, 0) })],
    { ...RULES_PROXIMITY, wallsAttenuate: true },
    { blocked: () => true },
  );
  const gain = hears(matrix, "a", "b");
  assert.ok(gain === 0 || gain >= MIN_AUDIBLE_GAIN, `leaked a sub-floor gain: ${gain}`);
});

// ---- downed ----

check("a downed character hears nothing but still speaks", () => {
  const matrix = computeAudibility(
    [seat("a", { downed: true }), seat("b")],
    { ...RULES_OFF, downedGoDeaf: true },
  );
  assert.equal(hears(matrix, "a", "b"), 0, "the downed player should hear nothing");
  assert.equal(hears(matrix, "b", "a"), 1, "but is still heard");
});

check("downed is ignored while the rule is off", () => {
  const matrix = computeAudibility([seat("a", { downed: true }), seat("b")], RULES_OFF);
  assert.equal(hears(matrix, "a", "b"), 1);
});

// A downed player must still hear the DM, or they are cut off from the person
// narrating their own death save.
check("a downed character still hears the DM", () => {
  const matrix = computeAudibility(
    [seat("a", { downed: true }), seat("dm", { adjudicates: true })],
    { ...RULES_OFF, downedGoDeaf: true },
  );
  assert.equal(hears(matrix, "a", "dm"), 1);
});

// ---- the diff ----

check("an unchanged matrix produces no work", () => {
  const seats = [seat("a"), seat("b")];
  const first = computeAudibility(seats, RULES_OFF);
  const second = computeAudibility(seats, RULES_OFF);
  const diff = diffAudibility(first, second);
  assert.equal(diff.resume.size, 0);
  assert.equal(diff.pause.size, 0);
  assert.equal(diff.gains.size, 0);
});

check("walking out of range pauses exactly that pair", () => {
  const near = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(1, 0) })],
    RULES_PROXIMITY,
  );
  const far = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(9, 0) })],
    RULES_PROXIMITY,
  );
  const diff = diffAudibility(near, far);
  assert.deepEqual(diff.pause.get("a"), ["b"]);
  assert.deepEqual(diff.pause.get("b"), ["a"]);
  assert.equal(diff.resume.size, 0);
});

check("walking into range resumes that pair", () => {
  const far = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(9, 0) })],
    RULES_PROXIMITY,
  );
  const near = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(1, 0) })],
    RULES_PROXIMITY,
  );
  const diff = diffAudibility(far, near);
  assert.deepEqual(diff.resume.get("a"), ["b"]);
  assert.equal(diff.pause.size, 0);
});

check("a listener who left has everything paused", () => {
  const before = computeAudibility([seat("a"), seat("b")], RULES_OFF);
  const after = computeAudibility([seat("b")], RULES_OFF);
  const diff = diffAudibility(before, after);
  assert.deepEqual(diff.pause.get("a"), ["b"]);
});

// A step that only changes the volume must not churn the subscription.
check("a small move reports a gain change, not a resubscribe", () => {
  const before = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(5, 0) })],
    RULES_PROXIMITY,
  );
  const after = computeAudibility(
    [seat("a", { position: at(0, 0) }), seat("b", { position: at(6, 0) })],
    RULES_PROXIMITY,
  );
  const diff = diffAudibility(before, after);
  assert.equal(diff.pause.size, 0);
  assert.equal(diff.resume.size, 0);
  assert.ok(diff.gains.get("a")?.has("b"), "the gain change should be reported");
});

if (failures) {
  console.error(`\n${failures} voice audibility check(s) failed.`);
  process.exit(1);
}
console.log("voice audibility checks passed.");
