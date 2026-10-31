// What a DM turn did with the card a player played, read from the turn's
// stored conversation alone: the tool calls it made, their arguments and the
// engine's answers. The prose is never read. A card is resolved when a call
// carried it out (intent-logic.ts callMismatch), refused when the engine
// answered that call with a rules refusal, and missed when nothing did, with
// the ways the nearest calls fell short (a slot spent for a spell the engine
// rolls, another target, another character) kept as the reasons.
//
// The same reading serves the fixed scenarios of scripts/score-cards.mjs and
// an instance's own saved turns (issue 570): both ask the question mcerina
// put, how often the model resolves what the player asked for, and answer it
// from the calls rather than from the story.
//
// Pure: no database, no model.
import {
  DIRECT_CALL_ID_PREFIX,
  INTENT_CORRECTION_MARK,
  callMismatch,
  type CallMismatch,
  type PlayedCard,
  type TurnCall,
} from "@/lib/dm/intent-logic";

// A stored turn's message, as little of it as the reading needs. The DM turn
// stores the model client's ChatMessage (src/lib/model-client.ts); any list
// of objects with these fields reads the same.
export type StoredMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

// One call of the turn with where it came from: the engine's own (a direct
// card, DIRECT_CALL_ID_PREFIX) or the model's, and whether it was made after
// the corrective message that sent the model back to the card.
export type ScoredCall = TurnCall & {
  id: string;
  direct: boolean;
  afterCorrection: boolean;
};

export type CardVerdict = "resolved" | "refused" | "missed";

// Who carried the card out: the engine before any model call, the model on
// its own, the model only after the correction, or nobody.
export type CardPath = "engine" | "model" | "correction" | "none";

export type CardScore = {
  verdict: CardVerdict;
  path: CardPath;
  // When missed: how the calls to the card's own tools fell short, each once.
  // Empty when none of the card's tools was called at all.
  near: CallMismatch[];
  // Every tool the turn called, in order, the engine's direct call included.
  calls: string[];
  // Model calls the turn made: assistant messages the model wrote, so the
  // engine's direct card does not count as one.
  modelCalls: number;
  // The corrective message was sent.
  corrected: boolean;
};

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : "")).join("");
  }
  return "";
}

function argsOf(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") {
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function resultOf(content: unknown): Record<string, unknown> | null {
  const text = textOf(content);
  if (!text) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isDirectId(id: string): boolean {
  return id.startsWith(DIRECT_CALL_ID_PREFIX);
}

// Every tool call in a stored turn, paired with the result that answered it
// (by call id; a call the engine never answered keeps null), in order.
export function scoredCalls(conversation: readonly StoredMessage[]): ScoredCall[] {
  const calls: ScoredCall[] = [];
  const results = new Map<string, Record<string, unknown> | null>();
  let corrected = false;
  for (const message of conversation) {
    if (message.role === "user" && textOf(message.content).includes(INTENT_CORRECTION_MARK)) {
      corrected = true;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const raw of message.tool_calls) {
        const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
        const name = typeof call?.function?.name === "string" ? call.function.name : "";
        if (!name) {
          continue;
        }
        const id = typeof call.id === "string" ? call.id : "";
        calls.push({ id, name, args: argsOf(call.function?.arguments), result: null, direct: isDirectId(id), afterCorrection: corrected });
      }
    }
    if (message.role === "tool" && typeof message.tool_call_id === "string") {
      results.set(message.tool_call_id, resultOf(message.content));
    }
  }
  return calls.map((call) => ({ ...call, result: call.id ? results.get(call.id) ?? null : null }));
}

// The assistant message the engine wrote for a direct card: no prose, only
// calls with the direct id.
function engineOnly(message: StoredMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return (
    calls.length > 0 &&
    !textOf(message.content).trim() &&
    calls.every((raw) => {
      const call = raw as { id?: unknown };
      return typeof call?.id === "string" && isDirectId(call.id);
    })
  );
}

// Model calls in a stored turn. The turn's own counter (DmTurn.callIndex)
// counts every pass of its loop, the engine's direct card included, so the
// engine's passes come off it. Without the counter (a conversation alone),
// the assistant messages are counted; the turn does not store the reply that
// ended it, so that count runs one short.
export function modelCallsIn(conversation: readonly StoredMessage[], callIndex?: number): number {
  const enginePasses = conversation.filter(engineOnly).length;
  if (typeof callIndex === "number") {
    return Math.max(0, callIndex - enginePasses);
  }
  return conversation.filter((message) => message.role === "assistant").length - enginePasses;
}

// Whether the engine's answer was the game saying no (tool-errors.ts).
function refusedBy(result: Record<string, unknown> | null): boolean {
  return Boolean(result && typeof result.refused === "string");
}

// The score of one card against the turn that answered it. `callIndex` is
// the turn's own call counter when the turn is to hand (DmTurn.callIndex).
export function scoreCard(card: PlayedCard, conversation: readonly StoredMessage[], options: { callIndex?: number } = {}): CardScore {
  const calls = scoredCalls(conversation);
  const corrected = conversation.some((message) => message.role === "user" && textOf(message.content).includes(INTENT_CORRECTION_MARK));
  const names = calls.map((call) => call.name);
  const modelCalls = modelCallsIn(conversation, options.callIndex);
  const near = new Set<CallMismatch>();
  let hit: ScoredCall | null = null;
  for (const call of calls) {
    const mismatch = callMismatch(card, call);
    if (mismatch === null) {
      hit = call;
      break;
    }
    if (mismatch !== "tool") {
      near.add(mismatch);
    }
  }
  if (!hit) {
    return { verdict: "missed", path: "none", near: [...near], calls: names, modelCalls, corrected };
  }
  const path: CardPath = hit.direct ? "engine" : hit.afterCorrection ? "correction" : "model";
  return {
    verdict: refusedBy(hit.result) ? "refused" : "resolved",
    path,
    near: [],
    calls: names,
    modelCalls,
    corrected,
  };
}

// Counts of scores by verdict and by path, for a report that carries no
// story text: what a table can share.
export function tallyScores(scores: readonly Pick<CardScore, "verdict" | "path">[]): { verdict: Record<CardVerdict, number>; path: Record<CardPath, number> } {
  const verdict: Record<CardVerdict, number> = { resolved: 0, refused: 0, missed: 0 };
  const path: Record<CardPath, number> = { engine: 0, model: 0, correction: 0, none: 0 };
  for (const score of scores) {
    verdict[score.verdict] += 1;
    path[score.path] += 1;
  }
  return { verdict, path };
}
