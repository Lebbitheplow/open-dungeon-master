import type { ChatMessage } from "@/lib/model-client";
import { textKey } from "@/lib/language/text-logic";

// What the table reads when a DM turn ends with no narration at all.
//
// "The moment hangs there" told the player nothing. The usual causes are a
// player action the server refused (a spell not on the sheet, no slot left)
// that the model never narrated around, or an action written too loosely for
// the model to act on ("usa la magia ambush": which slot, on whom?). The line
// now says which: the refusal's reason when there was one, what a spell cast
// is missing when the message was one, and a plain hint otherwise. Refusals
// from the DM's other tools stay hidden: their text can name things the
// table is not meant to see. A player action that went through and was then
// never narrated (the model's last call wrote a tool call instead of prose)
// says it went through: "try again" there asked for a second attack or a
// second purchase.

export const EMPTY_TURN_LINE = "The moment hangs there, waiting on the party's next move.";
export const RESOLVED_TURN_LINE =
  "Your action went through, and its dice and changes are on the table, but the DM gave no narration for it. Go on with your next move.";

const PLAYER_ACTION_TOOLS = new Set([
  "cast_at_enemy",
  "cast_at_player",
  "cast_buff",
  "use_spell_slot",
  "pc_attack",
  "use_resource",
  "use_item",
  "use_reaction",
]);

// What a player buys goes through these: done once, it must not be asked for
// again.
const PURCHASE_TOOLS = new Set(["purchase", "buy_item"]);

const CARDS_HINT = "You can also play it from the cards in your hand.";

// The player's last message and what their sheet can cast, for reading a
// loosely written spell. `levelOf` answers null for a name it cannot place.
export type EmptyTurnPlayer = {
  text: string;
  spells: string[];
  levelOf: (spell: string) => number | null;
  // Why an owned spell cannot be cast now (waiting for a rest, only in the
  // spellbook), or null.
  notReady?: (spell: string) => string | null;
};

type ToolCallLike = { id?: string; name?: string; function?: { name?: string } };

export function emptyTurnLine(conversation: ChatMessage[], player?: EmptyTurnPlayer | null): string {
  const outcome = lastActionOutcome(conversation);
  if (outcome?.refusal) {
    return `The DM could not resolve that: ${outcome.refusal} ${CARDS_HINT}`;
  }
  if (outcome?.resolved) {
    return RESOLVED_TURN_LINE;
  }
  if (player && player.text.trim()) {
    return explainLooseAction(player);
  }
  return EMPTY_TURN_LINE;
}

// The latest player action this turn: refused by the rules (its reason), or
// gone through. A retry or a limit coaches the model and is passed over.
function lastActionOutcome(conversation: ChatMessage[]): { refusal?: string; resolved?: boolean } | null {
  const names = new Map<string, string>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls as ToolCallLike[]) {
      const name = call.function?.name ?? call.name;
      if (call.id && name) {
        names.set(call.id, name);
      }
    }
  }
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (message.role !== "tool" || !message.tool_call_id || typeof message.content !== "string") {
      continue;
    }
    const name = names.get(message.tool_call_id) ?? "";
    if (!PLAYER_ACTION_TOOLS.has(name) && !PURCHASE_TOOLS.has(name)) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    const { error, refused } = (parsed ?? {}) as { error?: unknown; refused?: unknown };
    // Only the rules saying no is the player's business. A retry (a wrong id
    // the model sent, a choice to ask for) coaches the model and means
    // nothing at the table, and a cap on the turn is not their character
    // failing.
    if (typeof error === "string" && error.trim()) {
      if (refused === "rules" && PLAYER_ACTION_TOOLS.has(name)) {
        return { refusal: firstSentences(error) };
      }
      continue;
    }
    return { resolved: true };
  }
  return null;
}

// What a loosely written action is missing, read from the sheet alone: a
// spell the message names as the sheet writes it, whether it can be cast
// now, and its slot level. No word list reads the message, so every table
// language gets the same hint.
function explainLooseAction(player: EmptyTurnPlayer): string {
  const lower = textKey(player.text);
  const named = [...player.spells]
    .sort((a, b) => b.length - a.length)
    .find((spell) => lower.includes(textKey(spell)));
  if (!named) {
    return `The DM had no answer to that. Try again saying plainly what your character does, and to whom or what; for a spell, its name as it is on your sheet, the slot level and the target. ${CARDS_HINT}`;
  }
  const waiting = player.notReady?.(named);
  if (waiting) {
    return `The DM could not resolve that: ${waiting}`;
  }
  const level = player.levelOf(named);
  const slot = level === 0 ? "" : ` using a level ${level ?? 1} slot`;
  return `The DM could not resolve ${named}. Try again with the spell, slot and target spelled out, for example "I cast ${named}${slot} on myself." ${CARDS_HINT}`;
}

// Tool errors often go on to coach the model ("spend the slot with
// use_spell_slot..."); the player needs only the reason.
function firstSentences(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  const cut = plain.search(/[.!?](\s|$)/);
  const first = cut === -1 ? plain : plain.slice(0, cut + 1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
