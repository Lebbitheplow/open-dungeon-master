// A blast of two damage types (SRD 5.1: Meteor Swarm's 20d6 fire and 20d6
// bludgeoning, Flame Strike's fire and radiant, Ice Storm's bludgeoning and
// cold). The spell's row names the second type (SpellMech.secondType); the
// last dice of the damage expression are that type and the rest the first,
// each rolled on its own and landing on its own so a creature resistant to
// fire halves only the fire. Pure: aoe-damage.ts rolls and applies.

export type DamagePart = { amount: number; type?: string };

// The damage expression split in two ("20d6+20d6" -> "20d6", "20d6"), or
// null when the spell has one type or the expression has one dice term.
export function splitDamageExpression(expression: string, secondType: string | undefined): [string, string] | null {
  if (!secondType) {
    return null;
  }
  const match = /^(.+?)\s*\+\s*(\d+d\d+)\s*$/i.exec(expression.trim());
  return match && /\d+d\d+/i.test(match[1]) ? [match[1], match[2]] : null;
}

// What one creature takes of each part: all of it, half of each (rounded
// down, as each type's own damage), or none.
export function partsTaken(parts: DamagePart[], share: "full" | "half" | "none"): DamagePart[] {
  return parts.map((part) => ({
    ...part,
    amount: share === "full" ? part.amount : share === "half" ? Math.floor(part.amount / 2) : 0,
  }));
}

export const partsTotal = (parts: DamagePart[]) => parts.reduce((sum, part) => sum + part.amount, 0);
