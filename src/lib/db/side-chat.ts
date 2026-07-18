import { getDatabase, nowIso } from "@/lib/db/core";

// Private player-to-player side chats: 1:1 "dm" threads (idempotent per user
// pair via dm_key) and named "group" threads.
//
// PRIVACY: these tables are for the players in a thread only. Content must
// never reach the AI DM prompt (nothing in src/lib/dm may import this
// module) and must never ride the campaign SSE stream, whose persisted
// events any member can replay. Sends publish only a contentless ephemeral
// "side_activity" event; each recipient re-fetches their own threads.

export type SideThreadKind = "dm" | "group";

export type SideThread = {
  id: string;
  campaignId: string;
  kind: SideThreadKind;
  title: string;
  createdBy: string;
  memberUserIds: string[];
  lastSeq: number;
  unread: number;
  updatedAt: string;
};

export type SideMessage = {
  id: string;
  threadId: string;
  authorUserId: string;
  seq: number;
  content: string;
  createdAt: string;
};

type ThreadRow = {
  id: string;
  campaign_id: string;
  kind: SideThreadKind;
  title: string;
  created_by: string;
  next_seq: number;
  updated_at: string;
  last_read_seq: number;
};

type MessageRow = {
  id: string;
  thread_id: string;
  author_user_id: string;
  seq: number;
  content: string;
  created_at: string;
};

function mapMessage(row: MessageRow): SideMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorUserId: row.author_user_id,
    seq: row.seq,
    content: row.content,
    createdAt: row.created_at,
  };
}

function threadMemberIds(threadId: string): string[] {
  const rows = getDatabase()
    .prepare(`SELECT user_id FROM side_thread_members WHERE thread_id = ? ORDER BY joined_at ASC`)
    .all(threadId) as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

function mapThread(row: ThreadRow): SideThread {
  const lastSeq = row.next_seq - 1;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    kind: row.kind,
    title: row.title,
    createdBy: row.created_by,
    memberUserIds: threadMemberIds(row.id),
    lastSeq,
    unread: Math.max(0, lastSeq - row.last_read_seq),
    updatedAt: row.updated_at,
  };
}

function insertMember(threadId: string, userId: string) {
  getDatabase()
    .prepare(
      `INSERT INTO side_thread_members (thread_id, user_id, last_read_seq, joined_at)
       VALUES (?, ?, 0, ?) ON CONFLICT (thread_id, user_id) DO NOTHING`,
    )
    .run(threadId, userId, nowIso());
}

// The 1:1 thread for a user pair, created on first use. The partial unique
// index on (campaign_id, dm_key) makes concurrent creates collapse to one.
export function getOrCreateDmThread(
  campaignId: string,
  userA: string,
  userB: string,
): SideThread {
  const db = getDatabase();
  const dmKey = [userA, userB].sort().join("|");
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO side_threads (id, campaign_id, kind, title, created_by, dm_key, next_seq, created_at, updated_at)
       VALUES (?, ?, 'dm', '', ?, ?, 1, ?, ?) ON CONFLICT DO NOTHING`,
    ).run(crypto.randomUUID(), campaignId, userA, dmKey, nowIso(), nowIso());
    const row = db
      .prepare(`SELECT id FROM side_threads WHERE campaign_id = ? AND dm_key = ?`)
      .get(campaignId, dmKey) as { id: string };
    insertMember(row.id, userA);
    insertMember(row.id, userB);
    const thread = getThreadForUser(row.id, userA);
    if (!thread) {
      throw new Error("side-chat: dm thread vanished mid-transaction");
    }
    return thread;
  })();
}

export function createGroupThread(
  campaignId: string,
  creatorId: string,
  memberIds: string[],
  title: string,
): SideThread {
  const db = getDatabase();
  return db.transaction(() => {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO side_threads (id, campaign_id, kind, title, created_by, dm_key, next_seq, created_at, updated_at)
       VALUES (?, ?, 'group', ?, ?, NULL, 1, ?, ?)`,
    ).run(id, campaignId, title, creatorId, nowIso(), nowIso());
    insertMember(id, creatorId);
    for (const memberId of memberIds) {
      insertMember(id, memberId);
    }
    const thread = getThreadForUser(id, creatorId);
    if (!thread) {
      throw new Error("side-chat: group thread vanished mid-transaction");
    }
    return thread;
  })();
}

// All threads the user belongs to in a campaign, most recently active first.
export function listThreadsForUser(campaignId: string, userId: string): SideThread[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT t.id, t.campaign_id, t.kind, t.title, t.created_by, t.next_seq,
          t.updated_at, m.last_read_seq
        FROM side_threads t
        JOIN side_thread_members m ON m.thread_id = t.id AND m.user_id = ?
        WHERE t.campaign_id = ?
        ORDER BY t.updated_at DESC
      `,
    )
    .all(userId, campaignId) as ThreadRow[];
  return rows.map(mapThread);
}

// Membership check and fetch in one; null when the user is not a member
// (routes should 404, never confirming the thread exists).
export function getThreadForUser(threadId: string, userId: string): SideThread | null {
  const row = getDatabase()
    .prepare(
      `
        SELECT t.id, t.campaign_id, t.kind, t.title, t.created_by, t.next_seq,
          t.updated_at, m.last_read_seq
        FROM side_threads t
        JOIN side_thread_members m ON m.thread_id = t.id AND m.user_id = ?
        WHERE t.id = ?
      `,
    )
    .get(userId, threadId) as ThreadRow | undefined;
  return row ? mapThread(row) : null;
}

export function listThreadMessages(threadId: string, afterSeq = 0, limit = 200): SideMessage[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT id, thread_id, author_user_id, seq, content, created_at
        FROM side_messages WHERE thread_id = ? AND seq > ?
        ORDER BY seq ASC LIMIT ?
      `,
    )
    .all(threadId, afterSeq, limit) as MessageRow[];
  return rows.map(mapMessage);
}

export function insertSideMessage(
  threadId: string,
  authorUserId: string,
  content: string,
): SideMessage {
  const db = getDatabase();
  return db.transaction(() => {
    const { seq } = db
      .prepare(`UPDATE side_threads SET next_seq = next_seq + 1, updated_at = ? WHERE id = ? RETURNING next_seq - 1 AS seq`)
      .get(nowIso(), threadId) as { seq: number };
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO side_messages (id, thread_id, author_user_id, seq, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, threadId, authorUserId, seq, content, createdAt);
    // The author has read their own message by definition.
    db.prepare(
      `UPDATE side_thread_members SET last_read_seq = MAX(last_read_seq, ?) WHERE thread_id = ? AND user_id = ?`,
    ).run(seq, threadId, authorUserId);
    return { id, threadId, authorUserId, seq, content, createdAt };
  })();
}

export function markThreadRead(threadId: string, userId: string, seq: number) {
  getDatabase()
    .prepare(
      `UPDATE side_thread_members SET last_read_seq = MAX(last_read_seq, ?) WHERE thread_id = ? AND user_id = ?`,
    )
    .run(seq, threadId, userId);
}

export function addGroupMember(threadId: string, userId: string) {
  insertMember(threadId, userId);
}

export function leaveThread(threadId: string, userId: string) {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(`DELETE FROM side_thread_members WHERE thread_id = ? AND user_id = ?`).run(
      threadId,
      userId,
    );
    const remaining = db
      .prepare(`SELECT COUNT(*) AS n FROM side_thread_members WHERE thread_id = ?`)
      .get(threadId) as { n: number };
    if (remaining.n === 0) {
      db.prepare(`DELETE FROM side_threads WHERE id = ?`).run(threadId);
    }
  })();
}
