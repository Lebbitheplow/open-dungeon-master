import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { markWhispersRead } from "@/lib/db/dm-whispers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marks all of the caller's DM whispers in this campaign as read.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  markWhispersRead(campaignId, context.user.id);
  return Response.json({ ok: true });
}
