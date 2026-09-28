// The stored side of the action economy: the live budget of the combatant
// at the initiative pointer, read from and written to the encounter row.
// The arithmetic is src/lib/dm/action-budget.ts; this module is only the
// plumbing, kept apart from action-tools.ts so that anything may import it
// (resource-tools grants Action Surge through here) without pulling in the
// handlers.

import { getActiveEncounter, orderEntryId, saveEncounter, type Encounter } from "@/lib/db/encounters";
import {
  budgetApplies,
  freshBudget,
  grantAction,
  type TurnBudget,
} from "@/lib/dm/action-budget";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { combatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The combatant the initiative pointer is currently on, or null out of
// combat and while initiative is still being rolled.
export function currentCombatantId(encounter: Encounter | null): string | null {
  if (!encounter || !encounter.orderReady) {
    return null;
  }
  const entry = encounter.order[encounter.turnIndex];
  if (!entry) {
    return null;
  }
  return orderEntryId(entry);
}

// The live budget for a combatant, created on first use of their turn.
// Returns null when they are not the one acting: off their own turn a
// character has a reaction and nothing else, which src/lib/dm/can-act.ts
// enforces before anybody asks for a budget.
export function budgetFor(
  encounter: Encounter | null,
  ownerId: string,
  attacksAllowed: number,
  // Extra actions per turn from effect conditions (Haste); only seeds a
  // FRESH budget so spending one mid-turn sticks.
  extraActions = 0,
): TurnBudget | null {
  if (!encounter || currentCombatantId(encounter) !== ownerId) {
    return null;
  }
  if (budgetApplies(encounter.turnBudget, ownerId, encounter.round)) {
    // attacksAllowed can change mid-turn (a level-up, a lead correction);
    // the higher of the two is the fair reading.
    return {
      ...encounter.turnBudget,
      attacksAllowed: Math.max(encounter.turnBudget.attacksAllowed, attacksAllowed),
    };
  }
  return freshBudget({ ownerId, round: encounter.round, attacksAllowed, extraActions });
}

export function storeBudget(encounter: Encounter, budget: TurnBudget) {
  encounter.turnBudget = budget;
  saveEncounter(encounter);
}

// Attacks the Attack action grants this character: 1 plus Extra Attack.
export function attacksAllowedFor(sheet: CharacterSheet): number {
  return 1 + combatRiders(sheet).extraAttacks;
}

// Action Surge: one additional action on the turn it is used. Called by
// use_resource once the use is spent. Returns a line for the tool result, or
// null when there is no turn to add it to (out of combat, or not the
// fighter's own turn), in which case the surge is narration only.
export function grantActionSurge(campaignId: string, sheet: CharacterSheet): string | null {
  const encounter = getActiveEncounter(campaignId);
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  if (!encounter || !budget) {
    return null;
  }
  storeBudget(encounter, grantAction(budget));
  return `${sheet.name} has one additional action this turn: a second Attack action with every attack it holds, or any other action. The server tracks it.`;
}
