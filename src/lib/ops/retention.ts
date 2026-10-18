import fs from "node:fs";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { databaseFilePath, getDatabase, nowIso } from "@/lib/db/core";
import { REPLAY_GAP_LIMIT } from "@/lib/events";
import { removeFile } from "@/lib/image-files";

// What the server keeps, and for how long (audit P13). The story is kept
// forever: messages, notes, rolls, sheets and their audit trail, chapter
// snapshots, and every DM turn's conversation, which re-narrate replays.
// What goes is what nothing reads back past a point:
//
//   - The event log past the replay window. A page that reconnects more
//     than REPLAY_GAP_LIMIT events behind reloads its snapshot instead
//     (src/lib/events.ts planReplay), so an older event is only ever read as
//     "the latest of its kind": the handout on show, the X-card, the title
//     card, the agents' floor state. The newest EVENTS_KEPT_PER_TYPE of each
//     kind stay, so does the newest of each kind before every chapter
//     boundary (a rewind reads those back), and so does the last held floor.
//   - Context traces (what each prompt cost, block by block) on turns more
//     than a week old, past the newest few per campaign. The trace panel
//     reads the latest turn only.
//   - Usage rows older than 90 days, merged into one row per month and kind
//     of call. The ledger shows totals, which come out the same.
//   - Model-call diagnostics (src/lib/usage/model-calls.ts) older than 30
//     days: they explain a slow turn while it is still remembered.
//
// The pages those deletes free go back to the disk a little at a time
// (incremental vacuum), so play never waits on it. A database made before
// this cannot do that until the admin compacts it once.
//
// Files no row names (an upload abandoned before its form was sent, art and
// narration a rewind dropped) are only counted here; the admin decides.

const DAY_MS = 86_400_000;
const EVENT_MIN_AGE_MS = 30 * DAY_MS;
const EVENTS_KEPT_PER_TYPE = 100;
const TRACE_MIN_AGE_MS = 7 * DAY_MS;
const TRACES_KEPT_PER_CAMPAIGN = 5;
const USAGE_MIN_AGE_MS = 90 * DAY_MS;
const MODEL_CALL_MIN_AGE_MS = 30 * DAY_MS;
const ORPHAN_GRACE_MS = DAY_MS;
// Deletes per transaction, and pages handed back per step, between which
// the event loop gets a turn.
const BATCH = 500;
const RECLAIM_PAGES = 2048;

export const RETENTION_EVERY_MS = DAY_MS;
// The first pass waits for the server to settle after a start.
const FIRST_PASS_AFTER_MS = 10 * 60_000;
// Room VACUUM needs beside the file: a full copy, its journal, a margin.
const COMPACT_HEADROOM_BYTES = 64 * 1024 * 1024;

export class StorageError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type RetentionReport = {
  at: string;
  eventsRemoved: number;
  tracesCleared: number;
  usageRowsMerged: number;
  modelCallsRemoved: number;
  bytesReclaimed: number;
  ms: number;
};

type RetentionState = { startedAt: number; lastAt: number; running: boolean; report: RetentionReport | null };

declare global {
  var __odmRetention: RetentionState | undefined;
}

function state(): RetentionState {
  globalThis.__odmRetention ??= { startedAt: Date.now(), lastAt: 0, running: false, report: null };
  return globalThis.__odmRetention;
}

function pragmaNumber(name: string): number {
  const row = getDatabase().prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return Number(row ? Object.values(row)[0] : 0) || 0;
}

