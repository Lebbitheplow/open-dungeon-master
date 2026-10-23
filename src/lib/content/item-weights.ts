// Item weights from the content pack, for the encumbrance rules. Split from
// src/lib/content/index.ts, which re-exports itemWeightByName.

import { getContentDb } from "@/lib/content/db";
import { legacyPackWeightLb, packWeightLb } from "@/lib/content/weight";
import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";
import { PLAYED_DOCUMENTS_SQL } from "@/lib/content/edition";

type Mistake = { wrong: number; right: number };

// Name -> pounds, built once from the whole items table (about 2,000 rows,
// a few hundred kilobytes) because the optional encumbrance rule asks for a
// weight on every line of every pack on every sheet read. Rows the source
// left blank carry 0 and are skipped, so an unknown weight stays unknown
// rather than becoming a confident zero.
//
// Each weight is read again from the row's own source text rather than taken
// from the `weight` column: packs built before issue #205 hold 14 for a dart
// ("1/4 lb."), and a server keeps the pack it was installed with.
let weightIndex: Map<string, number> | null = null;

// Name -> the number those packs stored where it differs from the right one
// (src/lib/content/weight.ts legacyPackWeightLb). A sheet, a workshop copy
// or the party's pack that copied it is put right on read (repairedWeight).
let mistakeIndex: Map<string, Mistake> | null = null;

// The English plurals of the pack's names, after every name, so "Torches"
// weighs what a Torch does and no plural shadows another item's name.
function addPlurals<V>(table: Map<string, V>): void {
  for (const [key, value] of [...table]) {
    for (const plural of pluralForms(key)) {
      if (!table.has(plural)) {
        table.set(plural, value);
      }
    }
  }
}

function buildIndexes(): void {
  const index = new Map<string, number>();
  const mistakes = new Map<string, Mistake>();
  const db = getContentDb();
  if (db) {
    const rows = db
      .prepare(
        `SELECT name, weight, json_extract(data_json, '$.weight') AS source, json_extract(data_json, '$.weight_unit') AS unit
         FROM items WHERE kind != 'magic_item' AND ${PLAYED_DOCUMENTS_SQL}`,
      )
      .all() as Array<{ name: string; weight: number; source: unknown; unit: unknown }>;
    for (const row of rows) {
      const key = itemWeightKey(row.name);
      if (!key) {
        continue;
      }
      const pounds = packWeightLb(row.weight, { weight: row.source, weight_unit: row.unit });
      // First writer wins: the v1 weapon and armor tables are imported
      // before the v2 gear list, and their rows are the SRD ones.
      if (pounds > 0 && !index.has(key)) {
        index.set(key, pounds);
      }
      const wrong = legacyPackWeightLb(row.source, row.unit);
      if (wrong > 0 && wrong !== pounds && !mistakes.has(key)) {
        mistakes.set(key, { wrong, right: pounds });
      }
    }
  }
  addPlurals(index);
  addPlurals(mistakes);
  weightIndex = index;
  mistakeIndex = mistakes;
}

function itemWeightIndex(): Map<string, number> {
  if (!weightIndex) {
    buildIndexes();
  }
  return weightIndex as Map<string, number>;
}

// The lookup key for an item name: lowercased, punctuation flattened, and a
// trailing count dropped so "Arrows (20)" finds "Arrows". A magic bonus goes
// too, so "+1 Longsword" weighs what a longsword weighs.
function itemWeightKey(name: string): string {
  return textKey(name.replace(/\(\s*\d+\s*\)\s*$/, " "))
    .split(" ")
    .filter((part) => !/^[+-]/.test(part))
    .join(" ");
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
  return index.get(key) ?? null;
}

// A per-unit weight stored for `name`, put right when it is exactly the
// number an old pack wrote by mistake for that item (a dart's 14 lb). Any
// other number is someone's own and is returned as it was. Undefined when
// the right reading is "not stated", so the encumbrance fallbacks weigh it.
export function repairedWeight(name: string, weight: number | undefined): number | undefined {
  if (typeof weight !== "number") {
    return weight;
  }
  const key = itemWeightKey(name ?? "");
  if (!key) {
    return weight;
  }
  if (!mistakeIndex) {
    buildIndexes();
  }
  const mistake = mistakeIndex?.get(key);
  if (!mistake || Math.abs(mistake.wrong - weight) > 1e-9) {
    return weight;
  }
  return mistake.right > 0 ? mistake.right : undefined;
}
