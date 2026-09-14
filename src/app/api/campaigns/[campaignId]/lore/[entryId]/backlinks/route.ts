import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { backlinksFor } from "@/lib/dm/lore-backlinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Mentioned in" for one entry, scoped to what the reader could open.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; entryId: string }> },
) {
  const { campaignId, entryId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    mentions: backlinksFor(campaignId, entryId, { userId: context.user.id, steersStory: steersStory(context) }),
  });
}
