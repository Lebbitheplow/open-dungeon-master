import { getDatabase, nowIso } from "@/lib/db/core";
import { allocateSeq, getCampaignById } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import {
  capturePreRollbackSnapshot,
  deleteBoundarySnapshotsAfter,
  getBoundarySnapshot,
  restoreSnapshot,
} from "@/lib/db/snapshots";
import { rollbackWarnings, type RollbackScope } from "@/lib/dm/rollback-logic";
import { resetChapterMemory } from "@/lib/dm/chapter-close";
import { enqueueDmJob } from "@/lib/dm/queue";
import { setDmStatus } from "@/lib/dm/status";
import { publishPersisted, publishWithSeq } from "@/lib/events";

// Chapter rewind: restores the boundary snapshot taken when the target
// chapter opened and deletes everything the campaign accumulated since.
// Destructive and lead-confirmed; the pre_rollback snapshot is the only way
// back afterward.

export function computeRollbackScope(
  campaignId: string,
  targetChapterIndex: number,
): RollbackScope | null {
  const snapshot = getBoundarySnapshot(campaignId, targetChapterIndex);
  if (!snapshot) {
    return null;
  }
  const db = getDatabase();
  const boundary = snapshot.meta.boundarySeq;
  const messagesToDelete = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ? AND seq > ?`,
      )
      .get(campaignId, boundary) as { n: number }
  ).n;
  const chaptersToDelete = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM chapters WHERE campaign_id = ? AND chapter_index > ?`,
      )
      .get(campaignId, targetChapterIndex) as { n: number }
  ).n;
  const activeEncounter = Boolean(
    db
      .prepare(`SELECT id FROM encounters WHERE campaign_id = ? AND status = 'active'`)
      .get(campaignId),
  );
  const inFlightTurn = Boolean(
    db
      .prepare(
        `SELECT id FROM dm_turns WHERE campaign_id = ? AND status IN ('running','awaiting_rolls')`,
      )
      .get(campaignId),
  );
  const pendingRolls = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pending_rolls WHERE campaign_id = ? AND status = 'pending'`,
      )
      .get(campaignId) as { n: number }
  ).n;
  const pendingProposals = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM item_proposals WHERE campaign_id = ? AND status = 'pending'`,
      )
      .get(campaignId) as { n: number }
  ).n;
  const snapshotSheetIds = new Set(
    (snapshot.payload.tables.character_sheets ?? []).map((row) => String(row.id)),
  );
  const sheetsToRemove = (
    db
      .prepare(`SELECT id, name FROM character_sheets WHERE campaign_id = ?`)
      .all(campaignId) as Array<{ id: string; name: string }>
  )
    .filter((row) => !snapshotSheetIds.has(row.id))
    .map((row) => row.name);
  return {
    targetChapterIndex,
    boundarySeq: boundary,
    messagesToDelete,
    chaptersToDelete,
    activeEncounter,
    inFlightTurn,
    pendingRolls,
    pendingProposals,
    sheetsToRemove,
  };
}

export function warningsForRollback(scope: RollbackScope): string[] {
  return rollbackWarnings(scope);
}

// Runs the rewind on the campaign's DM queue so it can never interleave
// with a narration turn. Resolves with ok=false when the snapshot vanished
// or the campaign is gone by the time the job runs.
export async function performRollback(
  campaignId: string,
  targetChapterIndex: number,
): Promise<{ ok: boolean; error?: string }> {
  let result: { ok: boolean; error?: string } = {
    ok: false,
    error: "The rewind did not run.",
  };
  await enqueueDmJob(campaignId, async () => {
    result = rollbackNow(campaignId, targetChapterIndex);
  });
  return result;
}

function rollbackNow(
  campaignId: string,
  targetChapterIndex: number,
): { ok: boolean; error?: string } {
  const campaign = getCampaignById(campaignId);
  const snapshot = getBoundarySnapshot(campaignId, targetChapterIndex);
  if (!campaign || !snapshot) {
    return { ok: false, error: "No snapshot exists for that chapter." };
  }
  const db = getDatabase();
  const boundary = snapshot.meta.boundarySeq;
  const capturedAt = snapshot.payload.capturedAt;

  // Safety copy first: the one road back if this rewind was a mistake.
  capturePreRollbackSnapshot(campaignId, targetChapterIndex);

  // Neutralize the turn machine before rewriting state under it. The turn
  // rows themselves are deleted below; marking them failed first keeps any
  // resumed in-process advance() from finalizing against restored state.
  db.prepare(
    `UPDATE dm_turns SET status = 'failed', updated_at = ?
     WHERE campaign_id = ? AND status IN ('running','awaiting_rolls')`,
  ).run(nowIso(), campaignId);

  db.transaction(() => {
    for (const table of [
      "campaign_messages",
      "campaign_events",
      "campaign_notes",
      "character_events",
      "sheet_audit",
      "item_proposals",
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE campaign_id = ? AND seq > ?`).run(
        campaignId,
        boundary,
      );
    }
    db.prepare(
      `DELETE FROM rolls WHERE campaign_id = ?
         AND (seq > ? OR (seq IS NULL AND created_at > ?))`,
    ).run(campaignId, boundary, capturedAt);
    db.prepare(`DELETE FROM dm_turns WHERE campaign_id = ? AND created_at > ?`).run(
      campaignId,
      capturedAt,
    );
    db.prepare(`DELETE FROM dm_whispers WHERE campaign_id = ? AND created_at > ?`).run(
      campaignId,
      capturedAt,
    );
    db.prepare(`DELETE FROM scene_chunks WHERE campaign_id = ? AND seq_start > ?`).run(
      campaignId,
      boundary,
    );
    db.prepare(`DELETE FROM chapters WHERE campaign_id = ? AND chapter_index > ?`).run(
      campaignId,
      targetChapterIndex,
    );
    // The target chapter reopens empty; its title/summary belonged to the
    // timeline that no longer happened.
    db.prepare(
      `UPDATE chapters
       SET status = 'open', seq_end = NULL, title = '', summary = '',
           highlights_json = '[]', embedding = NULL, updated_at = ?
       WHERE campaign_id = ? AND chapter_index = ?`,
    ).run(nowIso(), campaignId, targetChapterIndex);
    restoreSnapshot(campaignId, snapshot.payload);
  })();

  deleteBoundarySnapshotsAfter(campaignId, targetChapterIndex);
  resetChapterMemory(campaignId);
  setDmStatus(campaignId, "idle");

  const seq = allocateSeq(campaignId);
  const divider = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `The story rewinds to the start of Chapter ${targetChapterIndex}.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message: divider });
  // Incremental SSE cannot express mass deletion; clients treat this as a
  // hard refresh signal (useCampaignStream.ts).
  publishPersisted(campaignId, "campaign_rewound", {
    chapterIndex: targetChapterIndex,
    boundarySeq: boundary,
  });
  return { ok: true };
}
