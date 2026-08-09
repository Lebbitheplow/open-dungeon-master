import { getDatabase, nowIso } from "@/lib/db/core";
import type { DirectorArm, OneShotEventId } from "@/lib/dm/director-logic";

// One armed director directive per campaign, at most. Arming replaces
// whatever was armed before rather than queueing, because both levers are
// "this turn only" steers: a queue of them would fire on turns the lead was
// no longer thinking about.

export type StoredDirectorArm = DirectorArm & {
  campaignId: string;
  armedByUserId: string;
  armedAt: string;
};

type ArmRow = {
  campaign_id: string;
  one_shot: string | null;
  absolute_command: string;
  armed_by_user_id: string;
  armed_at: string;
};

function mapArm(row: ArmRow): StoredDirectorArm {
  return {
    campaignId: row.campaign_id,
    oneShot: (row.one_shot as OneShotEventId | null) ?? null,
    absoluteCommand: row.absolute_command,
    armedByUserId: row.armed_by_user_id,
    armedAt: row.armed_at,
  };
}

export function getDirectorArm(campaignId: string): StoredDirectorArm | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM director_arms WHERE campaign_id = ?`)
    .get(campaignId) as ArmRow | undefined;
  return row ? mapArm(row) : null;
}

export function setDirectorArm(input: {
  campaignId: string;
  oneShot: OneShotEventId | null;
  absoluteCommand: string;
  armedByUserId: string;
}): StoredDirectorArm {
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO director_arms (
          campaign_id, one_shot, absolute_command, armed_by_user_id, armed_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id) DO UPDATE SET
          one_shot = excluded.one_shot,
          absolute_command = excluded.absolute_command,
          armed_by_user_id = excluded.armed_by_user_id,
          armed_at = excluded.armed_at
      `,
    )
    .run(
      input.campaignId,
      input.oneShot,
      input.absoluteCommand,
      input.armedByUserId,
      now,
    );
  return {
    campaignId: input.campaignId,
    oneShot: input.oneShot,
    absoluteCommand: input.absoluteCommand,
    armedByUserId: input.armedByUserId,
    armedAt: now,
  };
}

export function clearDirectorArm(campaignId: string) {
  getDatabase().prepare(`DELETE FROM director_arms WHERE campaign_id = ?`).run(campaignId);
}

// Reads and deletes in one statement so two turns racing for the same arm
// cannot both fire it. SQLite serialises the write, so exactly one caller
// sees the row and every other caller sees nothing.
export function takeDirectorArm(campaignId: string): StoredDirectorArm | null {
  const row = getDatabase()
    .prepare(`DELETE FROM director_arms WHERE campaign_id = ? RETURNING *`)
    .get(campaignId) as ArmRow | undefined;
  return row ? mapArm(row) : null;
}
