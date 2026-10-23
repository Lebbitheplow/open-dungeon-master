// Sunlight Hypersensitivity (a Black Flag or Tome of Beasts vampire, a ghast
// of Leng): "The vampire takes 20 radiant damage when it starts its turn in
// sunlight." Run at the start of the creature's turn by the turn loop
// (src/lib/dm/turn-start-effects.ts), in sunlight as src/lib/dm/sunlight.ts
// reads it; its disadvantage on attacks is the Sensitivity flag's
// (monster-abilities.ts).

import type { Campaign } from "@/lib/db/campaigns";
import { listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { inDirectSunlight } from "@/lib/dm/sunlight";

// The radiant damage the trait prints, or null for a block without it.
export function sunlightBurn(stats: { traits?: string[]; fullTraits?: string[] }): number | null {
  const line = [...(stats.fullTraits ?? []), ...(stats.traits ?? [])].find((entry) => /^sunlight hypersensitivity\b/i.test(entry.trim()));
  const amount = line ? /takes (\d{1,3}) radiant damage when it starts its turn in sunlight/i.exec(line) : null;
  return amount ? Number(amount[1]) : null;
}

export function sunlightTurnStart(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy | undefined): string[] {
  if (!enemy || enemy.status !== "alive") {
    return [];
  }
  const burn = sunlightBurn(enemy.stats);
  if (!burn || !inDirectSunlight(campaign.id)) {
    return [];
  }
  const sheets = listSheets(campaign.id);
  const applied = withOpportunityTurn(campaign.id, (turn) =>
    applyEnemyDamage(campaign, turn, encounter, enemy, burn, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), "radiant", {
      holdVictory: true,
    }),
  );
  const left = listEnemies(encounter.id).filter((entry) => entry.status === "alive").length;
  const taken = typeof applied?.damageApplied === "number" ? applied.damageApplied : burn;
  return [
    `${enemy.displayName} starts its turn in sunlight and takes ${taken} radiant damage (Sunlight Hypersensitivity).${left ? "" : " No enemy is left standing; end the encounter."}`,
  ];
}
