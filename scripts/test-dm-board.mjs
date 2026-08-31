// A DM handling the board directly. Free placement skips reach and the
// round's budget on purpose, so what is worth testing is the small set of
// things it still refuses.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  ADHOC_LABELS,
  MAX_ADHOC_TOKENS,
  adhocRefId,
  checkAdhocName,
  checkAdhocRoom,
  checkPlacement,
  isAdhocRef,
} = await import("../src/lib/dm/board-logic.ts");
const { ADHOC_TOKEN_KINDS } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A 6x4 room: walled border, open floor inside.
const WIDTH = 6;
const HEIGHT = 4;
const TERRAIN = ["######", "#....#", "#....#", "######"].join("");
const base = { terrain: TERRAIN, width: WIDTH, height: HEIGHT, occupied: new Set() };

test("open floor takes a token", () => {
  assert.deepEqual(checkPlacement({ ...base, x: 2, y: 1 }), { ok: true });
});

test("a tile off the map is refused", () => {
  for (const spot of [
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: WIDTH, y: 1 },
    { x: 1, y: HEIGHT },
  ]) {
    const outcome = checkPlacement({ ...base, ...spot });
    assert.ok("error" in outcome);
    assert.match(outcome.error, /off the map/i);
  }
});

test("a wall is refused, and the message says how to fix it", () => {
  const outcome = checkPlacement({ ...base, x: 0, y: 0 });
  assert.ok("error" in outcome);
  assert.match(outcome.error, /wall/i);
  assert.match(outcome.error, /paint/i);
});

test("two tokens cannot share a tile", () => {
  const outcome = checkPlacement({
    ...base,
    occupied: new Set([1 * WIDTH + 2]),
    x: 2,
    y: 1,
  });
  assert.ok("error" in outcome);
  assert.match(outcome.error, /already standing there/i);
});

test("the tile a token is being moved off is not counted against it", () => {
  // The caller builds `occupied` without the mover, so its own tile is free.
  assert.deepEqual(
    checkPlacement({ ...base, occupied: new Set([1 * WIDTH + 3]), x: 2, y: 1 }),
    { ok: true },
  );
});

test("a placed piece must be named", () => {
  const named = checkAdhocName("  Barrel  ");
  assert.deepEqual(named, { name: "Barrel" });

  for (const blank of ["", "   ", null, undefined]) {
    const outcome = checkAdhocName(blank);
    assert.ok("error" in outcome, `${JSON.stringify(blank)} was accepted`);
    assert.match(outcome.error, /name/i);
  }
});

test("a very long name is trimmed rather than refused", () => {
  const outcome = checkAdhocName("x".repeat(500));
  assert.ok(!("error" in outcome));
  assert.equal(outcome.name.length, 40);
});

test("the board fills up and says so", () => {
  assert.deepEqual(checkAdhocRoom(MAX_ADHOC_TOKENS - 1), { ok: true });
  const outcome = checkAdhocRoom(MAX_ADHOC_TOKENS);
  assert.ok("error" in outcome);
  assert.match(outcome.error, new RegExp(String(MAX_ADHOC_TOKENS)));
});

test("a DM's own piece is recognisable from its ref id alone", () => {
  for (const kind of ADHOC_TOKEN_KINDS) {
    const ref = adhocRefId(kind, "abc123");
    assert.equal(ref, `${kind}:abc123`);
    assert.ok(isAdhocRef(ref));
    assert.ok(ADHOC_LABELS[kind], `${kind} has no label`);
  }
  // A character sheet id and an enemy id are plain uuids and must not match.
  assert.ok(!isAdhocRef("2f1c4b0e-8a1d-4a2e-9f3b-1d2c3e4f5a6b"));
});

console.log(`dm-board: ${passed} tests passed`);
