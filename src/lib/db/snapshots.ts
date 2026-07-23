import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  CAMPAIGN_SNAPSHOT_COLUMNS,
  SNAPSHOT_TABLES,
  reviveRow,
  serializeRow,
  type SnapshotPayload,
  type SnapshotRow,
} from "@/lib/dm/rollback-logic";

// Chapter-boundary world-state snapshots (chapter_snapshots table): the
// capture/restore layer under chapter rewind (src/lib/dm/rollback.ts). A
// 'boundary' row freezes the campaign as of a chapter's opening moment; the
// single 'pre_rollback' row per campaign is the safety copy taken right
// before a rewind rewrites everything.

export type ChapterSnapshotMeta = {
  id: string;
  campaignId: string;
  chapterIndex: number;
  boundarySeq: number;
  kind: "boundary" | "pre_rollback";
  createdAt: string;
};

function buildPayload(campaignId: string): SnapshotPayload {
  const db = getDatabase();
  const tables: Record<string, SnapshotRow[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    const rows =
      table === "battle_explored"
        ? (db
            .prepare(
              `SELECT be.* FROM battle_explored be
               JOIN battle_maps bm ON bm.id = be.map_id
               WHERE bm.campaign_id = ?`,
            )
            .all(campaignId) as SnapshotRow[])
        : (db
            .prepare(`SELECT * FROM ${table} WHERE campaign_id = ?`)
            .all(campaignId) as SnapshotRow[]);
    tables[table] = rows.map(serializeRow);
  }
  const campaign = db
    .prepare(
      `SELECT ${CAMPAIGN_SNAPSHOT_COLUMNS.join(", ")} FROM campaigns WHERE id = ?`,
    )
    .get(campaignId) as SnapshotRow;
  const loreFlags = db
    .prepare(`SELECT id, pinned FROM lore_entries WHERE campaign_id = ?`)
    .all(campaignId) as Array<{ id: string; pinned: number }>;
  const ruleFlags = db
    .prepare(`SELECT id, enabled, pinned FROM rule_chunks WHERE campaign_id = ?`)
    .all(campaignId) as Array<{ id: string; enabled: number; pinned: number }>;
  return { capturedAt: nowIso(), campaign, tables, loreFlags, ruleFlags };
}

