import { getDatabase, nowIso } from "@/lib/db/core";
import type { BeatKind, BeatSource } from "@/lib/dm/beat-logic";

// DM beats: the story a person told at the table and then wrote down.
//
// The text itself lives in campaign_messages, which is what every memory
// engine reads (see the dm_beats comment in core.ts). These rows are the
// provenance around it.

export type DmBeat = {
  id: string;
  campaignId: string;
  seq: number;
  messageId: string;
  authorUserId: string;
  kind: BeatKind;
  source: BeatSource;
  body: string;
  createdAt: string;
};

type BeatRow = {
  id: string;
  campaign_id: string;
  seq: number;
  message_id: string;
  author_user_id: string;
  kind: BeatKind;
  source: BeatSource;
  body: string;
  created_at: string;
};

function mapBeat(row: BeatRow): DmBeat {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    seq: row.seq,
    messageId: row.message_id,
    authorUserId: row.author_user_id,
    kind: row.kind,
    source: row.source,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function insertDmBeat(input: {
  campaignId: string;
  seq: number;
  messageId: string;
  authorUserId: string;
  kind: BeatKind;
  source: BeatSource;
  body: string;
}): DmBeat {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO dm_beats (
          id, campaign_id, seq, message_id, author_user_id, kind, source, body, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.seq,
      input.messageId,
      input.authorUserId,
      input.kind,
      input.source,
      input.body,
      nowIso(),
    );
  return getDmBeat(id)!;
}

export function getDmBeat(beatId: string): DmBeat | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM dm_beats WHERE id = ?`)
    .get(beatId) as BeatRow | undefined;
  return row ? mapBeat(row) : null;
}

// Most recent first: the console shows the last few, newest at the top.
export function listDmBeats(campaignId: string, limit = 20): DmBeat[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM dm_beats WHERE campaign_id = ? ORDER BY seq DESC LIMIT ?`)
    .all(campaignId, limit) as BeatRow[];
  return rows.map(mapBeat);
}

export function latestDmBeat(campaignId: string): DmBeat | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM dm_beats WHERE campaign_id = ? ORDER BY seq DESC LIMIT 1`)
    .get(campaignId) as BeatRow | undefined;
  return row ? mapBeat(row) : null;
}
