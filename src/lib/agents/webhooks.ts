import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { getAppSetting, setAppSetting } from "@/lib/db/app-settings";
import { getDatabase, nowIso } from "@/lib/db/core";
import { getCampaignForUser, latestSeq } from "@/lib/db/campaigns";
import { getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { getActiveEncounter, turnKey } from "@/lib/db/encounters";
import { getLatestDmMessage } from "@/lib/db/messages";
import { listOpenItemProposals } from "@/lib/db/item-proposals";
import { getDmStatus } from "@/lib/dm/status";
import { dmQueuePaused, dmQueuePausedFor } from "@/lib/dm/queue";
import { SESSION_REASON } from "@/lib/dm/session-hold-logic";
import { BREAK_REASON } from "@/lib/dm/table-break-logic";
import { levelForXp } from "@/lib/srd";
import { grantUser, type ConnectionGrant } from "@/lib/agents/grants";
import { playerOpportunities, turnIdentity, type OpportunityState, type PlayerOpportunity } from "./webhook-opportunities";
import { AGAIN_SUFFIX, baseOpportunityId, GUARDED_TOOLS, guardVerdict, type GuardedTool, type GuardVerdict } from "./webhook-guard-logic";
import { seatVerdict, stopWordsForAgent, type StopReason } from "./webhook-seat-logic";

const MAX_SUBSCRIPTIONS = 5;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 30_000;
const MAX_AGE_MS = 24 * 60 * 60_000;

type Subscription = {
  id: string; grant_id: string; campaign_id: string; character_id: string;
  url: string; secret: string; authorization_header: string | null; extra_headers: string | null; lifecycle: string | null;
  poll_token_hash: string | null;
};
type Delivery = {
  id: string; subscription_id: string; opportunity_id: string; body: string;
  attempts: number; created_at: number;
};
export type PlayerWebhookEvent = {
  version: 1; eventId: string; subscriptionId: string; campaignId: string;
  playerId: string; characterId: string; opportunityId: string;
  type: PlayerOpportunity["type"] | "campaign_paused" | "campaign_resumed" | "campaign_ended";
  seq: number; occurredAt: string; pendingRollId?: string; phase?: "act" | "finish"; level?: number; proposalId?: string;
  // A plain-language summary with the IDs a guarded write needs. Hosted
  // receivers that pass on only a text field (a Claude Code routine reads
  // just `text`) still tell their agent what woke it.
  text: string;
};

// The operator approves receiver origins in two places: the
// ODM_PLAYER_WEBHOOK_ORIGINS environment variable, and Admin > Player agents,
// which is stored here and live at once, with no restart. The server uses
// both lists together.
const ORIGINS_SETTING = "player_webhook_origins";
export const MAX_RECEIVER_ORIGINS = 20;

export function envReceiverOrigins(): string[] {
  return (process.env.ODM_PLAYER_WEBHOOK_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function adminReceiverOrigins(): string[] {
  const stored = getAppSetting<unknown>(ORIGINS_SETTING, []);
  return Array.isArray(stored) ? stored.filter((origin): origin is string => typeof origin === "string") : [];
}

export function allowedReceiverOrigins(): string[] {
  return [...new Set([...envReceiverOrigins(), ...adminReceiverOrigins()])];
}

// An address an admin types or pastes, as the origin it approves: HTTPS,
// host and port. A pasted path (the receiver's /odm-player) is dropped, since
// approval covers the whole origin; credentials, a query or a fragment are
// refused, as they are on a receiver URL.
export function receiverOrigin(value: unknown): string {
  const invalid = "Give the receiver's HTTPS address, such as https://my-pc.example.ts.net:8443.";
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new Error(invalid);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(invalid); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(invalid);
  return url.origin;
}

// The caller starts the delivery loop (startPlayerWebhookRunner) once the
// list is saved, so the first approved address works without a restart.
export function setAdminReceiverOrigins(values: readonly unknown[]): string[] {
  const origins = [...new Set(values.map(receiverOrigin))];
  if (origins.length > MAX_RECEIVER_ORIGINS) throw new Error(`At most ${MAX_RECEIVER_ORIGINS} receiver addresses.`);
  setAppSetting(ORIGINS_SETTING, origins);
  return origins;
}

// Delivery is on only where the operator allowed at least one receiver
// origin; with none, no subscription could be made or reached.
export function playerWebhooksEnabled(): boolean {
  return allowedReceiverOrigins().length > 0;
}

// Poll links, the pull side of the same subscriptions, for an agent that
// cannot take incoming requests (a hosted assistant whose hooks can only
// poll): the server sends nothing, and the agent's hook asks an unguessable
// link what this character may do now. Off until an admin turns them on in
// Admin > Player agents; turning them off deletes every link, so turning
// them on again never brings an old (perhaps leaked) one back.
const POLL_LINKS_SETTING = "player_poll_links";

export function pollLinksAllowed(): boolean {
  return getAppSetting<unknown>(POLL_LINKS_SETTING, false) === true;
}

export function setPollLinksAllowed(on: boolean) {
  setAppSetting(POLL_LINKS_SETTING, on);
  if (!on) {
    getDatabase().prepare(`DELETE FROM player_webhooks WHERE poll_token_hash IS NOT NULL`).run();
    // Nor does a stopped link's notice outlive the switch: off means gone.
    getDatabase().prepare(`DELETE FROM player_webhook_stops WHERE delivery = 'poll'`).run();
  }
}

// Whether connected players see the webhook tools and the guard fields on
// the play tools: either kind of subscription can be made.
export function playerSignalsEnabled(): boolean {
  return playerWebhooksEnabled() || pollLinksAllowed();
}

// The operator explicitly approves receiver origins. No browser/agent may
// turn an arbitrary URL into a request to the server's internal services.
// Tailscale origins work here too; the operator owns their DNS and TLS.
// allowed defaults to both approved lists; a string is read the way the
// environment variable is (comma-separated), so "" approves nothing.
export function webhookUrl(value: unknown, allowed: string | readonly string[] = allowedReceiverOrigins()): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Supply a receiver URL.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("The receiver needs HTTPS, without credentials, query or fragment.");
  }
  const origins = typeof allowed === "string" ? allowed.split(",").map((s) => s.trim()).filter(Boolean) : allowed;
  if (!origins.includes(url.origin)) {
    throw new Error("The server's admin has not allowed this receiver address (Admin > Player agents, or ODM_PLAYER_WEBHOOK_ORIGINS).");
  }
  return url.href;
}

// Hosted receivers (an agent platform's webhook endpoint) may require their
// own credential. Only the Authorization header is supported, so a caller
// cannot set Host, Content-Length or ODM's own headers. Printable ASCII
// without surrounding spaces is sent exactly as given; CR/LF never are.
// The value is a secret like the signing secret: stored, sent, never listed
// back and never included in an error.
export function webhookAuthorization(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 ||
    !/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(value)) {
    throw new Error("authorizationHeader must be 1-1024 printable ASCII characters, without line breaks or surrounding spaces.");
  }
  return value;
}

