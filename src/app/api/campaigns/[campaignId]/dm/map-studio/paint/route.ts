import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { normalizeStamp } from "@/lib/battlemap/stamp";
import { normalizeShape } from "@/lib/battlemap/tools";
import { hasPaint, hasScene, paintRequestSchema, sceneRequestSchema } from "@/lib/schemas/map-paint";
import { getActiveBoard } from "@/lib/db/encounters";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { paintStudioMap, setStudioScene } from "@/lib/dm/map-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM paints terrain onto the live board. Difficult ground has always
// cost double to cross (src/lib/battlemap/movement.ts); this is what lets a
// person put it where they want it rather than only accept what the
// generator placed.
//
// A stamp, a shape tool or an undo is the same request with something other
// than strokes in it: each is compiled into ordinary strokes
// (src/lib/battlemap/stamp.ts, tools.ts) and validated by exactly the same
// painter, so there is one place that decides what a legal map is.
//
// The scene layer (a door tapped shut, labels, patches of light, the DM's
// overlay) rides on the same request and touches no terrain.

const bodySchema = paintRequestSchema.extend(sceneRequestSchema.shape);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || (!hasPaint(parsed.data) && !hasScene(parsed.data))) {
    return Response.json({ error: "Invalid brush strokes." }, { status: 400 });
  }
  const body = parsed.data;

  if (hasPaint(body)) {
    const stamp = body.stamp ? normalizeStamp(body.stamp) : null;
    if (body.stamp && !stamp) {
      return Response.json({ error: "That is not a shape this map knows." }, { status: 400 });
    }
    // A shape is clamped onto the board it lands on, so the board's size is
    // needed before the request can be normalized.
    const board = getActiveBoard(campaignId);
    const live = board ? getBattleMapForEncounter(board.id) : null;
    const shape = body.shape && live ? normalizeShape(body.shape, live.width, live.height) : null;
    if (body.shape && live && !shape) {
      return Response.json({ error: "That is not a shape this map knows." }, { status: 400 });
    }
    const outcome = paintStudioMap(context.campaign, {
      strokes: body.strokes as Parameters<typeof paintStudioMap>[1]["strokes"],
      stamp: stamp ?? undefined,
      shape: shape ?? undefined,
      replaceTerrain: body.replaceTerrain,
    });
    if ("error" in outcome) {
      return Response.json({ error: outcome.error }, { status: 409 });
    }
  }

  if (hasScene(body)) {
    const outcome = setStudioScene(context.campaign, {
      door: body.door,
      labels: body.labels,
      zones: body.zones,
      overlayPath: body.overlayPath,
    });
    if ("error" in outcome) {
      return Response.json({ error: outcome.error }, { status: 409 });
    }
    return Response.json({ ok: true, door: outcome.door ?? null });
  }
  return Response.json({ ok: true });
}
