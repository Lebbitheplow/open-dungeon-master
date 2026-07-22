// The 5e action economy as pure state: what the combatant whose turn it is
// has left to spend. Before this, "an action" was whatever the model felt
// like doing, so a level-1 wizard could attack four times and a fighter with
// Extra Attack was never told they had a second swing.
//
// Database-free like condition-logic.ts and encounter-logic.ts so
// scripts/test-action-budget.mjs can exercise every branch. The encounters
// table stores one of these at a time (turn_budget_json), reset whenever the
// initiative pointer lands on a new combatant.

export type ActionKind = "action" | "bonus" | "reaction";

export type TurnBudget = {
  // Whose turn this budget belongs to: a character sheet id or an enemy id.
  // The budget is discarded and rebuilt when the pointer moves, so a stale
  // owner means the state is from a previous turn and must be ignored.
  ownerId: string;
  round: number;
  actionUsed: boolean;
  bonusUsed: boolean;
  // Reactions refresh at the start of the owner's turn, so this is the only
  // field that matters between their turns too.
  reactionUsed: boolean;
  // Attacks already made with the Attack action this turn.
  attacksMade: number;
  // Total attacks the Attack action grants (1 + Extra Attack).
  attacksAllowed: number;
  // Sneak Attack, and anything else limited to once per turn, by key.
  oncePerTurn: string[];
  // Set by the Dash action. Movement itself is NOT tracked here: the battle
  // map owns it (battle_tokens.moved_this_round), and this flag is what
  // doubles that allowance for the turn.
  dashed: boolean;
  // Set by the Disengage action: leaving a reach provokes nothing this turn.
  disengaged: boolean;
  // Extra actions still available this turn (Haste grants one, usable for
  // one weapon attack, Dash, Disengage, Hide, or Use an Object).
  extraActions?: number;
};

export function freshBudget(input: {
  ownerId: string;
  round: number;
  attacksAllowed?: number;
  extraActions?: number;
}): TurnBudget {
  return {
    ownerId: input.ownerId,
    round: input.round,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
    attacksMade: 0,
    attacksAllowed: Math.max(1, input.attacksAllowed ?? 1),
    oncePerTurn: [],
    dashed: false,
    disengaged: false,
    ...(input.extraActions ? { extraActions: input.extraActions } : {}),
  };
}

// Whether a stored budget still describes the combatant currently acting.
// Anything else is left over from an earlier turn.
export function budgetApplies(
  budget: TurnBudget | null,
  ownerId: string,
  round: number,
): budget is TurnBudget {
  return budget !== null && budget.ownerId === ownerId && budget.round === round;
}

export type SpendResult =
  | { ok: true; budget: TurnBudget; note?: string }
  | { ok: false; error: string };

// The Haste extra action, spent when the normal slot is gone. Null when
// none remains.
function spendExtraAction(budget: TurnBudget, what: string, who: string): SpendResult | null {
  if ((budget.extraActions ?? 0) <= 0) {
    return null;
  }
  return {
    ok: true,
    budget: { ...budget, extraActions: (budget.extraActions ?? 0) - 1 },
    note: `${who} spends their extra action (Haste) on ${what}.`,
  };
}

// Spends the action, bonus action, or reaction. The refusal text is written
// for the model: it says what is gone and what remains, so it narrates a
// real limit rather than inventing one.
export function spendAction(
  budget: TurnBudget,
  kind: ActionKind,
  what: string,
  who: string,
): SpendResult {
  if (kind === "action" && budget.actionUsed) {
    const extra = spendExtraAction(budget, what, who);
    if (extra) {
      return extra;
    }
    return {
      ok: false,
      error: `${who} has already used their action this turn; ${what} needs one. They can still move${
        budget.bonusUsed ? "" : " or take a bonus action"
      }, or end their turn.`,
    };
  }
  if (kind === "bonus" && budget.bonusUsed) {
    return {
      ok: false,
      error: `${who} has already used their bonus action this turn; ${what} needs one.`,
    };
  }
  if (kind === "reaction" && budget.reactionUsed) {
    return {
      ok: false,
      error: `${who} has already used their reaction; it comes back at the start of their next turn. ${what} does not happen.`,
    };
  }
  return {
    ok: true,
    budget: {
      ...budget,
      actionUsed: kind === "action" ? true : budget.actionUsed,
      bonusUsed: kind === "bonus" ? true : budget.bonusUsed,
      reactionUsed: kind === "reaction" ? true : budget.reactionUsed,
    },
  };
}

// One swing of the Attack action. The first attack spends the action; the
// rest come free until Extra Attack runs out. Off-hand attacks are a bonus
// action instead and go through spendAction.
export function spendAttack(budget: TurnBudget, who: string): SpendResult {
  if (budget.attacksMade >= budget.attacksAllowed || (budget.attacksMade === 0 && budget.actionUsed)) {
    // The normal Attack action is gone; the Haste extra action buys exactly
    // one more weapon attack.
    const extra = spendExtraAction(budget, "one weapon attack", who);
    if (extra && extra.ok) {
      return {
        ...extra,
        budget: {
          ...extra.budget,
          actionUsed: true,
          attacksMade: Math.max(extra.budget.attacksMade, extra.budget.attacksAllowed),
        },
      };
    }
  }
  if (budget.attacksMade >= budget.attacksAllowed) {
    // The action is spent AND the swings are gone: no more attacking.
    return {
      ok: false,
      error: `${who} has already made all ${budget.attacksAllowed} of their attack${
        budget.attacksAllowed === 1 ? "" : "s"
      } this turn. They cannot attack again; move, take a bonus action, or end their turn.`,
    };
  }
  if (budget.attacksMade === 0 && budget.actionUsed) {
    return {
      ok: false,
      error: `${who} has already used their action this turn, so they cannot take the Attack action.`,
    };
  }
  return {
    ok: true,
    budget: {
      ...budget,
      actionUsed: true,
      attacksMade: budget.attacksMade + 1,
    },
  };
}

// How many attacks are left, for the reminder the tool result carries.
export function attacksLeft(budget: TurnBudget): number {
  return Math.max(0, budget.attacksAllowed - budget.attacksMade);
}

// Once-per-turn riders (Sneak Attack). Returns null when already spent.
export function claimOncePerTurn(budget: TurnBudget, key: string): TurnBudget | null {
  if (budget.oncePerTurn.includes(key)) {
    return null;
  }
  return { ...budget, oncePerTurn: [...budget.oncePerTurn, key] };
}

// A one-line summary for the DM prompt's GAME STATE block, so the model can
// see what the acting character still has before it decides anything.
export function describeBudget(budget: TurnBudget): string {
  const parts: string[] = [];
  if (budget.attacksMade > 0 && attacksLeft(budget) > 0) {
    parts.push(`${attacksLeft(budget)} attack${attacksLeft(budget) === 1 ? "" : "s"} left`);
  } else if (!budget.actionUsed) {
    parts.push("action");
  }
  if (!budget.bonusUsed) {
    parts.push("bonus action");
  }
  if (!budget.reactionUsed) {
    parts.push("reaction");
  }
  if ((budget.extraActions ?? 0) > 0) {
    parts.push("an extra action (Haste)");
  }
  if (budget.dashed) {
    parts.push("doubled movement (Dash)");
  }
  if (budget.disengaged) {
    parts.push("disengaged (provokes nothing)");
  }
  return parts.length ? `has ${parts.join(", ")} remaining` : "has nothing left to spend";
}
