import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(process.env.ODM_ROOT || scriptRoot);
const args = process.argv.slice(2);
const live = args.includes("--live");
const positional = args.filter((arg) => arg !== "--live");
const [archiveArg, targetArg] = positional;
const appPort = Number.parseInt(process.env.PORT || "3005", 10);

function fail(message) {
  console.error(`[odm-restore] ${message}`);
  process.exit(1);
}

async function portInUse(port) {
  return await new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function envValue(file, key) {
  if (!fs.existsSync(file)) return "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return fs.readFileSync(file, "utf8").match(new RegExp(`^${escaped}=(.*)$`, "m"))?.[1]?.trim() || "";
}

function assertSafeArchive(archive) {
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  for (const raw of listing.split(/\r?\n/)) {
    const entry = raw.trim().replace(/^\.\//, "");
    if (!entry) continue;
    if (path.posix.isAbsolute(entry) || entry.split("/").includes("..")) {
      fail(`archive contains an unsafe path: ${raw}`);
    }
  }
}

function keyForStage(stage) {
  const fromEnv = envValue(path.join(stage, ".env.server"), "DB_ENCRYPTION_KEY");
  if (fromEnv) return fromEnv;
  const dockerKey = path.join(stage, "data", ".db-key");
  return fs.existsSync(dockerKey) ? fs.readFileSync(dockerKey, "utf8").trim() : "";
}

if (!archiveArg) {
  console.error("usage: node scripts/odm-restore.mjs <archive.tar.gz> [targetDir] [--live]");
  process.exit(2);
}
const archive = path.resolve(archiveArg);
if (!fs.existsSync(archive)) fail(`archive not found: ${archive}`);
if (live && targetArg) fail("do not pass targetDir with --live; the live ODM root is the target");
if (!live && !targetArg) fail("targetDir is required for a dry-run restore");
if (live && (await portInUse(appPort))) fail(`the app is listening on :${appPort}; stop it before a live restore`);

assertSafeArchive(archive);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "odm-restore-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", stage], { stdio: "pipe" });
  const manifestPath = path.join(stage, "odm-backup.json");
  if (!fs.existsSync(manifestPath)) fail("archive is missing odm-backup.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== 1 || typeof manifest.database !== "string") fail("unsupported backup manifest");
  const dbPath = path.resolve(stage, manifest.database);
  const relative = path.relative(stage, dbPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("backup manifest points outside the restored tree");
  if (!fs.existsSync(dbPath)) fail(`restored database is missing: ${manifest.database}`);

  const key = keyForStage(stage);
  if (!key) fail("backup does not contain a database encryption key");
  const Database = (await import("better-sqlite3-multiple-ciphers")).default;
  const db = new Database(dbPath, { readonly: true });
  let proof;
  try {
    db.pragma("cipher='chacha20'");
    db.pragma(`key='${key.replaceAll("'", "''")}'`);
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") fail(`restored database integrity check failed: ${integrity}`);
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    proof = { campaigns: count("campaigns"), users: count("users"), messages: count("campaign_messages") };
  } finally {
    db.close();
  }

  const target = live ? root : path.resolve(targetArg);
  if (!live && fs.existsSync(target) && fs.readdirSync(target).length) {
    fail(`target directory is not empty: ${target}`);
  }
  fs.mkdirSync(target, { recursive: true });

  const managed = [...new Set([...(Array.isArray(manifest.includes) ? manifest.includes : []), "odm-backup.json"])];
  for (const rel of managed) {
    const src = path.join(stage, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(target, rel);
    if (live) fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
  }

  console.log(`restore OK into ${target}`);
  console.log(`proof: integrity=ok campaigns=${proof.campaigns} users=${proof.users} messages=${proof.messages}`);
  if (!live) console.log("dry-run restore; the live campaign was not touched");
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
