import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { DiceLook } from "@/lib/dice/dice-look";
import { closeStreamsForSession, closeStreamsForUser } from "@/lib/live-streams";
import { mergeLedgers, parseLedger, type TourLedger } from "@/lib/tours/account-logic";
import { isTourId } from "@/lib/tours/registry";
import { asciiSlugOf } from "@/lib/language/text-logic";

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
  // Set while a self-service deletion is pending (src/lib/account-deletion.ts):
  // when it was asked for, and when the purge job may erase the account.
  deletionRequestedAt: string | null;
  deletionDueAt: string | null;
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
  deletion_requested_at: string | null;
  deletion_due_at: string | null;
};

const USER_COLUMNS =
  "id, username, password_hash, avatar_json, created_at, is_admin, must_change_password, " +
  "deletion_requested_at, deletion_due_at";

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    avatar: parseJson<UserAvatar | null>(row.avatar_json, null),
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
    deletionRequestedAt: row.deletion_requested_at,
    deletionDueAt: row.deletion_due_at,
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
    deletionRequestedAt: null,
    deletionDueAt: null,
  };
}

// Unloginable owner row for an AI companion sheet: character_sheets has a
// users FK plus UNIQUE(campaign_id, user_id), so every companion needs its
// own real user. The 'comp_' id prefix keeps them out of admin listings.
export function createCompanionUser(companionName: string): User {
  const db = getDatabase();
  const id = `comp_${crypto.randomUUID()}`;
  const username = ["companion", asciiSlugOf(companionName).slice(0, 24), id.slice(5, 13)].filter((part) => part !== "").join("-");
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 0)`,
  ).run(id, username, NO_PASSWORD_SENTINEL, nowIso());
  return {
    id,
    username,
    avatar: null,
    createdAt: nowIso(),
    isAdmin: false,
    mustChangePassword: false,
    deletionRequestedAt: null,
    deletionDueAt: null,
  };
}

export function isCompanionUserId(userId: string): boolean {
  return userId.startsWith("comp_");
}

export function deleteCompanionUser(userId: string) {
  if (!isCompanionUserId(userId)) {
    return;
  }
  getDatabase().prepare(`DELETE FROM users WHERE id = ?`).run(userId);
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

// Account preferences that follow the person between browsers. Absent keys
// mean "use the default", so a patch merges rather than replaces: a browser
// syncing its chime toggle must not erase the volumes another one saved.
export type UserSettings = {
  narrationVolume?: number;
  narrationMuted?: boolean;
  ambienceVolume?: number;
  ambienceMuted?: boolean;
  ambienceBedLevel?: number;
  ambienceMusicLevel?: number;
  chimeMuted?: boolean;
  // The player's virtual dice (src/lib/dice/dice-look.ts); absent means
  // the tray's original look.
  diceLook?: DiceLook;
  // The walkthroughs finished, by tour id (src/lib/tours/account-logic.ts).
  // Written only through recordFinishedTours, which merges per tour: the
  // profile PATCH replaces a key whole and does not accept this one.
  tours?: TourLedger;
  // The person's own new-campaign defaults (src/lib/campaign-defaults.ts).
  // Written only through setCampaignDefaults and clearCampaignDefaults; the
  // profile PATCH does not accept it, and it is read back through
  // readStoredDefaults, never trusted as stored.
  campaignDefaults?: unknown;
};

export function getUserSettings(userId: string): UserSettings {
  const row = getDatabase()
    .prepare(`SELECT settings_json FROM users WHERE id = ?`)
    .get(userId) as { settings_json: string | null } | undefined;
  return parseJson<UserSettings>(row?.settings_json, {});
}

export function updateUserSettings(userId: string, patch: UserSettings): UserSettings {
  const merged = { ...getUserSettings(userId), ...patch };
  getDatabase()
    .prepare(`UPDATE users SET settings_json = ? WHERE id = ?`)
    .run(JSON.stringify(merged), userId);
  return merged;
}

// Saving defaults touches only this key: the audio, dice and tour
// preferences beside it stay as they were.
export function setCampaignDefaults(userId: string, defaults: unknown) {
  updateUserSettings(userId, { campaignDefaults: defaults });
}

export function clearCampaignDefaults(userId: string) {
  const { campaignDefaults: _removed, ...rest } = getUserSettings(userId);
  void _removed;
  getDatabase()
    .prepare(`UPDATE users SET settings_json = ? WHERE id = ?`)
    .run(JSON.stringify(rest), userId);
}

export function finishedTours(userId: string): TourLedger {
  return parseLedger(getUserSettings(userId).tours, isTourId);
}

// Adds finished tours to the account's record, tour by tour, keeping the
// higher version of each: two devices finishing different tours at once
// both land, and a page still on an older version of a tour cannot lower
// what a newer one recorded.
export function recordFinishedTours(userId: string, finishedNow: TourLedger): TourLedger {
  const tours = mergeLedgers(finishedTours(userId), parseLedger(finishedNow, isTourId));
  updateUserSettings(userId, { tours });
  return tours;
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

// listUsers exposes deletionDueAt through the User fields it spreads.

export function listUsers(): AdminUserSummary[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT ${USER_COLUMNS}, discord_id,
          (SELECT COUNT(*) FROM campaign_members m WHERE m.user_id = users.id) AS campaign_count
        FROM users
        WHERE id NOT LIKE 'comp\\_%' ESCAPE '\\'
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
    deletionRequestedAt: null,
    deletionDueAt: null,
  };
}

export function insertSession(tokenHash: string, userId: string, expiresAt: string) {
  getDatabase()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
    .run(tokenHash, userId, nowIso(), expiresAt);
}

// Read on every signed-in request (pages, the API, each private picture),
// so it only reads: an expired row is refused here by its date and swept
// later by pruneExpiredSessions on the job tick. It used to delete every
// expired row first, a full scan and a write on the one writer per request.
export function getSessionUser(tokenHash: string): User | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
        SELECT u.id, u.username, u.password_hash, u.avatar_json, u.created_at,
          u.is_admin, u.must_change_password, u.deletion_requested_at, u.deletion_due_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at >= ?
      `,
    )
    .get(tokenHash, nowIso()) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