// The events one campaign keeps whatever their age (see the header).
function keptEvents(campaignId: string): Set<number> {
  const rows = getDatabase()
    .prepare(
      `SELECT seq FROM (
         SELECT seq, ROW_NUMBER() OVER (PARTITION BY type ORDER BY seq DESC) AS rank
         FROM campaign_events WHERE campaign_id = ?
       ) WHERE rank <= ?
       UNION
       SELECT MAX(e.seq) FROM campaign_events e
       JOIN chapter_snapshots s ON s.campaign_id = e.campaign_id AND e.seq <= s.boundary_seq
       WHERE e.campaign_id = ? GROUP BY s.boundary_seq, e.type
       UNION
       SELECT MAX(seq) FROM campaign_events
       WHERE campaign_id = ? AND type = 'floor_changed' AND json_extract(payload_json, '$.floor.mode') = 'hold'`,
    )
    .all(campaignId, EVENTS_KEPT_PER_TYPE, campaignId, campaignId) as Array<{ seq: number | null }>;
  return new Set(rows.flatMap((row) => (row.seq === null ? [] : [row.seq])));
}

export async function pruneEventLog(now = Date.now()): Promise<number> {
  const db = getDatabase();
  const cutoff = new Date(now - EVENT_MIN_AGE_MS).toISOString();
  const campaigns = db.prepare(`SELECT id, next_seq FROM campaigns`).all() as Array<{ id: string; next_seq: number }>;
  let removed = 0;
  for (const campaign of campaigns) {
    const ceiling = campaign.next_seq - 1 - REPLAY_GAP_LIMIT;
    if (ceiling <= 0) {
      continue;
    }
    const kept = keptEvents(campaign.id);
    const doomed = (
      db
        .prepare(`SELECT seq FROM campaign_events WHERE campaign_id = ? AND seq <= ? AND created_at < ? ORDER BY seq`)
        .all(campaign.id, ceiling, cutoff) as Array<{ seq: number }>
    )
      .map((row) => row.seq)
      .filter((seq) => !kept.has(seq));
    for (let start = 0; start < doomed.length; start += BATCH) {
      const slice = doomed.slice(start, start + BATCH);
      removed += db
        .prepare(`DELETE FROM campaign_events WHERE campaign_id = ? AND seq IN (${slice.map(() => "?").join(", ")})`)
        .run(campaign.id, ...slice).changes;
      await nextTurn();
    }
  }
  return removed;
}

export function clearOldContextTraces(now = Date.now()): number {
  const cutoff = new Date(now - TRACE_MIN_AGE_MS).toISOString();
  return getDatabase()
    .prepare(
      `UPDATE dm_turns SET context_trace_json = NULL
       WHERE context_trace_json IS NOT NULL AND updated_at < ? AND status IN ('done', 'failed')
         AND id NOT IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at DESC, rowid DESC) AS rank
             FROM dm_turns
           ) WHERE rank <= ?
         )`,
    )
    .run(cutoff, TRACES_KEPT_PER_CAMPAIGN).changes;
}

export function pruneModelCalls(now = Date.now()): number {
  const cutoff = new Date(now - MODEL_CALL_MIN_AGE_MS).toISOString();
  return getDatabase().prepare(`DELETE FROM model_calls WHERE at < ?`).run(cutoff).changes;
}

