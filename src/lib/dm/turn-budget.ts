// The stored side of the action economy: the live budget of the combatant
// at the initiative pointer, read from and written to the encounter row.
// The arithmetic is src/lib/dm/action-budget.ts; this module is only the
// plumbing, kept apart from action-tools.ts so that anything may import it
// (resource-tools grants Action Surge through here) without pulling in the
// handlers.

import { getActiveEncounter, orderEntryId, saveEncounter, type Encounter } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishPersisted } from "@/lib/events";
import { reactingSheet, reactionRefusal } from "@/lib/dm/reaction-gate";
import { reactionTimingOf, type ReactionTiming } from "@/lib/dm/reaction-kinds";
import {
  budgetApplies,
  freshBudget,
  grantAction,
  type StruckSwing,
  type TurnBudget,
} from "@/lib/dm/action-budget";
import { conditionTurnShape, type TurnShape } from "@/lib/srd/condition-effects";
import { combatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonAttacksPerTurn } from "@/lib/dm/summon-rules";
import { findBeastForm } from "@/lib/srd/beast-forms";
import { formSees } from "@/lib/srd/form-sees";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";

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
  // What the owner's conditions make of the turn (conditionTurnShape):
  // Haste's extra action and Slow's limits, or a bare count of extra actions.
  shape: number | TurnShape = 0,
): TurnBudget | null {
  if (!encounter || currentCombatantId(encounter) !== ownerId) {
    return null;
  }
  const { extraActions, slowed } = typeof shape === "number" ? { extraActions: shape, slowed: false } : shape;
  // Slow: one attack a turn, whatever Extra Attack would give.
  const allowed = slowed ? 1 : attacksAllowed;
  if (budgetApplies(encounter.turnBudget, ownerId, encounter.round)) {
    const held = encounter.turnBudget;
    // Haste landing mid-turn gives its action on this turn; one already
    // given is not given again, and one spent stays spent. (A budget stored
    // before the count was kept was seeded with it if it carries the field.)
    const given = held.hasteGranted ?? (held.extraActions !== undefined ? extraActions : 0);
    const gained = Math.max(0, extraActions - given);
    return {
      ...held,
      // attacksAllowed can change mid-turn (a level-up, a lead correction);
      // the higher of the two is the fair reading, unless Slow caps it.
      attacksAllowed: slowed ? 1 : Math.max(held.attacksAllowed, allowed),
      ...(gained ? { extraActions: (held.extraActions ?? 0) + gained, hasteGranted: extraActions } : {}),
      ...(slowed ? { slowed: true } : {}),
    };
  }
  return freshBudget({ ownerId, round: encounter.round, attacksAllowed: allowed, extraActions, slowed });
}

export function storeBudget(encounter: Encounter, budget: TurnBudget) {
  encounter.turnBudget = budget;
  saveEncounter(encounter);
  publishTurnCount(encounter.campaignId);
}

// An attack this turn rolled, kept on the turn's budget beside what it spent
// (action-budget.ts TurnBudget.struck). Nothing when the budget is not this
// owner's turn: an attack off their turn spends no budget either.
export function noteSwing(campaignId: string, ownerId: string, result: ToolResult) {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (!encounter || !budgetApplies(budget, ownerId, encounter.round)) {
    return;
  }
  if (typeof result.target !== "string" || typeof result.hit !== "boolean") {
    return;
  }
  const swing: StruckSwing = {
    target: result.target,
    hit: result.hit,
    ...(typeof result.damage === "number" ? { damage: result.damage } : {}),
  };
  encounter.turnBudget = { ...budget, struck: [...(budget.struck ?? []), swing] };
  saveEncounter(encounter);
}

// The pips on the board and in the Hand read the count from the encounter
// projection, which a client pulls again on a roll or on this event: a spend
// that rolls nothing (a bonus-action buff, a feature, a Dash) is pushed here,
// or the table sees it only at the next roll. enemy-damage.ts's
// publishEncounter sends the same, but importing it would close a cycle
// (it imports mutations.ts, which imports this module).
function publishTurnCount(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", { encounter: activePublicEncounter(campaignId) });
}

// A character's reaction is spent until the start of their next turn. It
// lives in reactionsUsed, not in the turn budget, because it is mostly spent
// on somebody else's turn.
export function markReactionUsed(encounter: Encounter, characterId: string) {
  encounter.reactionsUsed = [...encounter.reactionsUsed, characterId];
  saveEncounter(encounter);
  publishTurnCount(encounter.campaignId);
}

// A reaction as the cost of a feature, checked first and written last so a
// refusal costs nothing (the resource-turn.ts pattern). Who may react is
// asked as use_reaction asks it (src/lib/dm/reaction-gate.ts), with the
// feature's own timing (src/lib/dm/reaction-kinds.ts). `beforeDrop` says the
// character was judged as they stood before the hit that dropped them, which
// is what lets a use at 0 hit points through (issue 233).
export function prepareReaction(
  encounter: Encounter,
  sheet: CharacterSheet,
  label: string,
  timing: ReactionTiming = reactionTimingOf(label),
): ToolError | { commit: () => ToolResult; beforeDrop: boolean } {
  const refused = reactionRefusal(encounter.campaignId, sheet, encounter, label, timing);
  if (refused) {
    return refused;
  }
  const { beforeDrop } = reactingSheet(encounter.campaignId, sheet, timing);
  if (encounter.reactionsUsed.includes(sheet.id)) {
    return { error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${label} does not happen.`, refused: "rules" };
  }
  return {
    beforeDrop,
    commit: () => {
      const live = getActiveEncounter(encounter.campaignId);
      if (live && !live.reactionsUsed.includes(sheet.id)) {
        markReactionUsed(live, sheet.id);
      }
      return { cost: "their reaction" };
    },
  };
}

// Attacks the Attack action grants this character: 1 plus Extra Attack.
export function attacksAllowedFor(sheet: CharacterSheet): number {
  // A summoned creature's Attack action is its Multiattack (summon-rules.ts).
  const summoned = summonAttacksPerTurn(sheet);
  if (summoned !== null) {
    return summoned;
  }
  // A beast form attacks as its Multiattack lets it; a Polymorph's beast
  // has no Extra Attack of the character's (form-sees.ts).
  // The record carries the form's Multiattack; one written before it did
  // reads the table's form of that name.
  const shaped = sheet.wildShape ? (sheet.wildShape.attacksPerTurn ?? findBeastForm(sheet.wildShape.form)?.attacksPerTurn ?? 1) : null;
  const own = 1 + combatRiders(formSees(sheet)).extraAttacks;
  return shaped !== null ? Math.max(shaped, own) : own;
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
    conditionTurnShape(sheet.conditions),
  );
  if (!encounter || !budget) {
    return null;
  }
  storeBudget(encounter, grantAction(budget));
  return `${sheet.name} has one additional action this turn: a second Attack action with every attack it holds, or any other action. The server tracks it.`;
}
