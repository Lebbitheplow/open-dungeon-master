import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { DisputeStatus, DisputeVote } from "@/lib/dm/dispute-logic";

// Disputed rulings (src/lib/dm/dispute-logic.ts): a player's objection to a
// narrated passage, and how it was settled. Everything on the row is the
// table's business, so the whole record rides the stream.

export type RulingDispute = {
  id: string;
  campaignId: string;
  messageId: string;
  raisedByUserId: string;
  reason: string;
  status: DisputeStatus;
  votes: Record<string, DisputeVote>;
  // Who may cast, fixed when the vote opens so a mid-vote join changes nothing.
  voterIds: string[];
  decidedByUserId: string | null;
  decidedAt: string | null;
  seq: number;
  createdAt: string;
};

type Row = {
  id: string;
  campaign_id: string;
  message_id: string;
  raised_by_user_id: string;
  reason: string;
  status: DisputeStatus;
  votes_json: string;
  voters_json: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  seq: number;
  created_at: string;
};

function mapRow(row: Row): RulingDispute {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    messageId: row.message_id,
    raisedByUserId: row.raised_by_user_id,
    reason: row.reason,
    status: row.status,
    votes: parseJson<Record<string, DisputeVote>>(row.votes_json, {}),
    voterIds: parseJson<string[]>(row.voters_json, []),
    decidedByUserId: row.decided_by_user_id,
    decidedAt: row.decided_at,
    seq: row.seq,
    createdAt: row.created_at,
  };
}

export function insertDispute(input: {
  campaignId: string;
  messageId: string;
  raisedByUserId: string;
  reason: string;
  seq: number;
}): RulingDispute {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO ruling_disputes
         (id, campaign_id, message_id, raised_by_user_id, reason, status, votes_json, voters_json, seq, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', '{}', '[]', ?, ?)`,
    )
    .run(id, input.campaignId, input.messageId, input.raisedByUserId, input.reason.slice(0, 300), input.seq, nowIso());
  return getDispute(id)!;
}

export function getDispute(disputeId: string): RulingDispute | null {
  const row = getDatabase().prepare(`SELECT * FROM ruling_disputes WHERE id = ?`).get(disputeId) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function listOpenDisputes(campaignId: string): RulingDispute[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM ruling_disputes WHERE campaign_id = ? AND status IN ('open', 'voting') ORDER BY seq ASC`)
    .all(campaignId) as Row[];
  return rows.map(mapRow);
}

export function openDisputeForMessage(campaignId: string, messageId: string): RulingDispute | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM ruling_disputes WHERE campaign_id = ? AND message_id = ? AND status IN ('open', 'voting') LIMIT 1`)
    .get(campaignId, messageId) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function openVote(disputeId: string, voterIds: string[]): RulingDispute | null {
  const info = getDatabase()
    .prepare(`UPDATE ruling_disputes SET status = 'voting', voters_json = ?, votes_json = '{}' WHERE id = ? AND status = 'open'`)
    .run(JSON.stringify(voterIds), disputeId);
  return info.changes ? getDispute(disputeId) : null;
}

export function castVote(disputeId: string, userId: string, vote: DisputeVote): RulingDispute | null {
  const dispute = getDispute(disputeId);
  if (!dispute || dispute.status !== "voting" || !dispute.voterIds.includes(userId)) {
    return null;
  }
  const votes = { ...dispute.votes, [userId]: vote };
  getDatabase().prepare(`UPDATE ruling_disputes SET votes_json = ? WHERE id = ?`).run(JSON.stringify(votes), disputeId);
  return getDispute(disputeId);
}

export function settleDispute(
  disputeId: string,
  status: "upheld" | "overruled" | "withdrawn",
  decidedByUserId: string | null,
): RulingDispute | null {
  const info = getDatabase()
    .prepare(
      `UPDATE ruling_disputes SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ? AND status IN ('open', 'voting')`,
    )
    .run(status, decidedByUserId, nowIso(), disputeId);
  return info.changes ? getDispute(disputeId) : null;
}

export function publicDispute(dispute: RulingDispute) {
  return {
    id: dispute.id,
    messageId: dispute.messageId,
    raisedByUserId: dispute.raisedByUserId,
    reason: dispute.reason,
    status: dispute.status,
    votes: dispute.votes,
    voterIds: dispute.voterIds,
    decidedByUserId: dispute.decidedByUserId,
    createdAt: dispute.createdAt,
  };
}

export type PublicDispute = ReturnType<typeof publicDispute>;
