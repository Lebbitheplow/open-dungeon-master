// History compaction runs beside the campaign's DM queue, not on it
// (src/lib/dm/compaction.ts, issue 16): one run per campaign at a time, and a
// failed run is not retried until DM_COMPACT_RETRY_MS has passed, so a table
// past the threshold never pays the model timeout on every turn.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-compaction-bg-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.DM_COMPACT_RETRY_MS = "1000";
register("./lib/register-alias.mjs", import.meta.url);

const { compactHistoryInBackground } = await import("../src/lib/dm/compaction.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

await test("the caller never waits: the run is detached and only one runs at a time", async () => {
  let started = 0;
  const finishers = new Map();
  const run = (campaignId) => {
    started += 1;
    return new Promise((resolve) => {
      finishers.set(campaignId, resolve);
    });
  };
  assert.equal(compactHistoryInBackground("c1", run), true);
  assert.equal(compactHistoryInBackground("c1", run), false, "a second request while one runs is dropped");
  assert.equal(compactHistoryInBackground("c2", run), true, "another campaign is not held up");
  assert.equal(started, 2);
  finishers.get("c1")(true);
  await tick();
  assert.equal(compactHistoryInBackground("c1", run), true, "free again once the run resolves");
  finishers.get("c1")(true);
  finishers.get("c2")(true);
  await tick();
});

await test("a failed run waits out the retry window, then runs again", async () => {
  const run = async () => false;
  assert.equal(compactHistoryInBackground("c3", run), true);
  await tick();
  await tick();
  assert.equal(compactHistoryInBackground("c3", run), false, "not retried straight away");
  assert.equal(compactHistoryInBackground("c3", run, Date.now() + 1_500), true, "retried once the window passed");
});

await test("a run that throws is logged, counted as a failure, and frees the campaign", async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    assert.equal(compactHistoryInBackground("c4", async () => { throw new Error("model down"); }), true);
    await tick();
    await tick();
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((line) => line.includes("model down")));
  assert.equal(compactHistoryInBackground("c4", async () => true), false, "backed off like a false result");
  assert.equal(compactHistoryInBackground("c4", async () => true, Date.now() + 1_500), true);
});

removeTempDir(dir);
console.log(`compaction background: ${passed} checks passed`);
