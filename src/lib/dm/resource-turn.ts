// What spending a limited-use feature costs of a turn in a fight.
//
// use_resource spent the use and applied the effect, and never looked at the
// turn: Second Wind left the bonus action free for an off-hand attack, and
// Action Surge bought nothing. The cost of each feature is on its definition
// (src/lib/srd/class-resources.ts ResourceDef.action); this module holds it
// against the live turn budget.
//
// The check comes first and the charge last: prepare() refuses before any
// die is rolled or any use is spent, and commit() writes the budget only once
// the spend has gone through, so a refusal costs nothing.
//
// This module must not import mutations.ts (which imports it).
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { matchResource } from "@/lib/srd/class-resources";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import {
  attacksAllowedFor,
  budgetFor,
  grantActionSurge,
  storeBudget,
} from "@/lib/dm/turn-budget";

export type ResourceCharge =
  | { error: string }
  | {
      // Writes the charge and returns what the tool result should say of it.
      commit: () => Record<string, unknown>;
    };

const FREE: ResourceCharge = { commit: () => ({}) };

export function prepareResourceCharge(
  campaign: Campaign,
  sheet: CharacterSheet,
  resourceName: string,
): ResourceCharge {
  const def = matchResource(resourceName);
  const encounter = getActiveEncounter(campaign.id);
  // Out of a fight there is no turn to charge, and a feature whose uses cost
  // different things is left to the tool that resolves the use.
  if (!def?.action || !encounter || (encounter.kind ?? "fight") !== "fight") {
    return FREE;
  }
  // ODM's rule: asking for Wild Shape while shaped drops the form and costs
  // nothing (src/lib/dm/resource-tools.ts).
  if (def.effect.kind === "wild_shape" && sheet.wildShape) {
    return FREE;
  }
  // Combat Wild Shape (Circle of the Moon) makes the change a bonus action.
  const action =
    def.effect.kind === "wild_shape" &&
    sheet.features.some((feature) => feature.name.toLowerCase().includes("combat wild shape"))
      ? "bonus"
      : def.action;
  const kind = action === "none" ? "free" : action;
  const able = canAct({ sheet, encounter, kind });
  if (!able.ok) {
    return { error: able.error };
  }
  if (def.id === "action_surge") {
    return {
      commit: () => {
        const granted = grantActionSurge(campaign.id, sheet);
        return granted ? { extraAction: granted } : {};
      },
    };
  }
  if (action === "none") {
    return FREE;
  }
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  if (!budget) {
    return FREE;
  }
  const spent = spendAction(budget, action, def.displayName, sheet.name);
  if (!spent.ok) {
    return { error: spent.error };
  }
  return {
    commit: () => {
      // Read again: the spend itself may have written to the encounter.
      const live = getActiveEncounter(campaign.id);
      if (live) {
        storeBudget(live, spent.budget);
      }
      return {
        cost: action === "bonus" ? "their bonus action" : "their action",
        ...(spent.note ? { costNote: spent.note } : {}),
      };
    },
  };
}
