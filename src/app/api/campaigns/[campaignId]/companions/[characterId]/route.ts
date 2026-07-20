import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { handleDismissCompanion } from "@/lib/dm/companion-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party-lead removal of an AI companion: same server path as the DM's
// dismiss_companion tool, plus a table note so the departure is visible and
// the DM can narrate it on the next turn.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; characterId: string }> },
) {
  const { campaignId, characterId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const result = handleDismissCompanion(
    context.campaign,
    JSON.stringify({ characterId, reason: "the party lead sent them on their way" }),
    listSheets(campaignId),
  );
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `The party lead sends ${String(result.dismissed)} on their way; they leave the party.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  requestDmTurn(campaignId);
  return Response.json({ ok: true });
}
