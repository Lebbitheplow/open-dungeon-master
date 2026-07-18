import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

// The Open5e content pack is a separate READ-ONLY SQLite built by
// scripts/import-open5e.mjs. Keeping it out of the app database means it
// never contends with the single-writer game DB and never ships to the
// client. A missing pack degrades gracefully: accessors return empty
// results and the UI falls back to the bundled SRD data.

declare global {
  var __odmContentDb: Database.Database | null | undefined;
}

const contentDbPath =
  process.env.CONTENT_DB_PATH || path.join(process.cwd(), "data", "content", "open5e.sqlite");

export function getContentDb(): Database.Database | null {
  if (globalThis.__odmContentDb !== undefined) {
    return globalThis.__odmContentDb;
  }
  if (!existsSync(contentDbPath)) {
    globalThis.__odmContentDb = null;
    return null;
  }
  const db = new Database(contentDbPath, { readonly: true, fileMustExist: true });
  globalThis.__odmContentDb = db;
  return db;
}

export function contentPackInstalled() {
  return getContentDb() !== null;
}
