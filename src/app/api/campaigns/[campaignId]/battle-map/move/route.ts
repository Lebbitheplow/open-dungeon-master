import { readiedReleaseFor } from "@/lib/dm/readied-release";
import { endShadowInvisibility } from "@/lib/dm/one-with-shadows";
import { tokenSides } from "@/lib/dm/combatant";
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
import { buildPlayerMapView, footprintLookup, occupiedTiles, pcMoveBudget, type PlayerMapView } from "@/lib/battlemap/view";
import { boardState, forgetMoves, keepMove, revealedSince, sightOf, stepFeet, type MoveStep } from "@/lib/battlemap/move-undo";
import { findPath, reachableTiles, speedToTiles } from "@/lib/battlemap/movement";
import { pcMoveTraits } from "@/lib/battlemap/passage";
import { crawlingTraits, tileIndex } from "@/lib/battlemap/types";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishFx } from "@/lib/dm/fx";
import { planDoorFx } from "@/lib/battlemap/fx-plan";
import { getCampaignById } from "@/lib/db/campaigns";
import { budgetApplies } from "@/lib/dm/action-budget";
import { resolveOpportunityAttacks } from "@/lib/dm/opportunity";
import { riskyOrderGate } from "@/lib/dm/party-conduct";
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
import { refuseDuringBreak } from "@/lib/dm/table-break";

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
  // Tokens stay where they stood while the table is on a break.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }

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
  // The move they readied releases off their turn: their reaction, up to
  // their full speed, their own turn's movement untouched (readied-release.ts).
  const readied = readiedReleaseFor(sheet, encounter, "move");
  if (readied && "error" in readied) {
    return Response.json({ error: readied.error }, { status: 409 });
  }
  if (!readied) {
    const allowed = canAct({ sheet, encounter, kind: "move" });
    if (!allowed.ok) {
      return Response.json({ error: allowed.error }, { status: 409 });
    }
  }

  const floor = getFloor(campaignId);
  if (floor.mode === "initiative") {
    const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
    if (!readied && (!current || current.kind !== "pc" || current.characterId !== sheet.id)) {
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
  const turnBudget = pcMoveBudget(campaignId, encounter, map, sheet, token);
  const speed = turnBudget.speed;
  const budget = readied ? speedToTiles(speed) : turnBudget.tiles;
  const fullTiles = readied ? speedToTiles(speed) : turnBudget.fullTiles;
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
  // What the mover sees before the walk, and whether the walk can be taken
  // back afterwards (src/lib/battlemap/move-undo.ts): only a fight's own
  // walk on its own turn is kept, and only when nothing answered it.
  const undoable = !scene && !readied;
  const sightBefore = undoable ? sightOf(buildPlayerMapView(campaignId, user.id)) : null;
  const settle = (view: PlayerMapView | null, lasting: boolean, step: Omit<MoveStep, "sheetId" | "tokenId" | "state">) => {
    if (!undoable) {
      return;
    }
    const live = getActiveBoard(campaignId);
    const revealed = sightBefore !== null && revealedSince(sightBefore, view);
    if (lasting || revealed || !live || live.id !== encounter.id) {
      forgetMoves(encounter.id);
      return;
    }
    keepMove(encounter.id, { ...step, sheetId: sheet.id, tokenId: token.id, state: boardState(live, map.id, sheet.id) });
    if (view) {
      view.undoMove = { feet: step.feet };
    }
  };
  // Frightened: a jump may not carry them closer to what they fear either.
  const feared = scene ? null : fearSourceAt(map.id, sheet.conditions, sheet.conditionMeta as Record<string, { source?: string }>);
  if (parsed.data.jump && campaign) {
    if (readied) {
      return Response.json({ error: "A readied move is a walk up to your speed; jump on your own turn." }, { status: 409 });
    }
    const line = jumpLine(token, { x, y });
    if (feared && awayFromFear(token, line, feared).length < line.length) {
      return Response.json({ error: "You are frightened and cannot move closer to what you fear. Move away from it, or hold your ground." }, { status: 409 });
    }
    const leap = jumpMove({ campaign, encounter, map, sheet, token, to: { x, y }, budgetTiles: budget, scene, disengaged: turnState?.disengaged ?? false });
    if ("error" in leap) {
      return Response.json({ error: leap.error }, { status: leap.status });
    }
    const leapt = buildPlayerMapView(campaignId, user.id, { enemyNumbers: capsFor(context).enemyNumbers });
    settle(
      leapt,
      leap.lasting || leap.opportunity.notes.length > 0 || leap.zoneEffects.length > 0 || Boolean(leap.opportunity.downedAt),
      { from: { x: token.x, y: token.y }, movedBefore: token.movedThisRound, carried: [], stood: null, feet: leap.jump.feet },
    );
    return Response.json({
      view: leapt,
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
    sideOf: tokenSides(encounter),
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
  // foot costing one extra (SRD 5.1, Being Prone).
  const prone =
    !scene && sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone");
  // Half the speed, or a feature's own price (Tipsy Sway: 5 feet).
  const standCost = standUpTiles(sheet, speedToTiles(speed));
  const crawlTraits = crawlingTraits(traits);
  const crawlCost = prone
    ? reachableTiles(map.terrain, map.width, map.height, occupied, token, fullTiles, 1, token.movement === "fly", crawlTraits).get(tileIndex(map.width, x, y))
    : undefined;
  // The board's lit squares price a prone walk with the same function.
  const charged = prone ? proneCharge(stepCost, crawlCost, standCost, fullTiles) : null;
  const stands = Boolean(charged?.stands);
  const cost = !prone ? stepCost : charged?.cost;
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
          ? "You are prone: standing costs half your speed and every foot crawled costs one extra. You cannot reach that tile this turn."
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
        // A crawl takes the way that is cheapest to crawl, which it was charged for.
        charged && !charged.stands ? crawlTraits : traits,
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
  // A companion wary of its commander will not walk out of a foe's reach
  // on their word (issue 503, src/lib/dm/party-conduct.ts).
  const refusedOrder = campaign && path && !readied ? riskyOrderGate(campaign, sheet, user.id, [from, ...path], turnState?.disengaged ?? false) : null;
  if (refusedOrder) {
    return Response.json({ error: refusedOrder }, { status: 409 });
  }
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
  moveToken(token.id, x, y, scene ? 0 : token.movedThisRound + (readied ? 0 : spend));
  // Moving ends One with Shadows' invisibility (src/lib/dm/one-with-shadows.ts).
  if (!scene) {
    endShadowInvisibility(campaignId, sheet.id, "moves");
  }
  for (const entry of carried) {
    moveToken(entry.token.id, entry.at.x, entry.at.y, entry.token.movedThisRound);
  }
  // Walking away from a grapple ends it (src/lib/dm/grapple.ts).
  const letGo = campaign ? releaseGrapplesOutOfReach(campaign) : [];
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
  // The walk was made: the readied move is released, whatever it draws.
  const released = readied ? readied.release() : null;

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
    moveToken(token.id, opportunity.downedAt.x, opportunity.downedAt.y, token.movedThisRound + (readied ? 0 : spend));
    publishBattleMapUpdate(campaignId);
  }

  // Fresh self view in the response saves the mover a follow-up fetch.
  const view = buildPlayerMapView(campaignId, user.id, { enemyNumbers: capsFor(context).enemyNumbers });
  settle(view, opportunity.notes.length > 0 || zoneEffects.length > 0 || letGo.length > 0 || Boolean(opportunity.downedAt), {
    from,
    movedBefore: token.movedThisRound,
    carried: carried.map((entry) => ({ tokenId: entry.token.id, from: { x: entry.token.x, y: entry.token.y }, movedThisRound: entry.token.movedThisRound })),
    stood: stands ? { conditions: sheet.conditions, conditionMeta: sheet.conditionMeta } : null,
    feet: stepFeet(spend),
  });
  return Response.json({
    view,
    ...(released ? { released: true } : {}),
    ...(opportunity.notes.length ? { opportunityAttacks: opportunity.notes } : {}),
    ...(zoneEffects.length ? { zoneEffects } : {}),
  });
}
