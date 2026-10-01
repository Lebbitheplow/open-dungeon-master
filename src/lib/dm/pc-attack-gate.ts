// The refusals that come before a player's attack is built: whether the
// attacker may attack now (their action on their turn, their one reaction
// off it), whether the target can be attacked at all, and whether the
// options the attack declares can be paid for. Split from pc-attack-plan.ts,
// which asks this first and plans the attack once nothing here refuses it.
// Nothing is spent here.

import type { Campaign } from "@/lib/db/campaigns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { actingCombatantId, canAct } from "@/lib/dm/can-act";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { readiedTrigger } from "@/lib/dm/object-actions";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import { inspirationProblem, strokeOfLuckProblem } from "@/lib/dm/attack-features";
import { hasOpenHandTechnique, HURLED, hurlProblem } from "@/lib/dm/attack-onhit";
import { giantKillerOpen } from "@/lib/dm/reaction-attacks";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { conditionUntargetable } from "@/lib/srd/condition-effect-queries";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function gatePcAttack(input: {
  campaign: Campaign;
  encounter: Encounter;
  sheet: CharacterSheet;
  args: PcAttackArgs;
}): { enemy: EncounterEnemy; giantKiller: boolean } | { refused: Record<string, unknown> } {
  const { campaign, encounter, sheet, args } = input;

  // On their own turn a character attacks with their action. Off it they
  // have one reaction, and an attack made then is that reaction (an
  // opportunity attack, a readied strike): one, until their turn comes round.
  const onTurn = actingCombatantId(encounter) === sheet.id;
  let giantKiller = false;
  const allowed = canAct({ sheet, encounter, kind: onTurn ? "attack" : "reaction" });
  if (!allowed.ok) {
    return { refused: { error: allowed.error } };
  }
  if (!onTurn) {
    const blocked = conditionBlocksReactions(sheet.conditions);
    if (blocked) {
      return { refused: { error: `${sheet.name} is ${blocked} and cannot take reactions, so they cannot attack off their own turn.` } };
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      return {
        refused: {
          error: `It is not ${sheet.name}'s turn, and they have already used their reaction. Off their own turn a character attacks only with their reaction; it comes back at the start of their next turn.`,
        },
      };
    }
    if (args.offHand) {
      return {
        refused: {
          error: `The off-hand attack is a bonus action on ${sheet.name}'s own turn; it is not their turn.`,
        },
      };
    }
    // In a fight with turns, the reaction attacks only as an opportunity
    // attack (the server rolls those itself) or a readied action.
    // Giant Killer answers a Large creature's attack the same way
    // (src/lib/dm/reaction-attacks.ts).
    const target = resolveEnemyRef(encounter.id, args.targetEnemyId);
    giantKiller = Boolean(target && giantKillerOpen(campaign.id, encounter.id, sheet, target));
    if (actingCombatantId(encounter) !== null && !readiedTrigger(sheet) && !giantKiller) {
      return {
        refused: {
          error: `It is not ${sheet.name}'s turn. Off their own turn a character attacks only with an opportunity attack, which the server rolls itself when an enemy leaves their reach, or with an attack they readied on their turn (take_action ready); ${sheet.name} has neither waiting.`,
        },
      };
    }
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy) {
    return { refused: { error: "Unknown targetEnemyId; use one from GAME STATE." } };
  }
  if (enemy.status !== "alive") {
    return { refused: { error: `${enemy.displayName} is already ${enemy.status}.` } };
  }
  // Resilient Sphere: nothing reaches in (condition-effects untargetable).
  const sealed = conditionUntargetable(enemy.conditions);
  if (sealed) {
    return { refused: { error: `${enemy.displayName} is ${sealed}: sealed in force, it cannot be attacked from outside until the spell ends. Nothing was spent.` } };
  }
  if (enemy.conditions.includes("banished")) {
    return { refused: { error: `${enemy.displayName} is banished to another plane and cannot be attacked until the spell ends.` } };
  }
  if (enemy.conditions.includes(HURLED)) {
    return { refused: { error: `${enemy.displayName} is being hurled through the lower planes and cannot be attacked until it returns at the end of the warlock's next turn.` } };
  }
  // The spends a declared option needs, asked before anything is spent.
  const optionProblem =
    inspirationProblem(sheet, args.useInspiration) ??
    strokeOfLuckProblem(sheet, args.strokeOfLuck) ??
    hurlProblem(sheet, args.hurlThroughHell) ??
    (args.openHand && !hasOpenHandTechnique(sheet)
      ? `${sheet.name} does not have Open Hand Technique (a Way of the Open Hand monk's feature); attack without openHand.`
      : null);
  if (optionProblem) {
    return { refused: { error: optionProblem } };
  }
  // A charmed creature cannot attack the one who charmed it.
  const charmedAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "charmed");
  const charmer = charmedAs ? (sheet.conditionMeta as ConditionMetaMap)[charmedAs]?.source : undefined;
  if (charmer && charmer === enemy.id) {
    return {
      refused: {
        error: `${sheet.name} is charmed by ${enemy.displayName} and cannot attack it. They can attack another target, or act once the charm ends.`,
      },
    };
  }
  return { enemy, giantKiller };
}
