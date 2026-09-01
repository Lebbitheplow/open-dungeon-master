import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db/core";

// The inbox behind the bell. Rows are cheap prose pointers ("a session was
// scheduled"), never the source of truth for anything; the schedule tables
// hold the facts. Capped per user so an active server cannot grow a
// bottomless table nobody reads.

export type Notification = {
  id: string;
  userId: string;
  campaignId: string;
  kind: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationRow = {
  id: string;
  user_id: string;
  campaign_id: string;
  kind: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const KEEP_PER_USER = 200;

function mapRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export function notifyUsers(
  userIds: string[],
  input: { campaignId?: string; kind: string; body: string },
): void {
  if (userIds.length === 0) {
    return;
  }
  const db = getDatabase();
  const insert = db.prepare(
    `INSERT INTO notifications (id, user_id, campaign_id, kind, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const prune = db.prepare(
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
       SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
     )`,
  );
  const all = db.transaction((ids: string[]) => {
    for (const userId of ids) {
      insert.run(randomUUID(), userId, input.campaignId ?? "", input.kind, input.body, nowIso());
      prune.run(userId, userId, KEEP_PER_USER);
    }
  });
  all(userIds);
}

export function listNotifications(userId: string, limit = 50): Notification[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, Math.max(1, Math.min(200, limit))) as NotificationRow[];
  return rows.map(mapRow);
}

export function unreadCount(userId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`)
    .get(userId) as { n: number };
  return row.n;
}

// One id marks one; no id marks the whole inbox read.
export function markNotificationsRead(userId: string, id?: string): void {
  if (id) {
    getDatabase()
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ?`)
      .run(nowIso(), userId, id);
    return;
  }
  getDatabase()
    .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
    .run(nowIso(), userId);
}
