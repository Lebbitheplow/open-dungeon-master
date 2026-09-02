import { randomInt } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeSettings } from "@/lib/db/settings";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { normalizeGameSettings, type GameSettings } from "@/lib/schemas/game-settings";
import { normalizeCampaignKind, type CampaignKind } from "@/lib/workshop/kind";
import type {
  CampaignDifficulty,
  CampaignMember,
  CampaignStatus,
  CampaignSummary,
} from "@/lib/campaign-types";
import type { StorySettings } from "@/lib/types";
import { normalizeStoryArc, type StoryArc } from "@/lib/dm/arc-logic";
import { normalizeCover, type DmCover } from "@/lib/dm/delegation";
import { normalizeClock, type CampaignClock } from "@/lib/dm/calendar";
import { normalizeParty, type PartyState } from "@/lib/dm/party-logic";
import {
  partySlotCount,
  viewerCaps,
  type CampaignSeats,
  type DmMode,
  type ViewerCaps,
} from "@/lib/dm/viewer";

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
  // Assisted mode: the stretch of answers handed to the AI, or null. Kept on
  // the campaign rather than fetched separately because the DM prompt, the
  // action route and every client that renders the banner all want it, and a
  // separate read on each would be three chances to disagree.
  dmCover: DmCover | null;
  // The in-world date and time (src/lib/dm/calendar.ts). Hydrated here rather
  // than fetched where it is needed because the DM prompt, the status bar and
  // the rest and travel engines all want it, and three separate reads would be
  // three chances to disagree about what day it is.
  clock: CampaignClock;
  // The party as a thing in its own right: common purse, shared pack, banked
  // XP, marching order (src/lib/dm/party-logic.ts).
  party: PartyState;
};

