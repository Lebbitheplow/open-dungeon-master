import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { pingBoard } from "@/lib/dm/board";
import { getSheetForUser } from "@/lib/db/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pointing at the map. Anyone at the table may ping, because "the door, the
// door" is the most-used thing anybody says over a shared board. Only whoever
// is steering may send the focusing kind, which opens the map on every
// client rather than only flashing on the ones already looking at it.
const pingSchema = z.object({
  x: z.number().int().min(0).max(255),
  y: z.number().int().min(0).max(255),
  focus: z.boolean().optional(),
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
  const parsed = pingSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid ping." }, { status: 400 });
  }
  const map = getActiveBattleMap(campaignId);
  if (!map || parsed.data.x >= map.width || parsed.data.y >= map.height) {
    return Response.json({ error: "There is no board to point at." }, { status: 404 });
  }
  const caps = capsFor(context);
  const sheet = getSheetForUser(campaignId, context.user.id);
  pingBoard(context.campaign, {
    x: parsed.data.x,
    y: parsed.data.y,
    // A ping is signed with the character the table knows, falling back to
    // the seat when the pinger runs nobody.
    byName: sheet?.name ?? (caps.role === "dm" ? "The DM" : context.user.username),
    focus: parsed.data.focus === true && caps.steersStory,
  });
  return Response.json({ ok: true });
}
