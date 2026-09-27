import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/db/core";
import { VARIANT_WIDTHS, variantFileName } from "@/lib/image-format";
import { isGeneratedImagePath, isUploadedImagePath, isUploadedPdfPath } from "@/lib/uploads";

// The files on disk behind the rows: pictures in public/uploads and
// public/generated, and the PDFs beside them. Deleting a row never deletes
// its file, so whoever deletes rows (a campaign, an account) gathers the
// paths first and hands them here once the rows are gone.
//
// Only our own two folders are ever touched, and only names in the shapes
// the app writes (src/lib/uploads.ts): the built-in art under public/assets,
// public/fx and the rest can never match. Even then a path is only a
// candidate. Portraits are shared by reference when a character or NPC is
// copied between campaigns, and a clone keeps pointing at the original's
// art, so a file is removed only once no text column anywhere names it.

// Anything in a text column that looks like one of our file paths: a
// server-relative path, so not the tail of another site's address. The
// shape checks in src/lib/uploads.ts decide; the pattern only finds
// candidates inside JSON and prose.
const PATH_CANDIDATE = /(?<![A-Za-z0-9_.:/-])\/(?:uploads|generated)\/[A-Za-z0-9_.-]+/g;

export function filePathsIn(text: unknown): string[] {
  if (typeof text !== "string" || !text) {
    return [];
  }
  const found = new Set<string>();
  for (const [candidate] of text.matchAll(PATH_CANDIDATE)) {
    if (isUploadedImagePath(candidate) || isUploadedPdfPath(candidate) || isGeneratedImagePath(candidate)) {
      found.add(candidate);
    }
  }
  return [...found];
}

// The picture columns a campaign's own files are gathered from. Found by
// name so a new picture column is covered the day it is added.
function fileBearingColumns(): Array<[table: string, column: string]> {
  const db = getDatabase();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const columns: Array<[string, string]> = [];
  for (const { name: table } of tables) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
      type: string;
    }>;
    for (const column of info) {
      if (/^TEXT/i.test(column.type) && /_(json|path|url)$/.test(column.name)) {
        columns.push([table, column.name]);
      }
    }
  }
  return columns;
}

// Every file a campaign's rows name: its own row (cover, DM cover) and
// every row that carries its campaign_id (sheets, scene art, maps, NPC and
// faction portraits, lore attachments). Read before the delete, because
// the cascade takes the rows with it.
export function campaignFilePaths(campaignId: string): string[] {
  const db = getDatabase();
  const byTable = new Map<string, string[]>();
  for (const [table, column] of fileBearingColumns()) {
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  const found = new Set<string>();
  for (const [table, columns] of byTable) {
    const key = table === "campaigns" ? "id" : "campaign_id";
    const hasKey = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some(
      (column) => column.name === key,
    );
    if (!hasKey) {
      continue;
    }
    const select = columns.map((column) => `"${column}"`).join(", ");
    const rows = db.prepare(`SELECT ${select} FROM "${table}" WHERE "${key}" = ?`).all(campaignId) as Array<
      Record<string, unknown>
    >;
    for (const row of rows) {
      for (const value of Object.values(row)) {
        for (const url of filePathsIn(value)) {
          found.add(url);
        }
      }
    }
  }
  return [...found];
}

// Every file path any text column anywhere still names: not only the
// picture columns, but prose, settings and anything added later, so a file
// kept alive by some row this module never heard of is still kept. One pass
// per column, narrowed by LIKE to the rows that mention a path at all.
function referencedFiles(): Set<string> {
  const db = getDatabase();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const found = new Set<string>();
  for (const { name: table } of tables) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>;
    for (const { name: column, type } of info) {
      if (type && !/TEXT|CHAR|CLOB|JSON/i.test(type)) {
        continue;
      }
      const rows = db
        .prepare(
          `SELECT "${column}" AS value FROM "${table}"
           WHERE "${column}" LIKE '%/uploads/%' OR "${column}" LIKE '%/generated/%'`,
        )
        .all() as Array<{ value: unknown }>;
      for (const { value } of rows) {
        for (const url of filePathsIn(value)) {
          found.add(url);
        }
      }
    }
  }
  return found;
}

// The original plus the WebP copies written beside a picture
// (src/lib/image-variants.ts). The shape checks pinned the path to a flat
// name under one of two folders, so nothing here can climb out of public/.
function removeFile(url: string) {
  const root = url.startsWith("/generated/") ? "generated" : "uploads";
  const name = url.slice(`/${root}/`.length);
  const dir = path.join(process.cwd(), "public", root);
  const names = isUploadedPdfPath(url) ? [name] : [name, ...VARIANT_WIDTHS.map((width) => variantFileName(name, width))];
  for (const file of names) {
    try {
      fs.rmSync(path.join(dir, file), { force: true });
    } catch (error) {
      console.error(`[image-files] could not remove /${root}/${file}`, error);
    }
  }
}

// Removes each candidate no row names any more. Call it after the rows are
// deleted; returns the paths it removed.
export function removeUnreferencedFiles(urls: Iterable<string>): string[] {
  const candidates = [...new Set(urls)].filter(
    (url) => isUploadedImagePath(url) || isUploadedPdfPath(url) || isGeneratedImagePath(url),
  );
  if (candidates.length === 0) {
    return [];
  }
  const referenced = referencedFiles();
  const removed: string[] = [];
  for (const url of candidates) {
    if (!referenced.has(url)) {
      removeFile(url);
      removed.push(url);
    }
  }
  return removed;
}
