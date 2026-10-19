import { getDatabase, nowIso } from "@/lib/db/core";
import { databaseOpenCount, mediaWriteCount } from "@/lib/db/driver";
import { isGeneratedImagePath, isUploadedImagePath, isUploadedModelPath, isUploadedPdfPath } from "@/lib/uploads";
import { currentUsageScope, type UsageScope } from "@/lib/usage/scope";

// Who may open a picture or a document the server stores (audit S6).
//
// Being signed in used to be enough for any /uploads or /generated file, so
// an address that leaked (a pasted link, a screenshot of the network tab)
// showed another table's art to any account. The rule now:
//
//   - A file is for the members of every campaign or workshop that names it.
//     A copy shared by reference (a clone, an imported character, a chapter
//     drawing on its shared workshop) is open to the members of each place
//     that holds it.
//   - A file someone just made is theirs, and its campaign's, before any row
//     names it: a portrait previewed before the sheet is saved, a picture an
//     upload form shows before the form is sent.
//   - Avatars, campaign covers (an invite shows one before its reader has
//     joined) and the server's own settings images are open to every account.
//   - An account's own library (characters, homebrew, rulesets) is its own.
//   - The administrator may open anything, as the narration route allows.
//
// Anyone else is answered 404, the same as a file that does not exist.
//
// The sets of names behind each place are read from the rows and kept until
// a write could have changed them (src/lib/db/driver.ts mediaWriteCount), so
// a page of portraits costs one read of each set, not one per picture.

type Reader = { id: string; isAdmin?: boolean };

const PATH = /\/(?:uploads|generated)\/[A-Za-z0-9_.-]+/g;

export function isStoredMediaPath(value: string): boolean {
  return isUploadedImagePath(value) || isUploadedPdfPath(value) || isUploadedModelPath(value) || isGeneratedImagePath(value);
}

// Every stored-file path a piece of text names, inside JSON, prose or a full
// address alike.
export function mediaPathsIn(text: unknown, into: Set<string>): void {
  if (typeof text !== "string" || !text) return;
  for (const [candidate] of text.matchAll(PATH)) {
    if (isStoredMediaPath(candidate)) into.add(candidate);
  }
}

