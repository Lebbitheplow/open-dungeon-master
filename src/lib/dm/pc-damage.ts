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
import { immersedResistance } from "@/lib/dm/underwater";
import { deathWardPatch } from "@/lib/dm/spell-effects";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import { RAGING, spendRelentlessEndurance } from "@/lib/srd/class-resources";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { applyDamageMath, wildShapeDamageMath } from "@/lib/dm/mutation-math";
import { applyDamageDeathHook } from "@/lib/dm/death";
import { releaseGrapplesHeldBy } from "@/lib/dm/set-condition";
import { isMassiveDamage } from "@/lib/dm/death-logic";
import { concentrationDamageHook } from "@/lib/dm/concentration";
import {
  damageAdjust,
  effectiveMaxHp,
  pcImmunities,
  pcResistances,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { rollFeatureSave } from "@/lib/dm/contest-roll";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { PRONE } from "@/lib/dm/vitals-logic";
import { authoredAuraResistances } from "@/lib/dm/authored-saves";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { silencedImmunity } from "@/lib/dm/zone-rules";
import { burnWebUnder } from "@/lib/dm/zone-cast";
import { summonImmunities, summonResistances, summonVulnerabilities } from "@/lib/dm/summon-rules";
import { summonAfterDamage } from "@/lib/dm/summon-store";
import { absorbByWard } from "@/lib/dm/arcane-ward";
import { afflictionStress } from "@/lib/dm/afflictions";

export type PcDamageInput = {
  // What was rolled or sent, before resistance.
  amount: number;
  type?: string;
  // A critical hit: two death save failures on a character already at 0.
  crit?: boolean;
  // From a spell, a magic weapon or strikes that count as magical, so
  // resistance to nonmagical attacks does not apply.
  magical?: boolean;
  // From a spell: Spell Resistance and Aura of Warding resist it.
  spell?: boolean;
  // The creature lands prone if any of this damage gets through (a fall).
  knocksProne?: boolean;
  // Disintegrate: dropping to 0 is death, not dying.
  disintegrate?: boolean;
  // The caster's share of a Warding Bond (never shared again).
  bond?: boolean;
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
  // An abjurer's Arcane Ward takes the blow first, as it lands: the ward has
  // none of the wizard's own resistances, immunities or vulnerabilities
  // (Sage Advice Compendium; arcane-ward.ts).
  const arcaneWard = absorbByWard(campaign, sheet, amount);
  const overflow = amount - (arcaneWard?.absorbed ?? 0);
  // Racial, feature and condition resistances halve matching damage types
  // server-side, on what comes through the ward.
  // Immunities from features (Purity of Body: poison) take all of it.
  // An ally's aura adds its own (Aura of Warding, Shielding Storm): authored-saves.ts.
  // A summoned creature keeps its stat block's (summon-rules.ts).
  const resisted = [pcResistances(sheet, { magical: input.magical === true, spell: input.spell === true }), ...authoredAuraResistances(campaign.id, sheet, { spell: input.spell === true }), summonResistances(sheet), immersedResistance(campaign.id, sheet.id)].filter(Boolean).join(", ");
  // Inside Silence, thunder does nothing (zone-rules.ts).
  const adjusted =
    overflow > 0
      ? damageAdjust(overflow, input.type, resisted, `${summonImmunities(sheet)}${pcImmunities(sheet)}${silencedImmunity(campaign.id, sheet.id)}`, summonVulnerabilities(sheet), {
          magical: input.magical === true,
        })
      : { amount: 0, note: null };
  if (adjusted.amount <= 0) {
    return {
      ok: true,
      hp: `${sheet.currentHp}/${effectiveMaxHp(sheet)}`,
      damageApplied: 0,
      ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
      ...(arcaneWard ? { arcaneWard: arcaneWard.note } : {}),
      note: `${sheet.name} takes no damage from it.`,
    };
  }
  // Fire burns away the web around them (zone-cast.ts).
  if (/\bfire\b/i.test(input.type ?? "")) {
    burnWebUnder(campaign, sheet.id);
  }
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
  // Damage is great stress: cackle fever's laughter, madness's confusion
  // (src/lib/dm/afflictions.ts).
  if (carried > 0 && !math.dropped) {
    afflictionStress(campaign, turnId, sheet.id, "damage");
  }
  // A summoned creature at 0 hit points disappears (summon-store.ts).
  const vanished = summonAfterDamage(campaign, sheet, math.dropped, carried);
  if (vanished) {
    return { ok: true, hp: `${math.currentHp}/${sheet.maxHp}`, damageApplied: carried, ...(math.dropped ? { dropped: true } : {}), vanished };
  }
  const bond = wardingBondShare(campaign, turnId, sheet, input, adjusted.amount);
  const proneInfo = { ...landProne(campaign, turnId, sheet.id, input, adjusted.amount, reason), ...bond };
  const ward = math.dropped ? deathWardPatch(getSheetById(sheet.id) ?? sheet) : null;
  if (ward) {
    patchSheet(sheet.id, ward);
    audit(campaign, turnId, sheet, "apply_damage", { deathWard: true }, reason, ward);
    publishSheet(campaign, sheet.id);
    return { ok: true, hp: `1/${effectiveMaxHp(sheet)}`, deathWard: true, ...shapeInfo, ...proneInfo, note: `Death Ward holds ${sheet.name} at 1 HP instead of 0, and the spell ends.` };
  }
  // Relentless Endurance: a half-orc who would drop stays up at 1 HP
  // instead, once per long rest. The server burns the use itself, so the
  // death engine never sees the drop. It answers being reduced to 0 "but not
  // killed outright", so massive damage goes past it to the death engine
  // with the use unspent.
  if (math.dropped && !input.disintegrate && !isMassiveDamage(math.overkill, effectiveMaxHp(sheet))) {
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
  // Relentless Rage (barbarian 11): raging and dropped to 0 but not killed
  // outright, a CON save keeps them at 1 hit point. The DC is 10, 5 more for
  // every use since their last rest, which the counter keeps.
  const relentless = relentlessRage(campaign, turnId, sheet, math, reason);
  if (relentless) {
    return { ...relentless, ...shapeInfo, ...proneInfo };
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
  // Disintegrate leaves nothing to be dying: the drop is death itself.
  const fatal = input.disintegrate && math.dropped ? { ...math, overkill: Math.max(math.overkill, effectiveMaxHp(sheet)) } : math;
  const deathInfo = applyDamageDeathHook(campaign, turnId, sheet, fatal, input.crit === true);
  // Unconscious at 0 is incapacitated: a grapple they held ends.
  const letGo = math.dropped ? releaseGrapplesHeldBy(campaign, sheet.id) : [];
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
    ...(letGo.length ? { grappleEnded: letGo } : {}),
    ...concentrationInfo,
  };
}

function relentlessRage(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  math: { dropped: boolean; overkill: number },
  reason: string,
): Record<string, unknown> | null {
  if (
    !math.dropped ||
    isMassiveDamage(math.overkill, effectiveMaxHp(sheet)) ||
    !sheet.conditions.some((entry) => entry.toLowerCase() === RAGING) ||
    !holdsFeature(sheet, "relentless rage")
  ) {
    return null;
  }
  const used = sheet.resources?.relentless_rage?.used ?? 0;
  const dc = 10 + 5 * used;
  const save = rollFeatureSave(campaign, sheet, "con", dc, "Relentless Rage");
  const now = getSheetById(sheet.id) ?? sheet;
  const resources = {
    ...now.resources,
    relentless_rage: { max: now.resources?.relentless_rage?.max ?? 99, used: used + 1 },
  };
  if (!save.success) {
    patchSheet(sheet.id, { resources });
    return null;
  }
  const patch: FullPatchSheetInput = { currentHp: 1, resources };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, now, "apply_damage", { relentlessRage: true, dc }, reason, patch);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    hp: `1/${effectiveMaxHp(sheet)}`,
    relentlessRage: `CON save ${save.total} against DC ${dc}: ${sheet.name} stays on their feet at 1 hit point, still raging. The next save is DC ${dc + 5} until they rest.`,
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

// Warding Bond: each time the warded creature takes damage, the caster who
// bound it takes the same amount (SRD 5.1). The caster's share is not shared
// again.
function wardingBondShare(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  input: PcDamageInput,
  taken: number,
): Record<string, unknown> {
  const bond = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "warding bond");
  const casterId = bond ? (sheet.conditionMeta as ConditionMetaMap)[bond]?.source : undefined;
  const caster = casterId && casterId !== sheet.id ? getSheetById(casterId) : null;
  if (input.bond || taken <= 0 || !caster || caster.deathSaves?.dead) {
    return {};
  }
  applyPcDamage(campaign, turnId, caster, { amount: taken, bond: true, reason: `Warding Bond with ${sheet.name}` });
  return { wardingBond: `${caster.name} takes the same ${taken} damage through the Warding Bond.` };
}
