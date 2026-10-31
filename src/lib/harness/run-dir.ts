// The temp folders agent programs run in (issue 652).
//
// A Codex run folder holds hard links (symlinks off Windows) to the admin's
// Codex sign-in. On Windows the folder often cannot be removed at the moment
// the run ends, because the program is still going down. One failed removal
// used to leave the folder and its links for good, and after about a
// thousand runs NTFS refused another link to auth.json and every GM turn
// halted. So a removal now:
//   1. unlinks the sign-in links first, which works even while the folder
//      itself is still held,
//   2. tries the folder, and if it is still there tries again a few times
//      once the program has had time to exit,
//   3. and anything still left, from this run or an earlier server, is swept
//      at server start and now and then after, once it is older than any run.
// Only folders this server names as run folders, directly in the temp
// folder, are ever touched. Removing a link never touches what it points to.

import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_HOME_DIR,
  LINKED_SIGN_IN_FILES,
  RUN_DIR_RETRY_MS,
  RUN_DIR_SWEEP_EVERY_MS,
  isRunDirName,
  staleRunDirNames,
  type TempEntry,
} from "./run-dir-logic.ts";

type RunDirState = {
  // Folders a run is using now, by full path.
  live: Set<string>;
  lastSweep: number;
};

declare global {
  var __odmHarnessRunDirs: RunDirState | undefined;
}

function state(): RunDirState {
  if (!globalThis.__odmHarnessRunDirs) {
    globalThis.__odmHarnessRunDirs = { live: new Set(), lastSweep: 0 };
  }
  return globalThis.__odmHarnessRunDirs;
}

function removeFolder(dir: string) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export type RemoveRunDirOptions = {
  // Stand-ins for a test.
  remove?: (dir: string) => void;
  retryMs?: readonly number[];
};

// A new run folder in the temp folder, held as live until it is removed. The
// first one a server makes (and one every few minutes after) also sweeps
// what earlier runs left.
export function makeRunDir(prefix: string, options: { tmpdir?: string; now?: number } = {}): string {
  const tmpdir = options.tmpdir ?? os.tmpdir();
  if (!isRunDirName(`${prefix}x`)) {
    throw new Error(`Not a run folder prefix: ${prefix}`);
  }
  const now = options.now ?? Date.now();
  if (now - state().lastSweep >= RUN_DIR_SWEEP_EVERY_MS) {
    sweepStaleRunDirs({ tmpdir, now });
  }
  const dir = mkdtempSync(path.join(tmpdir, prefix));
  state().live.add(path.resolve(dir));
  return dir;
}

function realFolder(target: string): boolean {
  try {
    const stat = lstatSync(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

// Unlinks the admin's sign-in files from a Codex run folder. Each is a link,
// so the admin's own file stays; only a file or a link is removed here,
// never a folder. The run folder and its codex-home must be real folders:
// through a codex-home that is itself a link, the "link" below would be the
// admin's own auth.json.
export function dropSignInLinks(dir: string): void {
  const home = path.join(dir, CODEX_HOME_DIR);
  if (!realFolder(dir) || !realFolder(home)) {
    return;
  }
  for (const name of LINKED_SIGN_IN_FILES) {
    const file = path.join(home, name);
    try {
      const stat = lstatSync(file);
      if (stat.isFile() || stat.isSymbolicLink()) {
        unlinkSync(file);
      }
    } catch {
      // Not there, or held: the folder's removal below tries again.
    }
  }
}

// Never throws: a throw from here must not carry a concurrency slot away
// with it (issue 16). Returns whether the folder is gone now.
export function removeRunDir(dir: string, options: RemoveRunDirOptions = {}): boolean {
  state().live.delete(path.resolve(dir));
  return attemptRemoval(dir, options, 0);
}

function attemptRemoval(dir: string, options: RemoveRunDirOptions, attempt: number): boolean {
  dropSignInLinks(dir);
  try {
    (options.remove ?? removeFolder)(dir);
  } catch {
    // Held a moment longer; tried again below.
  }
  if (!existsSync(dir)) {
    return true;
  }
  const delays = options.retryMs ?? RUN_DIR_RETRY_MS;
  if (attempt < delays.length) {
    const timer = setTimeout(() => attemptRemoval(dir, options, attempt + 1), delays[attempt]);
    // A retry never keeps the server from stopping.
    timer.unref?.();
  }
  // After the last retry it is left to the sweep.
  return false;
}

// Removes the run folders left in the temp folder by runs that are over: in
// this server, or in an earlier one that stopped before it could clear up.
// Returns how many went.
export function sweepStaleRunDirs(options: { tmpdir?: string; now?: number } = {}): number {
  const tmpdir = options.tmpdir ?? os.tmpdir();
  const now = options.now ?? Date.now();
  state().lastSweep = now;
  let names: string[];
  try {
    names = readdirSync(tmpdir).filter(isRunDirName);
  } catch {
    return 0;
  }
  // The user this server runs as, where the system has users that own
  // files (not Windows: process.getuid is absent there).
  const ownUid = process.getuid?.();
  const entries: TempEntry[] = [];
  for (const name of names) {
    try {
      // lstat: a link named like a run folder is not one, and is not followed.
      const stat = lstatSync(path.join(tmpdir, name));
      entries.push({
        name,
        isDirectory: stat.isDirectory() && !stat.isSymbolicLink(),
        modifiedMs: stat.mtimeMs,
        ...(ownUid === undefined ? {} : { ownerUid: stat.uid }),
      });
    } catch {
      // Gone already.
    }
  }
  const live = new Set(
    [...state().live].filter((dir) => path.dirname(dir) === path.resolve(tmpdir)).map((dir) => path.basename(dir)),
  );
  let removed = 0;
  for (const name of staleRunDirNames(entries, { now, live, uid: ownUid })) {
    // One attempt each; what is still held now is tried at the next sweep.
    if (removeRunDir(path.join(tmpdir, name), { retryMs: [] })) {
      removed += 1;
    }
  }
  if (removed > 0) {
    console.info(`[harness] removed ${removed} run folder${removed === 1 ? "" : "s"} earlier runs left behind`);
  }
  return removed;
}
