import { randomInt } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeSettings } from "@/lib/db";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import type {
  CampaignDifficulty,
  CampaignMember,
  CampaignStatus,
  CampaignSummary,
} from "@/lib/campaign-types";
import type { StorySettings } from "@/lib/types";

export type Campaign = CampaignSummary & {
  scene: string;
  questLog: string[];
  settings: StorySettings;
};

type CampaignRow = {
  id: string;
  title: string;
  description: string;
  invite_code: string;
  owner_user_id: string;
  status: CampaignStatus;
  max_players: number;
  starting_level: number;
  difficulty: CampaignDifficulty;
  theme: string;
  settings_json: string;
  scene: string;
  quest_log_json: string;
  created_at: string;
  updated_at: string;
  player_count?: number;
  member_role?: "owner" | "player";
};

// Unambiguous alphabet: no 0/O, 1/I lookalikes.
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateInviteCode() {
  return Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join(
    "",
  );
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    inviteCode: row.invite_code,
    maxPlayers: row.max_players,
    startingLevel: row.starting_level,
    difficulty: row.difficulty,
    theme: row.theme,
    ownerUserId: row.owner_user_id,
    playerCount: Number(row.player_count ?? 0),
    role: row.member_role ?? (row.owner_user_id ? "player" : "player"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scene: row.scene,
    questLog: parseJson<string[]>(row.quest_log_json, []),
    settings: normalizeSettings(parseJson(row.settings_json, {})),
  };
}

const CAMPAIGN_SELECT = `
  SELECT
    c.*,
    (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS player_count
  FROM campaigns c
`;

export function createCampaign(
  ownerUserId: string,
  input: {
    title: string;
    description: string;
    theme: string;
    maxPlayers: number;
    startingLevel: number;
    difficulty: CampaignDifficulty;
  },
): Campaign {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = nowIso();

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO campaigns (
          id, title, description, invite_code, owner_user_id, status,
          max_players, starting_level, difficulty, theme, settings_json,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'lobby', ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.title,
      input.description,
      generateInviteCode(),
      ownerUserId,
      input.maxPlayers,
      input.startingLevel,
      input.difficulty,
      input.theme,
      JSON.stringify(configuredDefaultStorySettings()),
      now,
      now,
    );
    db.prepare(
      `INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at) VALUES (?, ?, 'owner', 0, ?)`,
    ).run(id, ownerUserId, now);
  })();

  const campaign = getCampaignForUser(id, ownerUserId);
  if (!campaign) {
    throw new Error("Failed to create campaign.");
  }
  return campaign;
}

export function listCampaignsForUser(userId: string): CampaignSummary[] {
  const rows = getDatabase()
    .prepare(
      `
        ${CAMPAIGN_SELECT}
        JOIN campaign_members me ON me.campaign_id = c.id AND me.user_id = ?
        ORDER BY c.updated_at DESC
      `,
    )
    .all(userId) as CampaignRow[];

  return rows.map((row) => {
    const campaign = mapCampaign(row);
    campaign.role = row.owner_user_id === userId ? "owner" : "player";
    return campaign;
  });
}

// Returns the campaign only if the user is a member; role reflects the user.
export function getCampaignForUser(campaignId: string, userId: string): Campaign | null {
  const row = getDatabase()
    .prepare(
      `
        ${CAMPAIGN_SELECT}
        JOIN campaign_members me ON me.campaign_id = c.id AND me.user_id = ?
        WHERE c.id = ?
      `,
    )
    .get(userId, campaignId) as CampaignRow | undefined;

  if (!row) {
    return null;
  }
  const campaign = mapCampaign(row);
  campaign.role = row.owner_user_id === userId ? "owner" : "player";
  return campaign;
}

export function getCampaignById(campaignId: string): Campaign | null {
  const row = getDatabase()
    .prepare(`${CAMPAIGN_SELECT} WHERE c.id = ?`)
    .get(campaignId) as CampaignRow | undefined;
  return row ? mapCampaign(row) : null;
}

