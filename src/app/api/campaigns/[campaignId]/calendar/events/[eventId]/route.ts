import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { deleteCalendarEvent } from "@/lib/db/calendar-events";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string; eventId: string }> }) {
  const { campaignId, eventId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!deleteCalendarEvent(campaignId, eventId)) {
    return Response.json({ error: "No such event." }, { status: 404 });
  }
  publishEphemeral(campaignId, "calendar_updated", { at: Date.now() });
  return Response.json({ ok: true });
}
