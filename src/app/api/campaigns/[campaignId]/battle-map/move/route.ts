import { z } from "zod";
import { actingSheetFor } from "@/lib/character-seat";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getFloor } from "@/lib/db/campaigns";
import { getActiveBoard, listEnemies } from "@/lib/db/encounters";
import { patchSheet } from "@/lib/db/sheets";
import {
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  moveToken,
} from "@/lib/db/battle-maps";
import { buildPlayerMapView, footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { findPath, reachableTiles, speedToTiles } from "@/lib/battlemap/movement";
import { pcMoveTraits } from "@/lib/battlemap/passage";
import { tileIndex } from "@/lib/battlemap/types";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishFx } from "@/lib/dm/fx";
import { planDoorFx } from "@/lib/battlemap/fx-plan";
import { getCampaignById } from "@/lib/db/campaigns";
import { budgetApplies } from "@/lib/dm/action-budget";
import { resolveOpportunityAttacks } from "@/lib/dm/opportunity";
import { canAct } from "@/lib/dm/can-act";
import { removeConditions } from "@/lib/dm/condition-logic";
import { awayFromFear, fearSourceAt } from "@/lib/dm/enemy-approach";
import { publishPersisted } from "@/lib/events";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { withZoneSteps } from "@/lib/dm/zone-rules";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import { standUpTiles } from "@/lib/srd/authored-effects-more";
import { dragCostFactor, dragPlacements, grappledBy } from "@/lib/dm/drag";
import { jumpMove } from "@/lib/dm/jump-move";
import { jumpLine } from "@/lib/srd/jump";
import { sizeForRace } from "@/lib/srd";
import { proneCharge } from "@/lib/battlemap/board-move";

export const runtime = "nodejs";

// A locked door standing next to the mover or the destination is what
// stopped a move that otherwise looked open.
function lockedDoorNear(
  map: { doors: Record<string, string>; drawnTerrain: string; width: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } | null {
  for (const [key, state] of Object.entries(map.doors)) {
    if (state !== "locked") {
      continue;
    }
    const [dx, dy] = key.split(",").map(Number);
    const nearFrom = Math.max(Math.abs(dx - from.x), Math.abs(dy - from.y)) <= 1;
    const nearTo = Math.max(Math.abs(dx - to.x), Math.abs(dy - to.y)) <= 1;
    if (nearFrom || nearTo) {
      return { x: dx, y: dy };
    }
  }
  return null;
}
export const dynamic = "force-dynamic";

const moveSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  // Drag the creature this character grapples along, at half speed
  // (src/lib/dm/drag.ts).
  drag: z.boolean().optional(),
  // A long jump in a straight line to the square (src/lib/dm/jump-move.ts).
  jump: z.boolean().optional(),
});

