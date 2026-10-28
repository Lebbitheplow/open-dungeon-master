import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import { compareVersions } from "@/lib/build-info";
import { closeDatabaseForRestore, databaseFilePath, getDatabase, nowIso } from "@/lib/db/core";
import { openDatabase, type SqliteDatabase } from "@/lib/db/driver";
import { enterMaintenance } from "@/lib/maintenance";
import { fileSha256, readTarGz, writeTarGz, type TarEntry } from "@/lib/ops/tar";
import { serverEnv } from "@/lib/server-env";
import { currentBuild } from "@/lib/update-check";
import { INSTALLED_DIR, resetWorldPackCache } from "@/lib/worlds";

// A whole device world in one file, and back (audit C7). The apps' own
// worlds cannot use the server backup (it shells out to tar, wants the
// database under the app root and the native cipher module; a phone has
// none of the three), so they get this instead, driven from the apps'
// Settings:
//
//   - Export: a consistent copy of the database (VACUUM INTO), decrypted so
//     any device can read it, with every secret left out: sign-ins, agent
//     connections and their webhooks, pending invites, and every key,
//     secret, token or password inside the settings. Then the pictures,
//     documents and narration, the world packs an admin installed
//     (data/worlds, which a fresh install is otherwise without), and a
//     manifest with each file's size and sha256, written first so an import
//     knows what to expect before it unpacks a byte.
//   - Import, in two steps so nothing is replaced before the person has
//     seen what the archive holds: check (unpack beside the world, verify
//     every file against the manifest, open the database and run its
//     integrity check) and commit (give the world's owner the password the
//     app keeps for it, re-key the database for this device, swap it and
//     the media in, keep the replaced world aside, stop taking play until
//     the app restarts the server). Keys come back by being entered again
//     on the new device, never by travelling in a file that gets shared.
//
// Everything is staged in world-transfer/ beside the database, where the
// apps put the file they picked and take the file they save.

const FORMAT = "odm-world";
// Version 2 added the installed world packs (worlds/<id>.json). Both versions
// import; an older app meets a version 2 archive with the "update the app"
// message below rather than a complaint about a file it does not know.
const FORMAT_VERSION = 2;
const READABLE_VERSIONS = new Set([1, FORMAT_VERSION]);
const MEDIA_ROOTS = ["uploads", "generated", "generated-audio"] as const;
// A pack file as the loader names it (src/lib/worlds/index.ts): a pack id and
// .json. index.json is the registry listing a publisher writes beside the
// packs, not a pack, and the loader skips it, so it stays behind too.
const PACK_NAME = /^[a-z][a-z0-9_]{2,49}\.json$/;
const REGISTRY_LISTING = "index.json";
const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const IMPORT_NAME = /^import-[A-Za-z0-9_-]{1,64}\.tar\.gz$/;
const FLAT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$/;
const AUDIO_FOLDER = /^[A-Za-z0-9_-]{1,80}$/;
const AUDIO_NAME = /^[A-Za-z0-9_-]{1,80}\.mp3$/;
// A key, secret, token or password inside the settings JSON.
const SECRET_KEY = /(api_?key|secret|token|password|authorization)$/i;

export class WorldArchiveError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type WorldCounts = { campaigns: number; users: number; messages: number; files: number };
export type WorldExport = { name: string; bytes: number; sha256: string; counts: WorldCounts };
export type WorldPreview = { name: string; serverVersion: string; createdAt: string; owner: string; counts: WorldCounts };

export type WorldJob = {
  kind: "export" | "check";
  phase: string;
  startedAt: string;
  done: boolean;
  error: string;
  export: WorldExport | null;
  preview: WorldPreview | null;
};

type ManifestFile = { name: string; size: number; sha256: string };
type Manifest = {
  format: string;
  version: number;
  serverVersion: string;
  createdAt: string;
  counts: WorldCounts;
  files: ManifestFile[];
};

declare global {
  var __odmWorldJob: WorldJob | undefined;
}

export function worldTransferDir(): string {
  return path.join(path.dirname(databaseFilePath()), "world-transfer");
}

export function currentWorldJob(): WorldJob | null {
  return globalThis.__odmWorldJob ?? null;
}

function beginJob(kind: WorldJob["kind"]): WorldJob {
  const running = globalThis.__odmWorldJob;
  if (running && !running.done) {
    throw new WorldArchiveError("The world is already being packed or checked. Wait for it to finish.", 409);
  }
  const job: WorldJob = { kind, phase: "starting", startedAt: nowIso(), done: false, error: "", export: null, preview: null };
  globalThis.__odmWorldJob = job;
  return job;
}

