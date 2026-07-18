import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import { addGroupMember, getThreadForUser, leaveThread } from "@/lib/db/side-chat";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addSchema = z.object({
  userId: z.string().max(80),
});

// Adds a campaign member to a group thread.
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
  if (thread.kind !== "group") {
    return Response.json({ error: "Direct chats can't gain members." }, { status: 400 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  const roster = new Set(listMembers(campaignId).map((member) => member.userId));
  if (!roster.has(parsed.data.userId)) {
    return Response.json({ error: "They aren't in this campaign." }, { status: 400 });
  }
  addGroupMember(threadId, parsed.data.userId);
  publishEphemeral(campaignId, "side_activity", {});
  return Response.json({ ok: true });
}

// Leave the thread (the last member out deletes it).
export async function DELETE(
  _request: Request,
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
  if (thread.kind !== "group") {
    return Response.json({ error: "Direct chats can't be left." }, { status: 400 });
  }
  leaveThread(threadId, context.user.id);
  publishEphemeral(campaignId, "side_activity", {});
  return Response.json({ ok: true });
}
