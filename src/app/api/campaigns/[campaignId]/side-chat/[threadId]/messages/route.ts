import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import {
  getThreadForUser,
  insertSideMessage,
  listThreadMessages,
} from "@/lib/db/side-chat";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
  const afterSeq = Number.parseInt(
    new URL(request.url).searchParams.get("afterSeq") || "0",
    10,
  );
  return Response.json({
    messages: listThreadMessages(threadId, Number.isFinite(afterSeq) ? afterSeq : 0),
  });
}

const sendSchema = z.object({
  content: z.string().trim().min(1).max(2000),
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
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Message can't be empty." }, { status: 400 });
  }
  const message = insertSideMessage(threadId, context.user.id, parsed.data.content);
  // Contentless by design: the shared campaign stream must not carry private
  // message bodies or even who is talking to whom.
  publishEphemeral(campaignId, "side_activity", {});
  return Response.json({ message }, { status: 201 });
}
