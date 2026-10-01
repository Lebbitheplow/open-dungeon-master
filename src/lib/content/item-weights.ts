// Item weights from the content pack, for the encumbrance rules. Split from
// src/lib/content/index.ts, which re-exports itemWeightByName.

import { getContentDb } from "@/lib/content/db";

// Name -> pounds, built once from the whole items table (about 2,000 rows,
// a few hundred kilobytes) because the optional encumbrance rule asks for a
// weight on every line of every pack on every sheet read. Rows the source
// left blank carry 0 and are skipped, so an unknown weight stays unknown
// rather than becoming a confident zero.
let weightIndex: Map<string, number> | null = null;

function itemWeightIndex(): Map<string, number> {
  if (weightIndex) {
    return weightIndex;
  }
  const index = new Map<string, number>();
  const db = getContentDb();
  if (db) {
    const rows = db.prepare(`SELECT name, weight FROM items WHERE weight > 0`).all() as Array<{
      name: string;
      weight: number;
    }>;
    for (const row of rows) {
      const key = itemWeightKey(row.name);
      // First writer wins: the v1 weapon and armor tables are imported
      // before the v2 gear list, and their rows are the SRD ones.
      if (key && !index.has(key)) {
        index.set(key, row.weight);
      }
    }
  }
  weightIndex = index;
  return index;
}

// The lookup key for an item name: lowercased, punctuation flattened, and a
// trailing count dropped so "Arrows (20)" finds "Arrows". A magic bonus goes
// too, so "+1 Longsword" weighs what a longsword weighs.
function itemWeightKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/, " ")
    .replace(/[+-]\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Pounds per unit for a free-text item name, or null when the content pack
// has nothing. Callers fall back to the SRD armor table
// (src/lib/srd/encumbrance.ts) before giving up.
export function itemWeightByName(name: string): number | null {
  const key = itemWeightKey(name ?? "");
  if (!key) {
    return null;
  }
  const index = itemWeightIndex();
  return index.get(key) ?? index.get(key.replace(/s$/, "")) ?? null;
}
