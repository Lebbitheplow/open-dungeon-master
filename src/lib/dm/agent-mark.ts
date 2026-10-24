// The first message of a turn row an agent program's calls hang on
// (src/lib/dm/agent-turn.ts), so it is never mistaken for a storyteller turn
// (whose first message is the system prompt). A leaf module, so the turn
// quality writer (src/lib/db/turn-ledger.ts) can tell such a turn apart
// without importing the agent's door into the engine.
export const AGENT_MARK = "[agent program in the DM seat]";
