// Agent run folders are cleared up (issue 652, src/lib/harness/run-dir.ts).
// On Windows a Codex run folder holds hard links to the admin's Codex
// sign-in, and one failed removal used to leave it for good: after about a
// thousand runs NTFS refused another link and every GM turn halted. So the
// links go even when the folder is held, a held folder is tried again, and
// folders earlier runs left are swept, while a live run's folder, a young
// one, anything not named as a run folder and anything a link points to
// stay. Everything here happens in a scratch folder standing in for the
// temp folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const { makeRunDir, removeRunDir, sweepStaleRunDirs } = await import("../src/lib/harness/run-dir.ts");
const { RUN_DIR_STALE_AFTER_MS, staleRunDirNames } = await import("../src/lib/harness/run-dir-logic.ts");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odm-run-dir-test-"));
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// The admin's Codex home, outside the stand-in temp folder.
const adminHome = path.join(scratch, "admin-codex");
fs.mkdirSync(adminHome);
const adminAuth = path.join(adminHome, "auth.json");
fs.writeFileSync(adminAuth, '{"signed":"in"}');

// A run folder as a Codex run leaves it: codex-home with a hard link to the
// admin's sign-in, and a file of the run's own.
function codexRunFolder(tmpdir, name) {
  const dir = path.join(tmpdir, name);
  fs.mkdirSync(path.join(dir, "codex-home"), { recursive: true });
  fs.linkSync(adminAuth, path.join(dir, "codex-home", "auth.json"));
  fs.writeFileSync(path.join(dir, "codex-home", "catalog.json"), "{}");
  return dir;
}

function age(target, ms) {
  const when = new Date(Date.now() - ms);
  fs.utimesSync(target, when, when);
}

