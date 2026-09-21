// Connection grants: a player's own agent session (Claude Code, Codex, any
// MCP client) acting as that player over /api/mcp. The raw token is shown
// once and never stored; only its SHA-256 is kept, the same rule as login
// sessions (src/lib/auth.ts).

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/core";
import { getUserById, type User } from "@/lib/db/users";

// What a connected agent may do, in groups a player ticks when connecting.
// Each group maps to web routes (src/lib/agents/workbench.ts), and each
// route still applies its own membership, lead and DM-seat checks.
export const AGENT_SCOPES = ["read", "play", "characters", "campaigns", "dm"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const DEFAULT_GRANT_DAYS = 90;
export const MAX_GRANTS_PER_USER = 10;

export type ConnectionGrant = {
  id: string;
  userId: string;
  name: string;
  scopes: AgentScope[];
  campaignId: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type GrantRow = {
  id: string;
  user_id: string;
  name: string;
  scopes_json: string;
  campaign_id: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function hashGrantToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);
}

function mapGrant(row: GrantRow): ConnectionGrant {
  let scopes: AgentScope[] = [];
  try {
    const parsed = JSON.parse(row.scopes_json);
    scopes = Array.isArray(parsed) ? parsed.filter(isAgentScope) : [];
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    scopes,
    campaignId: row.campaign_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export function listConnectionGrants(userId: string): ConnectionGrant[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM agent_grants WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`)
    .all(userId) as GrantRow[];
  return rows.map(mapGrant);
}

export function createConnectionGrant(input: {
  userId: string;
  name: string;
  scopes: AgentScope[];
  campaignId: string | null;
  days?: number;
}): { grant: ConnectionGrant; token: string } | { error: string } {
  if (listConnectionGrants(input.userId).length >= MAX_GRANTS_PER_USER) {
    return { error: `You already have ${MAX_GRANTS_PER_USER} connected agents. Revoke one first.` };
  }
  const token = `odm_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const now = new Date();
  const days = Math.max(1, Math.min(input.days ?? DEFAULT_GRANT_DAYS, 365));
  const expires = new Date(now.getTime() + days * 86_400_000);
  const scopes = [...new Set(input.scopes.filter(isAgentScope))];
  getDatabase()
    .prepare(
      `INSERT INTO agent_grants (id, token_hash, user_id, name, scopes_json, campaign_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, hashGrantToken(token), input.userId, input.name, JSON.stringify(scopes), input.campaignId, now.toISOString(), expires.toISOString());
  const row = getDatabase().prepare(`SELECT * FROM agent_grants WHERE id = ?`).get(id) as GrantRow;
  return { grant: mapGrant(row), token };
}

export function revokeConnectionGrant(userId: string, grantId: string): boolean {
  const result = getDatabase()
    .prepare(`UPDATE agent_grants SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), grantId, userId);
  if (result.changes > 0) {
    forgetGrantSession(grantId);
  }
  return result.changes > 0;
}

// Called whenever a player's other sessions are signed out (password change,
// admin reset): an agent that could act as them goes too.
export function revokeConnectionGrantsForUser(userId: string) {
  const rows = getDatabase()
    .prepare(`SELECT id FROM agent_grants WHERE user_id = ? AND revoked_at IS NULL`)
    .all(userId) as Array<{ id: string }>;
  getDatabase()
    .prepare(`UPDATE agent_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), userId);
  for (const row of rows) {
    forgetGrantSession(row.id);
  }
}

// The grant a token names, if it is live and its owner can still sign in.
export function resolveConnectionGrant(token: string): ConnectionGrant | null {
  if (!token.startsWith("odm_") || token.length > 200) {
    return null;
  }
  const row = getDatabase()
    .prepare(`SELECT * FROM agent_grants WHERE token_hash = ?`)
    .get(hashGrantToken(token)) as GrantRow | undefined;
  if (!row || row.revoked_at || row.expires_at < new Date().toISOString()) {
    return null;
  }
  const user = getUserById(row.user_id);
  if (!user || user.mustChangePassword || user.deletionRequestedAt) {
    return null;
  }
  getDatabase()
    .prepare(`UPDATE agent_grants SET last_used_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), row.id);
  return mapGrant(row);
}

export function grantUser(grant: ConnectionGrant): User | null {
  return getUserById(grant.userId);
}

// A connected agent acts through the web routes themselves, so it needs a
// login session like any client. One short-lived session per grant, kept in
// memory and replaced when it nears expiry; never handed to the agent.
type GrantSession = { token: string; tokenHash: string; expiresAt: number };
declare global {
  var __odmGrantSessions: Map<string, GrantSession> | undefined;
}

function grantSessions(): Map<string, GrantSession> {
  if (!globalThis.__odmGrantSessions) {
    globalThis.__odmGrantSessions = new Map();
  }
  return globalThis.__odmGrantSessions;
}

const GRANT_SESSION_MS = 60 * 60_000;

export function grantSessionToken(grant: ConnectionGrant): string {
  const cached = grantSessions().get(grant.id);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) {
    return cached.token;
  }
  if (cached) {
    getDatabase().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(cached.tokenHash);
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + GRANT_SESSION_MS;
  getDatabase()
    .prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(tokenHash, grant.userId, new Date().toISOString(), new Date(expiresAt).toISOString());
  grantSessions().set(grant.id, { token, tokenHash, expiresAt });
  return token;
}

function forgetGrantSession(grantId: string) {
  const cached = grantSessions().get(grantId);
  if (cached) {
    getDatabase().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(cached.tokenHash);
    grantSessions().delete(grantId);
  }
}
