// take_action for an enemy (issue #621): Dash, Disengage, Dodge, and the
// escape from a grapple or a spell's hold. SRD 5.1 opens these actions to
// every creature, and the GM was told to use them (a turned undead "may only
// Dash", a frightened or calmed creature "may Dash"), but take_action
// resolved them for characters only and an enemy's walk always stopped at
// its speed. Each one now lands as real state on the enemy's turn record
// (src/lib/dm/enemy-turn-logic.ts): a Dash adds its speed to what move_token
// and enemy_attack's walk-up let it walk, a Disengage holds for every walk of
// the turn, a Dodge lays the condition the attack engine reads, and the
// action they spend is the action an attack would have spent.
//
// Split from action-tools.ts, which hands an enemyId call here. Must not
// import map-tools or encounter-tools (they import this).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, patchEnemyConditions, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, resetTurnBudgets } from "@/lib/db/battle-maps";
import { publishEphemeral } from "@/lib/events";
import { canEnemyAct, endsOwedTurn, enemyActedThisRound, enemyBonusThisRound, markEnemyActed, markEnemyBonus } from "@/lib/dm/can-act";
import { DODGING } from "@/lib/dm/condition-logic";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { enemyMoveBudget, enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import {
  dashesOf,
  enemyTurnEntry,
  forgetEnemyTurns,
  isEnemyTakeAction,
  movementLeftLine,
  owedTurnCarry,
  recordEnemyTurn,
  type EnemyTakeAction,
} from "@/lib/dm/enemy-turn-logic";
import { enemyEscape } from "@/lib/dm/grapple";
import { hostilesInSight } from "@/lib/dm/enemy-aggressive";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";

// Slow: an action or a bonus action on its turn, not both (SRD 5.1). The
// refusal, or null.
export function slowedOut(encounter: Encounter, enemy: EncounterEnemy, kind: "action" | "bonus"): ToolError | null {
  if (!conditionTurnShape(enemy.conditions).slowed) {
    return null;
  }
  const other = kind === "bonus" ? enemyActedThisRound(encounter, enemy.id) : enemyBonusThisRound(encounter, enemy.id);
  return other
    ? { error: `${enemy.displayName} is slowed: it takes an action or a bonus action this turn, not both, and it has taken its ${kind === "bonus" ? "action" : "bonus action"}.`, refused: "rules" }
    : null;
}

// Haste's extra action is still there to take this turn: hasted, its own
// action spent, the extra one not (SRD 5.1: one weapon attack, Dash,
// Disengage, Hide or Use an Object).
export function hasteActionOpen(encounter: Encounter, enemy: EncounterEnemy): boolean {
  return (
    conditionTurnShape(enemy.conditions).extraActions > 0 &&
    enemyActedThisRound(encounter, enemy.id) &&
    !enemyTurnEntry(encounter, enemy.id).hasteUsed
  );
}

type Route = "action" | "bonus" | "haste";

// Which part of its turn pays for this action, or the refusal: its action,
// Haste's extra action once its own is spent, or the bonus action a trait
// gives (`bonusBy`, null for none).
function routeFor(encounter: Encounter, enemy: EncounterEnemy, wantsBonus: boolean, bonusBy: string | null, hasteOk: boolean, word: string): Route | ToolError {
  if (wantsBonus) {
    if (!bonusBy) {
      return { error: `${enemy.displayName} has no bonus action that takes the ${word} action; it takes its action. Send it without bonus. Nothing was spent.`, refused: "rules" };
    }
    const allowed = canEnemyAct({ enemy, encounter, kind: "bonus" });
    if (!allowed.ok) {
      return toolError(allowed);
    }
    return slowedOut(encounter, enemy, "bonus") ?? "bonus";
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return hasteOk && allowed.reason === "already_acted" && hasteActionOpen(encounter, enemy) ? "haste" : toolError(allowed);
  }
  return slowedOut(encounter, enemy, "action") ?? "action";
}

const COSTS: Record<Route, string> = { action: "its action", bonus: "its bonus action", haste: "Haste's extra action" };

// Pays for the action on the encounter object: whose action it was, and
// whether it closed the turn the enemy was owed with its own turn following
// at once (can-act.ts endsOwedTurn). The caller records and saves.
function pay(live: Encounter, enemyId: string, route: Route): { closesOwedTurn: boolean } {
  if (route === "bonus") {
    markEnemyBonus(live, enemyId);
    return { closesOwedTurn: false };
  }
  if (route === "haste") {
    recordEnemyTurn(live, enemyId, { hasteUsed: true });
    return { closesOwedTurn: false };
  }
  const closesOwedTurn = endsOwedTurn(live, enemyId);
  markEnemyActed(live, enemyId);
  return { closesOwedTurn };
}

// What its own action went on, for the refusal an attack meets after it. An
// action that only paid back an owed turn leaves its own action free.
function noteSpent(live: Encounter, enemyId: string, route: Route, action: EnemyTakeAction) {
  if (route === "action" && enemyActedThisRound(live, enemyId)) {
    recordEnemyTurn(live, enemyId, { spentOn: action });
  }
}

// An enemy's Disengage, shared by take_action and move_token's disengage:
// once a turn, held for every walk after it (issue #621: a second move_token
// with disengage was refused as already acted, and leaving it off provoked).
// Nimble Escape pays with the bonus action, through the guard every bonus
// action meets (incapacitated, surprised, Slow), and falls back to the
// action once the bonus is spent; anyone else pays with its action, or
// Haste's extra one. Writes the encounter when it pays. `bonus`: the call
// asked for the bonus action.
export function spendEnemyDisengage(
  campaignId: string,
  enemy: EncounterEnemy,
  options: { bonus?: boolean } = {},
): { how: string; already?: true; closesOwedTurn?: boolean } | ToolError {
  const live = getActiveEncounter(campaignId);
  if (!live) {
    return { how: "no fight" };
  }
  if (enemyTurnEntry(live, enemy.id).disengaged) {
    return { how: "its Disengage earlier this turn", already: true };
  }
  const nimble = hasTrait(enemy.stats, "nimbleEscape");
  if (nimble && !options.bonus && canEnemyAct({ enemy, encounter: live, kind: "action" }).ok && enemyBonusThisRound(live, enemy.id)) {
    // Its bonus action is gone; the Disengage takes its action.
    return payDisengage(live, enemy, "action");
  }
  const route = routeFor(live, enemy, nimble || Boolean(options.bonus), nimble ? "Nimble Escape" : null, true, "Disengage");
  if (typeof route !== "string") {
    return route;
  }
  return payDisengage(live, enemy, route);
}

function payDisengage(live: Encounter, enemy: EncounterEnemy, route: Route): { how: string; closesOwedTurn?: boolean } | ToolError {
  if (route === "action") {
    const slow = slowedOut(live, enemy, "action");
    if (slow) {
      return slow;
    }
  }
  const { closesOwedTurn } = pay(live, enemy.id, route);
  recordEnemyTurn(live, enemy.id, { disengaged: true });
  noteSpent(live, enemy.id, route, "disengage");
  saveEncounter(live);
  return {
    how: route === "bonus" ? "a bonus action (Nimble Escape)" : route === "haste" ? "Haste's extra action (Disengage)" : "its action (Disengage)",
    ...(closesOwedTurn ? { closesOwedTurn } : {}),
  };
}

// The board's count once the action or the walk is stored, or null with no
// board: the Dash's reply and every enemy walk's (map-tools.ts).
export function movementLeft(campaignId: string, enemy: EncounterEnemy): string | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  return encounter && token ? movementLeftLine(enemyMoveBudget(encounter, enemy, token).tilesLeft) : null;
}

