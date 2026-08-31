import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { quickStatblock, searchStatblocks } from "@/lib/dm/assist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Monster lookup for the DM: search the campaign's own genre catalog, then
// resolve one to the exact numbers start_encounter would spawn. A CR with no
// match falls back to the DMG's by-CR baseline, which is honest arithmetic
// rather than an invented stat block.
const statblockSchema = z.object({
  query: z.string().trim().max(80).default(""),
  ref: z.string().trim().max(80).default(""),
  cr: z.number().min(0).max(30).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = statblockSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid lookup." }, { status: 400 });
  }
  const { query, ref, cr } = parsed.data;

  if (ref || cr !== undefined) {
    const statblock = quickStatblock(context.campaign, { ref, cr });
    if (!statblock) {
      return Response.json({ error: "No monster by that name." }, { status: 404 });
    }
    return Response.json({ statblock });
  }
  return Response.json({ matches: searchStatblocks(context.campaign, query) });
}
