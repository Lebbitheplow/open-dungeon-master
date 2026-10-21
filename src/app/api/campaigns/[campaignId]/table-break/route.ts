import { capsFor, isErrorResponse, isLead, requireMember, requireVoice } from "@/lib/campaign-api";
import { isAgentRequest } from "@/lib/dm/agent-turn";
import { requestDmTurn } from "@/lib/dm/loop";
import { settleTableWait } from "@/lib/dm/table-wait";
import { pauseTable, resumeTable, tableBreakOn } from "@/lib/dm/table-break";
import { mayResumeBreak } from "@/lib/dm/table-break-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A table break (src/lib/dm/table-break-logic.ts). POST pauses the table,
// DELETE resumes it. Any person in a seat may pause, unless the lead has
// muted them; an agent program playing a seat may do neither: a break is
// for the people at the table.

const AGENT_REFUSAL = "Only a person at the table can pause or resume it.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (isAgentRequest(request)) {
    return Response.json({ error: AGENT_REFUSAL }, { status: 403 });
  }
  if (context.campaign.status !== "active") {
    return Response.json({ error: "The adventure is not running, so there is nothing to pause." }, { status: 400 });
  }
  const { tableBreak, already } = pauseTable(campaignId, context.user);
  // A table waiting for everyone stops its clock and drops its banner until
  // Resume (src/lib/dm/table-wait.ts waitsForTable).
  settleTableWait(campaignId);
  return Response.json({ ok: true, tableBreak, ...(already ? { already: true } : {}) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (isAgentRequest(request)) {
    return Response.json({ error: AGENT_REFUSAL }, { status: 403 });
  }
  const current = tableBreakOn(campaignId);
  if (!current) {
    return Response.json({ ok: true, already: true });
  }
  const viewer = { userId: context.user.id, isLead: isLead(context), isDm: capsFor(context).role === "dm" };
  if (!mayResumeBreak(current, viewer)) {
    return Response.json(
      { error: `${current.name} paused the table. Only they, the party lead or the DM can resume it.` },
      { status: 403 },
    );
  }
  resumeTable(campaignId, context.user);
  // A table that waits for everyone (src/lib/dm/table-wait.ts) held its
  // clock through the break: it starts again from now, and the banner
  // comes back.
  if (settleTableWait(campaignId)) {
    requestDmTurn(campaignId);
  }
  return Response.json({ ok: true });
}
