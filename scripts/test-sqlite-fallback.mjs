// The SQLite engine choice on a host whose native module loads but cannot
// open a database: installed with --ignore-scripts (the addon catalog audit),
// or built for another Node. The engine is chosen once per process, so each
// case runs in its own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-sqlite-fallback-"));
// Stands in for the native package without its compiled binary: the module
// loads, and the first open cannot find the binary.
const noBinary = path.join(dir, "no-binary.cjs");
fs.writeFileSync(
  noBinary,
  `const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "better-sqlite3-multiple-ciphers") {
    return function Database() {
      throw new Error("Could not locate the bindings file.");
    };
  }
  return load.call(this, request, ...rest);
};
`,
);

function engineRun(env) {
  const script = `
    const { register } = await import("node:module");
    register("./lib/register-alias.mjs", ${JSON.stringify(new URL(".", import.meta.url).href)});
    const { openDatabase, sqliteEngine } = await import(${JSON.stringify(new URL("../src/lib/db/driver.ts", import.meta.url).href)});
    let opened = false;
    let error = "";
    try {
      const db = openDatabase(":memory:");
      opened = db.prepare("SELECT 1 + 1 AS two").get().two === 2;
      db.close();
    } catch (caught) {
      error = caught.message;
    }
    console.log(JSON.stringify({ engine: sqliteEngine(), opened, error }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, ODM_SQLITE_DRIVER: "", NODE_OPTIONS: `--require ${noBinary}`, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
}

test("a native module that loads but cannot open a database gives way to node:sqlite", () => {
  assert.deepEqual(engineRun({}), { engine: "node", opened: true, error: "" });
});

test("a host that asks for the native engine by name still gets it, and its error", () => {
  const forced = engineRun({ ODM_SQLITE_DRIVER: "native" });
  assert.equal(forced.engine, "native");
  assert.equal(forced.opened, false);
  assert.match(forced.error, /bindings file/);
});

removeTempDir(dir);
console.log(`test-sqlite-fallback: ${passed} passed`);
