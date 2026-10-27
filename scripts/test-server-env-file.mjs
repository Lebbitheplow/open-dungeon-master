// ODM_ENV_FILE (src/lib/server-env.ts). The browser runner points its
// server at a settings file that is not there, so this machine's own
// .env.server (its models, utility models and keys) never reaches a
// scenario. Before, the runner blanked keys with empty strings, and an empty
// value in process.env falls back to the file: a Workshop audit's website
// runs called this machine's models until it overrode them by hand
// (the Workshop audit of 2026-10-26, its test environment).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-server-env-file-"));
fs.writeFileSync(path.join(dir, ".env.server"), "ODM_TEST_MODEL=from-the-file\nOPENAI_API_KEY=sk-from-the-file\n");
fs.writeFileSync(path.join(dir, "other.env"), "ODM_TEST_MODEL=from-the-other-file\n");
const moduleUrl = new URL("../src/lib/server-env.ts", import.meta.url).href;

// Each read is its own process: the module keeps the file it read.
function read(env) {
  const script = `const { serverEnv } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify([serverEnv("ODM_TEST_MODEL"), serverEnv("OPENAI_API_KEY")]));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir,
    env: { ...process.env, ODM_TEST_MODEL: "", OPENAI_API_KEY: "", ODM_ENV_FILE: "", ...env },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split("\n").pop());
}

try {
  // The working directory's file, as a server reads it; an empty value in
  // the environment does not keep it out.
  assert.deepEqual(read({}), ["from-the-file", "sk-from-the-file"]);
  // Another file when named.
  assert.deepEqual(read({ ODM_ENV_FILE: path.join(dir, "other.env") }), ["from-the-other-file", ""]);
  // A file that is not there: nothing from any file, which is what the
  // browser runner names (scripts/browser/lib.mjs noEnvFile).
  assert.deepEqual(read({ ODM_ENV_FILE: path.join(dir, "missing") }), ["", ""]);
  // The environment still wins over the named file.
  assert.deepEqual(read({ ODM_ENV_FILE: path.join(dir, "other.env"), ODM_TEST_MODEL: "from-the-environment" }), ["from-the-environment", ""]);
  // And the runner names a missing file beside its database.
  const { noEnvFile } = await import("./browser/lib.mjs");
  assert.equal(noEnvFile(path.join(dir, "world.sqlite")), path.join(dir, "no-env-server"));
  assert.ok(!fs.existsSync(noEnvFile(path.join(dir, "world.sqlite"))));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("ok: ODM_ENV_FILE names the settings file, and the browser runner names none");
