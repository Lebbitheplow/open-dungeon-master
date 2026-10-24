// Confusion's lash-out (SRD 5.1): on a 7 or 8 of its turn-start d10 "the
// creature uses its action to make a melee attack against a randomly
// determined creature within its reach. If there is no creature within its
// reach, the creature does nothing this turn." Before issue 503 the engine
// said so and left the pick to the narration; now the server picks with its
// own die among every creature in reach, whichever side it is on (an ally
// included: the creature is confused), and the attack tools hold the
// creature to it for that round: pc_attack and enemy_attack refuse another
// target and accept this one even on the attacker's own side, and the
// server's backstops strike it.
//
// The pick is kept on the "confused" condition's meta as {target, round},
// so it lapses with the round and with the condition.
//
// Database reads and condition writes only: spell-aura.ts calls in here at
// turn start, under the clock path that must not reach the damage modules.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getEnemy, patchEnemyConditions, type Encounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { footprintDistance, footprintForSize } from "@/lib/battlemap/footprint";
import { tokenFootprint } from "@/lib/dm/board-reach";
import { dmRoll } from "@/lib/dm/roll-card";
import { enemyAttackProfile, opportunityWeapon } from "@/lib/dm/enemy-profile";
import { sheetEnemyStats } from "@/lib/dm/sheet-foe-stats";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

type Holder = { conditions: string[]; conditionMeta: ConditionMetaMap };

// The creature a confused one must attack this round, by combatant id, or
// null when its d10 asked nothing of the kind.
export function lashOutTarget(holder: Holder | null | undefined, round: number): string | null {
  const confused = holder?.conditions.find((entry) => entry.trim().toLowerCase() === "confused");
  const lash = confused ? holder?.conditionMeta[confused]?.lashOut : undefined;
  return lash && lash.round === round ? lash.target : null;
}

// The melee reach of a combatant in squares: an enemy's first melee attack,
// a character's best melee weapon read as a block's (sheet-foe-stats.ts).
function reachOf(kind: "sheet" | "enemy", id: string): number {
  if (kind === "enemy") {
    const enemy = getEnemy(id);
    return enemy ? (opportunityWeapon(enemy.stats)?.reachTiles ?? 1) : 1;
  }
  const sheet = getSheetById(id);
  const attack = sheet ? sheetEnemyStats(sheet).attacks.find((entry) => entry.mode !== "ranged") : undefined;
  return attack ? Math.max(1, enemyAttackProfile(attack).reachTiles) : 1;
}

// Rolls the lash-out for a combatant whose d10 came up 7 or 8: the creatures
// in its reach, one picked by the engine's die, kept on its confusion.
// Returns the line for the table.
export function lashOut(campaign: Campaign, encounter: Encounter, kind: "sheet" | "enemy", id: string, name: string): string {
  const map = getBattleMapForEncounter(encounter.id);
  const me = map ? getTokenByRef(map.id, id) : null;
  if (!map || !me) {
    return `${name} lashes out at a creature within its reach, if one is (no board to pick one on: the DM picks at random).`;
  }
  const reach = reachOf(kind, id);
  const mine = kind === "enemy" ? footprintForSize(getEnemy(id)?.stats.size) : 1;
  const inReach = listTokens(map.id).filter((token) => {
    if (token.refId === id || (token.kind !== "pc" && token.kind !== "enemy")) {
      return false;
    }
    if (token.kind === "enemy" && getEnemy(token.refId)?.status !== "alive") {
      return false;
    }
    if (token.kind === "pc") {
      const sheet = getSheetById(token.refId);
      if (!sheet || sheet.deathSaves?.dead) {
        return false;
      }
    }
    return footprintDistance(me, mine, token, tokenFootprint(token)) <= reach;
  });
  if (!inReach.length) {
    return `${name} lashes out, but no creature is within its reach: it does nothing this turn.`;
  }
  // One creature in reach is the only one it can strike; among several, the
  // engine's die picks.
  const pick = inReach.length > 1 ? dmRoll(campaign.id, null, "custom", `${name}: Confusion picks who it attacks`, `1d${inReach.length}`).total : 1;
  const target = inReach[Math.min(inReach.length, Math.max(1, pick)) - 1];
  keepPick(kind, id, { target: target.refId, round: encounter.round });
  return `${name} lashes out at ${target.name}, picked at random among the creatures in its reach: its action this turn is a melee attack on them.`;
}

function keepPick(kind: "sheet" | "enemy", id: string, pick: { target: string; round: number }) {
  const holder = kind === "enemy" ? getEnemy(id) : getSheetById(id);
  const confused = holder?.conditions.find((entry) => entry.trim().toLowerCase() === "confused");
  if (!holder || !confused) {
    return;
  }
  const meta = holder.conditionMeta as ConditionMetaMap;
  const next: ConditionMetaMap = { ...meta, [confused]: { ...meta[confused], lashOut: pick } };
  if (kind === "enemy") {
    patchEnemyConditions(id, holder.conditions, next);
    return;
  }
  const updated = patchSheet(id, { conditionMeta: next });
  if (updated) {
    publishPersisted(updated.campaignId, "sheet_updated", { sheet: updated });
  }
}