function databaseKey(): string {
  return serverEnv("DB_ENCRYPTION_KEY");
}

function quoted(value: string): string {
  return value.replaceAll("'", "''");
}

// Opens a staged copy the way the live database is opened: an engine with a
// cipher reads it with the live key, any other reads it plain.
function openStaged(file: string, encrypted: boolean): SqliteDatabase {
  const db = openDatabase(file);
  if (db.encrypted && encrypted) {
    db.pragma("cipher='chacha20'");
    db.pragma(`key='${quoted(databaseKey())}'`);
  }
  return db;
}

function scalar(db: SqliteDatabase, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  return Number(row ? Object.values(row)[0] : 0) || 0;
}

function hasTable(db: SqliteDatabase, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function countsOf(db: SqliteDatabase, files: number): WorldCounts {
  return {
    campaigns: scalar(db, `SELECT COUNT(*) FROM campaigns`),
    users: scalar(db, `SELECT COUNT(*) FROM users`),
    messages: scalar(db, `SELECT COUNT(*) FROM campaign_messages`),
    files,
  };
}

function integrityOk(db: SqliteDatabase): boolean {
  const rows = db.prepare(`PRAGMA integrity_check`).all() as Array<Record<string, unknown>>;
  return rows.length === 1 && Object.values(rows[0])[0] === "ok";
}

function blankSecrets(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = blankSecrets(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key) && typeof item === "string" && item !== "") {
        next[key] = "";
        changed = true;
        continue;
      }
      const result = blankSecrets(item);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

function scrubJsonColumn(db: SqliteDatabase, table: string, key: string, column: string): void {
  const rows = db.prepare(`SELECT "${key}" AS id, "${column}" AS body FROM "${table}" WHERE "${column}" IS NOT NULL`).all() as Array<{
    id: unknown;
    body: unknown;
  }>;
  const update = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${key}" = ?`);
  for (const row of rows) {
    if (typeof row.body !== "string" || !row.body.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.body);
    } catch {
      continue;
    }
    const result = blankSecrets(parsed);
    if (result.changed) update.run(JSON.stringify(result.value), row.id);
  }
}

// Leaves every secret out of the copy, then decrypts it.
function scrubCopy(file: string, encrypted: boolean): WorldCounts {
  const db = openStaged(file, encrypted);
  try {
    db.pragma("journal_mode = DELETE");
    db.pragma("foreign_keys = ON");
    db.transaction(() => {
      for (const table of ["sessions", "player_webhooks", "agent_grants", "account_invites"]) {
        if (hasTable(db, table)) db.exec(`DELETE FROM "${table}"`);
      }
      scrubJsonColumn(db, "app_settings", "key", "value_json");
      scrubJsonColumn(db, "users", "id", "settings_json");
      scrubJsonColumn(db, "campaigns", "id", "settings_json");
      scrubJsonColumn(db, "campaigns", "id", "game_settings_json");
    })();
    if (db.encrypted && encrypted) db.pragma("rekey=''");
    if (!integrityOk(db)) throw new WorldArchiveError("The database copy failed its integrity check.", 500);
    return countsOf(db, 0);
  } finally {
    db.close();
  }
}

function publicDir(...parts: string[]): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "public", ...parts);
}

async function regularFiles(dir: string, pattern: RegExp): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names.sort()) {
    if (!pattern.test(name)) continue;
    const info = await fs.promises.lstat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) found.push(name);
  }
  return found;
}

// The pictures, documents and narration clips; the voice previews are a
// cache and stay behind.
async function listMedia(): Promise<Array<{ name: string; file: string }>> {
  const media: Array<{ name: string; file: string }> = [];
  for (const root of ["uploads", "generated"]) {
    for (const name of await regularFiles(publicDir(root), FLAT_NAME)) {
      media.push({ name: `media/${root}/${name}`, file: publicDir(root, name) });
    }
  }
  let folders: string[] = [];
  try {
    folders = (await fs.promises.readdir(publicDir("generated-audio"))).sort();
  } catch {
    // No narration yet.
  }
  for (const folder of folders) {
    if (folder === "previews" || !AUDIO_FOLDER.test(folder)) continue;
    const info = await fs.promises.lstat(publicDir("generated-audio", folder)).catch(() => null);
    if (!info?.isDirectory()) continue;
    for (const name of await regularFiles(publicDir("generated-audio", folder), AUDIO_NAME)) {
      media.push({ name: `media/generated-audio/${folder}/${name}`, file: publicDir("generated-audio", folder, name) });
    }
  }
  return media;
}

