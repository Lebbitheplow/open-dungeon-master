// The per-account upload budget and the free-disk floor
// (src/lib/upload-budget.ts). Run via: npm test
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { admitUpload, resetUploadBudget, uploadLimits } = await import("../src/lib/upload-budget.ts");

const MIB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 4, 12);
const ENV_KEYS = ["UPLOAD_DAILY_BYTES", "UPLOAD_DAILY_FILES", "UPLOAD_MIN_FREE_BYTES"];

let passed = 0;
function test(name, fn) {
  resetUploadBudget();
  for (const key of ENV_KEYS) delete process.env[key];
  // The floor reads the real disk; off unless a test is about it.
  process.env.UPLOAD_MIN_FREE_BYTES = "0";
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) delete process.env[key];
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

test("the defaults are 500 MB and 200 files a day, with a 1 GB floor", () => {
  delete process.env.UPLOAD_MIN_FREE_BYTES;
  assert.deepEqual(uploadLimits(), { dailyBytes: 500 * MIB, dailyFiles: 200, minFreeBytes: 1024 * MIB });
});

test("a nonsense setting falls back to the default rather than to no limit", () => {
  process.env.UPLOAD_DAILY_BYTES = "lots";
  process.env.UPLOAD_DAILY_FILES = "-3";
  assert.equal(uploadLimits().dailyBytes, 500 * MIB);
  assert.equal(uploadLimits().dailyFiles, 200);
});

test("uploads inside the budget are admitted", () => {
  for (let i = 0; i < 60; i += 1) {
    assert.equal(admitUpload("u1", 8 * MIB, 1, T0 + i), null);
  }
});

test("the byte budget refuses the upload that would cross it, with a retry time", () => {
  process.env.UPLOAD_DAILY_BYTES = String(20 * MIB);
  assert.equal(admitUpload("u1", 8 * MIB, 1, T0), null);
  assert.equal(admitUpload("u1", 8 * MIB, 1, T0 + HOUR), null);
  const refused = admitUpload("u1", 8 * MIB, 1, T0 + 2 * HOUR);
  assert.equal(refused?.status, 429);
  // The first spend rolls off at T0 + 24h, 22 hours from now.
  assert.equal(refused.retryAfterSec, 22 * 60 * 60);
  // A smaller file that still fits is admitted.
  assert.equal(admitUpload("u1", 4 * MIB, 1, T0 + 2 * HOUR), null);
});

test("the file budget counts files, however small", () => {
  process.env.UPLOAD_DAILY_FILES = "3";
  assert.equal(admitUpload("u1", 10, 2, T0), null);
  assert.equal(admitUpload("u1", 10, 1, T0), null);
  assert.equal(admitUpload("u1", 10, 1, T0)?.status, 429);
});

test("a refused request spends nothing", () => {
  process.env.UPLOAD_DAILY_BYTES = String(10 * MIB);
  assert.equal(admitUpload("u1", 6 * MIB, 1, T0), null);
  assert.ok(admitUpload("u1", 6 * MIB, 1, T0));
  assert.ok(admitUpload("u1", 6 * MIB, 1, T0));
  assert.equal(admitUpload("u1", 4 * MIB, 1, T0), null, "the refusals were counted");
});

test("the window rolls: yesterday's uploads stop counting", () => {
  process.env.UPLOAD_DAILY_FILES = "1";
  assert.equal(admitUpload("u1", 10, 1, T0), null);
  assert.ok(admitUpload("u1", 10, 1, T0 + 23 * HOUR));
  assert.equal(admitUpload("u1", 10, 1, T0 + 24 * HOUR), null);
});

test("each account has its own budget", () => {
  process.env.UPLOAD_DAILY_FILES = "1";
  assert.equal(admitUpload("u1", 10, 1, T0), null);
  assert.ok(admitUpload("u1", 10, 1, T0));
  assert.equal(admitUpload("u2", 10, 1, T0), null);
});

test("0 turns a limit off", () => {
  process.env.UPLOAD_DAILY_BYTES = "0";
  process.env.UPLOAD_DAILY_FILES = "0";
  for (let i = 0; i < 500; i += 1) {
    assert.equal(admitUpload("u1", 25 * MIB, 1, T0), null);
  }
});

test("an import that writes nothing is never refused", () => {
  process.env.UPLOAD_DAILY_FILES = "1";
  assert.equal(admitUpload("u1", 10, 1, T0), null);
  assert.equal(admitUpload("u1", 0, 0, T0), null);
});

test("below the free-disk floor everyone is refused, and nothing is spent", () => {
  // No real disk has an exabyte free.
  process.env.UPLOAD_MIN_FREE_BYTES = String(2 ** 60);
  const refused = admitUpload("u1", 10, 1, T0);
  assert.equal(refused?.status, 507);
  assert.equal(refused.retryAfterSec, undefined);
  process.env.UPLOAD_MIN_FREE_BYTES = "0";
  process.env.UPLOAD_DAILY_FILES = "1";
  assert.equal(admitUpload("u1", 10, 1, T0), null, "the refused upload was counted");
});

test("a modest floor admits uploads on a disk with room", () => {
  process.env.UPLOAD_MIN_FREE_BYTES = "1";
  assert.equal(admitUpload("u1", 10, 1, T0), null);
});

console.log(`upload budget: ${passed} tests passed`);
