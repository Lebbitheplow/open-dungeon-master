// Which guarded write a listed opportunity accepts (docs/player-webhooks.md,
// "Event and submission contract"). Pure, so the rules are tested without a
// database; src/lib/agents/webhooks.ts reserves and records around them.

import type { PlayerOpportunity } from "./webhook-opportunities";

export type GuardedTool =
  | "odm_take_action"
  | "odm_answer_roll"
  | "odm_end_turn"
  | "odm_pass"
  | "odm_level_up"
  | "odm_answer_offer"
  | "odm_secret_action"
  | "odm_whisper_dm";

export const GUARDED_TOOLS: readonly GuardedTool[] = [
  "odm_take_action", "odm_answer_roll", "odm_end_turn", "odm_pass", "odm_level_up",
  "odm_answer_offer", "odm_secret_action", "odm_whisper_dm",
];

// A refused write re-opens its decision once under this suffix (issue 653),
// so a poller that wakes on a new fingerprint wakes again to correct it.
export const AGAIN_SUFFIX = ":again";

export function baseOpportunityId(id: string): string {
  return id.endsWith(AGAIN_SUFFIX) ? id.slice(0, -AGAIN_SUFFIX.length) : id;
}

// Every tool a decision accepts, and the ones a refusal names first. A turn
// accepts an action at any step (issue 653): the engine's own turn ledger
// refuses what is really spent, with its own words, as it does for a person
// at the same seat. Speech and a whisper cost nothing, so they stay open on
// a turn or a passage too.
const ACCEPTS: Record<PlayerOpportunity["type"], { all: readonly GuardedTool[]; named: readonly GuardedTool[] }> = {
  turn_started: { all: ["odm_take_action", "odm_end_turn", "odm_secret_action", "odm_whisper_dm"], named: ["odm_take_action", "odm_end_turn"] },
  response_requested: { all: ["odm_take_action", "odm_pass", "odm_secret_action", "odm_whisper_dm"], named: ["odm_take_action", "odm_pass"] },
  roll_requested: { all: ["odm_answer_roll"], named: ["odm_answer_roll"] },
  level_up_available: { all: ["odm_level_up"], named: ["odm_level_up"] },
  offer_received: { all: ["odm_answer_offer"], named: ["odm_answer_offer"] },
  // A whisper is answered privately: a whisper back, or a secret action.
  whisper_received: { all: ["odm_whisper_dm", "odm_secret_action"], named: ["odm_whisper_dm", "odm_secret_action"] },
};

export type GuardVerdict =
  | { ok: true }
  // The decision is listed but this tool or roll does not fit it. Re-issued
  // once, so the agent is woken to send what it does accept.
  | { ok: false; kind: "tool"; error: string; accepts: readonly GuardedTool[]; pendingRollId?: string }
  // Nothing is listed only because the GM is still answering: the next step
  // will come with its own wake-up.
  | { ok: false; kind: "wait"; error: string }
  // The decision is over (answered, moved on, or another seat's).
  | { ok: false; kind: "gone"; error: string };

export type GuardInput = {
  tool: GuardedTool;
  // The listed opportunity the write names (by its base ID), if any.
  opportunity: Pick<PlayerOpportunity, "type" | "pendingRollId"> | null;
  pendingRollId?: string;
  // turnIdentity() for the subscribed character, and the gate the listed IDs
  // carry, so a turn's End turn can be taken while its last step resolves.
  turnId: string | null;
  gate: number;
  busy: boolean;
  // The base ID the write named (":again" removed).
  requestedId: string;
};

function listOf(tools: readonly string[]): string {
  return tools.length < 2 ? tools.join("") : `${tools.slice(0, -1).join(", ")} or ${tools.at(-1)}`;
}

export function guardVerdict(input: GuardInput): GuardVerdict {
  const o = input.opportunity;
  if (!o) {
    const ownTurn = Boolean(input.turnId) && input.requestedId.startsWith(`${input.turnId}:`) && input.requestedId.endsWith(`:gate:${input.gate}`);
    // A person's End turn button works while the GM resolves their own
    // action; an agent ending its turn in the same wake as its action saves
    // the second wake-up every combat turn took (issue 653).
    if (ownTurn && input.tool === "odm_end_turn") return { ok: true };
    if (ownTurn || input.busy) {
      return { ok: false, kind: "wait", error: "The GM is still resolving the table's last move. Wait for your next wake-up, then read the opportunities again." };
    }
    return { ok: false, kind: "gone", error: "That opportunity is no longer open: it was answered, the table moved on, or it is another seat's. Read odm_get_player_webhook_opportunities for what is open now." };
  }
  const accepts = ACCEPTS[o.type];
  if (!accepts.all.includes(input.tool)) {
    return {
      ok: false, kind: "tool", accepts: accepts.named,
      error: `That opportunity does not permit ${input.tool}: a ${o.type} accepts ${listOf(accepts.named)}.`,
      ...(o.pendingRollId ? { pendingRollId: o.pendingRollId } : {}),
    };
  }
  if (o.type === "roll_requested" && o.pendingRollId !== input.pendingRollId) {
    return {
      ok: false, kind: "tool", accepts: accepts.named, pendingRollId: o.pendingRollId,
      error: `That opportunity does not permit this roll: it waits on pendingRollId ${o.pendingRollId}.`,
    };
  }
  return { ok: true };
}
