import { getDatabase, nowIso } from "@/lib/db/core";
import { allocateSeq, getCampaignById } from "@/lib/db/campaigns";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { deleteCompanionUser, isCompanionUserId } from "@/lib/db/users";
import {
  capturePreRollbackSnapshot,
  deleteBoundarySnapshotsAfter,
  getBoundarySnapshot,
  restoreSnapshot,
} from "@/lib/db/snapshots";
import { rollbackWarnings, type RollbackScope } from "@/lib/dm/rollback-logic";
import { resetChapterMemory } from "@/lib/dm/chapter-close";
import { requestDmTurn } from "@/lib/dm/loop";
import { enqueueDmJobFirst, stopDmJob } from "@/lib/dm/queue";
import { REWOUND_REASON } from "@/lib/dm/job-stage-logic";
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
  // An owner-only offer (a pact's approach, issue 503) is not the table's to
  // count: the rewind's warning would tell the lead one exists.
  const pendingProposals = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM item_proposals WHERE campaign_id = ? AND status = 'pending' AND owner_only = 0`,
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
// with a narration turn, ahead of whatever else is queued there: that work
// belongs to the story the rewind undoes, and runs after it instead. Resolves
// with ok=false when the snapshot vanished or the campaign is gone by the
// time the job runs.
export async function performRollback(
  campaignId: string,
  targetChapterIndex: number,
): Promise<{ ok: boolean; error?: string }> {
  let result: { ok: boolean; error?: string } = {
    ok: false,
    error: "The rewind did not run.",
  };
  // The lead confirmed the rewind knowing a turn was in flight (the scope's
  // inFlightTurn warning). That turn would be undone anyway, and one that is
  // stuck would hold the rewind behind it forever (issue #383), so it is
  // stopped first.
  stopDmJob(campaignId, REWOUND_REASON);
  await enqueueDmJobFirst(campaignId, async () => {
    result = rollbackNow(campaignId, targetChapterIndex);
  });
  // Chapter 1's rewind point is the world before the opening narration was
  // written (captured at the campaign's start, after setup and the arc), so
  // the rewind takes the opening with it. Nothing else would ask for a new
  // one: the table read "The story rewinds" and then sat silent until
  // someone spoke (a 25-minute wait on 2026-10-23). The DM tells the opening
  // again, as the campaign's start does; requestDmTurn leaves a table with a
  // person in the DM seat to them. A rewind point that already holds a
  // narration waits for the players as any other chapter's does.
  if (result.ok && targetChapterIndex === 1 && !listRecentMessages(campaignId, 50).some((message) => message.authorType === "dm")) {
    requestDmTurn(campaignId);
  }
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

  // The bot users behind the companions at the table now: one recruited
  // after the boundary loses its sheet to the restore, and its user goes too.
  const botsBefore = (
    db.prepare(`SELECT user_id FROM character_sheets WHERE campaign_id = ?`).all(campaignId) as Array<{ user_id: string }>
  )
    .map((row) => row.user_id)
    .filter(isCompanionUserId);

  db.transaction(() => {
    // A pin names a message and a beat sits at a seq: both belong to the
    // messages deleted below, and a pin left behind named a line nobody
    // could read. The pins go first, while the messages they name exist.
    db.prepare(
      `DELETE FROM campaign_pins WHERE campaign_id = ?
         AND message_id IN (SELECT id FROM campaign_messages WHERE campaign_id = ? AND seq > ?)`,
    ).run(campaignId, campaignId, boundary);
    for (const table of [
      "campaign_messages",
      "campaign_events",
      "campaign_notes",
      "character_events",
      "sheet_audit",
      "item_proposals",
      "dm_beats",
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
    const owns = db.prepare(`SELECT 1 FROM character_sheets WHERE user_id = ? LIMIT 1`);
    for (const userId of botsBefore) {
      if (!owns.get(userId)) {
        deleteCompanionUser(userId);
      }
    }
  })();

  deleteBoundarySnapshotsAfter(campaignId, targetChapterIndex);
  resetChapterMemory(campaignId);
  setDmStatus(campaignId, "idle");

  const seq = allocateSeq(campaignId);
  const divider = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "cue-bell",
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
