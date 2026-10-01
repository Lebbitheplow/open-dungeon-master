// Effects that last "until the end of" a combatant's next turn (SRD 5.1:
// Stunning Strike, Guiding Bolt, Intimidating Presence, Chill Touch against
// an undead, Hurl Through Hell). The condition's meta names that combatant in
// `untilTurnEndOf`. The turn it waits for is the NEXT one to start after the
// effect was laid, so the pointer marks the entry `turnBegun` as that turn
// starts, and the turn's end then takes it: a monk's stun laid during the
// monk's own turn outlives that turn, holds through the monk's next one and
// ends with it.
//
// When a turn ends, in ODM's pointer: a character's ends when the pointer
// leaves them (advancePointer, src/lib/dm/encounter-tools.ts); a character the
// pointer walks past (down, or skipped) starts and ends theirs in the same
// move. The pointer never rests on an enemy: the enemies it walks past take
// their turns in the DM turn that follows, so their turns are over once the
// server's backstop has played them (autoActSkippedEnemies), and at the
// latest when the pointer moves again. Outside a fight the clock ends them
// with the untilTurnOf ones (tickConditions endTurnBound).

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { HURLED, hurlReturn } from "@/lib/dm/attack-onhit";
import { spellTurnEndHook } from "@/lib/dm/spell-turn-end";
import { authoredTurnEnd } from "@/lib/dm/authored-turns";
import { zoneTurnEnd } from "@/lib/dm/zone-triggers";
import { blinkTurnEnd } from "@/lib/dm/spell-planes";
import {
  removeConditions,
  type ConditionMeta,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";

// ---- pure ----

// The meta with every entry waiting on one of these combatants marked as
// begun, or null when nothing changed.
export function beginTurnMarks(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  combatantIds: string[],
): ConditionMetaMap | null {
  const starting = new Set(combatantIds);
  let changed = false;
  const next: ConditionMetaMap = { ...(meta ?? {}) };
  for (const name of conditions) {
    const entry = meta?.[name];
    if (entry?.untilTurnEndOf && !entry.turnBegun && starting.has(entry.untilTurnEndOf)) {
      next[name] = { ...entry, turnBegun: true };
      changed = true;
    }
  }
  return changed ? next : null;
}

// The conditions that end because these combatants' turns are ending: the
// ones waiting on that turn whose turn has begun.
export function turnEndConditionsEnding(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  combatantIds: string[],
): string[] {
  const ending = new Set(combatantIds);
  return conditions.filter((name) => {
    const entry = meta?.[name];
    return Boolean(entry?.untilTurnEndOf && entry.turnBegun && ending.has(entry.untilTurnEndOf));
  });
}

// The meta a "until the end of <whose> next turn" effect is written with.
export function untilTurnEnd(whose: string, extra: ConditionMeta = {}): ConditionMeta {
  return { ...extra, untilTurnEndOf: whose };
}

// ---- what an ending does beyond the condition going ----

// A condition whose end does something: Hurl Through Hell's return
// (src/lib/dm/attack-onhit.ts). Looked up when the turn ends, so the import
// cycle between the two modules is never read at load.
function endHookFor(condition: string) {
  // A spell's mark (Acid Arrow's second burn, Phantasmal Killer's dread):
  // src/lib/dm/spell-turn-end.ts.
  return condition.trim().toLowerCase() === HURLED ? hurlReturn : spellTurnEndHook(condition);
}

// ---- the table ----

// These combatants' turns are starting: mark what waits on their end.
export function beginTurns(campaign: Campaign, encounterId: string, combatantIds: string[]): boolean {
  if (!combatantIds.length) {
    return false;
  }
  let enemiesChanged = false;
  for (const enemy of listEnemies(encounterId)) {
    const next = beginTurnMarks(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, combatantIds);
    if (next) {
      patchEnemyConditions(enemy.id, enemy.conditions, next);
      enemiesChanged = true;
    }
  }
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const next = beginTurnMarks(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, combatantIds);
    if (next) {
      const updated = patchSheet(sheet.id, { conditionMeta: next });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
  return enemiesChanged;
}

// These combatants' turns are ending: what lasted until then ends. Returns
// the table lines the endings produced (a hook's damage), and whether any
// enemy row changed.
export function endTurns(
  campaign: Campaign,
  encounterId: string,
  combatantIds: string[],
): { lines: string[]; enemiesChanged: boolean } {
  const lines: string[] = [];
  let enemiesChanged = false;
  if (!combatantIds.length) {
    return { lines, enemiesChanged };
  }
  for (const enemy of listEnemies(encounterId)) {
    const ending = turnEndConditionsEnding(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, combatantIds);
    if (!ending.length) {
      continue;
    }
    const meta = enemy.conditionMeta as ConditionMetaMap;
    const removed = removeConditions(enemy.conditions, meta, ending);
    patchEnemyConditions(enemy.id, removed.conditions, removed.meta);
    enemiesChanged = true;
    for (const name of ending) {
      const hook = endHookFor(name);
      const fresh = hook ? getEnemy(enemy.id) : null;
      const line = hook && fresh ? hook(campaign, fresh, meta[name] ?? {}) : null;
      if (line) {
        lines.push(line);
      }
    }
  }
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const ending = turnEndConditionsEnding(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, combatantIds);
    if (!ending.length) {
      continue;
    }
    const removed = removeConditions(sheet.conditions, sheet.conditionMeta, ending);
    const updated = patchSheet(sheet.id, { conditions: removed.conditions, conditionMeta: removed.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  // What an authored subclass feature does as a turn ends (Protective Spirit): authored-hooks.ts.
  lines.push(...authoredTurnEnd(campaign, combatantIds));
  // A spell area that strikes as a turn ends there (Grease, Wall of Fire): zone-triggers.ts.
  lines.push(...zoneTurnEnd(campaign, encounterId, combatantIds));
  // Blink's d20 as its caster's turn ends: spell-planes.ts.
  lines.push(...blinkTurnEnd(campaign, combatantIds));
  return { lines, enemiesChanged };
}
