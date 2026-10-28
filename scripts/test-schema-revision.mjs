// The database records the schema revision of the newest server that opened
// it (SQLite's user_version, src/lib/db/core.ts SCHEMA_REVISION). A server
// handed a database from a newer revision refuses it before writing a byte,
// instead of running its schema sync over tables it does not understand.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "odm-schema-revision-"));
const dbFile = path.join(root, "data", "local-roleplay.sqlite");
process.env.SQLITE_DB_PATH = dbFile;
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(root);
register("./lib/register-alias.mjs", import.meta.url);

const { closeDatabaseForRestore, getDatabase, SCHEMA_REVISION } = await import("../src/lib/db/core.ts");

const revisionOf = (db) => Number(db.pragma("user_version")[0].user_version);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("a new database is stamped with this server's revision", () => {
  assert.ok(SCHEMA_REVISION >= 1);
  assert.equal(revisionOf(getDatabase()), SCHEMA_REVISION);
});

test("a database from before the revision existed is stamped on open", () => {
  getDatabase().pragma("user_version = 0");
  closeDatabaseForRestore();
  assert.equal(revisionOf(getDatabase()), SCHEMA_REVISION);
});

test("a database from a newer revision is refused, and left as it was", () => {
  const db = getDatabase();
  db.exec("CREATE TABLE IF NOT EXISTS from_the_future (id TEXT)");
  db.pragma(`user_version = ${SCHEMA_REVISION + 1}`);
  db.pragma("wal_checkpoint(TRUNCATE)");
  closeDatabaseForRestore();
  const before = fs.readFileSync(dbFile);
  const refusal = `newer version of Open Game Master (database revision ${SCHEMA_REVISION + 1}; this version reads up to ${SCHEMA_REVISION})`;
  assert.throws(() => getDatabase(), (error) => error.message.includes(refusal));
  assert.ok(before.equals(fs.readFileSync(dbFile)), "the file was not written");
  // Still refused on the next request, not half open.
  assert.throws(() => getDatabase(), /newer version/);
});

removeTempDir(root);
console.log(`\n${passed} schema revision tests passed.`);
