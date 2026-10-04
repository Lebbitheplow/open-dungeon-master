// How much any one account may add to public/uploads, and a floor of free
// disk below which nobody may add anything. Every size cap elsewhere is per
// file; without these, one account could repeat a valid upload or import
// until the volume that also holds the database and its backups is full.
//
// The budget is a rolling 24-hour window per user, kept in memory on
// globalThis the way the login throttle is (src/lib/login-throttle.ts), so
// a restart forgets it. It is a brake on runaway or hostile use, not
// accounting: the floor is what protects the disk across many accounts.
//
// admitUpload checks and records in one synchronous call, so two requests
// racing each other cannot both spend the last of a budget.
//
// Admins have no budget: the limit is on what any signed-in account can do
// to a disk that is not theirs, and an admin installing registry worlds or
// building their own is the person that disk belongs to (on a device world,
// the device's owner). The floor still applies to them.
import fs from "node:fs";
import path from "node:path";
import { serverEnv } from "@/lib/server-env";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;
const DEFAULT_DAILY_BYTES = 500 * MIB;
const DEFAULT_DAILY_FILES = 200;
const DEFAULT_MIN_FREE_BYTES = 1024 * MIB;

type Spend = { at: number; bytes: number; files: number };

export type UploadRefusal = { error: string; status: 429 | 507; retryAfterSec?: number };

export type UploadAccount = { id: string; isAdmin?: boolean };

declare global {
  var __odmUploadBudget: Map<string, Spend[]> | undefined;
}

function store(): Map<string, Spend[]> {
  if (!globalThis.__odmUploadBudget) {
    globalThis.__odmUploadBudget = new Map();
  }
  return globalThis.__odmUploadBudget;
}

// A non-negative whole number from the environment, or the default. 0 turns
// that limit off.
function limit(key: string, fallback: number): number {
  const raw = serverEnv(key).trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function uploadLimits() {
  return {
    dailyBytes: limit("UPLOAD_DAILY_BYTES", DEFAULT_DAILY_BYTES),
    dailyFiles: limit("UPLOAD_DAILY_FILES", DEFAULT_DAILY_FILES),
    minFreeBytes: limit("UPLOAD_MIN_FREE_BYTES", DEFAULT_MIN_FREE_BYTES),
  };
}

function uploadsDir(): string {
  return path.join(process.cwd(), "public", "uploads");
}

// Free bytes on the volume public/uploads lives on, or null when it cannot
// be read. Asks the nearest folder that exists, since uploads/ itself is
// only made by the first write.
function freeBytes(): number | null {
  let dir = uploadsDir();
  for (;;) {
    try {
      const stats = fs.statfsSync(dir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }
}

function recent(userId: string, now: number): Spend[] {
  const kept = (store().get(userId) ?? []).filter((spend) => now - spend.at < WINDOW_MS);
  if (kept.length) {
    store().set(userId, kept);
  } else {
    store().delete(userId);
  }
  return kept;
}

// Seconds until enough of the window has rolled off for this request to fit.
function retryAfter(spends: Spend[], bytes: number, files: number, max: { bytes: number; files: number }, now: number) {
  let usedBytes = spends.reduce((sum, spend) => sum + spend.bytes, 0);
  let usedFiles = spends.reduce((sum, spend) => sum + spend.files, 0);
  for (const spend of spends) {
    usedBytes -= spend.bytes;
    usedFiles -= spend.files;
    const fits = (!max.bytes || usedBytes + bytes <= max.bytes) && (!max.files || usedFiles + files <= max.files);
    if (fits) {
      return Math.max(1, Math.ceil((spend.at + WINDOW_MS - now) / 1000));
    }
  }
  return Math.ceil(WINDOW_MS / 1000);
}

// "about 3 hours", "about 20 minutes": the Retry-After header in words.
function waitInWords(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

// Null when the account may write `files` new files totalling `bytes`, and
// the spend is recorded; otherwise why not, and nothing is recorded. Callers
// check before writing anything to disk.
export function admitUpload(
  account: UploadAccount,
  bytes: number,
  files: number,
  now = Date.now(),
): UploadRefusal | null {
  if (files <= 0 && bytes <= 0) {
    return null;
  }
  const { dailyBytes, dailyFiles, minFreeBytes } = uploadLimits();

  if (minFreeBytes) {
    const free = freeBytes();
    if (free !== null && free - bytes < minFreeBytes) {
      return { error: "The server is low on storage space and is not accepting uploads right now.", status: 507 };
    }
  }

  if (account.isAdmin) {
    return null;
  }
  const spends = recent(account.id, now);
  const usedBytes = spends.reduce((sum, spend) => sum + spend.bytes, 0);
  const usedFiles = spends.reduce((sum, spend) => sum + spend.files, 0);
  const overBytes = dailyBytes > 0 && usedBytes + bytes > dailyBytes;
  const overFiles = dailyFiles > 0 && usedFiles + files > dailyFiles;
  if (overBytes || overFiles) {
    const retryAfterSec = retryAfter(spends, bytes, files, { bytes: dailyBytes, files: dailyFiles }, now);
    return {
      error: `You have uploaded a lot today. Try again in ${waitInWords(retryAfterSec)}.`,
      status: 429,
      retryAfterSec,
    };
  }

  store().set(account.id, [...spends, { at: now, bytes, files }]);
  return null;
}

// The refusal as the response a route returns.
export function uploadRefusalResponse(refusal: UploadRefusal): Response {
  return Response.json(
    { error: refusal.error },
    {
      status: refusal.status,
      headers: refusal.retryAfterSec ? { "Retry-After": String(refusal.retryAfterSec) } : undefined,
    },
  );
}

// Test hook: forget every recorded spend.
export function resetUploadBudget() {
  store().clear();
}
