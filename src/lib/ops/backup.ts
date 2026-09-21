import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serverEnv } from "@/lib/server-env";

// Server-side twin of scripts/odm-backup.mjs and scripts/odm-restore.mjs.
// The CLI refuses to run while the app is listening, because it checkpoints
// the live WAL in place; the in-app backup takes a `VACUUM INTO` snapshot
// instead, which SQLite guarantees consistent even with writers active. The
// archives are interchangeable: same manifest format, same include list, and
// the CLI restore verifies the same integrity proof before touching files.

export type BackupEntry = {
  name: string;
  sizeBytes: number;
  createdAt: string;
  sha256: string;
};

export type RestoreProof = {
  campaigns: number;
  users: number;
  messages: number;
};

const ARCHIVE_RE = /^odm-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.tar\.gz$/;

// A failure the route should answer with a specific status (a missing or
// corrupt archive is a 4xx, not a server fault).
export class BackupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// The persistent state tree, identical to the CLI's include list.
const INCLUDES = [
  "data",
  "public/uploads",
  "public/generated",
  "public/generated-audio",
  "models",
  ".env.server",
];

function root() {
  return process.cwd();
}

export function backupDir(): string {
  return path.resolve(serverEnv("ODM_BACKUP_DIR") || path.join(os.homedir(), "odm-backups"));
}

function dbPath(): string {
  return path.resolve(serverEnv("SQLITE_DB_PATH") || path.join(root(), "data", "local-roleplay.sqlite"));
}

// Archives are the size of the whole state tree and can pass 2 GiB, where
// readFileSync throws ERR_FS_FILE_TOO_LARGE; hash over a stream instead.
async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function envValue(file: string, key: string): string {
  if (!fs.existsSync(file)) return "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return fs.readFileSync(file, "utf8").match(new RegExp(`^${escaped}=(.*)$`, "m"))?.[1]?.trim() || "";
}

function encryptionKey(): string {
  const fromEnv = serverEnv("DB_ENCRYPTION_KEY").trim();
  if (fromEnv) return fromEnv;
  const dockerKey = path.join(root(), "data", ".db-key");
  return fs.existsSync(dockerKey) ? fs.readFileSync(dockerKey, "utf8").trim() : "";
}

// Only ever touch archives we named: a strict name plus a containment check,
// so no request can walk out of the backup directory.
export function resolveArchive(name: string): string | null {
  if (!ARCHIVE_RE.test(name)) return null;
  const archive = path.resolve(backupDir(), name);
  if (path.dirname(archive) !== backupDir()) return null;
  return fs.existsSync(archive) ? archive : null;
}

