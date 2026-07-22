import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { listSheets } from "@/lib/db/sheets";
import { computeSheetDerived } from "@/lib/srd";
import { defenseRiders } from "@/lib/srd/feature-effects";
import { chebyshev } from "@/lib/battlemap/types";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Aura of Protection reaching allies. The paladin's own saves already carry
// the bonus (feature-effects save_bonus -> computeSheetDerived); this module
// answers the other half: does someone ELSE's aura cover this character
// right now? Only answerable in an encounter with a battle map, where both
// tokens have real positions; outside one the DM prompt still carries the
// rule as guidance. Auras from several paladins do not stack (same-effect
// rule): the best one applies.

export type AuraSaveBonus = { bonus: number; note: string };

// 10 ft = 2 tiles; Aura Improvements at paladin 18 widen it to 30 ft.
function auraRangeTiles(donorLevel: number): number {
  return donorLevel >= 18 ? 6 : 2;
}

export function allySaveAura(
  campaignId: string,
  target: Pick<CharacterSheet, "id">,
): AuraSaveBonus | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  const targetToken = getTokenByRef(map.id, target.id);
  if (!targetToken) {
    return null;
  }
  let best: AuraSaveBonus | null = null;
  for (const donor of listSheets(campaignId)) {
    // The aura holder's own sheet already carries the bonus, and an
    // unconscious or dead paladin projects nothing.
    if (donor.id === target.id || donor.currentHp <= 0 || donor.deathSaves?.dead) {
      continue;
    }
    const derived = computeSheetDerived(donor);
    const riders = defenseRiders(
      { class: donor.class, level: donor.level, features: donor.features },
      derived.abilityMods,
    );
    if (riders.saveBonus <= 0) {
      continue;
    }
    const donorToken = getTokenByRef(map.id, donor.id);
    if (!donorToken) {
      continue;
    }
    const range = auraRangeTiles(donor.level);
    if (chebyshev(targetToken.x, targetToken.y, donorToken.x, donorToken.y) > range) {
      continue;
    }
    if (!best || riders.saveBonus > best.bonus) {
      best = {
        bonus: riders.saveBonus,
        note: `${donor.name}'s aura (within ${range * 5} ft): +${riders.saveBonus} on saving throws`,
      };
    }
  }
  return best;
}
