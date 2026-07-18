import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getLocation } from "@/lib/db/locations";
import { enqueueLocationMap } from "@/lib/dm/maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner: re-render an area's map (queued; the client gets
// location_map_ready when it lands).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; locationId: string }> },
) {
  const { campaignId, locationId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.role !== "owner") {
    return Response.json({ error: "Only the owner can redraw maps." }, { status: 403 });
  }
  const location = getLocation(locationId);
  if (!location || location.campaignId !== campaignId) {
    return Response.json({ error: "Location not found." }, { status: 404 });
  }
  void enqueueLocationMap(context.campaign, locationId);
  return Response.json({ ok: true }, { status: 202 });
}
