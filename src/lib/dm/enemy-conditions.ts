import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, setEnemyConcentration, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishPersisted } from "@/lib/events";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import { removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { releaseGrapplesHeldBy } from "@/lib/dm/set-condition";

// What follows from a creature being taken out of the fight, or out of
// action (SRD 5.1): an incapacitated creature loses its concentration and
// lets go of whoever it grapples; a creature that dies or drops also ends
// the grapples, charms and fears it holds on others (the condition names its
// source when it was set). One place, so set_enemy_condition, a kill and a
// knockout all do the same.

// The conditions a creature's own hold keeps on others: its grapple, its
// charm, its fear. A spell's conditions end with the spell's concentration
// instead (concentration.ts), and a web outlives the spider.
const HELD_BY_SOURCE = new Set(["grappled", "charmed", "frightened"]);

const heldBySource = (name: string, sourceId: string) => (entry: ConditionMeta) =>
  HELD_BY_SOURCE.has(name.toLowerCase()) && entry.source === sourceId && !entry.spell;

// The instances `sourceId` holds taken off: a fear another creature also
// holds stays (src/lib/dm/condition-logic.ts). `ending` names what went.
function withoutHeldBy(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  sourceId: string,
): { conditions: string[]; meta: ConditionMetaMap; ending: string[] } {
  let nextConditions = conditions;
  let nextMeta: ConditionMetaMap = { ...(meta ?? {}) };
  const ending: string[] = [];
  for (const name of conditions) {
    const result = removeConditionInstances(nextConditions, nextMeta, name, heldBySource(name, sourceId));
    if (result.removed) {
      nextConditions = result.conditions;
      nextMeta = result.meta;
      ending.push(name);
    }
  }
  return { conditions: nextConditions, meta: nextMeta, ending };
}

// Ends every grapple, charm and fear `sourceId` holds, on characters and on
// other enemies. Returns who was freed of what, for the result.
export function endConditionsHeldBy(campaign: Campaign, sourceId: string): string[] {
  const freed: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const cleared = withoutHeldBy(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, sourceId);
    const ending = cleared.ending;
    if (!ending.length) {
      continue;
    }
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    freed.push(`${sheet.name} (${ending.join(", ")})`);
  }
  const encounter = getActiveEncounter(campaign.id);
  let enemiesChanged = false;
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    const cleared = withoutHeldBy(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, sourceId);
    const ending = cleared.ending;
    if (!ending.length || enemy.status !== "alive") {
      continue;
    }
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    enemiesChanged = true;
    freed.push(`${enemy.displayName} (${ending.join(", ")})`);
  }
  if (enemiesChanged) {
    publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  }
  return freed;
}

// An enemy that became incapacitated (stunned, paralyzed, unconscious,
// petrified, incapacitated): it loses its concentration, whose spell's
// conditions end on everyone it held, and its grapples end. Returns lines
// for the result.
export function onEnemyIncapacitated(campaign: Campaign, enemy: EncounterEnemy): string[] {
  const lines: string[] = [];
  if (enemy.concentration) {
    const spell = enemy.concentration;
    setEnemyConcentration(enemy.id, null);
    clearSpellConditionsByName(campaign, spell, undefined, enemy.id);
    lines.push(`${enemy.displayName} loses its concentration on ${spell}; the spell's effects end.`);
  }
  const released = releaseGrapplesHeldBy(campaign, enemy.id);
  if (released.length) {
    lines.push(`${released.join(" and ")} ${released.length === 1 ? "is" : "are"} no longer grappled by it.`);
  }
  return lines;
}

// Sanctuary (SRD 5.1): a creature that fails its save must choose a new
// target or lose the attack or spell. The failure is kept on the creature
// until its next turn starts, so the same target the same turn is refused
// with no second save.
export const SANCTUARY_TURNED = "turned by sanctuary";

export function sanctuaryWard(
  campaignId: string,
  enemy: EncounterEnemy,
  target: { id: string; name: string },
  save: (campaignId: string, enemy: EncounterEnemy, targetId: string) => string | null,
): string | null {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  if (enemy.conditions.includes(SANCTUARY_TURNED) && meta[SANCTUARY_TURNED]?.source === target.id) {
    return `${enemy.displayName} already failed its save against ${target.name}'s Sanctuary this turn: it must choose another target.`;
  }
  const refused = save(campaignId, enemy, target.id);
  if (refused) {
    const conditions = [...enemy.conditions.filter((name) => name !== SANCTUARY_TURNED), SANCTUARY_TURNED];
    patchEnemyConditions(enemy.id, conditions, {
      ...meta,
      [SANCTUARY_TURNED]: { source: target.id, untilTurnOf: enemy.id },
    });
  }
  return refused;
}