export function listMembers(campaignId: string): CampaignMember[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT m.user_id, u.username, m.role, m.ready, m.joined_at
        FROM campaign_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.campaign_id = ?
        ORDER BY m.joined_at ASC
      `,
    )
    .all(campaignId) as Array<{
    user_id: string;
    username: string;
    role: "owner" | "player";
    ready: number;
    joined_at: string;
  }>;

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    role: row.role,
    ready: Boolean(row.ready),
    joinedAt: row.joined_at,
  }));
}

export function joinByInviteCode(
  userId: string,
  inviteCode: string,
): { campaign: Campaign } | { error: string } {
  const db = getDatabase();
  const row = db
    .prepare(`${CAMPAIGN_SELECT} WHERE c.invite_code = ?`)
    .get(inviteCode) as CampaignRow | undefined;

  if (!row) {
    return { error: "No campaign with that invite code." };
  }

  const existing = getCampaignForUser(row.id, userId);
  if (existing) {
    return { campaign: existing };
  }

  if (row.status !== "lobby") {
    return { error: "That campaign has already started." };
  }
  if (Number(row.player_count ?? 0) >= row.max_players) {
    return { error: "That campaign is full." };
  }

  db.prepare(
    `INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at) VALUES (?, ?, 'player', 0, ?)`,
  ).run(row.id, userId, nowIso());
  touchCampaign(row.id);

  const campaign = getCampaignForUser(row.id, userId);
  return campaign ? { campaign } : { error: "Failed to join campaign." };
}

export function setMemberReady(campaignId: string, userId: string, ready: boolean) {
  getDatabase()
    .prepare(`UPDATE campaign_members SET ready = ? WHERE campaign_id = ? AND user_id = ?`)
    .run(ready ? 1 : 0, campaignId, userId);
  touchCampaign(campaignId);
}

export function allMembersReady(campaignId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(ready) AS ready FROM campaign_members WHERE campaign_id = ?`,
    )
    .get(campaignId) as { total: number; ready: number | null };
  return row.total > 0 && Number(row.ready ?? 0) === row.total;
}

export function setCampaignStatus(campaignId: string, status: CampaignStatus) {
  getDatabase()
    .prepare(`UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, nowIso(), campaignId);
}

export function setCampaignScene(campaignId: string, scene: string) {
  getDatabase()
    .prepare(`UPDATE campaigns SET scene = ?, updated_at = ? WHERE id = ?`)
    .run(scene.slice(0, 2000), nowIso(), campaignId);
}

export function getCampaignSummaryState(campaignId: string) {
  const row = getDatabase()
    .prepare(`SELECT story_summary, story_summary_count FROM campaigns WHERE id = ?`)
    .get(campaignId) as { story_summary?: string; story_summary_count?: number } | undefined;
  return {
    summary: row?.story_summary || "",
    coveredCount: Number(row?.story_summary_count || 0),
  };
}

export function setCampaignSummaryState(campaignId: string, summary: string, coveredCount: number) {
  getDatabase()
    .prepare(`UPDATE campaigns SET story_summary = ?, story_summary_count = ? WHERE id = ?`)
    .run(summary, coveredCount, campaignId);
}

export function touchCampaign(campaignId: string) {
  getDatabase()
    .prepare(`UPDATE campaigns SET updated_at = ? WHERE id = ?`)
    .run(nowIso(), campaignId);
}

// Allocates the next per-campaign sequence number (shared by messages and
// persisted events so every replayable thing has one global order).
export function allocateSeq(campaignId: string): number {
  const row = getDatabase()
    .prepare(`UPDATE campaigns SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq`)
    .get(campaignId) as { seq: number } | undefined;
  if (!row) {
    throw new Error("Campaign not found.");
  }
  return row.seq;
}

export function latestSeq(campaignId: string): number {
  const row = getDatabase()
    .prepare(`SELECT next_seq FROM campaigns WHERE id = ?`)
    .get(campaignId) as { next_seq: number } | undefined;
  return row ? row.next_seq - 1 : 0;
}
