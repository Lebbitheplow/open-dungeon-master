import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { listEnemies, patchEnemyConditions, type Encounter } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { saveModFor } from "@/lib/bestiary/statblock";
import { allySaveAura } from "@/lib/dm/aura";
import { ROUNDS_PER_MINUTE, removeConditions, tickConditions } from "@/lib/dm/condition-logic";
import { hasBrave } from "@/lib/srd/feature-effects";
import { tickEffectRound } from "@/lib/db/active-effects";

// Condition upkeep: timed conditions count down and expire, save-ends
// conditions get their re-save rolled server-side (enemy saves from stat
// blocks, character saves from real sheet modifiers with a published dice
// card). Two clocks drive it. In combat, advancePointer calls
// tickEncounterConditions when the initiative order wraps, one round at a
// time. Outside combat the in-world clock calls tickClockConditions from
// advanceClock (src/lib/db/clock.ts) with the minutes that passed, so a
// poison that outlasted the fight, or was never in one, still wears off on
// the road or over a night's rest (issue #30). Must not import
// encounter-tools or enemy-damage (the imports point the other way, and the
// clock path would close a cycle through map-tools).

export function tickEncounterConditions(campaign: Campaign, encounter: Encounter) {
  const lines: string[] = [];

  // Active effects count down with conditions, so an effect and a condition
  // applied in the same breath end in the same breath
  // (src/lib/dm/effects-logic.ts).
  for (const expired of tickEffectRound(campaign.id)) {
    lines.push(`${expired.name} wears off.`);
  }

  tickEnemyConditions(encounter, 1, lines);
  tickSheetConditions(campaign, 1, lines);

  if (lines.length) {
    publishPersisted(campaign.id, "encounter_updated", {
      encounter: activePublicEncounter(campaign.id),
    });
    noteAtTable(campaign.id, lines);
  }
}

// In-world minutes passing with no encounter running. Minute-based active
// effects are already expired by advanceClock; enemies only exist inside
// encounters, so only the party's sheets tick. A save-ends condition gets
// one save per passage of time rather than one per elapsed round: ten
// minutes of walking is not a hundred saving throws, and one honest roll
// per stretch is how a human DM plays "you can try to shake it off again".
export function tickClockConditions(campaign: Campaign, minutes: number) {
  const rounds = Math.floor(Math.max(0, minutes) * ROUNDS_PER_MINUTE);
  if (rounds <= 0) {
    return;
  }
  const lines: string[] = [];
  tickSheetConditions(campaign, rounds, lines);
  if (lines.length) {
    noteAtTable(campaign.id, lines);
  }
}

function tickEnemyConditions(encounter: Encounter, by: number, lines: string[]) {
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || !enemy.conditions.length) {
      continue;
    }
    const tick = tickConditions(enemy.conditions, enemy.conditionMeta, by);
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
}

function tickSheetConditions(campaign: Campaign, by: number, lines: string[]) {
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (!sheet.conditions.length || !Object.keys(sheet.conditionMeta).length) {
      continue;
    }
    const tick = tickConditions(sheet.conditions, sheet.conditionMeta, by);
    let conditions = tick.conditions;
    let meta = tick.meta;
    for (const name of tick.expired) {
      lines.push(`${sheet.name} is no longer ${name} (the effect ran its course).`);
    }
    for (const due of tick.savesDue) {
      if (!conditions.includes(due.name)) {
        continue;
      }
      // A nearby paladin's aura rides re-saves too (map-scoped).
      const aura = allySaveAura(campaign.id, sheet);
      const saveMod = computeSheetDerived(sheet).saves[due.ability] + (aura?.bonus ?? 0);
      // Brave: advantage on the save to shake off being frightened.
      const brave = due.name.toLowerCase().includes("frighten") && hasBrave(sheet);
      const advantage = brave ? "advantage" : "none";
      const outcome = rollExpression(d20Expression(saveMod, advantage));
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "saving_throw",
        detail: `${due.ability.toUpperCase()} save to end ${due.name}${
          brave ? " (Brave: advantage)" : ""
        }`,
        dc: due.dc,
        ...(brave ? { advantage: "advantage" as const } : {}),
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
      // Polymorph's duration running out reverts the transformation with
      // the condition.
      const polymorphEnded =
        sheet.wildShape?.kind === "polymorph" &&
        sheet.conditions.some((name) => name.toLowerCase() === "polymorphed") &&
        !conditions.some((name) => name.toLowerCase() === "polymorphed");
      if (polymorphEnded) {
        lines.push(`${sheet.name} reverts to their own body as the polymorph ends.`);
      }
      const updated = patchSheet(sheet.id, {
        conditions,
        conditionMeta: meta,
        ...(polymorphEnded ? { wildShape: null } : {}),
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
}

function noteAtTable(campaignId: string, lines: string[]) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: lines.join(" "),
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
