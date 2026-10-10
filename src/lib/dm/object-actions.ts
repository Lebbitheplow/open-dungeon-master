// Use an Object, Search and Ready: the actions of SRD 5.1's "Actions in
// Combat" that had no engine before. The battle-map hand offered "I ready an
// action" and "I use an object", and use_item let a character drink a potion
// every turn, off their turn, or at 0 hit points, for free.
//
//   - Use an Object: drinking a potion, or feeding one to a creature within
//     reach, is an action; so is any other object that needs one. Haste's
//     extra action may pay for it.
//   - Search: an action, a Wisdom (Perception) or Intelligence
//     (Investigation) check.
//   - Ready: the action now, a trigger named, and the response later with
//     the reaction. ODM holds a readied attack: the character carries
//     "readied" until the start of their next turn, and the one off-turn
//     pc_attack it allows spends it and the reaction
//     (src/lib/dm/pc-attack-plan.ts).

import { coatsAsBonusAction, drinksAsBonusAction } from "@/lib/srd/feat-combat";
import { isBasicPoison } from "@/lib/dm/attack-onhit";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { spendAction } from "@/lib/dm/action-budget";
import { addSheetCondition } from "@/lib/dm/action-common";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { canAct } from "@/lib/dm/can-act";
import { removeConditions } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { findCarriedItem, itemUseProblem } from "@/lib/dm/item-logic";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";

// Haste's extra action names this use by these words (action-budget.ts).
const USE_AN_OBJECT = "use an object";

// The readied condition a Ready action leaves on the character.
export const READIED = "readied";

// ---- use_item: what using a carried item costs ----

// Everything that can refuse a use_item, asked before anything is spent:
// the item has to be one that is used up, the user has to be able to act,
// a creature fed a potion has to be within reach, and in a fight the use
// is the user's action. Returns the charge to commit once the item is used.
export function prepareUseItem(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  itemName: string,
): { error: string } | { commit: () => Record<string, unknown> } {
  const carried = findCarriedItem(sheet.equipment, itemName);
  const problem = carried ? itemUseProblem(carried.name) : null;
  if (problem) {
    return { error: `${sheet.name} does not use up ${carried?.name ?? itemName}: ${problem}` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const allowed = canAct({ sheet, encounter, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  if (target.id !== sheet.id && encounter) {
    const apart = tilesBetween(encounter.id, sheet.id, target.id);
    if (apart !== null && apart > 1) {
      return {
        error: `${target.name} is ${apart * 5} ft from ${sheet.name}; feeding them a potion needs them within 5 ft. ${sheet.name} moves next to them first.`,
      };
    }
  }
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  if (!budget || !encounter) {
    return { commit: () => ({}) };
  }
  // Rapid Drinker drinks a potion as a bonus action; Poisoner coats a
  // weapon as one (src/lib/srd/feat-combat.ts).
  const name = carried?.name ?? itemName;
  const asBonus =
    (drinksAsBonusAction(sheet) && /\b(?:potion|elixir|philter)\b/i.test(name)) ||
    (coatsAsBonusAction(sheet) && isBasicPoison(name, sheet.campaignId));
  const price = asBonus
    ? spendAction(budget, "bonus", `${drinksAsBonusAction(sheet) && /\b(?:potion|elixir|philter)\b/i.test(name) ? "Rapid Drinker" : "Poisoner"} (${USE_AN_OBJECT})`, sheet.name)
    : spendAction(budget, "action", USE_AN_OBJECT, sheet.name);
  if (!price.ok) {
    return { error: price.error };
  }
  return {
    commit: () => {
      const live = getActiveEncounter(campaign.id);
      if (live) {
        storeBudget(live, price.budget);
      }
      return { cost: price.note ?? `${sheet.name}'s action (Use an Object)` };
    },
  };
}

// ---- take_action use_object, search, ready ----

type Priced = { spend: () => void };

// Use an Object for a thing that is not used up: a lever, a stuck door, a
// rope to throw. A consumable goes through use_item, which charges the same
// action, so the model is pointed there rather than paying twice.
export function objectAction(
  sheet: CharacterSheet,
  item: string | undefined,
  reason: string | undefined,
  priced: Priced,
  // What it costs, for the result: a Thief's Fast Hands makes it the bonus
  // action.
  cost = "their action",
): Record<string, unknown> {
  const carried = item ? findCarriedItem(sheet.equipment, item) : null;
  if (carried && !itemUseProblem(carried.name)) {
    return {
      error: `${carried.name} is used up when it is used: call use_item for it, which spends ${sheet.name}'s action (Use an Object) itself.`,
    };
  }
  priced.spend();
  const what = (item ?? reason ?? "an object").slice(0, 80);
  return {
    ok: true,
    action: "Use an Object",
    applied: `${sheet.name} spends ${cost} on ${what}. Narrate what the object does; anything with a roll or a rules effect goes through its own tool.`,
  };
}

export function searchAction(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  skill: "perception" | "investigation",
  priced: Priced,
): Record<string, unknown> {
  priced.spend();
  const check = rollCharacterCheck(
    campaign,
    sheet,
    { skill },
    `${sheet.name}: Search (${skill === "perception" ? "Perception" : "Investigation"})`,
  );
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  return {
    ok: true,
    action: "Search",
    skill,
    total: check.total,
    ...(check.notes.length ? { notes: check.notes } : {}),
    note: `${sheet.name} searches: ${skill} ${check.total}. Compare it with the DC of what is there to find (a hidden creature's Stealth, a trap's DC); what they do not beat stays unfound.`,
  };
}

export function readyAction(
  campaign: Campaign,
  sheet: CharacterSheet,
  trigger: string | undefined,
  inFight: boolean,
  priced: Priced,
): Record<string, unknown> {
  const named = (trigger ?? "").trim();
  if (!inFight) {
    return { error: "Ready is an action in a fight, where turns are taken in order; there is no active fight." };
  }
  if (!named) {
    return {
      error: "Ready needs the trigger it waits for, e.g. trigger: 'when the goblin steps through the door'. Nothing was spent.",
    };
  }
  priced.spend();
  addSheetCondition(campaign, getSheetById(sheet.id) ?? sheet, READIED, { untilTurnOf: sheet.id }, named);
  return {
    ok: true,
    action: "Ready",
    trigger: named.slice(0, 80),
    applied: `${sheet.name} has readied an action until the start of their next turn. When the trigger happens, resolve the readied attack with pc_attack: it is made off their turn with their reaction, and the server spends both. If the trigger never comes, the readied action is lost.`,
  };
}

// The readied action a character holds, or null.
export function readiedTrigger(sheet: CharacterSheet): string | null {
  const name = sheet.conditions.find((entry) => entry.trim().toLowerCase() === READIED);
  if (!name) {
    return null;
  }
  return (sheet.conditionMeta as Record<string, { source?: string }>)[name]?.source ?? "their trigger";
}

// Spends a readied action: the off-turn attack it allowed has been made.
export function spendReadied(campaign: Campaign, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (!sheet || !readiedTrigger(sheet)) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [READIED]);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}
