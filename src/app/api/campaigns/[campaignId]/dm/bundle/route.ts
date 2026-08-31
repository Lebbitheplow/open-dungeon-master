import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { exportWorkshopBundle } from "@/lib/db/workshop-bundle";
import { bundleCounts, bundleTotal, bundleWarnings } from "@/lib/workshop/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/campaigns/[campaignId]/dm/bundle
//
// The manifest arrives in the body rather than being derived from the
// workshop, because the licensing fields are a DECLARATION. Who made this and
// whose setting it is built on are things only a person can answer, and
// guessing them from a campaign title would be the wrong kind of convenient.
//
// requireDm, not requireLead: sharing a workshop puts its whole contents in
// somebody's hands, which is the DM's call.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const result = exportWorkshopBundle(campaignId, (raw as { manifest?: unknown }).manifest);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({
    bundle: result.bundle,
    counts: bundleCounts(result.bundle),
    total: bundleTotal(result.bundle),
    warnings: bundleWarnings(result.bundle),
  });
}
