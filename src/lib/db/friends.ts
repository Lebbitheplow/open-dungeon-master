import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { contactBlocked } from "@/lib/db/moderation";
import { getUserByUsername, isCompanionUserId, type UserAvatar } from "@/lib/db/users";

// Per-server friendships over the friends table (schema note in core.ts):
// one row per pair, requester in user_id, and accepting flips 'pending' to
// 'accepted' in place. Companions are unloginable sheet owners, never
// people, so they can neither send nor receive requests.

export type FriendEntry = {
  userId: string;
  username: string;
  avatar: UserAvatar | null;
  // Friendship start for accepted rows, request time for pending ones.
  since: string;
};

export type SendRequestResult = {
  // "requested" made a pending row; "accepted" found the reverse pending
  // request and completed the handshake; "noop" changed nothing (unknown
  // name, self, companion, or an edge that already exists). The API route
  // answers "Request sent." to all three so usernames cannot be probed;
  // this split exists only so it knows who to notify.
  outcome: "requested" | "accepted" | "noop";
  targetUserId: string | null;
};

export function sendRequest(userId: string, username: string): SendRequestResult {
  const target = getUserByUsername(username.trim());
  if (!target || target.id === userId || isCompanionUserId(target.id)) {
    return { outcome: "noop", targetUserId: null };
  }
  // Same silent answer as an unknown name: a block must not be probeable.
  if (contactBlocked(userId, target.id)) {
    return { outcome: "noop", targetUserId: null };
  }
  const db = getDatabase();
  const existing = db
    .prepare(
      `SELECT user_id, status FROM friends
       WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)`,
    )
    .get(userId, target.id, target.id, userId) as
    | { user_id: string; status: string }
    | undefined;
  if (existing) {
    // Asking back is an answer: their pending request becomes the
    // friendship. Any other existing edge means there is nothing to add.
    if (existing.status === "pending" && existing.user_id === target.id) {
      db.prepare(
        `UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_user_id = ?`,
      ).run(target.id, userId);
      return { outcome: "accepted", targetUserId: target.id };
    }
    return { outcome: "noop", targetUserId: target.id };
  }
  db.prepare(
    `INSERT INTO friends (user_id, friend_user_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
  ).run(userId, target.id, nowIso());
  return { outcome: "requested", targetUserId: target.id };
}

export function acceptRequest(userId: string, requesterUserId: string): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE friends SET status = 'accepted'
       WHERE user_id = ? AND friend_user_id = ? AND status = 'pending'`,
    )
    .run(requesterUserId, userId);
  return result.changes > 0;
}

// One remover for declining a request, withdrawing one, and unfriending:
// all three mean "no edge between us", whichever way the row points.
export function declineOrRemove(userId: string, otherUserId: string): boolean {
  const result = getDatabase()
    .prepare(
      `DELETE FROM friends
       WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)`,
    )
    .run(userId, otherUserId, otherUserId, userId);
  return result.changes > 0;
}

export function areFriends(userId: string, otherUserId: string): boolean {
  const row = getDatabase()
    .prepare(
      `SELECT 1 FROM friends
       WHERE status = 'accepted'
         AND ((user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?))`,
    )
    .get(userId, otherUserId, otherUserId, userId);
  return row !== undefined;
}

type EdgeRow = {
  other_id: string;
  username: string;
  avatar_json: string | null;
  created_at: string;
};

function mapEdge(row: EdgeRow): FriendEntry {
  return {
    userId: row.other_id,
    username: row.username,
    avatar: parseJson<UserAvatar | null>(row.avatar_json, null),
    since: row.created_at,
  };
}

export function listFriends(userId: string): FriendEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT CASE WHEN f.user_id = ? THEN f.friend_user_id ELSE f.user_id END AS other_id,
              u.username, u.avatar_json, f.created_at
       FROM friends f
       JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_user_id ELSE f.user_id END
       WHERE f.status = 'accepted' AND (f.user_id = ? OR f.friend_user_id = ?)
       ORDER BY u.username COLLATE NOCASE ASC`,
    )
    .all(userId, userId, userId, userId) as EdgeRow[];
  return rows.map(mapEdge);
}

export function listPendingIncoming(userId: string): FriendEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT f.user_id AS other_id, u.username, u.avatar_json, f.created_at
       FROM friends f
       JOIN users u ON u.id = f.user_id
       WHERE f.status = 'pending' AND f.friend_user_id = ?
       ORDER BY f.created_at DESC`,
    )
    .all(userId) as EdgeRow[];
  return rows.map(mapEdge);
}

export function listPendingOutgoing(userId: string): FriendEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT f.friend_user_id AS other_id, u.username, u.avatar_json, f.created_at
       FROM friends f
       JOIN users u ON u.id = f.friend_user_id
       WHERE f.status = 'pending' AND f.user_id = ?
       ORDER BY f.created_at DESC`,
    )
    .all(userId) as EdgeRow[];
  return rows.map(mapEdge);
}
