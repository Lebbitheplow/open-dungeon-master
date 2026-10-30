// The one step after conditions land on an enemy by any path (a spell's
// failed save, an area, Sleep's pool, a Stunning Strike, a poisoned blade):
// if they took it out of action, what follows does (SRD 5.1): its
// concentration ends, with the effects that spell held, and it lets go of
// whoever it grapples (enemy-conditions.ts onEnemyIncapacitated).

import { getCampaignById } from "@/lib/db/campaigns";
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { breakConcentration } from "@/lib/dm/concentration";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { onEnemyIncapacitated } from "@/lib/dm/enemy-conditions";
import { releaseGrapplesHeldBy } from "@/lib/dm/set-condition";

// `wasOut`: whether it was already out of action before these landed (its
// concentration went then). Returns lines for the result.
export function settleEnemyIncapacitation(enemyId: string, wasOut: boolean): string[] {
  if (wasOut) {
    return [];
  }
  const enemy = getEnemy(enemyId);
  if (!enemy) {
    return settleSheetFoeIncapacitation(enemyId);
  }
  if (enemy.status !== "alive" || !isIncapacitated(enemy.conditions)) {
    return [];
  }
  const campaign = getCampaignById(enemy.campaignId);
  return campaign ? onEnemyIncapacitated(campaign, enemy) : [];
}

// A character fighting on the other side, held by a foe path (sheet-foe.ts):
// its concentration lives on its sheet, so it ends there, the way
// set_condition ends a party member's.
function settleSheetFoeIncapacitation(sheetId: string): string[] {
  const sheet = getSheetById(sheetId);
  const campaign = sheet ? getCampaignById(sheet.campaignId) : null;
  if (!sheet || !campaign || sheet.currentHp <= 0 || !isIncapacitated(sheet.conditions)) {
    return [];
  }
  const lines: string[] = [];
  const spell = breakConcentration(campaign, null, sheet.id, "incapacitated");
  if (spell) {
    lines.push(`${sheet.name} loses concentration on ${spell}; the spell's effects end.`);
  }
  const released = releaseGrapplesHeldBy(campaign, sheet.id);
  if (released.length) {
    lines.push(`${released.join(" and ")} ${released.length === 1 ? "is" : "are"} no longer grappled by ${sheet.name}.`);
  }
  return lines;
}