// The world packs an admin installed, as the files they are: the loader on
// the new device reads them back from the same folder.
async function listPacks(): Promise<Array<{ name: string; file: string }>> {
  const packs: Array<{ name: string; file: string }> = [];
  for (const name of await regularFiles(INSTALLED_DIR, PACK_NAME)) {
    if (name === REGISTRY_LISTING) continue;
    packs.push({ name: `worlds/${name}`, file: path.join(INSTALLED_DIR, name) });
  }
  return packs;
}

async function clearStaged(dir: string, pattern: RegExp): Promise<void> {
  for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
    if (pattern.test(name)) await fs.promises.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

async function runExport(job: WorldJob): Promise<WorldExport> {
  const dir = worldTransferDir();
  await fs.promises.mkdir(dir, { recursive: true });
  await clearStaged(dir, /^(odm-world-.*\.tar\.gz|export-.*\.sqlite)$/);
  const copy = path.join(dir, `export-${randomBytes(6).toString("hex")}.sqlite`);
  const live = getDatabase();
  const encrypted = live.encrypted;
  try {
    job.phase = "Copying the database";
    live.exec(`VACUUM INTO '${quoted(copy)}'`);
    job.phase = "Leaving out passwords and keys";
    const counts = scrubCopy(copy, encrypted);
    job.phase = "Finding pictures, narration and world packs";
    const media = [...(await listMedia()), ...(await listPacks())];
    const all = [{ name: "world.sqlite", file: copy }, ...media];
    const files: ManifestFile[] = [];
    for (const [index, item] of all.entries()) {
      job.phase = `Fingerprinting ${index + 1} of ${all.length} files`;
      const info = await fs.promises.stat(item.file);
      files.push({ name: item.name, size: info.size, sha256: await fileSha256(item.file) });
    }
    const manifest: Manifest = {
      format: FORMAT,
      version: FORMAT_VERSION,
      serverVersion: currentBuild().version,
      createdAt: nowIso(),
      counts: { ...counts, files: media.length },
      files,
    };
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
    const name = `odm-world-${stamp}.tar.gz`;
    const target = path.join(dir, name);
    async function* entries(): AsyncGenerator<TarEntry> {
      yield { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest, null, 2)) };
      for (const [index, item] of all.entries()) {
        job.phase = `Packing ${index + 1} of ${all.length} files`;
        yield { name: item.name, file: item.file };
      }
    }
    await writeTarGz(target, entries());
    job.phase = "Checking the archive";
    const bytes = (await fs.promises.stat(target)).size;
    return { name, bytes, sha256: await fileSha256(target), counts: manifest.counts };
  } finally {
    await fs.promises.rm(copy, { force: true });
  }
}

export function startWorldExport(): WorldJob {
  const job = beginJob("export");
  runExport(job)
    .then((result) => {
      job.export = result;
      job.phase = "Ready";
    })
    .catch((error) => {
      job.error = error instanceof Error ? error.message : "The world could not be packed.";
      console.error("[world-archive] export failed", error);
    })
    .finally(() => {
      job.done = true;
    });
  return job;
}

function parseManifest(text: string): Manifest {
  let parsed: Manifest;
  try {
    parsed = JSON.parse(text) as Manifest;
  } catch {
    throw new WorldArchiveError("This is not a world archive: its manifest is not readable.");
  }
  if (parsed?.format !== FORMAT || !Array.isArray(parsed.files)) {
    throw new WorldArchiveError("This is not an Open Game Master world archive.");
  }
  if (!READABLE_VERSIONS.has(parsed.version)) {
    throw new WorldArchiveError("This world archive was made by a different version of the format. Update the app, then try again.");
  }
  const names = new Set<string>();
  for (const file of parsed.files) {
    if (
      typeof file?.name !== "string" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !stagedRelative(file.name) ||
      names.has(file.name)
    ) {
      throw new WorldArchiveError("The archive's manifest lists a file it should not.");
    }
    names.add(file.name);
  }
  if (!names.has("world.sqlite")) throw new WorldArchiveError("The archive has no database.");
  return parsed;
}

// Where an archive entry may land inside the staging folder; null for any
// name the export never writes (so nothing can climb out of it).
function stagedRelative(name: string): string | null {
  if (name === "world.sqlite") return name;
  const parts = name.split("/");
  if (parts[0] === "worlds" && parts.length === 2 && PACK_NAME.test(parts[1]) && parts[1] !== REGISTRY_LISTING) {
    return path.join(...parts);
  }
  if (parts[0] !== "media") return null;
  if ((parts[1] === "uploads" || parts[1] === "generated") && parts.length === 3 && FLAT_NAME.test(parts[2])) {
    return path.join(...parts);
  }
  if (parts[1] === "generated-audio" && parts.length === 4 && AUDIO_FOLDER.test(parts[2]) && AUDIO_NAME.test(parts[3])) {
    return path.join(...parts);
  }
  return null;
}