// A player moves their own token. Server-authoritative: walls, occupancy,
// and the turn's remaining speed budget are enforced here, and moving is
// only allowed on an open floor or the player's own initiative turn.
// Movement never wakes the DM; it reads fresh positions at its next turn.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { user } = context;

  // The board, which is a fight or an exploration scene. Every combat rule
  // below is written against a fight and is skipped on a scene.
  const encounter = getActiveBoard(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return Response.json({ error: "No active battle map." }, { status: 404 });
  }
  const campaign = getCampaignById(campaignId);
  // The mover is the character acting now, whichever sheet the player has
  // open (src/lib/character-seat.ts).
  const sheet = actingSheetFor(campaignId, user.id, undefined, encounter);
  const token = sheet ? getTokenByRef(map.id, sheet.id) : null;
  if (!sheet || !token) {
    return Response.json({ error: "You have no token on this map." }, { status: 400 });
  }
  // The one guard every acting handler asks (src/lib/dm/can-act.ts): the
  // dead, the dying, the incapacitated and the surprised do not move, and in
  // a fight nobody moves on a turn that is not theirs.
  const allowed = canAct({ sheet, encounter, kind: "move" });
  if (!allowed.ok) {
    return Response.json({ error: allowed.error }, { status: 409 });
  }

  const floor = getFloor(campaignId);
  if (floor.mode === "initiative") {
    const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
    if (!current || current.kind !== "pc" || current.characterId !== sheet.id) {
      return Response.json(
        { error: `It is ${current?.name || "another combatant"}'s turn to move.` },
        { status: 409 },
      );
    }
  } else if (floor.mode !== "open") {
    return Response.json({ error: "You cannot move right now." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = moveSchema.safeParse(raw);
  if (!parsed.success || parsed.data.x >= map.width || parsed.data.y >= map.height) {
    return Response.json({ error: "Invalid destination." }, { status: 400 });
  }
  const { x, y } = parsed.data;

  // Grappled/restrained/paralyzed... = speed 0; exhaustion 2+ halves speed
  // and 5+ zeroes it. speedFor applies the class bonuses with their armor
  // gates and the heavy-armor Strength penalty, and the Dash action doubles
  // whatever is left. The same computation lights the board's reachable
  // tiles, so a tile the player was shown is never refused here.
  const { speed, tiles: budget, fullTiles } = pcMoveBudget(campaignId, encounter, map, sheet, token);
  if (speed <= 0) {
    const cause =
      sheet.conditions.join(", ") ||
      ((sheet.exhaustion ?? 0) >= 5 ? `exhaustion level ${sheet.exhaustion}` : "a condition");
    return Response.json(
      { error: `You cannot move while ${cause} holds you (speed 0).` },
      { status: 409 },
    );
  }
  const scene = encounter.kind === "scene";
  const turnState =
    !scene && budgetApplies(encounter.turnBudget, sheet.id, encounter.round)
      ? encounter.turnBudget
      : null;
  // Frightened: a jump may not carry them closer to what they fear either.
  const feared = scene ? null : fearSourceAt(map.id, sheet.conditions, sheet.conditionMeta as Record<string, { source?: string }>);
  if (parsed.data.jump && campaign) {
    const line = jumpLine(token, { x, y });
    if (feared && awayFromFear(token, line, feared).length < line.length) {
      return Response.json({ error: "You are frightened and cannot move closer to what you fear. Move away from it, or hold your ground." }, { status: 409 });
    }
    const leap = jumpMove({ campaign, encounter, map, sheet, token, to: { x, y }, budgetTiles: budget, scene, disengaged: turnState?.disengaged ?? false });
    if ("error" in leap) {
      return Response.json({ error: leap.error }, { status: leap.status });
    }
    return Response.json({
      view: buildPlayerMapView(campaignId, user.id, { enemyNumbers: capsFor(context).enemyNumbers }),
      jump: leap.jump,
      ...(leap.opportunity.notes.length ? { opportunityAttacks: leap.opportunity.notes } : {}),
      ...(leap.zoneEffects.length ? { zoneEffects: leap.zoneEffects } : {}),
    });
  }
  // Large enemies hold every square of their footprint, as the board shows.
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const tokens = listTokens(map.id);
  const occupied = occupiedTiles(map, tokens, token, footprintLookup(enemiesById));
  // Allies' spaces, and a hostile's two sizes apart (or larger, for Halfling
  // Nimbleness), are walked through at double cost (src/lib/battlemap/passage.ts).
  // And the spell areas on the board: difficult ground, Spirit Guardians (zone-rules.ts).
  const traits = withZoneSteps(pcMoveTraits({
    width: map.width,
    tokens,
    mover: token,
    sheet,
    footprintOf: footprintLookup(enemiesById),
    enemySize: (refId) => enemiesById.get(refId)?.stats.size,
  }), map, "pc", sheet.id);
  const reach = reachableTiles(
    map.terrain,
    map.width,
    map.height,
    occupied,
    token,
    budget,
    1,
    token.movement === "fly",
    traits,
  );
  const stepCost = reach.get(tileIndex(map.width, x, y));
  // Prone: standing up costs half the character's speed and ends the
  // condition; without the movement for that the character crawls, every
  // foot costing two (SRD 5.1, Being Prone).
  const prone =
    !scene && sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone");
  // Half the speed, or a feature's own price (Tipsy Sway: 5 feet).
  const standCost = standUpTiles(sheet, speedToTiles(speed));
  // The board's lit squares price a prone walk with the same function.
  const charged = prone && stepCost !== undefined ? proneCharge(stepCost, standCost, fullTiles) : null;
  const stands = Boolean(charged?.stands);
  const cost = stepCost === undefined || !prone ? stepCost : charged?.cost;
  if (cost === undefined) {
    // A locked door on the way: the handle rattles for everyone (the shake
    // and the sting), and the DM's prompt is told so the model can offer
    // the lock or the key.
    const lockedDoor = lockedDoorNear(map, { x: token.x, y: token.y }, { x, y });
    if (lockedDoor) {
      publishFx(campaignId, planDoorFx({ at: lockedDoor, state: "locked" }));
      return Response.json({ error: "The door there is locked." }, { status: 400 });
    }
    return Response.json(
      {
        error: prone
          ? "You are prone: standing costs half your speed and crawling costs double. You cannot reach that tile this turn."
          : "You cannot reach that tile this turn.",
      },
      { status: 400 },
    );
  }

  const from = { x: token.x, y: token.y };
  // The walk itself, square by square, so an enemy passed on the way gets
  // its opportunity attack (src/lib/dm/opportunity.ts).
  const path = scene
    ? null
    : findPath(
        map.terrain,
        map.width,
        map.height,
        occupied,
        token,
        { x, y },
        1,
        token.movement === "fly",
        traits,
      );
  // Frightened: no square of the walk may be closer to the source of the
  // fear than where it began (SRD 5.1, Frightened).
  const fear = feared;
  if (fear && path && awayFromFear(token, path, fear).length < path.length) {
    return Response.json(
      { error: "You are frightened and cannot move closer to what you fear. Move away from it, or hold your ground." },
      { status: 409 },
    );
  }
  // Dragging the creature they grapple (src/lib/dm/drag.ts): every square
  // costs double unless it is two sizes smaller, and it is set down beside
  // them where they stop, so the grapple holds.
  let spend = cost;
  let carried: Array<{ token: (typeof tokens)[number]; at: { x: number; y: number } }> = [];
  if (parsed.data.drag && !scene) {
    const held = [...enemiesById.values()].filter((enemy) => enemy.status === "alive" && grappledBy(enemy, sheet.id));
    const heldTokens = held
      .map((enemy) => ({ token: tokens.find((entry) => entry.refId === enemy.id), enemy }))
      .filter((entry): entry is { token: (typeof tokens)[number]; enemy: (typeof held)[number] } => Boolean(entry.token));
    if (!heldTokens.length) {
      return Response.json({ error: `${sheet.name} is not grappling anyone on the board, so there is nothing to drag. Move without dragging.` }, { status: 400 });
    }
    if (prone) {
      return Response.json({ error: `${sheet.name} is prone; they stand up before dragging anyone.` }, { status: 409 });
    }
    spend = cost * dragCostFactor(sizeForRace(sheet.race), held.map((enemy) => ({ refId: enemy.id, name: enemy.displayName, size: enemy.stats.size })));
    if (spend > budget) {
      return Response.json({ error: `Dragging a grappled creature halves ${sheet.name}'s speed: that move costs ${spend * 5} feet and ${budget * 5} are left this turn.` }, { status: 400 });
    }
    const heldIds = new Set(heldTokens.map((entry) => entry.token.id));
    const landed = tokens.filter((entry) => !heldIds.has(entry.id)).map((entry) => (entry.id === token.id ? { ...entry, x, y } : entry));
    const placed = dragPlacements({
      terrain: map.terrain,
      width: map.width,
      height: map.height,
      occupied: occupiedTiles(map, landed, null, footprintLookup(enemiesById)),
      landing: { x, y },
      walked: [from, ...(path ?? [])],
      dragged: heldTokens.map((entry) => ({ token: entry.token, footprint: footprintLookup(enemiesById)(entry.token) })),
    });
    if (!placed) {
      return Response.json({ error: `There is no room beside (${x},${y}) to set down the creature ${sheet.name} drags. Choose another square.` }, { status: 400 });
    }
    carried = placed;
  }
  moveToken(token.id, x, y, scene ? 0 : token.movedThisRound + spend);
  for (const entry of carried) {
    moveToken(entry.token.id, entry.at.x, entry.at.y, entry.token.movedThisRound);
  }
  if (campaign) {
    // Walking away from a grapple ends it (src/lib/dm/grapple.ts).
    releaseGrapplesOutOfReach(campaign);
  }
  if (stands) {
    const stood = removeConditions(sheet.conditions, sheet.conditionMeta, ["prone"]);
    const updated = patchSheet(sheet.id, {
      conditions: stood.conditions,
      conditionMeta: stood.meta,
    });
    if (updated) {
      publishPersisted(campaignId, "sheet_updated", { sheet: updated });
    }
  }
  publishBattleMapUpdate(campaignId);

  // Walking out of an enemy's reach is not free. Disengage suppresses it;
  // the budget carries that decision from the take_action tool.
  const opportunity =
    campaign && !scene
      ? resolveOpportunityAttacks(
          campaign,
          sheet.id,
          from,
          { x, y },
          turnState?.disengaged ?? false,
          path ?? undefined,
        )
      : { notes: [], downed: false };
  // The spell areas walked into: Spike Growth's spikes, a web's hold.
  const zoneEffects = campaign && !scene && path && !opportunity.downedAt ? zonesAfterMove(campaign, encounter.id, { kind: "pc", refId: sheet.id }, from, path) : [];
  // Struck down on the way: they fall where they were hit, not where they
  // were going.
  if (opportunity.downedAt) {
    moveToken(token.id, opportunity.downedAt.x, opportunity.downedAt.y, token.movedThisRound + spend);
    publishBattleMapUpdate(campaignId);
  }

  // Fresh self view in the response saves the mover a follow-up fetch.
  return Response.json({
    view: buildPlayerMapView(campaignId, user.id, { enemyNumbers: capsFor(context).enemyNumbers }),
    ...(opportunity.notes.length ? { opportunityAttacks: opportunity.notes } : {}),
    ...(zoneEffects.length ? { zoneEffects } : {}),
  });
}
