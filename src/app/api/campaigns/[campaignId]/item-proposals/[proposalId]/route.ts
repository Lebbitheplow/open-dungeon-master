import { z } from "zod";
import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { getItemProposal, resolveItemProposal } from "@/lib/db/item-proposals";
import { listSheets } from "@/lib/db/sheets";
import { applyDmMutation } from "@/lib/dm/mutations";
import { canResolveProposal } from "@/lib/dm/proposal-logic";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["approve", "decline", "cancel"]) });

// The owning player answers a DM item offer; the lead may also answer or
// withdraw it. Approval replays the original mutation through the normal
// audited path, so lead undo keeps working.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; proposalId: string }> },
) {
  const { campaignId, proposalId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }
  const { action } = parsed.data;

  const proposal = getItemProposal(proposalId);
  if (!proposal || proposal.campaignId !== campaignId) {
    return Response.json({ error: "Offer not found." }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return Response.json({ error: "The offer was already resolved." }, { status: 400 });
  }
  const actorIsOwner = proposal.userId === context.user.id;
  if (!canResolveProposal(action, actorIsOwner, isLead(context))) {
    return Response.json({ error: "Only the offer's player or the lead can do that." }, {
      status: 403,
    });
  }

  if (action === "approve") {
    // Fresh sheets: the offer may be hours old and the sheet has moved on.
    const sheets = listSheets(campaignId);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    const { result } = applyDmMutation(
      context.campaign,
      proposal.turnId ?? "",
      proposal.toolName,
      proposal.argsJson,
      sheets,
      sheetsById,
    );
    if ("error" in result) {
      // The world moved under the offer (item gone, gold spent); resolve it
      // as declined so the bar clears rather than wedging.
      const declined = resolveItemProposal(proposalId, "declined");
      if (declined) {
        publishPersisted(campaignId, "item_proposal_resolved", {
          proposal: publicItemProposal(declined),
        });
      }
      return Response.json(
        { error: `The offer could not be applied: ${String(result.error)}` },
        { status: 409 },
      );
    }
  }

  const resolved = resolveItemProposal(
    proposalId,
    action === "approve" ? "approved" : action === "decline" ? "declined" : "cancelled",
  );
  if (!resolved) {
    return Response.json({ error: "The offer was already resolved." }, { status: 400 });
  }
  publishPersisted(campaignId, "item_proposal_resolved", {
    proposal: publicItemProposal(resolved),
  });
  return Response.json({ proposal: publicItemProposal(resolved) });
}