function insertSnapshot(
  campaignId: string,
  chapterIndex: number,
  boundarySeq: number,
  kind: "boundary" | "pre_rollback",
) {
  const payload = buildPayload(campaignId);
  const db = getDatabase();
  if (kind === "pre_rollback") {
    // Only the most recent safety copy is kept, whatever chapter it targeted.
    db.prepare(
      `DELETE FROM chapter_snapshots WHERE campaign_id = ? AND kind = 'pre_rollback'`,
    ).run(campaignId);
  }
  db.prepare(
    `INSERT OR REPLACE INTO chapter_snapshots
       (id, campaign_id, chapter_index, boundary_seq, kind, snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    campaignId,
    chapterIndex,
    boundarySeq,
    kind,
    JSON.stringify(payload),
    nowIso(),
  );
}

// Freezes world state as of the opening of chapter `chapterIndex`; called
// right after the previous chapter's close cascade finished (and at
// activation for chapter 1), so "rewind to the start of chapter N" lands
// after facts/XP/arc/NPC-agency settled.
export function captureBoundarySnapshot(
  campaignId: string,
  chapterIndex: number,
  boundarySeq: number,
) {
  insertSnapshot(campaignId, chapterIndex, boundarySeq, "boundary");
}

export function capturePreRollbackSnapshot(campaignId: string, targetChapterIndex: number) {
  const db = getDatabase();
  const latest = db
    .prepare(`SELECT next_seq FROM campaigns WHERE id = ?`)
    .get(campaignId) as { next_seq: number } | undefined;
  insertSnapshot(campaignId, targetChapterIndex, (latest?.next_seq ?? 1) - 1, "pre_rollback");
}

export function getBoundarySnapshot(
  campaignId: string,
  chapterIndex: number,
): { meta: ChapterSnapshotMeta; payload: SnapshotPayload } | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM chapter_snapshots
       WHERE campaign_id = ? AND chapter_index = ? AND kind = 'boundary'`,
    )
    .get(campaignId, chapterIndex) as
    | {
        id: string;
        campaign_id: string;
        chapter_index: number;
        boundary_seq: number;
        kind: "boundary" | "pre_rollback";
        snapshot_json: string;
        created_at: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  const payload = parseJson<SnapshotPayload | null>(row.snapshot_json, null);
  if (!payload) {
    return null;
  }
  return {
    meta: {
      id: row.id,
      campaignId: row.campaign_id,
      chapterIndex: row.chapter_index,
      boundarySeq: row.boundary_seq,
      kind: row.kind,
      createdAt: row.created_at,
    },
    payload,
  };
}

// Chapter indexes that have a boundary snapshot, so the UI only offers
// rewind targets that can actually be restored.
export function listRewindableChapters(campaignId: string): number[] {
  const rows = getDatabase()
    .prepare(
      `SELECT chapter_index FROM chapter_snapshots
       WHERE campaign_id = ? AND kind = 'boundary' ORDER BY chapter_index ASC`,
    )
    .all(campaignId) as Array<{ chapter_index: number }>;
  return rows.map((row) => row.chapter_index);
}

export function deleteBoundarySnapshotsAfter(campaignId: string, chapterIndex: number) {
  getDatabase()
    .prepare(
      `DELETE FROM chapter_snapshots
       WHERE campaign_id = ? AND kind = 'boundary' AND chapter_index > ?`,
    )
    .run(campaignId, chapterIndex);
}

// Rewrites every snapshotted table and campaign column to the snapshot's
// state. Must run inside the caller's transaction; fully synchronous.
export function restoreSnapshot(campaignId: string, payload: SnapshotPayload) {
  const db = getDatabase();
  // Children first so nothing dangles mid-way; encounters/battle cascades
  // would cover their children anyway, but explicit is auditable.
  db.prepare(
    `DELETE FROM battle_explored WHERE map_id IN
       (SELECT id FROM battle_maps WHERE campaign_id = ?)`,
  ).run(campaignId);
  for (const table of [
    "battle_tokens",
    "battle_maps",
    "encounter_enemies",
    "encounters",
    "character_sheets",
    "npcs",
    "locations",
    "world_facts",
    "overworld_maps",
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE campaign_id = ?`).run(campaignId);
  }
  for (const table of SNAPSHOT_TABLES) {
    const rows = payload.tables[table] ?? [];
    if (!rows.length) {
      continue;
    }
    const columns = Object.keys(rows[0]);
    const insert = db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
    );
    for (const raw of rows) {
      const row = reviveRow(raw);
      insert.run(...columns.map((column) => row[column] ?? null));
    }
  }
  const campaignSets = CAMPAIGN_SNAPSHOT_COLUMNS.map((column) => `${column} = ?`).join(", ");
  db.prepare(`UPDATE campaigns SET ${campaignSets} WHERE id = ?`).run(
    ...CAMPAIGN_SNAPSHOT_COLUMNS.map((column) => payload.campaign?.[column] ?? null),
    campaignId,
  );
  // Lore/rules text is lead-owned and survives a rewind; only the
  // prompt-facing flags roll back, for entries that still exist.
  const updateLore = db.prepare(
    `UPDATE lore_entries SET pinned = ? WHERE id = ? AND campaign_id = ?`,
  );
  for (const flag of payload.loreFlags ?? []) {
    updateLore.run(flag.pinned, flag.id, campaignId);
  }
  const updateRule = db.prepare(
    `UPDATE rule_chunks SET enabled = ?, pinned = ? WHERE id = ? AND campaign_id = ?`,
  );
  for (const flag of payload.ruleFlags ?? []) {
    updateRule.run(flag.enabled, flag.pinned, flag.id, campaignId);
  }
}
