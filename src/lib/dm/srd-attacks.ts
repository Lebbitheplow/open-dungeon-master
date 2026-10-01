// The Hunter's Multiattack picks (SRD 5.1, ranger Hunter 11):
//
//   - Whirlwind Attack: the action makes one melee weapon attack against each
//     creature within 5 feet of the ranger, a separate roll for each.
//   - Volley: the action makes one ranged weapon attack against each creature
//     within 10 feet of a point the ranger can see in range; the first target
//     marks the point.
//
// pc_attack `whirlwind` / `volley`: the first attack spends the whole action
// (Extra Attack's swings go with it) and opens the volley in the turn
// budget's once-per-turn list; each later one strikes a creature not struck
// yet by it. Pure over the budget: pc-attack-plan.ts stores what this returns.

import { spendAction, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const OPEN = "hunter-multiattack:";
const STRUCK = "hunter-multiattack-target:";

export type MultiattackKind = "whirlwind" | "volley";

export function hunterMultiattack(input: {
  sheet: CharacterSheet;
  kind: MultiattackKind;
  budget: TurnBudget | null;
  profile: AttackProfile;
  weaponAttack: boolean;
  atRange: boolean;
  encounterId: string;
  enemyId: string;
}): { refused: string } | { budget: TurnBudget; note: string } {
  const { sheet, kind, budget } = input;
  const label = kind === "whirlwind" ? "Whirlwind Attack" : "Volley";
  if (!holdsFeature(sheet, `multiattack: ${label.toLowerCase()}`, label.toLowerCase())) {
    return { refused: `${sheet.name} does not have ${label} (a Hunter ranger's Multiattack pick).` };
  }
  if (!budget) {
    return { refused: `${label} is the Attack action on ${sheet.name}'s own turn; it is not their turn.` };
  }
  if (!input.weaponAttack) {
    return { refused: `${label} is made with a weapon, not a spell.` };
  }
  if (kind === "whirlwind") {
    const apart = tilesBetween(input.encounterId, sheet.id, input.enemyId);
    if (input.profile.ranged || input.atRange || (apart !== null && apart > 1)) {
      return { refused: "Whirlwind Attack makes melee weapon attacks against creatures within 5 feet of the ranger." };
    }
  } else if (!input.profile.ranged && !input.atRange) {
    return { refused: "Volley makes ranged weapon attacks; send the bow or crossbow as the weapon." };
  }
  const open = budget.oncePerTurn.find((key) => key.startsWith(`${OPEN}${kind}:`));
  if (!open) {
    if (budget.attacksMade > 0 || budget.actionUsed) {
      return { refused: `${label} takes the whole Attack action, and ${sheet.name} has already attacked or used their action this turn.` };
    }
    const spent = spendAction(budget, "action", label, sheet.name);
    if (!spent.ok) {
      return { refused: spent.error };
    }
    return {
      budget: {
        ...spent.budget,
        attacksMade: spent.budget.attacksAllowed,
        oncePerTurn: [...spent.budget.oncePerTurn, `${OPEN}${kind}:${input.enemyId}`, `${STRUCK}${input.enemyId}`],
      },
      note: `${label}: the action; one attack against each creature ${kind === "whirlwind" ? "within 5 feet" : "within 10 feet of this one"}, this one first`,
    };
  }
  if (budget.oncePerTurn.includes(`${STRUCK}${input.enemyId}`)) {
    return { refused: `${label} makes one attack against each creature, and ${sheet.name} has already attacked this one with it.` };
  }
  if (kind === "volley") {
    const first = open.slice(`${OPEN}volley:`.length);
    const apart = tilesBetween(input.encounterId, first, input.enemyId);
    if (apart !== null && apart > 2) {
      return { refused: "Volley's targets stand within 10 feet of the point the first one marked; this creature is farther." };
    }
  }
  return {
    budget: { ...budget, oncePerTurn: [...budget.oncePerTurn, `${STRUCK}${input.enemyId}`] },
    note: `${label}: another creature, no attack of the action spent`,
  };
}
