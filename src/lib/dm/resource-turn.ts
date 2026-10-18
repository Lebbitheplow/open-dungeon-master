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
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { matchResource, type ResourceAction } from "@/lib/srd/class-resources";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { readiedReleaseFor } from "@/lib/dm/readied-release";
import { EMBODIMENT_MARK, LEVELLED_SPELL, SURGE_MARK } from "@/lib/dm/cast-rules";
import {
  attacksAllowedFor,
  budgetFor,
  grantActionSurge,
  prepareReaction,
  storeBudget,
} from "@/lib/dm/turn-budget";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export type ResourceCharge =
  | ToolError
  | {
      // Writes the charge and returns what the tool result should say of it.
      commit: () => Record<string, unknown>;
      // A reaction taken as the hit that dropped the character lands, judged
      // as they stood before it (src/lib/dm/reaction-gate.ts, issue 233).
      beforeDrop?: boolean;
    };

const FREE: ResourceCharge = { commit: () => ({}) };

export function prepareResourceCharge(
  campaign: Campaign,
  sheet: CharacterSheet,
  resourceName: string,
  // What this particular use costs, for a counter whose options cost
  // different things (Channel Divinity's Turn Undead is an action).
  override?: ResourceAction,
): ResourceCharge {
  const found = matchResource(resourceName);
  const def = found && override ? { ...found, action: override } : found;
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
    sheet.features.some((feature) => textKey(feature.name).includes("combat wild shape"))
      ? "bonus"
      : def.action;
  if (action === "reaction") {
    return prepareReaction(encounter, sheet, def.displayName);
  }
  const kind = action === "none" ? "free" : action;
  // Off their turn, a feature they readied: their reaction (readied-release.ts).
  const readied = kind === "action" ? readiedReleaseFor(sheet, encounter, "feature") : null;
  if (readied && "error" in readied) {
    return toolError(readied);
  }
  if (readied) {
    return { commit: () => readied.release() };
  }
  const able = canAct({ sheet, encounter, kind });
  if (!able.ok) {
    return toolError(able);
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
    conditionTurnShape(sheet.conditions),
  );
  if (!budget) {
    return FREE;
  }
  const spent = spendAction(budget, action, def.displayName, sheet.name);
  if (!spent.ok) {
    return toolError(spent);
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

// A use that moves the turn's next spell to the bonus action (issue 233):
// Embodiment of the Law's enchantment, the genre classes' cantrip after a
// levelled spell. Checked before the use is spent; the mark is written once
// it is, and the cast guard spends it (cast-rules.ts bonusCastOf).
export function castMarkCharge(
  campaign: Campaign,
  sheet: CharacterSheet,
  defId: string | undefined,
): ToolError | { apply: () => ToolResult } | null {
  const surge = defId ? SURGE_COUNTERS.has(defId) : false;
  const mark = defId === "sub_embodiment_of_the_law" ? EMBODIMENT_MARK : surge ? SURGE_MARK : null;
  if (!mark) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  const budget = encounter && (encounter.kind ?? "fight") === "fight" ? encounter.turnBudget : null;
  if (!budget || budget.ownerId !== sheet.id) {
    return { error: `${sheet.name} uses this on their own turn in a fight, as the spell it changes is cast. Nothing was spent.`, refused: "rules" };
  }
  if (surge && !budget.oncePerTurn.includes(LEVELLED_SPELL)) {
    return { error: `This casts a cantrip as a bonus action after a levelled spell, and ${sheet.name} has cast none this turn. Nothing was spent.`, refused: "rules" };
  }
  return {
    apply: () => {
      const live = getActiveEncounter(campaign.id);
      const now = live?.turnBudget;
      if (live && now && now.ownerId === sheet.id && !now.oncePerTurn.includes(mark)) {
        storeBudget(live, { ...now, oncePerTurn: [...now.oncePerTurn, mark] });
      }
      return {
        next: mark === SURGE_MARK
          ? "The next cantrip of one action they cast this turn takes the bonus action."
          : "The next enchantment spell of 1st level or higher of one action they cast this turn takes the bonus action.",
      };
    },
  };
}

const SURGE_COUNTERS = new Set(["steampunk_surge_casting", "cyberpunk_surge_momentum", "post_apocalyptic_surge_of_change", "horror_the_rite_remembers"]);
