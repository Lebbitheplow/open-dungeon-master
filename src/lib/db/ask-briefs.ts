import { getDatabase, nowIso } from "@/lib/db/core";
import type { ArmedBrief } from "@/lib/dm/ask-brief-logic";

// One armed Ask brief per player per campaign. Arming again replaces rather
// than queueing, for the same reason director_arms does: this is a "next turn
// only" note, and a queue of them would fire on turns the player had stopped
// thinking about.

export type StoredAskBrief = ArmedBrief & {
  campaignId: string;
  userId: string;
  armedAt: string;
};

type BriefRow = {
  campaign_id: string;
  user_id: string;
  text: string;
  visibility: "private" | "table";
  author_name: string;
  armed_at: string;
};

function mapBrief(row: BriefRow): StoredAskBrief {
  return {
    campaignId: row.campaign_id,
    userId: row.user_id,
    text: row.text,
    visibility: row.visibility,
    authorName: row.author_name,
    armedAt: row.armed_at,
  };
}

export function getAskBrief(campaignId: string, userId: string): StoredAskBrief | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM ask_briefs WHERE campaign_id = ? AND user_id = ?`)
    .get(campaignId, userId) as BriefRow | undefined;
  return row ? mapBrief(row) : null;
}

export function setAskBrief(input: {
  campaignId: string;
  userId: string;
  text: string;
  visibility: "private" | "table";
  authorName: string;
}): StoredAskBrief {
  const armedAt = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO ask_briefs (campaign_id, user_id, text, visibility, author_name, armed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, user_id) DO UPDATE SET
          text = excluded.text,
          visibility = excluded.visibility,
          author_name = excluded.author_name,
          armed_at = excluded.armed_at
      `,
    )
    .run(
      input.campaignId,
      input.userId,
      input.text,
      input.visibility,
      input.authorName,
      armedAt,
    );
  return { ...input, armedAt };
}

export function clearAskBrief(campaignId: string, userId: string) {
  getDatabase()
    .prepare(`DELETE FROM ask_briefs WHERE campaign_id = ? AND user_id = ?`)
    .run(campaignId, userId);
}

// Reads and deletes every armed brief in one statement, so two turns racing
// for the same brief cannot both fire it. Oldest first, so the DM reads notes
// in the order the players armed them.
export function takeAskBriefs(campaignId: string): StoredAskBrief[] {
  const rows = getDatabase()
    .prepare(`DELETE FROM ask_briefs WHERE campaign_id = ? RETURNING *`)
    .all(campaignId) as BriefRow[];
  return rows
    .map(mapBrief)
    .sort((a, b) => a.armedAt.localeCompare(b.armedAt));
}
