import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import { notifyUsers } from "@/lib/db/notifications";
import {
  cancelScheduledSession,
  sessionWhen,
  updateScheduledSession,
} from "@/lib/db/scheduling";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  startsAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), "Not a valid date.")
    .optional(),
  durationMin: z.number().int().min(15).max(720).optional(),
  note: z.string().trim().max(500).optional(),
});

function othersOf(campaignId: string, exceptUserId: string): string[] {
  return listMembers(campaignId)
    .map((member) => member.userId)
    .filter((userId) => userId !== exceptUserId);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; sessionId: string }> },
) {
  const { campaignId, sessionId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  }
  const patch = {
    ...parsed.data,
    ...(parsed.data.startsAt ? { startsAt: new Date(parsed.data.startsAt).toISOString() } : {}),
  };
  const session = updateScheduledSession(campaignId, sessionId, patch);
  if (!session) {
    return Response.json({ error: "No such session (or it was cancelled)." }, { status: 404 });
  }
  notifyUsers(othersOf(campaignId, context.user.id), {
    campaignId,
    kind: "session_updated",
    body: `${context.campaign.title}: ${
      session.title || "the session"
    } moved to ${sessionWhen(session.startsAt)}.`,
  });
  publishEphemeral(campaignId, "schedule_updated", {});
  return Response.json({ session });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; sessionId: string }> },
) {
  const { campaignId, sessionId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const session = cancelScheduledSession(campaignId, sessionId);
  if (!session) {
    return Response.json({ error: "No such session." }, { status: 404 });
  }
  notifyUsers(othersOf(campaignId, context.user.id), {
    campaignId,
    kind: "session_cancelled",
    body: `${context.campaign.title}: ${
      session.title || "the session"
    } on ${sessionWhen(session.startsAt)} was called off.`,
  });
  publishEphemeral(campaignId, "schedule_updated", {});
  return Response.json({ session });
}
