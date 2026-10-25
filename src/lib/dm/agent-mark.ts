// The first message of a turn row an agent program's calls hang on
// (src/lib/dm/agent-turn.ts), so it is never mistaken for a storyteller turn
// (whose first message is the system prompt). A leaf module, so the turn
// quality writer (src/lib/db/turn-ledger.ts) can tell such a turn apart
// without importing the agent's door into the engine.
export const AGENT_MARK = "[agent program in the DM seat]";

// The one message of a turn row that stopped before it had a prompt
// (src/lib/dm/turn-halt.ts). Retry closes such a row as done and starts the
// turn over, so its narrator quality row stays failed: the model never ran
// on it (issue #460).
export const UNBUILT_TURN_MARK = "[odm:turn-not-built]";
