import { getContentDb } from "@/lib/content/db";
import { subclassLevelFor } from "@/lib/srd/features";
import { extraSubclassOf, type SubclassExtras } from "@/lib/srd/subclass-tables";

// The content pack's archetypes as subclass tables (src/lib/srd/
// subclass-tables.ts), read once: the prose ones (Tome of Heroes, the
// Taldorei and Level Up rows) are what a character who took one was granted
// none of. Rows the bundled tables already carry are kept too; the bundled
// table answers first wherever both do.

let cached: SubclassExtras | null = null;

export function packSubclassExtras(): SubclassExtras {
  if (cached) {
    return cached;
  }
  const db = getContentDb();
  const out: SubclassExtras = {};
  if (db) {
    const rows = db.prepare("SELECT name, class_slug, data_json FROM archetypes").all() as Array<{
      name: string;
      class_slug: string;
      data_json: string;
    }>;
    for (const row of rows) {
      const classId = String(row.class_slug ?? "").toLowerCase();
      const table = extraSubclassOf(
        { name: row.name, source: "open5e", data: JSON.parse(row.data_json) as Record<string, unknown> },
        subclassLevelFor(classId) ?? 3,
      );
      if (classId && table) {
        (out[classId] ??= []).push(table);
      }
    }
  }
  cached = out;
  return out;
}
