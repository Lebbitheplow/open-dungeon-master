import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { setFloor } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead override: release a stuck spotlight back to the open floor.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  setFloor(campaignId, { mode: "open" });
  publishPersisted(campaignId, "floor_changed", { floor: { mode: "open" } });
  return Response.json({ ok: true });
}
