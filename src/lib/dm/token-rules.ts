import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { getActiveEncounter, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { listTokens, moveToken, type BattleMap } from "@/lib/db/battle-maps";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { spellFactsFor } from "@/lib/content";
import { withZoneSteps } from "@/lib/dm/zone-rules";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import { findPath, speedToTiles, walkPathWithBudget } from "@/lib/battlemap/movement";
import { footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { pcMoveTraits } from "@/lib/battlemap/passage";
import { describeDistances } from "@/lib/battlemap/serialize";
import { standUpTiles } from "@/lib/srd/authored-effects-more";
import { budgetApplies } from "@/lib/dm/action-budget";
import { canAct, canEnemyAct, endsOwedTurn, markEnemyActed } from "@/lib/dm/can-act";
import { removeConditions } from "@/lib/dm/condition-logic";
import { awayFromFear, fearSourceAt } from "@/lib/dm/enemy-approach";
import { abilityNames, hasTrait } from "@/lib/dm/monster-abilities";
import { applyDmMutation } from "@/lib/dm/mutations";
import { characterDrag, dragLandings } from "@/lib/dm/drag-move";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { resolveOpportunityAttacks } from "@/lib/dm/opportunity";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The rules behind two board moves the model can make: a teleport, which
// the AI makes only through the spell or ability that does it (cast and
// paid for) or a hazard, and a character's walk on their own turn (an AI
// companion's, or the move a player just declared), which costs their speed
// and draws opportunity attacks exactly as a player's walk from the board
// does. Split from map-tools.ts, which calls both.

type XY = { x: number; y: number };

// How far the teleport spells carry, for a spell whose range line reads
// "Self" and whose distance is in its text.
const TELEPORT_FEET: Record<string, number> = {
  "misty step": 30,
  "thunder step": 90,
  "dimension door": 500,
  "far step": 60,
  "blink": 10,
};

export function teleportRangeFeet(spell: string): number | null {
  const key = spell.trim().toLowerCase();
  if (TELEPORT_FEET[key]) {
    return TELEPORT_FEET[key];
  }
  const facts = spellFactsFor(spell);
  return facts?.range.kind === "feet" ? facts.range.feet : null;
}

export type TeleportArgs = {
  spell?: string;
  casterId?: string;
  casterEnemyId?: string;
  cause?: "hazard";
  reason?: string;
};

// Whether the AI may make this teleport, and what it costs. A character's
// spell is cast through the one guard (the slot, the casting time); an
// enemy's must be on its block; a hazard moves whoever it moves. Returns
// the refusal, or null once the cost is paid. The DM's own hand is not
// asked (the caller skips this for a person at the console).
export function payForTeleport(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter | null,
  token: BattleToken,
  args: TeleportArgs,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string | null {
  if (args.cause === "hazard") {
    return null;
  }
  const spell = (args.spell ?? "").trim();
  if (!spell) {
    return "A teleport is a spell or an ability: pass spell with casterId (a character's, cast and paid for) or casterEnemyId (one on the enemy's block), or cause 'hazard' for a trap door or a portal. Walking is move_token or the player's own board.";
  }
  if (args.casterId) {
    const caster = resolveSheetRef(args.casterId, sheets, sheetsById);
    if (!caster) {
      return "Unknown casterId; use one from GAME STATE.";
    }
    const facts = spellFactsFor(spell);
    if (facts?.range.kind === "self" && token.refId !== caster.id) {
      return `${spell} moves only its caster, ${caster.name}.`;
    }
    const cast = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({ characterId: caster.id, spell, via: "buff", reason: (args.reason ?? "").slice(0, 200) }),
      sheets,
      sheetsById,
    ).result;
    return "error" in cast ? String(cast.error) : null;
  }
  if (args.casterEnemyId && encounter) {
    const ref = args.casterEnemyId.trim().toLowerCase();
    const enemy = listEnemies(encounter.id).find(
      (entry) => entry.id === args.casterEnemyId || entry.displayName.toLowerCase() === ref,
    );
    if (!enemy || enemy.status !== "alive") {
      return "Unknown or fallen casterEnemyId; use a living enemy from GAME STATE.";
    }
    const key = spell.toLowerCase();
    const listed =
      (enemy.stats.spells ?? []).some((name) => name.toLowerCase() === key) ||
      abilityNames(enemy.stats).some((name) => name.toLowerCase() === key) ||
      (enemy.stats.traits ?? []).some((line) => line.toLowerCase().startsWith(key));
    return listed ? null : `${enemy.displayName} has no ${spell} on its stat block, so it cannot teleport.`;
  }
  return `${spell} needs its caster: casterId for a character, casterEnemyId for an enemy.`;
}

// An enemy's Disengage before it walks: a bonus action with Nimble Escape
// (once a round), its action otherwise (SRD 5.1). Returns how it was paid,
// and whether that action closes the turn it was owed so its own turn walks
// on fresh movement once this walk is spent (can-act.ts endsOwedTurn), or
// the refusal.
export function spendEnemyDisengage(
  campaignId: string,
  enemy: EncounterEnemy,
): { how: string; closesOwedTurn?: boolean } | { error: string } {
  const live = getActiveEncounter(campaignId);
  if (!live) {
    return { how: "no fight" };
  }
  if (hasTrait(enemy.stats, "nimbleEscape")) {
    const used = live.legendary.bonus?.round === live.round ? live.legendary.bonus.ids : [];
    if (used.includes(enemy.id)) {
      return { error: `${enemy.displayName} has already used its bonus action this round; to Disengage again it spends its action (move without disengage, or accept the opportunity attacks).` };
    }
    live.legendary.bonus = { round: live.round, ids: [...used, enemy.id] };
    saveEncounter(live);
    return { how: "a bonus action (Nimble Escape)" };
  }
  const allowed = canEnemyAct({ enemy, encounter: live, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const closesOwedTurn = endsOwedTurn(live, enemy.id);
  markEnemyActed(live, enemy.id);
  saveEncounter(live);
  return { how: "its action (Disengage)", closesOwedTurn };
}

// Fresh ranges from where a mover landed to everyone else on the board, so
// the model narrates the new distances instead of remembering the pre-move
// map.
export function distancesFrom(tokens: BattleToken[], mover: BattleToken, at: XY): { distancesNow?: string } {
  const distances = describeDistances(at, tokens.filter((other) => other.id !== mover.id));
  return distances ? { distancesNow: distances } : {};
}

// Where a refused walk leaves the mover and its ranges from there, appended
// to the refusal, so the reply reads the board's distances whether the walk
// happened or not.
export function stillAt(tokens: BattleToken[], mover: BattleToken): string {
  const distances = describeDistances(mover, tokens.filter((other) => other.id !== mover.id));
  return ` Still at (${mover.x},${mover.y})${distances ? `: ${distances}` : "."}`;
}

// A character walking on their own turn, an AI companion or a player's typed
// move (map-tools.ts), as the board's move route walks them: their speed this
// turn (conditions, exhaustion, Dash), standing from prone for half of it,
// through allies' spaces, never closer to what they fear, dragging the
// creature they grapple when asked, letting go of it otherwise, and the
// opportunity attacks of every enemy they walk away from. Returns the
// move_token result.
export function walkCharacter(
  campaign: Campaign,
  encounter: Encounter,
  map: BattleMap,
  sheet: CharacterSheet,
  token: BattleToken,
  destination: XY,
  options: { drag?: boolean } = {},
): Record<string, unknown> {
  const allowed = canAct({ sheet, encounter, kind: "move" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  if (destination.x < 0 || destination.y < 0 || destination.x >= map.width || destination.y >= map.height) {
    return { error: `(${destination.x},${destination.y}) is outside the ${map.width}x${map.height} map.` };
  }
  const { speed, fullTiles } = pcMoveBudget(campaign.id, encounter, map, sheet, token);
  if (speed <= 0 || fullTiles <= 0) {
    return { error: `${sheet.name} has no movement left this turn.${stillAt(listTokens(map.id), token)}` };
  }
  // Prone: standing costs half the speed; without that much left it cannot
  // stand, and this walk does not crawl.
  const prone = sheet.conditions.find((entry) => entry.toLowerCase() === "prone");
  const standCost = prone ? standUpTiles(sheet, speedToTiles(speed)) : 0;
  if (prone && standCost > fullTiles) {
    return { error: `${sheet.name} is prone and has too little movement left to stand.${stillAt(listTokens(map.id), token)}` };
  }
  // A walk to the square they stand on is a prone character getting up.
  const here = destination.x === token.x && destination.y === token.y;
  if (here && !prone) {
    return { error: `${sheet.name} already stands at (${token.x},${token.y}).` };
  }
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const tokens = listTokens(map.id);
  const footprintOf = footprintLookup(enemiesById);
  const occupied = occupiedTiles(map, tokens, token, footprintOf);
  if (occupied.has(tileIndex(map.width, destination.x, destination.y))) {
    return { error: `(${destination.x},${destination.y}) is occupied by another combatant.` };
  }
  // Dragging the creature they grapple doubles every square unless it is two
  // sizes smaller (drag-move.ts), as on the board.
  const drag = options.drag ? characterDrag(sheet, [...enemiesById.values()], tokens) : null;
  if (drag && "error" in drag) {
    return { error: drag.error };
  }
  const factor = drag?.factor ?? 1;
  // The board's own walking traits: allies' spaces, a swimming or climbing
  // speed, Halfling Nimbleness, and the spell areas underfoot.
  const traits = withZoneSteps(
    pcMoveTraits({
      width: map.width,
      tokens,
      mover: token,
      sheet,
      footprintOf,
      enemySize: (refId) => enemiesById.get(refId)?.stats.size,
    }),
    map,
    "pc",
    sheet.id,
  );
  const path = here ? [] : findPath(map.terrain, map.width, map.height, occupied, token, destination, 1, token.movement === "fly", traits);
  if (!path) {
    return { error: `No path to (${destination.x},${destination.y}); walls block the way.` };
  }
  const fear = fearSourceAt(map.id, sheet.conditions, sheet.conditionMeta as Record<string, { source?: string }>);
  const steps = awayFromFear(token, path, fear);
  const walk = here
    ? { at: { x: token.x, y: token.y }, spent: 0, reachedEnd: true }
    : walkPathWithBudget(map.terrain, map.width, steps, Math.floor((fullTiles - standCost) / factor), traits, token);
  if (!walk.at) {
    const why = fear ? `${sheet.name} is frightened and cannot move closer to what it fears.` : `${sheet.name} has no movement left for that.`;
    return { error: `${why}${stillAt(listTokens(map.id), token)}` };
  }
  const origin = { x: token.x, y: token.y };
  const walkedSquares = steps.slice(0, steps.findIndex((step) => step.x === walk.at?.x && step.y === walk.at?.y) + 1);
  const carried = drag
    ? dragLandings({ map, tokens, mover: token, landing: walk.at, walked: [origin, ...walkedSquares], held: drag.held, footprintOf })
    : [];
  if (!carried) {
    return { error: `There is no room beside (${walk.at.x},${walk.at.y}) to set down the creature ${sheet.name} drags. Choose another square.` };
  }
  const spent = walk.spent * factor + standCost;
  moveToken(token.id, walk.at.x, walk.at.y, token.movedThisRound + spent);
  for (const entry of carried) {
    moveToken(entry.token.id, entry.at.x, entry.at.y, entry.token.movedThisRound);
  }
  // Walking away from a grapple ends it (grapple.ts), and the board shows the
  // walk at once rather than at the end of the DM turn.
  releaseGrapplesOutOfReach(campaign);
  publishEphemeral(campaign.id, "battle_map_updated", {});
  if (prone) {
    const stood = removeConditions(sheet.conditions, sheet.conditionMeta, [prone]);
    const updated = patchSheet(sheet.id, { conditions: stood.conditions, conditionMeta: stood.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const walked = walkedSquares;
  const disengaged = budgetApplies(encounter.turnBudget, sheet.id, encounter.round)
    ? Boolean(encounter.turnBudget?.disengaged)
    : false;
  const opportunity = resolveOpportunityAttacks(campaign, sheet.id, origin, walk.at, disengaged, walked);
  if (opportunity.downedAt) {
    moveToken(token.id, opportunity.downedAt.x, opportunity.downedAt.y, token.movedThisRound + spent);
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  const landed = opportunity.downedAt ?? walk.at;
  const zoneEffects = opportunity.downedAt ? [] : zonesAfterMove(campaign, encounter.id, { kind: "pc", refId: sheet.id }, origin, walked);
  return {
    ok: true,
    name: token.name,
    at: `(${landed.x},${landed.y})`,
    movementSpent: `${spent * 5} ft`,
    movementLeft: `${(fullTiles - spent) * 5} ft`,
    ...distancesFrom(listTokens(map.id), token, landed),
    ...(prone ? { stood: `stood up for ${standCost * 5} ft of movement` } : {}),
    ...(carried.length ? { dragged: carried.map((entry) => `${entry.token.name} to (${entry.at.x},${entry.at.y})`).join("; ") } : {}),
    ...(opportunity.notes.length
      ? {
          opportunityAttacks: opportunity.notes,
          opportunityNote: "The server already rolled and applied these; narrate them.",
        }
      : {}),
    ...(walk.reachedEnd ? {} : { note: `Speed limited the move: ${sheet.name} stopped at (${walk.at.x},${walk.at.y}).` }),
    ...(zoneEffects.length ? { zoneEffects } : {}),
    ...(getSheetById(sheet.id)?.currentHp === 0 ? { dropped: `${sheet.name} falls on the way.` } : {}),
  };
}
