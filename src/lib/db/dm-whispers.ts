import { getDatabase, nowIso } from "@/lib/db/core";

// Private line between the AI DM and individual players. 'to_player' rows
// are DM-sent (send_whisper tool); 'to_dm' rows are players privately
// messaging the DM (e.g. slipping away from the group). Player whispers are
// consumed by the next coalesced DM turn, so the DM never tracks parallel
// side conversations. Content stays out of the shared SSE stream: sends
// publish only a contentless ephemeral "whisper_activity" event and each
// recipient fetches their own rows. Unlike side-chat, DM code MAY import
// this module; the DM is a party to every row.

export type WhisperDirection = "to_player" | "to_dm";

export type DmWhisper = {
  id: string;
  groupId: string;
  characterId: string | null;
  content: string;
  read: boolean;
  createdAt: string;
  direction: WhisperDirection;
  // For 'to_dm' rows: whether a DM turn has consumed this whisper yet.
  answered: boolean;
  // Character names of everyone the same send went to, so the UI can show
  // "also sent to Kara".
  recipientNames: string[];
};

type WhisperRow = {
  id: string;
  group_id: string;
  character_id: string | null;
  content: string;
  read: number;
  created_at: string;
  direction: WhisperDirection;
  answered_turn_id: string | null;
};

export type WhisperRecipient = {
  userId: string;
  characterId: string;
  characterName: string;
};

export function insertWhisper(
  campaignId: string,
  turnId: string | null,
  recipients: WhisperRecipient[],
  content: string,
): string {
  const db = getDatabase();
  const groupId = crypto.randomUUID();
  const now = nowIso();
  db.transaction(() => {
    for (const recipient of recipients) {
      db.prepare(
        `INSERT INTO dm_whispers (id, campaign_id, turn_id, group_id, user_id, character_id, content, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        crypto.randomUUID(),
        campaignId,
        turnId,
        groupId,
        recipient.userId,
        recipient.characterId,
        content,
        now,
      );
    }
  })();
  return groupId;
}

// A player's private message to the DM. group_id is the row's own id (no
// fan-out) and read is 1: the sender authored it, so the unread badge only
// counts DM-sent rows.
export function insertPlayerWhisper(
  campaignId: string,
  userId: string,
  characterId: string,
  content: string,
): string {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO dm_whispers (id, campaign_id, turn_id, group_id, user_id, character_id, content, read, created_at, direction)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 1, ?, 'to_dm')`,
    )
    .run(id, campaignId, id, userId, characterId, content, nowIso());
  return id;
}

export type PendingPlayerWhisper = {
  id: string;
  userId: string;
  characterId: string | null;
  characterName: string;
  content: string;
  createdAt: string;
};

// Player whispers no DM turn has consumed yet, oldest first. These feed the
// next turn's prompt and defeat the "nothing new" turn skip.
export function listPendingPlayerWhispers(campaignId: string): PendingPlayerWhisper[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT w.id, w.user_id, w.character_id, w.content, w.created_at,
          COALESCE(s.name, 'Unknown') AS name
        FROM dm_whispers w
        LEFT JOIN character_sheets s ON s.id = w.character_id
        WHERE w.campaign_id = ? AND w.direction = 'to_dm' AND w.answered_turn_id IS NULL
        ORDER BY w.created_at ASC, w.id ASC
      `,
    )
    .all(campaignId) as Array<{
    id: string;
    user_id: string;
    character_id: string | null;
    content: string;
    created_at: string;
    name: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    characterId: row.character_id,
    characterName: row.name,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export function countPendingPlayerWhispers(campaignId: string, userId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS n FROM dm_whispers
       WHERE campaign_id = ? AND user_id = ? AND direction = 'to_dm' AND answered_turn_id IS NULL`,
    )
    .get(campaignId, userId) as { n: number };
  return row.n;
}

export function markPlayerWhispersAnswered(ids: string[], turnId: string) {
  if (!ids.length) {
    return;
  }
  const db = getDatabase();
  const stmt = db.prepare(
    `UPDATE dm_whispers SET answered_turn_id = ? WHERE id = ? AND direction = 'to_dm'`,
  );
  db.transaction(() => {
    for (const id of ids) {
      stmt.run(turnId, id);
    }
  })();
}

// The caller's own whispers in both directions, oldest first. Recipient
// names come from the campaign sheets of every row sharing the group_id.
export function listWhispersForUser(
  campaignId: string,
  userId: string,
  limit = 100,
): DmWhisper[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
        SELECT id, group_id, character_id, content, read, created_at, direction, answered_turn_id
        FROM dm_whispers WHERE campaign_id = ? AND user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
      `,
    )
    .all(campaignId, userId, limit) as WhisperRow[];
  const names = db
    .prepare(
      `
        SELECT w.group_id, COALESCE(s.name, '') AS name
        FROM dm_whispers w
        LEFT JOIN character_sheets s ON s.id = w.character_id
        WHERE w.campaign_id = ?
      `,
    )
    .all(campaignId) as Array<{ group_id: string; name: string }>;
  const namesByGroup = new Map<string, string[]>();
  for (const entry of names) {
    if (!entry.name) {
      continue;
    }
    const list = namesByGroup.get(entry.group_id) ?? [];
    list.push(entry.name);
    namesByGroup.set(entry.group_id, list);
  }
  return rows.reverse().map((row) => ({
    id: row.id,
    groupId: row.group_id,
    characterId: row.character_id,
    content: row.content,
    read: row.read === 1,
    createdAt: row.created_at,
    direction: row.direction ?? "to_player",
    answered: row.answered_turn_id !== null,
    recipientNames: namesByGroup.get(row.group_id) ?? [],
  }));
}

export function countUnreadWhispers(campaignId: string, userId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS n FROM dm_whispers WHERE campaign_id = ? AND user_id = ? AND read = 0 AND direction = 'to_player'`,
    )
    .get(campaignId, userId) as { n: number };
  return row.n;
}

export function markWhispersRead(campaignId: string, userId: string) {
  getDatabase()
    .prepare(
      `UPDATE dm_whispers SET read = 1 WHERE campaign_id = ? AND user_id = ? AND read = 0 AND direction = 'to_player'`,
    )
    .run(campaignId, userId);
}

// Recent sends for the DM prompt so the model remembers what it already
// whispered (it authored them; players' reads are irrelevant here).
export function listRecentWhispersForPrompt(
  campaignId: string,
  limit = 10,
): Array<{ to: string; content: string }> {
  const rows = getDatabase()
    .prepare(
      `
        SELECT w.group_id, w.content, MIN(w.created_at) AS created_at,
          GROUP_CONCAT(COALESCE(s.name, 'unknown'), ', ') AS names
        FROM dm_whispers w
        LEFT JOIN character_sheets s ON s.id = w.character_id
        WHERE w.campaign_id = ? AND w.direction = 'to_player'
        GROUP BY w.group_id
        ORDER BY created_at DESC LIMIT ?
      `,
    )
    .all(campaignId, limit) as Array<{ content: string; names: string }>;
  return rows
    .reverse()
    .map((row) => ({ to: row.names, content: row.content.slice(0, 200) }));
}
