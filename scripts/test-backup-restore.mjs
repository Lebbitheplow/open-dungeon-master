import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "odm-backup-test-"));
const backupDir = path.join(root, "backups");
const restoreDir = path.join(root, "restored");
const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

try {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "public", "uploads"), { recursive: true });
  fs.mkdirSync(path.join(root, "models"), { recursive: true });
  fs.writeFileSync(path.join(root, ".env.server"), `DB_ENCRYPTION_KEY=${key}\n`);
  fs.writeFileSync(path.join(root, "public", "uploads", "keep.txt"), "asset survives\n");
  fs.writeFileSync(path.join(root, "models", "keep.Modelfile"), "FROM test\n");

  const dbPath = path.join(root, "data", "local-roleplay.sqlite");
  const db = new Database(dbPath);
  db.pragma("cipher='chacha20'");
  db.pragma(`key='${key}'`);
  db.exec(`
    CREATE TABLE campaigns (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE campaign_messages (id TEXT PRIMARY KEY);
    INSERT INTO campaigns VALUES ('c1');
    INSERT INTO users VALUES ('u1');
    INSERT INTO campaign_messages VALUES ('m1');
  `);
  db.close();

  const backup = spawnSync(process.execPath, [path.join(repo, "scripts", "odm-backup.mjs"), backupDir], {
    cwd: repo,
    env: { ...process.env, ODM_ROOT: root, PORT: "65534" },
    encoding: "utf8",
  });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  const archive = backup.stdout.match(/^backup: (.+?) \(/m)?.[1];
  assert.ok(archive && fs.existsSync(archive), backup.stdout);

  const restore = spawnSync(
    process.execPath,
    [path.join(repo, "scripts", "odm-restore.mjs"), archive, restoreDir],
    { cwd: repo, env: { ...process.env, ODM_ROOT: root, PORT: "65534" }, encoding: "utf8" },
  );
  assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  assert.match(restore.stdout, /integrity=ok campaigns=1 users=1 messages=1/);
  assert.equal(fs.readFileSync(path.join(restoreDir, "public", "uploads", "keep.txt"), "utf8"), "asset survives\n");
  assert.equal(fs.readFileSync(path.join(restoreDir, "models", "keep.Modelfile"), "utf8"), "FROM test\n");

  const restoredDb = new Database(path.join(restoreDir, "data", "local-roleplay.sqlite"), { readonly: true });
  restoredDb.pragma("cipher='chacha20'");
  restoredDb.pragma(`key='${key}'`);
  assert.equal(restoredDb.prepare("SELECT COUNT(*) AS n FROM campaigns").get().n, 1);
  restoredDb.close();

  console.log("backup/restore: verified archive round-trip and encrypted DB integrity");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