// The turn it was owed is closed and its own follows at once: what the owed
// turn left unwalked is carried in, and its movement counts afresh.
function carryOwedTurn(campaignId: string, enemy: EncounterEnemy, dash: boolean) {
  const live = getActiveEncounter(campaignId);
  const map = live ? getBattleMapForEncounter(live.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (!live || !map || !token) {
    return;
  }
  const speed = enemyMoveBudget(live, enemy, token).speedTiles;
  const carried = owedTurnCarry(speed, enemyTurnEntry(live, enemy.id), token.movedThisRound, dash);
  forgetEnemyTurns(live, [enemy.id]);
  recordEnemyTurn(live, enemy.id, carried);
  saveEncounter(live);
  resetTurnBudgets(map.id, [enemy.id]);
}

function dash(campaign: Campaign, enemy: EncounterEnemy, encounter: Encounter, bonus: boolean): ToolResult {
  // Aggressive (an orc's trait): its bonus action moves it up to its speed
  // toward a hostile creature it can see, which the board counts as a Dash.
  const route = routeFor(encounter, enemy, bonus, hasTrait(enemy.stats, "aggressive") ? "Aggressive" : null, true, "Dash");
  if (typeof route !== "string") {
    return route;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const speed = token ? enemyMoveBudget(encounter, enemy, token).speedTiles : enemySpeedTiles(enemy);
  if (speed <= 0) {
    return { error: `${enemy.displayName}'s speed is 0 right now, so a Dash gains it nothing. Nothing was spent.`, refused: "rules" };
  }
  // Aggressive moves it toward a hostile creature it can see: with none in
  // sight it has nowhere to rush (enemy-aggressive.ts).
  if (route === "bonus" && map && token && !hostilesInSight(encounter, map, enemy, token).length) {
    return { error: `${enemy.displayName} sees no hostile creature, and Aggressive moves it only toward one it can see. Nothing was spent.`, refused: "rules" };
  }
  const live = getActiveEncounter(campaign.id) ?? encounter;
  const { closesOwedTurn } = pay(live, enemy.id, route);
  if (!closesOwedTurn) {
    recordEnemyTurn(live, enemy.id, { dashes: dashesOf(enemyTurnEntry(live, enemy.id)) + 1, ...(route === "bonus" ? { aggressive: true } : {}) });
    noteSpent(live, enemy.id, route, "dash");
  }
  saveEncounter(live);
  if (closesOwedTurn) {
    carryOwedTurn(campaign.id, enemy, true);
  }
  publishEncounter(campaign.id);
  publishEphemeral(campaign.id, "battle_map_updated", {});
  const left = movementLeft(campaign.id, enemy);
  return {
    ok: true,
    action: "Dash",
    cost: COSTS[route] + (route === "bonus" ? " (Aggressive)" : ""),
    applied: `${enemy.displayName} adds its speed to its movement this turn; move it with move_token.${route === "bonus" ? " Aggressive carries it only toward a hostile creature it can see." : ""}`,
    ...(left ? { movementLeft: left } : {}),
  };
}

function disengage(campaign: Campaign, enemy: EncounterEnemy, bonus: boolean): ToolResult {
  const paid = spendEnemyDisengage(campaign.id, enemy, { bonus });
  if ("error" in paid) {
    return paid;
  }
  if (paid.closesOwedTurn) {
    carryOwedTurn(campaign.id, enemy, false);
  }
  publishEncounter(campaign.id);
  const left = movementLeft(campaign.id, enemy);
  return {
    ok: true,
    action: "Disengage",
    cost: paid.already ? "nothing more: it already Disengaged this turn" : paid.how,
    applied: `${enemy.displayName} can move out of every character's reach this turn without provoking an opportunity attack; move it with move_token.`,
    ...(left ? { movementLeft: left } : {}),
  };
}

function dodge(campaign: Campaign, enemy: EncounterEnemy, encounter: Encounter, bonus: boolean): ToolResult {
  const route = routeFor(encounter, enemy, bonus, null, false, "Dodge");
  if (typeof route !== "string") {
    return route;
  }
  const live = getActiveEncounter(campaign.id) ?? encounter;
  // An owed turn's Dodge closes it as an attack would (enemy-approach.ts).
  spendEnemyAction(live, enemy.id);
  noteSpent(live, enemy.id, route, "dodge");
  saveEncounter(live);
  // Until its next turn begins (condition-tick.ts ends untilTurnOf there):
  // attacks against it at disadvantage, its DEX saves at advantage.
  const has = enemy.conditions.some((entry) => entry.toLowerCase() === DODGING);
  patchEnemyConditions(enemy.id, has ? enemy.conditions : [...enemy.conditions, DODGING], {
    ...enemy.conditionMeta,
    [DODGING]: { untilTurnOf: enemy.id },
  });
  publishEncounter(campaign.id);
  return {
    ok: true,
    action: "Dodge",
    cost: COSTS[route],
    applied: `${enemy.displayName} is dodging: every attack against it rolls at disadvantage until its next turn, and it has advantage on DEX saves. The server applies it.`,
  };
}

function escape(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy, encounter: Encounter, bonus: boolean): ToolResult {
  const route = routeFor(encounter, enemy, bonus, null, false, "escape");
  if (typeof route !== "string") {
    return route;
  }
  const result = enemyEscape(campaign, turn, enemy.id);
  if ("error" in result) {
    return result;
  }
  const live = getActiveEncounter(campaign.id);
  if (live) {
    noteSpent(live, enemy.id, "action", "escape");
    saveEncounter(live);
  }
  return result;
}

export function handleEnemyTakeAction(
  campaign: Campaign,
  turn: DmTurn,
  args: { enemyId: string; action: string; bonus?: boolean },
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: an enemy takes an action only in a fight. Call start_encounter first.", retry: true };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  // Its own turn, as an attack's is (enemy-turn-order.ts): the escape skipped
  // this, so the model could free a goblin before its turn came.
  const early = enemyTurnRefusal(encounter, enemy, turn);
  if (early) {
    return early;
  }
  const bonus = args.bonus === true;
  if (!isEnemyTakeAction(args.action)) {
    // What bars the act comes first (tool-errors.ts): a stunned goblin is
    // told it is stunned before it is told Help is no action of its.
    const allowed = canEnemyAct({ enemy, encounter, kind: bonus ? "bonus" : "action" });
    if (!allowed.ok) {
      return toolError(allowed);
    }
    return {
      error: `An enemy's take_action is dash, disengage, dodge or escape; ${args.action.replace(/_/g, " ")} is a character's here. Its attacks are enemy_attack, its spells and abilities cast_at_player or aoe_damage. Nothing was spent.`,
      retry: true,
    };
  }
  switch (args.action) {
    case "dash":
      return dash(campaign, enemy, encounter, bonus);
    case "disengage":
      return disengage(campaign, enemy, bonus);
    case "dodge":
      return dodge(campaign, enemy, encounter, bonus);
    case "escape":
      return escape(campaign, turn, enemy, encounter, bonus);
  }
}
