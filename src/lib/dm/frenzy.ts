// Frenzy (SRD 5.1, Path of the Berserker): while raging in a frenzy the
// barbarian makes a melee weapon attack as a bonus action each turn, and when
// the rage ends they suffer one level of exhaustion.
//
// A rage ends in many places (a turn with no attack, a fall to 0, the minute
// running out, a rest, the barbarian's own choice), so the frenzy is its own
// condition, "frenzied", which pc_attack writes beside "raging". Whatever
// removes the rage leaves the frenzy behind, and settleFrenzies turns a
// frenzy with no rage under it into the level of exhaustion it costs. It runs
// when a fight ends and at each round wrap.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions } from "@/lib/dm/condition-logic";
import { exhaustionPatch } from "@/lib/dm/vitals-logic";
import { RAGING } from "@/lib/srd/class-resources";

export const FRENZIED = "frenzied";

const holds = (conditions: string[], name: string) =>
  conditions.some((entry) => entry.trim().toLowerCase() === name);

// Every frenzy whose rage is over: the frenzy goes and a level of exhaustion
// comes. Returns one table line per barbarian it caught.
export function settleFrenzies(campaign: Campaign): string[] {
  const lines: string[] = [];
  for (const sheet of listSheets(campaign.id)) {
    if (!holds(sheet.conditions, FRENZIED) || holds(sheet.conditions, RAGING)) {
      continue;
    }
    const frenzyAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === FRENZIED) ?? FRENZIED;
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [frenzyAs]);
    const patch = {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
      ...exhaustionPatch(sheet, (sheet.exhaustion ?? 0) + 1),
    };
    const updated = patchSheet(sheet.id, patch);
    const entry = insertSheetAudit({
      campaignId: campaign.id,
      characterId: sheet.id,
      turnId: null,
      kind: "set_condition",
      delta: { condition: "exhaustion", level: patch.exhaustion },
      reason: "Frenzy: the rage ended",
      seq: allocateSeq(campaign.id),
      before: sheet,
      patch,
    });
    publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(
      patch.exhaustion >= 6
        ? `${sheet.name}'s frenzy burns out with the rage: exhaustion level 6, and they die.`
        : `${sheet.name}'s frenzy ends with the rage: one level of exhaustion (now ${patch.exhaustion}).`,
    );
  }
  return lines;
}
