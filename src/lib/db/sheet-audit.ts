import { getDatabase, nowIso, parseJson } from "@/lib/db/core";

// Audit trail for every DM-driven sheet change: what changed, why, and in
// which turn. Powers the session event log and keeps the DM accountable.

export type SheetAuditEntry = {
  id: string;
  campaignId: string;
  characterId: string;
  turnId: string | null;
  actor: string;
  kind: string;
  delta: Record<string, unknown>;
  reason: string;
  seq: number;
  createdAt: string;
};

type AuditRow = {
  id: string;
  campaign_id: string;
  character_id: string;
  turn_id: string | null;
  actor: string;
  kind: string;
  delta_json: string;
  reason: string;
  seq: number;
  created_at: string;
};

function mapEntry(row: AuditRow): SheetAuditEntry {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    characterId: row.character_id,
    turnId: row.turn_id,
    actor: row.actor,
    kind: row.kind,
    delta: parseJson<Record<string, unknown>>(row.delta_json, {}),
    reason: row.reason,
    seq: row.seq,
    createdAt: row.created_at,
  };
}

export function insertSheetAudit(input: {
  campaignId: string;
  characterId: string;
  turnId: string | null;
  kind: string;
  delta: Record<string, unknown>;
  reason: string;
  seq: number;
  actor?: string;
}): SheetAuditEntry {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO sheet_audit (
          id, campaign_id, character_id, turn_id, actor, kind, delta_json,
          reason, seq, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.characterId,
      input.turnId,
      input.actor ?? "dm",
      input.kind,
      JSON.stringify(input.delta),
      input.reason,
      input.seq,
      nowIso(),
    );
  const row = getDatabase().prepare(`SELECT * FROM sheet_audit WHERE id = ?`).get(id) as AuditRow;
  return mapEntry(row);
}

export function listRecentAudit(campaignId: string, limit = 50): SheetAuditEntry[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM (
          SELECT * FROM sheet_audit WHERE campaign_id = ? ORDER BY seq DESC LIMIT ?
        ) ORDER BY seq ASC
      `,
    )
    .all(campaignId, limit) as AuditRow[];
  return rows.map(mapEntry);
}
