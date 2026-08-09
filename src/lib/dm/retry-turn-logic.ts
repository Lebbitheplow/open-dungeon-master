// Pure rules for retrying a halted DM turn. No "@/" imports on purpose:
// scripts/test-retry-turn.mjs imports this file directly.
//
// A DM turn that throws leaves dm_turns.status = 'failed' with its whole
// conversation (system prompt, game state, tool calls, tool results) still on
// the row. The retry re-enters that persisted conversation instead of
// rebuilding a prompt, so nothing the party typed is consumed twice. These
// helpers decide when that is safe and what state the turn resumes from.

export type RetryTurnStatus = "running" | "awaiting_rolls" | "done" | "failed";

export type RetryTurnSnapshot = {
  id: string;
  campaignId: string;
  status: RetryTurnStatus;
  callIndex: number;
};

export type RetryEligibilityInput = {
  campaignId: string;
  // The campaign accepts play right now (status 'active').
  campaignActive: boolean;
  turn: RetryTurnSnapshot | null;
  // Newest dm_turns row for the campaign; a retry is only ever offered on it.
  latestTurnId: string | null;
  // pending_rolls rows for this turn still waiting on a player.
  openPendingRollCount: number;
};

export type RetryEligibility = { ok: true } | { ok: false; status: number; error: string };

export function checkRetryEligible(input: RetryEligibilityInput): RetryEligibility {
  const { turn } = input;
  if (!turn || turn.campaignId !== input.campaignId) {
    return { ok: false, status: 404, error: "That DM turn is not part of this campaign." };
  }
  if (!input.campaignActive) {
    return { ok: false, status: 409, error: "This campaign is not active." };
  }
  if (turn.status === "done") {
    // Guard against a retry landing on a turn that already narrated: the
    // banner may be stale in a tab that missed the message_updated event.
    return { ok: false, status: 409, error: "That turn already finished." };
  }
  if (turn.status === "running") {
    // Either the original run is still going or another player just claimed
    // the retry; either way the queue already owns this turn.
    return { ok: false, status: 409, error: "The DM is already working on that turn." };
  }
  if (turn.status === "awaiting_rolls" || input.openPendingRollCount > 0) {
    // Physical dice are the resume path for a parked turn (submitting the
    // last one enqueues resumeDmTurn). Retrying instead would re-enter the
    // turn with its roll tool calls still unanswered and ask for new dice.
    return {
      ok: false,
      status: 409,
      error: "That turn is waiting on dice. Submit the roll to continue.",
    };
  }
  if (input.latestTurnId && input.latestTurnId !== turn.id) {
    // A newer turn exists, so the story moved on. Replaying the old turn's
    // conversation would narrate into a scene that no longer matches, and it
    // could re-answer player whispers the newer turn already picked up (a
    // failed turn deliberately leaves its whispers pending for exactly that).
    return {
      ok: false,
      status: 409,
      error: "The story has moved on since that turn. Send a new action instead.",
    };
  }
  return { ok: true };
}

// Where the resumed turn re-enters the bounded tool loop. A turn that already
// burned its whole budget gets exactly one more model call, and that call is
// the forced-narration one (turn.ts treats callIndex === max - 1 as the final
// call and sends toolChoice "none"), so a retry can never restart the tool
// loop from scratch or loop forever.
export function retryCallIndex(callIndex: number, maxModelCalls: number): number {
  const ceiling = Math.max(0, maxModelCalls - 1);
  if (!Number.isFinite(callIndex) || callIndex < 0) {
    return 0;
  }
  return Math.min(Math.floor(callIndex), ceiling);
}

export type HaltedCallRewind = {
  narrationParts: string[];
  callIndex: number;
  rewound: boolean;
};

// turn.ts banks a model call at the start of a tool-loop iteration (callIndex
// goes up, the narration is pushed onto narrationParts) but only appends the
// assistant echo and its tool results to the persisted conversation at the end
// of a completed iteration. A turn that threw partway therefore carries one
// paragraph the retried model cannot see, plus a call the conversation has no
// record of. Left alone the retry writes that beat again and finalize() joins
// both copies into one message.
//
// Only the final iteration can be in that state, so only the last narration
// part is ever in question. `assistantText` is every assistant message in the
// persisted conversation joined together, with the same fake roll markers
// stripped that turn.ts strips from narration, so the two are comparable.
export function rewindHaltedCall(input: {
  narrationParts: readonly string[];
  callIndex: number;
  assistantText: string;
}): HaltedCallRewind {
  const parts = [...input.narrationParts];
  const last = parts[parts.length - 1];
  if (!last) {
    return { narrationParts: parts, callIndex: input.callIndex, rewound: false };
  }
  // Compared on a whitespace-normalized opening rather than the whole string:
  // the echo keeps the raw text while the narration part is trimmed, so an
  // exact match would miss echoes that are really there.
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  const signature = normalize(last).slice(0, 48);
  if (signature && normalize(input.assistantText).includes(signature)) {
    return { narrationParts: parts, callIndex: input.callIndex, rewound: false };
  }
  parts.pop();
  return {
    narrationParts: parts,
    // The crashed call left no trace in the conversation, so it must not count
    // against the budget either; the retry re-issues it from the same state.
    callIndex: Math.max(0, input.callIndex - 1),
    rewound: true,
  };
}

export type RetryChatMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

// Every assistant message's text in the persisted conversation, joined, for
// rewindHaltedCall. The prompt's history block renders past DM messages as
// assistant turns too; a stray match there only means the retry keeps a
// paragraph it could have dropped, never that it loses one.
export function assistantTextOf(conversation: readonly RetryChatMessage[]): string {
  const texts: string[] = [];
  for (const message of conversation ?? []) {
    if (message && message.role === "assistant" && typeof message.content === "string") {
      texts.push(message.content);
    }
  }
  return texts.join("\n");
}

// Tool calls the halted turn never answered. A throw partway through the tool
// loop persists an assistant message whose tool_calls have only some matching
// tool results, and strict OpenAI-compatible backends reject that shape. The
// retry answers the leftovers before re-entering, in the order the model
// asked for them.
export function danglingToolCallIds(conversation: readonly RetryChatMessage[]): string[] {
  const requested: string[] = [];
  const answered = new Set<string>();
  for (const message of conversation ?? []) {
    if (!message || typeof message !== "object") {
      continue;
    }
    if (message.role === "tool" && typeof message.tool_call_id === "string") {
      answered.add(message.tool_call_id);
    }
    if (!Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls) {
      const id = (call as { id?: unknown } | null)?.id;
      // Calls the model emitted without an id cannot be matched to a result
      // either way; turn.ts omits tool_call_id for them too, so they are not
      // dangling in any way a backend can see.
      if (typeof id === "string" && id) {
        requested.push(id);
      }
    }
  }
  const dangling: string[] = [];
  for (const id of requested) {
    if (!answered.has(id) && !dangling.includes(id)) {
      dangling.push(id);
    }
  }
  return dangling;
}
