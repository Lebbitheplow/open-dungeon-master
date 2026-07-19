import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { listEnemies, patchEnemyConditions, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { saveModFor } from "@/lib/bestiary/statblock";
import { removeConditions, tickConditions } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";

// Round-wrap condition upkeep: timed conditions count down and expire,
// save-ends conditions get their re-save rolled server-side (enemy saves
// from stat blocks, character saves from real sheet modifiers with a
// published dice card). Called from advancePointer when the initiative
// order wraps; must not import encounter-tools (the import points the
// other way).

export function tickEncounterConditions(campaign: Campaign, encounter: Encounter) {
  const lines: string[] = [];

  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || !enemy.conditions.length) {
      continue;
    }
    const tick = tickConditions(enemy.conditions, enemy.conditionMeta);
    let conditions = tick.conditions;
    let meta = tick.meta;
    for (const name of tick.expired) {
      lines.push(`${enemy.displayName} is no longer ${name} (the effect ran its course).`);
    }
    for (const due of tick.savesDue) {
      if (!conditions.includes(due.name)) {
        continue;
      }
      const outcome = rollExpression(d20Expression(saveModFor(enemy.stats, due.ability)));
      if (outcome.total >= due.dc) {
        const removed = removeConditions(conditions, meta, [due.name]);
        conditions = removed.conditions;
        meta = removed.meta;
        lines.push(
          `${enemy.displayName} shakes off ${due.name} (${due.ability.toUpperCase()} save ${outcome.total} vs DC ${due.dc}).`,
        );
      } else {
        lines.push(
          `${enemy.displayName} stays ${due.name} (${due.ability.toUpperCase()} save ${outcome.total} vs DC ${due.dc}).`,
        );
      }
    }
    if (
      conditions.length !== enemy.conditions.length ||
      JSON.stringify(meta) !== JSON.stringify(enemy.conditionMeta)
    ) {
      patchEnemyConditions(enemy.id, conditions, meta);
    }
  }

  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (!sheet.conditions.length || !Object.keys(sheet.conditionMeta).length) {
      continue;
    }
    const tick = tickConditions(sheet.conditions, sheet.conditionMeta);
    let conditions = tick.conditions;
    let meta = tick.meta;
    for (const name of tick.expired) {
      lines.push(`${sheet.name} is no longer ${name} (the effect ran its course).`);
    }
    for (const due of tick.savesDue) {
      if (!conditions.includes(due.name)) {
        continue;
      }
      const saveMod = computeSheetDerived(sheet).saves[due.ability];
      const outcome = rollExpression(d20Expression(saveMod));
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "saving_throw",
        detail: `${due.ability.toUpperCase()} save to end ${due.name}`,
        dc: due.dc,
        result: outcome,
      });
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
        roll,
        source: "digital",
      });
      if (outcome.total >= due.dc) {
        const removed = removeConditions(conditions, meta, [due.name]);
        conditions = removed.conditions;
        meta = removed.meta;
        lines.push(
          `${sheet.name} shakes off ${due.name} (${due.ability.toUpperCase()} save ${outcome.total} vs DC ${due.dc}).`,
        );
      } else {
        lines.push(
          `${sheet.name} stays ${due.name} (${due.ability.toUpperCase()} save ${outcome.total} vs DC ${due.dc}).`,
        );
      }
    }
    if (
      conditions.length !== sheet.conditions.length ||
      JSON.stringify(meta) !== JSON.stringify(sheet.conditionMeta)
    ) {
      const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }

  if (lines.length) {
    publishEncounter(campaign.id);
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      content: lines.join(" "),
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
  }
}
