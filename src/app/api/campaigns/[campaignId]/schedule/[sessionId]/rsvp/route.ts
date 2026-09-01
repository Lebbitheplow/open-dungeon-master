import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { notifyUsers } from "@/lib/db/notifications";
import { getScheduledSession, setRsvp } from "@/lib/db/scheduling";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rsvpSchema = z.object({
  response: z.enum(["yes", "no", "maybe"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; sessionId: string }> },
) {
  const { campaignId, sessionId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = rsvpSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  const session = getScheduledSession(campaignId, sessionId);
  if (!session || session.cancelledAt) {
    return Response.json({ error: "No such session (or it was cancelled)." }, { status: 404 });
  }
  setRsvp(sessionId, context.user.id, parsed.data.response);
  // Only a "no" interrupts the scheduler; yes and maybe just show on the
  // list. A table of eager players should not bury the DM in good news.
  if (parsed.data.response === "no" && session.createdByUserId !== context.user.id) {
    notifyUsers([session.createdByUserId], {
      campaignId,
      kind: "rsvp",
      body: `${context.user.username} can't make ${
        session.title || "the session"
      } in ${context.campaign.title}.`,
    });
  }
  publishEphemeral(campaignId, "schedule_updated", {});
  return Response.json({ session: getScheduledSession(campaignId, sessionId) });
}
