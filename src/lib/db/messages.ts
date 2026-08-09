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
  // Narration rerolls: every prose variant of this message the lead has
  // generated, oldest first, with variants[0] the prose originally published.
  // Absent until the first reroll; content always mirrors the selected entry.
  variants?: string[];
  variantIndex?: number;
  // The dm_turns row this message came from, serving two features. On a DM
  // narration it is the turn a reroll replays the stored conversation of. On
  // the "DM ran into a problem" system notice it is the turn the lead can
  // retry, and it is cleared the moment a retry is claimed, which is what
  // makes the banner disappear for every client at once. Absent on messages
  // written before either feature existed.
  dmTurnId?: string;
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
  variants_json: string | null;
  variant_index: number | null;
  dm_turn_id: string | null;
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
    variants: parseJson<string[] | undefined>(row.variants_json, undefined),
    variantIndex: row.variant_index ?? undefined,
    dmTurnId: row.dm_turn_id ?? undefined,
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
  dmTurnId?: string;
}): CampaignMessage {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO campaign_messages (
          id, campaign_id, seq, author_type, user_id, character_id, content,
          image_request_json, location_id, dm_turn_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.dmTurnId ?? null,
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

// Retry claim: drops a halted notice's link to its DM turn so the retry
// banner stops being offered. Conditional on the turn id, so it doubles as a
// second guard against two leads retrying the same turn (better-sqlite3 is
// synchronous, so only one caller can see changes > 0). The caller publishes
// message_updated.
export function clearMessageDmTurn(messageId: string, dmTurnId: string): CampaignMessage | null {
  const result = getDatabase()
    .prepare(`UPDATE campaign_messages SET dm_turn_id = NULL WHERE id = ? AND dm_turn_id = ?`)
    .run(messageId, dmTurnId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

// The halted notice pointing at a turn, if it is still offering a retry.
export function findMessageForDmTurn(dmTurnId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE dm_turn_id = ? ORDER BY seq DESC LIMIT 1`)
    .get(dmTurnId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// Lore-check accept: replaces a message's text in place (the lead applying
// an approved consistency rewrite). The caller publishes message_updated.
export function updateMessageContent(messageId: string, content: string): CampaignMessage | null {
  const result = getDatabase()
    .prepare(
      // Clearing the reroll takes keeps content === variants[variant_index]:
      // an accepted rewrite supersedes every take, and browsing back to one
      // afterwards would silently undo the fix.
      `UPDATE campaign_messages SET content = ?, variants_json = NULL, variant_index = NULL WHERE id = ?`,
    )
    .run(content, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

// The newest DM narration in the campaign. Rerolls are offered on this
// message only: an older one has already been read, reacted to, and built on.
export function getLatestDmMessage(campaignId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' ORDER BY seq DESC LIMIT 1`,
    )
    .get(campaignId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// Narration reroll: stores the variant set and which one stands, keeping
// content in sync with the selection in one statement so no reader can see
// a message whose text disagrees with its own variant index.
export function setMessageVariants(
  messageId: string,
  variants: string[],
  index: number,
): CampaignMessage | null {
  const selected = variants[index];
  if (selected === undefined) {
    return null;
  }
  const result = getDatabase()
    .prepare(
      `UPDATE campaign_messages SET variants_json = ?, variant_index = ?, content = ? WHERE id = ?`,
    )
    .run(JSON.stringify(variants), index, selected, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}
