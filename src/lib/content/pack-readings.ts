// The readings the pack build stored (scripts/lib/pack-readings.mjs), read
// back: what the engine plays an entry with, where that came from (a
// hand-written row, the parser, or nothing), what its reader left unread,
// and the rules it needs that the engine lacks. A pack built before them,
// or by readers older than this server's (READER_REVISION), is read live
// instead, so a stored answer is never older than the readers.

import { getContentDb } from "@/lib/content/db";
import { READER_REVISION, type EntryReading, type ReadingKind, type ReadingSource } from "@/lib/content/reading-logic";
import type { Need } from "@/lib/content/needs-logic";
import type { SqliteDatabase } from "@/lib/db/driver";

type Stored = { db: SqliteDatabase; current: boolean; readings: Map<string, EntryReading | null>; needs: Map<string, Need[]> | null };

declare global {
  var __odmPackReadings: Stored | undefined;
}

function stored(): Stored | null {
  const db = getContentDb();
  if (!db) {
    return null;
  }
  if (globalThis.__odmPackReadings?.db === db) {
    return globalThis.__odmPackReadings;
  }
  let current = false;
  try {
    const row = db.prepare("SELECT value FROM pack_meta WHERE key = 'reader_revision'").get() as { value?: string } | undefined;
    current = Number(row?.value) === READER_REVISION;
  } catch {
    // A pack built before the readings were stored.
  }
  globalThis.__odmPackReadings = { db, current, readings: new Map(), needs: null };
  return globalThis.__odmPackReadings;
}

// Whether the open pack's stored readings are this server's readers' (else
// every reading is taken live).
export function packReadingsCurrent(): boolean {
  return stored()?.current ?? false;
}

// The stored reading of one pack row, or null: no pack, a pack without
// current readings, or no such row.
export function storedReading(kind: ReadingKind, slug: string): EntryReading | null {
  const state = stored();
  if (!state?.current) {
    return null;
  }
  const key = `${kind}:${slug}`;
  if (state.readings.has(key)) {
    return state.readings.get(key) ?? null;
  }
  const row = state.db
    .prepare("SELECT source, checked, unread_json, mechanics_json FROM readings WHERE kind = ? AND slug = ?")
    .get(kind, slug) as { source: ReadingSource; checked: number; unread_json: string; mechanics_json: string | null } | undefined;
  const reading = row
    ? {
        source: row.source,
        checked: row.checked === 1,
        unread: JSON.parse(row.unread_json) as string[],
        mechanics: row.mechanics_json === null ? null : (JSON.parse(row.mechanics_json) as unknown),
      }
    : null;
  state.readings.set(key, reading);
  return reading;
}

// The rules a pack row needs that the engine lacks, from the stored table
// (read once: a few hundred rows), or null when the pack has none stored.
export function storedNeeds(kind: ReadingKind | "item", slug: string): Need[] | null {
  const state = stored();
  if (!state?.current) {
    return null;
  }
  if (!state.needs) {
    const rows = state.db.prepare("SELECT kind, slug, needs_json FROM entry_needs").all() as Array<{ kind: string; slug: string; needs_json: string }>;
    state.needs = new Map(rows.map((row) => [`${row.kind}:${row.slug}`, JSON.parse(row.needs_json) as Need[]]));
  }
  return state.needs.get(`${kind}:${slug}`) ?? [];
}
