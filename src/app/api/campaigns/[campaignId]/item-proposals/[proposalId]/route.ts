import { z } from "zod";
import { isErrorResponse, steersStory, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getItemProposal, recordProposalOutcome as resolveOutcome, resolveItemProposal, type ItemProposal } from "@/lib/db/item-proposals";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { applyTrade } from "@/lib/dm/trade";
import { canResolveTrade } from "@/lib/dm/trade-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { settleTurn, turnHolder } from "@/lib/dm/encounter-tools";
import {
  appliedOutcome,
  canResolveProposal,
  OFFER_NOTE_PREFIX,
  parseOfferArgs,
  resolutionNote,
  VITALS_PROPOSAL_TOOL_NAMES,
  type OfferResolution,
} from "@/lib/dm/proposal-logic";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { ADVANCE_TOOL } from "@/lib/dm/advance-logic";
import { APPROACH_TOOL, isApproachChoice } from "@/lib/dm/pact-logic";
import { answerApproach, canResolveApproach, runsTable } from "@/lib/dm/pact-players";
import { advancesAllowed } from "@/lib/dm/advance-tick";
import { announceAdvanceSettled, canResolveAdvance, settleNpcAdvance } from "@/lib/dm/npc-advance";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { SystemGlyph } from "@/lib/system-glyphs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `choice`: an answer that is more than yes or no (a pact's approach,
// issue 503: join, play along, tell the party, refuse), sent with approve.
const bodySchema = z.object({ action: z.enum(["approve", "decline", "cancel"]), choice: z.string().max(40).optional() });

function glyphFor(toolName: string): SystemGlyph {
  if (toolName === "apply_damage") return "cue-battle";
  if (toolName === "heal") return "cue-heal";
  if (VITALS_PROPOSAL_TOOL_NAMES.has(toolName)) return "cue-bell";
  return "cue-coin";
}

