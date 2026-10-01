// A hit that deals two damage types is resolved per type: resistance to
// slashing does not halve the radiant dice riding the blow (SRD 5.1, Damage
// Resistance and Vulnerability). The attack still rolls ONE damage
// expression, so the table sees one dice card; this module reads the typed
// riders' share back out of the rolled terms. Pure.

import type { RollResult } from "@/lib/dice";

// Dice that ride an attack under a type of their own: Divine Favor's 1d4
// radiant, a smite's 3d8 radiant, Hex's 1d6 necrotic.
export type TypedRider = { dice: string; type: string };

export type DamagePart = { type: string; amount: number };

const termValue = (term: RollResult["terms"][number]) =>
  term.sign * (term.kind === "dice" ? term.subtotal : term.value);

// The rolled total split by damage type: the weapon's own part first, then
// one part per rider type. `trailingTerms` is how many terms at the end of
// the expression are the extra weapon dice of a critical hit (Brutal
// Critical, Savage Attacks), which belong to the weapon. On a critical hit
// each rider's dice were rolled twice (or once and dealt at their maximum,
// under the Powerful Critical variant) and both copies are the rider's.
export function damageParts(
  outcome: RollResult,
  weaponType: string,
  riders: TypedRider[],
  options: { crit: boolean; trailingTerms?: number } = { crit: false },
): DamagePart[] {
  const terms = outcome.terms;
  const last = terms.length - Math.max(0, options.trailingTerms ?? 0);
  const claimed = new Set<number>();
  const byType = new Map<string, number>();
  for (const rider of [...riders].reverse()) {
    // A monster's rider can carry its own flat part ("plus 17 (2d10 + 6)
    // slashing damage", a behir's Constrict): that number is the rider's
    // share of the rolled total, once, as a critical never doubles it.
    const match = /^(\d+)d(\d+)(?:([+-])(\d+))?$/i.exec(rider.dice.replace(/\s+/g, ""));
    const type = rider.type.trim().toLowerCase();
    if (!match || !type || type === weaponType.trim().toLowerCase()) {
      continue;
    }
    const count = Number(match[1]);
    const sides = Number(match[2]);
    const flat = match[4] ? (match[3] === "-" ? -1 : 1) * Number(match[4]) : 0;
    const copies = options.crit ? 2 : 1;
    let wanted = copies;
    let amount = 0;
    for (let index = last - 1; index >= 0 && wanted > 0; index -= 1) {
      const term = terms[index];
      if (claimed.has(index) || term.kind !== "dice" || term.count !== count || term.sides !== sides) {
        continue;
      }
      claimed.add(index);
      amount += termValue(term);
      wanted -= 1;
      // Powerful Critical: the critical copy is the dice's maximum, written
      // as a flat number straight after them.
      const next = terms[index + 1];
      if (
        wanted > 0 &&
        next &&
        next.kind === "modifier" &&
        !claimed.has(index + 1) &&
        next.value === count * sides
      ) {
        claimed.add(index + 1);
        amount += termValue(next);
        wanted -= 1;
      }
    }
    // The flat part rides only dice that were found in the roll.
    if (wanted < copies) {
      amount += flat;
    }
    if (amount > 0) {
      byType.set(type, (byType.get(type) ?? 0) + amount);
    }
  }
  const ridden = [...byType.values()].reduce((sum, amount) => sum + amount, 0);
  return [
    { type: weaponType, amount: Math.max(0, outcome.total - ridden) },
    ...[...byType.entries()].map(([type, amount]) => ({ type, amount })),
  ];
}
