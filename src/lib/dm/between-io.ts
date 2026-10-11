// The reads and writes the between-adventures engines share: their state on
// the clock, a character's saving throw rolled and stored like any other,
// and the table note and sheet push every engine sends
// (src/lib/dm/afflictions.ts, src/lib/dm/lifestyle.ts).

import type { SystemGlyph } from "@/lib/system-glyphs";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getClock, setClock } from "@/lib/db/clock";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { Affliction, DowntimeProgress, Lifestyle } from "@/lib/dm/between-state";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export function tableNote(campaign: Campaign, content: string, glyph: SystemGlyph) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph, content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

export function publishSheetOf(campaignId: string, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (sheet) {
    publishPersisted(campaignId, "sheet_updated", { sheet });
  }
}

// ---- state on the clock ----

export function afflictionsOf(campaignId: string, characterId: string): Affliction[] {
  return getClock(campaignId).afflictions?.[characterId] ?? [];
}

export function writeAfflictions(campaignId: string, characterId: string, list: Affliction[]) {
  const clock = getClock(campaignId);
  const afflictions = { ...(clock.afflictions ?? {}) };
  if (list.length) {
    afflictions[characterId] = list.slice(0, 12);
  } else {
    delete afflictions[characterId];
  }
  const { afflictions: _old, ...rest } = clock;
  void _old;
  setClock(campaignId, Object.keys(afflictions).length ? { ...rest, afflictions } : rest);
}

export function lifestyleOf(campaignId: string, characterId: string): Lifestyle | null {
  return getClock(campaignId).lifestyles?.[characterId] ?? null;
}

export function writeLifestyle(campaignId: string, characterId: string, lifestyle: Lifestyle | null) {
  const clock = getClock(campaignId);
  const lifestyles = { ...(clock.lifestyles ?? {}) };
  if (lifestyle) {
    lifestyles[characterId] = lifestyle;
  } else {
    delete lifestyles[characterId];
  }
  const { lifestyles: _old, ...rest } = clock;
  void _old;
  setClock(campaignId, Object.keys(lifestyles).length ? { ...rest, lifestyles } : rest);
}

export function downtimeOf(campaignId: string, characterId: string): DowntimeProgress {
  return getClock(campaignId).downtime?.[characterId] ?? {};
}

export function writeDowntime(campaignId: string, characterId: string, progress: DowntimeProgress) {
  const clock = getClock(campaignId);
  const downtime = { ...(clock.downtime ?? {}) };
  if (Object.keys(progress).length) {
    downtime[characterId] = progress;
  } else {
    delete downtime[characterId];
  }
  const { downtime: _old, ...rest } = clock;
  void _old;
  setClock(campaignId, Object.keys(downtime).length ? { ...rest, downtime } : rest);
}

// ---- a character's save ----

export type SaveOutcome = { success: boolean; total: number; failBy: number; autoFailed: boolean };

// A saving throw rolled from the sheet like any other (conditions, traits
// keyed to what it resists, a held Bardic Inspiration), stored as a roll and
// published. `advantage` for what the caller knows that the sheet does not
// (a recuperation against this disease).
export function characterSave(
  campaign: Campaign,
  sheet: CharacterSheet,
  input: { ability: Ability; dc: number; detail: string; against?: string; advantage?: boolean },
): SaveOutcome {
  const args = {
    kind: "saving_throw",
    ability: input.ability,
    dc: input.dc,
    ...(input.against ? { against: input.against } : {}),
    ...(input.advantage ? { advantage: "advantage" } : {}),
  } as unknown as RollArgs;
  const resolved = resolveRollExpression(args, sheet, rollExtrasFor(campaign, sheet, "saving_throw"));
  if ("error" in resolved) {
    return { success: false, total: 0, failBy: input.dc, autoFailed: true };
  }
  if ("autoFail" in resolved) {
    return { success: false, total: 0, failBy: input.dc, autoFailed: true };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: input.detail.slice(0, 200),
    dc: input.dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  return { success: outcome.total >= input.dc, total: outcome.total, failBy: Math.max(0, input.dc - outcome.total), autoFailed: false };
}

// A die the table sees, for a duration or a DC drop.
export function publicDie(campaign: Campaign, sheet: CharacterSheet | null, expression: string, detail: string): number {
  const outcome = rollExpression(expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet?.id ?? null,
    requestedBy: "dm",
    kind: "custom",
    detail: detail.slice(0, 200),
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  return outcome.total;
}
