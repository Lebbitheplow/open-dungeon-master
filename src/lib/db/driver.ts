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

// Both engines load lazily and synchronously (the database opens inside
// synchronous accessors), and the native one must be allowed to fail, so a
// real require does the work in both the ESM test runner and Next's bundle.
const localRequire = createRequire(import.meta.url);

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
  resolvedEngine = loadNative() ? "native" : "node";
  return resolvedEngine;
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

export function sqliteEngine(): Engine {
  return chooseEngine();
}

export function openDatabase(file: string, options: OpenOptions = {}): SqliteDatabase {
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
  return {
    engine: "native",
    encrypted: true,
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => {
      db.exec(sql);
    },
    pragma: (source) => db.pragma(source),
    transaction: (fn) => db.transaction(fn),
    close: () => {
      db.close();
    },
  };
}

function openNode(file: string, options: OpenOptions): SqliteDatabase {
  const { DatabaseSync } = localRequire("node:sqlite") as typeof import("node:sqlite");
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
  return {
    engine: "node",
    encrypted: false,
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...params) => {
          const result = statement.run(...(params as never[]));
          return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
        },
        get: (...params) => statement.get(...(params as never[])),
        all: (...params) => statement.all(...(params as never[])),
      };
    },
    exec: (sql) => {
      db.exec(sql);
    },
    // Cipher and key pragmas are extensions of the native build; plain
    // SQLite ignores pragmas it does not know, so they simply do nothing.
    pragma: (source) => db.prepare(`PRAGMA ${source}`).all(),
    transaction,
    close: () => {
      db.close();
    },
  };
}
