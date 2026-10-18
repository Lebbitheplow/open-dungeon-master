// The run-owned scratch root behind `npm test` (issue #376): what it removes,
// and above all what it leaves alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FILE_PREFIX,
  RUN_PREFIX,
  makeFileDir,
  makeRunRoot,
  pointTempAt,
  processAlive,
  removeReported,
  sweepDeadFileDirs,
  sweepStaleRunRoots,
} from "./lib/test-temp-root.mjs";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odm-temp-root-test-"));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Pids standing in for processes: 1001 and 1002 are running, the rest gone.
const ALIVE = new Set([1001, 1002]);
const isAlive = (pid) => ALIVE.has(pid);
const quiet = () => {};

function fresh(name) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir);
  return dir;
}

test("a run root carries its owner's pid", () => {
  const base = fresh("owner");
  const root = makeRunRoot(base, 1001);
  assert.ok(path.basename(root).startsWith(`${RUN_PREFIX}1001-`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "owner.json"), "utf8")).pid, 1001);
});

test("only roots of runs that have ended are swept", () => {
  const base = fresh("stale");
  const live = makeRunRoot(base, 1001);
  const dead = makeRunRoot(base, 4242);
  fs.writeFileSync(path.join(dead, "test.sqlite-wal"), "x");
  assert.deepEqual(sweepStaleRunRoots(base, { isAlive, warn: quiet }), [dead]);
  assert.ok(fs.existsSync(live));
  assert.ok(!fs.existsSync(dead));
});

test("a dead run's root waits while a worker it orphaned is still running", () => {
  const base = fresh("orphan");
  const root = makeRunRoot(base, 4242);
  makeFileDir(root, 1002);
  assert.deepEqual(sweepStaleRunRoots(base, { isAlive, warn: quiet }), []);
  ALIVE.delete(1002);
  try {
    assert.deepEqual(sweepStaleRunRoots(base, { isAlive, warn: quiet }), [root]);
  } finally {
    ALIVE.add(1002);
  }
});

test("a root with no owner record is left alone, it may be one being made", () => {
  const base = fresh("unowned");
  const half = path.join(base, `${RUN_PREFIX}4242-abc`);
  fs.mkdirSync(half);
  const garbled = path.join(base, `${RUN_PREFIX}4243-def`);
  fs.mkdirSync(garbled);
  fs.writeFileSync(path.join(garbled, "owner.json"), "{not json");
  assert.deepEqual(sweepStaleRunRoots(base, { isAlive, warn: quiet }), []);
  assert.ok(fs.existsSync(half) && fs.existsSync(garbled));
});

test("nothing else in the temp directory is touched", () => {
  const base = fresh("neighbours");
  const others = ["odm-enforce-AbC123", "odm-ambience-4242-1", "test.sqlite", "systemd-private-x"];
  for (const name of others) {
    fs.mkdirSync(path.join(base, name));
    fs.writeFileSync(path.join(base, name, "owner.json"), JSON.stringify({ pid: 4242 }));
  }
  sweepStaleRunRoots(base, { isAlive, warn: quiet });
  for (const name of others) {
    assert.ok(fs.existsSync(path.join(base, name)), `${name} was removed`);
  }
});

test("a file's directory goes once its worker has exited, not before", () => {
  const root = fresh("files");
  const running = makeFileDir(root, 1002);
  const finished = makeFileDir(root, 4242);
  fs.writeFileSync(path.join(finished, "test.sqlite"), "x");
  const stray = path.join(root, "notes");
  fs.mkdirSync(stray);
  assert.deepEqual(sweepDeadFileDirs(root, { isAlive, warn: quiet }), [finished]);
  assert.ok(fs.existsSync(running));
  assert.ok(fs.existsSync(stray), "a name without the file- prefix and a pid is not ours");
  assert.equal(path.basename(running), `${FILE_PREFIX}1002`);
});

test("a removal that fails is reported, not swallowed", () => {
  const warnings = [];
  const ok = removeReported("/nowhere/odm", (line) => warnings.push(line), () => {
    throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
  });
  assert.equal(ok, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Could not remove test scratch \/nowhere\/odm: EPERM/);
});

test("os.tmpdir() follows the directory a file is pointed at, on every platform's variable", () => {
  const env = {};
  pointTempAt("/scratch/file-1", env);
  assert.deepEqual(env, { TMPDIR: "/scratch/file-1", TMP: "/scratch/file-1", TEMP: "/scratch/file-1" });
});

test("this process counts as alive, and a pid nothing holds does not", () => {
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(2 ** 22 + 12345), false);
});

test("under Vitest this file runs in its own directory inside the run's root", () => {
  const root = process.env.ODM_TEST_RUN_ROOT;
  if (!root) {
    return;
  }
  assert.ok(fs.existsSync(path.join(root, "owner.json")));
  assert.equal(os.tmpdir(), path.join(root, `${FILE_PREFIX}${process.pid}`));
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`test-test-temp-root: ${passed} passed`);
