// pet_attack's price: what commanding a pet's attack costs its owner in a
// fight. Split from pet-tools.ts, whose handler asks this before the roll and
// commits it once the attack is made.

import { getActiveEncounter } from "@/lib/db/encounters";
import { claimOncePerTurn, spendAction, spendAttack } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";

// What commanding a pet's attack costs its owner in a fight (SRD 5.1 and
// the subclasses' own text): a Beast Master's companion takes the ranger's
// action, a drake the bonus action, a Pact of the Chain familiar attacks
// with its reaction in place of one of the warlock's attacks of the Attack
// action (once a turn), and a story pet the owner's action. The owner must
// be able to act, on their own turn. Out of a fight there is no turn to
// charge. Checked before the roll; commit() writes the charge.
export function petAttackCost(
  sheet: CharacterSheet,
  pet: SheetPet,
  encounter: NonNullable<ReturnType<typeof getActiveEncounter>>,
): { error: string } | { commit: () => string } {
  const allowed = canAct({ sheet, encounter, kind: pet.kind === "drake" ? "bonus" : "action" });
  if (!allowed.ok) {
    return { error: `${allowed.error} ${pet.name} attacks when ${sheet.name} commands it on their turn.` };
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
  if (!budget) {
    return { commit: () => `${pet.name} attacks; there is no turn in play to charge.` };
  }
  let spent;
  let economy: string;
  if (pet.kind === "familiar") {
    const once = claimOncePerTurn(budget, `familiar:${pet.name.toLowerCase()}`);
    if (!once) {
      return { error: `${pet.name} has already attacked with its reaction this turn.` };
    }
    spent = spendAttack(once, sheet.name, { hasteOk: false });
    economy = `${pet.name} attacked with its reaction in place of one of ${sheet.name}'s attacks.`;
  } else if (pet.kind === "drake") {
    spent = spendAction(budget, "bonus", `commanding ${pet.name}`, sheet.name);
    economy = `Commanding ${pet.name} used ${sheet.name}'s bonus action.`;
  } else {
    spent = spendAction(budget, "action", `commanding ${pet.name}`, sheet.name);
    economy = `Commanding ${pet.name} used ${sheet.name}'s action.`;
  }
  if (!spent.ok) {
    return { error: spent.error };
  }
  const priced = spent.budget;
  return {
    commit: () => {
      const live = getActiveEncounter(encounter.campaignId) ?? encounter;
      storeBudget(live, priced);
      return economy;
    },
  };
}
