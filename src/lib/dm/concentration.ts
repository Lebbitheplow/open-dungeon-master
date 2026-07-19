import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { searchSpells } from "@/lib/content";
import { computeSheetDerived } from "@/lib/srd";
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
  const wanted = spellName.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const matches = searchSpells({ q: spellName.trim(), userId, limit: 10 });
  const exact = matches.find((entry) => entry.name.trim().toLowerCase() === wanted);
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
  return spell;
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
  const saveMod = computeSheetDerived(fresh).saves.con;
  const outcome = rollExpression(d20Expression(saveMod));
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
