import { readiedReleaseFor } from "@/lib/dm/readied-release";
import { tokenSides } from "@/lib/dm/combatant";
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
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { unknownEnemyRef } from "@/lib/dm/enemy-damage";

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
  const key = textKey(spell);
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
): ToolError | null {
  if (args.cause === "hazard") {
    return null;
  }
  const spell = (args.spell ?? "").trim();
  if (!spell) {
    return { error: "A teleport is a spell or an ability: pass spell with casterId (a character's, cast and paid for) or casterEnemyId (one on the enemy's block), or cause 'hazard' for a trap door or a portal. Walking is move_token or the player's own board.", retry: true };
  }
  if (args.casterId) {
    const caster = resolveSheetRef(args.casterId, sheets, sheetsById);
    if (!caster) {
      return unknownSheetRef("casterId", args.casterId, sheets);
    }
    const facts = spellFactsFor(spell);
    if (facts?.range.kind === "self" && token.refId !== caster.id) {
      return { error: `${spell} moves only its caster, ${caster.name}.`, retry: true };
    }
    const cast = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({ characterId: caster.id, spell, via: "buff", reason: (args.reason ?? "").slice(0, 200) }),
      sheets,
      sheetsById,
    ).result;
    return typeof cast.error === "string" ? toolError(cast) : null;
  }
  if (args.casterEnemyId && encounter) {
    const ref = textKey(args.casterEnemyId);
    const enemy = listEnemies(encounter.id).find(
      (entry) => entry.id === args.casterEnemyId || textKey(entry.displayName) === ref,
    );
    if (!enemy) {
      return unknownEnemyRef(encounter.id, "casterEnemyId", args.casterEnemyId);
    }
    if (enemy.status !== "alive") {
      return { error: `${enemy.displayName} is ${enemy.status} and casts nothing.`, retry: true };
    }
    const key = textKey(spell);
    const listed =
      (enemy.stats.spells ?? []).some((name) => textKey(name) === key) ||
      abilityNames(enemy.stats).some((name) => textKey(name) === key) ||
      (enemy.stats.traits ?? []).some((line) => textKey(line).startsWith(key));
    return listed ? null : { error: `${enemy.displayName} has no ${spell} on its stat block, so it cannot teleport. It may move with move_token or take another action.`, retry: true };
  }
  return { error: `${spell} needs its caster: casterId for a character, casterEnemyId for an enemy.`, retry: true };
}

