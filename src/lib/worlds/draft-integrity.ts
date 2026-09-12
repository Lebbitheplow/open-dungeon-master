// The checks a draft needs the server for: that its monster slugs, spell
// names and item names are real, against the content pack on disk. The
// same checks scripts/validate-world-packs.mjs runs over a folder, asked of
// one pack at export time so a person is told "that slug is not in the
// content pack" in the editor rather than by a script they never run.
//
// Server-only: opens the content database. Everything the browser can check
// on its own is in ./draft-check.ts.
import { getContentDb } from "@/lib/content/db";
import { SRD_ARMOR } from "@/lib/srd/armor";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import { normalizeCreatureType } from "@/lib/bestiary/statblock";
import type { WorldPack } from "@/lib/worlds/types";

export type IntegrityReport = {
  problems: string[];
  // True when the content pack was there to ask. When it is not, the
  // problems list is empty and means nothing, which the caller should say.
  checked: boolean;
};

export function checkPackIntegrity(pack: WorldPack): IntegrityReport {
  const db = getContentDb();
  if (!db) {
    return { problems: [], checked: false };
  }
  const problems: string[] = [];

  if (pack.monsters.length) {
    const lookup = db.prepare(`SELECT cr, type FROM monsters WHERE slug = ?`);
    for (const entry of pack.monsters) {
      const row = lookup.get(entry.slug) as { cr: number; type: string } | undefined;
      if (!row) {
        problems.push(`Monster "${entry.slug}" is not in the content pack.`);
      } else if (row.cr !== entry.cr) {
        problems.push(`${entry.name} says CR ${entry.cr}; the content pack has ${entry.slug} at CR ${row.cr}.`);
      } else if (entry.type && normalizeCreatureType(row.type) !== entry.type) {
        problems.push(`${entry.name} says it is a ${entry.type}; the content pack has ${entry.slug} as ${normalizeCreatureType(row.type) ?? "unknown"}.`);
      }
    }
  }

  if (pack.spells.length) {
    const names = new Set(
      (db.prepare(`SELECT name FROM spells`).all() as Array<{ name: string }>).map((row) => row.name.toLowerCase()),
    );
    for (const entry of pack.spells) {
      if (!names.has(entry.from.toLowerCase())) problems.push(`"${entry.from}" is not a spell in the content pack.`);
    }
  }

  if (pack.items.length) {
    const names = new Set(
      (db.prepare(`SELECT name FROM items`).all() as Array<{ name: string }>).map((row) => row.name.toLowerCase()),
    );
    for (const weapon of SRD_WEAPONS) names.add(weapon.name.toLowerCase());
    for (const armor of SRD_ARMOR) names.add(armor.name.toLowerCase());
    for (const entry of pack.items) {
      if (!names.has(entry.from.toLowerCase())) problems.push(`"${entry.from}" is not an item in the content pack.`);
    }
  }

  return { problems, checked: true };
}
