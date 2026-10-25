import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { CorrectionAttribution, CorrectionKind, CorrectionReason } from "@/lib/correction-reasons";
import { getGlobalConfig } from "@/lib/db/app-settings";
import type { DmTurn, DmTurnActor } from "@/lib/db/dm-turns";
import { isPrivateBackendHost } from "@/lib/backend-host";
import { AGENT_MARK } from "@/lib/dm/agent-mark";
import type { DmMode } from "@/lib/dm/viewer";
import type { BackendClass, GuardKind, GuardOutcome, QualityRow } from "@/lib/narrator-quality";
import { serverEnv } from "@/lib/server-env";
import type { TextProvider } from "@/lib/text-models";

// The correction ledger (issue #460): one turn_corrections row per fix a
// table made to state an AI turn set, so "which tool does the AI get wrong
// most?" has an answer that outlives the table that noticed.
//
// The rules every writer shares live here, once:
// - A row is written in the same transaction as the fix, by the fix's own
//   code; recordTurnCorrection never opens one of its own, so a fix that
//   rolls back takes its row with it.
// - Only a turn the AI ran is corrected: the turn must exist and be an AI
//   turn (dm_turns.actor). A rollback writes its rows before the delete.
// - A fix at a table a person runs (src/lib/dm/viewer.ts hasHumanDm) is
//   running the table, not correcting the AI, so nothing is written there.
// - No story text: the kind of fix, the tool, the ids of the audit row or
//   message, who made it, and an optional reason chip.

export type TurnCorrection = {
  id: string;
  campaignId: string;
  turnId: string | null;
  attribution: CorrectionAttribution;
  kind: CorrectionKind;
  auditId: string | null;
  messageId: string | null;
  tool: string | null;
  reason: CorrectionReason | null;
  userId: string;
  createdAt: string;
};

type CorrectionRow = {
  id: string;
  campaign_id: string;
  turn_id: string | null;
  attribution: CorrectionAttribution;
  kind: CorrectionKind;
  audit_id: string | null;
  message_id: string | null;
  tool: string | null;
  reason: CorrectionReason | null;
  user_id: string;
  created_at: string;
};

