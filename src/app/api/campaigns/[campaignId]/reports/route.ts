import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getCampaignMessage } from "@/lib/db/messages";
import { createReport, hasReported, REPORT_REASONS } from "@/lib/db/moderation";
import { notifyUsers } from "@/lib/db/notifications";
import { getUserById, listUsers } from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportSchema = z.object({
  messageId: z.string().max(80).optional(),
  userId: z.string().max(80).optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(2000).default(""),
});

// A member flags a DM passage, another player's message, or a player. The
// report goes to this server's admins, who are the moderators: there is no
// central service behind the app, so the operator of the server the player
// chose is who acts on it (see the terms of service).
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
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid report." }, { status: 400 });
  }
  const { messageId, reason, details } = parsed.data;

  let excerpt = "";
  let authorType: "player" | "dm" | "system" = "player";
  let reportedUserId = parsed.data.userId ?? null;
  if (messageId) {
    const message = getCampaignMessage(messageId);
    if (!message || message.campaignId !== campaignId) {
      return Response.json({ error: "That message is not in this campaign." }, { status: 404 });
    }
    if (hasReported(context.user.id, messageId)) {
      return Response.json({ error: "You already reported that message." }, { status: 409 });
    }
    excerpt = message.content;
    authorType = message.authorType;
    reportedUserId = reportedUserId ?? message.userId;
  } else if (!reportedUserId) {
    return Response.json({ error: "Report a message or a player." }, { status: 400 });
  }
  if (reportedUserId === context.user.id) {
    return Response.json({ error: "You cannot report yourself." }, { status: 400 });
  }
  if (reportedUserId && !getUserById(reportedUserId)) {
    return Response.json({ error: "That player no longer exists." }, { status: 404 });
  }

  const report = createReport({
    campaignId,
    reporterUserId: context.user.id,
    messageId: messageId ?? null,
    reportedUserId,
    authorType,
    reason,
    details,
    excerpt,
  });

  // Reports inform moderation: every admin gets the bell.
  notifyUsers(
    listUsers()
      .filter((user) => user.isAdmin)
      .map((user) => user.id),
    {
      kind: "content_report",
      body: `${context.user.username} reported ${
        authorType === "dm" ? "a Dungeon Master passage" : "a player"
      } in ${context.campaign.title}.`,
    },
  );

  return Response.json({ report: { id: report.id, status: report.status } }, { status: 201 });
}
