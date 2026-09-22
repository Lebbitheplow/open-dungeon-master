// The prepared-statement cache behind both SQLite engine wrappers: the LRU
// itself, and the wrapper on whichever engine this run selects (native by
// default, node:sqlite under ODM_SQLITE_DRIVER=node). Statements must be
// reused per connection, never across connections, and must keep working
// through the schema changes ensureSchema makes at boot.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { StatementCache, DEFAULT_STATEMENT_CACHE_SIZE } = await import(
  "../src/lib/db/statement-cache.ts"
);
const { openDatabase, sqliteEngine } = await import("../src/lib/db/driver.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// ---- the LRU ----

test("the default capacity is a few hundred entries", () => {
  assert.ok(DEFAULT_STATEMENT_CACHE_SIZE >= 200 && DEFAULT_STATEMENT_CACHE_SIZE <= 1000);
});

test("a repeated SQL text gets the same statement back", () => {
  const cache = new StatementCache(4);
  let prepared = 0;
  const make = (sql) => {
    prepared += 1;
    return { sql };
  };
  const first = cache.take("SELECT 1", make);
  const second = cache.take("SELECT 1", make);
  assert.equal(first, second);
  assert.equal(prepared, 1);
  assert.notEqual(cache.take("SELECT 2", make), first);
  assert.equal(prepared, 2);
});

test("the least recently used entry is the one evicted", () => {
  const cache = new StatementCache(2);
  const make = (sql) => ({ sql });
  cache.take("a", make);
  cache.take("b", make);
  // Touch a so b is the stale one.
  cache.take("a", make);
  cache.take("c", make);
  assert.equal(cache.size, 2);
  assert.ok(cache.has("a"));
  assert.ok(cache.has("c"));
  assert.ok(!cache.has("b"));
});

test("clear empties the cache", () => {
  const cache = new StatementCache(2);
  cache.take("a", (sql) => ({ sql }));
  cache.clear();
  assert.equal(cache.size, 0);
});

test("a capacity below one is refused", () => {
  assert.throws(() => new StatementCache(0));
});

// ---- the wrappers on the selected engine ----

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-stmt-cache-"));
const file = path.join(dir, "cache.sqlite");
const db = openDatabase(file);
console.log(`engine under test: ${sqliteEngine()}`);

test("the wrapper reuses a statement for the same SQL", () => {
  db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO things (name) VALUES (?)");
  assert.equal(db.prepare("INSERT INTO things (name) VALUES (?)"), insert);
  insert.run("one");
  insert.run("two");
  const count = db.prepare("SELECT count(*) AS n FROM things").get();
  assert.equal(count.n, 2);
});

test("a SELECT * cached before an ADD COLUMN sees the new column after it", () => {
  const select = db.prepare("SELECT * FROM things ORDER BY id");
  assert.deepEqual(Object.keys(select.all()[0]), ["id", "name"]);
  db.exec("ALTER TABLE things ADD COLUMN size INTEGER NOT NULL DEFAULT 3");
  // Schema changes go through exec, which empties the cache, so the next
  // prepare is a fresh statement over the new shape.
  const fresh = db.prepare("SELECT * FROM things ORDER BY id");
  assert.notEqual(fresh, select);
  const rows = fresh.all();
  assert.deepEqual(Object.keys(rows[0]), ["id", "name", "size"]);
  assert.equal(rows[0].size, 3);
  // The old handle still runs: SQLite re-prepares it on the next step.
  assert.equal(select.all().length, 2);
});

test("transactions do not empty the cache", () => {
  const count = db.prepare("SELECT count(*) AS n FROM things");
  db.transaction(() => {
    assert.equal(count.get().n, 2);
  })();
  assert.equal(db.prepare("SELECT count(*) AS n FROM things"), count);
});

test("a statement held across its table being dropped and rebuilt still runs", () => {
  const count = db.prepare("SELECT count(*) AS n FROM things");
  assert.equal(count.get().n, 2);
  db.exec("DROP TABLE things");
  assert.throws(() => count.get());
  db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  assert.equal(count.get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM things").get().n, 0);
});

test("a cached statement keeps working inside and after a transaction", () => {
  const insert = db.prepare("INSERT INTO things (name) VALUES (?)");
  const count = db.prepare("SELECT count(*) AS n FROM things");
  db.transaction(() => {
    insert.run("a");
    insert.run("b");
    assert.equal(count.get().n, 2);
  })();
  assert.throws(() =>
    db.transaction(() => {
      insert.run("c");
      throw new Error("undo");
    })(),
  );
  assert.equal(count.get().n, 2);
});

test("two connections do not share statements", () => {
  const otherFile = path.join(dir, "other.sqlite");
  const other = openDatabase(otherFile);
  other.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  const here = db.prepare("SELECT count(*) AS n FROM things");
  const there = other.prepare("SELECT count(*) AS n FROM things");
  assert.notEqual(here, there);
  assert.equal(here.get().n, 2);
  assert.equal(there.get().n, 0);
  other.close();
});

test("closing a connection drops its cache; reopening prepares afresh", () => {
  const before = db.prepare("SELECT count(*) AS n FROM things");
  db.close();
  const reopened = openDatabase(file);
  const after = reopened.prepare("SELECT count(*) AS n FROM things");
  assert.notEqual(before, after);
  assert.equal(after.get().n, 2);
  reopened.close();
});

removeTempDir(dir);
console.log(`\n${passed} statement cache tests passed (${sqliteEngine()}).`);