// Header names a hosted receiver may need besides Authorization, such as
// Claude's anthropic-version. Never one that changes how the request is
// framed or routed, a cookie, or ODM's own X-ODM-* headers.
const MAX_EXTRA_HEADERS = 4;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const RESERVED_HEADERS = new Set([
  "authorization", "host", "content-length", "content-type", "content-encoding", "transfer-encoding",
  "connection", "keep-alive", "upgrade", "te", "trailer", "expect", "cookie", "proxy-authorization",
]);
const HEADER_VALUE_ERROR = "Each header value must be 1-1024 printable ASCII characters, without line breaks or surrounding spaces.";

// Values are treated like the Authorization value: stored, sent, never
// listed back and never included in an error.
export function webhookHeaders(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("headers must be an object of header names to values.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return null;
  if (entries.length > MAX_EXTRA_HEADERS) throw new Error(`At most ${MAX_EXTRA_HEADERS} extra headers.`);
  const seen = new Set<string>();
  const out: Record<string, string> = {};
  for (const [name, raw] of entries) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith("x-odm-") || seen.has(lower)) {
      throw new Error("A header name is not allowed. Use authorizationHeader for Authorization; framing, cookie, proxy and X-ODM-* headers cannot be set.");
    }
    seen.add(lower);
    let checked: string | null;
    try { checked = webhookAuthorization(raw); } catch { throw new Error(HEADER_VALUE_ERROR); }
    if (checked === null) throw new Error(HEADER_VALUE_ERROR);
    out[name] = checked;
  }
  return out;
}

function parseHeaders(json: string | null): Record<string, string> {
  if (!json) return {};
  try { return JSON.parse(json) as Record<string, string>; } catch { return {}; }
}

function maySubscribe(grant: ConnectionGrant, campaignId: string, characterId: string): boolean {
  return grant.scopes.includes("read") && grant.scopes.includes("play") &&
    (!grant.campaignId || grant.campaignId === campaignId) &&
    Boolean(getCampaignForUser(campaignId, grant.userId)) &&
    getSheetForUser(campaignId, grant.userId)?.id === characterId;
}

