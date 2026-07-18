import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getThreadForUser, markThreadRead } from "@/lib/db/side-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readSchema = z.object({
  lastSeq: z.number().int().min(0),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; threadId: string }> },
) {
  const { campaignId, threadId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const thread = getThreadForUser(threadId, context.user.id);
  if (!thread || thread.campaignId !== campaignId) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = readSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  markThreadRead(threadId, context.user.id, parsed.data.lastSeq);
  return Response.json({ ok: true });
}
