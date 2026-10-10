// Prismatic Spray's violet ray, the part that outlives the casting: a blinded
// creature makes a Wisdom save as its caster's next turn starts (SRD 5.1).
// Kept apart from prismatic.ts, which resolves the cone through the mutation
// dispatcher: condition-tick.ts imports this, and the clock imports
// condition-tick.ts, so pulling the dispatcher in here closes an import cycle.
import type { Campaign } from "@/lib/db/campaigns";
import { createDmTurn, saveDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { spellSaveDcFor } from "@/lib/srd";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { sendHome } from "@/lib/dm/spell-planes";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const VIOLET = "Violet Ray";
export const VIOLET_MARK = "violet ray";

const holdsMark = (conditions: string[]) => conditions.some((entry) => entry.toLowerCase() === VIOLET_MARK);

// Takes the violet ray's blindness and its mark off a conditions list.
function withoutViolet(conditions: string[], meta: ConditionMetaMap): { conditions: string[]; meta: ConditionMetaMap } {
  const ending = conditions.filter((name) => name.toLowerCase() === VIOLET_MARK || (name === "blinded" && meta[name]?.spell === VIOLET));
  const cleared = removeConditions(conditions, meta, ending);
  return { conditions: cleared.conditions, meta: cleared.meta as ConditionMetaMap };
}

// The violet ray's Wisdom save as its caster's turn starts: success ends the
// blindness; failure sends the creature to another plane, out of the fight
// (a character is left "banished" for the DM to place).
export function violetRayTurnStart(campaign: Campaign, combatantIds: string[]): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const casters = combatantIds.map((id) => getSheetById(id)).filter((sheet): sheet is CharacterSheet => Boolean(sheet));
  if (!encounter || !casters.length) {
    return [];
  }
  const held = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && holdsMark(enemy.conditions));
  const heldSheets = listSheets(campaign.id).filter((sheet) => holdsMark(sheet.conditions));
  if (!held.length && !heldSheets.length) {
    return [];
  }
  const lines: string[] = [];
  const turn = createDmTurn(campaign.id, [], "human_dm");
  try {
    const sheets = listSheets(campaign.id);
    const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    for (const caster of casters) {
      const dc = spellSaveDcFor(caster, "Prismatic Spray") ?? 13;
      for (const enemy of held.filter((entry) => (entry.conditionMeta as ConditionMetaMap)[VIOLET_MARK]?.source === caster.id)) {
        const save = rollEnemySave(campaign.id, enemy, "wis", dc, { magical: true, resist: true, record: { turn, detail: `${enemy.displayName}: WIS save against Prismatic Spray's violet ray` } });
        const cleared = withoutViolet(enemy.conditions, enemy.conditionMeta as ConditionMetaMap);
        patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
        lines.push(
          save.success
            ? `${enemy.displayName} shakes off the violet ray: its sight returns.`
            : (sendHome(campaign, turn, getEnemy(enemy.id) ?? enemy, "any", "Prismatic Spray's violet ray", sheets, byId) ?? `${enemy.displayName} fails its WIS save against the violet ray.`),
        );
      }
      for (const sheet of heldSheets.filter((entry) => (entry.conditionMeta as ConditionMetaMap)[VIOLET_MARK]?.source === caster.id)) {
        const save = rollCharacterSave(campaign, turn, sheet, "wis", dc, "WIS save against Prismatic Spray's violet ray", "spell");
        const cleared = withoutViolet(sheet.conditions, sheet.conditionMeta as ConditionMetaMap);
        const updated = patchSheet(sheet.id, {
          conditions: save.success ? cleared.conditions : [...cleared.conditions, "banished"],
          conditionMeta: save.success ? cleared.meta : { ...cleared.meta, banished: { spell: VIOLET, source: caster.id } },
        });
        if (updated) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
        }
        lines.push(save.success ? `${sheet.name}'s sight returns.` : `${sheet.name} is sent to another plane by the violet ray (the DM decides which).`);
      }
    }
  } finally {
    turn.status = "done";
    saveDmTurn(turn);
  }
  publishEncounter(campaign.id);
  return lines;
}