// What both kinds of subscription check first: the grant may play this
// character, the character has no live subscription, and the grant has room.
function claimCharacter(grant: ConnectionGrant, campaignId: string, characterId: string) {
  if (!maySubscribe(grant, campaignId, characterId)) throw new Error("Connect with read and play scopes for your active character at this table.");
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM player_webhooks WHERE campaign_id = ? AND character_id = ?`)
    .get(campaignId, characterId) as Subscription | undefined;
  if (existing) {
    const live = liveSubscription(existing);
    if ("grant" in live && live.sub.character_id === characterId) {
      throw new Error("This character already has a webhook receiver or poll link. Unsubscribe it before connecting another.");
    }
    if ("stopped" in live) stopPlayerWebhook(existing, live.stopped);
    else if ("gone" in live) deletePlayerWebhook(existing.grant_id, existing.id);
  }
  const count = db.prepare(`SELECT COUNT(*) AS n FROM player_webhooks WHERE grant_id = ?`).get(grant.id) as { n: number };
  if (count.n >= MAX_SUBSCRIPTIONS) throw new Error("Remove an existing webhook first (maximum five per connection).");
}

export function createPlayerWebhook(grant: ConnectionGrant, input: { campaignId: string; characterId: string; url: string; authorizationHeader?: string; headers?: unknown }) {
  if (!maySubscribe(grant, input.campaignId, input.characterId)) throw new Error("Connect with read and play scopes for your active character at this table.");
  const url = webhookUrl(input.url);
  const authorization = webhookAuthorization(input.authorizationHeader);
  const extra = webhookHeaders(input.headers);
  const db = getDatabase();
  claimCharacter(grant, input.campaignId, input.characterId);
  clearStops(grant.id, input.campaignId);
  const id = randomUUID();
  const signingSecret = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO player_webhooks (id, grant_id, campaign_id, character_id, url, secret, authorization_header, extra_headers, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, grant.id, input.campaignId, input.characterId, url, signingSecret, authorization, extra ? JSON.stringify(extra) : null, nowIso());
  // The caller supplied the header values; only their names are echoed back.
  return { id, campaignId: input.campaignId, characterId: input.characterId, url, signingSecret, hasAuthorizationHeader: authorization !== null, headerNames: Object.keys(extra ?? {}) };
}

export const POLL_PATH_PREFIX = "/api/agents/signal/";
const POLL_TOKEN = /^odmpoll_[A-Za-z0-9_-]{43}$/;

function hashPollToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// A poll link for the grant's own character. The link is the secret: it is
// returned once, only its hash is kept. It follows the player's seat to a
// new hero (src/lib/agents/webhook-seat-logic.ts), and stops when the
// subscription is removed or replaced, the connection is revoked or
// expires, the player leaves the table or the seat leaves it with no hero
// to follow, or an admin turns poll links off. The caller puts the server's
// address in front of pollPath.
export class PollLinksOff extends Error {}

export function createPlayerPollLink(grant: ConnectionGrant, input: { campaignId: string; characterId: string }) {
  if (!pollLinksAllowed()) throw new PollLinksOff("This server's admin has not turned poll links on (Admin > Player agents).");
  if (grant.revokedAt || grant.expiresAt <= nowIso()) throw new Error("This connection has expired or been revoked.");
  // A new link from the same connection at the same table replaces its old
  // one, whichever character that one was made for, so a lost link is not a
  // dead end and an old hero's link does not linger beside the new one.
  getDatabase().prepare(`DELETE FROM player_webhooks WHERE grant_id = ? AND campaign_id = ? AND poll_token_hash IS NOT NULL`)
    .run(grant.id, input.campaignId);
  claimCharacter(grant, input.campaignId, input.characterId);
  clearStops(grant.id, input.campaignId);
  const id = randomUUID();
  const token = `odmpoll_${randomBytes(32).toString("base64url")}`;
  getDatabase().prepare(`INSERT INTO player_webhooks (id, grant_id, campaign_id, character_id, url, secret, poll_token_hash, created_at)
    VALUES (?, ?, ?, ?, '', ?, ?, ?)`).run(id, grant.id, input.campaignId, input.characterId, randomBytes(32).toString("base64url"), hashPollToken(token), nowIso());
  return { id, campaignId: input.campaignId, characterId: input.characterId, delivery: "poll" as const, pollPath: `${POLL_PATH_PREFIX}${token}` };
}

// One answer per link every few seconds is plenty for a poller, whose
// interval is a minute in practice; more is refused, not queued.
export const POLL_MIN_INTERVAL_MS = 2_000;
const lastPoll = new Map<string, number>();

export type StoppedLink = { reason: StopReason; stoppedAt: string; subscriptionId: string; campaignId: string; characterId: string };

export type PollAnswer =
  | { status: 200; body: PollBody }
  | { status: 404 }
  | { status: 410; stopped: StoppedLink; error: string }
  | { status: 429; retryAfterSec: number };

type PollBody = {
  subscriptionId: string; campaignId: string; characterId: string;
  lifecycle: string; busy: boolean; wake: boolean; fingerprint: string;
  // Why a paused table is paused, so a poller can tell a session's end from
  // a break or a safety pause (issue 654).
  pausedFor?: PausedFor;
  opportunities: Array<{ opportunityId: string; type: PlayerOpportunity["type"]; phase?: "act" | "finish"; pendingRollId?: string; level?: number }>;
};

// What a poll link answers: the same opportunities a pushed webhook would
// carry, and nothing else (no story text, no names). wake says whether the
// character has something to do now; fingerprint covers only the lifecycle
// and the opportunity IDs. While the DM narrates the list is briefly empty
// and then the same decision returns with the same fingerprint, so a poller
// that compares with the fingerprint it last woke for wakes once per decision.
// Each resolved step of a combat turn is a new decision, and a refused write
// re-lists its decision once as "<id>:again" (issue 653), so neither leaves a
// poller asleep. An unknown, revoked or switched-off link reads as not found.
// A link that stopped on its own answers 410 with why (issue 654); one its
// owner removed, replaced or revoked still reads as not found.
export function pollLinkAnswer(token: string, now = Date.now()): PollAnswer {
  if (!POLL_TOKEN.test(token) || !pollLinksAllowed()) return { status: 404 };
  const hash = hashPollToken(token);
  const found = getDatabase().prepare(`SELECT * FROM player_webhooks WHERE poll_token_hash = ?`)
    .get(hash) as Subscription | undefined;
  if (!found) return stoppedAnswer(hash);
  const live = liveSubscription(found);
  if ("gone" in live) {
    deletePlayerWebhook(found.grant_id, found.id);
    return { status: 404 };
  }
  if ("stopped" in live) {
    stopPlayerWebhook(found, live.stopped);
    return stoppedAnswer(hash);
  }
  const { sub, grant } = live;
  const last = lastPoll.get(sub.id) ?? 0;
  if (now - last < POLL_MIN_INTERVAL_MS) return { status: 429, retryAfterSec: Math.ceil((POLL_MIN_INTERVAL_MS - (now - last)) / 1000) };
  lastPoll.set(sub.id, now);
  if (lastPoll.size > 10_000) lastPoll.clear();
  const state = stateFor(sub, grant);
  const opportunities = state.opportunities.map((o) => ({
    opportunityId: o.opportunityId, type: o.type,
    ...(o.phase ? { phase: o.phase } : {}), ...(o.pendingRollId ? { pendingRollId: o.pendingRollId } : {}),
    ...(o.level ? { level: o.level } : {}),
    ...(o.proposalId ? { proposalId: o.proposalId } : {}),
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([state.lifecycle, opportunities.map((o) => o.opportunityId)]))
    .digest("hex").slice(0, 16);
  return {
    status: 200,
    body: {
      subscriptionId: sub.id, campaignId: sub.campaign_id, characterId: sub.character_id,
      lifecycle: state.lifecycle, busy: state.busy,
      ...(state.pausedFor ? { pausedFor: state.pausedFor } : {}),
      wake: state.lifecycle === "active" && opportunities.length > 0,
      fingerprint, opportunities,
    },
  };
}

function stoppedAnswer(hash: string): PollAnswer {
  const row = getDatabase().prepare(`SELECT * FROM player_webhook_stops WHERE poll_token_hash = ?`).get(hash) as StopRow | undefined;
  if (!row) return { status: 404 };
  return { status: 410, stopped: stoppedLink(row), error: stopWordsForAgent(row.reason as StopReason, "poll") };
}

type StopRow = { id: string; grant_id: string; campaign_id: string; character_id: string; delivery: "poll" | "push"; poll_token_hash: string | null; reason: string; stopped_at: string };

function stoppedLink(row: StopRow): StoppedLink {
  return { reason: row.reason as StopReason, stoppedAt: row.stopped_at, subscriptionId: row.id, campaignId: row.campaign_id, characterId: row.character_id };
}

// Records why a subscription stopped and removes it, so the character is
// free for a new link and the old one is answered with the reason.
function stopPlayerWebhook(sub: Subscription, reason: StopReason) {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO player_webhook_stops (id, grant_id, campaign_id, character_id, delivery, poll_token_hash, reason, stopped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sub.id, sub.grant_id, sub.campaign_id, sub.character_id, sub.poll_token_hash ? "poll" : "push", sub.poll_token_hash, reason, nowIso());
    db.prepare(`DELETE FROM player_webhooks WHERE id = ?`).run(sub.id);
  })();
}

// A new link or receiver from the same connection at the same table answers
// what the old notice said.
function clearStops(grantId: string, campaignId: string) {
  getDatabase().prepare(`DELETE FROM player_webhook_stops WHERE grant_id = ? AND campaign_id = ?`).run(grantId, campaignId);
}

// A stop is kept 30 days, for Settings > Connected agents and for an agent
// still polling its old link; older ones are dropped whenever stops are read.
export const STOP_NOTICE_DAYS = 30;

export function listPlayerWebhookStops(grantIds: readonly string[]): Array<StoppedLink & { grantId: string; delivery: "poll" | "push" }> {
  if (!grantIds.length) return [];
  const since = new Date(Date.now() - STOP_NOTICE_DAYS * 86_400_000).toISOString();
  getDatabase().prepare(`DELETE FROM player_webhook_stops WHERE stopped_at <= ?`).run(since);
  const rows = getDatabase().prepare(`SELECT * FROM player_webhook_stops WHERE grant_id IN (${grantIds.map(() => "?").join(", ")}) AND stopped_at > ? ORDER BY stopped_at DESC`)
    .all(...grantIds, since) as StopRow[];
  return rows.map((row) => ({ ...stoppedLink(row), grantId: row.grant_id, delivery: row.delivery }));
}

export type ListedWebhook = {
  id: string; campaignId: string; characterId: string; url: string; createdAt: string;
  pending: number; failed: number; delivery: "poll" | "push"; hasAuthorizationHeader: boolean; headerNames: string[];
};

export function listPlayerWebhooks(grantId: string): ListedWebhook[] {
  return getDatabase().prepare(`SELECT w.id, w.campaign_id AS campaignId, w.character_id AS characterId,
    w.url, w.poll_token_hash IS NOT NULL AS poll, w.authorization_header IS NOT NULL AS hasAuthorizationHeader, w.extra_headers AS extraHeaders, w.created_at AS createdAt,
    (SELECT COUNT(*) FROM player_webhook_deliveries d WHERE d.subscription_id = w.id AND d.state = 'pending') AS pending,
    (SELECT COUNT(*) FROM player_webhook_deliveries d WHERE d.subscription_id = w.id AND d.state = 'failed') AS failed
    FROM player_webhooks w WHERE w.grant_id = ?`).all(grantId)
    .map((row) => {
      const { extraHeaders, poll, ...rest } = row as Record<string, unknown> & { extraHeaders: string | null; poll: number };
      return { ...rest, delivery: poll ? "poll" : "push", hasAuthorizationHeader: Boolean(rest.hasAuthorizationHeader), headerNames: Object.keys(parseHeaders(extraHeaders)) } as ListedWebhook;
    });
}

export function deletePlayerWebhook(grantId: string, id: string): boolean {
  return getDatabase().prepare(`DELETE FROM player_webhooks WHERE id = ? AND grant_id = ?`).run(id, grantId).changes > 0;
}

function liveState(grant: ConnectionGrant, id: string) {
  const found = getDatabase().prepare(`SELECT * FROM player_webhooks WHERE id = ? AND grant_id = ?`).get(id, grant.id) as Subscription | undefined;
  if (!found) {
    const stop = getDatabase().prepare(`SELECT reason, delivery FROM player_webhook_stops WHERE id = ? AND grant_id = ?`).get(id, grant.id) as { reason: StopReason; delivery: "poll" | "push" } | undefined;
    throw new Error(stop ? stopWordsForAgent(stop.reason, stop.delivery) : "This subscription was removed: unsubscribed, replaced by a new one, or its connection revoked.");
  }
  const live = liveSubscription(found);
  if ("stopped" in live) {
    stopPlayerWebhook(found, live.stopped);
    throw new Error(stopWordsForAgent(live.stopped, found.poll_token_hash ? "poll" : "push"));
  }
  if ("gone" in live) throw new Error("This subscription is no longer active: its connection was revoked or its account cannot play now.");
  const { sub } = live;
  return { ...stateFor(sub, live.grant), campaignId: sub.campaign_id, characterId: sub.character_id, seq: latestSeq(sub.campaign_id) };
}

// The character a guarded write acts as: the subscription's own, which at a
// table of several characters each need not be the one its player has
// selected (issue 654).
export function subscriptionCharacter(grantId: string, subscriptionId: string): string | null {
  return (getDatabase().prepare(`SELECT character_id FROM player_webhooks WHERE id = ? AND grant_id = ?`).get(subscriptionId, grantId) as { character_id: string } | undefined)?.character_id ?? null;
}

// What odm_get_player_webhook_opportunities answers. The turn identity and
// gate are the guard's own bookkeeping, not decisions, so they stay out.
export function playerWebhookState(grant: ConnectionGrant, id: string) {
  const state: Partial<ReturnType<typeof liveState>> = { ...liveState(grant, id) };
  delete state.turnId;
  delete state.gate;
  return state as Omit<ReturnType<typeof liveState>, "turnId" | "gate">;
}

// A refusal's words as JSON, so an agent can read what to send instead.
function refusalText(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

function refusalFor(verdict: Exclude<GuardVerdict, { ok: true }>, next: string | null): string {
  if (verdict.kind === "tool") {
    return refusalText({
      error: verdict.error, retry: true, accepts: verdict.accepts,
      ...(verdict.pendingRollId ? { pendingRollId: verdict.pendingRollId } : {}),
      ...(next ? { opportunityId: next } : {}),
    });
  }
  return verdict.kind === "wait" ? refusalText({ error: verdict.error, retry: true, wait: true }) : refusalText({ error: verdict.error, stale: true });
}

// The tool column of a refusal mark: never a real tool name, so it can never
// be taken for a submission's receipt.
const REFUSED = "(refused)";

// Re-lists a decision once under "<id>:again" after a write to it was
// refused (issue 653): the poll fingerprint and the pushed event both move,
// so an agent whose wake ended on the refusal is woken to correct it. Once
// only, so an agent that keeps sending the wrong thing cannot loop on it.
// Returns the ID the decision now goes by.
export function markWebhookRefusal(subscriptionId: string, opportunityId: string): string {
  const base = baseOpportunityId(opportunityId);
  getDatabase().prepare(`INSERT OR IGNORE INTO player_webhook_writes (subscription_id, opportunity_id, tool, fingerprint, result) VALUES (?, ?, ?, '', '{}')`)
    .run(subscriptionId, base, REFUSED);
  return `${base}${AGAIN_SUFFIX}`;
}

type WriteReceipt = { text: string; isError: boolean; campaignId?: string };

// Guarded writes are optional for interactive callers, mandatory in the
// supplied receiver's prompt. Reserve before invoking the existing route:
// a timeout/crash cannot safely be retried as a fresh action. The write is
// kept under the decision's base ID, so "<id>" and "<id>:again" are one
// decision. key names the reservation when one tool has two (table talk
// beside an action); it defaults to the tool.
export function reserveWebhookWrite(grant: ConnectionGrant, input: { subscriptionId: string; opportunityId: string; campaignId: string; tool: string; key?: string; pendingRollId?: string; fingerprint: string }): WriteReceipt | null {
  if (!(GUARDED_TOOLS as readonly string[]).includes(input.tool)) throw new Error(`${input.tool} takes no webhook guard.`);
  const db = getDatabase();
  const base = baseOpportunityId(input.opportunityId);
  const key = input.key ?? input.tool;
  const outcome = db.transaction((): { receipt: WriteReceipt | null } | { refused: Exclude<GuardVerdict, { ok: true }>; listed: string | null } => {
    const old = db.prepare(`SELECT fingerprint, result FROM player_webhook_writes WHERE subscription_id = ? AND opportunity_id = ? AND tool = ?`)
      .get(input.subscriptionId, base, key) as { fingerprint: string; result: string | null } | undefined;
    // Ownership is checked even for an already completed receipt.
    const sub = db.prepare(`SELECT id FROM player_webhooks WHERE id = ? AND grant_id = ?`).get(input.subscriptionId, grant.id);
    if (!sub) throw new Error("Unknown subscription for this connection.");
    if (old) {
      if (old.fingerprint !== input.fingerprint) {
        throw new Error(refusalText({ error: `That opportunity already took a different ${input.tool}. Read odm_get_player_webhook_opportunities for the decision open now.`, stale: true }));
      }
      if (!old.result) throw new Error("That submission is in progress or has an uncertain outcome. Read the campaign; do not resubmit it.");
      return { receipt: JSON.parse(old.result) as WriteReceipt };
    }
    const state = liveState(grant, input.subscriptionId);
    if (state.campaignId !== input.campaignId) {
      throw new Error(refusalText({ error: "That subscription plays at another campaign. Send the campaignId it was made for.", retry: true }));
    }
    const listed = state.opportunities.find((o) => o.opportunityId === base || o.opportunityId === `${base}${AGAIN_SUFFIX}`) ?? null;
    const verdict = guardVerdict({
      tool: input.tool as GuardedTool, opportunity: listed, pendingRollId: input.pendingRollId,
      turnId: state.turnId, gate: state.gate, busy: state.busy, requestedId: base,
    });
    if (!verdict.ok) return { refused: verdict, listed: listed?.opportunityId ?? null };
    db.prepare(`INSERT INTO player_webhook_writes (subscription_id, opportunity_id, tool, fingerprint) VALUES (?, ?, ?, ?)`)
      .run(input.subscriptionId, base, key, input.fingerprint);
    return { receipt: null };
  })();
  if ("receipt" in outcome) return outcome.receipt;
  // Marked after the transaction: a throw inside it would roll the mark back.
  const next = outcome.refused.kind === "tool" && outcome.listed
    ? outcome.listed.endsWith(AGAIN_SUFFIX) ? outcome.listed : markWebhookRefusal(input.subscriptionId, base)
    : null;
  throw new Error(refusalFor(outcome.refused, next));
}

// Both take the ID the write was sent with; it is kept under the base ID.
export function finishWebhookWrite(subscriptionId: string, opportunityId: string, tool: string, result: { text: string; isError: boolean; campaignId?: string }) {
  getDatabase().prepare(`UPDATE player_webhook_writes SET result = ? WHERE subscription_id = ? AND opportunity_id = ? AND tool = ?`)
    .run(JSON.stringify(result), subscriptionId, baseOpportunityId(opportunityId), tool);
}

// Frees a reservation whose route refused it outright (a 4xx changes nothing
// at the table), so the same opportunity can take a corrected submission.
export function releaseWebhookWrite(subscriptionId: string, opportunityId: string, tool: string) {
  getDatabase().prepare(`DELETE FROM player_webhook_writes WHERE subscription_id = ? AND opportunity_id = ? AND tool = ? AND result IS NULL`)
    .run(subscriptionId, baseOpportunityId(opportunityId), tool);
}

type Live = { grant: ConnectionGrant; sub: Subscription } | { stopped: StopReason } | { gone: true };

// Whether a subscription still plays, and as which character (issue 654).
// What its owner did (revoked the connection, or an account that cannot
// play now) is gone without a word, as before. What happened at the table
// (the seat moved to another hero, the player left) follows the seat or
// stops with a reason the poll link and Settings show. Following updates the
// row and drops deliveries queued for the old character.
function liveSubscription(sub: Subscription): Live {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM agent_grants WHERE id = ?`)
    .get(sub.grant_id) as { id: string; user_id: string; name: string; scopes_json: string; campaign_id: string | null; created_at: string; expires_at: string; revoked_at: string | null } | undefined;
  if (!row || row.revoked_at) return { gone: true };
  const grant: ConnectionGrant = {
    id: row.id, userId: row.user_id, name: row.name, scopes: JSON.parse(row.scopes_json), campaignId: row.campaign_id,
    createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: null, revokedAt: null,
  };
  if (row.expires_at <= nowIso()) return { stopped: "expired" };
  const user = grantUser(grant);
  if (!user || user.mustChangePassword || user.deletionRequestedAt) return { gone: true };
  if (!grant.scopes.includes("read") || !grant.scopes.includes("play") || (grant.campaignId && grant.campaignId !== sub.campaign_id)) return { gone: true };
  const campaign = getCampaignForUser(sub.campaign_id, grant.userId);
  const sheet = getSheetById(sub.character_id);
  const subscribed = sheet && sheet.campaignId === sub.campaign_id && sheet.userId === grant.userId ? sheet : null;
  const current = campaign ? getSheetForUser(sub.campaign_id, grant.userId) : null;
  const currentClaimed = Boolean(current && current.id !== sub.character_id &&
    db.prepare(`SELECT 1 FROM player_webhooks WHERE campaign_id = ? AND character_id = ? AND id <> ?`).get(sub.campaign_id, current.id, sub.id));
  const verdict = seatVerdict({ member: Boolean(campaign), multiCharacter: campaign?.gameSettings.multiCharacter ?? "off", subscribed, current, currentClaimed });
  if (verdict.kind === "stop") return { stopped: verdict.reason };
  if (verdict.kind === "keep") return { grant, sub };
  try {
    db.transaction(() => {
      db.prepare(`UPDATE player_webhooks SET character_id = ? WHERE id = ?`).run(verdict.characterId, sub.id);
      db.prepare(`UPDATE player_webhook_deliveries SET state = 'cancelled' WHERE subscription_id = ? AND state = 'pending'`).run(sub.id);
    })();
  } catch {
    // Another link took the hero in the meantime (one per character).
    return { stopped: "character_changed" };
  }
  return { grant, sub: { ...sub, character_id: verdict.characterId } };
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
  // A table break (src/lib/dm/table-break.ts) holds the queue in memory; its
  // events say the same across a restart, as the X-card's do.
  const tableBreak = db.prepare(`SELECT seq, type FROM campaign_events WHERE campaign_id = ?
    AND type IN ('table_paused', 'table_resumed') ORDER BY seq DESC LIMIT 1`).get(campaign.id) as { seq: number; type: string } | undefined;
  // Between sessions (src/lib/dm/session-hold.ts), the same.
  const session = db.prepare(`SELECT seq, type FROM campaign_events WHERE campaign_id = ?
    AND type IN ('session_ended', 'session_started') ORDER BY seq DESC LIMIT 1`).get(campaign.id) as { seq: number; type: string } | undefined;
  const paused = Boolean(dmQueuePaused(campaign.id)) || safety?.type === "x_card" || tableBreak?.type === "table_paused" || session?.type === "session_ended" || campaign.floor.mode === "hold";
  // Read from the same events and the same in-memory gate the routes' 409s
  // come from (src/lib/dm/table-break.ts), so a poll and a refused action
  // name one reason (issue 654).
  const pausedFor: PausedFor | undefined = !paused ? undefined
    : session?.type === "session_ended" || dmQueuePausedFor(campaign.id, SESSION_REASON) ? "session"
    : tableBreak?.type === "table_paused" || dmQueuePausedFor(campaign.id, BREAK_REASON) ? "break"
    : safety?.type === "x_card" ? "safety"
    : campaign.floor.mode === "hold" ? "hold" : "pause";
  const running = db.prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' AND status = 'running' LIMIT 1`).get(campaign.id);
  const awaiting = db.prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' AND status = 'awaiting_rolls' LIMIT 1`).get(campaign.id);
  const status = getDmStatus(campaign.id);
  const encounter = getActiveEncounter(campaign.id);
  const entry = encounter?.order[encounter.turnIndex];
  const narration = getLatestDmMessage(campaign.id);
  const last = db.prepare(`SELECT MAX(seq) AS seq FROM campaign_messages WHERE campaign_id = ? AND user_id = ? AND author_type = 'player' AND content NOT LIKE '(ooc) %'`)
    .get(campaign.id, grant.userId) as { seq: number | null };
  // A pass at a table that waits for everyone (src/lib/dm/table-wait.ts)
  // answers the passage as surely as a post does.
  const passed = db.prepare(`SELECT MAX(seq) AS seq FROM campaign_events WHERE campaign_id = ? AND type = 'table_pass' AND json_extract(payload_json, '$.userId') = ?`)
    .get(campaign.id, grant.userId) as { seq: number | null };
  const held = db.prepare(`SELECT MAX(seq) AS seq FROM campaign_events WHERE campaign_id = ? AND type = 'floor_changed' AND json_extract(payload_json, '$.floor.mode') = 'hold'`)
    .get(campaign.id) as { seq: number | null };
  const gate = Math.max(held.seq ?? 0, safety?.seq ?? 0, tableBreak?.seq ?? 0, session?.seq ?? 0);
  const sheet = getSheetForUser(campaign.id, grant.userId);
  const busy = Boolean(running) || !["idle", "awaiting_rolls"].includes(status);
  const input: OpportunityState = {
    active: campaign.status === "active", paused, busy,
    awaitingRolls: Boolean(awaiting) || status === "awaiting_rolls",
    floor: campaign.floor, floorSeq: spotlightSeq(campaign.id), userId: grant.userId, characterId: sub.character_id,
    rolls: listOpenPendingRolls(campaign.id),
    turn: encounter?.orderReady && entry?.kind === "pc" ? {
      id: encounter.id, characterId: entry.characterId, userId: entry.userId, key: turnKey(encounter), waitingSeq: encounter.waitingSeq,
    } : null,
    narration, lastPlayerSeq: Math.max(last.seq ?? 0, passed.seq ?? 0),
    level: sheet?.id === sub.character_id && !sheet.isCompanion ? { current: sheet.level, earned: Math.min(20, levelForXp(sheet.xp)) } : null,
    offers: listOpenItemProposals(campaign.id)
      .filter((offer) => (offer.toolName === "trade" ? offer.toCharacterId === sub.character_id : offer.characterId === sub.character_id && offer.userId === grant.userId))
      .map((offer) => offer.id),
    // A whisper stays a decision until it is answered. Reading it through
    // odm_get_whispers marks nothing read, so an agent's answer ends it: a
    // whisper back, or a guarded write to it that went through.
    unreadWhisperId:
      (db.prepare(`SELECT w.id FROM dm_whispers w WHERE w.campaign_id = ? AND w.user_id = ? AND w.read = 0 AND w.direction = 'to_player'
        AND NOT EXISTS (SELECT 1 FROM dm_whispers r WHERE r.campaign_id = w.campaign_id AND r.user_id = w.user_id AND r.direction = 'to_dm' AND r.created_at > w.created_at)
        AND NOT EXISTS (SELECT 1 FROM player_webhook_writes x WHERE x.subscription_id = ? AND x.opportunity_id LIKE 'whisper:' || w.id || ':%' AND x.result IS NOT NULL AND x.tool <> ?)
        ORDER BY w.created_at DESC, w.id DESC LIMIT 1`)
        .get(campaign.id, grant.userId, sub.id, REFUSED) as { id: string } | undefined)?.id ?? null,
  };
  const opportunities = playerOpportunities(input);
  const refused = new Set((db.prepare(`SELECT opportunity_id FROM player_webhook_writes WHERE subscription_id = ? AND tool = ?`)
    .all(sub.id, REFUSED) as Array<{ opportunity_id: string }>).map((row) => row.opportunity_id));
  // A pause or hold re-invites a table decision it interrupted. A level is
  // the same decision before and after one, so it keeps its ID. A decision
  // a write to it was refused for goes by "<id>:again" (issue 653).
  return {
    opportunities: opportunities.map((o) => {
      const id = o.type === "level_up_available" ? o.opportunityId : `${o.opportunityId}:gate:${gate}`;
      return { ...o, opportunityId: refused.has(id) ? `${id}${AGAIN_SUFFIX}` : id };
    }),
    busy,
    // The guard's own bookkeeping: this character's turn whatever its step,
    // so an End turn can be taken while the GM resolves the last one.
    turnId: turnIdentity(input), gate,
    lifecycle: campaign.status === "ended" ? "ended" : campaign.status !== "active" || paused ? "paused" : "active",
    pausedFor: campaign.status === "active" ? pausedFor : undefined,
  };
}

