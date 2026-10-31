// A held spell's area moved by the spell itself on a later turn (issue
// 659): Flaming Sphere rolled up to 30 feet into the creature it rams, for a
// bonus action; Moonbeam's beam moved up to 60 feet, for an action. Both were
// re-laid as new castings: the reach was measured from the caster (60 feet
// for the sphere) rather than from the area, the move had no limit, a beam
// moved for nothing, and its minute started over.
//
// What is checked here, before anything is spent: where the area goes, that
// the move is within the spell's own distance, and that the caster has the
// part of the turn moving it costs. What is done once the spell resolves:
// the area moved (zone-cast.ts moveZoneTo, which keeps its rounds) and that
// part of the turn spent.
//
// Must not import encounter-tools, map-tools or mutations: they call here.

import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getEncounter, type Encounter } from "@/lib/db/encounters";
import { footprintTiles } from "@/lib/battlemap/footprint";
import { chebyshev, tileIndex, type XY } from "@/lib/battlemap/types";
import { zoneKey, zoneRowFor } from "@/lib/battlemap/zones-spells";
import type { SpellZone } from "@/lib/battlemap/zones";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spendAction } from "@/lib/dm/action-budget";
import { tokenFootprint } from "@/lib/dm/board-reach";
import { conjuredStrikeSpot } from "@/lib/dm/conjured-strike-logic";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { liveZones, publishZones } from "@/lib/dm/zone-store";
import { moveZoneTo } from "@/lib/dm/zone-cast";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

const FEET = 5;

export type ZoneMove = {
  zone: SpellZone;
  origin: XY;
  // The area moves this call (false: the creature already stands in it).
  moves: boolean;
  // What moving it costs, when it does.
  cost: "action" | "bonus" | null;
};

// Where the caster's held area goes for this call, or the refusal. Null when
// the spell's area does not move this way, or the board does not hold it.
// `toward` is the creature the call names (the one the sphere rams, the one
// the beam is moved onto), or a square (`at`) the call names.
export function planZoneMove(input: {
  encounter: Encounter;
  caster: CharacterSheet;
  spell: string;
  runsAs?: string | null;
  // What the spell's own repeat costs (spell-mech-types.ts repeat): the
  // move is charged only when the repeat itself charges nothing (Moonbeam).
  repeatCost: "action" | "bonus" | "free";
  toward: { refId?: string; at?: XY };
}): { move: ZoneMove } | { refused: ToolError } | null {
  const named = { spell: input.spell, ...(input.runsAs ? { runsAs: input.runsAs } : {}) };
  const row = zoneRowFor(named);
  const map = row?.moves ? getBattleMapForEncounter(input.encounter.id) : null;
  if (!row?.moves || !map) {
    return null;
  }
  const zone = liveZones(map, input.encounter).find((entry) => entry.casterId === input.caster.id && zoneKey(entry) === zoneKey(named));
  if (!zone) {
    return null;
  }
  const moveTiles = Math.round(row.moves.feet / FEET);
  const token = input.toward.refId ? getTokenByRef(map.id, input.toward.refId) : null;
  let origin: XY;
  if (row.moves.rams) {
    // The sphere rams the creature: it rolls up beside it and stops.
    if (!token) {
      return null;
    }
    const occupied = new Set<number>();
    for (const other of listTokens(map.id)) {
      for (const tile of footprintTiles(other, tokenFootprint(other))) {
        occupied.add(tileIndex(map.width, tile.x, tile.y));
      }
    }
    const spot = conjuredStrikeSpot({
      board: map,
      mode: "move",
      reachTiles: 1,
      moveTiles,
      rangeTiles: 0,
      caster: zone.origin,
      origin: zone.origin,
      target: { at: { x: token.x, y: token.y }, footprint: tokenFootprint(token) },
      occupied,
    });
    if ("out" in spot) {
      return { refused: { error: `${input.caster.name}'s ${zone.spell} is at (${zone.origin.x},${zone.origin.y}), ${spot.apartTiles * FEET} feet from ${token.name}: it rolls up to ${row.moves.feet} feet to ram a creature, so ${token.name} is out of its reach this turn. Nothing was spent.`, refused: "rules" } };
    }
    origin = spot.at;
  } else {
    const point = input.toward.at ?? (token ? { x: token.x, y: token.y } : null);
    if (!point) {
      return null;
    }
    // The creature already in the beam is struck where it stands.
    const inside = zone.cells.includes(tileIndex(map.width, point.x, point.y));
    origin = inside ? zone.origin : point;
    const apart = chebyshev(zone.origin.x, zone.origin.y, origin.x, origin.y);
    if (apart > moveTiles) {
      return { refused: { error: `${input.caster.name}'s ${zone.spell} is at (${zone.origin.x},${zone.origin.y}), and moving it to (${origin.x},${origin.y}) is ${apart * FEET} feet: it moves up to ${row.moves.feet} feet on a turn. Nothing was spent.`, refused: "rules" } };
    }
  }
  const moves = origin.x !== zone.origin.x || origin.y !== zone.origin.y;
  const cost = moves && input.repeatCost === "free" ? row.moves.cost : null;
  if (cost) {
    const problem = moveCostProblem(input.encounter, input.caster, zone.spell, cost);
    if (problem) {
      return { refused: problem };
    }
  }
  return { move: { zone, origin, moves, cost } };
}

// The part of the turn moving the area costs: on the caster's own turn,
// unspent. The refusal, or null.
function moveCostProblem(encounter: Encounter, caster: CharacterSheet, spell: string, cost: "action" | "bonus"): ToolError | null {
  const budget = budgetFor(encounter, caster.id, attacksAllowedFor(caster), conditionTurnShape(caster.conditions));
  if (!budget) {
    return { error: `Moving ${spell} takes ${caster.name}'s ${cost === "bonus" ? "bonus action" : "action"} on their own turn. Nothing was spent.`, refused: "rules" };
  }
  const spent = spendAction(budget, cost, `moving ${spell}`, caster.name);
  return spent.ok ? null : toolError(spent);
}

// The area moved and the turn charged, once the spell has resolved. The
// line for the result.
export function commitZoneMove(encounter: Encounter, caster: CharacterSheet, move: ZoneMove): string | null {
  if (!move.moves) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  moveZoneTo(map, move.zone.id, move.origin);
  publishZones(encounter.campaignId);
  if (move.cost) {
    // Read again: the spell's own resolution may have spent from the turn.
    const live = getEncounter(encounter.id) ?? encounter;
    const budget = budgetFor(live, caster.id, attacksAllowedFor(caster), conditionTurnShape(caster.conditions));
    const spent = budget ? spendAction(budget, move.cost, `moving ${move.zone.spell}`, caster.name) : null;
    if (spent?.ok) {
      storeBudget(live, spent.budget);
    }
  }
  return `${move.zone.spell} moves to (${move.origin.x},${move.origin.y})${move.cost ? `, for ${caster.name}'s ${move.cost === "bonus" ? "bonus action" : "action"}` : ""}; it keeps its duration.`;
}

