// Wait for the table (gameSettings.waitForTable): the half that reads the
// database and keeps the timer. The decision itself is pure and lives in
// ./table-wait-logic.ts.
//
// The window a held turn answers opens where the last AI turn began reading
// the transcript, so a post made while the DM was still writing counts for
// the next turn rather than waking a follow-up the moment the narration
// lands. That point is kept in memory; after a restart the latest narration
// stands in for it.
//
// Passes are persisted table_pass events, so the agent webhook state
// (src/lib/agents/webhooks.ts) can read a pass the same way it reads a post.
import { campaignSeats, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getDatabase, nowIso } from "@/lib/db/core";
import { getLatestDmMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { coverInEffect } from "@/lib/dm/delegation";
import { getDmStatus } from "@/lib/dm/status";
import { hasHumanDm } from "@/lib/dm/viewer";
import { wakeDm } from "@/lib/dm/wake";
import { latestEventOfType, onlineUserIds, publishEphemeral, publishPersisted } from "@/lib/events";
import { tableBreakOn } from "@/lib/dm/table-break";
import { breakRefusal } from "@/lib/dm/table-break-logic";
import { runsAiTurns } from "@/lib/workshop/kind";
import { decideTableWait, type TableSeat, type TableWaitDecision, type TableWaitView } from "./table-wait-logic";

export type { TableWaitView } from "./table-wait-logic";

type WaitMemory = { readSeq?: number; timer?: ReturnType<typeof setTimeout>; deadline?: number; published?: string };

declare global {
  var __odmTableWait: Map<string, WaitMemory> | undefined;
}

function memory(campaignId: string): WaitMemory {
  const all = (globalThis.__odmTableWait ??= new Map<string, WaitMemory>());
  let entry = all.get(campaignId);
  if (!entry) {
    entry = {};
    all.set(campaignId, entry);
  }
  return entry;
}

// Whether this table holds its AI turns for the table at all, whatever the
// floor is doing. A person in the DM seat reads each post as it lands, so
// only an AI-run table (or a running cover) waits.
//
// A table break (src/lib/dm/table-break.ts) stands the wait aside: nobody
// can answer while the table is paused, so no clock runs and nothing fires;
// Resume settles the table again, with the clock counted from then.
export function waitsForTable(campaign: Campaign): boolean {
  if (!campaign.gameSettings.waitForTable || !runsAiTurns(campaign) || campaign.status !== "active" || tableBreakOn(campaign.id)) {
    return false;
  }
  const covering = coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover);
  return !hasHumanDm(campaignSeats(campaign)) || covering;
}

// The player seats, one per person, named by their first character.
function playerSeats(campaign: Campaign): TableSeat[] {
  const seats = new Map<string, string>();
  for (const sheet of listSheets(campaign.id)) {
    if (sheet.isCompanion || !sheet.userId || sheet.userId === campaign.dmUserId || seats.has(sheet.userId)) {
      continue;
    }
    seats.set(sheet.userId, sheet.name);
  }
  return [...seats].map(([userId, name]) => ({ userId, name }));
}

// Players reached through a live agent subscription (a webhook or a poll
// link) are at the table even with no tab open.
function agentUserIds(campaignId: string): string[] {
  const rows = getDatabase()
    .prepare(
      `SELECT DISTINCT g.user_id AS userId FROM player_webhooks w JOIN agent_grants g ON g.id = w.grant_id
       WHERE w.campaign_id = ? AND g.revoked_at IS NULL AND g.expires_at > ?`,
    )
    .all(campaignId, nowIso()) as Array<{ userId: string }>;
  return rows.map((row) => row.userId);
}

