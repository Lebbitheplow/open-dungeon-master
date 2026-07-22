import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { findSpellByName, spellMechanicsFor } from "@/lib/content";
import { allySaveAura } from "@/lib/dm/aura";
import { computeSheetDerived } from "@/lib/srd";
import { conditionConcentrationFloor } from "@/lib/srd/condition-effects";
import { removeConditions } from "@/lib/dm/condition-logic";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Server-tracked concentration: casting a concentration spell sets it (and
// breaks the previous one), taking damage forces the CON save server-side,
// and dropping to 0 HP always ends it. This module must not import
// mutations.ts (which imports it). Enemy concentration is out of scope;
// enemies have no tracked spells.

// Whether a spell requires concentration: exact-name match against the
// Open5e content pack plus the caster's homebrew. Null when unknown.
export function spellRequiresConcentration(spellName: string, userId: string): boolean | null {
  const exact = findSpellByName(spellName, userId);
  return exact ? exact.concentration : null;
}

function writeConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  concentratingOn: string | null,
  reason: string,
) {
  const patch = { concentratingOn };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind: "concentration",
    delta: patch,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Sets concentration on a newly cast spell; returns the spell it displaced,
// if any. Caller has already verified the spell requires concentration.
export function setConcentration(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  spell: string,
): { displaced: string | null } {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return { displaced: null };
  }
  const displaced = sheet.concentratingOn && sheet.concentratingOn !== spell
    ? sheet.concentratingOn
    : null;
  writeConcentration(campaign, turnId, sheet, spell, `casting ${spell}`);
  return { displaced };
}

export function breakConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheetId: string,
  cause: string,
): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet?.concentratingOn) {
    return null;
  }
  const spell = sheet.concentratingOn;
  writeConcentration(campaign, turnId, sheet, null, cause);
  // The spell's lingering effect conditions end with the concentration:
  // Bless's dice, Haste's action, Hold Person's paralysis all stop here
  // instead of waiting for their duration to expire.
  clearSpellConditionsByName(campaign, spell, sheet.userId);
  return spell;
}

// Removes the effect conditions a broken concentration spell was holding in
// place, from every party sheet and every living enemy in the active
// encounter. Best effort: an unknown/homebrew spell simply clears nothing.
// Shared by PC concentration (above) and enemy concentration breaks
// (src/lib/dm/enemy-damage.ts), which have no caster userId.
export function clearSpellConditionsByName(
  campaign: Campaign,
  spell: string,
  userId?: string,
) {
  const resolved = spellMechanicsFor({ spell, userId });
  if (!resolved) {
    return;
  }
  const wanted = new Set(
    [
      resolved.mech.buff?.condition,
      ...(resolved.mech.buff?.variants ?? []),
      resolved.mech.condition?.name,
    ]
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase()),
  );
  if (!wanted.size) {
    return;
  }
  for (const target of listSheets(campaign.id)) {
    const held = target.conditions.filter((condition) => wanted.has(condition.toLowerCase()));
    // A polymorphed target reverts to their own body with the condition.
    const revertsForm =
      wanted.has("polymorphed") && target.wildShape?.kind === "polymorph";
    if (!held.length && !revertsForm) {
      continue;
    }
    const cleared = removeConditions(target.conditions, target.conditionMeta, held);
    const updated = patchSheet(target.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
      ...(revertsForm ? { wildShape: null } : {}),
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return;
  }
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive") {
      continue;
    }
    const held = (enemy.conditions ?? []).filter((condition) =>
      wanted.has(condition.toLowerCase()),
    );
    if (held.length) {
      const cleared = removeConditions(enemy.conditions ?? [], enemy.conditionMeta, held);
      patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    }
  }
}

// Called from apply_damage after HP lands. Rolls the CON save (DC 10 or
// half the damage, whichever is higher) with a visible dice card; dropping
// to 0 HP breaks concentration without a save.
export function concentrationDamageHook(
  campaign: Campaign,
  turnId: string,
  preSheet: CharacterSheet,
  damage: number,
): Record<string, unknown> {
  if (!preSheet.concentratingOn || damage < 1) {
    return {};
  }
  const fresh = getSheetById(preSheet.id);
  if (!fresh?.concentratingOn) {
    return {};
  }
  const spell = fresh.concentratingOn;
  if (fresh.currentHp <= 0) {
    breakConcentration(campaign, turnId, fresh.id, "dropped to 0 HP");
    return { concentrationBroken: spell };
  }
  const dc = Math.max(10, Math.floor(damage / 2));
  // A nearby paladin's aura protects concentration checks too (map-scoped).
  const aura = allySaveAura(campaign.id, fresh);
  const saveMod = computeSheetDerived(fresh).saves.con + (aura?.bonus ?? 0);
  const outcome = rollExpression(d20Expression(saveMod));
  // Starry Form (Dragon) and its kin floor a low concentration d20 at 10.
  const floor = conditionConcentrationFloor(fresh.conditions);
  if (floor && outcome.natural !== undefined && outcome.natural < floor) {
    const floored = outcome.total - outcome.natural + floor;
    outcome.total = Math.max(outcome.total, floored);
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: fresh.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `CON save to keep concentration (${spell})`,
    dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const held = outcome.total >= dc;
  if (!held) {
    breakConcentration(campaign, turnId, fresh.id, `failed the DC ${dc} CON save`);
  }
  return { concentration: { spell, dc, rolled: outcome.total, held } };
}