// Whose session this still is, or null once it has ended or expired. The
// live streams ask on every heartbeat (src/lib/live-streams.ts); one primary
// key lookup, no user row.
export function sessionHolder(tokenHash: string): string | null {
  const row = getDatabase()
    .prepare(`SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at >= ?`)
    .get(tokenHash, nowIso()) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

// Expired rows, a bounded batch at a time so one tick never holds the writer
// for long on a server with years of them. Returns how many went.
export function pruneExpiredSessions(now = nowIso(), limit = 1000): number {
  return getDatabase()
    .prepare(
      `DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at < ? LIMIT ?)`,
    )
    .run(now, limit).changes;
}

export function deleteSession(tokenHash: string) {
  getDatabase().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
  closeStreamsForSession(tokenHash);
}

export function deleteSessionsForUser(userId: string, exceptTokenHash?: string) {
  // Signing a player out everywhere else (a password change, an admin reset)
  // also disconnects every agent acting as them (src/lib/agents/grants.ts).
  // Their short-lived web sessions are ordinary session rows, removed below.
  getDatabase()
    .prepare(`UPDATE agent_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(nowIso(), userId);
  if (exceptTokenHash) {
    getDatabase()
      .prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`)
      .run(userId, exceptTokenHash);
  } else {
    getDatabase().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }
  // A stream opened with one of those sessions stops now, not at its next
  // request (src/lib/live-streams.ts).
  closeStreamsForUser(userId, exceptTokenHash);
}

// The deletion clock. Both stamps are set together and cleared together;
// listUsersDueForPurge is what the purge job polls (src/lib/jobs.ts).
export function markDeletionRequested(userId: string, requestedAt: string, dueAt: string) {
  getDatabase()
    .prepare(`UPDATE users SET deletion_requested_at = ?, deletion_due_at = ? WHERE id = ?`)
    .run(requestedAt, dueAt, userId);
}

export function clearDeletionRequest(userId: string) {
  getDatabase()
    .prepare(`UPDATE users SET deletion_requested_at = NULL, deletion_due_at = NULL WHERE id = ?`)
    .run(userId);
}

export function listUsersDueForPurge(nowIso: string): string[] {
  const rows = getDatabase()
    .prepare(`SELECT id FROM users WHERE deletion_due_at IS NOT NULL AND deletion_due_at <= ?`)
    .all(nowIso) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
