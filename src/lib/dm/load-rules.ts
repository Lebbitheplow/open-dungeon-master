// What a character can carry, and what they can shift, under the standard
// rule rather than the encumbrance variant.
//
// SRD 5.1, Lifting and Carrying: "Your carrying capacity is your Strength
// score multiplied by 15. This is the weight (in pounds) that you can carry."
// "You can push, drag, or lift a weight in pounds up to twice your carrying
// capacity (or 30 times your Strength score). While pushing or dragging
// weight in excess of your carrying capacity, your speed drops to 5 feet."
// Larger creatures double both for each size above Medium; a Tiny one
// halves them.
//
// Grants and purchases that would take a pack past the capacity are refused
// (src/lib/dm/mutations.ts, src/lib/dm/shop-tools.ts); a character already
// past it moves at 5 feet (src/lib/srd/index.ts speedFor). Weights come from
// the item rows, the content pack by name, and the SRD armor table; an item
// nothing can weigh is not counted, so the refusal errs toward allowing.

import { itemWeightByName } from "@/lib/content";
import { carryMultiplier, encumbranceFor, type CarriedItem } from "@/lib/srd/encumbrance";
import { sizeForRace } from "@/lib/srd";
import { magicItemRiders, type Wearer } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Carrier = Pick<CharacterSheet, "name" | "abilities" | "race" | "gold"> & Partial<Wearer>;

// Per-unit weights the rows lack, from the content pack.
export function weighed(equipment: CarriedItem[]): CarriedItem[] {
  return equipment.map((item) => {
    if (typeof item.weight === "number" && item.weight > 0) {
      return item;
    }
    const weight = itemWeightByName(item.name);
    return weight === null ? item : { ...item, weight };
  });
}

function loadOf(sheet: Carrier, equipment: CarriedItem[], gold?: number) {
  return encumbranceFor({
    strength: sheet.abilities.str,
    equipment: weighed(equipment),
    coins: gold ?? sheet.gold ?? 0,
    size: sheet.race ? sizeForRace(sheet.race) : undefined,
    wearer: sheet as Wearer,
  });
}

// Why a pack cannot take on this load, or null. Only a change that adds
// weight is refused: dropping things from a pack already too heavy is how a
// character gets back under it.
export function capacityProblem(
  sheet: Carrier & { equipment: CarriedItem[] },
  after: CarriedItem[],
  what: string,
  gold?: number,
): string | null {
  const now = loadOf(sheet, sheet.equipment);
  const then = loadOf(sheet, after, gold);
  if (!then.overCapacity || then.carriedLb <= now.carriedLb) {
    return null;
  }
  return `${sheet.name} can carry ${then.capacityLb} lb (Strength x 15) and would be carrying ${then.carriedLb} lb with ${what}. They cannot carry it: give it to someone else, leave something behind, or drag it (the lift tool) at 5 feet.`;
}

// A character's carrying capacity and push, drag or lift limit, in pounds.
export function liftLimits(sheet: Carrier & { equipment: CarriedItem[] }): { capacityLb: number; liftLb: number } {
  const set = magicItemRiders(sheet.equipment ?? [], sheet as Wearer).abilitySet.str ?? 0;
  const strength = Math.max(1, Math.floor(sheet.abilities.str || 1), set);
  const multiplier = carryMultiplier(sheet.race ? sizeForRace(sheet.race) : undefined);
  return { capacityLb: strength * 15 * multiplier, liftLb: strength * 30 * multiplier };
}

// Whether a character carries past their capacity right now.
export function overCapacity(sheet: Carrier & { equipment: CarriedItem[] }): boolean {
  return loadOf(sheet, sheet.equipment).overCapacity;
}
