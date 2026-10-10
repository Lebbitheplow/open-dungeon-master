// The clock on concentration. SRD 5.1: a concentration spell lasts as long
// as the caster concentrates, up to the spell's duration ("Concentration, up
// to 1 minute"). The duration is kept beside the spell (character_sheets and
// encounter_enemies .concentration_rounds) when the casting starts it, and
// counted down here: in a fight as the caster's own turns start (so a minute
// ends where it began), outside one by the in-world clock. When it runs out
// the concentration ends the way a broken one does, its conditions, zones
// and creatures with it. A spell with no stated duration keeps no clock.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, setEnemyConcentration, setEnemyConcentrationRounds } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { breakConcentration, clearSpellConditionsByName } from "@/lib/dm/concentration";

export { concentrationRoundsFor } from "@/lib/dm/concentration";

// Counts every running concentration clock that `counts` picks down by `by`
// rounds, ending the ones that run out. Returns the table lines.
export function tickConcentrationClocks(
  campaign: Campaign,
  by: number,
  counts: (casterId: string) => boolean,
): string[] {
  const lines: string[] = [];
  if (by <= 0) {
    return lines;
  }
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const left = sheet.concentrationRounds;
    if (!sheet.concentratingOn || typeof left !== "number" || !counts(sheet.id)) {
      continue;
    }
    if (left - by > 0) {
      patchSheet(sheet.id, { concentrationRounds: left - by });
      continue;
    }
    const spell = breakConcentration(campaign, null, sheet.id, "the spell's duration ran out");
    if (spell) {
      lines.push(`${sheet.name}'s ${spell} has run its course; their concentration on it ends.`);
    }
  }
  const encounter = getActiveEncounter(campaign.id);
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    const left = enemy.concentrationRounds;
    if (enemy.status !== "alive" || !enemy.concentration || typeof left !== "number" || !counts(enemy.id)) {
      continue;
    }
    if (left - by > 0) {
      setEnemyConcentrationRounds(enemy.id, left - by);
      continue;
    }
    const spell = enemy.concentration;
    setEnemyConcentration(enemy.id, null);
    clearSpellConditionsByName(campaign, spell, undefined, enemy.id);
    lines.push(`${enemy.displayName}'s ${spell} has run its course; the spell's effects end.`);
  }
  return lines;
}
