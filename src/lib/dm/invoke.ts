// The adjudication façade: one entry point into the rules engine, for both
// the AI DM and a person running the table.
//
// ODM's server has always been the rules engine; the AI DM is a voice and a
// tool caller sitting on top of it (see src/lib/dm/engine-boundary.ts,
// "The server is the rules engine and you are its voice"). Human-DM mode is
// therefore not a second game system, it is a second caller. This module is
// where that becomes literal: `invokeEngine` takes an actor and a named
// adjudication, and reaches exactly the handlers turn.ts reaches.
//
// The per-turn caps the AI works under (MUTATION_CAP_PER_TURN and friends)
// are rails on a model that might loop, not rules of the game, so they do
// not apply to a person. Saying that here, once, is better than the two
// paths quietly differing.
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { createDmTurn, getDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { listMembers } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { adjudication, checkArgs, type CatalogEntry } from "@/lib/dm/invoke-catalog";
import { dispatchAdjudication } from "@/lib/dm/invoke-dispatch";
// "goblin x4" is the same shorthand a prepared encounter is saved in, so the
// live form and the saved roster share one parser.
import { parseRoster } from "@/lib/dm/encounter-template-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type Actor =
  | { kind: "ai"; turnId: string }
  | { kind: "human"; userId: string };

export type Adjudication = { name: string; args: Record<string, unknown> };

export type InvokeOutcome =
  | { ok: true; result: Record<string, unknown>; turnId: string }
  | { ok: false; error: string };

// Arguments a form produces are not quite arguments a tool call produces.
// A person types "goblin x3" where the model sends an array, and a comma
// separated list where it sends one. Normalizing here keeps the console
// simple and the handlers untouched.
const LIST_FIELDS = new Set([
  "characterIds",
  "enemyIds",
  "targetCharacterIds",
  "connections",
]);

function toList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

// "enemy:goblin-1 half" / "character:<id> double" / "goblin-2" -> what
// split_damage expects. A line with no share takes the full total, which is
// the common case and the one worth typing least for.
function toDamageTargets(
  value: unknown,
): Array<{ enemyId?: string; characterId?: string; share: string }> {
  if (Array.isArray(value)) {
    return value as Array<{ enemyId?: string; characterId?: string; share: string }>;
  }
  if (typeof value !== "string") {
    return [];
  }
  const rows: Array<{ enemyId?: string; characterId?: string; share: string }> = [];
  for (const line of value.split(/[\n;]/)) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const parts = text.split(/\s+/);
    const share = ["none", "half", "full", "double"].includes(
      (parts[parts.length - 1] ?? "").toLowerCase(),
    )
      ? (parts.pop() as string).toLowerCase()
      : "full";
    const ref = parts.join(" ");
    const asCharacter = /^character:/i.test(ref);
    const id = ref.replace(/^(enemy|character):/i, "").trim();
    if (!id) {
      continue;
    }
    rows.push(asCharacter ? { characterId: id, share } : { enemyId: id, share });
  }
  return rows;
}

export function normalizeArgs(
  entry: CatalogEntry,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (key === "enemies") {
      out.enemies = parseRoster(value);
      continue;
    }
    if (key === "targets" && entry.name === "split_damage") {
      out.targets = toDamageTargets(value);
      continue;
    }
    if (LIST_FIELDS.has(key)) {
      out[key] = toList(value);
      continue;
    }
    out[key] = value;
  }
  // The console asks for one modifier as three flat fields, because a form
  // that built an array of objects would be a worse form. The handler takes
  // the array the model sends, so the shapes meet here rather than in either
  // of them (src/lib/dm/effect-tools.ts).
  if (entry.name === "set_effect" && !out.modifiers && typeof out.field === "string") {
    out.modifiers = [
      { field: out.field, mode: out.mode ?? "add", ...(out.value === undefined ? {} : { value: out.value }) },
    ];
    delete out.field;
    delete out.mode;
    delete out.value;
  }
  // A single-character form still has to satisfy handlers that take a list.
  if (
    entry.fields.some((field) => field.name === "characterIds") &&
    !out.characterIds &&
    typeof out.characterId === "string"
  ) {
    out.characterIds = [out.characterId];
  }
  return out;
}

