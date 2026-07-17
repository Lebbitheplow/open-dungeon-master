import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { Advantage, RollResult } from "@/lib/dice";

export type RollKind =
  | "skill_check"
  | "saving_throw"
  | "ability_check"
  | "attack"
  | "damage"
  | "initiative"
  | "custom";

export type StoredRoll = {
  id: string;
  campaignId: string;
  characterId: string | null;
  requestedBy: "dm" | "player";
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  total: number;
  success: boolean | null;
  breakdown: RollResult;
  messageId: string | null;
  createdAt: string;
};

type RollRow = {
  id: string;
  campaign_id: string;
  character_id: string | null;
  requested_by: "dm" | "player";
  roll_kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  total: number;
  success: number | null;
  breakdown_json: string;
  message_id: string | null;
  created_at: string;
};

function mapRoll(row: RollRow): StoredRoll {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    characterId: row.character_id,
    requestedBy: row.requested_by,
    kind: row.roll_kind,
    detail: row.detail,
    expression: row.expression,
    advantage: row.advantage,
    dc: row.dc,
    total: row.total,
    success: row.success === null ? null : Boolean(row.success),
    breakdown: parseJson(row.breakdown_json, {
      expression: row.expression,
      total: row.total,
      terms: [],
    } as RollResult),
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

export function insertRoll(input: {
  campaignId: string;
  characterId?: string | null;
  requestedBy: "dm" | "player";
  kind: RollKind;
  detail?: string;
  advantage?: Advantage;
  dc?: number | null;
  result: RollResult;
  messageId?: string | null;
}): StoredRoll {
  const id = crypto.randomUUID();
  const success =
    input.dc === undefined || input.dc === null ? null : input.result.total >= input.dc ? 1 : 0;

  getDatabase()
    .prepare(
      `
        INSERT INTO rolls (
          id, campaign_id, character_id, requested_by, roll_kind, detail,
          expression, advantage, dc, total, success, breakdown_json,
          message_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.characterId ?? null,
      input.requestedBy,
      input.kind,
      input.detail ?? "",
      input.result.expression,
      input.advantage ?? "none",
      input.dc ?? null,
      input.result.total,
      success,
      JSON.stringify(input.result),
      input.messageId ?? null,
      nowIso(),
    );

  const roll = getRoll(id);
  if (!roll) {
    throw new Error("Failed to insert roll.");
  }
  return roll;
}

export function getRoll(rollId: string): StoredRoll | null {
  const row = getDatabase().prepare(`SELECT * FROM rolls WHERE id = ?`).get(rollId) as
    | RollRow
    | undefined;
  return row ? mapRoll(row) : null;
}

export function listRecentRolls(campaignId: string, limit = 20): StoredRoll[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM (
          SELECT * FROM rolls WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
        ) ORDER BY created_at ASC, rowid ASC
      `,
    )
    .all(campaignId, limit) as RollRow[];
  return rows.map(mapRoll);
}
