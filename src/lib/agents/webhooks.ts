import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db/core";
import { getCampaignForUser, latestSeq } from "@/lib/db/campaigns";
import { getSheetForUser } from "@/lib/db/sheets";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { getActiveEncounter, turnKey } from "@/lib/db/encounters";
import { getLatestDmMessage } from "@/lib/db/messages";
import { getDmStatus } from "@/lib/dm/status";
import { dmQueuePaused } from "@/lib/dm/queue";
import { grantUser, type ConnectionGrant } from "@/lib/agents/grants";
import { playerOpportunities, type PlayerOpportunity } from "./webhook-opportunities";

const MAX_SUBSCRIPTIONS = 5;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 30_000;
const MAX_AGE_MS = 24 * 60 * 60_000;

type Subscription = {
  id: string; grant_id: string; campaign_id: string; character_id: string;
  url: string; secret: string; lifecycle: string | null;
};
type Delivery = {
  id: string; subscription_id: string; opportunity_id: string; body: string;
  attempts: number; created_at: number;
};
export type PlayerWebhookEvent = {
  version: 1; eventId: string; subscriptionId: string; campaignId: string;
  playerId: string; characterId: string; opportunityId: string;
  type: PlayerOpportunity["type"] | "campaign_paused" | "campaign_resumed" | "campaign_ended";
  seq: number; occurredAt: string; pendingRollId?: string; phase?: "act" | "finish";
};

// Delivery is on only where the operator allowed at least one receiver
// origin; with none, no subscription could be made or reached.
export function playerWebhooksEnabled(): boolean {
  return Boolean(process.env.ODM_PLAYER_WEBHOOK_ORIGINS?.trim());
}

// The operator explicitly approves receiver origins. No browser/agent may
// turn an arbitrary URL into a request to the server's internal services.
// Tailscale origins work here too; the operator owns their DNS and TLS.
export function webhookUrl(value: unknown, allowed = process.env.ODM_PLAYER_WEBHOOK_ORIGINS ?? ""): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Supply a receiver URL.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("The receiver needs HTTPS, without credentials, query or fragment.");
  }
  const origins = allowed.split(",").map((s) => s.trim()).filter(Boolean);
  if (!origins.includes(url.origin)) throw new Error("The server operator has not allowed this receiver origin (ODM_PLAYER_WEBHOOK_ORIGINS).");
  return url.href;
}

function maySubscribe(grant: ConnectionGrant, campaignId: string, characterId: string): boolean {
  return grant.scopes.includes("read") && grant.scopes.includes("play") &&
    (!grant.campaignId || grant.campaignId === campaignId) &&
    Boolean(getCampaignForUser(campaignId, grant.userId)) &&
    getSheetForUser(campaignId, grant.userId)?.id === characterId;
}

