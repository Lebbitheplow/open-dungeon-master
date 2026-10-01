// The features that act outside a counter's spend: what a kill, a roll of
// initiative or a moment's choice does for the character who holds them.
// Dark One's Blessing (a kill), Superior Inspiration and Perfect Self
// (initiative), Fiendish Resilience (the damage type chosen after a rest)
// and Stillness of Mind (an action that ends a charm or a fear).
//
// Must not import mutations.ts (which reaches it through feature-spends.ts).
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { initiativeRefills } from "@/lib/srd/resource-refills";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import { removeConditions } from "@/lib/dm/condition-logic";
import { prepareResourceCharge } from "@/lib/dm/resource-turn";
import type { CharacterSheet } from "@/lib/schemas/sheet";

function audit(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: turnId || null,
    kind: "use_resource",
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

// Rolling initiative gives some capstones a use back (Superior Inspiration,
// Perfect Self). request_roll calls this for an initiative roll; the lines it
// returns ride the tool result.
export function applyInitiativeRefills(campaign: Campaign, sheetId: string): string[] {
  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.deathSaves?.dead) {
    return [];
  }
  const refill = initiativeRefills(sheet.resources, sheet.features);
  if (!refill) {
    return [];
  }
  patchSheet(sheet.id, { resources: refill.resources });
  audit(campaign, "", sheet, { initiative: refill.notes }, "rolled initiative", { resources: refill.resources });
  publishSheet(campaign, sheet.id);
  return refill.notes;
}

// Dark One's Blessing (Fiend warlock 1): reducing a hostile creature to 0
// hit points gives the warlock temporary hit points equal to their Charisma
// modifier plus their warlock level (minimum 1). Temporary hit points never
// stack; the larger stands. The attack and spell paths call this on a kill.
export function darkOnesBlessing(campaign: Campaign, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.deathSaves?.dead || !holdsFeature(sheet, "dark one's blessing")) {
    return null;
  }
  const amount = Math.max(
    1,
    computeSheetDerived(sheet).abilityMods.cha + Math.max(1, classLevelOf(sheet, "warlock")),
  );
  if (sheet.tempHp >= amount) {
    return null;
  }
  patchSheet(sheet.id, { tempHp: amount });
  audit(campaign, "", sheet, { tempHp: amount, by: "Dark One's Blessing" }, "a kill", { tempHp: amount });
  publishSheet(campaign, sheet.id);
  return `Dark One's Blessing: ${sheet.name} gains ${amount} temporary hit points.`;
}

// Fiendish Resilience (Fiend warlock 10): the damage type chosen at the end
// of a rest, written into the feature's name ("Fiendish Resilience (fire)"),
// which pcResistances reads. Chosen with use_resource "Fiendish Resilience"
// and the type as the variant, outside a fight.
const DAMAGE_TYPES_CHOOSABLE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

export function chooseFiendishResilience(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  variant: string | undefined,
  reason: string,
): Record<string, unknown> {
  const index = sheet.features.findIndex((feature) => /^fiendish resilience\b/i.test(feature.name.trim()));
  if (index < 0) {
    return { error: `${sheet.name} does not have Fiendish Resilience.` };
  }
  const type = (variant ?? "").trim().toLowerCase();
  if (!DAMAGE_TYPES_CHOOSABLE.includes(type)) {
    return { error: `Fiendish Resilience takes one damage type as the variant: ${DAMAGE_TYPES_CHOOSABLE.join(", ")}.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && (encounter.kind ?? "fight") === "fight") {
    return { error: "Fiendish Resilience's type is chosen when a rest ends, not in the middle of a fight." };
  }
  const features = sheet.features.map((feature, at) =>
    at === index ? { ...feature, name: `Fiendish Resilience (${type})` } : feature,
  );
  patchSheet(sheet.id, { features });
  audit(campaign, turnId, sheet, { fiendishResilience: type }, reason, { features });
  publishSheet(campaign, sheet.id);
  return { ok: true, resistance: `${sheet.name} now resists ${type} damage until they choose again after a rest.` };
}

// Stillness of Mind (monk 7): an action that ends one charmed or frightened
// effect on the monk. Not a counter: it costs the action and nothing else.
export function stillnessOfMind(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  reason: string,
): Record<string, unknown> {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsFeature(sheet, "stillness of mind")) {
    return { error: `${sheet.name} does not have Stillness of Mind.` };
  }
  const ending = sheet.conditions.find((name) => ["charmed", "frightened"].includes(name.toLowerCase()));
  if (!ending) {
    return { error: `${sheet.name} is neither charmed nor frightened; Stillness of Mind has nothing to end.` };
  }
  const charge = prepareResourceCharge(campaign, sheet, "stillness of mind", "action");
  if ("error" in charge) {
    return charge;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [ending]);
  const patch = { conditions: cleared.conditions, conditionMeta: cleared.meta };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, sheet, { stillnessOfMind: ending }, reason, patch);
  publishSheet(campaign, sheet.id);
  return { ok: true, ended: `${sheet.name} is no longer ${ending}.`, ...charge.commit() };
}