// Players who roll physical dice at the table. Their rolls park for them to
// enter rather than being rolled by the server, for a human DM exactly as
// for the AI one.
function realDiceUsers(campaign: Campaign): Set<string> {
  if (campaign.gameSettings.dicePolicy !== "real_allowed") {
    return new Set();
  }
  return new Set(
    listMembers(campaign.id)
      .filter((member) => member.useRealDice)
      .map((member) => member.userId),
  );
}

// The turn a human DM's adjudications hang on. Rolls need a turn to belong
// to (pending_rolls.turn_id is NOT NULL), and so does the encounter
// bookkeeping that tracks who has acted this round. One open human turn is
// reused until something parks a roll on it, which is what keeps "who has
// already swung this round" meaning what it says.
function humanTurnFor(campaignId: string): DmTurn {
  const open = listOpenPendingRolls(campaignId);
  for (const pending of open) {
    const turn = getDmTurn(pending.turnId);
    if (turn && turn.actor === "human_dm" && turn.status === "awaiting_rolls") {
      return turn;
    }
  }
  return createDmTurn(campaignId, [], "human_dm");
}

export async function invokeEngine(
  campaign: Campaign,
  actor: Actor,
  call: Adjudication,
): Promise<InvokeOutcome> {
  const entry = adjudication(call.name);
  if (!entry) {
    return { ok: false, error: `Unknown action "${call.name}".` };
  }
  const args = normalizeArgs(entry, call.args ?? {});
  const complaint = checkArgs(entry, args);
  if (complaint) {
    return { ok: false, error: complaint };
  }

  const turn =
    actor.kind === "ai" ? getDmTurn(actor.turnId) : humanTurnFor(campaign.id);
  if (!turn) {
    return { ok: false, error: "That DM turn no longer exists." };
  }

  const sheets: CharacterSheet[] = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

  let result: Record<string, unknown>;
  try {
    result = await dispatchAdjudication(entry.name, JSON.stringify(args), {
      campaign,
      turn,
      sheets,
      sheetsById,
      realDiceUserIds: realDiceUsers(campaign),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The engine could not resolve that.",
    };
  }

  // The handlers mutate the turn as they run (which enemies have acted, which
  // characters were resolved), and that bookkeeping is what stops an enemy
  // swinging twice. The AI's own turn loop saves its turn itself; a turn
  // reached through this façade has no loop behind it, so it is saved here or
  // the mutations are simply lost.
  //
  // Only a person's turn is closed here. A delegated AI turn may still have
  // more adjudications to come on it, so its caller decides when it is done.
  if (actor.kind === "human") {
    // A parked roll keeps the turn open so the answer lands on it; anything
    // else is finished the moment it resolves.
    const parked = listOpenPendingRolls(campaign.id).some(
      (pending) => pending.turnId === turn.id,
    );
    turn.status = parked ? "awaiting_rolls" : "done";
  }
  saveDmTurn(turn);

  if (typeof result.error === "string") {
    return { ok: false, error: result.error };
  }
  return { ok: true, result, turnId: turn.id };
}

// The counterpart to resumeDmTurn for a turn a person opened. There is no
// model to hand the answer back to: the rolls already published themselves
// and applied whatever they applied, so all that is left is to close the
// turn so the next adjudication starts a fresh one.
export function resumeHumanTurn(turnId: string): boolean {
  const turn = getDmTurn(turnId);
  if (!turn || turn.actor !== "human_dm" || turn.status !== "awaiting_rolls") {
    return false;
  }
  turn.status = "done";
  saveDmTurn(turn);
  return true;
}

// Convenience for routes that already have only the id.
export async function invokeEngineById(
  campaignId: string,
  actor: Actor,
  call: Adjudication,
): Promise<InvokeOutcome> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return { ok: false, error: "Campaign not found." };
  }
  return invokeEngine(campaign, actor, call);
}