function mapCorrection(row: CorrectionRow): TurnCorrection {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    attribution: row.attribution,
    kind: row.kind,
    auditId: row.audit_id,
    messageId: row.message_id,
    tool: row.tool,
    reason: row.reason,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

// A person narrates at this table (src/lib/dm/viewer.ts hasHumanDm, read
// from the row as src/lib/db/core.ts reads it at boot).
export function personRunsCampaign(campaignId: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT human_dm_user_id, game_settings_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { human_dm_user_id: string | null; game_settings_json: string | null } | undefined;
  if (!row) {
    return false;
  }
  const dmMode: DmMode = parseJson<{ dmMode?: DmMode }>(row.game_settings_json, {}).dmMode ?? "ai";
  return (dmMode === "human" || dmMode === "assisted") && Boolean(row.human_dm_user_id);
}

function isAiTurn(campaignId: string, turnId: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT actor FROM dm_turns WHERE id = ? AND campaign_id = ?`)
    .get(turnId, campaignId) as { actor: DmTurnActor | null } | undefined;
  return Boolean(row) && (row?.actor ?? "ai") === "ai";
}

// One fix, recorded inside the caller's transaction. Null, and nothing
// written, when the turn is not an AI turn of this campaign or a person
// runs the table.
export function recordTurnCorrection(input: {
  campaignId: string;
  turnId: string | null;
  attribution: CorrectionAttribution;
  kind: CorrectionKind;
  userId: string;
  auditId?: string | null;
  messageId?: string | null;
  tool?: string | null;
  reason?: CorrectionReason | null;
}): string | null {
  if (!input.turnId || !isAiTurn(input.campaignId, input.turnId) || personRunsCampaign(input.campaignId)) {
    return null;
  }
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO turn_corrections
         (id, campaign_id, turn_id, attribution, kind, audit_id, message_id, tool, reason, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.turnId,
      input.attribution,
      input.kind,
      input.auditId ?? null,
      input.messageId ?? null,
      input.tool ? input.tool.slice(0, 80) : null,
      input.reason ?? null,
      input.userId,
      nowIso(),
    );
  return id;
}

// The reason chip, tapped after the fix: only by whoever made it, only on
// this campaign's rows. Tapping another chip replaces the first.
export function setCorrectionReason(campaignId: string, userId: string, ids: readonly string[], reason: CorrectionReason): number {
  const wanted = [...new Set(ids)].slice(0, 200);
  if (!wanted.length) {
    return 0;
  }
  const update = getDatabase().prepare(
    `UPDATE turn_corrections SET reason = ? WHERE id = ? AND campaign_id = ? AND user_id = ?`,
  );
  let changed = 0;
  getDatabase().transaction(() => {
    for (const id of wanted) {
      changed += update.run(reason, id, campaignId, userId).changes;
    }
  })();
  return changed;
}

export function listTurnCorrections(campaignId?: string): TurnCorrection[] {
  const rows = (
    campaignId
      ? getDatabase().prepare(`SELECT * FROM turn_corrections WHERE campaign_id = ? ORDER BY created_at, rowid`).all(campaignId)
      : getDatabase().prepare(`SELECT * FROM turn_corrections ORDER BY created_at, rowid`).all()
  ) as CorrectionRow[];
  return rows.map(mapCorrection);
}

export function listCorrectionsForTurns(turnIds: readonly string[]): TurnCorrection[] {
  if (!turnIds.length) {
    return [];
  }
  const select = getDatabase().prepare(`SELECT * FROM turn_corrections WHERE turn_id = ? ORDER BY created_at, rowid`);
  return turnIds.flatMap((turnId) => (select.all(turnId) as CorrectionRow[]).map(mapCorrection));
}

// ---- attribution ----

// The newest live audit row on a character that wrote any of these fields,
// before a hand correction lands: the change being corrected. Only an AI
// change is anyone's correction to count; a person's own change, or a
// correction already made, is not.
export function auditRowCorrected(
  campaignId: string,
  characterId: string,
  fields: readonly string[],
): { auditId: string; turnId: string; tool: string } | null {
  if (!fields.length) {
    return null;
  }
  const rows = getDatabase()
    .prepare(
      `SELECT id, turn_id, actor, kind, patch_json FROM sheet_audit
        WHERE campaign_id = ? AND character_id = ? AND reverted_at IS NULL
        ORDER BY seq DESC LIMIT 200`,
    )
    .all(campaignId, characterId) as Array<{ id: string; turn_id: string | null; actor: "dm" | "lead" | "player"; kind: string; patch_json: string | null }>;
  for (const row of rows) {
    const touched = Object.keys(parseJson<Record<string, unknown>>(row.patch_json, {}));
    if (!touched.some((field) => fields.includes(field))) {
      continue;
    }
    return row.actor === "dm" && row.turn_id ? { auditId: row.id, turnId: row.turn_id, tool: row.kind } : null;
  }
  return null;
}

// The most recent AI turn of the fight running now, for a fix that names
// only an enemy or a slot in the order: marked inferred. A turn still
// running when the fight began counts (the turn that started it opened
// before the encounter row did).
function latestAiTurnSince(campaignId: string, sinceIso: string): { id: string; conversationJson: string } | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, conversation_json FROM dm_turns
        WHERE campaign_id = ? AND actor = 'ai' AND updated_at >= ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(campaignId, sinceIso) as { id: string; conversation_json: string } | undefined;
  return row ? { id: row.id, conversationJson: row.conversation_json } : null;
}

// A person's fix to the fight the AI is running (an enemy's hit points, the
// turn order), tied to the fight's latest AI turn and marked inferred. The
// tool is the last call of that turn that named the enemy or slot, if any.
export function recordFightCorrection(input: {
  campaignId: string;
  fightStartedAt: string;
  kind: "enemy_hp" | "initiative";
  userId: string;
  refId?: string | null;
}): string | null {
  const turn = latestAiTurnSince(input.campaignId, input.fightStartedAt);
  if (!turn) {
    return null;
  }
  return recordTurnCorrection({
    campaignId: input.campaignId,
    turnId: turn.id,
    attribution: "inferred",
    kind: input.kind,
    tool: input.refId ? lastToolNaming(turn.conversationJson, input.refId) : null,
    userId: input.userId,
  });
}

// The last tool call in a turn's conversation whose arguments hold this id
// as a whole value: the call a fix to that enemy or slot most likely undoes.
export function lastToolNaming(conversationJson: string, id: string): string | null {
  const conversation = parseJson<Array<{ tool_calls?: unknown }>>(conversationJson, []);
  let found: string | null = null;
  const holds = (value: unknown): boolean => {
    if (value === id) return true;
    if (Array.isArray(value)) return value.some(holds);
    if (value && typeof value === "object") return Object.values(value).some(holds);
    return false;
  };
  for (const message of conversation) {
    if (!Array.isArray(message?.tool_calls)) continue;
    for (const raw of message.tool_calls as Array<{ function?: { name?: unknown; arguments?: unknown } }>) {
      const tool = typeof raw?.function?.name === "string" ? raw.function.name : "";
      const args = typeof raw?.function?.arguments === "string" ? parseJson<unknown>(raw.function.arguments, null) : raw?.function?.arguments;
      if (tool && holds(args)) {
        found = tool;
      }
    }
  }
  return found;
}

// A rollback's rows, one per AI turn it is about to delete, written inside
// its transaction before the delete.
export function recordRollbackCorrections(campaignId: string, userId: string, deletedAfterIso: string): string[] {
  if (personRunsCampaign(campaignId)) {
    return [];
  }
  const turns = getDatabase()
    .prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' AND created_at > ? ORDER BY created_at, rowid`)
    .all(campaignId, deletedAfterIso) as Array<{ id: string }>;
  return turns.flatMap((turn) => {
    const id = recordTurnCorrection({ campaignId, turnId: turn.id, attribution: "direct", kind: "rollback", userId });
    return id ? [id] : [];
  });
}

