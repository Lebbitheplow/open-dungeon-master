// A one-shot harness completion (summaries, compaction) must give its
// concurrency slot back whatever happens to its scratch folder. On Windows
// the folder is the just-killed program's working directory and cannot be
// removed straight away; before the fix that throw skipped releaseSlot, and
// after maxConcurrent such calls every later summary waited out the whole
// timeout (issue 16). The fake program stands in; rmSync is made to throw.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register, syncBuiltinESMExports } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-slots-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "1";
register("./lib/register-alias.mjs", import.meta.url);

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { requestHarnessMessage } = await import("../src/lib/harness/bridge.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

saveGlobalConfig({ harness: { id: "claude", model: "haiku", maxConcurrent: 2, turnTimeoutSec: 60 }, text: { provider: "harness" } });
const messages = [
  { role: "system", content: "Summarise." },
  { role: "user", content: "The party crossed the ford." },
];

const realRmSync = fs.rmSync;
let refused = 0;
fs.rmSync = (target, options) => {
  if (String(target).includes("odm-harness-")) {
    refused += 1;
    const error = new Error(`EBUSY: resource busy or locked, rmdir '${target}'`);
    error.code = "EBUSY";
    throw error;
  }
  return realRmSync(target, options);
};
syncBuiltinESMExports();

const leftovers = [];
try {
  for (let call = 1; call <= 4; call += 1) {
    const started = Date.now();
    const result = await requestHarnessMessage(messages, {}, { role: "utility" });
    const took = Date.now() - started;
    assert.equal(result.error, undefined, `call ${call} failed: ${result.error ? await result.error.text() : ""}`);
    assert.equal(result.message.content, "The fake Dungeon Master narrates.");
    assert.ok(took < 5_000, `call ${call} waited ${took} ms for a slot`);
  }
  assert.ok(refused >= 4, "every run tried to remove its folder");
} finally {
  fs.rmSync = realRmSync;
  syncBuiltinESMExports();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith("odm-harness-")) {
      leftovers.push(path.join(os.tmpdir(), entry));
    }
  }
  for (const folder of leftovers) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
removeTempDir(dir);
console.log("harness completion slots: 4 calls with an unremovable run folder all answered at once");
