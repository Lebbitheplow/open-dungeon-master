import { spellMechanicsFor } from "@/lib/content";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

// What the engine runs for a published row, handed to the workshop's "start
// from" pickers (src/app/workshop/homebrew/CatalogStart.tsx) beside the row
// itself, so a copy begins with the mechanics and not just the words. A
// renamed copy of Web otherwise lost the escape check the SRD's Web has,
// because the authored and overridden blocks are found by the published
// name and a homebrew row by its own (src/lib/content/index.ts).
//
// Asked for with ?mechanics=1 on /api/content/<kind>; the builder's own
// searches never pay for it.

type Row = { name: string; source: string; data: Record<string, unknown> };

export function spellMechanicsOf(row: Row): SpellMech | null {
  if (row.source === "homebrew") {
    return null;
  }
  return spellMechanicsFor({ spell: row.name })?.mech ?? null;
}

export function withMechanics(kind: string, results: unknown[]): unknown[] {
  if (kind === "spells") {
    return results.map((row) => {
      const mech = spellMechanicsOf(row as Row);
      return mech ? { ...(row as Row), mech } : row;
    });
  }
  return results;
}
