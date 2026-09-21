// Who did what through /api/mcp, and how fast they may do it.

import { getDatabase } from "@/lib/db/core";

const KEEP_ROWS = 5_000;

export type AgentActivityInput = {
  grantKind: "turn" | "connection";
  grantId: string;
  userId: string | null;
  campaignId: string | null;
  tool: string;
  ok: boolean;
  ms: number;
};

let writesSincePrune = 0;

export function recordAgentActivity(entry: AgentActivityInput) {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO agent_activity (grant_kind, grant_id, user_id, campaign_id, tool, ok, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.grantKind,
      entry.grantId,
      entry.userId,
      entry.campaignId,
      entry.tool.slice(0, 80),
      entry.ok ? 1 : 0,
      Math.max(0, Math.round(entry.ms)),
      new Date().toISOString(),
    );
    writesSincePrune += 1;
    if (writesSincePrune >= 200) {
      writesSincePrune = 0;
      db.prepare(
        `DELETE FROM agent_activity WHERE id <= (SELECT id FROM agent_activity ORDER BY id DESC LIMIT 1 OFFSET ?)`,
      ).run(KEEP_ROWS);
    }
  } catch (error) {
    // The log is a record, not a gate: a failed insert never fails a call.
    console.warn("[agent-activity]", error instanceof Error ? error.message : error);
  }
}

export type AgentActivityRow = {
  grantKind: string;
  grantId: string;
  campaignId: string | null;
  tool: string;
  ok: boolean;
  ms: number;
  createdAt: string;
};

export function recentAgentActivity(options: { grantId?: string; userId?: string; limit?: number } = {}): AgentActivityRow[] {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.grantId) {
    where.push("grant_id = ?");
    params.push(options.grantId);
  }
  if (options.userId) {
    where.push("user_id = ?");
    params.push(options.userId);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT grant_kind, grant_id, campaign_id, tool, ok, ms, created_at FROM agent_activity
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, limit) as Array<{
    grant_kind: string;
    grant_id: string;
    campaign_id: string | null;
    tool: string;
    ok: number;
    ms: number;
    created_at: string;
  }>;
  return rows.map((row) => ({
    grantKind: row.grant_kind,
    grantId: row.grant_id,
    campaignId: row.campaign_id,
    tool: row.tool,
    ok: row.ok === 1,
    ms: row.ms,
    createdAt: row.created_at,
  }));
}

// Sliding one-minute windows per grant: 60 calls, 10 of them writes. A
// connected agent is a program in a loop, and a loop that goes wrong should
// meet a wall long before the table notices.
const CALLS_PER_MINUTE = 60;
const WRITES_PER_MINUTE = 10;

declare global {
  var __odmAgentThrottle: Map<string, { calls: number[]; writes: number[] }> | undefined;
}

export function isReadTool(name: string): boolean {
  return /^odm_(list|get|read|recent|whoami|lore|quests|timeline|dm_catalog)/.test(name);
}

export function throttleAgent(grantId: string, tool: string, now = Date.now()): string | null {
  if (!globalThis.__odmAgentThrottle) {
    globalThis.__odmAgentThrottle = new Map();
  }
  const store = globalThis.__odmAgentThrottle;
  const entry = store.get(grantId) ?? { calls: [], writes: [] };
  entry.calls = entry.calls.filter((at) => now - at < 60_000);
  entry.writes = entry.writes.filter((at) => now - at < 60_000);
  if (entry.calls.length >= CALLS_PER_MINUTE) {
    store.set(grantId, entry);
    return "Slow down: this connection has made 60 calls in the last minute.";
  }
  const write = !isReadTool(tool);
  if (write && entry.writes.length >= WRITES_PER_MINUTE) {
    store.set(grantId, entry);
    return "Slow down: this connection has made 10 changes in the last minute.";
  }
  entry.calls.push(now);
  if (write) {
    entry.writes.push(now);
  }
  store.set(grantId, entry);
  return null;
}