// An enemy's Disengage before it walks: a bonus action with Nimble Escape
// (once a round), its action otherwise (SRD 5.1). Returns how it was paid,
// and whether that action closes the turn it was owed so its own turn walks
// on fresh movement once this walk is spent (can-act.ts endsOwedTurn), or
// the refusal.
export function spendEnemyDisengage(
  campaignId: string,
  enemy: EncounterEnemy,
): { how: string; closesOwedTurn?: boolean } | ToolError {
  const live = getActiveEncounter(campaignId);
  if (!live) {
    return { how: "no fight" };
  }
  if (hasTrait(enemy.stats, "nimbleEscape")) {
    const used = live.legendary.bonus?.round === live.round ? live.legendary.bonus.ids : [];
    if (used.includes(enemy.id)) {
      return { error: `${enemy.displayName} has already used its bonus action this round; to Disengage again it spends its action (move without disengage, or accept the opportunity attacks).`, retry: true };
    }
    live.legendary.bonus = { round: live.round, ids: [...used, enemy.id] };
    saveEncounter(live);
    return { how: "a bonus action (Nimble Escape)" };
  }
  const allowed = canEnemyAct({ enemy, encounter: live, kind: "action" });
  if (!allowed.ok) {
    return toolError(allowed);
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
  // whole: a walk the movement cannot finish is refused, nothing moved
  // (pc_attack's approach walks only when the swing can follow).
  options: { drag?: boolean; whole?: boolean } = {},
): ToolResult {
  // Off their turn, the move they readied (SRD 5.1, Ready): their reaction,
  // up to their full speed, their own turn's movement untouched.
  const readied = readiedReleaseFor(sheet, encounter, "move");
  if (readied && "error" in readied) {
    return toolError(readied);
  }
  if (!readied) {
    const allowed = canAct({ sheet, encounter, kind: "move" });
    if (!allowed.ok) {
      return toolError(allowed);
    }
  }
  if (destination.x < 0 || destination.y < 0 || destination.x >= map.width || destination.y >= map.height) {
    return { error: `(${destination.x},${destination.y}) is outside the ${map.width}x${map.height} map.`, retry: true };
  }
  const budget = pcMoveBudget(campaign.id, encounter, map, sheet, token);
  const speed = budget.speed;
  const fullTiles = readied ? speedToTiles(speed) : budget.fullTiles;
  if (speed <= 0 || fullTiles <= 0) {
    return { error: `${sheet.name} has no movement left this turn.${stillAt(listTokens(map.id), token)}`, refused: "rules" };
  }
  // Prone: standing costs half the speed; without that much left it cannot
  // stand, and this walk does not crawl.
  const prone = sheet.conditions.find((entry) => entry.toLowerCase() === "prone");
  const standCost = prone ? standUpTiles(sheet, speedToTiles(speed)) : 0;
  if (prone && standCost > fullTiles) {
    return { error: `${sheet.name} is prone and has too little movement left to stand.${stillAt(listTokens(map.id), token)}`, refused: "rules" };
  }
  // A walk to the square they stand on is a prone character getting up.
  const here = destination.x === token.x && destination.y === token.y;
  if (here && !prone) {
    return { error: `${sheet.name} already stands at (${token.x},${token.y}).`, retry: true };
  }
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const tokens = listTokens(map.id);
  const footprintOf = footprintLookup(enemiesById);
  const occupied = occupiedTiles(map, tokens, token, footprintOf);
  if (occupied.has(tileIndex(map.width, destination.x, destination.y))) {
    return { error: `(${destination.x},${destination.y}) is occupied by another combatant.`, retry: true };
  }
  // Dragging the creature they grapple doubles every square unless it is two
  // sizes smaller (drag-move.ts), as on the board.
  const drag = options.drag ? characterDrag(sheet, [...enemiesById.values()], tokens) : null;
  if (drag && "error" in drag) {
    return toolError(drag);
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
      sideOf: tokenSides(getActiveEncounter(campaign.id)),
    }),
    map,
    "pc",
    sheet.id,
  );
  const path = here ? [] : findPath(map.terrain, map.width, map.height, occupied, token, destination, 1, token.movement === "fly", traits);
  if (!path) {
    return { error: `No path to (${destination.x},${destination.y}); walls block the way.`, retry: true };
  }
  const fear = fearSourceAt(map.id, sheet.conditions, sheet.conditionMeta as Record<string, { source?: string }>);
  const steps = awayFromFear(token, path, fear);
  const walk = here
    ? { at: { x: token.x, y: token.y }, spent: 0, reachedEnd: true }
    : walkPathWithBudget(map.terrain, map.width, steps, Math.floor((fullTiles - standCost) / factor), traits, token);
  if (!walk.at) {
    const why = fear ? `${sheet.name} is frightened and cannot move closer to what it fears.` : `${sheet.name} has no movement left for that.`;
    return { error: `${why}${stillAt(listTokens(map.id), token)}`, refused: "rules" };
  }
  if (options.whole && !walk.reachedEnd) {
    return { error: `${sheet.name} cannot reach (${destination.x},${destination.y}) with the movement left this turn.`, refused: "rules" };
  }
  const origin = { x: token.x, y: token.y };
  const walkedSquares = steps.slice(0, steps.findIndex((step) => step.x === walk.at?.x && step.y === walk.at?.y) + 1);
  const carried = drag
    ? dragLandings({ map, tokens, mover: token, landing: walk.at, walked: [origin, ...walkedSquares], held: drag.held, footprintOf })
    : [];
  if (!carried) {
    return { error: `There is no room beside (${walk.at.x},${walk.at.y}) to set down the creature ${sheet.name} drags. Choose another square.`, retry: true };
  }
  const spent = walk.spent * factor + standCost;
  moveToken(token.id, walk.at.x, walk.at.y, token.movedThisRound + (readied ? 0 : spent));
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
    moveToken(token.id, opportunity.downedAt.x, opportunity.downedAt.y, token.movedThisRound + (readied ? 0 : spent));
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  const landed = opportunity.downedAt ?? walk.at;
  // The walk was made, so the readied move is released, struck down or not.
  const released = readied ? readied.release() : {};
  const zoneEffects = opportunity.downedAt ? [] : zonesAfterMove(campaign, encounter.id, { kind: "pc", refId: sheet.id }, origin, walked);
  return {
    ok: true,
    name: token.name,
    at: `(${landed.x},${landed.y})`,
    movementSpent: `${spent * 5} ft`,
    movementLeft: readied ? "their own turn's movement, untouched by the readied move" : `${(fullTiles - spent) * 5} ft`,
    ...released,
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