// The seq after which posts and passes count for the held turn, and when the
// window opened. Null when there is no narration to answer yet.
function windowFor(campaignId: string): { since: number; openedAt: number } | null {
  const narration = getLatestDmMessage(campaignId);
  if (!narration) {
    return null;
  }
  const readSeq = memory(campaignId).readSeq;
  // A break taken since the narration spent none of the table's time: the
  // clock counts from the latest Resume when that came later.
  const resumed = Number((latestEventOfType(campaignId, ["table_resumed"])?.payload as { at?: unknown } | null)?.at);
  return {
    since: readSeq ?? narration.seq,
    openedAt: Math.max(new Date(narration.createdAt).getTime(), Number.isFinite(resumed) ? resumed : 0),
  };
}

function decisionFor(campaignId: string, now: number): TableWaitDecision | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign || !waitsForTable(campaign) || campaign.floor.mode !== "open") {
    return null;
  }
  const window = windowFor(campaignId);
  if (!window) {
    return null;
  }
  const db = getDatabase();
  const seats = playerSeats(campaign);
  const names = new Map(seats.map((seat) => [seat.userId, seat.name]));
  const sheetNames = new Map(listSheets(campaignId).map((sheet) => [sheet.id, sheet.name]));
  const posts = (
    db
      .prepare(
        `SELECT user_id AS userId, character_id AS characterId, created_at AS createdAt FROM campaign_messages
         WHERE campaign_id = ? AND seq > ? AND author_type = 'player' AND user_id IS NOT NULL AND content NOT LIKE '(ooc) %'
         ORDER BY seq ASC`,
      )
      .all(campaignId, window.since) as Array<{ userId: string; characterId: string | null; createdAt: string }>
  ).map((row) => ({
    userId: row.userId,
    name: names.get(row.userId) ?? sheetNames.get(row.characterId ?? "") ?? "A player",
    at: new Date(row.createdAt).getTime(),
  }));
  const passes = (
    db
      .prepare(`SELECT payload_json AS payload, created_at AS createdAt FROM campaign_events WHERE campaign_id = ? AND type = 'table_pass' AND seq > ? ORDER BY seq ASC`)
      .all(campaignId, window.since) as Array<{ payload: string; createdAt: string }>
  )
    .map((row) => ({
      userId: String((JSON.parse(row.payload) as { userId?: unknown }).userId ?? ""),
      at: new Date(row.createdAt).getTime(),
    }))
    .filter((pass) => pass.userId)
    .map((pass) => ({ ...pass, name: names.get(pass.userId) ?? "A player" }));
  const here = new Set([...onlineUserIds(campaignId), ...agentUserIds(campaignId)]);
  return decideTableWait({
    present: seats.filter((seat) => here.has(seat.userId)),
    posts,
    passes,
    openedAt: window.openedAt,
    seconds: campaign.gameSettings.waitForTableSeconds,
    now,
  });
}

// What the snapshot carries: who the DM waits on right now, or null when
// the table is not waiting (the setting is off, the floor is not open, or a
// turn is running).
export function currentTableWait(campaignId: string, now = Date.now()): TableWaitView | null {
  if (getDmStatus(campaignId) !== "idle") {
    return null;
  }
  const decision = decisionFor(campaignId, now);
  return decision?.gathering ? decision.view : null;
}

function publishView(campaignId: string, view: TableWaitView | null) {
  const entry = memory(campaignId);
  const serialized = JSON.stringify(view);
  if (entry.published === serialized) {
    return;
  }
  entry.published = serialized;
  publishEphemeral(campaignId, "table_wait", { wait: view });
}

function clearTimer(entry: WaitMemory) {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = undefined;
  entry.deadline = undefined;
}