// Returns how many rows were folded into others.
export async function rollUpUsage(now = Date.now()): Promise<number> {
  const db = getDatabase();
  const cutoff = new Date(now - USAGE_MIN_AGE_MS).toISOString();
  const groups = db
    .prepare(
      `SELECT substr(at, 1, 7) AS month, campaign_id, user_id, kind, role, backend, model, paid, COUNT(*) AS rows
       FROM usage_events WHERE at < ?
       GROUP BY month, campaign_id, user_id, kind, role, backend, model, paid HAVING COUNT(*) > 1`,
    )
    .all(cutoff) as Array<{
    month: string;
    campaign_id: string | null;
    user_id: string | null;
    kind: string;
    role: string;
    backend: string;
    model: string;
    paid: number;
    rows: number;
  }>;
  const MATCH = `at < ? AND substr(at, 1, 7) = ? AND campaign_id IS ? AND user_id IS ? AND kind = ? AND role = ? AND backend = ? AND model = ? AND paid = ?`;
  const merge = db.transaction((group: (typeof groups)[number]) => {
    const keys = [cutoff, group.month, group.campaign_id, group.user_id, group.kind, group.role, group.backend, group.model, group.paid];
    const merged = db
      .prepare(
        `INSERT INTO usage_events
           (at, campaign_id, user_id, kind, role, backend, model, paid, input_tokens, output_tokens, units, duration_ms, calls,
            cached_input_tokens, reasoning_tokens)
         SELECT MAX(at), campaign_id, user_id, kind, role, backend, model, paid,
                SUM(input_tokens), SUM(output_tokens), SUM(units), SUM(duration_ms), SUM(calls),
                SUM(cached_input_tokens), SUM(reasoning_tokens)
         FROM usage_events WHERE ${MATCH}`,
      )
      .run(...keys);
    db.prepare(`DELETE FROM usage_events WHERE ${MATCH} AND id <> ?`).run(...keys, merged.lastInsertRowid);
  });
  let folded = 0;
  for (const [index, group] of groups.entries()) {
    merge(group);
    folded += group.rows - 1;
    if (index % 50 === 49) {
      await nextTurn();
    }
  }
  return folded;
}

// Hands free pages back to the disk in small steps. Only a database in
// incremental mode can; any other answers 0 until it is compacted.
export async function reclaimSpace(): Promise<number> {
  if (pragmaNumber("auto_vacuum") !== 2) {
    return 0;
  }
  const pageSize = pragmaNumber("page_size");
  let reclaimed = 0;
  for (let free = pragmaNumber("freelist_count"); free > 0; free = pragmaNumber("freelist_count")) {
    const pages = Math.min(free, RECLAIM_PAGES);
    getDatabase().exec(`PRAGMA incremental_vacuum(${pages})`);
    reclaimed += pages * pageSize;
    await nextTurn();
  }
  return reclaimed;
}

// One whole pass. Never two at once: a second caller gets the running
// pass's answer rather than racing it.
let running: Promise<RetentionReport> | null = null;

export function runRetention(now = Date.now()): Promise<RetentionReport> {
  running ??= (async () => {
    const current = state();
    current.running = true;
    const started = Date.now();
    try {
      const eventsRemoved = await pruneEventLog(now);
      const tracesCleared = clearOldContextTraces(now);
      const usageRowsMerged = await rollUpUsage(now);
      const modelCallsRemoved = pruneModelCalls(now);
      const bytesReclaimed = await reclaimSpace();
      const report = { at: nowIso(), eventsRemoved, tracesCleared, usageRowsMerged, modelCallsRemoved, bytesReclaimed, ms: Date.now() - started };
      current.report = report;
      return report;
    } finally {
      current.lastAt = now;
      current.running = false;
      running = null;
    }
  })();
  return running;
}

// The daily job (src/lib/jobs.ts): due a while after the server starts,
// then once a day.
export function retentionDue(now = Date.now()): boolean {
  const current = state();
  if (current.running) {
    return false;
  }
  return current.lastAt ? now - current.lastAt >= RETENTION_EVERY_MS : now - current.startedAt >= FIRST_PASS_AFTER_MS;
}

