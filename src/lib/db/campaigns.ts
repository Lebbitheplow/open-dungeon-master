import { randomInt } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeSettings } from "@/lib/db/settings";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { normalizeGameSettings, type GameSettings } from "@/lib/schemas/game-settings";
import type {
  CampaignDifficulty,
  CampaignMember,
  CampaignStatus,
  CampaignSummary,
} from "@/lib/campaign-types";
import type { StorySettings } from "@/lib/types";
import { normalizeStoryArc, type StoryArc } from "@/lib/dm/arc-logic";

// Who may act right now; always branch on mode.
export type SpotlightFloor = {
  mode: "spotlight";
  userIds: string[];
  prompt: string;
  // Releases only when every spotlighted user appears here.
  respondedUserIds: string[];
};
// Active combat: the floor follows the initiative order. userIds is the
// current-turn PC's player; the order itself lives on the encounter row and
// only advanceAfterTurn/skipCurrentTurn move it.
export type InitiativeFloor = {
  mode: "initiative";
  encounterId: string;
  userIds: string[];
  currentName: string;
  round: number;
};
export type Floor =
  | { mode: "open" }
  | SpotlightFloor
  | InitiativeFloor
  // Held responses: nobody may act until the party lead releases; `next` is
  // the floor that takes effect on release.
  | { mode: "hold"; next: { mode: "open" } | SpotlightFloor | InitiativeFloor };

export type Campaign = CampaignSummary & {
  scene: string;
  questLog: string[];
  settings: StorySettings;
  gameSettings: GameSettings;
  dmOutline: string;
  storyArc: StoryArc | null;
  floor: Floor;
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
  game_settings_json: string;
  party_lead_user_id: string | null;
  dm_outline: string;
  story_arc_json: string;
  floor_json: string;
  scene: string;
  quest_log_json: string;
  created_at: string;
  updated_at: string;
  player_count?: number;
  member_role?: "owner" | "player";
};

// OOC talk is always allowed; otherwise the floor decides.
export function canAct(floor: Floor, userId: string, kind: string): boolean {
  if (kind === "ooc" || floor.mode === "open") {
    return true;
  }
  if (floor.mode === "hold") {
    return false;
  }
  return floor.userIds.includes(userId);
}

function normalizeInitiative(raw: unknown): InitiativeFloor | null {
  const floor = raw as InitiativeFloor | null;
  if (
    floor &&
    floor.mode === "initiative" &&
    typeof floor.encounterId === "string" &&
    Array.isArray(floor.userIds) &&
    floor.userIds.length
  ) {
    return {
      mode: "initiative",
      encounterId: floor.encounterId,
      userIds: floor.userIds.map(String),
      currentName: String(floor.currentName ?? ""),
      round: Number(floor.round ?? 1) || 1,
    };
  }
  return null;
}

function normalizeSpotlight(raw: unknown): SpotlightFloor | null {
  const floor = raw as SpotlightFloor | null;
  if (
    floor &&
    floor.mode === "spotlight" &&
    Array.isArray(floor.userIds) &&
    floor.userIds.length
  ) {
    const responded = Array.isArray(floor.respondedUserIds)
      ? floor.respondedUserIds.filter(
          (id) => typeof id === "string" && floor.userIds.includes(id),
        )
      : [];
    return {
      mode: "spotlight",
      userIds: floor.userIds,
      prompt: String(floor.prompt ?? ""),
      respondedUserIds: responded,
    };
  }
  return null;
}

