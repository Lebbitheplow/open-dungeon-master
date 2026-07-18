import { getDatabase, nowIso, parseJson } from "@/lib/db/core";

export type UserAvatar = {
  url: string;
};

export type User = {
  id: string;
  username: string;
  avatar: UserAvatar | null;
  createdAt: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
};

// Password hash sentinel for accounts created through Discord sign-in. It can
// never match verifyPassword's `${salt}$${hash}` shape, so local login fails
// closed until an admin reset gives the account a real password.
export const NO_PASSWORD_SENTINEL = "!";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  avatar_json: string | null;
  created_at: string;
  is_admin: number;
  must_change_password: number;
};

const USER_COLUMNS =
  "id, username, password_hash, avatar_json, created_at, is_admin, must_change_password";

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    avatar: parseJson<UserAvatar | null>(row.avatar_json, null),
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function createUser(
  username: string,
  passwordHash: string,
  options?: { isAdmin?: boolean },
): User {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const isAdmin = options?.isAdmin ?? false;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, username, passwordHash, nowIso(), isAdmin ? 1 : 0);
  return {
    id,
    username,
    avatar: null,
    createdAt: nowIso(),
    isAdmin,
    mustChangePassword: false,
  };
}

export function getUserByUsername(username: string): (User & { passwordHash: string }) | null {
  const row = getDatabase()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`)
    .get(username) as UserRow | undefined;
  return row ? { ...mapUser(row), passwordHash: row.password_hash } : null;
}

export function getUserById(userId: string): User | null {
  const row = getDatabase()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function setUserAvatar(userId: string, avatar: UserAvatar | null) {
  getDatabase()
    .prepare(`UPDATE users SET avatar_json = ? WHERE id = ?`)
    .run(avatar ? JSON.stringify(avatar) : null, userId);
}

export function countUsers(): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  return row.n;
}

export function countAdmins(): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin = 1`)
    .get() as { n: number };
  return row.n;
}

export type AdminUserSummary = User & {
  hasDiscord: boolean;
  hasPassword: boolean;
  campaignCount: number;
};

export function listUsers(): AdminUserSummary[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT ${USER_COLUMNS}, discord_id,
          (SELECT COUNT(*) FROM campaign_members m WHERE m.user_id = users.id) AS campaign_count
        FROM users
        ORDER BY created_at ASC
      `,
    )
    .all() as Array<UserRow & { discord_id: string | null; campaign_count: number }>;
  return rows.map((row) => ({
    ...mapUser(row),
    hasDiscord: row.discord_id !== null,
    hasPassword: row.password_hash !== NO_PASSWORD_SENTINEL,
    campaignCount: row.campaign_count,
  }));
}

export function setUserPassword(userId: string, passwordHash: string, mustChange: boolean) {
  getDatabase()
    .prepare(`UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?`)
    .run(passwordHash, mustChange ? 1 : 0, userId);
}

export function setUserAdmin(userId: string, isAdmin: boolean) {
  getDatabase()
    .prepare(`UPDATE users SET is_admin = ? WHERE id = ?`)
    .run(isAdmin ? 1 : 0, userId);
}

export function getUserByDiscordId(discordId: string): User | null {
  const row = getDatabase()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE discord_id = ?`)
    .get(discordId) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function getUserDiscordId(userId: string): string | null {
  const row = getDatabase()
    .prepare(`SELECT discord_id FROM users WHERE id = ?`)
    .get(userId) as { discord_id: string | null } | undefined;
  return row?.discord_id ?? null;
}

export function linkDiscordId(userId: string, discordId: string | null) {
  getDatabase().prepare(`UPDATE users SET discord_id = ? WHERE id = ?`).run(discordId, userId);
}

export function createDiscordUser(username: string, discordId: string): User {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, discord_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, username, NO_PASSWORD_SENTINEL, nowIso(), discordId);
  return {
    id,
    username,
    avatar: null,
    createdAt: nowIso(),
    isAdmin: false,
    mustChangePassword: false,
  };
}

export function insertSession(tokenHash: string, userId: string, expiresAt: string) {
  getDatabase()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
    .run(tokenHash, userId, nowIso(), expiresAt);
}

export function getSessionUser(tokenHash: string): User | null {
  const db = getDatabase();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(nowIso());
  const row = db
    .prepare(
      `
        SELECT u.id, u.username, u.password_hash, u.avatar_json, u.created_at,
          u.is_admin, u.must_change_password
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at >= ?
      `,
    )
    .get(tokenHash, nowIso()) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function deleteSession(tokenHash: string) {
  getDatabase().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}

export function deleteSessionsForUser(userId: string, exceptTokenHash?: string) {
  if (exceptTokenHash) {
    getDatabase()
      .prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`)
      .run(userId, exceptTokenHash);
  } else {
    getDatabase().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }
}

// Deletes a user and everything they own. campaigns.owner_user_id has an FK
// with no cascade, so owned campaigns must go first or the user delete
// throws. Transcript references (campaign_messages.user_id, rolls,
// sheet_audit) are plain TEXT columns and stay behind as history.
export function deleteUserCascade(userId: string) {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(`DELETE FROM campaigns WHERE owner_user_id = ?`).run(userId);
    db.prepare(`UPDATE campaigns SET party_lead_user_id = NULL WHERE party_lead_user_id = ?`).run(
      userId,
    );
    db.prepare(`DELETE FROM pending_rolls WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  })();
}
