import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { ChatMessage } from "@/lib/model-client";
import type { Advantage } from "@/lib/dice";
import type { RollKind } from "@/lib/db/rolls";

// A DM narration turn persisted as a state machine so it can park while a
// player rolls physical dice and resume later (across restarts).

export type DmTurnStatus = "running" | "awaiting_rolls" | "done" | "failed";

export type DmTurn = {
  id: string;
  campaignId: string;
  status: DmTurnStatus;
  callIndex: number;
  conversation: ChatMessage[];
  narrationParts: string[];
  rollIds: string[];
  // Player-to-DM whispers this turn consumed; marked answered in finalize()
  // so a failed turn leaves them pending for the next one to retry.
  playerWhisperIds: string[];
  // Character ids that actually received a send_whisper this turn. finalize()
  // marks a player's pending whisper answered only when its sender is here, so
  // a turn that never replied cannot silently consume the message.
  answeredWhisperCharacterIds: string[];
  // Enemies that already attacked this turn (via enemy_attack); the auto-act
  // fallback skips them so nothing swings twice.
  actedEnemyIds: string[];
  // PCs whose combat turn was adjudicated this DM turn; the initiative
  // pointer only advances past a PC on this list (or with a landed roll).
  resolvedCharacterIds: string[];
  imageArgs: { prompt: string; reason?: string } | null;
  locationId: string | null;
  mutationCount: number;
  encounterCount: number;
  createdAt: string;
  updatedAt: string;
};

type TurnRow = {
  id: string;
  campaign_id: string;
  status: DmTurnStatus;
  call_index: number;
  conversation_json: string;
  narration_parts_json: string;
  roll_ids_json: string;
  player_whisper_ids_json: string;
  answered_whisper_character_ids_json: string | null;
  acted_enemy_ids_json: string | null;
  resolved_character_ids_json: string | null;
  image_args_json: string | null;
  location_id: string | null;
  mutation_count: number;
  encounter_count: number;
  created_at: string;
  updated_at: string;
};

function mapTurn(row: TurnRow): DmTurn {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    status: row.status,
    callIndex: row.call_index,
    conversation: parseJson<ChatMessage[]>(row.conversation_json, []),
    narrationParts: parseJson<string[]>(row.narration_parts_json, []),
    rollIds: parseJson<string[]>(row.roll_ids_json, []),
    playerWhisperIds: parseJson<string[]>(row.player_whisper_ids_json, []),
    answeredWhisperCharacterIds: parseJson<string[]>(
      row.answered_whisper_character_ids_json,
      [],
    ),
    actedEnemyIds: parseJson<string[]>(row.acted_enemy_ids_json, []),
    resolvedCharacterIds: parseJson<string[]>(row.resolved_character_ids_json, []),
    imageArgs: parseJson<DmTurn["imageArgs"]>(row.image_args_json, null),
    locationId: row.location_id ?? null,
    mutationCount: row.mutation_count,
    encounterCount: row.encounter_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDmTurn(campaignId: string, conversation: ChatMessage[]): DmTurn {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO dm_turns (id, campaign_id, status, call_index, conversation_json, created_at, updated_at)
        VALUES (?, ?, 'running', 0, ?, ?, ?)
      `,
    )
    .run(id, campaignId, JSON.stringify(conversation), now, now);
  const turn = getDmTurn(id);
  if (!turn) {
    throw new Error("Failed to create DM turn.");
  }
  return turn;
}

export function getDmTurn(turnId: string): DmTurn | null {
  const row = getDatabase().prepare(`SELECT * FROM dm_turns WHERE id = ?`).get(turnId) as
    | TurnRow
    | undefined;
  return row ? mapTurn(row) : null;
}

export function saveDmTurn(turn: DmTurn) {
  getDatabase()
    .prepare(
      `
        UPDATE dm_turns SET
          status = ?, call_index = ?, conversation_json = ?,
          narration_parts_json = ?, roll_ids_json = ?, player_whisper_ids_json = ?, answered_whisper_character_ids_json = ?, acted_enemy_ids_json = ?, resolved_character_ids_json = ?, image_args_json = ?,
          location_id = ?, mutation_count = ?, encounter_count = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      turn.status,
      turn.callIndex,
      JSON.stringify(turn.conversation),
      JSON.stringify(turn.narrationParts),
      JSON.stringify(turn.rollIds),
      JSON.stringify(turn.playerWhisperIds),
      JSON.stringify(turn.answeredWhisperCharacterIds),
      JSON.stringify(turn.actedEnemyIds),
      JSON.stringify(turn.resolvedCharacterIds),
      turn.imageArgs ? JSON.stringify(turn.imageArgs) : null,
      turn.locationId,
      turn.mutationCount,
      turn.encounterCount,
      nowIso(),
      turn.id,
    );
}

// Turns stuck in `running` are stale after a crash/restart; fail them so a
// new turn can start. `awaiting_rolls` turns are durable by design.
export function failStaleRunningTurns(campaignId: string, olderThanMinutes = 10) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  getDatabase()
    .prepare(
      `UPDATE dm_turns SET status = 'failed', updated_at = ? WHERE campaign_id = ? AND status = 'running' AND updated_at < ?`,
    )
    .run(nowIso(), campaignId, cutoff);
}

