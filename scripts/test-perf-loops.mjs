// The pure half of the pre-1.0 dice work: how the 3D dice tray catches the
// window listener the library never removes. Run via: npm test
import assert from "node:assert/strict";
import {
  captureListeners,
  DICE_IDLE_MS,
  releaseListeners,
} from "../src/lib/dice/dice-box-lifecycle.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A stand-in for window: records adds and removes so the test can see
// exactly what the wrapper did.
function fakeTarget() {
  const added = [];
  const removed = [];
  const target = {
    addEventListener(type, listener, options) {
      added.push({ type, listener, options, self: this });
    },
    removeEventListener(type, listener, options) {
      removed.push({ type, listener, options });
    },
  };
  return { target, added, removed };
}

test("captures only the asked-for listener types and restores the original", () => {
  const { target, added } = fakeTarget();
  const original = target.addEventListener;
  const onResize = () => {};
  const onKey = () => {};
  const { result, captured } = captureListeners(target, ["resize"], () => {
    target.addEventListener("resize", onResize, { passive: true });
    target.addEventListener("keydown", onKey);
    return "ready";
  });
  assert.equal(result, "ready");
  assert.equal(target.addEventListener, original, "addEventListener is restored");
  assert.deepEqual(
    captured.map((entry) => [entry.type, entry.listener, entry.options]),
    [["resize", onResize, { passive: true }]],
  );
  // Both listeners still reached the real target, with it as `this`.
  assert.equal(added.length, 2);
  assert.equal(added[0].self, target);
  assert.equal(added[1].type, "keydown");
});

test("listeners added after the capture window are not caught", () => {
  const { target } = fakeTarget();
  const { captured } = captureListeners(target, ["resize"], () => {});
  target.addEventListener("resize", () => {});
  assert.equal(captured.length, 0);
});

test("restores the original even when the start throws", () => {
  const { target } = fakeTarget();
  const original = target.addEventListener;
  assert.throws(() =>
    captureListeners(target, ["resize"], () => {
      throw new Error("no webgl");
    }),
  );
  assert.equal(target.addEventListener, original);
});

test("release removes what was captured with the same options and empties the list", () => {
  const { target, removed } = fakeTarget();
  const onResize = () => {};
  const { captured } = captureListeners(target, ["resize"], () => {
    target.addEventListener("resize", onResize, true);
  });
  releaseListeners(target, captured);
  assert.deepEqual(removed, [{ type: "resize", listener: onResize, options: true }]);
  assert.equal(captured.length, 0);
  // Releasing twice is harmless.
  releaseListeners(target, captured);
  assert.equal(removed.length, 1);
});

test("idle window is longer than a pause between rolls", () => {
  assert.ok(DICE_IDLE_MS >= 20_000 && DICE_IDLE_MS <= 120_000);
});

console.log(`\n${passed} perf-loops tests passed`);