async function freeBytes(dir: string): Promise<number> {
  try {
    const stats = await fs.promises.statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function databaseBytes(): number {
  const file = databaseFilePath();
  return fileBytes(file) + fileBytes(`${file}-wal`);
}

// Rewrites the database without its free pages and switches it to the
// incremental mode the daily pass needs. Blocks the server while it runs
// (a second or two for a few hundred megabytes), so only the admin asks.
export async function compactDatabase(): Promise<{ before: number; after: number }> {
  const before = databaseBytes();
  const need = fileBytes(databaseFilePath()) * 2 + COMPACT_HEADROOM_BYTES;
  const free = await freeBytes(path.dirname(databaseFilePath()));
  if (free < need) {
    throw new StorageError(
      `Compacting needs about ${Math.ceil(need / 1024 ** 2)} MB free beside the database; ${Math.floor(free / 1024 ** 2)} MB is free.`,
      507,
    );
  }
  if (running) {
    throw new StorageError("The daily tidy is running. Try again in a moment.", 409);
  }
  const db = getDatabase();
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return { before, after: databaseBytes() };
}

// Stored files no row names, past a day's grace (a file uploaded a moment
// ago may belong to a form still being filled in).
//
// A picture's name is matched on its stem, so the WebP copies beside it
// (name.w256.webp) live and die with it, and a path inside a full address
// or a sentence still counts as a use: keeping is the side to err on. Only
// names in the shapes the server writes are ever candidates. Narration audio
// is per campaign and per message, so a folder whose campaign is gone, or a
// clip whose message is gone, is an orphan; the voice previews are a cache
// and are left alone.
const STORED_NAME = /^([A-Za-z0-9][A-Za-z0-9_-]{0,200})(?:\.w(?:256|1024))?\.(?:png|jpe?g|webp|pdf)$/i;
const NAMED = /\/(uploads|generated)\/([A-Za-z0-9][A-Za-z0-9_-]*)/g;
const AUDIO_NAME = /^([A-Za-z0-9_-]+)\.mp3$/;

export type OrphanFile = { url: string; files: string[]; bytes: number };
export type OrphanScan = { pictures: OrphanFile[]; audio: OrphanFile[]; bytes: number; scannedAt: string };

function publicDir(...parts: string[]): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "public", ...parts);
}

async function namedStems(): Promise<Set<string>> {
  const db = getDatabase();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const named = new Set<string>();
  for (const { name: table } of tables) {
    // Who made a file is not a use of it.
    if (table === "media_files") {
      continue;
    }
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>;
    for (const { name: column, type } of info) {
      if (type && !/TEXT|CHAR|CLOB|JSON/i.test(type)) {
        continue;
      }
      const rows = db
        .prepare(
          `SELECT "${column}" AS value FROM "${table}" WHERE "${column}" LIKE '%/uploads/%' OR "${column}" LIKE '%/generated/%'`,
        )
        .all() as Array<{ value: unknown }>;
      for (const { value } of rows) {
        if (typeof value === "string") {
          for (const [, root, stem] of value.matchAll(NAMED)) {
            named.add(`${root}/${stem}`);
          }
        }
      }
    }
    await nextTurn();
  }
  return named;
}

async function listFiles(dir: string): Promise<Array<{ name: string; bytes: number; mtimeMs: number; isDir: boolean }>> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    try {
      const info = await fs.promises.lstat(path.join(dir, name));
      if (info.isFile() || info.isDirectory()) {
        files.push({ name, bytes: info.size, mtimeMs: info.mtimeMs, isDir: info.isDirectory() });
      }
    } catch {
      // Gone between the listing and the stat.
    }
  }
  return files;
}