export function createPlayerWebhook(grant: ConnectionGrant, input: { campaignId: string; characterId: string; url: string }) {
  if (!maySubscribe(grant, input.campaignId, input.characterId)) throw new Error("Connect with read and play scopes for your active character at this table.");
  const url = webhookUrl(input.url);
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM player_webhooks WHERE campaign_id = ? AND character_id = ?`)
    .get(input.campaignId, input.characterId) as Subscription | undefined;
  if (existing) {
    if (liveGrant(existing)) throw new Error("This character already has a webhook receiver. Unsubscribe it before connecting another.");
    deletePlayerWebhook(existing.grant_id, existing.id);
  }
  const count = db.prepare(`SELECT COUNT(*) AS n FROM player_webhooks WHERE grant_id = ?`).get(grant.id) as { n: number };
  if (count.n >= MAX_SUBSCRIPTIONS) throw new Error("Remove an existing webhook first (maximum five per connection).");
  const id = randomUUID();
  const signingSecret = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO player_webhooks (id, grant_id, campaign_id, character_id, url, secret, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, grant.id, input.campaignId, input.characterId, url, signingSecret, nowIso());
  return { id, campaignId: input.campaignId, characterId: input.characterId, url, signingSecret };
}

export function listPlayerWebhooks(grantId: string) {
  return getDatabase().prepare(`SELECT w.id, w.campaign_id AS campaignId, w.character_id AS characterId,
    w.url, w.created_at AS createdAt,
    (SELECT COUNT(*) FROM player_webhook_deliveries d WHERE d.subscription_id = w.id AND d.state = 'pending') AS pending,
    (SELECT COUNT(*) FROM player_webhook_deliveries d WHERE d.subscription_id = w.id AND d.state = 'failed') AS failed
    FROM player_webhooks w WHERE w.grant_id = ?`).all(grantId);
}

export function deletePlayerWebhook(grantId: string, id: string): boolean {
  return getDatabase().prepare(`DELETE FROM player_webhooks WHERE id = ? AND grant_id = ?`).run(id, grantId).changes > 0;
}

export function playerWebhookState(grant: ConnectionGrant, id: string) {
  const sub = getDatabase().prepare(`SELECT * FROM player_webhooks WHERE id = ? AND grant_id = ?`).get(id, grant.id) as Subscription | undefined;
  if (!sub || !liveGrant(sub)) throw new Error("This subscription is no longer active for your character.");
  return { ...stateFor(sub, grant), campaignId: sub.campaign_id, characterId: sub.character_id, seq: latestSeq(sub.campaign_id) };
}

// Guarded writes are optional for interactive callers, mandatory in the
// supplied receiver's prompt. Reserve before invoking the existing route:
// a timeout/crash cannot safely be retried as a fresh action.
export function reserveWebhookWrite(grant: ConnectionGrant, input: { subscriptionId: string; opportunityId: string; campaignId: string; tool: string; pendingRollId?: string; fingerprint: string }) {
  const db = getDatabase();
  return db.transaction(() => {
    const old = db.prepare(`SELECT fingerprint, result FROM player_webhook_writes WHERE subscription_id = ? AND opportunity_id = ? AND tool = ?`)
      .get(input.subscriptionId, input.opportunityId, input.tool) as { fingerprint: string; result: string | null } | undefined;
    // Ownership is checked even for an already completed receipt.
    const sub = db.prepare(`SELECT id FROM player_webhooks WHERE id = ? AND grant_id = ?`).get(input.subscriptionId, grant.id);
    if (!sub) throw new Error("Unknown subscription for this connection.");
    if (old) {
      if (old.fingerprint !== input.fingerprint) throw new Error("That opportunity already has a different submission for this tool.");
      if (!old.result) throw new Error("That submission is in progress or has an uncertain outcome. Read the campaign; do not resubmit it.");
      return JSON.parse(old.result) as { text: string; isError: boolean; campaignId?: string };
    }
    const state = playerWebhookState(grant, input.subscriptionId);
    const opportunity = state.opportunities.find((o) => o.opportunityId === input.opportunityId);
    if (state.campaignId !== input.campaignId || !opportunity ||
      (input.tool === "odm_answer_roll" && opportunity.pendingRollId !== input.pendingRollId) ||
      (input.tool !== "odm_answer_roll" && opportunity.type === "roll_requested") ||
      (input.tool === "odm_take_action" && opportunity.phase === "finish") ||
      (input.tool === "odm_end_turn" && opportunity.type !== "turn_started")) {
      throw new Error("That opportunity is stale or does not permit this submission. Read the table again.");
    }
    db.prepare(`INSERT INTO player_webhook_writes (subscription_id, opportunity_id, tool, fingerprint) VALUES (?, ?, ?, ?)`)
      .run(input.subscriptionId, input.opportunityId, input.tool, input.fingerprint);
    return null;
  })();
}

export function finishWebhookWrite(subscriptionId: string, opportunityId: string, tool: string, result: { text: string; isError: boolean; campaignId?: string }) {
  getDatabase().prepare(`UPDATE player_webhook_writes SET result = ? WHERE subscription_id = ? AND opportunity_id = ? AND tool = ?`)
    .run(JSON.stringify(result), subscriptionId, opportunityId, tool);
}

// Frees a reservation whose route refused it outright (a 4xx changes nothing
// at the table), so the same opportunity can take a corrected submission.
export function releaseWebhookWrite(subscriptionId: string, opportunityId: string, tool: string) {
  getDatabase().prepare(`DELETE FROM player_webhook_writes WHERE subscription_id = ? AND opportunity_id = ? AND tool = ? AND result IS NULL`)
    .run(subscriptionId, opportunityId, tool);
}

function liveGrant(sub: Subscription): ConnectionGrant | null {
  const row = getDatabase().prepare(`SELECT * FROM agent_grants WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`)
    .get(sub.grant_id, nowIso()) as { id: string; user_id: string; name: string; scopes_json: string; campaign_id: string | null; created_at: string; expires_at: string } | undefined;
  if (!row) return null;
  const grant: ConnectionGrant = {
    id: row.id, userId: row.user_id, name: row.name, scopes: JSON.parse(row.scopes_json), campaignId: row.campaign_id,
    createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: null, revokedAt: null,
  };
  const user = grantUser(grant);
  return user && !user.mustChangePassword && !user.deletionRequestedAt && maySubscribe(grant, sub.campaign_id, sub.character_id) ? grant : null;
}

// Responses update the spotlight's floor event. Walk back through that same
// assignment so those updates keep its original opportunity ID for each seat.
function spotlightSeq(campaignId: string): number {
  const rows = getDatabase().prepare(`SELECT seq, payload_json FROM campaign_events
    WHERE campaign_id = ? AND type = 'floor_changed' ORDER BY seq DESC LIMIT 100`).all(campaignId) as Array<{ seq: number; payload_json: string }>;
  let identity = "";
  let seq = 0;
  for (const row of rows) {
    const floor = JSON.parse(row.payload_json).floor;
    if (floor?.mode !== "spotlight") break;
    const key = JSON.stringify([floor.prompt, [...floor.userIds].sort()]);
    if (identity && identity !== key) break;
    identity = key;
    seq = row.seq;
    if (!floor.respondedUserIds?.length) break;
  }
  return seq;
}

function stateFor(sub: Subscription, grant: ConnectionGrant) {
  const db = getDatabase();
  const campaign = getCampaignForUser(sub.campaign_id, grant.userId)!;
  const safety = db.prepare(`SELECT seq, type FROM campaign_events WHERE campaign_id = ?
    AND type IN ('x_card', 'safety_resumed') ORDER BY seq DESC LIMIT 1`).get(campaign.id) as { seq: number; type: string } | undefined;
  const paused = Boolean(dmQueuePaused(campaign.id)) || safety?.type === "x_card" || campaign.floor.mode === "hold";
  const running = db.prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' AND status = 'running' LIMIT 1`).get(campaign.id);
  const awaiting = db.prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' AND status = 'awaiting_rolls' LIMIT 1`).get(campaign.id);
  const status = getDmStatus(campaign.id);
  const encounter = getActiveEncounter(campaign.id);
  const entry = encounter?.order[encounter.turnIndex];
  const narration = getLatestDmMessage(campaign.id);
  const last = db.prepare(`SELECT MAX(seq) AS seq FROM campaign_messages WHERE campaign_id = ? AND user_id = ? AND author_type = 'player' AND content NOT LIKE '(ooc) %'`)
    .get(campaign.id, grant.userId) as { seq: number | null };
  const held = db.prepare(`SELECT MAX(seq) AS seq FROM campaign_events WHERE campaign_id = ? AND type = 'floor_changed' AND json_extract(payload_json, '$.floor.mode') = 'hold'`)
    .get(campaign.id) as { seq: number | null };
  const gate = Math.max(held.seq ?? 0, safety?.seq ?? 0);
  const busy = Boolean(running) || !["idle", "awaiting_rolls"].includes(status);
  const opportunities = playerOpportunities({
    active: campaign.status === "active", paused, busy,
    awaitingRolls: Boolean(awaiting) || status === "awaiting_rolls",
    floor: campaign.floor, floorSeq: spotlightSeq(campaign.id), userId: grant.userId, characterId: sub.character_id,
    rolls: listOpenPendingRolls(campaign.id),
    turn: encounter?.orderReady && entry?.kind === "pc" ? {
      id: encounter.id, characterId: entry.characterId, userId: entry.userId, key: turnKey(encounter), waitingSeq: encounter.waitingSeq,
    } : null,
    narration, lastPlayerSeq: last.seq ?? 0,
  });
  return { opportunities: opportunities.map((o) => ({ ...o, opportunityId: `${o.opportunityId}:gate:${gate}` })), busy,
    lifecycle: campaign.status === "ended" ? "ended" : campaign.status !== "active" || paused ? "paused" : "active" };
}

