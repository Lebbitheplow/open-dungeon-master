// One-time migration: encrypt an existing plaintext local-roleplay.sqlite in place.
// Usage: stop the server, ensure DB_ENCRYPTION_KEY is in .env.server, then
//   node scripts/migrate-encrypt-db.mjs
import Database from "better-sqlite3-multiple-ciphers";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { serverEnv } from "../src/lib/server-env.ts";

const dbPath =
  process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "local-roleplay.sqlite");

function fail(message) {
  console.error(`[migrate-encrypt-db] ${message}`);
  process.exit(1);
}

const key = serverEnv("DB_ENCRYPTION_KEY");
if (!key) {
  fail(
    "DB_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`, add it to .env.server, then rerun.",
  );
}

if (!existsSync(dbPath)) {
  console.log(
    `[migrate-encrypt-db] No database at ${dbPath}. Nothing to migrate; the app will create an encrypted database on first run.`,
  );
  process.exit(0);
}

// Probe: an already-encrypted database is unreadable without a key.
{
  const probe = new Database(dbPath);
  try {
    probe.prepare("SELECT count(*) AS n FROM sqlite_master").get();
  } catch (error) {
    probe.close();
    if (error?.code === "SQLITE_NOTADB") {
      console.log("[migrate-encrypt-db] Database is already encrypted. Nothing to do.");
      process.exit(0);
    }
    throw error;
  }
  probe.close();
}

for (const suffix of ["", "-wal", "-shm"]) {
  const source = `${dbPath}${suffix}`;
  if (existsSync(source)) {
    copyFileSync(source, `${source}.pre-encryption.bak`);
  }
}
console.log(`[migrate-encrypt-db] Backup written to ${dbPath}.pre-encryption.bak`);

const db = new Database(dbPath);
try {
  // Rekey is not permitted under WAL; fold the WAL into the main file first.
  // journal_mode=DELETE throws SQLITE_BUSY if the server still has the DB open.
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("journal_mode = DELETE");
} catch (error) {
  db.close();
  if (String(error?.code || "").startsWith("SQLITE_BUSY")) {
    fail("Database is in use. Stop the server (systemctl --user stop open-dungeon-master) and rerun.");
  }
  throw error;
}

db.pragma("cipher='chacha20'");
db.pragma(`rekey='${key.replaceAll("'", "''")}'`);
db.close();

const check = new Database(dbPath);
check.pragma("cipher='chacha20'");
check.pragma(`key='${key.replaceAll("'", "''")}'`);
const integrity = check.pragma("integrity_check", { simple: true });
const campaigns = check.prepare("SELECT count(*) AS n FROM campaigns").get();
const users = check.prepare("SELECT count(*) AS n FROM users").get();
check.close();

if (integrity !== "ok") {
  fail(`Integrity check failed after encryption: ${integrity}. Restore from the .pre-encryption.bak files.`);
}

console.log(
  `[migrate-encrypt-db] Done. Integrity ok; ${campaigns.n} campaigns and ${users.n} users readable with the key.`,
);
console.log(
  "[migrate-encrypt-db] Keep the .pre-encryption.bak files until you have verified a play session, then delete them.",
);
