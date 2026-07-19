import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getFloor } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetForUser } from "@/lib/db/sheets";
import {
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  moveToken,
} from "@/lib/db/battle-maps";
import { buildPlayerMapView, occupiedTiles } from "@/lib/battlemap/view";
import { reachableTiles, speedToTiles } from "@/lib/battlemap/movement";
import { tileIndex } from "@/lib/battlemap/types";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { effectiveSpeed, exhaustionSpeed } from "@/lib/dm/condition-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moveSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

// A player moves their own token. Server-authoritative: walls, occupancy,
// and the round's remaining speed budget are enforced here, and moving is
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

  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return Response.json({ error: "No active battle map." }, { status: 404 });
  }
  const sheet = getSheetForUser(campaignId, user.id);
  const token = sheet ? getTokenByRef(map.id, sheet.id) : null;
  if (!sheet || !token) {
    return Response.json({ error: "You have no token on this map." }, { status: 400 });
  }
  if (sheet.currentHp <= 0) {
    return Response.json({ error: "You are down and cannot move." }, { status: 409 });
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
  // and 5+ zeroes it. The server refuses impossible moves.
  const speed = exhaustionSpeed(
    sheet.exhaustion ?? 0,
    effectiveSpeed(sheet.conditions, sheet.speed),
  );
  if (speed <= 0) {
    const cause =
      sheet.conditions.join(", ") ||
      ((sheet.exhaustion ?? 0) >= 5 ? `exhaustion level ${sheet.exhaustion}` : "a condition");
    return Response.json(
      { error: `You cannot move while ${cause} holds you (speed 0).` },
      { status: 409 },
    );
  }
  const budget = Math.max(0, speedToTiles(speed) - token.movedThisRound);
  const occupied = occupiedTiles(map, listTokens(map.id), token);
  const reach = reachableTiles(map.terrain, map.width, map.height, occupied, token, budget);
  const cost = reach.get(tileIndex(map.width, x, y));
  if (cost === undefined) {
    return Response.json({ error: "You cannot reach that tile this round." }, { status: 400 });
  }

  moveToken(token.id, x, y, token.movedThisRound + cost);
  publishBattleMapUpdate(campaignId);
  // Fresh self view in the response saves the mover a follow-up fetch.
  return Response.json({ view: buildPlayerMapView(campaignId, user.id) });
}
