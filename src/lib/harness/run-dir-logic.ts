// Which temp folders are an agent program's run folders, and when one that
// was left behind may be swept (issue 652). No file system here: the caller
// lists the temp folder and passes what it found.

import { HARNESS_MAX_RUN_MS } from "./types.ts";

// Every run folder this server makes starts with one of these: a run's
// (odm-harness-, and odm-harness-img- for a picture) and the Codex and
// opencode probes'. The opencode probe's folder holds a copy of the admin's
// opencode config, provider keys and all, so it is cleared the same way.
// Nothing else in the temp folder is ever swept.
export const RUN_DIR_PREFIXES = ["odm-harness-", "odm-codex-probe-", "odm-opencode-probe-"] as const;

// What a Codex run folder links from the admin's own Codex home
// (src/lib/harness/adapters/codex.ts). They are links, so removing them
// leaves the admin's files as they were.
export const CODEX_HOME_DIR = "codex-home";
export const LINKED_SIGN_IN_FILES = ["auth.json", "config.toml", "installation_id"] as const;

// When a removal that failed is tried again after the run ended. On Windows
// the program may still hold its folder for a moment while it goes down.
export const RUN_DIR_RETRY_MS = [2_000, 15_000, 60_000, 5 * 60_000] as const;

// No run lives longer than HARNESS_MAX_RUN_MS (a picture or a probe ends far
// sooner), so a run folder older than this belongs to no live run, in this
// server or in another one sharing the temp folder.
export const RUN_DIR_STALE_AFTER_MS = HARNESS_MAX_RUN_MS + 10 * 60_000;

// How often the sweep looks again while the server runs.
export const RUN_DIR_SWEEP_EVERY_MS = 10 * 60_000;

export function isRunDirName(name: string): boolean {
  return RUN_DIR_PREFIXES.some((prefix) => name.startsWith(prefix) && name.length > prefix.length);
}

// ownerUid is the folder's owner where the system has one (not on Windows,
// whose temp folder is the user's own).
export type TempEntry = { name: string; isDirectory: boolean; modifiedMs: number; ownerUid?: number };

// The names of the run folders that may go: a real folder (not a link to
// one), named as a run folder, owned by the user this server runs as, not in
// use by a live run of this server, and older than any run can be. A shared
// temp folder (/tmp) lets anyone make a folder with a run folder's name, and
// one with a link inside it would have the sweep remove files elsewhere.
export function staleRunDirNames(
  entries: readonly TempEntry[],
  options: { now: number; live: ReadonlySet<string>; uid?: number },
): string[] {
  return entries
    .filter(
      (entry) =>
        entry.isDirectory &&
        isRunDirName(entry.name) &&
        (options.uid === undefined || entry.ownerUid === undefined || entry.ownerUid === options.uid) &&
        !options.live.has(entry.name) &&
        options.now - entry.modifiedMs > RUN_DIR_STALE_AFTER_MS,
    )
    .map((entry) => entry.name);
}