export type PausedFor = "session" | "break" | "safety" | "hold" | "pause";

function enqueue(sub: Subscription, grant: ConnectionGrant, opportunity: { type: PlayerWebhookEvent["type"]; opportunityId: string; pendingRollId?: string; phase?: "act" | "finish"; level?: number; proposalId?: string }, now: number) {
  // Every tick offers every open opportunity again. Only a new or cancelled
  // one is written, so skip building its text (a campaign and sheet read).
  const queued = getDatabase().prepare(`SELECT state FROM player_webhook_deliveries WHERE subscription_id = ? AND opportunity_id = ?`)
    .get(sub.id, opportunity.opportunityId) as { state: string } | undefined;
  if (queued && queued.state !== "cancelled") return;
  const fields: Omit<PlayerWebhookEvent, "text"> = {
    version: 1, eventId: randomUUID(), subscriptionId: sub.id, campaignId: sub.campaign_id,
    playerId: grant.userId, characterId: sub.character_id, ...opportunity,
    seq: latestSeq(sub.campaign_id), occurredAt: new Date(now).toISOString(),
  };
  const event: PlayerWebhookEvent = { ...fields, text: eventText(sub, grant, fields) };
  getDatabase().prepare(`INSERT OR IGNORE INTO player_webhook_deliveries
    (id, subscription_id, opportunity_id, body, state, attempts, available_at, created_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
    ON CONFLICT(subscription_id, opportunity_id) DO UPDATE SET id = excluded.id, body = excluded.body,
      state = 'pending', attempts = 0, available_at = excluded.available_at, created_at = excluded.created_at
      WHERE player_webhook_deliveries.state = 'cancelled'`).run(event.eventId, sub.id, event.opportunityId, JSON.stringify(event), now, now);
}

