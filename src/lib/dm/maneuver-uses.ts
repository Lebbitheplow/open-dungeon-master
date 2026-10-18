// The Battle Master maneuvers spent through use_resource "Superiority Dice"
// with a variant (issue 233, src/lib/dm/maneuver-rules.ts):
//
//   Rally (PHB): "On your turn, you can use a bonus action and expend one
//     superiority die ... That creature gains temporary hit points equal to
//     the superiority die roll + your Charisma modifier."
//   Commander's Strike (PHB): "When you take the Attack action on your turn,
//     you can forgo one of your attacks and use a bonus action to direct one
//     of your companions to strike. ... that creature can immediately use its
//     reaction to make one weapon attack, adding the superiority die to the
//     attack's damage roll."
//
// Resolved through feature-spends.ts's spend order (check, charge, resolve,
// then the die), so a refusal costs nothing. Must not import mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spendAction, spendAttack } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { COMMANDED, SUPERIORITY_STRIKE, maneuverDieFor } from "@/lib/dm/maneuver-rules";
import { reactionRefusal } from "@/lib/dm/reaction-gate";
import type { ResourceCharge } from "@/lib/dm/resource-turn";
import { rollCard } from "@/lib/dm/roll-card";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

type Resolution = ToolError | { result: Record<string, unknown> };

// Whether the sheet knows this maneuver ("Maneuver: Rally").
export function knowsManeuver(sheet: CharacterSheet, name: string): boolean {
  return sheet.features.some((feature) => /^maneuver:/i.test(feature.name) && textKey(feature.name).includes(textKey(name)));
}

function companion(sheet: CharacterSheet, targetId: string | undefined, label: string): CharacterSheet | ToolError {
  const ally = targetId ? getSheetById(targetId) : null;
  if (!ally || ally.id === sheet.id || ally.campaignId !== sheet.campaignId) {
    return { error: `${label} is for one of ${sheet.name}'s companions: pass that character's targetCharacterId. Nothing was spent.`, retry: true };
  }
  if (ally.deathSaves?.dead) {
    return { error: `${ally.name} is dead; ${label} cannot reach them. Nothing was spent.`, refused: "rules" };
  }
  return ally;
}

export function rally(campaign: Campaign, turnId: string, sheet: CharacterSheet, targetId: string | undefined): Resolution {
  const ally = companion(sheet, targetId, "Rally");
  if ("error" in ally) {
    return ally;
  }
  const cha = computeSheetDerived(sheet).abilityMods.cha;
  const expression = `1${maneuverDieFor(sheet)}${cha >= 0 ? "+" : ""}${cha}`;
  const rolled = Math.max(0, rollCard(campaign, getDmTurn(turnId), sheet.id, "custom", `${sheet.name}: Rally`, expression, null).total);
  const fresh = getSheetById(ally.id) ?? ally;
  // Temporary hit points do not stack: the better of the two stays.
  const kept = Math.max(fresh.tempHp ?? 0, rolled);
  if (kept !== (fresh.tempHp ?? 0)) {
    const updated = patchSheet(fresh.id, { tempHp: kept });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return {
    result: {
      rolled: `${expression}: ${rolled}`,
      applied:
        kept === rolled
          ? `${fresh.name} gains ${rolled} temporary hit points.`
          : `${fresh.name} keeps their ${kept} temporary hit points, more than the ${rolled} Rally gives.`,
    },
  };
}

// Commander's Strike's cost: one attack of the Attack action and the bonus
// action, with the companion's reaction still to come.
export function commandersStrikeCharge(campaign: Campaign, sheet: CharacterSheet, targetId: string | undefined): ResourceCharge {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || (encounter.kind ?? "fight") !== "fight") {
    return { error: "Commander's Strike is part of the Attack action in a fight. Nothing was spent.", refused: "rules" };
  }
  const able = canAct({ sheet, encounter, kind: "action" });
  if (!able.ok) {
    return toolError(able);
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget) {
    return { error: `Commander's Strike is taken on ${sheet.name}'s own turn, as part of the Attack action. What they declared waits for their turn. Nothing was spent.`, refused: "rules" };
  }
  const forgone = spendAttack(budget, sheet.name);
  if (!forgone.ok) {
    return { ...toolError(forgone), error: `${forgone.error} Commander's Strike forgoes one attack of the Attack action. Nothing was spent.` };
  }
  const bonus = spendAction(forgone.budget, "bonus", "Commander's Strike", sheet.name);
  if (!bonus.ok) {
    return toolError(bonus);
  }
  const ally = companion(sheet, targetId, "Commander's Strike");
  if ("error" in ally) {
    return ally;
  }
  const refused = reactionRefusal(campaign.id, ally, encounter, "Commander's Strike", "after");
  if (refused) {
    return { ...refused, error: `${refused.error} Nothing was spent.` };
  }
  if (encounter.reactionsUsed.includes(ally.id)) {
    return { error: `${ally.name} has already used their reaction this round, so they cannot strike. Nothing was spent.`, refused: "rules" };
  }
  return {
    commit: () => {
      const live = getActiveEncounter(campaign.id);
      if (live) {
        storeBudget(live, bonus.budget);
      }
      return { cost: "one attack of their Attack action and their bonus action" };
    },
  };
}

export function commandersStrike(campaign: Campaign, sheet: CharacterSheet, targetId: string | undefined): Resolution {
  const ally = companion(sheet, targetId, "Commander's Strike");
  if ("error" in ally) {
    return ally;
  }
  const fresh = getSheetById(ally.id) ?? ally;
  // Both marks last for the rest of the fighter's turn.
  const lasts = untilTurnEnd(sheet.id, { turnBegun: true, source: sheet.id });
  const strike = `${SUPERIORITY_STRIKE} (1${maneuverDieFor(sheet)})`;
  const held = fresh.conditions.filter((entry) => !/^(commander's strike|superiority strike)\b/i.test(entry));
  const updated = patchSheet(fresh.id, {
    conditions: [...held, COMMANDED, strike],
    conditionMeta: { ...fresh.conditionMeta, [COMMANDED]: lasts, [strike]: lasts },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    result: {
      applied: `${sheet.name} directs ${fresh.name} to strike: ${fresh.name} makes one weapon attack now with their reaction, adding 1${maneuverDieFor(sheet)} to its damage on a hit.`,
      next: `use_reaction for ${fresh.name} (characterId ${fresh.id}) with feature "Commander's Strike" and the targetEnemyId.`,
    },
  };
}
