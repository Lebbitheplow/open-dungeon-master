// Some chat templates take the conversation after the system message only as
// user and assistant in turn (Mistral's, Gemma 3's), and llama-server answers
// anything else with the template's exception as a 500. The DM's prompt sends
// two user messages in a row whenever it can: the game state and then the
// player's line (src/lib/dm/prompt.ts stateAfterRules), or a table note and
// then the player's line. Such a model is sent those as one message, which
// keeps the message boundary a prompt cache needs right after the rules.
//
// Dependency-free so scripts/test-model-calls.mjs can import it directly.

type RoleMessage = { role: string; content?: unknown; tool_calls?: unknown };

export function rolesMustAlternate(errorText: string): boolean {
  return /roles must alternate/i.test(errorText);
}

// Neighbouring user messages, and neighbouring assistant messages that carry
// no tool calls, joined into one. Tool calls and their results stay as sent.
export function withAlternatingRoles<T extends RoleMessage>(messages: readonly T[]): T[] {
  const joined: T[] = [];
  for (const message of messages) {
    const last = joined.at(-1);
    const joinable =
      last !== undefined &&
      last.role === message.role &&
      (message.role === "user" || message.role === "assistant") &&
      !last.tool_calls &&
      !message.tool_calls &&
      typeof last.content === "string" &&
      typeof message.content === "string";
    if (joinable) {
      joined[joined.length - 1] = { ...last, content: `${last.content}\n\n${message.content}` };
    } else {
      joined.push(message);
    }
  }
  return joined;
}
