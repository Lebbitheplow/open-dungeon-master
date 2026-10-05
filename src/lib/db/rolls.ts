import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { redactRoll, rollAccessFor, type ViewerCaps } from "@/lib/dm/viewer";
import type { Advantage, RollResult } from "@/lib/dice";

export type RollKind =
  | "skill_check"
  | "saving_throw"
  | "ability_check"
  | "attack"
  | "damage"
  | "initiative"
  | "custom";

// Who may see a roll's result. 'public' is every roll the app has ever
// made and stays the default; the rest exist for a human DM who wants a
// screen (src/lib/dm/viewer.ts decides who sees what).
export const ROLL_VISIBILITIES = ["public", "dm", "blind", "self"] as const;
export type RollVisibility = (typeof ROLL_VISIBILITIES)[number];

// Who made an attack or damage roll, named as they were when it was rolled.
// A character's bound creature has no id of its own (it lives on its owner's
// sheet), so a pet's id is its owner's sheet id. characterId cannot say this:
// it is the PC the roll concerns, the target of an enemy's attack.
export type RollAttacker = { kind: "sheet" | "enemy" | "pet"; id: string; name: string };

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
  visibility: RollVisibility;
  messageId: string | null;
  // Damage rolls only: the enemy the server applied this roll's total to,
  // set together with `applied` (the damage_enemy double-apply guard).
  targetEnemyId: string | null;
  applied: boolean;
  // Attack and damage rolls: who rolled. Null when nobody did (a fall), for
  // the roll tools' rolls, and for rolls stored before it was recorded.
  attacker: RollAttacker | null;
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
  visibility: RollVisibility | null;
  message_id: string | null;
  target_enemy_id: string | null;
  applied: number;
  attacker_json: string | null;
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
    visibility: row.visibility ?? "public",
    messageId: row.message_id,
    targetEnemyId: row.target_enemy_id ?? null,
    applied: Boolean(row.applied),
    attacker: parseJson<RollAttacker | null>(row.attacker_json ?? "null", null),
    createdAt: row.created_at,
  };
}

// Stamp a damage roll as server-applied to a specific enemy; the
// damage_enemy double-apply guard reads these.
export function markRollApplied(rollId: string, targetEnemyId: string) {
  getDatabase()
    .prepare(`UPDATE rolls SET applied = 1, target_enemy_id = ? WHERE id = ?`)
    .run(targetEnemyId, rollId);
}

// Lands a damage roll with its stamp already on. The blow that ends a fight
// is counted into the after-fight card inside `land`, so a stamp put on
// afterwards left every killing blow off its wielder's line (issue 91: 0
// dealt, 1 slain). A blow the engine refuses gives the stamp back.
export function landRoll<T extends object>(rollId: string, targetEnemyId: string, land: () => T): T {
  markRollApplied(rollId, targetEnemyId);
  const result = land();
  if ("error" in result) {
    getDatabase().prepare(`UPDATE rolls SET applied = 0, target_enemy_id = NULL WHERE id = ?`).run(rollId);
  }
  return result;
}

// An attack or damage roll must say who made it, or that nobody did.
export type RollInsert = {
  campaignId: string;
  characterId?: string | null;
  requestedBy: "dm" | "player";
  detail?: string;
  advantage?: Advantage;
  dc?: number | null;
  result: RollResult;
  visibility?: RollVisibility;
  messageId?: string | null;
} & (
  | { kind: "attack" | "damage"; attacker: RollAttacker | null }
  | { kind: Exclude<RollKind, "attack" | "damage">; attacker?: RollAttacker | null }
);

export function insertRoll(input: RollInsert): StoredRoll {
  const id = crypto.randomUUID();
  const success =
    input.dc === undefined || input.dc === null ? null : input.result.total >= input.dc ? 1 : 0;

  getDatabase()
    .prepare(
      `
        INSERT INTO rolls (
          id, campaign_id, character_id, requested_by, roll_kind, detail,
          expression, advantage, dc, total, success, breakdown_json,
          visibility, message_id, attacker_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.visibility ?? "public",
      input.messageId ?? null,
      input.attacker ? JSON.stringify(input.attacker) : null,
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

// Every roll since a moment, oldest first: the span of one fight.
export function listRollsSince(campaignId: string, sinceIso: string): StoredRoll[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM rolls WHERE campaign_id = ? AND created_at >= ? ORDER BY created_at ASC, rowid ASC`)
    .all(campaignId, sinceIso) as RollRow[];
  return rows.map(mapRoll);
}

export function listRecentRolls(campaignId: string, limit = 20): StoredRoll[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM (
          SELECT r.*, r.rowid AS row_order FROM rolls r
          WHERE r.campaign_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?
        ) ORDER BY created_at ASC, row_order ASC
      `,
    )
    .all(campaignId, limit) as RollRow[];
  return rows.map(mapRoll);
}

// The recent rolls one seat may see. A hidden roll is dropped outright and a
// blind one keeps its label and loses its number, so the table still knows
// the dice were thrown (src/lib/dm/viewer.ts explains why).
export function listRollsVisibleTo(
  campaignId: string,
  caps: Pick<ViewerCaps, "adjudicates" | "steersStory">,
  ownedCharacterIds: string[],
  limit = 20,
): Array<StoredRoll | ReturnType<typeof redactRoll<StoredRoll>>> {
  const out: Array<StoredRoll | ReturnType<typeof redactRoll<StoredRoll>>> = [];
  for (const roll of listRecentRolls(campaignId, limit)) {
    const access = rollAccessFor(roll, caps, ownedCharacterIds);
    if (access === "hidden") {
      continue;
    }
    out.push(access === "full" ? roll : redactRoll(roll));
  }
  return out;
}