type CampaignRow = {
  id: string;
  title: string;
  description: string;
  kind: string | null;
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
  human_dm_user_id: string | null;
  assistant_dm_user_id: string | null;
  dm_outline: string;
  story_arc_json: string;
  floor_json: string;
  dm_cover_json: string;
  clock_json: string;
  party_json: string;
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

// Rotates the invite code, killing every previously shared link for good.
// The loop covers the UNIQUE constraint; a collision in a 32^8 keyspace is
// theoretical. Returns the new code, or null for an unknown campaign.
export function regenerateInviteCode(campaignId: string): string | null {
  const db = getDatabase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    try {
      const result = db
        .prepare(`UPDATE campaigns SET invite_code = ?, updated_at = ? WHERE id = ?`)
        .run(code, nowIso(), campaignId);
      return result.changes > 0 ? code : null;
    } catch {
      // UNIQUE collision; try another code.
    }
  }
  return null;
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: normalizeCampaignKind(row.kind),
    status: row.status,
    inviteCode: row.invite_code,
    maxPlayers: row.max_players,
    startingLevel: row.starting_level,
    difficulty: row.difficulty,
    theme: row.theme,
    ownerUserId: row.owner_user_id,
    leadUserId: row.party_lead_user_id ?? row.owner_user_id,
    dmUserId: row.human_dm_user_id ?? null,
    assistantDmUserId: row.assistant_dm_user_id ?? null,
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
    dmCover: normalizeCover(parseJson(row.dm_cover_json ?? "", null)),
    clock: normalizeClock(parseJson(row.clock_json ?? "", null)),
    party: normalizeParty(parseJson(row.party_json ?? "", null)),
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
    // 'workshop' makes this a prep space rather than a table that plays.
    // Defaults to a campaign so every existing caller is unchanged.
    kind?: CampaignKind;
  },
): Campaign {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = nowIso();
  const gameSettings = normalizeGameSettings(input.gameSettings ?? {});
  // Creating a human-DM campaign seats the creator as the DM. Nothing else
  // would make sense: they chose to run it, and an empty seat would leave the
  // table with neither a narrator nor a way to appoint one.
  const dmUserId = gameSettings.dmMode === "ai" ? null : ownerUserId;

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO campaigns (
          id, title, description, kind, invite_code, owner_user_id, status,
          max_players, starting_level, difficulty, theme, settings_json,
          game_settings_json, human_dm_user_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'lobby', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.title,
      input.description,
      input.kind ?? "campaign",
      generateInviteCode(),
      ownerUserId,
      input.maxPlayers,
      input.startingLevel,
      input.difficulty,
      input.theme,
      JSON.stringify(configuredDefaultStorySettings()),
      JSON.stringify(gameSettings),
      dmUserId,
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
        WHERE c.kind = 'campaign'
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

// Non-consuming lookup: registration treats a live room code as proof of
// invitation without joining anything or spending the code.
export function findCampaignByInviteCode(inviteCode: string): Campaign | null {
  const row = getDatabase()
    .prepare(`${CAMPAIGN_SELECT} WHERE c.invite_code = ?`)
    .get(inviteCode) as CampaignRow | undefined;
  return row ? mapCampaign(row) : null;
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
  // The DM seats hold no party slot, so a human-DM table with a cap of five
  // still admits five players.
  if (countPartySlots(row.id) >= row.max_players) {
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

// Changing who runs the game keeps the seats in step with the mode: a mode
// other than "ai" has a person in the DM seat and "ai" has nobody, which is
// the same invariant createCampaign applies (dmUserId above). Without this, a
// settings PATCH could leave a "human" table with no DM (nobody may narrate)
// or an "ai" table with a stale seat (hasHumanDm degrades it safely, but the
// seat routes would still show a phantom DM). Returns the seated DM's id (or
// null for "ai") so the caller can announce the seat change.
export function setDmMode(
  campaignId: string,
  mode: DmMode,
  // Who flipped the switch; they take the seat when leaving "ai" and the seat
  // is empty, matching creation where the person who chose to run it runs it.
  actorUserId: string,
): { gameSettings: GameSettings; dmUserId: string | null } | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  let dmUserId = campaign.dmUserId;
  if (mode === "ai") {
    setHumanDm(campaignId, null);
    setAssistantDm(campaignId, null);
    dmUserId = null;
  } else if (!campaign.dmUserId && setHumanDm(campaignId, actorUserId)) {
    dmUserId = actorUserId;
  }
  const gameSettings = updateGameSettings(campaignId, { dmMode: mode });
  return gameSettings ? { gameSettings, dmUserId } : null;
}

export function setDmOutline(campaignId: string, outline: string) {
  getDatabase()
    .prepare(`UPDATE campaigns SET dm_outline = ?, updated_at = ? WHERE id = ?`)
    .run(outline.slice(0, 8_000), nowIso(), campaignId);
}

// Persists the structured story arc. Serialized whole; if a multi-act arc
// outgrows the cap, oldest settled events, then settled sub-arcs, then the
// saga's history and sketch extras are shed rather than writing truncated
// (corrupt) JSON. Pending plans and the beat spine are never dropped here.
const STORY_ARC_CHAR_CAP = 32_000;

export function setStoryArc(campaignId: string, arc: StoryArc) {
  // Defensive spreads: every in-app caller passes a normalized arc, but a
  // hand-written or legacy-shaped object must not throw here.
  const trimmed: StoryArc = {
    ...arc,
    subArcs: [...(arc.subArcs ?? [])],
    events: [...(arc.events ?? [])],
    saga: arc.saga
      ? {
          ...arc.saga,
          sketches: (arc.saga.sketches ?? []).map((sketch) => ({ ...sketch })),
          priorSagas: [...(arc.saga.priorSagas ?? [])],
        }
      : (arc.saga ?? null),
  };
  let serialized = JSON.stringify(trimmed);
  while (serialized.length > STORY_ARC_CHAR_CAP) {
    const settledEvent = trimmed.events.findIndex((event) => event.status !== "pending");
    if (settledEvent >= 0) {
      trimmed.events.splice(settledEvent, 1);
    } else if (
      trimmed.subArcs.some((subArc) => subArc.status === "resolved" || subArc.status === "abandoned")
    ) {
      trimmed.subArcs.splice(
        trimmed.subArcs.findIndex(
          (subArc) => subArc.status === "resolved" || subArc.status === "abandoned",
        ),
        1,
      );
    } else if (trimmed.saga && trimmed.saga.priorSagas.length) {
      trimmed.saga.priorSagas.splice(0, 1);
    } else if (
      trimmed.saga &&
      trimmed.saga.sketches.some(
        (sketch) => sketch.status !== "sketch" && (sketch.allies.length || sketch.hooks.length),
      )
    ) {
      // Finished acts no longer need their planning extras.
      for (const sketch of trimmed.saga.sketches) {
        if (sketch.status !== "sketch") {
          sketch.allies = [];
          sketch.hooks = [];
        }
      }
    } else if (trimmed.subArcs.length) {
      trimmed.subArcs.splice(0, 1);
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

// The per-turn world-simulation counters and pending sparks
// (src/lib/dm/world-tick-logic.ts). Raw string accessors: parsing lives in
// the pure logic module so test scripts can exercise it directly.
export function getWorldTickJson(campaignId: string): string {
  const row = getDatabase()
    .prepare(`SELECT world_tick_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { world_tick_json?: string } | undefined;
  return row?.world_tick_json ?? "";
}

export function setWorldTickJson(campaignId: string, serialized: string) {
  getDatabase()
    .prepare(`UPDATE campaigns SET world_tick_json = ? WHERE id = ?`)
    .run(serialized, campaignId);
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

// The seats, in the shape src/lib/dm/viewer.ts wants. Every visibility and
// authority decision goes through this pair rather than comparing ids at the
// call site, so there is exactly one place to get it wrong.
export function campaignSeats(campaign: Campaign): CampaignSeats {
  return {
    ownerUserId: campaign.ownerUserId,
    leadUserId: campaign.leadUserId,
    humanDmUserId: campaign.dmUserId,
    assistantDmUserId: campaign.assistantDmUserId,
    dmMode: campaign.gameSettings.dmMode,
  };
}

export function capsFor(campaign: Campaign, userId: string): ViewerCaps {
  return viewerCaps(campaignSeats(campaign), userId);
}

export function isCampaignMember(campaignId: string, userId: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?`)
    .get(campaignId, userId);
  return row !== undefined;
}

// Seats or clears the DM. A member who takes the seat gives up their party
// slot, so their character sheet (if any) is the caller's problem to settle
// before calling this.
export function setHumanDm(campaignId: string, userId: string | null): boolean {
  const db = getDatabase();
  if (userId) {
    const member = db
      .prepare(`SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?`)
      .get(campaignId, userId);
    if (!member) {
      return false;
    }
  }
  db.prepare(`UPDATE campaigns SET human_dm_user_id = ?, updated_at = ? WHERE id = ?`).run(
    userId,
    nowIso(),
    campaignId,
  );
  return true;
}

export function setAssistantDm(campaignId: string, userId: string | null): boolean {
  const db = getDatabase();
  if (userId) {
    const member = db
      .prepare(`SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?`)
      .get(campaignId, userId);
    if (!member) {
      return false;
    }
  }
  db.prepare(`UPDATE campaigns SET assistant_dm_user_id = ?, updated_at = ? WHERE id = ?`).run(
    userId,
    nowIso(),
    campaignId,
  );
  return true;
}

// Members who occupy a party slot: the DM seats do not, so a five-player cap
// still means five players even at a human-DM table.
export function countPartySlots(campaignId: string): number {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return 0;
  }
  return partySlotCount(
    campaignSeats(campaign),
    listMembers(campaignId).map((member) => member.userId),
  );
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

// The idle-nudge job's worklist: playing tables (never workshops) that have
// not moved since the cutoff. Whether a nudge is actually owed is the pure
// helper's call (src/lib/jobs.ts idleNudgeDue); this only narrows the scan.
export function listIdleActiveCampaigns(
  cutoffIso: string,
): Array<{ id: string; title: string; status: string; updatedAt: string; idleNudgedAt: string | null }> {
  const rows = getDatabase()
    .prepare(
      `SELECT id, title, status, updated_at, idle_nudged_at FROM campaigns
       WHERE status = 'active' AND kind = 'campaign' AND updated_at <= ?`,
    )
    .all(cutoffIso) as Array<{
    id: string;
    title: string;
    status: string;
    updated_at: string;
    idle_nudged_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    updatedAt: row.updated_at,
    idleNudgedAt: row.idle_nudged_at,
  }));
}

// Deliberately leaves updated_at alone: the nudge is about the table being
// quiet, and must not itself count as activity.
export function markCampaignNudged(campaignId: string) {
  getDatabase()
    .prepare(`UPDATE campaigns SET idle_nudged_at = ? WHERE id = ?`)
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
