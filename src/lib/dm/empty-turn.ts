import type { ChatMessage } from "@/lib/model-client";

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
    if (typeof error === "string" && error.trim()) {
      return firstSentences(error);
    }
  }
  return null;
}

// Words that say "a spell" in the languages players have written in.
const SPELL_WORDS =
  /\b(cast|casts|casting|spell|spells|magia|magie|incantesimo|incantesimi|lancio|lancia|lanciare|trucchetto|sort|hechizo|conjuro|zauber)\b/i;
// A slot level: "level 1", "1st level", "livello 2", "slot 3".
const SLOT_WORDS =
  /\b(level|lvl|livello|slot)\s*\d|\b\d\s*(st|nd|rd|th)?[\s-]*(level|livello)\b|\bslot\s+(di\s+)?(livello\s+)?\d/i;
// A target: "on", "at", "against", "su", "contro", "myself"...
const TARGET_WORDS =
  /\b(on|at|against|toward|towards|onto|myself|me|self|su|sul|sulla|sui|sugli|sulle|contro|verso|addosso|me stesso|me stessa|mio|mia)\b/i;

function explainLooseAction(player: EmptyTurnPlayer): string {
  const text = player.text.trim();
  const lower = text.toLowerCase();
  const named = [...player.spells]
    .sort((a, b) => b.length - a.length)
    .find((spell) => lower.includes(spell.trim().toLowerCase()));
  const looksLikeSpell = SPELL_WORDS.test(text) || Boolean(named);
  if (!looksLikeSpell) {
    return `The DM had no answer to that. Try again saying plainly what your character does, and to whom or what. ${CARDS_HINT}`;
  }
  if (!named) {
    return `The DM could not tell which spell you meant. Write its name as it is on your sheet, with the slot level and the target, for example: "I cast Magic Missile using a level 1 slot at the goblin." ${CARDS_HINT}`;
  }
  const waiting = player.notReady?.(named);
  if (waiting) {
    return `The DM could not resolve that: ${waiting}`;
  }
  const level = player.levelOf(named);
  const missing: string[] = [];
  if (level !== 0 && !SLOT_WORDS.test(text)) {
    missing.push(level ? `the slot level (level ${level} or higher)` : "the slot level");
  }
  if (!TARGET_WORDS.test(text)) {
    missing.push("who or what you cast it on (yourself, an ally, an enemy)");
  }
  const slot = level === 0 ? "" : ` using a level ${level ?? 1} slot`;
  const example = `"I cast ${named}${slot} on myself."`;
  if (missing.length) {
    return `The DM could not resolve ${named}: say ${missing.join(" and ")}, for example ${example} ${CARDS_HINT}`;
  }
  return `The DM could not resolve ${named}. Try again with the spell, slot and target spelled out, for example ${example} ${CARDS_HINT}`;
}

// Tool errors often go on to coach the model ("spend the slot with
// use_spell_slot..."); the player needs only the reason.
function firstSentences(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  const cut = plain.search(/[.!?](\s|$)/);
  const first = cut === -1 ? plain : plain.slice(0, cut + 1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
