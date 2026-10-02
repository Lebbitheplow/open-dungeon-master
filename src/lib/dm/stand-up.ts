import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, moveToken } from "@/lib/db/battle-maps";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { speedToTiles } from "@/lib/battlemap/movement";
import { standUpTiles } from "@/lib/srd/authored-effects-more";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The AI's clear_condition prone (mutations.ts) is the character standing
// up, so it costs what a move from the board charges for it (SRD 5.1, Being
// Prone): half the speed, or what a feature makes it (Tipsy Sway's 5 feet),
// taken on the character's own turn and never at speed 0. Returns the
// refusal, or null once the cost is spent; off a battle map there is no
// movement to charge.
export function payToStand(campaignId: string, sheet: CharacterSheet): string | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter?.orderReady ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  if (current.kind !== "pc" || current.characterId !== sheet.id) {
    return `${sheet.name} stands up on their own turn only; it is ${current.name}'s turn.`;
  }
  const { speed, fullTiles } = pcMoveBudget(campaignId, encounter, map, sheet, token);
  if (speed <= 0) {
    return `${sheet.name} cannot stand up at speed 0.`;
  }
  const cost = standUpTiles(sheet, speedToTiles(speed));
  if (fullTiles < cost) {
    return `${sheet.name} cannot stand up: it costs ${cost * 5} feet of movement and they have ${fullTiles * 5} feet left this turn.`;
  }
  moveToken(token.id, token.x, token.y, token.movedThisRound + cost);
  return null;
}
