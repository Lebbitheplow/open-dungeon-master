// Scratch space for one `npm test` run, owned by that run (issue #376).
//
// Under plain `node scripts/test-*.mjs` a suite removes its own scratch
// directory in a process "exit" handler. Vitest never fires that handler:
// each file runs in a worker process that is killed when the file is done,
// so every enforcement suite left its database, WAL and SHM behind in /tmp,
// which on a tmpfs host is memory.
//
// So under Vitest the scratch lives in two layers:
//
// - The run root, made by the global setup (vitest-global-setup.mjs) under
//   the real temp directory, carrying an owner.json with the run's pid. The
//   global teardown removes it once every worker has exited, so no open
//   SQLite handle is raced. A run killed before its teardown (SIGKILL, a
//   closed terminal, a crash in Vitest itself) leaves its root; the next run
//   removes any root whose owner.json names a process that is gone.
// - One directory per test file inside it, made by the setup file
//   (vitest-file-setup.mjs), which points TMPDIR, TMP and TEMP at it before
//   the file loads, so every mkdtempSync(os.tmpdir()) in a suite lands there.
//   A file starting removes the directories of files whose worker has
//   exited, which keeps a long run from holding every suite's database until
//   the end.
//
// Nothing here removes a path it did not make: only names with these
// prefixes, inside the base or root it was handed, and only when the owning
// process is gone. A removal that fails says so instead of passing quietly.
import fs from "node:fs";
import path from "node:path";

export const RUN_PREFIX = "odm-test-run-";
export const FILE_PREFIX = "file-";
const OWNER = "owner.json";

// Whether a process is still running. EPERM means it exists but belongs to
// someone else, which still counts as alive.
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function removeReported(dir, warn = console.warn, rm = fs.rmSync) {
  try {
    rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    return true;
  } catch (error) {
    warn(`Could not remove test scratch ${dir}: ${error?.message ?? error}`);
    return false;
  }
}

export function makeRunRoot(base, pid = process.pid) {
  const root = fs.mkdtempSync(path.join(base, `${RUN_PREFIX}${pid}-`));
  fs.writeFileSync(path.join(root, OWNER), JSON.stringify({ pid, startedAt: new Date().toISOString() }));
  return root;
}

function ownerPid(root) {
  try {
    const pid = JSON.parse(fs.readFileSync(path.join(root, OWNER), "utf8")).pid;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// Roots left by runs that are no longer running. A root without a readable
// owner.json is skipped: it may be one another run is making right now. So
// is one where a worker outlived its run (killed Vitest, orphaned worker
// still finishing its file).
export function sweepStaleRunRoots(base, { isAlive = processAlive, warn = console.warn } = {}) {
  const removed = [];
  for (const name of safeList(base)) {
    if (!name.startsWith(RUN_PREFIX)) {
      continue;
    }
    const root = path.join(base, name);
    const pid = ownerPid(root);
    if (pid === null || isAlive(pid) || filePids(root).some(isAlive)) {
      continue;
    }
    if (removeReported(root, warn)) {
      removed.push(root);
    }
  }
  return removed;
}

function filePids(root) {
  return safeList(root)
    .map((name) => new RegExp(`^${FILE_PREFIX}(\\d+)$`).exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
}

export function makeFileDir(root, pid = process.pid) {
  const dir = path.join(root, `${FILE_PREFIX}${pid}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sweepDeadFileDirs(root, { isAlive = processAlive, warn = console.warn } = {}) {
  const removed = [];
  for (const pid of filePids(root)) {
    const dir = path.join(root, `${FILE_PREFIX}${pid}`);
    if (!isAlive(pid) && removeReported(dir, warn)) {
      removed.push(dir);
    }
  }
  return removed;
}

// Where os.tmpdir() looks: TMPDIR on POSIX, TEMP and TMP on Windows.
export function pointTempAt(dir, env = process.env) {
  env.TMPDIR = dir;
  env.TMP = dir;
  env.TEMP = dir;
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