export function getAwaitingTurn(campaignId: string): DmTurn | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM dm_turns WHERE campaign_id = ? AND status = 'awaiting_rolls' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(campaignId) as TurnRow | undefined;
  return row ? mapTurn(row) : null;
}

// ---- pending physical rolls ----

export type PendingRollStatus = "pending" | "submitted" | "fallback";

// Adjudication context a parked pc_attack to-hit roll carries: when the d20
// is submitted the server compares it to targetAc and, on a hit, parks the
// matching damage roll (src/lib/dm/pc-attack.ts).
export type PendingAttack = {
  attacker: string;
  weapon: string;
  targetEnemyId: string;
  targetAc: number;
  damageExpression: string;
  critDamageExpression: string;
  damageType?: string;
  // Condition-derived: any hit is a critical hit (paralyzed target, etc).
  autoCrit?: boolean;
  // Improved/Superior Critical: the natural roll that crits, when below 20.
  critRange?: number;
  // Great Weapon Fighting: reroll damage dice at or below this value.
  rerollBelow?: number;
};

export type PendingRoll = {
  id: string;
  campaignId: string;
  turnId: string;
  toolCallId: string | null;
  userId: string;
  characterId: string | null;
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  // Damage rolls only: enemy the server applies the result to on resolve.
  targetEnemyId: string | null;
  // pc_attack to-hit rolls only: how to adjudicate the submitted d20.
  attack: PendingAttack | null;
  // Server summary of what the resolved roll already did; the resumed turn
  // surfaces it to the model so it narrates the real outcome.
  combatNote: string | null;
  status: PendingRollStatus;
  rollId: string | null;
  createdAt: string;
};

type PendingRow = {
  id: string;
  campaign_id: string;
  turn_id: string;
  tool_call_id: string | null;
  user_id: string;
  character_id: string | null;
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  target_enemy_id: string | null;
  attack_json: string | null;
  combat_note: string | null;
  status: PendingRollStatus;
  roll_id: string | null;
  created_at: string;
};

function mapPending(row: PendingRow): PendingRoll {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    toolCallId: row.tool_call_id,
    userId: row.user_id,
    characterId: row.character_id,
    kind: row.kind,
    detail: row.detail,
    expression: row.expression,
    advantage: row.advantage,
    dc: row.dc,
    reason: row.reason,
    targetEnemyId: row.target_enemy_id ?? null,
    attack: parseJson<PendingAttack | null>(row.attack_json, null),
    combatNote: row.combat_note ?? null,
    status: row.status,
    rollId: row.roll_id,
    createdAt: row.created_at,
  };
}

export function createPendingRoll(input: {
  campaignId: string;
  turnId: string;
  toolCallId: string | null;
  userId: string;
  characterId: string | null;
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  targetEnemyId?: string | null;
  attack?: PendingAttack | null;
}): PendingRoll {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO pending_rolls (
          id, campaign_id, turn_id, tool_call_id, user_id, character_id, kind,
          detail, expression, advantage, dc, reason, target_enemy_id, attack_json, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.turnId,
      input.toolCallId,
      input.userId,
      input.characterId,
      input.kind,
      input.detail,
      input.expression,
      input.advantage,
      input.dc,
      input.reason,
      input.targetEnemyId ?? null,
      input.attack ? JSON.stringify(input.attack) : null,
      nowIso(),
    );
  const pending = getPendingRoll(id);
  if (!pending) {
    throw new Error("Failed to create pending roll.");
  }
  return pending;
}

// Client-facing projection: the adjudication context (enemy AC) and the
// model-facing combat note never ride events or snapshots to players.
export function publicPendingRoll(pending: PendingRoll): Omit<PendingRoll, "attack" | "combatNote"> {
  const rest: Partial<PendingRoll> = { ...pending };
  delete rest.attack;
  delete rest.combatNote;
  return rest as Omit<PendingRoll, "attack" | "combatNote">;
}

export function getPendingRoll(id: string): PendingRoll | null {
  const row = getDatabase().prepare(`SELECT * FROM pending_rolls WHERE id = ?`).get(id) as
    | PendingRow
    | undefined;
  return row ? mapPending(row) : null;
}

export function listPendingForTurn(turnId: string): PendingRoll[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM pending_rolls WHERE turn_id = ? ORDER BY created_at ASC`)
    .all(turnId) as PendingRow[];
  return rows.map(mapPending);
}

export function listOpenPendingRolls(campaignId: string): PendingRoll[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM pending_rolls WHERE campaign_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    )
    .all(campaignId) as PendingRow[];
  return rows.map(mapPending);
}

export function setPendingCombatNote(id: string, note: string) {
  getDatabase()
    .prepare(`UPDATE pending_rolls SET combat_note = ? WHERE id = ?`)
    .run(note.slice(0, 500), id);
}

export function resolvePendingRoll(
  id: string,
  status: "submitted" | "fallback",
  rollId: string,
): PendingRoll | null {
  const result = getDatabase()
    .prepare(`UPDATE pending_rolls SET status = ?, roll_id = ? WHERE id = ? AND status = 'pending'`)
    .run(status, rollId, id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}