export async function scanOrphanFiles(now = Date.now()): Promise<OrphanScan> {
  const named = await namedStems();
  const graceEnds = now - ORPHAN_GRACE_MS;
  const pictures: OrphanFile[] = [];
  for (const root of ["uploads", "generated"]) {
    const byStem = new Map<string, OrphanFile & { fresh: boolean }>();
    for (const file of await listFiles(publicDir(root))) {
      const match = file.isDir ? null : STORED_NAME.exec(file.name);
      if (!match || named.has(`${root}/${match[1]}`)) {
        continue;
      }
      const entry = byStem.get(match[1]) ?? { url: "", files: [], bytes: 0, fresh: false };
      // The original's address, not a copy's.
      if (!/\.w(?:256|1024)\.webp$/i.test(file.name)) {
        entry.url = `/${root}/${file.name}`;
      }
      entry.files.push(`/${root}/${file.name}`);
      entry.bytes += file.bytes;
      entry.fresh ||= file.mtimeMs > graceEnds;
      byStem.set(match[1], entry);
    }
    for (const { fresh, ...entry } of byStem.values()) {
      if (!fresh) {
        pictures.push({ ...entry, url: entry.url || entry.files[0] });
      }
    }
  }

  const db = getDatabase();
  const campaigns = new Set((db.prepare(`SELECT id FROM campaigns`).all() as Array<{ id: string }>).map((row) => row.id));
  const audio: OrphanFile[] = [];
  for (const folder of await listFiles(publicDir("generated-audio"))) {
    if (!folder.isDir || folder.name === "previews" || !/^[A-Za-z0-9_-]+$/.test(folder.name)) {
      continue;
    }
    const clips = await listFiles(publicDir("generated-audio", folder.name));
    if (!campaigns.has(folder.name)) {
      const old = clips.every((clip) => clip.mtimeMs <= graceEnds);
      if (old) {
        audio.push({
          url: `/generated-audio/${folder.name}/`,
          files: clips.map((clip) => `/generated-audio/${folder.name}/${clip.name}`),
          bytes: clips.reduce((sum, clip) => sum + clip.bytes, 0),
        });
      }
      continue;
    }
    const messages = new Set(
      (db.prepare(`SELECT id FROM campaign_messages WHERE campaign_id = ?`).all(folder.name) as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    );
    for (const clip of clips) {
      const match = clip.isDir ? null : AUDIO_NAME.exec(clip.name);
      if (match && !messages.has(match[1]) && clip.mtimeMs <= graceEnds) {
        const url = `/generated-audio/${folder.name}/${clip.name}`;
        audio.push({ url, files: [url], bytes: clip.bytes });
      }
    }
  }
  const bytes = [...pictures, ...audio].reduce((sum, file) => sum + file.bytes, 0);
  return { pictures, audio, bytes, scannedAt: nowIso() };
}

// Scans again rather than trusting a list the page held, then removes.
export async function removeOrphanFiles(now = Date.now()): Promise<{ removed: number; bytes: number }> {
  const scan = await scanOrphanFiles(now);
  for (const picture of scan.pictures) {
    removeFile(picture.url);
    // A copy whose original was already gone.
    for (const file of picture.files) {
      fs.rmSync(publicDir(...file.split("/").filter(Boolean)), { force: true });
    }
  }
  for (const clip of scan.audio) {
    const target = publicDir(...clip.url.split("/").filter(Boolean));
    fs.rmSync(target, { force: true, recursive: clip.url.endsWith("/") });
  }
  return { removed: scan.pictures.length + scan.audio.length, bytes: scan.bytes };
}

export type StorageStats = {
  databaseBytes: number;
  freePageBytes: number;
  incremental: boolean;
  diskFreeBytes: number;
  eventRows: number;
  usageRows: number;
  traceBytes: number;
  running: boolean;
  report: RetentionReport | null;
  nextAt: string | null;
};

export async function storageStats(): Promise<StorageStats> {
  const db = getDatabase();
  const count = (sql: string) => Number(Object.values(db.prepare(sql).get() as object)[0]) || 0;
  const current = state();
  const free = await freeBytes(path.dirname(databaseFilePath()));
  return {
    databaseBytes: databaseBytes(),
    freePageBytes: pragmaNumber("freelist_count") * pragmaNumber("page_size"),
    incremental: pragmaNumber("auto_vacuum") === 2,
    diskFreeBytes: Number.isFinite(free) ? free : -1,
    eventRows: count(`SELECT COUNT(*) FROM campaign_events`),
    usageRows: count(`SELECT COUNT(*) FROM usage_events`),
    traceBytes: count(`SELECT COALESCE(SUM(length(context_trace_json)), 0) FROM dm_turns`),
    running: current.running,
    report: current.report,
    nextAt: current.running
      ? null
      : new Date(current.lastAt ? current.lastAt + RETENTION_EVERY_MS : current.startedAt + FIRST_PASS_AFTER_MS).toISOString(),
  };
}
