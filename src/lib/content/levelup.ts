// The pack's Level Up twins and the entries a 5.1 table is not offered
// (src/lib/content/levelup-logic.ts), per table, read once a process: from
// the needs the pack stored (src/lib/content/pack-readings.ts), or read live
// from a pack built before them.

import { getContentDb } from "@/lib/content/db";
import { storedNeeds, packReadingsCurrent } from "@/lib/content/pack-readings";
import { mechanicsNeeded, type Need } from "@/lib/content/needs-logic";
import { isLevelUpTwin, LEVEL_UP_DOCUMENTS, offeredInPlay, SRD_DOCUMENTS } from "@/lib/content/levelup-logic";
import { PLAYED_DOCUMENTS_SQL } from "@/lib/content/edition";
import { textKey } from "@/lib/language/text-logic";
import type { SqliteDatabase } from "@/lib/db/driver";

const KIND_OF: Record<string, "spell" | "monster" | "feat" | "race" | "class" | "background" | "archetype" | "item"> = {
  spells: "spell",
  monsters: "monster",
  feats: "feat",
  races: "race",
  classes: "class",
  backgrounds: "background",
  archetypes: "archetype",
  items: "item",
};

type TableSets = { twins: Map<string, string>; unoffered: Set<string>; needs: Map<string, Need[]> };

declare global {
  var __odmLevelUp: { db: SqliteDatabase; tables: Map<string, TableSets> } | undefined;
}

function setsFor(table: string): TableSets | null {
  const db = getContentDb();
  const kind = KIND_OF[table];
  if (!db || !kind) {
    return null;
  }
  if (globalThis.__odmLevelUp?.db !== db) {
    globalThis.__odmLevelUp = { db, tables: new Map() };
  }
  const cached = globalThis.__odmLevelUp.tables.get(table);
  if (cached) {
    return cached;
  }
  const rows = db.prepare(`SELECT slug, name, document_slug FROM ${table} WHERE ${PLAYED_DOCUMENTS_SQL}`).all() as Array<{ slug: string; name: string; document_slug: string }>;
  // The SRD row that answers each name a Level Up twin also prints.
  const srd = new Map<string, string>();
  for (const row of rows) {
    if (SRD_DOCUMENTS.has(row.document_slug) && !srd.has(textKey(row.name))) {
      srd.set(textKey(row.name), row.slug);
    }
  }
  const names = new Set(srd.keys());
  const twins = new Map<string, string>();
  for (const row of rows) {
    if (isLevelUpTwin({ documentSlug: row.document_slug, name: row.name }, names)) {
      twins.set(row.slug, srd.get(textKey(row.name)) as string);
    }
  }
  // What each row needs: stored, or read live from every row once.
  const needs = new Map<string, Need[]>();
  if (packReadingsCurrent()) {
    for (const row of rows) {
      const stored = storedNeeds(kind, row.slug) ?? [];
      if (stored.length) {
        needs.set(row.slug, stored);
      }
    }
  } else {
    const data = db.prepare(`SELECT slug, document_slug, data_json FROM ${table} WHERE ${PLAYED_DOCUMENTS_SQL}`).all() as Array<{ slug: string; document_slug: string; data_json: string }>;
    for (const row of data) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(row.data_json) as Record<string, unknown>;
      } catch {
        // A row that does not parse needs nothing a reader can see.
      }
      const found = mechanicsNeeded({ documentSlug: row.document_slug, data: parsed });
      if (found.length) {
        needs.set(row.slug, found);
      }
    }
  }
  const unoffered = new Set([...needs].filter(([, found]) => !offeredInPlay(found)).map(([slug]) => slug));
  const sets = { twins, unoffered, needs };
  globalThis.__odmLevelUp.tables.set(table, sets);
  return sets;
}

// Whether a pack row is Level Up's version of an SRD entry (never served).
export function isTwinSlug(table: string, slug: string): boolean {
  return setsFor(table)?.twins.has(slug) ?? false;
}

// The SRD row that answers a Level Up twin's name, or the slug itself.
export function servedSlug(table: string, slug: string): string {
  return setsFor(table)?.twins.get(slug) ?? slug;
}

// Whether a pack row may be offered for play at a 5.1 table.
export function offeredSlug(table: string, slug: string): boolean {
  return !(setsFor(table)?.unoffered.has(slug) ?? false);
}

// What a pack row needs that the engine lacks (empty for most).
export function needsOfSlug(table: string, slug: string): Need[] {
  return setsFor(table)?.needs.get(slug) ?? [];
}

// Whether a document is Level Up's (its rows are labeled with whose rules
// they are).
export function isLevelUpDocument(documentSlug: string): boolean {
  return LEVEL_UP_DOCUMENTS.has(documentSlug);
}
