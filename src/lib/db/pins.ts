import { getDatabase, nowIso } from "@/lib/db/core";
import type { Pin } from "@/lib/dm/pin-logic";

// Pinned excerpts, one table per campaign. Deliberately not scoped per user:
// a pin changes what the DM is told, so it is table-wide canon rather than a
// personal bookmark, and every member can see and unpin one.

type PinRow = {
  id: string;
  campaign_id: string;
  message_id: string;
  text: string;
  is_full_message: number;
  pinned_by_user_id: string;
  created_at: string;
};

function mapPin(row: PinRow): Pin & { pinnedByUserId: string } {
  return {
    id: row.id,
    messageId: row.message_id,
    text: row.text,
    isFullMessage: row.is_full_message === 1,
    pinnedByUserId: row.pinned_by_user_id,
    createdAt: row.created_at,
  };
}

// Oldest first, which is the order they ride in the prompt: the table pinned
// them in that order and a stable order keeps the block cacheable.
export function listPins(campaignId: string): Array<Pin & { pinnedByUserId: string }> {
  return (
    getDatabase()
      .prepare(`SELECT * FROM campaign_pins WHERE campaign_id = ? ORDER BY created_at, id`)
      .all(campaignId) as PinRow[]
  ).map(mapPin);
}

export function createPin(input: {
  campaignId: string;
  messageId: string;
  text: string;
  isFullMessage: boolean;
  pinnedByUserId: string;
}): Pin & { pinnedByUserId: string } {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO campaign_pins (
          id, campaign_id, message_id, text, is_full_message, pinned_by_user_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.messageId,
      input.text,
      input.isFullMessage ? 1 : 0,
      input.pinnedByUserId,
      now,
    );
  return {
    id,
    messageId: input.messageId,
    text: input.text,
    isFullMessage: input.isFullMessage,
    pinnedByUserId: input.pinnedByUserId,
    createdAt: now,
  };
}

export function deletePin(campaignId: string, pinId: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM campaign_pins WHERE id = ? AND campaign_id = ?`)
    .run(pinId, campaignId);
  return result.changes > 0;
}
