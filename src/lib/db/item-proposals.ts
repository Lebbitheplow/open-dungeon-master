import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase, nowIso } from "@/lib/db/core";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById } from "@/lib/db/sheets";
import { OFFER_NOTE_PREFIX, proposalExpired, resolutionNote, type ProposalStatus } from "@/lib/dm/proposal-logic";
import { ADVANCE_TOOL, advanceResolutionNote } from "@/lib/dm/advance-logic";
import { advanceArgs, settleAdvanceRelationship } from "@/lib/db/advances";
import { publishWithSeq } from "@/lib/events";
import { mapProposalRow as mapProposal, type ProposalRow } from "@/lib/dm/proposal-view";
import { APPROACH_TOOL } from "@/lib/dm/pact-logic";
import { approachLapsed } from "@/lib/db/pacts";

// DM-proposed inventory/gold changes awaiting the owning player's answer
// (game setting inventoryApprovals). args_json keeps the original tool
// arguments verbatim so approval replays the exact mutation through
// applyDmMutation, audit trail and all.

export type ItemProposal = {
  id: string;
  campaignId: string;
  turnId: string | null;
  characterId: string;
  userId: string;
  toolName: string;
  argsJson: string;
  summary: string;
  reason: string;
  status: ProposalStatus;
  seq: number;
  createdAt: string;
  resolvedAt: string | null;
  // A trade's counterparty (docs/vtt-parity-implementation-plan.md 11.2).
  toCharacterId: string;
  // How settling it went (issue 239): what applying it left on the sheet,
  // or "failed: <why>" when approval could not apply (status declined).
  outcome: string;
  // Only its own player reads and answers it (issue 503, a pact's approach):
  // never sent to the rest of the table, never told to it when it settles.
  ownerOnly: boolean;
};

export function insertItemProposal(input: {
  campaignId: string;
  turnId: string | null;
  characterId: string;
  userId: string;
  toolName: string;
  argsJson: string;
  summary: string;
  reason: string;
  seq: number;
  toCharacterId?: string;
  ownerOnly?: boolean;
}): ItemProposal {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO item_proposals (
         id, campaign_id, turn_id, character_id, user_id, tool_name,
         args_json, summary, reason, status, seq, created_at, to_character_id, owner_only
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.turnId,
      input.characterId,
      input.userId,
      input.toolName,
      input.argsJson,
      input.summary.slice(0, 200),
      input.reason.slice(0, 300),
      input.seq,
      nowIso(),
      input.toCharacterId ?? "",
      input.ownerOnly ? 1 : 0,
    );
  return getItemProposal(id)!;
}

export function getItemProposal(proposalId: string): ItemProposal | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM item_proposals WHERE id = ?`)
    .get(proposalId) as ProposalRow | undefined;
  return row ? mapProposal(row) : null;
}

// Pending offers for the session view. Lazy expiry: anything pending past
// the TTL flips to expired on read, so no timer is needed.
export function listOpenItemProposals(campaignId: string): ItemProposal[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM item_proposals WHERE campaign_id = ? AND status = 'pending' ORDER BY seq ASC`,
    )
    .all(campaignId) as ProposalRow[];
  const now = new Date();
  const expire = db.prepare(
    `UPDATE item_proposals SET status = 'expired', resolved_at = ? WHERE id = ?`,
  );
  const open: ItemProposal[] = [];
  for (const row of rows) {
    if (proposalExpired(row.created_at, now)) {
      expire.run(nowIso(), row.id);
      announceLapsed(mapProposal(row));
    } else {
      open.push(mapProposal(row));
    }
  }
  return open;
}

// An offer that lapsed unanswered is told to the table like any other
// settlement (issue 239), so the DM reads that it is closed rather than
// forgetting it was ever made. Once, on the read that expires it. An NPC's
// advance that lapsed is "no answer" (issue 501): the moment passes, with no
// sting, and the pair cools down before the next one.
export function announceLapsed(proposal: ItemProposal) {
  // An offer only its player could read lapses as quietly as it came: a
  // pact's approach left unanswered is a refusal nobody else hears of.
  if (proposal.ownerOnly) {
    if (proposal.toolName === APPROACH_TOOL) {
      approachLapsed(proposal.argsJson, getSheetById(proposal.characterId)?.name ?? "");
    }
    return;
  }
  const characterName =
    getSheetById(proposal.toolName === "trade" ? proposal.toCharacterId : proposal.characterId)?.name ?? "the character";
  let note = resolutionNote({ status: "expired", summary: proposal.summary, characterName });
  if (proposal.toolName === ADVANCE_TOOL) {
    settleAdvanceRelationship(proposal, "expired", characterName);
    note = advanceResolutionNote("expired", advanceArgs(proposal)?.subject ?? "The suitor", characterName);
  }
  const seq = allocateSeq(proposal.campaignId);
  const message = insertCampaignMessage({
    campaignId: proposal.campaignId,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    content: `${OFFER_NOTE_PREFIX}${note}`,
  });
  publishWithSeq(proposal.campaignId, seq, "message_added", { message });
}

// Settled offers, newest first: what the DM's game state lists and what the
// duplicate guard checks a new offer against (issue 239).
export function listRecentItemProposals(campaignId: string, limit = 20): ItemProposal[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM item_proposals WHERE campaign_id = ? AND status != 'pending'
       ORDER BY resolved_at DESC, seq DESC LIMIT ?`,
    )
    .all(campaignId, limit) as ProposalRow[];
  return rows.map(mapProposal);
}

// Flips a pending proposal to its resolution; returns null when it was
// already resolved (double-click, race with expiry). `outcome` records how
// it went for the DM's next turn.
export function resolveItemProposal(
  proposalId: string,
  status: Exclude<ProposalStatus, "pending">,
  outcome = "",
): ItemProposal | null {
  const info = getDatabase()
    .prepare(
      `UPDATE item_proposals SET status = ?, resolved_at = ?, outcome = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(status, nowIso(), outcome.slice(0, 300), proposalId);
  if (!info.changes) {
    return null;
  }
  return getItemProposal(proposalId);
}

// What settling a resolved offer left, recorded after the fact (an NPC's
// advance settles its relationship once the row is closed, so a second
// answer can never take the step twice).
export function recordProposalOutcome(proposal: ItemProposal, outcome: string): ItemProposal | null {
  getDatabase().prepare(`UPDATE item_proposals SET outcome = ? WHERE id = ?`).run(outcome.slice(0, 300), proposal.id);
  return getItemProposal(proposal.id);
}
