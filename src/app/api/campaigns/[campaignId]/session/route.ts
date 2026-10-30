import { z } from "zod";
import { capsFor, isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import { notifyUsers } from "@/lib/db/notifications";
import { isAgentRequest } from "@/lib/dm/agent-turn";
import { requestDmTurn } from "@/lib/dm/loop";
import { runningDmJob } from "@/lib/dm/queue";
import { endSession, sessionHoldOn, startSession } from "@/lib/dm/session-hold";
import { maySteerSessions } from "@/lib/dm/session-hold-logic";
import { resumeTable, tableBreakOn } from "@/lib/dm/table-break";
import { settleTableWait } from "@/lib/dm/table-wait";
import { onlineUserIds } from "@/lib/events";
import { isWorkshop, isPlaytest } from "@/lib/workshop/kind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ending a session and starting the next (issue 586,
// src/lib/dm/session-hold-logic.ts). Whoever steers the story or the party
// lead may do either; an agent program playing a seat may do neither, as
// with a break. Both answer a repeat with `already` and change nothing, so
// a double press or two of them at once never ends or starts twice.

const bodySchema = z.object({ action: z.enum(["end", "start"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (isAgentRequest(request)) {
    return Response.json({ error: "Only a person at the table can end or start a session." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say whether to end the session or start the next one." }, { status: 400 });
  }
  const { campaign, user } = context;
  if (!maySteerSessions({ steersStory: capsFor(context).steersStory, isLead: isLead(context) })) {
    return Response.json(
      { error: "Only whoever runs the story or the party lead can end or start a session." },
      { status: 403 },
    );
  }
  // A workshop or a test fight is one person's prep, not a table that meets.
  if (isWorkshop(campaign) || isPlaytest(campaign)) {
    return Response.json({ error: "Only a campaign has sessions." }, { status: 400 });
  }
  if (campaign.status !== "active") {
    return Response.json(
      { error: campaign.status === "lobby" ? "The adventure has not begun yet." : "The campaign has ended." },
      { status: 400 },
    );
  }

  if (parsed.data.action === "end") {
    // The session ends at a safe point: a storyteller turn under way lands
    // first, so its narration is not left after the session's last line
    // (the lead's Stop ends a turn that will not).
    if (runningDmJob(campaignId)?.kind === "turn" && !sessionHoldOn(campaignId)) {
      return Response.json(
        { error: "The story is still being told. End the session once this turn lands, or press Stop first." },
        { status: 409 },
      );
    }
    const { hold, already } = endSession(campaignId, user);
    // A break gives way to the end of the session: the hold above already
    // keeps play stopped, and the table should not come back to a break
    // nobody is on. Lifted after, so the queue is never open between.
    if (!already && tableBreakOn(campaignId)) {
      resumeTable(campaignId, user);
    }
    // A table waiting for everyone stops its clock until the next session.
    settleTableWait(campaignId);
    return Response.json({ ok: true, sessionHold: hold, ...(already ? { already: true } : {}) });
  }

  const started = startSession(campaignId, user);
  if (!started) {
    return Response.json({ ok: true, already: true });
  }
  // Whoever is not at the table hears that it has started, as they hear a
  // scheduled session start (src/lib/jobs.ts).
  const here = new Set(onlineUserIds(campaignId));
  notifyUsers(
    listMembers(campaignId)
      .map((member) => member.userId)
      .filter((userId) => userId !== user.id && !here.has(userId)),
    { campaignId, kind: "session_starting", body: `${campaign.title}: session ${started.number} has started. To the table!` },
  );
  // A table that waits for everyone starts its clock from now.
  if (settleTableWait(campaignId)) {
    requestDmTurn(campaignId);
  }
  return Response.json({ ok: true, number: started.number });
}
