import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getLocation } from "@/lib/db/locations";
import { populateSettlement } from "@/lib/dm/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Populate" on a place (docs/vtt-parity-implementation-plan.md 12.1):
// the region map's and the places list's way to the settlement generator.
const bodySchema = z.object({
  size: z.string().optional(),
  terrain: z.string().optional(),
  seed: z.number().int().optional(),
  force: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; locationId: string }> }) {
  const { campaignId, locationId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const location = getLocation(locationId);
  if (!location || location.campaignId !== campaignId) {
    return Response.json({ error: "No such place." }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const outcome = populateSettlement(context.campaign, location, parsed.success ? parsed.data : {});
  if ("error" in outcome) {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ ok: true, npcs: outcome.npcs, shops: outcome.shops, layout: outcome.settlement.layoutDescription, hook: outcome.settlement.hook });
}
