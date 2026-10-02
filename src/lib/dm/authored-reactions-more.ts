// The authored reactions the final round added (src/lib/srd/authored-effects-data*.ts):
//
//   - a move off the holder's turn, up to half their speed, drawing no
//     opportunity attack: Skirmisher (a reaction when an enemy stands within
//     5 feet of the Scout) and Relentless Avenger (part of the paladin's
//     opportunity attack that hit, so no second reaction is spent);
//   - Tipsy Sway: a melee attack that missed the monk lands on another
//     creature within 5 feet of them instead, for 1 ki.
//
// use_reaction reaches these through authored-reactions.ts, which checks the
// gate and pays the pool; a free reaction (Relentless Avenger) is resolved
// before use_reaction asks whether the reaction is spent.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken } from "@/lib/db/battle-maps";
import { getEnemy, listEnemies } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { reachableTiles, speedToTiles } from "@/lib/battlemap/movement";
import { pcMoveTraits } from "@/lib/battlemap/passage";
import { tileIndex } from "@/lib/battlemap/types";
import { heldAuthored, heldReaction, type AuthoredReaction, type HeldAuthored } from "@/lib/srd/authored-effects";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { freshLastHit, writeLastHit } from "@/lib/dm/last-hit";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { noHit, type Ctx } from "@/lib/dm/reaction-tools";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { enemyAttacker, rollCard } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

// The mark a character's opportunity attack that hit leaves until their next
// turn: what Relentless Avenger's move answers.
export const OA_HIT = "struck as it fled";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

