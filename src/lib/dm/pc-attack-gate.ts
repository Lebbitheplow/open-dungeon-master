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
import { resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { READIED_WORDS, RELEASE_TOOLS, readiedHeld } from "@/lib/dm/readied-kinds";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import { inspirationProblem, strokeOfLuckProblem } from "@/lib/dm/attack-features";
import { hasOpenHandTechnique, HURLED, hurlProblem } from "@/lib/dm/attack-onhit";
import { giantKillerOpen } from "@/lib/dm/reaction-attacks";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { conditionUntargetable } from "@/lib/srd/condition-effect-queries";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

export function gatePcAttack(input: {
  campaign: Campaign;
  encounter: Encounter;
  sheet: CharacterSheet;
  args: PcAttackArgs;
}): { enemy: EncounterEnemy; giantKiller: boolean } | { refused: ToolError } {
  const { campaign, encounter, sheet, args } = input;

  // On their own turn a character attacks with their action. Off it they
  // have one reaction, and an attack made then is that reaction (an
  // opportunity attack, a readied strike): one, until their turn comes round.
  const onTurn = actingCombatantId(encounter) === sheet.id;
  let giantKiller = false;
  const allowed = canAct({ sheet, encounter, kind: onTurn ? "attack" : "reaction" });
  if (!allowed.ok) {
    return { refused: toolError(allowed) };
  }
  if (!onTurn) {
    const blocked = conditionBlocksReactions(sheet.conditions);
    if (blocked) {
      return { refused: { error: `${sheet.name} is ${blocked} and cannot take reactions, so they cannot attack off their own turn.`, refused: "rules" } };
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      return {
        refused: {
          error: `It is not ${sheet.name}'s turn, and they have already used their reaction. Off their own turn a character attacks only with their reaction; it comes back at the start of their next turn.`,
          refused: "rules",
        },
      };
    }
    if (args.offHand) {
      return {
        refused: {
          error: `The off-hand attack is a bonus action on ${sheet.name}'s own turn; it is not their turn. What they declared waits for their turn.`,
          refused: "rules",
        },
      };
    }
    // In a fight with turns, the reaction attacks only as an opportunity
    // attack (the server rolls those itself) or a readied action.
    // Giant Killer answers a Large creature's attack the same way
    // (src/lib/dm/reaction-attacks.ts).
    const target = resolveEnemyRef(encounter.id, args.targetEnemyId);
    giantKiller = Boolean(target && giantKillerOpen(campaign.id, encounter.id, sheet, target));
    // Ready commits to one action: a readied attack (or a readied
    // attack-roll spell) releases here, a readied move or Help does not.
    const held = readiedHeld(sheet);
    const readiedStrike = held !== null && (held.holds === "attack" || held.holds === "spell");
    if (actingCombatantId(encounter) !== null && !readiedStrike && !giantKiller) {
      return {
        refused: {
          error: held
            ? `It is not ${sheet.name}'s turn, and what they readied is ${READIED_WORDS[held.holds]} (${held.trigger}), not an attack: a readied action is released only as the action that was readied (SRD 5.1, Ready). Nothing was spent. ${RELEASE_TOOLS[held.holds]} releases it.`
            : `It is not ${sheet.name}'s turn. Off their own turn a character attacks only with an opportunity attack, which the server rolls itself when an enemy leaves their reach, or with an attack they readied on their turn (take_action ready); ${sheet.name} has neither waiting. What they declared waits for their turn.`,
          refused: "rules",
        },
      };
    }
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy) {
    return { refused: unknownEnemyRef(encounter.id, "targetEnemyId", args.targetEnemyId) };
  }
  if (enemy.status !== "alive") {
    return { refused: { error: `${enemy.displayName} is already ${enemy.status}. Ask the player which living enemy in GAME STATE to target instead.`, retry: true } };
  }
  // Resilient Sphere: nothing reaches in (condition-effects untargetable).
  const sealed = conditionUntargetable(enemy.conditions);
  if (sealed) {
    return { refused: { error: `${enemy.displayName} is ${sealed}: sealed in force, it cannot be attacked from outside until the spell ends. Nothing was spent; pick another target.`, refused: "rules" } };
  }
  if (enemy.conditions.includes("banished")) {
    return { refused: { error: `${enemy.displayName} is banished to another plane and cannot be attacked until the spell ends. Pick another target.`, refused: "rules" } };
  }
  if (enemy.conditions.includes(HURLED)) {
    return { refused: { error: `${enemy.displayName} is being hurled through the lower planes and cannot be attacked until it returns at the end of the warlock's next turn. Pick another target.`, refused: "rules" } };
  }
  // The spends a declared option needs, asked before anything is spent.
  const optionProblem: ToolError | null =
    inspirationProblem(sheet, args.useInspiration) ??
    strokeOfLuckProblem(sheet, args.strokeOfLuck) ??
    hurlProblem(sheet, args.hurlThroughHell) ??
    (args.openHand && !hasOpenHandTechnique(sheet)
      ? { error: `${sheet.name} does not have Open Hand Technique (a Way of the Open Hand monk's feature); attack without openHand.`, retry: true }
      : null);
  if (optionProblem) {
    return { refused: optionProblem };
  }
  // A charmed creature cannot attack the one who charmed it.
  const charmedAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "charmed");
  const charmer = charmedAs ? (sheet.conditionMeta as ConditionMetaMap)[charmedAs]?.source : undefined;
  if (charmer && charmer === enemy.id) {
    return {
      refused: {
        error: `${sheet.name} is charmed by ${enemy.displayName} and cannot attack it. They can attack another target, or act once the charm ends.`,
        refused: "rules",
      },
    };
  }
  return { enemy, giantKiller };
}