// Re-reads the table, tells every seat who the DM waits on, and keeps the
// timer on the deadline. Returns true when the held turn should run now;
// the caller wakes the DM (the timer wakes it itself).
//
// After a restart nobody's tab has reconnected yet, so an empty table there
// means "not back yet" rather than "everyone answered": holdUntilDeadline
// keeps such a table waiting for its clock.
export function settleTableWait(campaignId: string, now = Date.now(), holdUntilDeadline = false): boolean {
  // A turn is already requested or running (a released spotlight's answers,
  // say): it reads everything so far, and the gather opens again only once
  // its narration lands, when turn.ts settles the table.
  if (getDmStatus(campaignId) !== "idle") {
    publishView(campaignId, null);
    return false;
  }
  const decided = decisionFor(campaignId, now);
  const decision =
    decided && decided.fire && holdUntilDeadline && decided.deadline !== null && now < decided.deadline
      ? { ...decided, fire: false }
      : decided;
  const entry = memory(campaignId);
  // A player alone at the table is answered as they post: no banner, no Pass.
  publishView(campaignId, decision && !decision.fire && decision.gathering ? decision.view : null);
  if (!decision || decision.fire || decision.deadline === null) {
    clearTimer(entry);
    return decision?.fire ?? false;
  }
  if (entry.deadline !== decision.deadline) {
    clearTimer(entry);
    entry.deadline = decision.deadline;
    // Node timers fire late, never early; the decision is re-read when it
    // does, so a table that changed in between is judged as it is then.
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      entry.deadline = undefined;
      if (settleTableWait(campaignId)) {
        wakeDm(campaignId);
      }
    }, Math.max(0, decision.deadline - now) + 50);
    entry.timer.unref?.();
  }
  return false;
}

// Whether a held beat has anything for the DM to answer yet: the lead's
// "go on now" (the floor route's release) wakes the DM only then.
export function tableWaitHasAnswers(campaignId: string): boolean {
  return getDmStatus(campaignId) === "idle" && (decisionFor(campaignId, Date.now())?.deadline ?? null) !== null;
}

// The DM turn is about to read the transcript: everything up to here is
// answered, and the next window opens after it.
export function tableWaitTurnStarted(campaignId: string, readSeq: number) {
  const entry = memory(campaignId);
  entry.readSeq = readSeq;
  clearTimer(entry);
  publishView(campaignId, null);
}

export type PassResult = { ok: true; fire: boolean } | { ok: false; status: number; error: string };

// A player says "go on without me" for this beat. Refused where there is no
// waiting to pass on, and once the player has already acted or passed.
export function passTable(campaignId: string, userId: string): PassResult {
  const campaign = getCampaignById(campaignId);
  const paused = tableBreakOn(campaignId);
  if (paused) {
    return { ok: false, status: 409, error: breakRefusal(paused) };
  }
  if (!campaign || !waitsForTable(campaign)) {
    return { ok: false, status: 409, error: "This table does not wait for everyone, so there is nothing to pass." };
  }
  if (campaign.floor.mode !== "open") {
    return { ok: false, status: 409, error: "Only an open table waits for passes." };
  }
  if (getDmStatus(campaignId) !== "idle") {
    return { ok: false, status: 409, error: "The DM is answering now. Pass after the narration if you have nothing to add." };
  }
  const decision = decisionFor(campaignId, Date.now());
  if (!decision) {
    return { ok: false, status: 409, error: "The DM is not waiting on the table yet." };
  }
  if (!decision.gathering) {
    return { ok: false, status: 409, error: "Nobody else is at the table to wait for: your post is answered as it lands." };
  }
  if (decision.view.answered.some((seat) => seat.userId === userId)) {
    return { ok: false, status: 409, error: "You have already answered this beat." };
  }
  if (!playerSeats(campaign).some((seat) => seat.userId === userId)) {
    return { ok: false, status: 400, error: "You need a character to pass." };
  }
  publishPersisted(campaignId, "table_pass", { userId });
  return { ok: true, fire: settleTableWait(campaignId) };
}

// After a restart the timers are gone: re-read every waiting table once so
// a deadline that passed while the server was down fires now.
export function rearmTableWaits(): number {
  const rows = getDatabase()
    .prepare(`SELECT id FROM campaigns WHERE status = 'active' AND json_extract(game_settings_json, '$.waitForTable') = 1`)
    .all() as Array<{ id: string }>;
  let woken = 0;
  for (const row of rows) {
    if (settleTableWait(row.id, Date.now(), true)) {
      wakeDm(row.id);
      woken += 1;
    }
  }
  return woken;
}
