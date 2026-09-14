import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getActiveBoard } from "@/lib/db/encounters";
import { getBattleMapForEncounter, setBattleMapScene } from "@/lib/db/battle-maps";
import {
  DRAWING_KINDS,
  DRAWING_TONES,
  SCENE_LIMITS,
  normalizeDrawing,
} from "@/lib/battlemap/scene";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Freehand marks on the live board (docs/vtt-parity-implementation-plan.md
// section 3.6). A drawing is a shared intention, not a fact: it is never
// fogged, it is simplified on the way in so a finger's jitter does not
// become sixty vertices, and a plan-of-attack arrow can be given a round to
// live. The DM always draws; players draw while the table setting allows
// it. Anyone may erase their own marks; the DM may clear the board.

const drawSchema = z.object({
  kind: z.enum(DRAWING_KINDS),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(2000),
  tone: z.enum(DRAWING_TONES).default("gold"),
  dmOnly: z.boolean().optional(),
  ttlRounds: z.number().int().min(1).max(20).optional(),
});

const eraseSchema = z.object({
  id: z.string().max(40).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const caps = capsFor(context);
  const dm = caps.adjudicates;
  if (!dm && context.campaign.gameSettings.boardDrawing === false) {
    return Response.json({ error: "Drawing on the board is off at this table." }, { status: 403 });
  }
  const parsed = drawSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That is not a drawing." }, { status: 400 });
  }
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!board || !map) {
    return Response.json({ error: "There is no board to draw on." }, { status: 404 });
  }
  const drawing = normalizeDrawing(
    {
      ...parsed.data,
      dmOnly: dm && parsed.data.dmOnly === true,
      authorId: context.user.id,
      ...(parsed.data.ttlRounds ? { expiresRound: board.round + parsed.data.ttlRounds - 1 } : {}),
    },
    map.width,
    map.height,
  );
  if (!drawing) {
    return Response.json({ error: "That is not a drawing." }, { status: 400 });
  }
  const drawings = [...map.drawings, drawing].slice(-SCENE_LIMITS.drawings);
  setBattleMapScene(map.id, { drawings });
  publishBattleMapUpdate(campaignId);
  return Response.json({ ok: true, id: drawing.id, points: drawing.points.length });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const dm = capsFor(context).adjudicates;
  const parsed = eraseSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which drawing." }, { status: 400 });
  }
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!board || !map) {
    return Response.json({ error: "There is no board." }, { status: 404 });
  }
  const id = parsed.data.id;
  const drawings = map.drawings.filter((drawing) => {
    if (id && drawing.id !== id) {
      return true;
    }
    // The DM clears anything; a player only their own.
    return !dm && drawing.authorId !== context.user.id;
  });
  if (drawings.length === map.drawings.length) {
    return Response.json({ error: "Nothing of yours to erase." }, { status: 404 });
  }
  setBattleMapScene(map.id, { drawings });
  publishBattleMapUpdate(campaignId);
  return Response.json({ ok: true, remaining: drawings.length });
}