function enqueue(sub: Subscription, grant: ConnectionGrant, opportunity: { type: PlayerWebhookEvent["type"]; opportunityId: string; pendingRollId?: string; phase?: "act" | "finish" }, now: number) {
  const event: PlayerWebhookEvent = {
    version: 1, eventId: randomUUID(), subscriptionId: sub.id, campaignId: sub.campaign_id,
    playerId: grant.userId, characterId: sub.character_id, ...opportunity,
    seq: latestSeq(sub.campaign_id), occurredAt: new Date(now).toISOString(),
  };
  getDatabase().prepare(`INSERT OR IGNORE INTO player_webhook_deliveries
    (id, subscription_id, opportunity_id, body, state, attempts, available_at, created_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
    ON CONFLICT(subscription_id, opportunity_id) DO UPDATE SET id = excluded.id, body = excluded.body,
      state = 'pending', attempts = 0, available_at = excluded.available_at, created_at = excluded.created_at
      WHERE player_webhook_deliveries.state = 'cancelled'`).run(event.eventId, sub.id, event.opportunityId, JSON.stringify(event), now, now);
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

// State reconciliation is deliberately independent of ephemeral callbacks:
// a crash after a game mutation and before publishing, or a parked turn
// restored after restart, still reaches the outbox. It never sends prose,
// enemy statistics, dice results, notes or a bearer token.
export async function runPlayerWebhooksOnce(now = Date.now(), send: typeof fetch = fetch) {
  const db = getDatabase();
  const subs = db.prepare(`SELECT * FROM player_webhooks`).all() as Subscription[];
  for (const sub of subs) {
    const grant = liveGrant(sub);
    if (!grant) {
      deletePlayerWebhook(sub.grant_id, sub.id);
      continue;
    }
    let state: ReturnType<typeof stateFor>;
    try { webhookUrl(sub.url); state = stateFor(sub, grant); } catch { continue; }
    db.transaction(() => {
      const current = db.prepare(`SELECT lifecycle FROM player_webhooks WHERE id = ?`).get(sub.id) as { lifecycle: string | null };
      if (current.lifecycle !== null && current.lifecycle !== state.lifecycle) {
        const revision = randomUUID();
        enqueue(sub, grant, { type: state.lifecycle === "ended" ? "campaign_ended" : state.lifecycle === "paused" ? "campaign_paused" : "campaign_resumed", opportunityId: `lifecycle:${state.lifecycle}:${revision}` }, now);
      }
      db.prepare(`UPDATE player_webhooks SET lifecycle = ? WHERE id = ?`).run(state.lifecycle, sub.id);
      for (const o of state.opportunities) enqueue(sub, grant, o, now);
    })();
    const due = db.prepare(`SELECT * FROM player_webhook_deliveries WHERE subscription_id = ? AND state = 'pending'
      AND available_at <= ? ORDER BY created_at, rowid LIMIT 10`).all(sub.id, now) as Delivery[];
    for (const delivery of due) {
      // Lease before awaiting I/O. Another server worker may run this tick.
      const claimed = db.prepare(`UPDATE player_webhook_deliveries SET available_at = ?, attempts = attempts + 1
        WHERE id = ? AND state = 'pending' AND available_at <= ?`).run(now + LEASE_MS, delivery.id, now).changes;
      if (!claimed) continue;
      const freshGrant = liveGrant(sub);
      const fresh = freshGrant ? stateFor(sub, freshGrant) : null;
      const event = JSON.parse(delivery.body) as PlayerWebhookEvent;
      const lifecycle = event.opportunityId.startsWith("lifecycle:");
      const valid = fresh && (lifecycle
        ? fresh.lifecycle === (event.type === "campaign_ended" ? "ended" : event.type === "campaign_paused" ? "paused" : "active")
        : fresh.opportunities.some((o) => o.opportunityId === event.opportunityId));
      if (!valid || now - delivery.created_at > MAX_AGE_MS) {
        db.prepare(`UPDATE player_webhook_deliveries SET state = 'cancelled' WHERE id = ?`).run(delivery.id);
        continue;
      }
      const timestamp = String(Math.floor(Date.now() / 1000));
      let ok = false;
      try {
        const response = await send(sub.url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000), body: delivery.body,
          headers: { "Content-Type": "application/json", "X-ODM-Event-Id": event.eventId,
            "X-ODM-Timestamp": timestamp, "X-ODM-Signature": webhookSignature(sub.secret, timestamp, delivery.body) },
        });
        ok = response.ok;
        await response.body?.cancel();
      } catch { /* Retry without logging URLs, responses or credentials. */ }
      const attempts = delivery.attempts + 1;
      db.prepare(`UPDATE player_webhook_deliveries SET state = ?, available_at = ? WHERE id = ?`)
        .run(ok ? "delivered" : attempts >= MAX_ATTEMPTS ? "failed" : "pending", now + Math.min(300_000, 1000 * 2 ** attempts), delivery.id);
    }
  }
}

declare global { var __odmPlayerWebhookRunner: ReturnType<typeof setInterval> | undefined; }
export function startPlayerWebhookRunner() {
  if (globalThis.__odmPlayerWebhookRunner || !playerWebhooksEnabled()) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runPlayerWebhooksOnce(); } catch { console.error("[player-webhooks] tick failed; will retry"); }
    finally { running = false; }
  };
  globalThis.__odmPlayerWebhookRunner = setInterval(() => void tick(), 1000);
  globalThis.__odmPlayerWebhookRunner.unref?.();
  void tick();
}
