// Breaking free of a spell that holds a creature fast (SRD 5.1): Entangle
// and Web with an action and a Strength check, Black Tentacles with a
// Strength or Dexterity check, each against the caster's spell save DC;
// Maze with an Intelligence check against DC 20.
// take_action escape comes here when the escaper holds no grapple
// (src/lib/dm/grapple.ts).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, patchEnemyConditions, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression, d20Expression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { spellSaveDcFor } from "@/lib/srd";
import { spellMechanicsFor } from "@/lib/content";
import { canEnemyAct, markEnemyActed } from "@/lib/dm/can-act";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Hold = { name: string; spell: string; abilities: Array<"str" | "dex" | "int">; dc: number; save?: "wis" };

// The spell hold a creature may break with a check, or null.
function holdOn(conditions: string[], meta: ConditionMetaMap | undefined): Hold | null {
  for (const name of conditions) {
    const entry = meta?.[name];
    const rule = entry?.spell ? spellMechanicsFor({ spell: entry.spell })?.mech.condition : null;
    const caster = entry?.source ? getSheetById(entry.source) : null;
    if ((rule?.escape?.length || rule?.escapeSave) && rule.name === name && entry?.spell) {
      // Maze's way out is a fixed DC 20 Intelligence check; Irresistible
      // Dance's a Wisdom saving throw.
      return { name, spell: entry.spell, abilities: rule.escape ?? [], dc: rule.escapeDc ?? (caster ? spellSaveDcFor(caster, entry.spell) : null) ?? 13, ...(rule.escapeSave ? { save: rule.escapeSave } : {}) };
    }
  }
  return null;
}

// Whether an enemy is held by a spell it can break, for the escape action.
export function enemySpellHold(enemy: EncounterEnemy): boolean {
  return holdOn(enemy.conditions, enemy.conditionMeta as ConditionMetaMap) !== null;
}

export function characterSpellHold(sheet: CharacterSheet): boolean {
  return holdOn(sheet.conditions, sheet.conditionMeta as ConditionMetaMap) !== null;
}

// An enemy's action to break a spell's hold: the better of its allowed
// ability checks against the caster's DC.
export function enemySpellEscape(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy): Record<string, unknown> {
  const hold = holdOn(enemy.conditions, enemy.conditionMeta as ConditionMetaMap);
  const encounter = getActiveEncounter(campaign.id);
  if (!hold || !encounter) {
    return { error: `${enemy.displayName} is held by nothing it can break free of.` };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  markEnemyActed(encounter, enemy.id);
  saveEncounter(encounter);
  const mod = Math.max(...hold.abilities.map((ability) => Math.floor(((enemy.stats.abilities?.[ability] ?? 10) - 10) / 2)));
  const saved = hold.save
    ? rollEnemySave(campaign.id, enemy, hold.save, hold.dc, { magical: true, record: { turn, detail: `${enemy.displayName}: ${hold.save.toUpperCase()} save against ${hold.spell}` } })
    : null;
  const total = saved ? (saved.total ?? 0) : rollExpression(d20Expression(mod)).total;
  const escaped = saved ? saved.success : total >= hold.dc;
  if (escaped) {
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, [hold.name]);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
  }
  return {
    ok: true,
    action: "escape",
    check: `${total} vs DC ${hold.dc}`,
    success: escaped,
    note: escaped
      ? `${enemy.displayName} tears free of ${hold.spell}; it used its action to do it.`
      : `${enemy.displayName} strains against ${hold.spell} and stays ${hold.name}; its action is spent.`,
  };
}

// A character's action to break a spell's hold. The caller has priced the
// action; `spend` pays it.
export function characterSpellEscape(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  spend: () => void,
): Record<string, unknown> {
  const hold = holdOn(sheet.conditions, sheet.conditionMeta as ConditionMetaMap);
  if (!hold) {
    return { error: `${sheet.name} is held by nothing they can break free of.` };
  }
  spend();
  if (hold.save) {
    const save = rollCharacterSave(campaign, turn, sheet, hold.save, hold.dc, `${hold.save.toUpperCase()} save against ${hold.spell}`, "spell");
    if (save.success) {
      const fresh = getSheetById(sheet.id) ?? sheet;
      const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [hold.name]);
      const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
    return { ok: true, action: "escape", save: `${save.total} vs DC ${hold.dc}`, success: save.success, note: save.success ? `${sheet.name} breaks free of ${hold.spell}.` : `${sheet.name} is still ${hold.name} by ${hold.spell}.` };
  }
  const checks = hold.abilities.map((ability) =>
    rollCharacterCheck(campaign, sheet, { ability }, `${sheet.name}: ${ability.toUpperCase()} check to break free of ${hold.spell}`),
  );
  for (const check of checks) {
    if (check.rollId) {
      turn.rollIds.push(check.rollId);
    }
  }
  const best = Math.max(...checks.map((check) => (check.autoFailed ? 0 : check.total)));
  const escaped = best >= hold.dc;
  if (escaped) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [hold.name]);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return {
    ok: true,
    action: "escape",
    check: `${best} vs DC ${hold.dc}`,
    success: escaped,
    note: escaped ? `${sheet.name} breaks free of ${hold.spell}.` : `${sheet.name} is still ${hold.name} by ${hold.spell}.`,
  };
}
