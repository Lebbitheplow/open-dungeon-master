import { getDatabase, nowIso } from "@/lib/db/core";
import { proposalExpired, type ProposalStatus } from "@/lib/dm/proposal-logic";

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
};

type ProposalRow = {
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
};

function mapProposal(row: ProposalRow): ItemProposal {
  return {
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
  };
}

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
}): ItemProposal {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO item_proposals (
         id, campaign_id, turn_id, character_id, user_id, tool_name,
         args_json, summary, reason, status, seq, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
    } else {
      open.push(mapProposal(row));
    }
  }
  return open;
}

// Flips a pending proposal to its resolution; returns null when it was
// already resolved (double-click, race with expiry).
export function resolveItemProposal(
  proposalId: string,
  status: Exclude<ProposalStatus, "pending">,
): ItemProposal | null {
  const info = getDatabase()
    .prepare(
      `UPDATE item_proposals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(status, nowIso(), proposalId);
  if (!info.changes) {
    return null;
  }
  return getItemProposal(proposalId);
}
