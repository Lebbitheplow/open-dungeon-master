// A buff on a creature fighting on the caster's side that is not a
// character (issue 503, Phase 6): an ogre the party dominates is an ally for
// as long as the charm holds, and Bless, Haste or Shield of Faith reach it as
// they reach a character. cast_buff names it in targetCharacterIds, or in
// targetEnemyId, by its enemy id; the spell's condition lands on its row, where
// the engine's rules for a creature's conditions read it (its attack and save
// riders, its Armor Class), with the spell's meta so the spell's end, the
// caster's lost concentration or Dispel Magic take it off as they take it off
// a character.
//
// What a buff does through a character's sheet (hit points it raises or
// grants, a new form) has no place on a stat block's row: such a spell is
// refused for the creature, unspent, with the reason.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishPersisted } from "@/lib/events";
import { resolveCombatant, sideOf } from "@/lib/dm/combatant";
import type { ConditionMeta, ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The enemy rows on the caster's side among these refs, and the refs left
// over for the characters (resolved as before). Out of a fight there are
// none.
export function allyRowsOf(campaignId: string, casterId: string, refs: readonly string[]): { rows: EncounterEnemy[]; rest: string[] } {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return { rows: [], rest: [...refs] };
  }
  const mine = sideOf(encounter, "sheet", casterId);
  const rows: EncounterEnemy[] = [];
  const rest: string[] = [];
  for (const ref of refs) {
    const found = resolveCombatant(campaignId, encounter, ref);
    if (found?.kind === "enemy" && found.side === mine && found.enemy.status === "alive") {
      if (!rows.some((row) => row.id === found.id)) {
        rows.push(found.enemy);
      }
      continue;
    }
    rest.push(ref);
  }
  return { rows, rest };
}

// Why this buff cannot go to a creature's row, or null.
export function allyRowRefusal(spell: string, rows: readonly EncounterEnemy[], what: { sheetOnly: boolean }): ToolError | null {
  if (!rows.length || !what.sheetOnly) {
    return null;
  }
  return {
    error: `${spell} works through a character's sheet (its hit points or a new form) and cannot be given to ${rows.map((row) => row.displayName).join(", ")}. Nothing was spent.`,
    retry: true,
  };
}

// Lays the spell's condition on each row; returns the names it landed on.
export function layBuffOnRows(campaign: Campaign, rows: readonly EncounterEnemy[], condition: string, meta: ConditionMeta, rounds: number | null): string[] {
  const landed: string[] = [];
  for (const row of rows) {
    const fresh = getEnemy(row.id);
    if (!fresh || fresh.status !== "alive") {
      continue;
    }
    const held = fresh.conditions.some((entry) => isConditionNamed(entry, condition));
    const conditions = held ? fresh.conditions : [...fresh.conditions, condition];
    const next: ConditionMetaMap = { ...(fresh.conditionMeta as ConditionMetaMap), [condition]: { ...meta, ...(rounds !== null ? { rounds } : {}) } };
    patchEnemyConditions(fresh.id, conditions, next);
    landed.push(fresh.displayName);
  }
  if (landed.length) {
    publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  }
  return landed;
}
