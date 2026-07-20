import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { touchCampaign } from "@/lib/db/campaigns";
import type { GeneratedImage, ImageRequest } from "@/lib/types";

export type CampaignMessage = {
  id: string;
  campaignId: string;
  seq: number;
  authorType: "player" | "dm" | "system";
  userId: string | null;
  characterId: string | null;
  content: string;
  imageRequest?: ImageRequest;
  generatedImage?: GeneratedImage;
  // Set on DM messages that moved the party somewhere new; the chat renders
  // that location's map inline (the map itself lives on the locations row).
  locationId?: string;
  createdAt: string;
};

type MessageRow = {
  id: string;
  campaign_id: string;
  seq: number;
  author_type: "player" | "dm" | "system";
  user_id: string | null;
  character_id: string | null;
  content: string;
  image_request_json: string | null;
  generated_image_json: string | null;
  location_id: string | null;
  created_at: string;
};

function mapMessage(row: MessageRow): CampaignMessage {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    seq: row.seq,
    authorType: row.author_type,
    userId: row.user_id,
    characterId: row.character_id,
    content: row.content,
    imageRequest: parseJson<ImageRequest | undefined>(row.image_request_json, undefined),
    generatedImage: parseJson<GeneratedImage | undefined>(row.generated_image_json, undefined),
    locationId: row.location_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function insertCampaignMessage(input: {
  campaignId: string;
  seq: number;
  authorType: "player" | "dm" | "system";
  userId?: string | null;
  characterId?: string | null;
  content: string;
  imageRequest?: ImageRequest;
  locationId?: string;
}): CampaignMessage {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO campaign_messages (
          id, campaign_id, seq, author_type, user_id, character_id, content,
          image_request_json, location_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.seq,
      input.authorType,
      input.userId ?? null,
      input.characterId ?? null,
      input.content,
      input.imageRequest ? JSON.stringify(input.imageRequest) : null,
      input.locationId ?? null,
      nowIso(),
    );
  touchCampaign(input.campaignId);

  const message = getCampaignMessage(id);
  if (!message) {
    throw new Error("Failed to insert campaign message.");
  }
  return message;
}

export function getCampaignMessage(messageId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE id = ?`)
    .get(messageId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// Messages inside a seq span (chapter transcripts), ascending.
export function listMessagesInSeqRange(
  campaignId: string,
  seqStart: number,
  seqEnd: number,
): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM campaign_messages WHERE campaign_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC`,
    )
    .all(campaignId, seqStart, seqEnd) as MessageRow[];
  return rows.map(mapMessage);
}

// How many messages exist at or below a seq (compaction watermark resets).
export function countMessagesUpToSeq(campaignId: string, seq: number): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ? AND seq <= ?`)
    .get(campaignId, seq) as { n: number };
  return row.n;
}

// Most recent `limit` messages in ascending seq order.
export function listRecentMessages(campaignId: string, limit = 100): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM (
          SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq DESC LIMIT ?
        ) ORDER BY seq ASC
      `,
    )
    .all(campaignId, limit) as MessageRow[];
  return rows.map(mapMessage);
}

export function listAllMessages(campaignId: string): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq ASC`)
    .all(campaignId) as MessageRow[];
  return rows.map(mapMessage);
}

// A window of the seq-ascending transcript: offset is an index into that
// ordering, matching the compaction engine's coveredCount semantics.
export function listMessagesPage(
  campaignId: string,
  offset: number,
  limit: number,
): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?`,
    )
    .all(campaignId, limit, offset) as MessageRow[];
  return rows.map(mapMessage);
}

export function countMessages(campaignId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM campaign_messages WHERE campaign_id = ?`)
    .get(campaignId) as { count: number };
  return row.count;
}

export function setMessageGeneratedImage(messageId: string, image: GeneratedImage) {
  const result = getDatabase()
    .prepare(`UPDATE campaign_messages SET generated_image_json = ? WHERE id = ?`)
    .run(JSON.stringify(image), messageId);
  return result.changes > 0;
}
