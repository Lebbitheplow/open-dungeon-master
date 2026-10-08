// The action economy of one player attack: which part of the turn it
// spends (the Attack action, Extra Attack, a bonus action, the whole action
// for Whirlwind Attack and Volley) and the once-a-turn marks the swing
// leaves on the budget. Split from pc-attack-plan.ts, which calls this once
// the attack's profile and options are known. The budget is a copy; nothing
// is stored until pc-attack.ts stores it.

import { evadesOpportunityAttacksAfterMelee, isPolearm, MOBILE_ATTACKED, ONE_HANDED_ATTACKED, POLEARM_READY } from "@/lib/srd/feat-combat";
import { attacksLeft, spendAction, spendAttack, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { OPEN_HAND_NOT_FLURRY } from "@/lib/dm/attack-choice-rules";
import { loadingProblem, withLoadingFired } from "@/lib/dm/attack-rules";
import { withClawsExtra } from "@/lib/dm/authored-attacks";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import {
  ATTACKED,
  claimHordeBreaker,
  hasHordeBreaker,
  MARTIAL_ARTS_READY,
  type AttackOptions,
} from "@/lib/dm/pc-attack-options";
import type { BuiltAttack } from "@/lib/dm/pc-attack-profile";
import { hunterMultiattack } from "@/lib/dm/srd-attacks";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function spendAttackEconomy(input: {
  sheet: CharacterSheet;
  args: PcAttackArgs;
  profile: AttackProfile;
  kind: BuiltAttack["kind"];
  atRange: boolean;
  weaponAttack: boolean;
  budget: TurnBudget | null;
  options: AttackOptions;
  grantedBonusAction: BuiltAttack["grantedBonusAction"];
  encounterId: string;
  enemyId: string;
}):
  | { budget: TurnBudget | null; spendNote: string | undefined; notes: string[] }
  | { refused: string } {
  const { sheet, args, profile, kind, atRange, weaponAttack, options, grantedBonusAction, encounterId, enemyId } = input;
  let budget = input.budget;
  // Notes the spends leave before the roll's situation is known.
  const notes: string[] = [];
  let spendNote: string | undefined;
  let flurryStrike = false;
  // Whirlwind Attack and Volley: the whole action, one attack a creature
  // (src/lib/dm/srd-attacks.ts).
  const multiattack =
    args.whirlwind || args.volley
      ? hunterMultiattack({
          sheet,
          kind: args.whirlwind ? "whirlwind" : "volley",
          budget,
          profile,
          weaponAttack,
          atRange,
          encounterId,
          enemyId,
        })
      : null;
  if (multiattack && "refused" in multiattack) {
    return { refused: multiattack.refused };
  }
  if (budget) {
    const usesAttackAction =
      !grantedBonusAction && !args.offHand && !options.bonusAttack && !options.hordeBreaker && kind !== "spell" && !multiattack;
    if (usesAttackAction) {
      const loading = loadingProblem({ who: sheet.name, profile, budget, feats: sheet.feats });
      // A new action (Action Surge, Haste) reloads; only a swing that would
      // ride the action already fired from is refused.
      if (loading && attacksLeft(budget) > 0 && budget.attacksMade > 0) {
        return { refused: loading };
      }
    }
    const flurryBefore = budget.flurryStrikes ?? 0;
    const spend = multiattack
      ? { ok: true as const, budget: multiattack.budget, note: multiattack.note }
      : grantedBonusAction
      ? spendAction(budget, "bonus", `the ${profile.weapon} attack`, sheet.name)
      : options.bonusAttack
        ? spendAction(
            budget,
            "bonus",
            options.bonusAttack === "martial arts" ? "the Martial Arts strike" : options.bonusAttack === "feature" ? "the feature's bonus attack" : "the frenzy's attack",
            sheet.name,
          )
        : options.hordeBreaker
        ? { ok: true as const, budget: claimHordeBreaker(budget), note: "Horde Breaker: an extra attack, once a turn" }
        : args.offHand
        ? spendAction(budget, "bonus", "an off-hand attack", sheet.name)
        : kind === "spell"
          ? // The cast guard charges the casting time in pc-attack.ts.
            { ok: true as const, budget }
          : spendAttack(budget, sheet.name, { unarmed: profile.weapon === "Unarmed strike" });
    if (!spend.ok) {
      return { refused: spend.error };
    }
    flurryStrike = (spend.budget.flurryStrikes ?? 0) < flurryBefore;
    budget = spend.budget;
    // Form of the Beast's claws: one more claw attack in the Attack action,
    // once a turn (src/lib/dm/authored-attacks.ts).
    if (usesAttackAction) {
      budget = withClawsExtra(sheet, args.weapon, budget, notes);
    }
    if (usesAttackAction) {
      budget = withLoadingFired(budget, profile);
      if (!profile.ranged && (profile.properties ?? []).includes("light")) {
        budget = { ...budget, lightMeleeAttack: true };
      }
      // The Attack action taken with an unarmed strike or a monk weapon opens
      // Martial Arts' bonus strike for the rest of the turn.
      if (profile.martialArts && !budget.oncePerTurn.includes(MARTIAL_ARTS_READY)) {
        budget = { ...budget, oncePerTurn: [...budget.oncePerTurn, MARTIAL_ARTS_READY] };
      }
    }
    // Who was attacked this turn, for Horde Breaker's second target (kept
    // only for a ranger who can use it).
    if (hasHordeBreaker(sheet) && !budget.oncePerTurn.includes(`${ATTACKED}${enemyId}`)) {
      budget = { ...budget, oncePerTurn: [...budget.oncePerTurn, `${ATTACKED}${enemyId}`] };
    }
    // Mobile and Skirmisher: the creature attacked in melee makes no
    // opportunity attack against them this turn (opportunity.ts).
    if (!profile.ranged && evadesOpportunityAttacksAfterMelee(sheet) && !budget.oncePerTurn.includes(`${MOBILE_ATTACKED}${enemyId}`)) {
      budget = { ...budget, oncePerTurn: [...budget.oncePerTurn, `${MOBILE_ATTACKED}${enemyId}`] };
    }
    if (usesAttackAction) {
      // Polearm Master's butt-end strike and Crossbow Expert's hand crossbow
      // shot follow the Attack action (pc-attack-options.ts).
      if (isPolearm(profile.weapon) && !budget.oncePerTurn.includes(POLEARM_READY)) {
        budget = { ...budget, oncePerTurn: [...budget.oncePerTurn, POLEARM_READY] };
      }
      if (!profile.twoHanded && !budget.oncePerTurn.includes(ONE_HANDED_ATTACKED)) {
        budget = { ...budget, oncePerTurn: [...budget.oncePerTurn, ONE_HANDED_ATTACKED] };
      }
    }
    spendNote = spend.note;
  }

  // Open Hand Technique rides a Flurry of Blows strike only.
  if (args.openHand && !flurryStrike) {
    return { refused: OPEN_HAND_NOT_FLURRY };
  }
  return { budget, spendNote, notes };
}
