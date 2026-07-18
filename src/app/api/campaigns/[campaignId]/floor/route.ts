import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { setFloor } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner override: release a stuck spotlight back to the open floor.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.role !== "owner") {
    return Response.json({ error: "Only the owner can release the floor." }, { status: 403 });
  }
  setFloor(campaignId, { mode: "open" });
  publishPersisted(campaignId, "floor_changed", { floor: { mode: "open" } });
  return Response.json({ ok: true });
}
