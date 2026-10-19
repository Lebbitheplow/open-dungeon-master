// The one place SQLite is opened. Two engines sit behind the same small
// interface:
//
//  - better-sqlite3-multiple-ciphers, the native module every desktop and
//    server install ships, which also encrypts the game database at rest.
//  - Node's built-in node:sqlite, for hosts where no native module can be
//    loaded: the Android app runs the server on a Node built for the phone,
//    where the addon does not exist. SQLite there is plain (no cipher).
//
// The app only ever uses prepare/run/get/all, exec, pragma, transaction and
// close, so that is the whole contract. ODM_SQLITE_DRIVER=node|native forces
// an engine; otherwise native is tried first and node:sqlite is the fallback.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { StatementCache } from "@/lib/db/statement-cache";

// Both engines load lazily and synchronously (the database opens inside
// synchronous accessors), and the native one must be allowed to fail, so a
// real require does the work in both the ESM test runner and Next's bundle.
// The built-in engine goes through process.getBuiltinModule instead: the
// bundler rewrites createRequire and its rewrite cannot resolve node: ids.
const localRequire = createRequire(import.meta.url);

type NodeSqlite = typeof import("node:sqlite");

function loadNodeSqlite(): NodeSqlite | null {
  const getBuiltinModule = (
    process as { getBuiltinModule?: (id: string) => unknown }
  ).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") return null;
  try {
    return (getBuiltinModule.call(process, "node:sqlite") as NodeSqlite | undefined) ?? null;
  } catch {
    return null;
  }
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(source: string): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
  // Which engine opened the file, and whether cipher/key pragmas mean
  // anything on it. The core module warns when a key was requested but the
  // engine cannot honor it.
  readonly engine: "native" | "node";
  readonly encrypted: boolean;
}

export interface OpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

type Engine = "native" | "node";

// Resolved once per process; the choice never changes at runtime.
let resolvedEngine: Engine | null = null;

function chooseEngine(): Engine {
  if (resolvedEngine) return resolvedEngine;
  const forced = process.env.ODM_SQLITE_DRIVER;
  if (forced === "node" || forced === "native") {
    resolvedEngine = forced;
    return forced;
  }
  resolvedEngine = nativeOpens() ? "native" : "node";
  return resolvedEngine;
}

