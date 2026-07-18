import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getLocation } from "@/lib/db/locations";
import { enqueueLocationMap } from "@/lib/dm/maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead: re-render an area's map (queued; the client gets
// location_map_ready when it lands).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; locationId: string }> },
) {
  const { campaignId, locationId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const location = getLocation(locationId);
  if (!location || location.campaignId !== campaignId) {
    return Response.json({ error: "Location not found." }, { status: 404 });
  }
  void enqueueLocationMap(context.campaign, locationId);
  return Response.json({ ok: true }, { status: 202 });
}