export function normalizeFloor(raw: unknown): Floor {
  const floor = raw as Floor | null;
  const spotlight = normalizeSpotlight(raw);
  if (spotlight) {
    return spotlight;
  }
  const initiative = normalizeInitiative(raw);
  if (initiative) {
    return initiative;
  }
  if (floor && floor.mode === "hold") {
    return {
      mode: "hold",
      next: normalizeSpotlight(floor.next) ?? normalizeInitiative(floor.next) ?? { mode: "open" },
    };
  }
  return { mode: "open" };
}

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
    leadUserId: row.party_lead_user_id ?? row.owner_user_id,
    playerCount: Number(row.player_count ?? 0),
    role: row.member_role ?? (row.owner_user_id ? "player" : "player"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scene: row.scene,
    questLog: parseJson<string[]>(row.quest_log_json, []),
    settings: normalizeSettings(parseJson(row.settings_json, {})),
    gameSettings: normalizeGameSettings(parseJson(row.game_settings_json, {})),
    dmOutline: row.dm_outline ?? "",
    storyArc: normalizeStoryArc(parseJson(row.story_arc_json ?? "", null)),
    floor: normalizeFloor(parseJson(row.floor_json, null)),
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
    gameSettings?: Partial<GameSettings>;
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
          game_settings_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'lobby', ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(normalizeGameSettings(input.gameSettings ?? {})),
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

// Campaign info fields the party lead may edit. Foreign keys cascade the
// delete through every campaign-scoped table.
export function updateCampaignInfo(
  campaignId: string,
  patch: Partial<{
    title: string;
    description: string;
    theme: string;
    maxPlayers: number;
    startingLevel: number;
    difficulty: CampaignDifficulty;
  }>,
) {
  const columns: Record<string, string> = {
    title: "title",
    description: "description",
    theme: "theme",
    maxPlayers: "max_players",
    startingLevel: "starting_level",
    difficulty: "difficulty",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (!sets.length) {
    return;
  }
  getDatabase()
    .prepare(`UPDATE campaigns SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...values, nowIso(), campaignId);
}

export function deleteCampaign(campaignId: string) {
  const db = getDatabase();
  // Companion bot users exist only for their sheet in this campaign; sweep
  // them before the cascade orphans the rows (sheet delete cascades from
  // the campaign, but nothing else references the bot user).
  db.prepare(
    `DELETE FROM users WHERE id LIKE 'comp\\_%' ESCAPE '\\'
       AND id IN (SELECT user_id FROM character_sheets WHERE campaign_id = ?)`,
  ).run(campaignId);
  db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(campaignId);
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
        SELECT m.user_id, u.username, u.avatar_json, m.role, m.ready, m.use_real_dice, m.joined_at
        FROM campaign_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.campaign_id = ?
        ORDER BY m.joined_at ASC
      `,
    )
    .all(campaignId) as Array<{
    user_id: string;
    username: string;
    avatar_json: string | null;
    role: "owner" | "player";
    ready: number;
    use_real_dice: number;
    joined_at: string;
  }>;

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    avatar: parseJson<{ url: string } | null>(row.avatar_json, null),
    role: row.role,
    ready: Boolean(row.ready),
    useRealDice: Boolean(row.use_real_dice),
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

  // Mid-game joining is allowed only while the lead has it switched on.
  if (row.status === "ended") {
    return { error: "That campaign has ended." };
  }
  if (row.status === "active") {
    const gameSettings = normalizeGameSettings(parseJson(row.game_settings_json, {}));
    if (!gameSettings.midGameJoinOpen) {
      return { error: "That campaign has already started." };
    }
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

export function updateGameSettings(
  campaignId: string,
  patch: Partial<GameSettings>,
): GameSettings | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  const merged = normalizeGameSettings({ ...campaign.gameSettings, ...patch });
  getDatabase()
    .prepare(`UPDATE campaigns SET game_settings_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(merged), nowIso(), campaignId);
  return merged;
}

export function setDmOutline(campaignId: string, outline: string) {
  getDatabase()
    .prepare(`UPDATE campaigns SET dm_outline = ?, updated_at = ? WHERE id = ?`)
    .run(outline.slice(0, 8_000), nowIso(), campaignId);
}

// Persists the structured story arc. Serialized whole; if a multi-act arc
// outgrows the cap, oldest settled events and then settled sub-arcs are shed
// rather than writing truncated (corrupt) JSON. Pending plans and the beat
// spine are never dropped here.
const STORY_ARC_CHAR_CAP = 32_000;

export function setStoryArc(campaignId: string, arc: StoryArc) {
  // Defensive spreads: every in-app caller passes a normalized arc, but a
  // hand-written or legacy-shaped object must not throw here.
  const trimmed: StoryArc = {
    ...arc,
    subArcs: [...(arc.subArcs ?? [])],
    events: [...(arc.events ?? [])],
  };
  let serialized = JSON.stringify(trimmed);
  while (serialized.length > STORY_ARC_CHAR_CAP) {
    const settledEvent = trimmed.events.findIndex((event) => event.status !== "pending");
    if (settledEvent >= 0) {
      trimmed.events.splice(settledEvent, 1);
    } else if (trimmed.subArcs.length) {
      const settled = trimmed.subArcs.findIndex(
        (subArc) => subArc.status === "resolved" || subArc.status === "abandoned",
      );
      trimmed.subArcs.splice(settled >= 0 ? settled : 0, 1);
    } else {
      break;
    }
    serialized = JSON.stringify(trimmed);
  }
  getDatabase()
    .prepare(`UPDATE campaigns SET story_arc_json = ?, updated_at = ? WHERE id = ?`)
    .run(serialized, nowIso(), campaignId);
}

export function setQuestLog(campaignId: string, quests: string[]) {
  getDatabase()
    .prepare(`UPDATE campaigns SET quest_log_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(quests.slice(0, 20)), nowIso(), campaignId);
}

export function getFloor(campaignId: string): Floor {
  const row = getDatabase()
    .prepare(`SELECT floor_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { floor_json?: string } | undefined;
  return normalizeFloor(parseJson(row?.floor_json ?? null, null));
}

export function setFloor(campaignId: string, floor: Floor) {
  getDatabase()
    .prepare(`UPDATE campaigns SET floor_json = ? WHERE id = ?`)
    .run(JSON.stringify(floor), campaignId);
}

// Transfers the party lead to another member. Returns false when the
// target is not a member of the campaign.
export function setPartyLead(campaignId: string, userId: string): boolean {
  const db = getDatabase();
  const member = db
    .prepare(`SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?`)
    .get(campaignId, userId);
  if (!member) {
    return false;
  }
  db.prepare(`UPDATE campaigns SET party_lead_user_id = ?, updated_at = ? WHERE id = ?`).run(
    userId,
    nowIso(),
    campaignId,
  );
  return true;
}

export function setMemberRealDice(campaignId: string, userId: string, useRealDice: boolean) {
  getDatabase()
    .prepare(`UPDATE campaign_members SET use_real_dice = ? WHERE campaign_id = ? AND user_id = ?`)
    .run(useRealDice ? 1 : 0, campaignId, userId);
  touchCampaign(campaignId);
}

// Atomically claim the right to insert a resume recap covering messages up
// to `seq`; a second concurrent action loses the claim and skips the recap.
export function claimRecap(campaignId: string, seq: number): boolean {
  const result = getDatabase()
    .prepare(`UPDATE campaigns SET last_recap_seq = ? WHERE id = ? AND last_recap_seq < ?`)
    .run(seq, campaignId, seq);
  return result.changes > 0;
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

// Strip server-only fields before sending a campaign to any client. The DM
// outline and story arc are the story's secret spine; players must never
// receive them.
export function publicCampaign(campaign: Campaign): Omit<Campaign, "dmOutline" | "storyArc"> {
  const rest = { ...campaign } as Partial<Campaign>;
  delete rest.dmOutline;
  delete rest.storyArc;
  return rest as Omit<Campaign, "dmOutline" | "storyArc">;
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