try {
  await test("only old, unused run folders are chosen", () => {
    const now = 10_000_000_000;
    const old = now - RUN_DIR_STALE_AFTER_MS - 1;
    const names = staleRunDirNames(
      [
        { name: "odm-harness-old", isDirectory: true, modifiedMs: old },
        { name: "odm-harness-img-old", isDirectory: true, modifiedMs: old },
        { name: "odm-codex-probe-old", isDirectory: true, modifiedMs: old },
        { name: "odm-harness-live", isDirectory: true, modifiedMs: old },
        { name: "odm-harness-young", isDirectory: true, modifiedMs: now - 60_000 },
        { name: "odm-harness-file", isDirectory: false, modifiedMs: old },
        { name: "odm-harness-", isDirectory: true, modifiedMs: old },
        { name: "odm-opencode-probe-old", isDirectory: true, modifiedMs: old },
        { name: "odm-harness-owned", isDirectory: true, modifiedMs: old, ownerUid: 1000 },
        { name: "odm-harness-not-ours", isDirectory: true, modifiedMs: old, ownerUid: 1001 },
        { name: "someone-else", isDirectory: true, modifiedMs: old },
      ],
      { now, live: new Set(["odm-harness-live"]), uid: 1000 },
    );
    // The opencode probe's folder holds the admin's opencode config. One
    // another user made in a shared /tmp is theirs, whatever its name.
    assert.deepEqual(names, ["odm-harness-old", "odm-harness-img-old", "odm-codex-probe-old", "odm-opencode-probe-old", "odm-harness-owned"]);
  });

  await test("a codex-home that is a link is not followed to the admin's own sign-in", () => {
    const tmpdir = path.join(scratch, "linked-home");
    fs.mkdirSync(tmpdir);
    // A folder named as a run folder whose codex-home points at the admin's
    // real Codex home (anyone can make one in a shared /tmp).
    const planted = path.join(tmpdir, "odm-harness-planted");
    fs.mkdirSync(planted);
    fs.symlinkSync(adminHome, path.join(planted, "codex-home"), "junction");
    age(planted, RUN_DIR_STALE_AFTER_MS + 60_000);
    const before = fs.statSync(adminAuth).nlink;
    sweepStaleRunDirs({ tmpdir });
    assert.equal(fs.readFileSync(adminAuth, "utf8"), '{"signed":"in"}', "the admin's auth.json is still there");
    assert.equal(fs.statSync(adminAuth).nlink, before);
    assert.equal(fs.existsSync(planted), false, "the folder itself went, its link with it and not what it points to");
    removeRunDir(path.join(tmpdir, "missing"));
  });

  await test("a held folder loses its sign-in links at once and is removed on a later try", async () => {
    const tmpdir = path.join(scratch, "held");
    fs.mkdirSync(tmpdir);
    const dir = codexRunFolder(tmpdir, "odm-harness-held");
    assert.equal(fs.statSync(adminAuth).nlink, 2);
    let tries = 0;
    const gone = removeRunDir(dir, {
      retryMs: [20, 20],
      remove: (target) => {
        tries += 1;
        if (tries === 1) {
          throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        }
        fs.rmSync(target, { recursive: true, force: true });
      },
    });
    assert.equal(gone, false, "the first try was refused");
    assert.ok(fs.existsSync(path.join(dir, "codex-home", "catalog.json")), "the folder is still there");
    assert.equal(fs.existsSync(path.join(dir, "codex-home", "auth.json")), false, "the sign-in link went anyway");
    assert.equal(fs.statSync(adminAuth).nlink, 1, "no link to the admin's sign-in is left");
    assert.equal(fs.readFileSync(adminAuth, "utf8"), '{"signed":"in"}', "the admin's own file is untouched");
    for (let waited = 0; fs.existsSync(dir) && waited < 2_000; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fs.existsSync(dir), false, "the retry removed the folder");
    assert.equal(tries, 2);
  });

  await test("the sweep removes what earlier runs left and nothing else", () => {
    const tmpdir = path.join(scratch, "sweep");
    fs.mkdirSync(tmpdir);
    // A live run of this server, made first and aged below as if it had run
    // a long time.
    const live = makeRunDir("odm-harness-", { tmpdir });
    fs.mkdirSync(path.join(live, "codex-home"));
    fs.linkSync(adminAuth, path.join(live, "codex-home", "auth.json"));
    const stale = Array.from({ length: 3 }, (_, index) => codexRunFolder(tmpdir, `odm-harness-stale${index}`));
    const staleProbe = codexRunFolder(tmpdir, "odm-codex-probe-stale");
    const young = codexRunFolder(tmpdir, "odm-harness-young");
    const other = path.join(tmpdir, "someone-elses-folder");
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, "keep.txt"), "keep");
    // A link named as a run folder, to a folder that is not one.
    const outside = path.join(scratch, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
    const link = path.join(tmpdir, "odm-harness-link");
    fs.symlinkSync(outside, link, "junction");
    for (const dir of [...stale, staleProbe, other]) {
      age(dir, RUN_DIR_STALE_AFTER_MS + 60_000);
    }
    try {
      const when = new Date(Date.now() - RUN_DIR_STALE_AFTER_MS - 60_000);
      fs.lutimesSync(link, when, when);
    } catch {
      // A link's own time cannot be set here; it is young, and kept anyway.
    }
    age(live, RUN_DIR_STALE_AFTER_MS + 60_000);
    assert.equal(fs.statSync(adminAuth).nlink, 1 + 3 + 1 + 1 + 1);

    const removed = sweepStaleRunDirs({ tmpdir });
    assert.equal(removed, 4);
    for (const dir of [...stale, staleProbe]) {
      assert.equal(fs.existsSync(dir), false, `${path.basename(dir)} was swept`);
    }
    assert.ok(fs.existsSync(young), "a young run folder may belong to a run of another server");
    assert.ok(fs.existsSync(live), "a live run's folder stays");
    assert.ok(fs.existsSync(path.join(other, "keep.txt")), "a folder not named as a run folder stays");
    assert.ok(fs.lstatSync(link).isSymbolicLink(), "a link named as a run folder stays");
    assert.ok(fs.existsSync(path.join(outside, "keep.txt")), "what a link points to stays");
    assert.equal(fs.statSync(adminAuth).nlink, 3, "only the young and the live runs' links are left");
    assert.equal(fs.readFileSync(adminAuth, "utf8"), '{"signed":"in"}');

    // Once the live run ends, its folder goes with its link.
    assert.equal(removeRunDir(live), true);
    assert.equal(fs.existsSync(live), false);
    assert.equal(fs.statSync(adminAuth).nlink, 2);
    fs.unlinkSync(link);
  });

  await test("the first run folder a server makes sweeps the old ones", () => {
    const tmpdir = path.join(scratch, "first-run");
    fs.mkdirSync(tmpdir);
    const stale = codexRunFolder(tmpdir, "odm-harness-left");
    age(stale, RUN_DIR_STALE_AFTER_MS + 60_000);
    globalThis.__odmHarnessRunDirs = undefined;
    const fresh = makeRunDir("odm-harness-", { tmpdir });
    assert.equal(fs.existsSync(stale), false, "the folder an earlier server left is gone");
    assert.ok(fs.existsSync(fresh));
    assert.equal(fs.statSync(adminAuth).nlink, 2, "the young run's link from the last test stays");
    assert.equal(removeRunDir(fresh), true);
  });

  await test("an unknown prefix is refused, and the opencode probe's is known", () => {
    assert.throws(() => makeRunDir("not-ours-", { tmpdir: scratch }));
    const probe = makeRunDir("odm-opencode-probe-", { tmpdir: scratch });
    assert.equal(removeRunDir(probe), true);
  });
} finally {
  removeTempDir(scratch);
}

console.log(`${passed} run folder tests passed`);
