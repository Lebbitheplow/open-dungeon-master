// Damage landing on a character: the one path for it.
//
// apply_damage (src/lib/dm/mutations.ts) is the model's and the DM's door
// and clamps what they send to the tool's declared 1 to 200. The engine's
// own callers, which rolled their dice themselves (a fall, a creature out of
// air), come straight here with what they rolled, so a 20d6 fall or the
// whole pool of a drowning character is never cut to the rail meant for an
// argument somebody typed.
//
// Order, per SRD 5.1: resistance, then temporary hit points, then hit
// points; a beast form's pool before the druid's own. Dropping to 0 runs the
// death engine, and damage forces the concentration save.
//
// This module must not import mutations.ts (which imports it).
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import { RAGING, spendRelentlessEndurance } from "@/lib/srd/class-resources";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { applyDamageMath, wildShapeDamageMath } from "@/lib/dm/mutation-math";
import { applyDamageDeathHook } from "@/lib/dm/death";
import { isMassiveDamage } from "@/lib/dm/death-logic";
import { concentrationDamageHook } from "@/lib/dm/concentration";
import {
  damageAdjust,
  effectiveMaxHp,
  pcResistances,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { PRONE } from "@/lib/dm/vitals-logic";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

export type PcDamageInput = {
  // What was rolled or sent, before resistance.
  amount: number;
  type?: string;
  // A critical hit: two death save failures on a character already at 0.
  crit?: boolean;
  // From a spell, a magic weapon or strikes that count as magical, so
  // resistance to nonmagical attacks does not apply.
  magical?: boolean;
  // The creature lands prone if any of this damage gets through (a fall).
  knocksProne?: boolean;
  reason?: string;
};

function audit(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  kind: string,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

export function applyPcDamage(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  input: PcDamageInput,
): Record<string, unknown> {
  const amount = Math.floor(input.amount);
  const reason = (input.reason ?? "").slice(0, 200);
  if (!(amount >= 1)) {
    return { error: "apply_damage needs a positive amount." };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is already dead.` };
  }
  // Racial, feature and condition resistances halve matching damage types
  // server-side.
  const adjusted = damageAdjust(amount, input.type, pcResistances(sheet), "", "", {
    magical: input.magical === true,
  });
  // Wild Shape: the beast's hit points take the blow first. While the form
  // holds, the druid's own sheet is untouched and no death hook fires; when
  // it breaks, only the excess carries through into the rest of this same
  // call. Concentration is different: transforming does not end it, so the
  // whole blow, taken in either body, forces the save (SRD 5.1 Wild Shape).
  let carried = adjusted.amount;
  let tempHpNow = sheet.tempHp;
  let shapeInfo: Record<string, unknown> = {};
  if (sheet.wildShape) {
    const shape = wildShapeDamageMath(sheet.wildShape.beastHp, sheet.tempHp, adjusted.amount);
    const form = sheet.wildShape.form;
    // A polymorph breaking on damage also drops its tracked condition.
    const dropPolymorph =
      shape.reverted &&
      sheet.wildShape.kind === "polymorph" &&
      sheet.conditions.some((name) => name.toLowerCase() === "polymorphed");
    const clearedConditions = dropPolymorph
      ? removeConditions(sheet.conditions, sheet.conditionMeta, ["polymorphed"])
      : null;
    const patch: FullPatchSheetInput = shape.reverted
      ? {
          wildShape: null,
          tempHp: shape.tempHp,
          ...(clearedConditions
            ? {
                conditions: clearedConditions.conditions,
                conditionMeta: clearedConditions.meta,
              }
            : {}),
        }
      : {
          wildShape: { ...sheet.wildShape, beastHp: shape.beastHp },
          tempHp: shape.tempHp,
        };
    patchSheet(sheet.id, patch);
    // currentHp rides along unchanged: it is what the event log reports
    // and the druid's own pool genuinely did not move.
    audit(
      campaign,
      turnId,
      sheet,
      "apply_damage",
      { amount, form, currentHp: sheet.currentHp, ...shape },
      reason,
      patch,
    );
    publishSheet(campaign, sheet.id);
    if (!shape.reverted) {
      const proneInfo = landProne(campaign, turnId, sheet.id, input, adjusted.amount, reason);
      const concentrationInfo = concentrationDamageHook(campaign, turnId, sheet, adjusted.amount);
      return {
        ok: true,
        form: `${form}: ${shape.beastHp}/${sheet.wildShape.beastMaxHp} HP`,
        ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
        ...(shape.absorbed ? { tempHpAbsorbed: shape.absorbed } : {}),
        ...proneInfo,
        note: `The beast form absorbs it; ${sheet.name}'s own hit points are untouched.`,
        ...concentrationInfo,
      };
    }
    carried = shape.carryover;
    tempHpNow = shape.tempHp;
    shapeInfo = {
      wildShape: `${form} collapses and ${sheet.name} returns to their own body${
        carried > 0 ? `, taking the remaining ${carried} damage` : " unharmed by the excess"
      }.`,
    };
  }

  const math = applyDamageMath(sheet.currentHp, tempHpNow, carried);
  // Damage taken keeps a rage alive through a turn with no attack in it
  // (src/lib/dm/condition-tick.ts endTurnRage).
  const ragingAs = sheet.conditions.find((entry) => entry.toLowerCase() === RAGING);
  const stoked: { conditionMeta?: ConditionMetaMap } =
    ragingAs && carried > 0
      ? {
          conditionMeta: {
            ...(sheet.conditionMeta as ConditionMetaMap),
            [ragingAs]: { ...(sheet.conditionMeta as ConditionMetaMap)[ragingAs], stoked: true },
          },
        }
      : {};
  patchSheet(sheet.id, { currentHp: math.currentHp, tempHp: math.tempHp, ...stoked });
  audit(campaign, turnId, sheet, "apply_damage", { amount, ...math, type: input.type ?? "" }, reason, {
    currentHp: math.currentHp,
    tempHp: math.tempHp,
    ...stoked,
  });
  publishSheet(campaign, sheet.id);
  const proneInfo = landProne(campaign, turnId, sheet.id, input, adjusted.amount, reason);
  // Relentless Endurance: a half-orc who would drop stays up at 1 HP
  // instead, once per long rest. The server burns the use itself, so the
  // death engine never sees the drop. It answers being reduced to 0 "but not
  // killed outright", so massive damage goes past it to the death engine
  // with the use unspent.
  if (math.dropped && !isMassiveDamage(math.overkill, effectiveMaxHp(sheet))) {
    const spent = spendRelentlessEndurance(sheet.resources);
    if (spent) {
      const patch: FullPatchSheetInput = { currentHp: 1, resources: spent };
      patchSheet(sheet.id, patch);
      audit(campaign, turnId, sheet, "apply_damage", { relentlessEndurance: true }, reason, patch);
      publishSheet(campaign, sheet.id);
      return {
        ok: true,
        hp: `1/${effectiveMaxHp(sheet)}`,
        relentlessEndurance: true,
        ...shapeInfo,
        ...proneInfo,
        note: `${sheet.name} should have fallen, but Relentless Endurance holds them at 1 HP. The feature is now spent until a long rest.`,
      };
    }
  }
  // A barbarian knocked unconscious stops raging. Checked after Relentless
  // Endurance, which keeps them on their feet still raging.
  let rageInfo: Record<string, unknown> = {};
  if (math.dropped && sheet.conditions.some((entry) => entry.toLowerCase() === RAGING)) {
    const now = getSheetById(sheet.id) ?? sheet;
    const cleared = removeConditions(now.conditions, now.conditionMeta, [RAGING]);
    const patch: FullPatchSheetInput = {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    };
    patchSheet(sheet.id, patch);
    audit(campaign, turnId, now, "clear_condition", { condition: RAGING }, reason, patch);
    publishSheet(campaign, sheet.id);
    rageInfo = { rageEnded: `${sheet.name}'s rage ends as they fall.` };
  }
  // Death engine: dropping to 0 starts the dying track; damage while
  // already down adds automatic failures; massive damage kills.
  const deathInfo = applyDamageDeathHook(campaign, turnId, sheet, math, input.crit === true);
  // Concentration: damage forces the CON save server-side. A form that broke
  // took the blow too, so the save is against all of it.
  const concentrationInfo = concentrationDamageHook(
    campaign,
    turnId,
    sheet,
    sheet.wildShape ? adjusted.amount : carried,
  );
  return {
    ok: true,
    hp: `${math.currentHp}/${effectiveMaxHp(sheet)}`,
    ...shapeInfo,
    ...rageInfo,
    ...proneInfo,
    ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
    ...(math.absorbed ? { tempHpAbsorbed: math.absorbed } : {}),
    ...(math.dropped && !("note" in deathInfo)
      ? { dropped: true, note: `${sheet.name} falls to 0 HP.` }
      : math.dropped
        ? { dropped: true }
        : {}),
    ...deathInfo,
    ...concentrationInfo,
  };
}

// A fall that hurt leaves the creature on the ground (SRD 5.1, Falling: it
// lands prone unless it avoids taking damage from the fall).
function landProne(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  input: PcDamageInput,
  taken: number,
  reason: string,
): Record<string, unknown> {
  if (!input.knocksProne || taken <= 0) {
    return {};
  }
  const now = getSheetById(sheetId);
  if (!now || now.conditions.some((entry) => entry.toLowerCase() === PRONE)) {
    return {};
  }
  const patch: FullPatchSheetInput = { conditions: [...now.conditions, PRONE] };
  patchSheet(sheetId, patch);
  audit(campaign, turnId, now, "set_condition", { condition: PRONE }, reason, patch);
  publishSheet(campaign, sheetId);
  return { prone: `${now.name} lands prone.` };
}
