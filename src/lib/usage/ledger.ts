import fs from "node:fs";
import path from "node:path";
import { getDatabase, nowIso } from "@/lib/db/core";
import { campaignFilePaths, filePathsIn } from "@/lib/image-files";
import { currentUsageScope } from "@/lib/usage/scope";

// The usage ledger (issue #137): one row per AI call, counted from what the
// backend reported. No prompt, no transcript, no picture: kind, backend,
// model, tokens, units and who it was for, which is all an admin planning
// capacity or sharing a key needs. Costs are deliberately not estimated;
// with this many backends and models there is no honest number, so the
// admin reads tokens and applies their own prices.

export type UsageKind = "text" | "image" | "tts" | "stt" | "agent";

export type UsageEvent = {
  kind: UsageKind;
  // story, utility, portrait, cover, map, narration, preview, dictation
  role?: string;
  // local, custom, openai, openrouter, harness, comfyui, kokoro, whisper, builtin
  backend?: string;
  model?: string;
  // Spent on the host's key or plan, as opposed to a local server.
  paid: boolean;
  inputTokens?: number;
  outputTokens?: number;
  // Pictures, speech characters, dictation clips.
  units?: number;
  durationMs?: number;
  campaignId?: string;
  userId?: string;
};

export function recordUsage(event: UsageEvent): void {
  try {
    const scope = currentUsageScope();
    getDatabase()
      .prepare(
        `INSERT INTO usage_events
           (at, campaign_id, user_id, kind, role, backend, model, paid, input_tokens, output_tokens, units, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowIso(),
        event.campaignId ?? scope.campaignId ?? null,
        event.userId ?? scope.userId ?? null,
        event.kind,
        (event.role ?? "").slice(0, 40),
        (event.backend ?? "").slice(0, 40),
        (event.model ?? "").slice(0, 200),
        event.paid ? 1 : 0,
        Math.max(0, Math.round(event.inputTokens ?? 0)),
        Math.max(0, Math.round(event.outputTokens ?? 0)),
        Math.max(0, event.units ?? 0),
        Math.max(0, Math.round(event.durationMs ?? 0)),
      );
  } catch (error) {
    // Bookkeeping must never cost a table its turn.
    console.error("[usage] could not record", error);
  }
}

// ---- the admin's overview ----

export type UsageTotals = {
  calls: number;
  // Text and agent tokens, split by who pays.
  paidInputTokens: number;
  paidOutputTokens: number;
  localInputTokens: number;
  localOutputTokens: number;
  paidImages: number;
  localImages: number;
  paidSpeechChars: number;
  localSpeechChars: number;
  paidDictationClips: number;
  localDictationClips: number;
  agentTurns: number;
  lastAt: string | null;
};

export type CampaignUsage = UsageTotals & {
  campaignId: string;
  title: string;
  kind: string;
  status: string;
  ownerUserId: string;
  leadUserId: string;
  leadUsername: string;
  members: number;
  characters: number;
  turns: number;
  activeDays: number;
  createdAt: string;
  lastActivityAt: string | null;
  storageBytes: number;
};

export type AccountUsage = UsageTotals & {
  userId: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  campaignsOwned: number;
  campaignsLed: number;
  campaignsJoined: number;
  libraryCharacters: number;
  lastActivityAt: string | null;
  storageBytes: number;
};

const EMPTY: UsageTotals = {
  calls: 0,
  paidInputTokens: 0,
  paidOutputTokens: 0,
  localInputTokens: 0,
  localOutputTokens: 0,
  paidImages: 0,
  localImages: 0,
  paidSpeechChars: 0,
  localSpeechChars: 0,
  paidDictationClips: 0,
  localDictationClips: 0,
  agentTurns: 0,
  lastAt: null,
};

type TotalsRow = {
  key: string | null;
  calls: number;
  paid_in: number;
  paid_out: number;
  local_in: number;
  local_out: number;
  paid_images: number;
  local_images: number;
  paid_speech: number;
  local_speech: number;
  paid_clips: number;
  local_clips: number;
  agent_turns: number;
  last_at: string | null;
};

const TOTALS_SELECT = `
  COUNT(*) AS calls,
  SUM(CASE WHEN paid = 1 AND kind IN ('text','agent') THEN input_tokens ELSE 0 END) AS paid_in,
  SUM(CASE WHEN paid = 1 AND kind IN ('text','agent') THEN output_tokens ELSE 0 END) AS paid_out,
  SUM(CASE WHEN paid = 0 AND kind IN ('text','agent') THEN input_tokens ELSE 0 END) AS local_in,
  SUM(CASE WHEN paid = 0 AND kind IN ('text','agent') THEN output_tokens ELSE 0 END) AS local_out,
  SUM(CASE WHEN paid = 1 AND kind = 'image' THEN units ELSE 0 END) AS paid_images,
  SUM(CASE WHEN paid = 0 AND kind = 'image' THEN units ELSE 0 END) AS local_images,
  SUM(CASE WHEN paid = 1 AND kind = 'tts' THEN units ELSE 0 END) AS paid_speech,
  SUM(CASE WHEN paid = 0 AND kind = 'tts' THEN units ELSE 0 END) AS local_speech,
  SUM(CASE WHEN paid = 1 AND kind = 'stt' THEN units ELSE 0 END) AS paid_clips,
  SUM(CASE WHEN paid = 0 AND kind = 'stt' THEN units ELSE 0 END) AS local_clips,
  SUM(CASE WHEN kind = 'agent' THEN 1 ELSE 0 END) AS agent_turns,
  MAX(at) AS last_at`;

function totalsFrom(row: TotalsRow | undefined): UsageTotals {
  if (!row) {
    return { ...EMPTY };
  }
  return {
    calls: row.calls ?? 0,
    paidInputTokens: row.paid_in ?? 0,
    paidOutputTokens: row.paid_out ?? 0,
    localInputTokens: row.local_in ?? 0,
    localOutputTokens: row.local_out ?? 0,
    paidImages: row.paid_images ?? 0,
    localImages: row.local_images ?? 0,
    paidSpeechChars: row.paid_speech ?? 0,
    localSpeechChars: row.local_speech ?? 0,
    paidDictationClips: row.paid_clips ?? 0,
    localDictationClips: row.local_clips ?? 0,
    agentTurns: row.agent_turns ?? 0,
    lastAt: row.last_at ?? null,
  };
}

function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    calls: a.calls + b.calls,
    paidInputTokens: a.paidInputTokens + b.paidInputTokens,
    paidOutputTokens: a.paidOutputTokens + b.paidOutputTokens,
    localInputTokens: a.localInputTokens + b.localInputTokens,
    localOutputTokens: a.localOutputTokens + b.localOutputTokens,
    paidImages: a.paidImages + b.paidImages,
    localImages: a.localImages + b.localImages,
    paidSpeechChars: a.paidSpeechChars + b.paidSpeechChars,
    localSpeechChars: a.localSpeechChars + b.localSpeechChars,
    paidDictationClips: a.paidDictationClips + b.paidDictationClips,
    localDictationClips: a.localDictationClips + b.localDictationClips,
    agentTurns: a.agentTurns + b.agentTurns,
    lastAt: [a.lastAt, b.lastAt].filter((at): at is string => Boolean(at)).sort().at(-1) ?? null,
  };
}

const later = (a: string | null, b: string | null): string | null =>
  [a, b].filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;

// Bytes on disk for a set of /uploads and /generated paths, with the WebP
// copies written beside each picture. A missing file weighs nothing.
export function storageBytesFor(urls: Iterable<string>): number {
  let bytes = 0;
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url) || !(url.startsWith("/uploads/") || url.startsWith("/generated/"))) {
      continue;
    }
    seen.add(url);
    const root = url.startsWith("/generated/") ? "generated" : "uploads";
    const name = url.slice(`/${root}/`.length);
    const dir = path.join(process.cwd(), "public", root);
    let entries: string[] = [];
    try {
      const stem = name.replace(/\.[a-z0-9]+$/i, "");
      entries = fs.readdirSync(dir).filter((file) => file === name || file.startsWith(`${stem}.`) || file.startsWith(`${stem}-`));
    } catch {
      continue;
    }
    for (const file of entries) {
      try {
        bytes += fs.statSync(path.join(dir, file)).size;
      } catch {
        // Gone between the listing and the stat.
      }
    }
  }
  return bytes;
}

// Files an account's own library rows name (characters and their
// portraits); campaign files are the campaign's.
function libraryFilePaths(userId: string): string[] {
  const rows = getDatabase()
    .prepare(`SELECT sheet_json, portrait_json FROM library_characters WHERE user_id = ?`)
    .all(userId) as Array<{ sheet_json: string; portrait_json: string | null }>;
  const found = new Set<string>();
  for (const row of rows) {
    for (const url of [...filePathsIn(row.sheet_json), ...filePathsIn(row.portrait_json)]) {
      found.add(url);
    }
  }
  return [...found];
}

export function usageOverview(): { campaigns: CampaignUsage[]; accounts: AccountUsage[]; generatedAt: string } {
  const db = getDatabase();
  const byCampaign = new Map<string, UsageTotals>();
  for (const row of db
    .prepare(`SELECT campaign_id AS key, ${TOTALS_SELECT} FROM usage_events WHERE campaign_id IS NOT NULL GROUP BY campaign_id`)
    .all() as TotalsRow[]) {
    byCampaign.set(row.key!, totalsFrom(row));
  }
  // Work done outside any campaign (library portraits, dictation on the
  // home page) is the account's own.
  const byUserOutsideCampaigns = new Map<string, UsageTotals>();
  for (const row of db
    .prepare(`SELECT user_id AS key, ${TOTALS_SELECT} FROM usage_events WHERE campaign_id IS NULL AND user_id IS NOT NULL GROUP BY user_id`)
    .all() as TotalsRow[]) {
    byUserOutsideCampaigns.set(row.key!, totalsFrom(row));
  }

  const campaignRows = db
    .prepare(
      `SELECT c.id, c.title, c.kind, c.status, c.owner_user_id, c.party_lead_user_id, c.created_at, c.updated_at,
         (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS members,
         (SELECT COUNT(*) FROM character_sheets s WHERE s.campaign_id = c.id) AS characters,
         (SELECT COUNT(*) FROM dm_turns t WHERE t.campaign_id = c.id) AS turns,
         (SELECT COUNT(DISTINCT substr(t.created_at, 1, 10)) FROM dm_turns t WHERE t.campaign_id = c.id) AS active_days,
         (SELECT MAX(created_at) FROM campaign_messages g WHERE g.campaign_id = c.id) AS last_message_at
       FROM campaigns c
       ORDER BY c.updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    kind: string | null;
    status: string;
    owner_user_id: string;
    party_lead_user_id: string | null;
    created_at: string;
    updated_at: string;
    members: number;
    characters: number;
    turns: number;
    active_days: number;
    last_message_at: string | null;
  }>;
  const users = db
    .prepare(`SELECT id, username, is_admin, created_at FROM users WHERE id NOT LIKE 'comp\\_%' ESCAPE '\\' ORDER BY created_at ASC`)
    .all() as Array<{ id: string; username: string; is_admin: number; created_at: string }>;
  const usernames = new Map(users.map((user) => [user.id, user.username]));

  const campaigns: CampaignUsage[] = campaignRows.map((row) => {
    const leadUserId = row.party_lead_user_id ?? row.owner_user_id;
    return {
      ...(byCampaign.get(row.id) ?? EMPTY),
      campaignId: row.id,
      title: row.title,
      kind: row.kind ?? "campaign",
      status: row.status,
      ownerUserId: row.owner_user_id,
      leadUserId,
      leadUsername: usernames.get(leadUserId) ?? "",
      members: row.members,
      characters: row.characters,
      turns: row.turns,
      activeDays: row.active_days,
      createdAt: row.created_at,
      lastActivityAt: later(row.last_message_at, row.updated_at),
      storageBytes: storageBytesFor(campaignFilePaths(row.id)),
    };
  });

  const memberships = db
    .prepare(`SELECT user_id, COUNT(*) AS n FROM campaign_members GROUP BY user_id`)
    .all() as Array<{ user_id: string; n: number }>;
  const joined = new Map(memberships.map((row) => [row.user_id, row.n]));
  const libraryCounts = db
    .prepare(`SELECT user_id, COUNT(*) AS n, MAX(updated_at) AS last_at FROM library_characters GROUP BY user_id`)
    .all() as Array<{ user_id: string; n: number; last_at: string | null }>;
  const library = new Map(libraryCounts.map((row) => [row.user_id, row]));
  const lastWords = db
    .prepare(`SELECT user_id, MAX(created_at) AS last_at FROM campaign_messages WHERE user_id IS NOT NULL GROUP BY user_id`)
    .all() as Array<{ user_id: string; last_at: string | null }>;
  const lastWord = new Map(lastWords.map((row) => [row.user_id, row.last_at]));

  const accounts: AccountUsage[] = users.map((user) => {
    const led = campaigns.filter((campaign) => campaign.leadUserId === user.id);
    const owned = campaigns.filter((campaign) => campaign.ownerUserId === user.id);
    // What the lead's tables spent answers to the lead (the policy's rule),
    // plus what the account spent on its own.
    let totals = byUserOutsideCampaigns.get(user.id) ?? { ...EMPTY };
    for (const campaign of led) {
      totals = addTotals(totals, campaign);
    }
    const lib = library.get(user.id);
    let lastActivityAt = later(lastWord.get(user.id) ?? null, lib?.last_at ?? null);
    for (const campaign of led) {
      lastActivityAt = later(lastActivityAt, campaign.lastActivityAt);
    }
    return {
      ...totals,
      userId: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1,
      createdAt: user.created_at,
      campaignsOwned: owned.length,
      campaignsLed: led.length,
      campaignsJoined: joined.get(user.id) ?? 0,
      libraryCharacters: lib?.n ?? 0,
      lastActivityAt,
      storageBytes:
        storageBytesFor(libraryFilePaths(user.id)) + owned.reduce((sum, campaign) => sum + campaign.storageBytes, 0),
    };
  });

  return { campaigns, accounts, generatedAt: nowIso() };
}

// An account erased takes its ledger rows with it; a campaign's rows stay
// on the campaign's id for the admin's history.
export function forgetUsageFor(userId: string): void {
  getDatabase().prepare(`UPDATE usage_events SET user_id = NULL WHERE user_id = ?`).run(userId);
}
