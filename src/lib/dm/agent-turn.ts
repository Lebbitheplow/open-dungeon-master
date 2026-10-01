// A connected agent program in the DM seat (src/lib/agents/workbench.ts)
// reaches the engine through the human DM's routes, signed in as the person
// who connected it. It is still a program, not that person: it gets the AI's
// rails, not the console's correction power.
//
// So its adjudications run as actor kind "ai" on a turn of its own, which
// keeps the per-turn caps, refuses the fields update_sheet leaves to the
// rules, and records each call and its result the way the turn loop's
// conversation does. Its narration is then checked by the same guard as the
// built-in storyteller's, against those results and the live encounter; a
// contradiction is refused with the reason, which is the agent's rewrite
// prompt. Posting narration closes the turn, so the next stretch of play
// starts a fresh one, as a new player action starts a new AI turn.
import { getDatabase } from "@/lib/db/core";
import { createDmTurn, getDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { listSheets } from "@/lib/db/sheets";
import type { Campaign } from "@/lib/db/campaigns";
import { checkNarration } from "@/lib/dm/engine-boundary";
import { leveledSpellNames, liveStateFor } from "@/lib/dm/narration-guard";

// Every request an agent program sends carries this header
// (src/lib/agents/workbench.ts workbenchCall).
export function isAgentRequest(request: Request): boolean {
  return request.headers.get("x-odm-client") === "agent";
}

// A turn row the agent's calls hang on is marked by its first message, so
// it is never mistaken for a storyteller turn (whose first message is the
// system prompt).
const AGENT_MARK = "[agent program in the DM seat]";

function findAgentTurn(campaignId: string): DmTurn | null {
  const rows = getDatabase()
    .prepare(
      `SELECT id FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' AND status = 'running' ORDER BY created_at DESC LIMIT 5`,
    )
    .all(campaignId) as Array<{ id: string }>;
  for (const row of rows) {
    const turn = getDmTurn(row.id);
    if (turn && turn.conversation[0]?.content === AGENT_MARK) {
      return turn;
    }
  }
  return null;
}

export function agentTurnFor(campaignId: string): DmTurn {
  return findAgentTurn(campaignId) ?? createDmTurn(campaignId, [{ role: "user", content: AGENT_MARK }]);
}

// One adjudication and what the engine answered, in the conversation's own
// shape, so the guard can read it later.
export function recordAgentCall(
  turnId: string,
  name: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const turn = getDmTurn(turnId);
  if (!turn) {
    return;
  }
  const id = `agent_${turn.conversation.length}`;
  turn.conversation.push(
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    { role: "tool", tool_call_id: id, content: JSON.stringify(result) },
  );
  saveDmTurn(turn);
}

// What in the agent's narration contradicts the engine, as one sentence for
// the refusal, or null. With the guard switched off at the table, nothing.
export function agentNarrationProblem(campaign: Campaign, narration: string): string | null {
  if (!campaign.gameSettings.narrationGuard) {
    return null;
  }
  const found = checkNarration({
    conversation: findAgentTurn(campaign.id)?.conversation ?? [],
    narration,
    partyNames: listSheets(campaign.id).map((sheet) => sheet.name),
    live: liveStateFor(campaign.id),
    leveledSpells: leveledSpellNames(),
  });
  if (!found.length) {
    return null;
  }
  return `The narration contradicts what the engine resolved: ${found
    .slice(0, 4)
    .map((entry) => `${entry.detail} ("${entry.clause}")`)
    .join("; ")}. Rewrite it to match the results, or resolve the action with its tool first.`;
}

// Narration posted: the agent's stretch of play is over.
export function closeAgentTurn(campaignId: string) {
  const turn = findAgentTurn(campaignId);
  if (turn) {
    turn.status = "done";
    saveDmTurn(turn);
  }
}
