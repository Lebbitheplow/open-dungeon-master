// How a take_action is paid for (split from action-tools.ts, which resolves
// it): the action itself, or the bonus action a feature moves it to (Cunning
// Action, Fast Hands, a monk's ki, the feats', Expeditious Retreat's own
// Dash), priced before any of the action's own checks so a refusal spends
// nothing. Nothing here writes; action-tools.ts stores the budget it returns.

import { acBreakdownFor } from "@/lib/srd";
import { spendAction, spendAttack, type SpendResult, type TurnBudget } from "@/lib/dm/action-budget";
import { bonusRouteFor, counterSpend, kiSpend, noBonusRoute, type BonusRoute, type MoveAction } from "@/lib/dm/bonus-actions";
import { authoredBonusRoute } from "@/lib/srd/authored-economy";
import { featBonusRoute } from "@/lib/srd/feat-combat";
import { EXPEDITIOUS_RETREAT, hasFastHands } from "@/lib/dm/bonus-routes";
import { BONUS_SPELL } from "@/lib/dm/cast-rules";
import { grapplingStrikeDie } from "@/lib/dm/maneuver-reactions";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

export const ACTIONS = [
  "dodge",
  "dash",
  "disengage",
  "hide",
  "help",
  "grapple",
  "shove",
  "ready",
  "search",
  "use_object",
  "escape",
] as const;

export type TakeActionName = (typeof ACTIONS)[number];

// The words each action is priced under. Haste's extra action reads them
// (src/lib/dm/action-budget.ts): one weapon attack, Dash, Disengage, Hide
// or Use an Object.
const ACTION_WORDS: Record<(typeof ACTIONS)[number], string> = {
  dodge: "dodge",
  dash: "dash",
  disengage: "disengage",
  hide: "hide",
  help: "help",
  grapple: "grapple",
  shove: "shove",
  ready: "ready",
  search: "search",
  use_object: "use an object",
  escape: "escape",
};

const MOVES = new Set<string>(["dodge", "dash", "disengage", "hide"]);

// How an action is paid for: the priced budget, and what the tool result
// says of the cost. Null budget = no turn to charge (out of a fight).
// `counter`: the counted route's use, and the feature it is a use of.
export type Price = {
  budget: TurnBudget | null;
  note?: string;
  ki?: number;
  feature?: string;
  counter?: { id: string; feature: string };
};

export function priceAction(
  sheet: CharacterSheet,
  budget: TurnBudget | null,
  action: (typeof ACTIONS)[number],
  bonus: boolean,
  context: { allyDown?: boolean } = {},
): Price | ToolError {
  const move = MOVES.has(action) ? (action as MoveAction) : null;
  // Fast Hands (Thief 3): Use an Object with Cunning Action's bonus action.
  if (bonus && action === "use_object" && hasFastHands(sheet)) {
    if (!budget) {
      return { budget: null, feature: "Fast Hands" };
    }
    const spent = spendAction(budget, "bonus", "Fast Hands (use an object)", sheet.name);
    return spent.ok
      ? { budget: spent.budget, note: "Fast Hands: their bonus action", feature: "Fast Hands" }
      : toolError(spent);
  }
  if (bonus) {
    // Help and Search as a bonus action are the authored features' (Master
    // of Tactics, Eye for Detail): src/lib/srd/authored-effects.ts.
    // The feats' bonus-action routes: Tavern Brawler's grapple after its
    // hit, Shield Master's shove after the Attack action with a shield,
    // Charger's shove after a Dash (src/lib/srd/feat-combat.ts).
    // Grappling Strike's hit opens the grapple as a bonus action
    // (src/lib/dm/maneuver-reactions.ts).
    const route: BonusRoute | null =
      (move ? bonusRouteFor(sheet, move, context) : authoredBonusRoute(sheet, action)) ??
      (action === "grapple" && grapplingStrikeDie(sheet) ? { feature: "Grappling Strike", ki: 0 } : null) ??
      featBonusRoute(sheet, action, budget, Boolean(acBreakdownFor(sheet).shieldName));
    if (!route) {
      return move
        ? noBonusRoute(sheet, move)
        : { error: `${action} is not a bonus action for ${sheet.name}; it takes their action.`, refused: "rules" };
    }
    if (route.ki) {
      const covered = kiSpend(sheet, route.ki, route.feature);
      if ("error" in covered) {
        return covered;
      }
    }
    if (route.counter) {
      const covered = counterSpend(sheet, route.counter, route.feature);
      if ("error" in covered) {
        return covered;
      }
    }
    const counter = route.counter ? { counter: { id: route.counter, feature: route.feature } } : {};
    if (!budget) {
      return { budget: null, ki: route.ki, feature: route.feature, ...counter };
    }
    // Expeditious Retreat's casting (itself the bonus action) takes the Dash
    // with it, once, on the turn it is cast.
    if (route.feature === "Expeditious Retreat" && budget.bonusUsed && castRetreatThisTurn(sheet, budget)) {
      return {
        budget: { ...budget, oncePerTurn: [...budget.oncePerTurn, RETREAT_DASH] },
        note: "Expeditious Retreat: the Dash that comes with the casting",
        feature: route.feature,
      };
    }
    const spent = spendAction(budget, "bonus", `${route.feature} (${action})`, sheet.name);
    return spent.ok
      ? { budget: spent.budget, note: `${route.feature}: their bonus action`, ki: route.ki, feature: route.feature, ...counter }
      : toolError(spent);
  }
  if (!budget) {
    return { budget: null };
  }
  // Grapple and Shove take the place of one attack of the Attack action.
  let spent: SpendResult =
    action === "grapple" || action === "shove"
      ? spendAttack(budget, sheet.name, { hasteOk: false })
      : spendAction(budget, "action", ACTION_WORDS[action], sheet.name);
  if (!spent.ok && move) {
    // With the action gone, a free bonus-action route (Cunning Action) is
    // what the player meant; a ki route costs ki and a counted one a use, and
    // both wait to be asked for.
    const route = bonusRouteFor(sheet, move, context);
    if (route && route.ki === 0 && !route.counter) {
      const asBonus = spendAction(budget, "bonus", `${route.feature} (${action})`, sheet.name);
      if (asBonus.ok) {
        spent = { ...asBonus, note: `${route.feature}: their bonus action` };
        return { budget: spent.budget, note: spent.note, ki: 0, feature: route.feature };
      }
    }
  }
  return spent.ok ? { budget: spent.budget, note: spent.note } : toolError(spent);
}

export const RETREAT_DASH = "expeditious-retreat:dash";

// Whether Expeditious Retreat was cast on this very turn: a bonus-action
// spell went on the turn, the spell's minute-count has not ticked yet (the
// round has not wrapped since), and its casting's Dash is still unclaimed.
function castRetreatThisTurn(sheet: CharacterSheet, budget: TurnBudget): boolean {
  if (!budget.oncePerTurn.includes(BONUS_SPELL) || budget.oncePerTurn.includes(RETREAT_DASH)) {
    return false;
  }
  const name = sheet.conditions.find((entry) => entry.trim().toLowerCase() === EXPEDITIOUS_RETREAT);
  const meta = name ? (sheet.conditionMeta as Record<string, { rounds?: number }>)[name] : undefined;
  return (meta?.rounds ?? 0) >= RETREAT_ROUNDS;
}
const RETREAT_ROUNDS = 100;
