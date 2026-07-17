import { getDatabase, nowIso } from "@/lib/db/core";

export type User = {
  id: string;
  username: string;
  createdAt: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
};

function mapUser(row: UserRow): User {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

export function createUser(username: string, passwordHash: string): User {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, username, passwordHash, nowIso());
  return { id, username, createdAt: nowIso() };
}

export function getUserByUsername(username: string): (User & { passwordHash: string }) | null {
  const row = getDatabase()
    .prepare(`SELECT id, username, password_hash, created_at FROM users WHERE username = ?`)
    .get(username) as UserRow | undefined;
  return row ? { ...mapUser(row), passwordHash: row.password_hash } : null;
}

export function getUserById(userId: string): User | null {
  const row = getDatabase()
    .prepare(`SELECT id, username, password_hash, created_at FROM users WHERE id = ?`)
    .get(userId) as UserRow | undefined;
  return row ? mapUser(row) : null;
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
        SELECT u.id, u.username, u.password_hash, u.created_at
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
