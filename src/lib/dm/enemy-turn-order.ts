// An enemy acts on its own turn (SRD 5.1, Combat: "on your turn"). ODM's
// pointer rests on characters; the enemies between two characters take their
// turns as the pointer passes them (end_turn hands them to the model, the
// backstop plays the rest). So for the AI DM an enemy's action is refused
// while its place in the order is still ahead of the pointer this round:
// it may act when the pointer has passed it, when end_turn just handed it
// over, when it is owed an action (a surprised party's lost round), or with
// a legendary action that buys an attack. Reactions and legendary actions
// are not actions and never come here. A person at the console keeps a free
// hand, as with every correction.

import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";

export function enemyTurnRefusal(
  encounter: Encounter | null,
  enemy: Pick<EncounterEnemy, "id" | "displayName">,
  turn: Pick<DmTurn, "id" | "actor">,
): string | null {
  if (turn.actor !== "ai" || !encounter || !encounter.orderReady || encounter.kind === "scene") {
    return null;
  }
  const slot = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id);
  if (slot < 0 || slot < encounter.turnIndex) {
    return null;
  }
  const legendary = encounter.legendary;
  const handedOver = legendary.handoff?.turnId === turn.id && legendary.handoff.enemyIds.includes(enemy.id);
  const owed = legendary.acted?.round === encounter.round && (legendary.acted.owed ?? []).includes(enemy.id);
  const strike = (legendary.strikes ?? []).includes(enemy.id);
  if (handedOver || owed || strike) {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  return `${enemy.displayName}'s turn has not come yet this round: it is ${current?.name ?? "another combatant"}'s turn. An enemy acts when end_turn hands it to you; off its turn it only reacts (opportunity attacks are automatic) or takes a legendary action.`;
}

// The same, read from a tool call's arguments (enemyId for enemy_attack,
// casterEnemyId for a spell or ability): the refusal, or null.
export function enemyCallOutOfTurn(
  campaignId: string,
  turn: Pick<DmTurn, "id" | "actor">,
  rawArguments: string,
  key: "enemyId" | "casterEnemyId",
): string | null {
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
