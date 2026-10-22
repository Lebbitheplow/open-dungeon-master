import type { Campaign } from "@/lib/db/campaigns";
import { deleteEffect, listEffects } from "@/lib/db/active-effects";
import { listEnemies, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";

// The save an active effect offers to end it (set_effect's saveAbility and
// saveDc). The target rolls at the end of each of its turns, as a save-ends
// condition does (SRD 5.1, Hold Person: "at the end of each of its turns"),
// from the same hooks: endTurnSaves for the combatants whose turns ended,
// the round wrap for a target the order does not hold, and one roll per
// stretch of in-world time outside a fight (tickClockConditions). Success
// lifts the effect. Called from src/lib/dm/condition-tick.ts.
export function rollEffectSaves(
  campaign: Campaign,
  encounter: Encounter | null,
  saves: (targetId: string) => boolean,
  lines: string[],
) {
  let lifted = false;
  for (const effect of listEffects(campaign.id)) {
    if (!effect.saveAbility || !effect.saveDc || !saves(effect.targetId)) {
      continue;
    }
    const ability = effect.saveAbility as SaveAbility;
    // A hidden effect (a curse nobody has noticed) is not named to the table:
    // the save is asked for, as a DM would ask, and its end goes unannounced.
    const label = effect.visible ? `${ability.toUpperCase()} save to end ${effect.name}` : `${ability.toUpperCase()} save`;
    let who: string;
    let success: boolean;
    let shown: string;
    if (effect.targetKind === "enemy") {
      const enemy = encounter ? listEnemies(encounter.id).find((entry) => entry.id === effect.targetId && entry.status === "alive") : null;
      if (!enemy) {
        continue;
      }
      const save = rollEnemySave(campaign.id, enemy, ability, effect.saveDc, { against: effect.name, record: { detail: `${enemy.displayName}: ${ability.toUpperCase()} save to end ${effect.name}` } });
      who = enemy.displayName;
      success = save.success;
      shown = save.total === null ? "an automatic failure" : String(save.total);
    } else {
      const sheet = getSheetById(effect.targetId);
      if (!sheet || sheet.campaignId !== campaign.id) {
        continue;
      }
      const save = rollCharacterSave(campaign, null, sheet, ability, effect.saveDc, label);
      who = sheet.name;
      success = save.success;
      shown = save.total === null ? "an automatic failure" : String(save.total);
    }
    if (success && deleteEffect(campaign.id, effect.id)) {
      lifted = true;
      if (effect.visible) {
        lines.push(`${who} shakes off ${effect.name} (${ability.toUpperCase()} save ${shown} vs DC ${effect.saveDc}).`);
      }
    }
  }
  if (lifted) {
    publishPersisted(campaign.id, "effects_updated", { effects: listEffects(campaign.id) });
  }
}
