import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { BRUSHES, MAX_BRUSH_RADIUS, MAX_STROKES } from "@/lib/battlemap/paint";
import { STAMPS, STAMP_SIZE, normalizeStamp, stampStrokes } from "@/lib/battlemap/stamp";
import { paintStudioMap } from "@/lib/dm/map-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM paints terrain onto the live board. Difficult ground has always
// cost double to cross (src/lib/battlemap/movement.ts); this is what lets a
// person put it where they want it rather than only accept what the
// generator placed.
//
// A stamp is the same request with a shape instead of a stroke: the room,
// corridor or cavern is compiled here into ordinary strokes and validated by
// exactly the same painter, so there is one place that decides what a legal
// map is (src/lib/battlemap/stamp.ts).
const strokeSchema = z.object({
  x: z.number().int().min(0).max(255),
  y: z.number().int().min(0).max(255),
  brush: z.enum(BRUSHES as unknown as [string, ...string[]]),
  radius: z.number().int().min(0).max(MAX_BRUSH_RADIUS).optional(),
});

const stampSchema = z.object({
  kind: z.enum(STAMPS as unknown as [string, ...string[]]),
  x: z.number().int().min(0).max(255),
  y: z.number().int().min(0).max(255),
  width: z.number().int().min(STAMP_SIZE.min).max(STAMP_SIZE.max),
  height: z.number().int().min(STAMP_SIZE.min).max(STAMP_SIZE.max),
});

const paintSchema = z.object({
  strokes: z.array(strokeSchema).min(1).max(MAX_STROKES).optional(),
  stamp: stampSchema.optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = paintSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid brush strokes." }, { status: 400 });
  }

  // A stamp expands into far more strokes than a hand could send, so it is
  // compiled after validation rather than counted against the wire cap.
  const stamp = parsed.data.stamp ? normalizeStamp(parsed.data.stamp) : null;
  if (parsed.data.stamp && !stamp) {
    return Response.json({ error: "That is not a shape this map knows." }, { status: 400 });
  }
  const strokes = stamp ? stampStrokes(stamp) : parsed.data.strokes;
  if (!strokes?.length) {
    return Response.json({ error: "Nothing was painted." }, { status: 400 });
  }

  const outcome = paintStudioMap(
    context.campaign,
    strokes as Parameters<typeof paintStudioMap>[1],
  );
  return "error" in outcome
    ? Response.json({ error: outcome.error }, { status: 409 })
    : Response.json({ ok: true });
}