async function freeBytes(dir: string): Promise<number> {
  try {
    const stats = await fs.promises.statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function stagingDir(): string {
  return path.join(worldTransferDir(), "incoming");
}

function ownerOf(db: SqliteDatabase): { id: string; username: string } | undefined {
  return db.prepare(`SELECT id, username FROM users WHERE is_admin = 1 ORDER BY created_at, rowid LIMIT 1`).get() as
    | { id: string; username: string }
    | undefined;
}

async function runCheck(job: WorldJob, name: string): Promise<WorldPreview> {
  const dir = worldTransferDir();
  const archive = path.join(dir, name);
  if (!fs.existsSync(archive)) throw new WorldArchiveError("The picked file did not arrive. Try again.", 404);
  const stage = stagingDir();
  await fs.promises.rm(stage, { recursive: true, force: true });
  await fs.promises.mkdir(stage, { recursive: true });
  let manifest: Manifest | null = null;
  const expected = new Map<string, ManifestFile>();
  const seen = new Set<string>();
  job.phase = "Opening the archive";
  try {
    for await (const entry of readTarGz(archive)) {
      if (!manifest) {
        if (entry.name !== "manifest.json" || entry.size > MANIFEST_MAX_BYTES) {
          throw new WorldArchiveError("This is not an Open Game Master world archive.");
        }
        const chunks: Buffer[] = [];
        for await (const chunk of entry.stream) chunks.push(chunk as Buffer);
        manifest = parseManifest(Buffer.concat(chunks).toString("utf8"));
        for (const file of manifest.files) expected.set(file.name, file);
        const need = manifest.files.reduce((sum, file) => sum + file.size, 0) * 2 + 64 * 1024 * 1024;
        if ((await freeBytes(dir)) < need) {
          throw new WorldArchiveError(`This world needs about ${Math.ceil(need / 1024 ** 2)} MB free on this device to import.`, 507);
        }
        continue;
      }
      const listed = expected.get(entry.name);
      const relative = stagedRelative(entry.name);
      if (!listed || !relative || seen.has(entry.name) || entry.size !== listed.size) {
        throw new WorldArchiveError("The archive does not match its own manifest.");
      }
      const target = path.join(stage, relative);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const hash = createHash("sha256");
      await pipeline(
        entry.stream,
        new Transform({
          transform(chunk, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
          },
        }),
        fs.createWriteStream(target),
      );
      if (hash.digest("hex") !== listed.sha256) {
        throw new WorldArchiveError(`${entry.name} is damaged: its fingerprint does not match.`);
      }
      seen.add(entry.name);
      job.phase = `Checking ${seen.size} of ${expected.size} files`;
    }
    if (!manifest) throw new WorldArchiveError("This is not an Open Game Master world archive.");
    if (seen.size !== expected.size) throw new WorldArchiveError("The archive is missing files its manifest lists.");
    const ours = currentBuild().version;
    if (manifest.serverVersion && ours && compareVersions(manifest.serverVersion, ours) > 0) {
      throw new WorldArchiveError(
        `This world was saved by a newer Open Game Master (${manifest.serverVersion}). Update the app, then import it.`,
        409,
      );
    }
    job.phase = "Opening the database";
    const db = openDatabase(path.join(stage, "world.sqlite"));
    try {
      if (!integrityOk(db) || !hasTable(db, "users") || !hasTable(db, "campaigns")) {
        throw new WorldArchiveError("The archive's database is damaged.");
      }
      const owner = ownerOf(db);
      if (!owner) throw new WorldArchiveError("The archive's world has no owner account.");
      const counts = countsOf(db, seen.size - 1);
      if (counts.campaigns !== manifest.counts?.campaigns || counts.users !== manifest.counts?.users) {
        throw new WorldArchiveError("The archive's database does not match its manifest.");
      }
      return { name, serverVersion: manifest.serverVersion, createdAt: manifest.createdAt, owner: owner.username, counts };
    } finally {
      db.close();
    }
  } catch (error) {
    await fs.promises.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export function startWorldCheck(name: string): WorldJob {
  if (!IMPORT_NAME.test(name)) throw new WorldArchiveError("That is not a staged import.");
  const job = beginJob("check");
  runCheck(job, name)
    .then((preview) => {
      job.preview = preview;
      job.phase = "Ready";
    })
    .catch((error) => {
      job.error = error instanceof Error ? error.message : "The archive could not be checked.";
      if (!(error instanceof WorldArchiveError)) console.error("[world-archive] check failed", error);
    })
    .finally(() => {
      job.done = true;
    });
  return job;
}

async function move(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.promises.cp(from, to, { recursive: true });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
}

const exists = (target: string) => {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
};

// Replaces the live world with the checked one. Synchronous from the
// caller's side: when it answers, the files are in place and the server has
// stopped taking play until it is restarted (src/lib/maintenance.ts).
export async function commitWorldImport(name: string, ownerPassword: string): Promise<{ owner: string }> {
  const job = currentWorldJob();
  if (!job || job.kind !== "check" || !job.done || !job.preview || job.preview.name !== name) {
    throw new WorldArchiveError("Check the archive first.", 409);
  }
  if (typeof ownerPassword !== "string" || ownerPassword.length < 16 || ownerPassword.length > 200) {
    throw new WorldArchiveError("The app's password for the owner is missing.");
  }
  const dir = worldTransferDir();
  const stage = stagingDir();
  const staged = path.join(stage, "world.sqlite");
  if (!fs.existsSync(staged)) throw new WorldArchiveError("The checked archive is gone. Pick it again.", 409);
  const encrypted = getDatabase().encrypted;
  const hash = await hashPassword(ownerPassword);

  const db = openDatabase(staged);
  let owner: { id: string; username: string } | undefined;
  try {
    owner = ownerOf(db);
    if (!owner) throw new WorldArchiveError("The archive's world has no owner account.");
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`).run(hash, owner.id);
    if (db.encrypted && encrypted) {
      db.pragma("cipher='chacha20'");
      db.pragma(`rekey='${quoted(databaseKey())}'`);
    }
  } finally {
    db.close();
  }
  const reopened = openStaged(staged, encrypted);
  try {
    if (!integrityOk(reopened)) throw new WorldArchiveError("The re-keyed database failed its integrity check.", 500);
  } finally {
    reopened.close();
  }

  // The swap. Every step is recorded so a failure part way puts each piece
  // back where it was.
  const previous = path.join(dir, "previous");
  await fs.promises.rm(previous, { recursive: true, force: true });
  await fs.promises.mkdir(path.join(previous, "media"), { recursive: true });
  const live = databaseFilePath();
  const done: Array<[from: string, to: string]> = [];
  const step = async (from: string, to: string) => {
    await move(from, to);
    done.push([from, to]);
  };
  enterMaintenance("world import");
  closeDatabaseForRestore();
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (exists(`${live}${suffix}`)) await step(`${live}${suffix}`, path.join(previous, `world.sqlite${suffix}`));
    }
    await step(staged, live);
    for (const root of MEDIA_ROOTS) {
      if (exists(publicDir(root))) await step(publicDir(root), path.join(previous, "media", root));
      const incoming = path.join(stage, "media", root);
      if (exists(incoming)) await step(incoming, publicDir(root));
      else await fs.promises.mkdir(publicDir(root), { recursive: true });
    }
    // The installed world packs go the same way as the media: the archive's
    // replace this world's, which wait in previous/ beside its database.
    await fs.promises.mkdir(path.dirname(INSTALLED_DIR), { recursive: true });
    if (exists(INSTALLED_DIR)) await step(INSTALLED_DIR, path.join(previous, "worlds"));
    const packs = path.join(stage, "worlds");
    if (exists(packs)) await step(packs, INSTALLED_DIR);
  } catch (error) {
    for (const [from, to] of done.reverse()) {
      await move(to, from).catch((undo) => console.error("[world-archive] could not undo a step", undo));
    }
    console.error("[world-archive] import swap failed; the previous world is back in place", error);
    throw new WorldArchiveError("The world could not be swapped in; the previous one is back in place. Restart the app.", 500);
  } finally {
    // Whatever is on disk now, the loader's memory of the packs is stale.
    resetWorldPackCache();
  }
  await fs.promises.rm(stage, { recursive: true, force: true });
  await fs.promises.rm(path.join(dir, name), { force: true });
  globalThis.__odmWorldJob = undefined;
  return { owner: owner.username };
}

// Drops whatever is staged: an export the app has copied out, or an import
// the person decided against.
export async function discardWorldTransfer(): Promise<void> {
  const job = currentWorldJob();
  if (job && !job.done) throw new WorldArchiveError("Wait for the world to finish packing or checking.", 409);
  const dir = worldTransferDir();
  await clearStaged(dir, /^(odm-world-.*\.tar\.gz|export-.*\.sqlite|import-.*\.tar\.gz|incoming)$/);
  globalThis.__odmWorldJob = undefined;
}
