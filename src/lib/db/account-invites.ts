import { randomInt } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db/core";

// Admin-minted codes that let someone register while signups are invite-only.
// Distinct from campaign invite codes: this one gates account creation for
// the whole server, not membership in a table.

export type AccountInvite = {
  code: string;
  createdBy: string;
  note: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
};

type InviteRow = {
  code: string;
  created_by: string;
  note: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at: string;
};

// Same unambiguous alphabet as campaign codes (no 0/O, 1/I lookalikes), but
// longer and prefixed so the two kinds can never be pasted into the wrong box.
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  const body = Array.from(
    { length: 10 },
    () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)],
  ).join("");
  return `ODM-${body}`;
}

function mapInvite(row: InviteRow): AccountInvite {
  return {
    code: row.code,
    createdBy: row.created_by,
    note: row.note,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function createAccountInvite(
  createdBy: string,
  options?: { note?: string; maxUses?: number; expiresAt?: string | null },
): AccountInvite {
  const db = getDatabase();
  const maxUses = Math.max(1, Math.min(1000, Math.floor(options?.maxUses ?? 1)));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      db.prepare(
        `INSERT INTO account_invites (code, created_by, note, max_uses, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(code, createdBy, options?.note ?? "", maxUses, options?.expiresAt ?? null, nowIso());
      return {
        code,
        createdBy,
        note: options?.note ?? "",
        maxUses,
        usedCount: 0,
        expiresAt: options?.expiresAt ?? null,
        createdAt: nowIso(),
      };
    } catch {
      // Code collision (32^10 keyspace, so this is theoretical). Try again.
    }
  }
  throw new Error("Could not generate an unused invite code.");
}

export function listAccountInvites(): AccountInvite[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM account_invites ORDER BY created_at DESC`)
    .all() as InviteRow[];
  return rows.map(mapInvite);
}

export function deleteAccountInvite(code: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM account_invites WHERE code = ?`)
    .run(code);
  return result.changes > 0;
}

// A single guarded UPDATE both validates and spends the code, so two racing
// registrations cannot stretch a one-use invite into two accounts.
export function consumeAccountInvite(code: string): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE account_invites
       SET used_count = used_count + 1
       WHERE code = ? AND used_count < max_uses
         AND (expires_at IS NULL OR expires_at >= ?)`,
    )
    .run(code.trim().toUpperCase(), nowIso());
  return result.changes > 0;
}
