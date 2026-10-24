import { getDatabase } from "@/lib/db/core";
import type { ItemProposal } from "@/lib/db/item-proposals";
import type { ProposalStatus } from "@/lib/dm/proposal-logic";
import { parseOfferArgs } from "@/lib/dm/proposal-logic";
import { normalizeTradeOffer } from "@/lib/dm/trade-logic";
import { APPROACH_CHOICES, APPROACH_CHOICE_TEXT, APPROACH_TOOL, approachArgs } from "@/lib/dm/pact-logic";
import { storytellerSees, type ViewerCaps } from "@/lib/dm/viewer";

// An offer as a seat receives it, and who may receive it at all. Kept free
// of the event stream so the stream's own per-seat delivery
// (src/lib/table-delivery.ts) can read an offer back on a replay.

export type ProposalRow = {
  id: string;
  campaign_id: string;
  turn_id: string | null;
  character_id: string;
  user_id: string;
  tool_name: string;
  args_json: string;
  summary: string;
  reason: string;
  status: ProposalStatus;
  seq: number;
  created_at: string;
  resolved_at: string | null;
  to_character_id: string | null;
  outcome: string | null;
  owner_only?: number | null;
};

export function mapProposalRow(row: ProposalRow): ItemProposal {
  return {
    toCharacterId: row.to_character_id ?? "",
    outcome: row.outcome ?? "",
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    characterId: row.character_id,
    userId: row.user_id,
    toolName: row.tool_name,
    argsJson: row.args_json,
    summary: row.summary,
    reason: row.reason,
    status: row.status,
    seq: row.seq,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    ownerOnly: row.owner_only === 1,
  };
}

export function readProposal(proposalId: string): ItemProposal | null {
  const row = getDatabase().prepare(`SELECT * FROM item_proposals WHERE id = ?`).get(proposalId) as ProposalRow | undefined;
  return row ? mapProposalRow(row) : null;
}

// Who may be sent an offer: everyone, unless it is owner-only (issue 503, a
// pact's approach), which goes to its own player and to whoever runs the
// story (the storyteller tier, src/lib/dm/viewer.ts), never the rest of the
// table, the lead of an AI table included.
export function offerVisibleTo(
  proposal: Pick<ItemProposal, "ownerOnly" | "userId">,
  userId: string,
  caps: Pick<ViewerCaps, "storytellerSecrets">,
): boolean {
  return !proposal.ownerOnly || proposal.userId === userId || storytellerSees(caps);
}

// The offer as the stream and the snapshot carry it. An offer of items is
// party knowledge; an owner-only one reaches only the seats above
// (offerVisibleTo), and says so with ownerOnly, which the apps notify on.
export function publicItemProposal(proposal: ItemProposal) {
  return {
    id: proposal.id,
    characterId: proposal.characterId,
    userId: proposal.userId,
    toolName: proposal.toolName,
    summary: proposal.summary,
    reason: proposal.reason,
    status: proposal.status,
    outcome: proposal.outcome,
    createdAt: proposal.createdAt,
    toCharacterId: proposal.toCharacterId,
    ...(proposal.ownerOnly ? { ownerOnly: true as const } : {}),
    // A trade carries its offer so the bar can lay out both sides.
    ...(proposal.toolName === "trade" ? { offer: normalizeTradeOffer(parseOfferArgs(proposal.argsJson)) } : {}),
    // An NPC's advance (issue 501) carries who makes it and their face, so
    // the card shows the person and not only the words.
    ...(proposal.toolName === "romance_advance" ? { advance: advanceCard(proposal.argsJson) } : {}),
    // A pact's approach (issue 503) carries who makes it and the answers.
    ...(proposal.toolName === APPROACH_TOOL ? approachCard(proposal.argsJson) : {}),
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function advanceCard(argsJson: string) {
  const args = parseOfferArgs(argsJson) as Record<string, unknown>;
  const look = args.look && typeof args.look === "object" ? (args.look as Record<string, unknown>) : {};
  return {
    suitor: text(args.subject),
    portraitUrl: text(args.portraitUrl),
    look: { gender: text(look.gender), race: text(look.race), class: text(look.class), role: text(look.role) },
  };
}

function approachCard(argsJson: string) {
  const args = approachArgs(argsJson);
  return {
    choices: APPROACH_CHOICES.map((id) => ({ id, ...APPROACH_CHOICE_TEXT[id] })),
    from: { name: args?.recruiter ?? "", portraitUrl: args?.portraitUrl ?? "", look: args?.look ?? { gender: "", race: "", class: "" } },
  };
}
