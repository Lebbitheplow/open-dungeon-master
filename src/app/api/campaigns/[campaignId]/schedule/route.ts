import { z } from "zod";
import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import { notifyUsers } from "@/lib/db/notifications";
import {
  createScheduledSession,
  listScheduledSessions,
  sessionWhen,
} from "@/lib/db/scheduling";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real-world session planning for a campaign. The lead schedules; everyone
// sees the list and RSVPs. Changes ride the campaign stream as a contentless
// schedule_updated nudge, and land in each member's notification inbox.

const createSchema = z.object({
  title: z.string().trim().max(120).default(""),
  startsAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), "Not a valid date."),
  durationMin: z.number().int().min(15).max(720).default(180),
  note: z.string().trim().max(500).default(""),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ sessions: listScheduledSessions(campaignId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  }
  const startsAt = new Date(parsed.data.startsAt).toISOString();
  if (Date.parse(startsAt) < Date.now() - 60 * 60 * 1000) {
    return Response.json({ error: "That time is in the past." }, { status: 400 });
  }
  const session = createScheduledSession(campaignId, context.user.id, {
    ...parsed.data,
    startsAt,
  });
  notifyUsers(
    listMembers(campaignId)
      .map((member) => member.userId)
      .filter((userId) => userId !== context.user.id),
    {
      campaignId,
      kind: "session_scheduled",
      body: `${context.campaign.title}: ${
        session.title || "a session"
      } is planned for ${sessionWhen(session.startsAt)}.`,
    },
  );
  publishEphemeral(campaignId, "schedule_updated", {});
  return Response.json({ session }, { status: 201 });
}
