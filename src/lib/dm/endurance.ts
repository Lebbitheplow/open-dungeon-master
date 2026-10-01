// Hour-by-hour Constitution saves against exhaustion: a forced march past
// eight hours, a day in extreme heat or cold. One save at the end of each
// hour, each with its own DC, each failure one level of exhaustion (SRD 5.1,
// Travel Pace, Forced March; the DMG's weather rules the SRD's Gamemastering
// section carries). Before this a twelve-hour march rolled one save at the
// last hour's DC and could cost one level at most.
//
// Every save rides the character's own roll path, so a held Bardic
// Inspiration, Help or Guidance is folded in and spent by the save it rides.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type HourSave = {
  hour: number;
  dc: number;
  // Null when a condition failed the save with no die rolled.
  save: number | null;
  failed: boolean;
  exhaustion?: number;
};

// One character's saves, hour by hour. Stops at death: exhaustion 6 kills.
export function hourlyConSaves(input: {
  campaign: Campaign;
  turn: DmTurn;
  sheet: CharacterSheet;
  hours: Array<{ hour: number; dc: number }>;
  disadvantage?: boolean;
  detail: (hour: number) => string;
  reason: string;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): HourSave[] {
  const { campaign, turn } = input;
  const out: HourSave[] = [];
  for (const { hour, dc } of input.hours) {
    const sheet = getSheetById(input.sheet.id) ?? input.sheet;
    if (sheet.deathSaves?.dead) {
      break;
    }
    const args = {
      kind: "saving_throw",
      ability: "con",
      dc,
      ...(input.disadvantage ? { advantage: "disadvantage" } : {}),
    } as unknown as RollArgs;
    const resolved = resolveRollExpression(args, sheet, rollExtrasFor(campaign, sheet, "saving_throw"));
    if ("error" in resolved) {
      break;
    }
    let failed: boolean;
    let save: number | null = null;
    if ("autoFail" in resolved) {
      failed = true;
    } else {
      spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
      const rolled = rollExpression(resolved.expression);
      save = rolled.total;
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "saving_throw",
        detail: input.detail(hour),
        dc,
        result: rolled,
      });
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
      turn.rollIds.push(roll.id);
      failed = rolled.total < dc;
    }
    const entry: HourSave = { hour, dc, save, failed };
    if (failed) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "set_condition",
        JSON.stringify({ characterId: sheet.id, condition: "exhaustion", reason: input.reason }),
        input.sheets,
        input.sheetsById,
      ).result as { level?: number };
      if (typeof applied.level === "number") {
        entry.exhaustion = applied.level;
      }
    }
    out.push(entry);
  }
  return out;
}
