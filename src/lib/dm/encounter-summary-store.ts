// After the fight (docs/vtt-parity-implementation-plan.md 4.2): the card the
// table sees and the line the chapter keeps, written when an encounter ends
// (enemy-damage.ts finishEncounter, split from it). Never blocks the end of
// a fight.

import { setEncounterSummary, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listNpcs } from "@/lib/db/npcs";
import { listRollsSince } from "@/lib/db/rolls";
import { listAuditSince } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import { sheetSide } from "@/lib/dm/combatant";
import {
  absentFighters,
  computeEncounterSummary,
  describeEncounterSummary,
  type SummaryAudit,
  type SummaryRoll,
} from "@/lib/dm/encounter-summary";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function recordEncounterSummary(
  campaignId: string,
  encounter: Encounter,
  outcome: string,
  enemies: EncounterEnemy[],
  sheets: CharacterSheet[],
): void {
  try {
    const endedAt = new Date().toISOString();
    const rolls: SummaryRoll[] = listRollsSince(campaignId, encounter.createdAt).map((roll) => ({
      characterId: roll.characterId,
      attacker: roll.attacker,
      kind: roll.kind,
      total: roll.total,
      applied: roll.applied,
      targetEnemyId: roll.targetEnemyId,
      crit: roll.breakdown?.crit ?? null,
    }));
    const audits: SummaryAudit[] = listAuditSince(campaignId, encounter.createdAt).map((entry) => ({
      characterId: entry.characterId,
      kind: entry.kind,
      delta: entry.delta,
    }));
    const summary = computeEncounterSummary({
      outcome,
      rounds: encounter.round,
      startedAt: encounter.createdAt,
      endedAt,
      enemies,
      sheets: [...sheets, ...departedFighters(campaignId, encounter, sheets, rolls, audits)],
      rolls,
      audits,
    });
    setEncounterSummary(encounter.id, summary, describeEncounterSummary(summary));
    publishPersisted(campaignId, "encounter_summary", { encounterId: encounter.id, summary });
  } catch (error) {
    console.error("[encounter] summary failed", error);
  }
}

// Everyone who fought on the party's side and has left it since the fight
// began (issue 663): a departing companion's sheet is deleted, so the sheets
// alone would drop their damage and their dice. Named as their rolls named
// them, else by the row behind a lasting companion (companion-npcs.ts); one
// named nowhere is left out.
function departedFighters(
  campaignId: string,
  encounter: Encounter,
  sheets: CharacterSheet[],
  rolls: SummaryRoll[],
  audits: SummaryAudit[],
): Array<{ id: string; name: string }> {
  const absent = absentFighters(sheets, rolls, audits).filter((fighter) => sheetSide(encounter, fighter.id) === "party");
  if (!absent.length) {
    return [];
  }
  const npcs = listNpcs(campaignId);
  return absent
    .map((fighter) => ({ id: fighter.id, name: fighter.name || (npcs.find((npc) => npc.companionSheetId === fighter.id)?.name ?? "") }))
    .filter((fighter) => fighter.name);
}
