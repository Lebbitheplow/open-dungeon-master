// A spellcaster's class features that change a casting (SRD 5.1):
//   - Sculpt Spells (School of Evocation 2): the evoker's evocation spares
//     up to 1 + the spell's level chosen creatures, who succeed on the save
//     and take no damage.
//   - Overchannel (School of Evocation 14): a wizard spell of 1st to 5th
//     level that deals damage deals its maximum. Used again before a long
//     rest, it costs the wizard 2d12 necrotic per spell level, 1d12 more per
//     level each further use, which nothing reduces.
//   - Signature Spells (wizard 20): two 3rd level spells, each cast once at
//     3rd level without a slot, back on a short rest.
// The counters live in the sheet's resources (src/lib/srd/class-resources.ts:
// overchannel, signature_spell_1, signature_spell_2).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";

type Featured = Pick<CharacterSheet, "features">;

const holds = (sheet: Featured, name: string) =>
  sheet.features.some((feature) => feature.name.trim().toLowerCase().startsWith(name));

const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---- Sculpt Spells ----

// The characters an evoker's evocation spares: the ones named (or, with
// none named, every character caught), at most 1 + the spell's level.
export function sculptedIds(
  caster: CharacterSheet,
  school: string | null,
  spellLevel: number,
  caught: string[],
  named: string[] | undefined,
): string[] {
  if (!holds(caster, "sculpt spells") || (school ?? "").toLowerCase() !== "evocation") {
    return [];
  }
  const wanted = (named ?? caught).filter((id) => caught.includes(id) && id !== caster.id);
  return wanted.slice(0, 1 + Math.max(0, spellLevel));
}

// ---- Overchannel ----

// Whether this casting may be overchanneled, or why not.
export function overchannelProblem(caster: CharacterSheet, facts: SpellFacts | null, dealsDamage: boolean): string | null {
  if (!holds(caster, "overchannel")) {
    return `${caster.name} does not have Overchannel (School of Evocation, 14th level).`;
  }
  if (!facts || facts.level < 1 || facts.level > 5) {
    return "Overchannel works on a wizard spell of 1st through 5th level.";
  }
  if (facts.classes?.length && !facts.classes.some((entry) => entry.toLowerCase() === "wizard")) {
    return `Overchannel works on a wizard spell, and ${facts.name} is not one.`;
  }
  if (!dealsDamage) {
    return `Overchannel maximizes damage, and ${facts.name} deals none.`;
  }
  return null;
}

// Spends a use of Overchannel after the cast: the first since a long rest is
// free, each later one costs necrotic damage no resistance or immunity
// touches. Returns the line for the tool result.
export function payOverchannel(campaign: Campaign, turn: DmTurn, casterId: string, spellLevel: number): string {
  const sheet = getSheetById(casterId);
  if (!sheet) {
    return "";
  }
  const used = sheet.resources?.overchannel?.used ?? 0;
  const resources = { ...sheet.resources, overchannel: { max: sheet.resources?.overchannel?.max ?? 99, used: used + 1 } };
  patchSheet(sheet.id, { resources });
  if (used === 0) {
    return `Overchannel: ${sheet.name} deals the spell's maximum damage; the next use before a long rest will cost them.`;
  }
  const dice = `${(used + 1) * spellLevel}d12`;
  const rolled = rollExpression(dice).total;
  // Typeless on purpose: the SRD says this damage ignores resistance and
  // immunity.
  applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount: rolled, reason: "Overchannel" });
  return `Overchannel again before a long rest: ${sheet.name} takes ${rolled} necrotic damage (${dice}), which nothing reduces.`;
}

// ---- Signature Spells ----

const SIGNATURE = /^signature spells?\s*[:(-]\s*(.+?)\)?$/i;

// The counter that pays for this spell as a Signature Spell, or null: the
// spell is one of the two the feature names, cast at 3rd level, and its
// counter is unspent.
export function signatureCounter(
  sheet: Pick<CharacterSheet, "features" | "resources">,
  facts: SpellFacts | null,
  named: number | undefined,
): string | null {
  if (!facts || facts.level !== 3 || (named !== undefined && named !== 3)) {
    return null;
  }
  const chosen = sheet.features
    .map((feature) => SIGNATURE.exec(feature.name.trim())?.[1] ?? null)
    .find((list): list is string => Boolean(list));
  const spells = (chosen ?? "").split(/,|\band\b/).map(keyOf).filter(Boolean);
  const index = spells.indexOf(keyOf(facts.name));
  if (index < 0 || index > 1) {
    return null;
  }
  const id = `signature_spell_${index + 1}`;
  const state = sheet.resources?.[id];
  return state && state.used >= state.max ? null : id;
}

// The resources after a Signature Spell is cast.
export function spendSignature(
  resources: CharacterSheet["resources"],
  id: string,
): NonNullable<CharacterSheet["resources"]> {
  const state = resources?.[id];
  return { ...(resources ?? {}), [id]: { max: state?.max ?? 1, used: (state?.used ?? 0) + 1 } };
}
