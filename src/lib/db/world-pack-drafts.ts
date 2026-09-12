import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { blankDraft, worldPackDraftSchema, type WorldPackDraft } from "@/lib/worlds/draft";

// The one world pack draft a workshop holds, as a JSON column keyed by the
// workshop. One per workshop rather than many: a workshop is one world's
// prep, and a second pack is a second workshop, which Duplicate already
// makes. The row cascades with the campaign row, so a deleted workshop
// takes its draft with it and nothing here needs a teardown.

type DraftRow = { draft_json: string; updated_at: string };

export type StoredDraft = { draft: WorldPackDraft; updatedAt: string | null };

// A draft that fails its own schema (an older build's column, a hand edit)
// is replaced with a blank one rather than crashing the panel; the person
// sees an empty creator, which is honest about what could be read.
export function getPackDraft(campaignId: string, genre?: WorldPackDraft["baseGenre"]): StoredDraft {
  const row = getDatabase()
    .prepare(`SELECT draft_json, updated_at FROM world_pack_drafts WHERE campaign_id = ?`)
    .get(campaignId) as DraftRow | undefined;
  if (!row) {
    return { draft: blankDraft(genre), updatedAt: null };
  }
  const parsed = worldPackDraftSchema.safeParse(parseJson<unknown>(row.draft_json, {}));
  return { draft: parsed.success ? parsed.data : blankDraft(genre), updatedAt: row.updated_at };
}

export function hasPackDraft(campaignId: string): boolean {
  return Boolean(
    getDatabase().prepare(`SELECT 1 FROM world_pack_drafts WHERE campaign_id = ?`).get(campaignId),
  );
}

export function savePackDraft(campaignId: string, draft: WorldPackDraft): StoredDraft {
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO world_pack_drafts (campaign_id, draft_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(campaign_id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
    )
    .run(campaignId, JSON.stringify(draft), now);
  return { draft, updatedAt: now };
}

export function deletePackDraft(campaignId: string): boolean {
  return getDatabase().prepare(`DELETE FROM world_pack_drafts WHERE campaign_id = ?`).run(campaignId).changes > 0;
}

// For Duplicate: the copy gets the draft as it stands, art included.
export function copyPackDraft(sourceId: string, targetId: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT draft_json FROM world_pack_drafts WHERE campaign_id = ?`)
    .get(sourceId) as { draft_json: string } | undefined;
  if (!row) {
    return false;
  }
  getDatabase()
    .prepare(`INSERT OR REPLACE INTO world_pack_drafts (campaign_id, draft_json, updated_at) VALUES (?, ?, ?)`)
    .run(targetId, row.draft_json, nowIso());
  return true;
}