// Settling an offer is told to the whole table as a system line, so the DM's
// next turn reads which offer was answered, how, and what it left on the
// sheet (issue 239); the chronicle shows the same words.
function announceSettled(
  campaignId: string,
  proposal: ItemProposal,
  status: OfferResolution,
  who: { characterName: string; byLead: boolean; withdrawnBy?: string },
  outcome: string,
) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: glyphFor(proposal.toolName),
    content: `${OFFER_NOTE_PREFIX}${resolutionNote({ status, summary: proposal.summary, ...who, outcome })}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

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
  // A pact's approach (issue 503 Phase 7) is its player's alone to answer,
  // and nobody else's to see: whoever runs the story may withdraw it, and
  // to anyone else it does not exist. Nothing is told to the table, unless
  // the answer is to tell the party.
  if (proposal.toolName === APPROACH_TOOL) {
    const runs = runsTable(context.campaign, context.user.id);
    if (!actorIsOwner && !runs) {
      return Response.json({ error: "Offer not found." }, { status: 404 });
    }
    if (!canResolveApproach(action, actorIsOwner, runs)) {
      return Response.json({ error: action === "cancel" ? "Only whoever runs the story can withdraw this." : "Only that character's player can answer this." }, { status: 403 });
    }
    const choice = action === "decline" ? "refuse" : parsed.data.choice;
    if (action === "approve" && !isApproachChoice(choice)) {
      return Response.json({ error: "Choose an answer: join, play_along, report or refuse." }, { status: 400 });
    }
    const resolved = resolveItemProposal(proposalId, action === "cancel" ? "cancelled" : action === "approve" ? "approved" : "declined");
    if (!resolved) {
      return Response.json({ error: "The offer was already resolved." }, { status: 400 });
    }
    const outcome = action === "cancel" ? "withdrawn" : answerApproach(context.campaign, resolved, isApproachChoice(choice) ? choice : "refuse");
    const settled = resolveOutcome(resolved, outcome) ?? resolved;
    publishPersisted(campaignId, "item_proposal_resolved", { proposal: publicItemProposal(settled) });
    return Response.json({ proposal: publicItemProposal(settled), outcome });
  }
  // An NPC's romantic advance (issue 501) is the player's to answer and no
  // one else's: the lead may only withdraw it.
  if (proposal.toolName === ADVANCE_TOOL) {
    if (!canResolveAdvance(action, actorIsOwner, steersStory(context))) {
      return Response.json(
        { error: action === "cancel" ? "Only the lead can withdraw an advance." : "Only that character's player can answer this." },
        { status: 403 },
      );
    }
    // A yes needs a table that still plays romance (the lead may have
    // switched it off since): the advance is withdrawn instead.
    const romanceOff = action === "approve" && !advancesAllowed(context.campaign);
    const status = romanceOff ? "cancelled" : action === "approve" ? "approved" : action === "decline" ? "declined" : "cancelled";
    const resolved = resolveItemProposal(proposalId, status);
    if (!resolved) {
      return Response.json({ error: "The offer was already resolved." }, { status: 400 });
    }
    const outcome = settleNpcAdvance(context.campaign, resolved, status);
    const settled = outcome ? (resolveOutcome(resolved, outcome) ?? resolved) : resolved;
    publishPersisted(campaignId, "item_proposal_resolved", { proposal: publicItemProposal(settled) });
    announceAdvanceSettled(campaignId, settled, status);
    if (romanceOff) {
      return Response.json({ error: "Romance is off at this table now, so the advance was withdrawn." }, { status: 409 });
    }
    return Response.json({ proposal: publicItemProposal(settled) });
  }
  const isTrade = proposal.toolName === "trade";
  // Whose offer it is to answer: the counterparty of a trade, else the
  // character it is made to.
  const answerer = getSheetById(isTrade ? proposal.toCharacterId : proposal.characterId);
  const characterName = answerer?.name ?? "the character";
  // Who settled it, for the table note: the player, the lead for them, or
  // (a trade) its own proposer taking it back.
  const who = { characterName, byLead: !actorIsOwner, withdrawnBy: "" };
  if (isTrade) {
    // A trade: the counterparty answers, the proposer may withdraw, the
    // lead may do either (docs/vtt-parity-implementation-plan.md 11.2).
    const actorIsCounterparty = Boolean(answerer && answerer.userId === context.user.id);
    who.byLead = !actorIsCounterparty && !actorIsOwner;
    if (actorIsOwner && !actorIsCounterparty) {
      who.withdrawnBy = getSheetById(proposal.characterId)?.name ?? "The offerer";
    }
    if (!canResolveTrade(action, actorIsOwner, actorIsCounterparty, steersStory(context))) {
      return Response.json({ error: "Only the other side, the offerer or the lead can do that." }, { status: 403 });
    }
  } else if (!canResolveProposal(action, actorIsOwner, steersStory(context))) {
    return Response.json({ error: "Only the offer's player or the lead can do that." }, {
      status: 403,
    });
  }

  // What applying it did, for the row, the stream and the table note.
  let outcome = "";
  if (action === "approve" && isTrade) {
    const applied = applyTrade(context.campaign, proposal);
    if ("error" in applied) {
      const declined = resolveItemProposal(proposalId, "declined", `failed: ${applied.error}`);
      if (declined) {
        publishPersisted(campaignId, "item_proposal_resolved", { proposal: publicItemProposal(declined) });
        announceSettled(campaignId, declined, "failed", who, String(applied.error));
      }
      return Response.json({ error: `The trade could not go through: ${applied.error}` }, { status: 409 });
    }
  } else if (action === "approve") {
    // Fresh sheets: the offer may be hours old and the sheet has moved on.
    const sheets = listSheets(campaignId);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    const holder = turnHolder(campaignId);
    const { result } = applyDmMutation(
      context.campaign,
      proposal.turnId ?? "",
      proposal.toolName,
      proposal.argsJson,
      sheets,
      sheetsById,
    );
    // A combatant who left the fight during the call takes no turn with them.
    settleTurn(context.campaign, holder);
    if ("error" in result) {
      // The world moved under the offer (item gone, gold spent); resolve it
      // as declined so the bar clears rather than wedging, and say why.
      const why = String(result.error);
      const declined = resolveItemProposal(proposalId, "declined", `failed: ${why}`);
      if (declined) {
        publishPersisted(campaignId, "item_proposal_resolved", {
          proposal: publicItemProposal(declined),
        });
        announceSettled(campaignId, declined, "failed", who, why);
      }
      return Response.json(
        { error: `The offer could not be applied: ${why}` },
        { status: 409 },
      );
    }
    const after = getSheetById(proposal.characterId);
    if (after) {
      outcome = appliedOutcome(proposal.toolName, parseOfferArgs(proposal.argsJson), {
        name: after.name,
        equipment: after.equipment,
        gold: after.gold,
        copper: after.copper,
        currentHp: after.currentHp,
        maxHp: after.maxHp,
        tempHp: after.tempHp,
        conditions: after.conditions,
      });
    }
  }

  const status = action === "approve" ? "approved" : action === "decline" ? "declined" : "cancelled";
  const resolved = resolveItemProposal(proposalId, status, outcome);
  if (!resolved) {
    return Response.json({ error: "The offer was already resolved." }, { status: 400 });
  }
  publishPersisted(campaignId, "item_proposal_resolved", {
    proposal: publicItemProposal(resolved),
  });
  announceSettled(campaignId, resolved, status, who, outcome);
  return Response.json({ proposal: publicItemProposal(resolved) });
}
