import { openDatabase, type SqliteDatabase } from "@/lib/db/driver";
import { EDITION_2024_DOCUMENTS } from "@/lib/content/edition";
import { packFeatText } from "@/lib/srd/feat-text";
import { registerFeatRules } from "@/lib/srd/feature-effects";
import { existsSync } from "node:fs";
import path from "node:path";

// The Open5e content pack is a separate READ-ONLY SQLite built by
// scripts/import-open5e.mjs. Keeping it out of the app database means it
// never contends with the single-writer game DB and never ships to the
// client. A missing pack degrades gracefully: accessors return empty
// results and the UI falls back to the bundled SRD data.

declare global {
  var __odmContentDb: SqliteDatabase | null | undefined;
}

const contentDbPath =
  process.env.CONTENT_DB_PATH || path.join(process.cwd(), "data", "content", "open5e.sqlite");

export function getContentDb(): SqliteDatabase | null {
  if (globalThis.__odmContentDb !== undefined) {
    return globalThis.__odmContentDb;
  }
  if (!existsSync(/*turbopackIgnore: true*/ contentDbPath)) {
    globalThis.__odmContentDb = null;
    return null;
  }
  const db = openDatabase(contentDbPath, { readonly: true, fileMustExist: true });
  globalThis.__odmContentDb = db;
  registerPackFeats(db);
  return db;
}

// The pack's 2014 feats reach the engines the way ODM's own do (issue
// #147, src/lib/srd/feature-effects.ts registerFeatRules): their speed,
// initiative and passive bonuses, their resistances, and their text as the
// guidance the prompt shows. The 2024 rows are left out (their numbers are
// not the engine's); ODM's own rows are already in.
function registerPackFeats(db: SqliteDatabase): void {
  try {
    const editions = [...EDITION_2024_DOCUMENTS, "odm-expanded"];
    const rows = db
      .prepare(`SELECT name, data_json FROM feats WHERE document_slug NOT IN (${editions.map(() => "?").join(", ")})`)
      .all(...editions) as Array<{ name: string; data_json: string }>;
    for (const row of rows) {
      try {
        registerFeatRules(row.name, packFeatText(JSON.parse(row.data_json) as Record<string, unknown>).desc);
      } catch {
        // A row that does not parse grants nothing here.
      }
    }
  } catch {
    // An older pack without a feats table serves no feats either.
  }
}

export function contentPackInstalled() {
  return getContentDb() !== null;
}
