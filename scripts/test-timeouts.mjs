// Timeout resolution for model calls: explicit override, env lookup, clamps.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { resolveTextTimeoutMs, arcTextTimeoutMs } = await import("../src/lib/model-client.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const MINUTE = 60 * 1000;

test("explicit override wins over env", () => {
  process.env.ODM_TEST_TIMEOUT_MS = String(4 * MINUTE);
  assert.equal(resolveTextTimeoutMs(2 * MINUTE, "ODM_TEST_TIMEOUT_MS", MINUTE), 2 * MINUTE);
  delete process.env.ODM_TEST_TIMEOUT_MS;
});

test("env value used when no explicit override", () => {
  process.env.ODM_TEST_TIMEOUT_MS = String(4 * MINUTE);
  assert.equal(resolveTextTimeoutMs(undefined, "ODM_TEST_TIMEOUT_MS", MINUTE), 4 * MINUTE);
  delete process.env.ODM_TEST_TIMEOUT_MS;
});

test("fallback when neither explicit nor env set", () => {
  assert.equal(resolveTextTimeoutMs(undefined, "ODM_TEST_TIMEOUT_UNSET", 5 * MINUTE), 5 * MINUTE);
});

test("clamps to the 30s floor and 30min ceiling", () => {
  assert.equal(resolveTextTimeoutMs(1000, "ODM_TEST_TIMEOUT_UNSET", MINUTE), 30 * 1000);
  assert.equal(resolveTextTimeoutMs(90 * MINUTE, "ODM_TEST_TIMEOUT_UNSET", MINUTE), 30 * MINUTE);
  process.env.ODM_TEST_TIMEOUT_MS = "5";
  assert.equal(resolveTextTimeoutMs(undefined, "ODM_TEST_TIMEOUT_MS", MINUTE), 30 * 1000);
  delete process.env.ODM_TEST_TIMEOUT_MS;
});

test("garbage env falls through to the fallback", () => {
  process.env.ODM_TEST_TIMEOUT_MS = "soon";
  assert.equal(resolveTextTimeoutMs(undefined, "ODM_TEST_TIMEOUT_MS", 2 * MINUTE), 2 * MINUTE);
  delete process.env.ODM_TEST_TIMEOUT_MS;
});

test("arc timeout defaults to 8 minutes and honors ARC_TEXT_TIMEOUT_MS", () => {
  const prior = process.env.ARC_TEXT_TIMEOUT_MS;
  delete process.env.ARC_TEXT_TIMEOUT_MS;
  assert.equal(arcTextTimeoutMs(), 8 * MINUTE);
  process.env.ARC_TEXT_TIMEOUT_MS = String(12 * MINUTE);
  assert.equal(arcTextTimeoutMs(), 12 * MINUTE);
  if (prior === undefined) {
    delete process.env.ARC_TEXT_TIMEOUT_MS;
  } else {
    process.env.ARC_TEXT_TIMEOUT_MS = prior;
  }
});

console.log(`test-timeouts: ${passed} tests passed.`);
