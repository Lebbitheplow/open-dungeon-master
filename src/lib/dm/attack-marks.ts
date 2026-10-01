// Effects on a character that one attack reads and changes: Hunter's Mark
// and Hex, which ride hits on one marked creature only, and Invisibility,
// which ends when its holder attacks or casts.
//
// The mark. SRD 5.1: Hunter's Mark and Hex mark "a creature you can see",
// and when it drops to 0 hit points the caster can move the mark with a
// bonus action on a later turn. The marked creature's enemyId is kept in the
// condition's meta (`quarry`). A mark written with the creature's name in
// the condition ("hunter's mark (Goblin 2)") reads that name. A mark that
// names nobody is placed on the first creature its holder attacks, which is
// the creature a mark cast in the moment is almost always for.
//
// Invisibility. SRD 5.1: the spell (and a potion of invisibility, and a ring)
// ends when the invisible creature attacks or casts a spell; Greater
// Invisibility does not. A character's "invisible" ends that way unless its
// meta names Greater Invisibility.

import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isKnockedOut } from "@/lib/dm/knockout";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type MarkPlan = {
  // Mark conditions whose die rides this attack.
  applies: Set<string>;
  // Marks this attack places or moves: written once the attack is paid for.
  assign: Array<{ condition: string; enemyId: string }>;
  // Moving a mark off a fallen creature is a bonus action.
  movesMark: boolean;
  notes: string[];
};

const out = (enemy: EncounterEnemy | null) =>
  !enemy || enemy.status !== "alive" || isKnockedOut(enemy);

export function planMarks(input: {
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  encounterEnemies: EncounterEnemy[];
  budget: TurnBudget | null;
}): MarkPlan {
  const { sheet, enemy, budget } = input;
  const plan: MarkPlan = { applies: new Set(), assign: [], movesMark: false, notes: [] };
  const meta = sheet.conditionMeta as ConditionMetaMap;
  for (const condition of sheet.conditions) {
    if (!conditionEffectsFor(condition)?.marksTarget) {
      continue;
    }
    let quarry = meta[condition]?.quarry ?? null;
    if (!quarry) {
      const named = /\(([^)]+)\)/.exec(condition)?.[1]?.trim().toLowerCase();
      const found = named
        ? input.encounterEnemies.find((entry) => entry.displayName.toLowerCase() === named)
        : undefined;
      quarry = found?.id ?? null;
    }
    if (quarry === enemy.id) {
      plan.applies.add(condition);
      continue;
    }
    if (!quarry) {
      plan.applies.add(condition);
      plan.assign.push({ condition, enemyId: enemy.id });
      plan.notes.push(`${condition}: ${enemy.displayName} is the marked creature from now on`);
      continue;
    }
    // The marked creature has fallen: the mark moves, for a bonus action on
    // the holder's own turn, to the creature attacked now.
    if (out(getEnemy(quarry)) && budget && !budget.bonusUsed && !plan.movesMark) {
      plan.applies.add(condition);
      plan.assign.push({ condition, enemyId: enemy.id });
      plan.movesMark = true;
      plan.notes.push(`${condition}: the marked creature is down, so the mark moves to ${enemy.displayName} (a bonus action)`);
    }
  }
  return plan;
}

// Writes the marks an attack placed or moved.
export function writeMarks(campaignId: string, sheetId: string, assign: MarkPlan["assign"]) {
  if (!assign.length) {
    return;
  }
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  for (const { condition, enemyId } of assign) {
    if (fresh.conditions.includes(condition)) {
      meta[condition] = { ...meta[condition], quarry: enemyId };
    }
  }
  const updated = patchSheet(sheetId, { conditionMeta: meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}

// The invisibility an attack or a cast ends: every "invisible" on the sheet
// but one Greater Invisibility laid down.
export function invisibilityEndedByAction(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): string[] {
  const meta = sheet.conditionMeta as ConditionMetaMap;
  return sheet.conditions.filter(
    (entry) =>
      entry.trim().toLowerCase() === "invisible" &&
      !/greater invisibility/i.test(`${meta[entry]?.spell ?? ""} ${meta[entry]?.source ?? ""}`),
  );
}

// Ends a character's invisibility because they cast a spell (the cast guard
// calls this once a cast has gone through). Returns a line for the result.
export function endInvisibilityOnCast(campaignId: string, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return null;
  }
  const ending = invisibilityEndedByAction(sheet);
  if (!ending.length) {
    return null;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, ending);
  const updated = patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} casts a spell and is no longer invisible.`;
}
