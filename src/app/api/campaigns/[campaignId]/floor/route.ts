import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getFloor, setFloor, type Floor } from "@/lib/db/campaigns";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead release, layered: a hold opens into its stored next floor (which
// may be a spotlight); a spotlight force-opens. Releasing a partially
// answered spotlight hands the answers so far to the DM; releasing a hold or
// a fully unanswered spotlight wakes nobody (there is nothing to answer).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const floor = getFloor(campaignId);
  const next: Floor = floor.mode === "hold" ? floor.next : { mode: "open" };
  setFloor(campaignId, next);
  publishPersisted(campaignId, "floor_changed", { floor: next });
  if (floor.mode === "spotlight" && floor.respondedUserIds.length) {
    requestDmTurn(campaignId);
  }
  return Response.json({ ok: true });
}
