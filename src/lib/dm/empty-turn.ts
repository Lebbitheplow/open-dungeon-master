import type { ChatMessage } from "@/lib/model-client";
import { markToolError } from "@/lib/dm/tool-errors";

// What the table reads when a DM turn ends with no narration at all.
//
// "The moment hangs there" told the player nothing. The usual causes are a
// player action the server refused (a spell not on the sheet, no slot left)
// that the model never narrated around, or an action written too loosely for
// the model to act on ("usa la magia ambush": which slot, on whom?). The line
// now says which: the refusal's reason when there was one, what a spell cast
// is missing when the message was one, and a plain hint otherwise. Refusals
// from the DM's other tools stay hidden: their text can name things the
// table is not meant to see.

export const EMPTY_TURN_LINE = "The moment hangs there, waiting on the party's next move.";

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
  const refusal = lastActionRefusal(conversation);
  if (refusal) {
    return `The DM could not resolve that: ${refusal} ${CARDS_HINT}`;
  }
  if (player && player.text.trim()) {
    return explainLooseAction(player);
  }
  return EMPTY_TURN_LINE;
}

function lastActionRefusal(conversation: ChatMessage[]): string | null {
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
    if (!PLAYER_ACTION_TOOLS.has(names.get(message.tool_call_id) ?? "")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    const error = (parsed as { error?: unknown } | null)?.error;
    // Only the rules saying no is the player's business. An argument fault
    // (a wrong id the model sent) coaches the model and means nothing at
    // the table, and a cap on the turn is not their character failing.
    if (typeof error === "string" && error.trim() && markToolError(parsed as Record<string, unknown>).refused === "rules") {
      return firstSentences(error);
    }
  }
  return null;
}

// What a loosely written action is missing, read from the sheet alone: a
// spell the message names as the sheet writes it, whether it can be cast
// now, and its slot level. No word list reads the message, so every table
// language gets the same hint.
function explainLooseAction(player: EmptyTurnPlayer): string {
  const lower = player.text.trim().toLowerCase();
  const named = [...player.spells]
    .sort((a, b) => b.length - a.length)
    .find((spell) => lower.includes(spell.trim().toLowerCase()));
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
