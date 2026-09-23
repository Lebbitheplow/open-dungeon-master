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
// The run folders the bridge tried to remove; they are cleaned up at the end.
const refusedFolders = [];
fs.rmSync = (target, options) => {
  const name = path.basename(String(target));
  if (name.startsWith("odm-harness-") && !name.startsWith("odm-harness-slots-")) {
    refusedFolders.push(String(target));
    const error = new Error(`EBUSY: resource busy or locked, rmdir '${target}'`);
    error.code = "EBUSY";
    throw error;
  }
  return realRmSync(target, options);
};
syncBuiltinESMExports();

try {
  for (let call = 1; call <= 4; call += 1) {
    const started = Date.now();
    const result = await requestHarnessMessage(messages, {}, { role: "utility" });
    const took = Date.now() - started;
    assert.equal(result.error, undefined, `call ${call} failed: ${result.error ? await result.error.text() : ""}`);
    assert.equal(result.message.content, "The fake Dungeon Master narrates.");
    assert.ok(took < 5_000, `call ${call} waited ${took} ms for a slot`);
  }
  assert.ok(refusedFolders.length >= 4, "every run tried to remove its folder");
} finally {
  fs.rmSync = realRmSync;
  syncBuiltinESMExports();
  // Only the folders this test refused: the fake program holds nothing open,
  // so they go quietly. The test's own folder (the open database) is not
  // among them; removeTempDir handles that one on every platform.
  for (const folder of new Set(refusedFolders)) {
    removeTempDir(folder);
  }
}
removeTempDir(dir);
console.log("harness completion slots: 4 calls with an unremovable run folder all answered at once");
