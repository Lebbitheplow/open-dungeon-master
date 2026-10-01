// The School of Abjuration's Arcane Ward, as the table keeps it: two
// counters the resource engine sizes and a long rest refills
// (src/lib/srd/authored-resources.json): `sub_arcane_ward`, the ward's hit
// points (twice the wizard level plus the Intelligence modifier; `used` is
// the damage it has taken), and `sub_arcane_ward_raised`, whether the ward
// has been raised since the last long rest.
//
//   - The first abjuration spell of 1st level or higher after a long rest
//     raises it at full strength; each later one restores twice the spell's
//     level (the cast guard calls wardOnCast).
//   - Damage to the wizard lands on the ward first; what the ward cannot
//     hold comes through (pc-damage.ts calls absorbByWard).
//   - Projected Ward: the wizard's reaction has the ward take the damage a
//     creature within 30 feet just took (authored-reactions.ts, `reduce` with
//     amount "ward").

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { activeAuthored } from "@/lib/srd/authored-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const WARD_POOL = "sub_arcane_ward";
export const WARD_RAISED = "sub_arcane_ward_raised";

export type WardState = { raised: boolean; hp: number; max: number };

// The ward a sheet holds, or null for anyone without the feature.
export function wardOf(sheet: Pick<CharacterSheet, "resources"> & Parameters<typeof activeAuthored>[0]): WardState | null {
  if (!activeAuthored(sheet, "arcane_ward").length) {
    return null;
  }
  const pool = sheet.resources?.[WARD_POOL];
  if (!pool) {
    return null;
  }
  const raised = (sheet.resources?.[WARD_RAISED]?.used ?? 0) > 0;
  return { raised, hp: raised ? Math.max(0, pool.max - pool.used) : 0, max: pool.max };
}

function writePool(campaign: Campaign, sheet: CharacterSheet, used: number, raised?: boolean): void {
  const now = getSheetById(sheet.id) ?? sheet;
  const pool = now.resources[WARD_POOL];
  if (!pool) {
    return;
  }
  const resources = {
    ...now.resources,
    [WARD_POOL]: { max: pool.max, used: Math.max(0, Math.min(pool.max, used)) },
    ...(raised && now.resources[WARD_RAISED] ? { [WARD_RAISED]: { max: now.resources[WARD_RAISED].max, used: 1 } } : {}),
  };
  const updated = patchSheet(now.id, { resources });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// An abjuration spell of 1st level or higher was cast at `level`: the ward
// rises at full strength the first time after a long rest, and regains twice
// the level after that. Returns what the cast's result gains ({} for none).
export function wardOnCast(campaign: Campaign, sheetId: string, school: string | null, level: number | null): { arcaneWard?: string } {
  if (school !== "abjuration" || !level || level < 1) {
    return {};
  }
  const sheet = getSheetById(sheetId);
  const ward = sheet ? wardOf(sheet) : null;
  if (!sheet || !ward) {
    return {};
  }
  if (!ward.raised) {
    writePool(campaign, sheet, 0, true);
    return { arcaneWard: `${sheet.name}'s ward rises with ${ward.max} hit points; damage to them lands on it first.` };
  }
  const restored = Math.min(2 * level, ward.max - ward.hp);
  if (restored <= 0) {
    return {};
  }
  writePool(campaign, sheet, ward.max - ward.hp - restored);
  return { arcaneWard: `The ward regains ${restored} hit points (${ward.hp + restored}/${ward.max}).` };
}

// Damage about to land on the wizard: what the ward takes of it (all of it,
// or what it has left), written to the pool. The caller lands the rest.
export function absorbByWard(campaign: Campaign, sheet: CharacterSheet, amount: number): { absorbed: number; note: string } | null {
  const ward = wardOf(sheet);
  if (!ward || !ward.raised || ward.hp <= 0 || amount <= 0) {
    return null;
  }
  const absorbed = Math.min(ward.hp, amount);
  writePool(campaign, sheet, ward.max - ward.hp + absorbed);
  return {
    absorbed,
    note: `Arcane Ward takes ${absorbed} (${ward.hp - absorbed}/${ward.max} left)${absorbed < amount ? `; ${amount - absorbed} comes through` : ""}.`,
  };
}

// Projected Ward: how much of `amount` the holder's ward can take for
// another creature, spent from the ward now. Null when it has nothing.
export function projectWard(campaign: Campaign, holder: CharacterSheet, amount: number): number | null {
  const taken = absorbByWard(campaign, holder, amount);
  return taken ? taken.absorbed : null;
}
