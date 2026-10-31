// An enemy acts on its own turn (SRD 5.1, Combat: "on your turn"). ODM's
// pointer rests on characters; the enemies between two characters take their
// turns as the pointer passes them (end_turn hands them to the model, the
// backstop plays the rest). So for the AI DM an enemy's action is refused
// while its place in the order is still ahead of the pointer this round:
// it may act when the pointer has passed it, when end_turn just handed it
// over or an earlier pass left it due (src/lib/dm/enemies-due.ts), when it
// is owed an action (a surprised party's lost round), or with a legendary
// action that buys an attack. Reactions and legendary actions
// are not actions and never come here. A person at the console keeps a free
// hand, as with every correction.

import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { AttackStop } from "@/lib/dm/turn-lines-logic";

export function enemyTurnRefusal(
  encounter: Encounter | null,
  enemy: Pick<EncounterEnemy, "id" | "displayName" | "status">,
  turn: Pick<DmTurn, "id" | "actor">,
): (ToolError & { stop?: AttackStop }) | null {
  if (turn.actor !== "ai" || !encounter || !encounter.orderReady || encounter.kind === "scene") {
    return null;
  }
  // The dead are told they are dead before they are told whose turn it is
  // (src/lib/dm/can-act.ts). "Its turn has not come yet" would promise the
  // model a turn that never comes, and whether it heard that or "is dead"
  // would hang on where the corpse sat in the order.
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status} and cannot act.`, retry: true };
  }
  const slot = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id);
  if (slot < 0 || slot < encounter.turnIndex) {
    return null;
  }
  const legendary = encounter.legendary;
  const handedOver =
    (legendary.handoff?.turnId === turn.id && legendary.handoff.enemyIds.includes(enemy.id)) ||
    (legendary.due ?? []).includes(enemy.id);
  const owed = legendary.acted?.round === encounter.round && (legendary.acted.owed ?? []).includes(enemy.id);
  const strike = (legendary.strikes ?? []).includes(enemy.id);
  if (handedOver || owed || strike) {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  // Tagged so a line for the table says so (turn-lines-logic.ts): a person's
  // "run the monsters" read "does not attack this turn" with no reason
  // (issue #666).
  return { error: `${enemy.displayName}'s turn has not come yet this round: it is ${current?.name ?? "another combatant"}'s turn. An enemy acts when end_turn hands it to you; off its turn it only reacts (opportunity attacks are automatic) or takes a legendary action.`, retry: true, stop: "turn" };
}

// The same, read from a tool call's arguments (enemyId for enemy_attack,
// casterEnemyId for a spell or ability): the refusal, or null.
export function enemyCallOutOfTurn(
  campaignId: string,
  turn: Pick<DmTurn, "id" | "actor">,
  rawArguments: string,
  key: "enemyId" | "casterEnemyId",
): ToolError | null {
  if (turn.actor !== "ai") {
    return null;
  }
  let ref: unknown;
  try {
    ref = (JSON.parse(rawArguments || "{}") as Record<string, unknown>)[key];
  } catch {
    return null;
  }
  if (typeof ref !== "string" || !ref.trim()) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  const enemy = encounter ? resolveEnemyRef(encounter.id, ref) : null;
  return enemy ? enemyTurnRefusal(encounter, enemy, turn) : null;
}
