import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { allocateSeq, listMembers } from "@/lib/db/campaigns";
import { companionSlotsFree } from "@/lib/schemas/game-settings";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { companionMode, listCompanions } from "@/lib/dm/companion-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Player nudge: ask the DM to write a companion into the story. The DM
// decides who arrives and how (via add_companion); this only posts the
// request as a table note and wakes the DM.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.status !== "active") {
    return Response.json({ error: "The campaign is not active." }, { status: 409 });
  }
  const mode = companionMode(context.campaign);
  if (mode === "off") {
    return Response.json({ error: "Companions are disabled for this campaign." }, { status: 409 });
  }
  const sheets = listSheets(campaignId);
  const kinds = listCompanions(sheets).map((sheet) =>
    sheet.companionKind === "guest" ? ("guest" as const) : ("party" as const),
  );
  if (!companionSlotsFree(context.campaign.gameSettings, listMembers(campaignId).length, kinds)) {
    return Response.json(
      { error: "The party already has its full number of companions." },
      { status: 409 },
    );
  }

  const sheet = getSheetForUser(campaignId, context.user.id);
  const who = sheet?.name ?? context.user.username;
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    userId: context.user.id,
    content: `${who}'s player asks the DM to write ${mode === "guests" ? "a temporary ally" : "a companion"} into the story at the next natural moment.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  requestDmTurn(campaignId);
  return Response.json({ ok: true }, { status: 201 });
}