// The package can load while its compiled part cannot (installed with
// --ignore-scripts, or built for another Node): better-sqlite3 looks for its
// binary only when a database opens, so a loaded module alone proved nothing
// and such a host crashed on its first open instead of falling back. One
// database in memory, opened and closed, proves the engine.
function nativeOpens(): boolean {
  const Native = loadNative();
  if (!Native) return false;
  try {
    new Native(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

type NativeModule = typeof import("better-sqlite3-multiple-ciphers");

let nativeModule: NativeModule | null | undefined;

function loadNative(): NativeModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    // On a host without the addon this throws and the built-in engine
    // takes over.
    nativeModule = localRequire("better-sqlite3-multiple-ciphers") as NativeModule;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

// How many writes so far could have given a picture or a document a new
// reader: a write whose values name a stored file, or one that copies rows
// (INSERT ... SELECT, a clone or an import). src/lib/media-access.ts keeps
// its who-may-see-what sets until this moves.
let mediaWrites = 0;

export function mediaWriteCount(): number {
  return mediaWrites;
}

// Bumped by every open: a restore swaps the whole file underneath, which no
// write the counter above sees.
let opens = 0;

export function databaseOpenCount(): number {
  return opens;
}

const WRITE_SQL = /^\s*(?:INSERT|UPDATE|REPLACE)\b/i;
const COPY_SQL = /\bSELECT\b/i;

function namesMedia(value: unknown): boolean {
  return typeof value === "string" && (value.includes("/uploads/") || value.includes("/generated/"));
}

function mentionsMedia(params: unknown[]): boolean {
  for (const param of params) {
    if (namesMedia(param)) return true;
    if (param && typeof param === "object" && !ArrayBuffer.isView(param)) {
      for (const value of Object.values(param)) {
        if (namesMedia(value)) return true;
      }
    }
  }
  return false;
}

function watchWrites(sql: string, statement: SqliteStatement): SqliteStatement {
  if (!WRITE_SQL.test(sql)) return statement;
  const copies = COPY_SQL.test(sql);
  return {
    run: (...params) => {
      const result = statement.run(...params);
      if (copies || mentionsMedia(params)) mediaWrites += 1;
      return result;
    },
    get: (...params) => statement.get(...params),
    all: (...params) => statement.all(...params),
  };
}

export function sqliteEngine(): Engine {
  return chooseEngine();
}

export function openDatabase(file: string, options: OpenOptions = {}): SqliteDatabase {
  opens += 1;
  mediaWrites += 1;
  const engine = chooseEngine();
  if (engine === "native") {
    const Native = loadNative();
    if (!Native) {
      throw new Error("ODM_SQLITE_DRIVER=native but better-sqlite3-multiple-ciphers cannot be loaded.");
    }
    return wrapNative(new Native(file, options));
  }
  return openNode(file, options);
}

function wrapNative(db: import("better-sqlite3-multiple-ciphers").Database): SqliteDatabase {
  // One cache per open database: a statement belongs to the connection that
  // prepared it and must never be handed to another. Schema changes only
  // ever arrive through exec (ensureSchema's CREATE, ALTER and rebuilds), so
  // exec also empties the cache: SQLite re-prepares a stale statement on its
  // own, but node:sqlite reads the column count before the first step, and
  // a SELECT * cached before an ADD COLUMN would miss the new column once.
  const statements = new StatementCache<SqliteStatement>();
  return {
    engine: "native",
    encrypted: true,
    prepare: (sql) => statements.take(sql, (text) => watchWrites(text, db.prepare(text) as SqliteStatement)),
    exec: (sql) => {
      statements.clear();
      db.exec(sql);
    },
    pragma: (source) => db.pragma(source),
    transaction: (fn) => db.transaction(fn),
    close: () => {
      statements.clear();
      db.close();
    },
  };
}

function openNode(file: string, options: OpenOptions): SqliteDatabase {
  const sqlite = loadNodeSqlite();
  if (!sqlite) {
    throw new Error(
      "No SQLite engine: the native module did not load and this Node has no built-in node:sqlite (needs Node 22.13 or newer).",
    );
  }
  const { DatabaseSync } = sqlite;
  if (options.fileMustExist && !existsSync(file)) {
    throw new Error(`Database file not found: ${file}`);
  }
  const db = new DatabaseSync(file, {
    readOnly: Boolean(options.readonly),
    // Matches better-sqlite3: constraints are switched on by the pragma the
    // core module runs, and switched off around schema rebuilds.
    enableForeignKeyConstraints: false,
    // better-sqlite3's default busy timeout.
    timeout: 5000,
  });
  // Nested transactions become savepoints, as they do in better-sqlite3.
  let depth = 0;
  const transaction = <A extends unknown[], R>(fn: (...args: A) => R) => {
    return (...args: A): R => {
      const nested = depth > 0;
      const name = `odm_sp_${depth}`;
      db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN");
      depth += 1;
      try {
        const result = fn(...args);
        db.exec(nested ? `RELEASE ${name}` : "COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : "ROLLBACK");
        } catch {
          // SQLite may already have unwound the transaction on its own.
        }
        throw error;
      } finally {
        depth -= 1;
      }
    };
  };
  const statements = new StatementCache<SqliteStatement>();
  const prepare = (sql: string): SqliteStatement => {
    const statement = db.prepare(sql);
    return {
      run: (...params) => {
        const result = statement.run(...(params as never[]));
        return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
      },
      get: (...params) => statement.get(...(params as never[])),
      all: (...params) => statement.all(...(params as never[])),
    };
  };
  return {
    engine: "node",
    encrypted: false,
    prepare: (sql) => statements.take(sql, (text) => watchWrites(text, prepare(text))),
    // Cleared for the reason given in wrapNative. The transaction wrapper
    // above talks to the raw handle, so BEGIN and COMMIT leave the cache be.
    exec: (sql) => {
      statements.clear();
      db.exec(sql);
    },
    // Cipher and key pragmas are extensions of the native build; plain
    // SQLite ignores pragmas it does not know, so they simply do nothing.
    pragma: (source) => db.prepare(`PRAGMA ${source}`).all(),
    transaction,
    close: () => {
      statements.clear();
      db.close();
    },
  };
}