// ---- turn_quality: how each AI turn ended ----

type UsageBackend = "local" | "custom" | "openai" | "openrouter" | "harness";

// The backend class of a turn (src/lib/narrator-quality.ts BackendClass):
// from the backend its last story call reported, else from the campaign's
// story settings. A custom backend on this machine or the network is local.
function backendClassOf(backend: UsageBackend | "", settings: { textProvider?: TextProvider; customBaseUrl?: string }): BackendClass | null {
  const provider: UsageBackend | TextProvider | "" = backend || settings.textProvider || "";
  if (provider === "harness") return "agent";
  if (provider === "local") return "local";
  if (provider === "openai" || provider === "openrouter") return "api";
  if (provider === "custom") {
    const base = (settings.customBaseUrl || "").trim() || getGlobalConfig().text.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL");
    return isPrivateBackendHost(base) ? "local" : "api";
  }
  return null;
}

// What the turn's own model calls did with their tools: every call after
// the prompt, and each refusal by its kind (src/lib/dm/tool-errors.ts).
function toolCounts(turn: Pick<DmTurn, "conversation" | "contextTrace">) {
  const start = (turn.contextTrace as { shape?: { promptMessages?: number } } | null)?.shape?.promptMessages ?? 0;
  const counts = { toolCalls: 0, refusedInvalid: 0, refusedRules: 0, refusedLimit: 0 };
  for (const message of turn.conversation.slice(start)) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      counts.toolCalls += message.tool_calls.length;
    }
    if (message.role === "tool") {
      const result = parseJson<{ retry?: unknown; refused?: "rules" | "limit" } | null>(typeof message.content === "string" ? message.content : null, null);
      if (result?.retry === true) counts.refusedInvalid += 1;
      if (result?.refused === "rules") counts.refusedRules += 1;
      if (result?.refused === "limit") counts.refusedLimit += 1;
    }
  }
  return counts;
}

