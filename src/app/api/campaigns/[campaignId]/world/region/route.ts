import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { regionBridge } from "@/lib/db/atlas-region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The bridge between the Atlas and the playable Region map (audit finding
// WF-09, src/lib/db/atlas-region.ts): which Atlas map stands over the
// Region, whether the Region still shows its picture, and each bound pin
// with its place's marker beside the cell the pin stands on.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(regionBridge(campaignId));
}