export function listBackups(): BackupEntry[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => ARCHIVE_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      let sha256 = "";
      try {
        sha256 = fs.readFileSync(`${path.join(dir, name)}.sha256`, "utf8").trim();
      } catch {
        // Archives made by the CLI carry no sidecar; the UI shows its hash only after a verify.
      }
      return { name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString(), sha256 };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(): Promise<BackupEntry> {
  const appRoot = root();
  const db = dbPath();
  const relativeDb = path.relative(appRoot, db);
  if (!relativeDb || relativeDb.startsWith("..") || path.isAbsolute(relativeDb)) {
    throw new Error("SQLITE_DB_PATH must live under the app root for a portable backup.");
  }
  if (!fs.existsSync(db)) {
    throw new Error(`database not found: ${db}`);
  }

  // A consistent copy while the server keeps playing: VACUUM INTO writes a
  // snapshot from a read transaction, WAL included, without pausing writers.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "odm-backup-"));
  try {
    const snapshot = path.join(stage, "snapshot.sqlite");
    const Database = (await import("better-sqlite3-multiple-ciphers")).default;
    const handle = new Database(db, { readonly: true });
    try {
      const key = encryptionKey();
      if (key) {
        handle.pragma("cipher='chacha20'");
        handle.pragma(`key='${key.replaceAll("'", "''")}'`);
      }
      handle.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
    } finally {
      handle.close();
    }

    for (const rel of INCLUDES) {
      const src = path.join(appRoot, rel);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(stage, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      // WAL/SHM sidecars belong to the live database, not to the VACUUM INTO
      // snapshot that replaces it; shipping them makes the archive corrupt.
      fs.cpSync(src, dst, { recursive: true, filter: (s) => !/-(?:wal|shm)$/.test(s) });
    }
    const stagedDb = path.join(stage, relativeDb);
    fs.mkdirSync(path.dirname(stagedDb), { recursive: true });
    fs.rmSync(stagedDb, { force: true });
    fs.renameSync(snapshot, stagedDb);

    const createdAt = new Date();
    const manifest = {
      format: 1,
      createdAt: createdAt.toISOString(),
      database: relativeDb.replaceAll(path.sep, "/"),
      includes: INCLUDES.filter((rel) => fs.existsSync(path.join(appRoot, rel))),
      source: "app",
    };
    fs.writeFileSync(path.join(stage, "odm-backup.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });

    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // chmod is best-effort on Windows.
    }

    const stamp = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = `odm-backup-${stamp}.tar.gz`;
    const archive = path.join(dir, name);
    execFileSync("tar", ["-czf", archive, "-C", stage, "."], { stdio: "pipe" });

    const sha256 = await hashFile(archive);
    fs.writeFileSync(`${archive}.sha256`, `${sha256}\n`, { mode: 0o600 });

    return { name, sizeBytes: fs.statSync(archive).size, createdAt: createdAt.toISOString(), sha256 };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export function deleteBackup(name: string): boolean {
  const archive = resolveArchive(name);
  if (!archive) return false;
  fs.rmSync(archive, { force: true });
  fs.rmSync(`${archive}.sha256`, { force: true });
  return true;
}

// The CLI restore's proof, run before any live file is touched: reject
// traversal paths, open the encrypted database with the archived key, run
// PRAGMA integrity_check and count the campaign tables.
export async function verifyBackup(name: string): Promise<{ proof: RestoreProof; sha256: string }> {
  const archive = resolveArchive(name);
  if (!archive) {
    throw new BackupError("No such backup archive.", 404);
  }

  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  for (const raw of listing.split(/\r?\n/)) {
    const entry = raw.trim().replace(/^\.\//, "");
    if (!entry) continue;
    if (path.posix.isAbsolute(entry) || entry.split("/").includes("..")) {
      throw new Error(`archive contains an unsafe path: ${raw}`);
    }
  }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "odm-restore-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", stage], { stdio: "pipe" });
    const manifestPath = path.join(stage, "odm-backup.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("archive is missing odm-backup.json");
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      format?: number;
      database?: string;
    };
    if (manifest.format !== 1 || typeof manifest.database !== "string") {
      throw new Error("unsupported backup manifest");
    }
    const dbInStage = path.resolve(stage, manifest.database);
    const relative = path.relative(stage, dbInStage);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("backup manifest points outside the restored tree");
    }
    if (!fs.existsSync(dbInStage)) {
      throw new Error("restored database is missing from the archive");
    }
    // Archives made before sidecars were excluded could carry a WAL that does
    // not belong to the snapshot; SQLite would call that corruption.
    fs.rmSync(`${dbInStage}-wal`, { force: true });
    fs.rmSync(`${dbInStage}-shm`, { force: true });

    // Prefer the key the archive carries (it matches the archive's data);
    // fall back to this server's key for archives made without one.
    const key =
      envValue(path.join(stage, ".env.server"), "DB_ENCRYPTION_KEY") ||
      (fs.existsSync(path.join(stage, "data", ".db-key"))
        ? fs.readFileSync(path.join(stage, "data", ".db-key"), "utf8").trim()
        : "") ||
      encryptionKey();

    const Database = (await import("better-sqlite3-multiple-ciphers")).default;
    const db = new Database(dbInStage, { readonly: true });
    try {
      if (key) {
        db.pragma("cipher='chacha20'");
        db.pragma(`key='${key.replaceAll("'", "''")}'`);
      }
      const integrity = db.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") {
        throw new Error(`restored database integrity check failed: ${integrity}`);
      }
      const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      const proof: RestoreProof = {
        campaigns: count("campaigns"),
        users: count("users"),
        messages: count("campaign_messages"),
      };
      const sha256 = await hashFile(archive);
      return { proof, sha256 };
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// Replace the live state with a verified archive. The running server keeps
// its open handle on the old database until it restarts, so callers must say
// so loudly; the stale WAL/SHM sidecars go with the file they belong to.
export async function restoreBackup(name: string): Promise<{ proof: RestoreProof }> {
  const { proof } = await verifyBackup(name);
  const archive = resolveArchive(name);
  if (!archive) {
    throw new BackupError("No such backup archive.", 404);
  }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "odm-restore-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", stage], { stdio: "pipe" });
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, "odm-backup.json"), "utf8")) as {
      includes?: string[];
    };
    const managed = [...new Set([...(Array.isArray(manifest.includes) ? manifest.includes : []), "odm-backup.json"])];
    for (const rel of managed) {
      const src = path.join(stage, rel);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(root(), rel);
      fs.rmSync(dst, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(src, dst, { recursive: true });
    }
    // The sidecars belong to the database file that was just replaced; the
    // live handle recreates its own, and a restart opens a fresh pair.
    const db = dbPath();
    fs.rmSync(`${db}-wal`, { force: true });
    fs.rmSync(`${db}-shm`, { force: true });
    return { proof };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