// Written by the opportunity attack (opportunity-strike.ts) when it hits and
// the attacker holds a reaction that answers it.
export function markOpportunityHit(campaign: Campaign, stale: CharacterSheet) {
  const sheet = getSheetById(stale.id) ?? stale;
  const answers = heldReactionsOf(sheet).some(({ reaction }) => reaction.does.kind === "move" && reaction.does.trigger === "oa_hit");
  if (!answers) {
    return;
  }
  const kept = sheet.conditions.filter((entry) => lower(entry) !== OA_HIT);
  const updated = patchSheet(sheet.id, {
    conditions: [...kept, OA_HIT],
    conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), [OA_HIT]: { untilTurnOf: sheet.id } },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function heldReactionsOf(sheet: CharacterSheet): Array<{ reaction: AuthoredReaction; held: HeldAuthored }> {
  return heldAuthored(sheet).flatMap((held) => (held.entry.reactions ?? []).map((reaction) => ({ reaction, held })));
}

// use_reaction on a free authored reaction (part of a reaction already
// taken): resolved here, before the spent reaction is asked about. Null when
// the call names none.
export function freeAuthoredReaction(ctx: Ctx): Record<string, unknown> | null {
  const found = heldReaction(ctx.sheet, ctx.args.feature);
  if (!found || found.reaction.does.kind !== "move" || !found.reaction.does.free) {
    return null;
  }
  const outcome = resolveMoreReaction(ctx, found.reaction);
  return "error" in outcome ? outcome : { ok: true, reaction: found.reaction.name, spent: "Part of the opportunity attack's reaction: nothing more is spent.", ...outcome };
}

export function resolveMoreReaction(ctx: Ctx, reaction: AuthoredReaction): Record<string, unknown> | { error: string } {
  const does = reaction.does;
  if (does.kind === "move") {
    return reactionMove(ctx, reaction.name, does.trigger);
  }
  if (does.kind === "redirect_miss") {
    return redirectMiss(ctx, reaction.name, does.rangeFt);
  }
  return { error: `${reaction.name} is not resolved here. Nothing was spent.` };
}

// ---- the move ----

function reactionMove(ctx: Ctx, name: string, trigger: "enemy_adjacent" | "oa_hit"): Record<string, unknown> | { error: string } {
  const { campaign, encounter } = ctx;
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, ctx.sheet.id) : null;
  if (!encounter || !map || !token) {
    return { error: `${name} moves ${ctx.sheet.name} on the battle map, and they have no token on one. Nothing was spent.` };
  }
  const x = ctx.args.x;
  const y = ctx.args.y;
  if (x === undefined || y === undefined || x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { error: `${name} needs the square to move to: pass x and y on the board. Nothing was spent.` };
  }
  if (trigger === "oa_hit") {
    if (!ctx.sheet.conditions.some((entry) => lower(entry) === OA_HIT)) {
      return { error: `${name} moves ${ctx.sheet.name} right after their opportunity attack hits, and none has hit since their turn. Nothing was spent.` };
    }
  } else {
    const near = listEnemies(encounter.id).some((enemy) => enemy.status === "alive" && withinFeet(encounter.id, ctx.sheet.id, enemy.id, 5));
    if (!near) {
      return { error: `${name} answers an enemy within 5 feet of ${ctx.sheet.name}, and none stands there. Nothing was spent.` };
    }
  }
  const { speed } = pcMoveBudget(campaign.id, encounter, map, ctx.sheet, token);
  const half = Math.floor(speedToTiles(speed) / 2);
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const tokens = listTokens(map.id);
  const footprintOf = footprintLookup(enemiesById);
  const traits = pcMoveTraits({
    width: map.width,
    tokens,
    mover: token,
    sheet: ctx.sheet,
    footprintOf,
    enemySize: (refId) => enemiesById.get(refId)?.stats.size,
  });
  const reach = reachableTiles(map.terrain, map.width, map.height, occupiedTiles(map, tokens, token, footprintOf), token, half, 1, token.movement === "fly", traits);
  if (!reach.has(tileIndex(map.width, x, y))) {
    return { error: `${ctx.sheet.name} cannot reach (${x},${y}) with half their speed (${half * 5} feet). Nothing was spent.` };
  }
  // A reaction's move draws no opportunity attack, and it is not the turn's
  // own movement, so the round's count stands.
  moveToken(token.id, x, y, token.movedThisRound);
  if (trigger === "oa_hit") {
    const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
    const cleared = removeConditions(now.conditions, now.conditionMeta, now.conditions.filter((entry) => lower(entry) === OA_HIT));
    const updated = patchSheet(now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  releaseGrapplesOutOfReach(campaign);
  publishBattleMapUpdate(campaign.id);
  return { applied: `${ctx.sheet.name} moves to (${x},${y}), up to half their speed, without drawing opportunity attacks.` };
}

// ---- Tipsy Sway ----

function redirectMiss(ctx: Ctx, name: string, rangeFt: number): Record<string, unknown> | { error: string } {
  const { campaign, encounter } = ctx;
  const record = freshLastHit(campaign.id, ctx.sheet.id);
  const label = lower(name);
  const missed = record && record.source === "attack" && !record.ranged && !record.answered.includes(label)
    ? record.swings.findIndex((swing) => !swing.hit && !(swing.ranged ?? false))
    : -1;
  if (!record || missed < 0 || record.attacker.kind !== "enemy" || !record.attacker.id) {
    return { error: noHit(ctx.sheet.name, name, "a melee attack that missed them") };
  }
  const target = encounter && ctx.args.targetEnemyId ? resolveEnemyRef(encounter.id, ctx.args.targetEnemyId) : null;
  if (!encounter || !target || target.status !== "alive" || target.id === record.attacker.id) {
    return { error: `${name} turns the miss onto another creature within ${rangeFt} feet of ${ctx.sheet.name}, not the attacker: pass its targetEnemyId. Nothing was spent.` };
  }
  if (!withinFeet(encounter.id, ctx.sheet.id, target.id, rangeFt)) {
    return { error: `${target.displayName} is not within ${rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.` };
  }
  const attacker = getEnemy(record.attacker.id);
  const attack = (attacker?.stats.attacks ?? []).find((entry) => lower(entry.name) === lower(record.attack)) ?? attacker?.stats.attacks?.[0];
  if (!attack?.damage) {
    return { error: `The server has no damage on record for ${record.attacker.name}'s ${record.attack}. Nothing was spent.` };
  }
  // The attacker's own blow, turned (Stand Against the Tide reads the same).
  const rolled = Math.max(0, rollCard(campaign, ctx.turn, null, "damage", rollAgainst(`${attack.name} (${name})`, target.displayName), attack.damage, attacker ? enemyAttacker(attacker) : null).total);
  const type = attack.type ?? record.type;
  const applied = applyEnemyDamage(campaign, ctx.turn, encounter, target, rolled, ctx.sheets, ctx.sheetsById, type);
  publishEncounter(campaign.id);
  writeLastHit(campaign.id, { ...record, answered: [...record.answered, label] });
  return { rolled: `${attack.damage}: ${rolled}`, applied: `${record.attacker.name}'s ${record.attack} hits ${target.displayName} instead.`, redirected: applied };
}
