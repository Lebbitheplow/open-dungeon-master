// After the fight (docs/vtt-parity-implementation-plan.md 4.2): the card the
// table sees and the line the chapter keeps, written when an encounter ends
// (enemy-damage.ts finishEncounter, split from it). Never blocks the end of
// a fight.

import { setEncounterSummary, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listRollsSince } from "@/lib/db/rolls";
import { listAuditSince } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import { computeEncounterSummary, describeEncounterSummary } from "@/lib/dm/encounter-summary";
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
    const summary = computeEncounterSummary({
      outcome,
      rounds: encounter.round,
      startedAt: encounter.createdAt,
      endedAt,
      enemies,
      sheets,
      rolls: listRollsSince(campaignId, encounter.createdAt).map((roll) => ({
        characterId: roll.characterId,
        attacker: roll.attacker,
        kind: roll.kind,
        total: roll.total,
        applied: roll.applied,
        targetEnemyId: roll.targetEnemyId,
        crit: roll.breakdown?.crit ?? null,
      })),
      audits: listAuditSince(campaignId, encounter.createdAt).map((entry) => ({
        characterId: entry.characterId,
        kind: entry.kind,
        delta: entry.delta,
      })),
    });
    setEncounterSummary(encounter.id, summary, describeEncounterSummary(summary));
    publishPersisted(campaignId, "encounter_summary", { encounterId: encounter.id, summary });
  } catch (error) {
    console.error("[encounter] summary failed", error);
  }
}