// Who made a file and where: called by everything that writes one (uploads,
// image backends, imports), in the request or job that asked for it.
export function recordMediaFile(url: string, scope: UsageScope = currentUsageScope()): void {
  if (!isStoredMediaPath(url)) return;
  getDatabase()
    .prepare(`INSERT OR IGNORE INTO media_files (path, user_id, campaign_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(url, scope.userId ?? null, scope.campaignId ?? null, nowIso());
}

type Table = { name: string; columns: string[] };

// The tables a file can be named in, sorted by what they belong to. Read
// from the schema once: a new picture column is covered the day it is added.
let tables: { campaign: Table[]; user: Table[] } | null = null;
let tablesFor = -1;

function schema(): { campaign: Table[]; user: Table[] } {
  if (tables && tablesFor === databaseOpenCount()) return tables;
  tablesFor = databaseOpenCount();
  const db = getDatabase();
  const campaign: Table[] = [];
  const user: Table[] = [];
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{
    name: string;
  }>;
  for (const { name } of names) {
    // Nothing a reader can be shown lives here: the owner index itself, and
    // the old chat feature nothing reads any more.
    if (name === "media_files" || name === "chats" || name === "messages" || name === "characters") continue;
    const info = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string; type: string }>;
    const columns = info.filter((column) => !column.type || /TEXT|CHAR|CLOB|JSON/i.test(column.type)).map((column) => column.name);
    const keys = new Set(info.map((column) => column.name));
    if (name === "campaigns" || keys.has("campaign_id")) campaign.push({ name, columns });
    else if (keys.has("user_id")) user.push({ name, columns });
  }
  tables = { campaign, user };
  return tables;
}

function likeAny(columns: string[]): string {
  return columns.map((column) => `"${column}" LIKE '%/uploads/%' OR "${column}" LIKE '%/generated/%'`).join(" OR ");
}

function collect(sql: string, args: unknown[], into: Set<string>): void {
  for (const row of getDatabase().prepare(sql).all(...args) as Array<Record<string, unknown>>) {
    for (const value of Object.values(row)) mediaPathsIn(value, into);
  }
}

function readCampaignMedia(campaignId: string): Set<string> {
  const found = new Set<string>();
  for (const { name, columns } of schema().campaign) {
    if (!columns.length) continue;
    const key = name === "campaigns" ? "id" : "campaign_id";
    const select = columns.map((column) => `"${column}"`).join(", ");
    collect(`SELECT ${select} FROM "${name}" WHERE "${key}" = ? AND (${likeAny(columns)})`, [campaignId], found);
  }
  return found;
}

function readUserMedia(userId: string): Set<string> {
  const found = new Set<string>();
  for (const { name, columns } of schema().user) {
    if (!columns.length) continue;
    const select = columns.map((column) => `"${column}"`).join(", ");
    collect(`SELECT ${select} FROM "${name}" WHERE user_id = ? AND (${likeAny(columns)})`, [userId], found);
  }
  collect(`SELECT settings_json FROM users WHERE id = ?`, [userId], found);
  return found;
}

function readPublicMedia(): Set<string> {
  const found = new Set<string>();
  collect(`SELECT avatar_json FROM users WHERE avatar_json LIKE '%/uploads/%' OR avatar_json LIKE '%/generated/%'`, [], found);
  collect(`SELECT cover_json FROM campaigns WHERE cover_json LIKE '%/uploads/%' OR cover_json LIKE '%/generated/%'`, [], found);
  collect(`SELECT value_json FROM app_settings WHERE value_json LIKE '%/uploads/%' OR value_json LIKE '%/generated/%'`, [], found);
  return found;
}

type Cached = { writes: number; paths: Set<string> };
const MAX_CACHED = 512;
const cache = new Map<string, Cached>();

function remember(key: string, paths: Set<string>): Set<string> {
  cache.delete(key);
  cache.set(key, { writes: mediaWriteCount(), paths });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return paths;
}

function setFor(key: string, fresh: boolean): Set<string> | null {
  const hit = cache.get(key);
  if (hit && (!fresh || hit.writes === mediaWriteCount())) return hit.paths;
  if (!fresh) return null;
  const split = key.indexOf(":");
  const kind = split < 0 ? key : key.slice(0, split);
  const id = split < 0 ? "" : key.slice(split + 1);
  return remember(key, kind === "campaign" ? readCampaignMedia(id) : kind === "user" ? readUserMedia(id) : readPublicMedia());
}

// The campaigns and workshops an account belongs to, and the shared
// workshops those draw on.
function placesOf(userId: string): string[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.id AS id, c.common_workshop_id AS common FROM campaigns c
       WHERE c.owner_user_id = ? OR c.id IN (SELECT campaign_id FROM campaign_members WHERE user_id = ?)`,
    )
    .all(userId, userId) as Array<{ id: string; common: string | null }>;
  const places = new Set<string>();
  for (const row of rows) {
    places.add(row.id);
    if (row.common) places.add(row.common);
  }
  return [...places];
}

export function mayReadMedia(reader: Reader, url: string): boolean {
  if (!isStoredMediaPath(url)) return false;
  if (reader.isAdmin) return true;
  const places = placesOf(reader.id);
  const owner = getDatabase().prepare(`SELECT user_id, campaign_id FROM media_files WHERE path = ?`).get(url) as
    | { user_id: string | null; campaign_id: string | null }
    | undefined;
  if (owner && (owner.user_id === reader.id || (owner.campaign_id && places.includes(owner.campaign_id)))) return true;
  const keys = ["public", `user:${reader.id}`, ...places.map((id) => `campaign:${id}`)];
  // What is already known first (a set a moment old still answers yes for
  // a file it held), then a fresh read of whatever a write may have changed.
  for (const fresh of [false, true]) {
    for (const key of keys) {
      if (setFor(key, fresh)?.has(url)) return true;
    }
  }
  return false;
}
