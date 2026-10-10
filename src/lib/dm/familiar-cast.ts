// Casting Find Familiar (SRD 5.1) through cast_buff: the familiar is the
// caster's pet (src/lib/dm/pet-tools.ts, summon_pet), and the casting is paid
// like any spell: the form is checked first, then the one cast guard spends
// the hour's casting (out of a fight, or as a ritual) and the 10 gp of
// charcoal, incense and herbs the fire consumes, then the pet is bound. A
// second casting re-shapes the same spirit (one familiar at a time).
//
// Imported by cast-buff.ts only; it reaches mutations.ts through the cast
// callback.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { buildPet, handleSummonPet } from "@/lib/dm/pet-tools";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const isFindFamiliar = (spell: string) => spell.trim().toLowerCase() === "find familiar";

export function castFindFamiliar(
  campaign: Campaign,
  turn: DmTurn,
  // `castAs`: the name it is cast under, a table's workshop copy's own.
  input: { caster: CharacterSheet; castAs?: string; variant?: string; level?: number; reason?: string; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> },
  cast: (args: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const { caster } = input;
  const castAs = input.castAs?.trim() || "Find Familiar";
  const form = (input.variant ?? "").trim();
  const built = buildPet(caster, { kind: "familiar", form });
  if ("error" in built) {
    return { error: form ? `${built.error} Nothing was spent.` : `Find Familiar needs the familiar's form in variant (owl, cat, raven, bat, rat, spider, weasel, hawk, frog, snake...). Nothing was spent.` };
  }
  const spent = cast({ characterId: caster.id, spell: castAs, ...(input.level ? { level: input.level } : {}), via: "buff", reason: (input.reason ?? "").slice(0, 200) });
  if ("error" in spent) {
    return spent;
  }
  const bound = handleSummonPet(campaign, turn, JSON.stringify({ characterId: caster.id, kind: "familiar", form }), input.sheets, input.sheetsById);
  if ("error" in bound) {
    return bound;
  }
  return {
    ...bound,
    spell: castAs,
    ...(spent.slot ? { slot: spent.slot } : {}),
    ...(spent.cost ? { cost: spent.cost } : {}),
    ...(spent.material ? { material: spent.material } : {}),
    note: "The familiar is bound to the caster as a pet (summon_pet's rules): it acts on its own, cannot attack, and vanishes at 0 hit points. Narrate exactly this.",
  };
}
