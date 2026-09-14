import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertItemProposal, listOpenItemProposals } from "@/lib/db/item-proposals";
import { getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { computeTrade, normalizeTradeOffer, tradeSummary } from "@/lib/dm/trade-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open DM item/gold offers (inventoryApprovals). Inventory is party
// knowledge, so every member sees the pending offers.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    proposals: listOpenItemProposals(campaignId).map(publicItemProposal),
  });
}

// A player offers a trade to another character
// (docs/vtt-parity-implementation-plan.md 11.2). The offer is checked
// against both sheets now, so an offer of what one does not carry never
// reaches the other side, and checked again when accepted.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const offer = normalizeTradeOffer(raw);
  if (!offer) {
    return Response.json({ error: "Offer something, or ask for something." }, { status: 400 });
  }
  const from = getSheetForUser(campaignId, context.user.id);
  if (!from) {
    return Response.json({ error: "You have no character to trade with." }, { status: 400 });
  }
  const to = getSheetById(offer.toCharacterId);
  if (!to || to.campaignId !== campaignId || to.id === from.id) {
    return Response.json({ error: "Pick another character at this table." }, { status: 400 });
  }
  const computed = computeTrade(from, to, offer);
  if ("error" in computed) {
    return Response.json({ error: computed.error }, { status: 409 });
  }
  const proposal = insertItemProposal({
    campaignId,
    turnId: null,
    characterId: from.id,
    userId: context.user.id,
    toolName: "trade",
    argsJson: JSON.stringify(offer),
    summary: tradeSummary(offer, from.name, to.name),
    reason: "",
    seq: allocateSeq(campaignId),
    toCharacterId: to.id,
  });
  publishPersisted(campaignId, "item_proposal_added", { proposal: publicItemProposal(proposal) });
  return Response.json({ proposal: publicItemProposal(proposal) });
}
