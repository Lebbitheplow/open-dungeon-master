import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import {
  createGroupThread,
  getOrCreateDmThread,
  listThreadsForUser,
} from "@/lib/db/side-chat";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ threads: listThreadsForUser(campaignId, context.user.id) });
}

const createSchema = z.object({
  kind: z.enum(["dm", "group"]),
  memberUserIds: z.array(z.string().max(80)).min(1).max(8),
  title: z.string().trim().max(80).default(""),
});

// Creates (or, for 1:1 threads, reuses) a side-chat thread. Recipients learn
// about it via the contentless side_activity ephemeral event.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  const memberIds = [...new Set(parsed.data.memberUserIds)].filter(
    (id) => id !== context.user.id,
  );
  if (memberIds.length === 0) {
    return Response.json({ error: "Pick at least one other member." }, { status: 400 });
  }
  const roster = new Set(listMembers(campaignId).map((member) => member.userId));
  if (memberIds.some((id) => !roster.has(id))) {
    return Response.json({ error: "Everyone in a chat must be in the campaign." }, { status: 400 });
  }

  if (parsed.data.kind === "dm") {
    if (memberIds.length !== 1) {
      return Response.json({ error: "A direct chat has exactly one other member." }, { status: 400 });
    }
    const thread = getOrCreateDmThread(campaignId, context.user.id, memberIds[0]);
    publishEphemeral(campaignId, "side_activity", {});
    return Response.json({ thread }, { status: 201 });
  }

  const thread = createGroupThread(campaignId, context.user.id, memberIds, parsed.data.title);
  publishEphemeral(campaignId, "side_activity", {});
  return Response.json({ thread }, { status: 201 });
}