// One row per AI turn, written where it ends (done or failed), and again
// if a retried turn ends again. A guard outcome the ending did not carry
// (a later save, a sweep) keeps the one already stored. Never throws:
// bookkeeping must not cost a table its turn.
export function writeTurnQuality(turn: DmTurn): void {
  if (turn.actor !== "ai" || (turn.status !== "done" && turn.status !== "failed")) {
    return;
  }
  try {
    const db = getDatabase();
    const campaign = db
      .prepare(`SELECT game_settings_json, settings_json FROM campaigns WHERE id = ?`)
      .get(turn.campaignId) as { game_settings_json: string | null; settings_json: string | null } | undefined;
    if (!campaign) {
      return;
    }
    const dmMode: DmMode = parseJson<{ dmMode?: DmMode }>(campaign.game_settings_json, {}).dmMode ?? "ai";
    const settings = parseJson<{ textProvider?: TextProvider; customBaseUrl?: string }>(campaign.settings_json, {});
    const agentProgram = turn.conversation[0]?.content === AGENT_MARK;
    const lastCall = db
      .prepare(`SELECT backend, model FROM model_calls WHERE turn_id = ? AND role = 'story' ORDER BY id DESC LIMIT 1`)
      .get(turn.id) as { backend: UsageBackend | ""; model: string } | undefined;
    const backendClass = agentProgram ? "agent" : backendClassOf(lastCall?.backend ?? "", settings);
    const backend = agentProgram ? "agent_program" : lastCall?.backend || settings.textProvider || null;
    const model = agentProgram ? null : lastCall?.model || null;
    const counts = toolCounts(turn);
    const started = Date.parse(turn.createdAt);
    const durationMs = Number.isFinite(started) ? Math.max(0, Date.now() - started) : null;
    const guard = turn.guard ?? null;
    db.prepare(
      `INSERT INTO turn_quality
         (turn_id, campaign_id, actor, dm_mode, backend_class, backend, model, status, model_calls, tool_calls,
          refused_invalid, refused_rules, refused_limit, guard, guard_kinds, duration_ms, rolled_back, created_at, updated_at)
       VALUES (@turnId, @campaignId, 'ai', @dmMode, @backendClass, @backend, @model, @status, @modelCalls, @toolCalls,
          @refusedInvalid, @refusedRules, @refusedLimit, COALESCE(@guard, 'none'), COALESCE(@guardKinds, ''), @durationMs, 0, @createdAt, @now)
       ON CONFLICT(turn_id) DO UPDATE SET
         dm_mode = excluded.dm_mode, backend_class = excluded.backend_class, backend = excluded.backend,
         model = excluded.model, status = excluded.status, model_calls = excluded.model_calls,
         tool_calls = excluded.tool_calls, refused_invalid = excluded.refused_invalid,
         refused_rules = excluded.refused_rules, refused_limit = excluded.refused_limit,
         guard = COALESCE(@guard, turn_quality.guard),
         guard_kinds = COALESCE(@guardKinds, turn_quality.guard_kinds),
         duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`,
    ).run({
      turnId: turn.id,
      campaignId: turn.campaignId,
      dmMode,
      backendClass,
      backend: backend ? String(backend).slice(0, 40) : null,
      model: model ? model.slice(0, 200) : null,
      status: turn.status,
      modelCalls: turn.callIndex,
      toolCalls: counts.toolCalls,
      refusedInvalid: counts.refusedInvalid,
      refusedRules: counts.refusedRules,
      refusedLimit: counts.refusedLimit,
      guard: guard?.outcome ?? null,
      guardKinds: guard ? guard.kinds.join(",") : null,
      durationMs,
      createdAt: turn.createdAt,
      now: nowIso(),
    });
  } catch (error) {
    console.error("[turn-quality] could not record", error);
  }
}

// A rewind's quality rows stay, marked, before the turns they describe go.
export function markRolledBack(campaignId: string, deletedAfterIso: string): void {
  getDatabase()
    .prepare(
      `UPDATE turn_quality SET rolled_back = 1
        WHERE campaign_id = ? AND turn_id IN (SELECT id FROM dm_turns WHERE campaign_id = ? AND created_at > ?)`,
    )
    .run(campaignId, campaignId, deletedAfterIso);
}

type QualityDbRow = {
  turn_id: string;
  campaign_id: string;
  dm_mode: DmMode;
  backend_class: BackendClass | null;
  backend: string | null;
  model: string | null;
  status: "done" | "failed";
  model_calls: number;
  tool_calls: number;
  refused_invalid: number;
  refused_rules: number;
  refused_limit: number;
  guard: GuardOutcome;
  guard_kinds: string;
  duration_ms: number | null;
  rolled_back: number;
  created_at: string;
};

function mapQuality(row: QualityDbRow): QualityRow {
  return {
    turnId: row.turn_id,
    campaignId: row.campaign_id,
    dmMode: row.dm_mode,
    backendClass: row.backend_class,
    backend: row.backend,
    model: row.model,
    status: row.status,
    modelCalls: row.model_calls,
    toolCalls: row.tool_calls,
    refusedInvalid: row.refused_invalid,
    refusedRules: row.refused_rules,
    refusedLimit: row.refused_limit,
    guard: row.guard,
    guardKinds: (row.guard_kinds ? row.guard_kinds.split(",") : []) as GuardKind[],
    durationMs: row.duration_ms,
    rolledBack: row.rolled_back === 1,
    createdAt: row.created_at,
  };
}

// Every row, oldest first: what Admin reads and the export writes.
export function listTurnQuality(): QualityRow[] {
  return (getDatabase().prepare(`SELECT * FROM turn_quality ORDER BY created_at, rowid`).all() as QualityDbRow[]).map(mapQuality);
}

// One campaign's newest rows, oldest first: what the report bundle carries.
export function recentTurnQuality(campaignId: string, limit: number): QualityRow[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM turn_quality WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(campaignId, Math.max(1, Math.floor(limit))) as QualityDbRow[];
  return rows.reverse().map(mapQuality);
}