// Names and IDs only: no prose, dice or notes, the same as the event itself.
function eventText(sub: Subscription, grant: ConnectionGrant, event: Omit<PlayerWebhookEvent, "text">): string {
  const title = (getCampaignForUser(sub.campaign_id, grant.userId)?.title ?? "your campaign").slice(0, 200);
  const sheet = getSheetById(sub.character_id);
  const who = sheet && sheet.userId === grant.userId ? sheet.name.slice(0, 100) : "Your character";
  const at = `"${title}"`;
  const what = event.type === "roll_requested" ? `a roll is waiting for you in ${at}.`
    : event.type === "turn_started" ? (event.phase === "finish"
      ? `your action in ${at} is resolved: spend what your turn has left (moving, a bonus action, Action Surge) or end it with odm_end_turn.`
      : `it is your turn in combat in ${at}.`)
    : event.type === "response_requested" ? `the table in ${at} may want your response.`
    : event.type === "level_up_available" ? `your experience in ${at} has earned level ${event.level}. Answer any roll or turn first, then read odm_level_up_options and take it with odm_level_up.`
    : event.type === "offer_received" ? `an offer in ${at} waits on your answer alone. Read it in odm_get_campaign (itemProposals, id ${event.proposalId}) and answer it with odm_answer_offer.`
    : event.type === "whisper_received" ? `the Game Master whispered to you in ${at}. Read it with odm_get_whispers.`
    : event.type === "campaign_paused" ? `${at} is paused.`
    : event.type === "campaign_resumed" ? `${at} has resumed.`
    : `${at} has ended.`;
  return `${who}: ${what} Read the table with your ODM tools before acting. Event: ${JSON.stringify(event)}`;
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

// State reconciliation is deliberately independent of ephemeral callbacks:
// a crash after a game mutation and before publishing, or a parked turn
// restored after restart, still reaches the outbox. It never sends prose,
// enemy statistics, dice results, notes or an ODM bearer token. A receiver's
// own Authorization value goes only in that header, to that receiver.
export async function runPlayerWebhooksOnce(now = Date.now(), send: typeof fetch = fetch) {
  const db = getDatabase();
  // A poll link is asked, never sent to: nothing to deliver.
  const subs = db.prepare(`SELECT * FROM player_webhooks WHERE poll_token_hash IS NULL`).all() as Subscription[];
  for (const found of subs) {
    const live = liveSubscription(found);
    if ("gone" in live) {
      deletePlayerWebhook(found.grant_id, found.id);
      continue;
    }
    if ("stopped" in live) {
      stopPlayerWebhook(found, live.stopped);
      continue;
    }
    const { sub, grant } = live;
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
      const again = liveSubscription(sub);
      const fresh = "grant" in again && again.sub.character_id === sub.character_id ? stateFor(again.sub, again.grant) : null;
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
            "X-ODM-Timestamp": timestamp, "X-ODM-Signature": webhookSignature(sub.secret, timestamp, delivery.body),
            ...parseHeaders(sub.extra_headers),
            ...(sub.authorization_header ? { Authorization: sub.authorization_header } : {}) },
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
