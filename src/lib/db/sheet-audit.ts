import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Audit trail for every DM-driven sheet change: what changed, why, and in
// which turn. Powers the session event log, keeps the DM accountable, and
// (via before_json pre-images) lets the party lead undo mistakes.

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
  // True when a pre-image exists and the entry has not been undone yet.
  undoable: boolean;
  // Top-level sheet fields the mutation wrote (names only; values stay
  // server-side in patch_json). Used for undo conflict warnings.
  patchKeys: string[];
  revertedBy: string | null;
  revertedAt: string | null;
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
  before_json: string | null;
  patch_json: string | null;
  reverted_by: string | null;
  reverted_at: string | null;
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
    undoable: row.before_json !== null && row.patch_json !== null && row.reverted_at === null,
    patchKeys: Object.keys(parseJson<Record<string, unknown>>(row.patch_json ?? "", {})),
    revertedBy: row.reverted_by,
    revertedAt: row.reverted_at,
  };
}

// The sheet snapshot and applied patch stay server-side (they are large and
// nobody but the undo path needs them); clients get the mapped entry.
export function getAuditPreImage(
  entryId: string,
): { before: CharacterSheet; patch: Record<string, unknown> } | null {
  const row = getDatabase()
    .prepare(`SELECT before_json, patch_json FROM sheet_audit WHERE id = ?`)
    .get(entryId) as Pick<AuditRow, "before_json" | "patch_json"> | undefined;
  if (!row?.before_json || !row.patch_json) {
    return null;
  }
  const before = parseJson<CharacterSheet | null>(row.before_json, null);
  const patch = parseJson<Record<string, unknown> | null>(row.patch_json, null);
  return before && patch ? { before, patch } : null;
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
  before?: CharacterSheet;
  patch?: Record<string, unknown>;
}): SheetAuditEntry {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO sheet_audit (
          id, campaign_id, character_id, turn_id, actor, kind, delta_json,
          reason, seq, created_at, before_json, patch_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.before ? JSON.stringify(input.before) : null,
      input.patch ? JSON.stringify(input.patch) : null,
    );
  return getAuditEntry(id)!;
}

export function getAuditEntry(entryId: string): SheetAuditEntry | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM sheet_audit WHERE id = ?`)
    .get(entryId) as AuditRow | undefined;
  return row ? mapEntry(row) : null;
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

export function listAuditForTurn(campaignId: string, turnId: string): SheetAuditEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM sheet_audit WHERE campaign_id = ? AND turn_id = ? ORDER BY seq ASC`,
    )
    .all(campaignId, turnId) as AuditRow[];
  return rows.map(mapEntry);
}

export function markReverted(entryId: string, byEntryId: string) {
  getDatabase()
    .prepare(`UPDATE sheet_audit SET reverted_by = ?, reverted_at = ? WHERE id = ?`)
    .run(byEntryId, nowIso(), entryId);
}

// Live (not yet undone) entries on the same character recorded after the
// given seq; used to warn the lead when an undo would clobber newer changes.
export function listLaterEntriesTouching(
  campaignId: string,
  characterId: string,
  afterSeq: number,
): SheetAuditEntry[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM sheet_audit
        WHERE campaign_id = ? AND character_id = ? AND seq > ?
          AND reverted_at IS NULL
        ORDER BY seq ASC
      `,
    )
    .all(campaignId, characterId, afterSeq) as AuditRow[];
  return rows.map(mapEntry);
}
