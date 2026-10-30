// What a token's creature can do where it stands, as the board's moves
// change it: its flying speed, coming down when a flight ends, and squeezing
// into a space one size too small. Split from map-tools.ts, which re-exports
// landTheFlightless for its callers.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveBoard, getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getBattleMapForEncounter, listTokens, setTokenMovement } from "@/lib/db/battle-maps";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { flyingSpeedOf, type BattleToken } from "@/lib/battlemap/types";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { containsPhrase } from "@/lib/language/text-logic";
import { aloftByMagic, cannotStayAloft } from "@/lib/dm/flight-logic";
import { onGrounding } from "@/lib/db/flight-watch";
import { itemSpeeds } from "@/lib/srd/magic-items";

// The flying speed of the creature a token stands for, or null.
export function flightOf(encounterId: string, token: BattleToken): number | null {
  if (token.kind === "pc") {
    const sheet = getSheetById(token.refId);
    return sheet
      ? flyingSpeedOf({ conditions: sheet.conditions, features: sheet.features, wildShaped: Boolean(sheet.wildShape), walkingFeet: sheet.speed, worn: itemSpeeds(sheet.equipment, sheet, sheet.speed).fly })
      : null;
  }
  if (token.kind === "enemy") {
    const enemy = listEnemies(encounterId).find((entry) => entry.id === token.refId);
    return flyingSpeedOf({ speedText: String(enemy?.stats.speed ?? "") });
  }
  return null;
}

// A creature aloft that can no longer stay there comes down: the token walks
// again and the creature lands prone. That is a character whose flight has
// ended (Fly ran out or its concentration broke, a Wild Shape dropped: SRD
// 5.1, Fly: "it falls"), and any flyer knocked prone or held to a speed of 0
// that neither hovers nor flies by magic (flight-logic.ts). The board keeps
// no altitude, so the fall's damage, when there is a height to it, is the
// DM's apply_hazard fall. Returns the table lines.
export function landTheFlightless(campaign: Campaign, encounterId: string): string[] {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return [];
  }
  const lines: string[] = [];
  for (const token of listTokens(map.id)) {
    if (token.movement !== "fly") {
      continue;
    }
    if (token.kind === "enemy") {
      const enemy = listEnemies(encounterId).find((entry) => entry.id === token.refId);
      if (!enemy || containsPhrase(String(enemy.stats.speed ?? ""), "hover") || !cannotStayAloft(enemy)) {
        continue;
      }
      setTokenMovement(token.id, "walk");
      if (!enemy.conditions.some((entry) => isConditionNamed(entry, "prone"))) {
        patchEnemyConditions(enemy.id, [...enemy.conditions, "prone"], enemy.conditionMeta);
      }
      lines.push(`${token.name} cannot stay aloft: it falls and lands prone.`);
      continue;
    }
    if (token.kind !== "pc") {
      continue;
    }
    const sheet = getSheetById(token.refId);
    const ended = flightOf(encounterId, token) === null;
    if (!ended && !(sheet && !aloftByMagic(sheet.conditions) && cannotStayAloft({ conditions: sheet.conditions, exhaustion: sheet.exhaustion ?? 0 }))) {
      continue;
    }
    setTokenMovement(token.id, "walk");
    if (sheet && !sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone")) {
      const updated = patchSheet(sheet.id, { conditions: [...sheet.conditions, "prone"] });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
    lines.push(ended ? `${token.name}'s flight has ended: they come down and land prone.` : `${token.name} cannot stay aloft: they fall and land prone.`);
  }
  if (lines.length) {
    // The contentless ping map-tools.ts publishBattleMapUpdate sends.
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  return lines;
}

// Whichever route laid the condition, the flyer comes down as it lands
// (src/lib/db/flight-watch.ts), on the board in play: a fight's or a scene's.
onGrounding((campaignId) => {
  const board = getActiveBoard(campaignId);
  const campaign = board ? getCampaignById(campaignId) : null;
  if (board && campaign) {
    landTheFlightless(campaign, board.id);
  }
});

// The squeezing condition on an enemy, on or off (condition-effects.ts row
// "squeezing": its attacks and DEX saves at disadvantage, attacks against it
// at advantage).
export function markSqueezing(campaignId: string, enemyId: string, squeezing: boolean) {
  const enemy = listEnemies(getActiveEncounter(campaignId)?.id ?? "").find((entry) => entry.id === enemyId);
  if (!enemy || enemy.conditions.includes(SQUEEZING) === squeezing) {
    return;
  }
  const conditions = squeezing ? [...enemy.conditions, SQUEEZING] : enemy.conditions.filter((entry) => entry !== SQUEEZING);
  patchEnemyConditions(enemy.id, conditions, enemy.conditionMeta);
}
const SQUEEZING = "squeezing";
