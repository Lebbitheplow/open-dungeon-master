import { getDatabase } from "@/lib/db/core";
import { getRelationshipById, patchRelationship } from "@/lib/db/relationships";
import { addMemory, applyApproval, REFUSAL_COST } from "@/lib/dm/relationship-logic";
import { ADVANCE_TOOL, DECLINE_COOLDOWN, LAPSE_COOLDOWN } from "@/lib/dm/advance-logic";
import type { ItemProposal } from "@/lib/db/item-proposals";

// The storage half of NPC advances (issue 501): the campaign's AI-turn
// clock, the pending advances, and what an answer that is not a yes does
// to the relationship. Rules live in src/lib/dm/advance-logic.ts; the yes,
// which takes a romantic step, is src/lib/dm/npc-advance.ts.

// AI turns finished at this table.
export function getAiTurns(campaignId: string): number {
  const row = getDatabase().prepare(`SELECT ai_turns FROM campaigns WHERE id = ?`).get(campaignId) as
    | { ai_turns: number | null }
    | undefined;
  return row?.ai_turns ?? 0;
}

// One more finished AI turn, whatever the world-simulation setting says.
export function bumpAiTurns(campaignId: string): number {
  getDatabase().prepare(`UPDATE campaigns SET ai_turns = ai_turns + 1 WHERE id = ?`).run(campaignId);
  return getAiTurns(campaignId);
}

// What an advance offer stores (item_proposals.args_json).
export type AdvanceArgs = {
  relationshipId: string;
  subject: string;
  subjectKind: "npc" | "companion";
  subjectId: string;
  to: "courting";
  // The suitor's own words, as the DM wrote them.
  note: string;
  // The AI turn it was made on, for the no-answer lapse.
  madeAtTurn: number;
};

export function advanceArgs(proposal: Pick<ItemProposal, "argsJson">): AdvanceArgs | null {
  try {
    const parsed = JSON.parse(proposal.argsJson || "{}") as Partial<AdvanceArgs>;
    if (typeof parsed.relationshipId !== "string" || typeof parsed.subject !== "string") {
      return null;
    }
    return {
      relationshipId: parsed.relationshipId,
      subject: parsed.subject,
      subjectKind: parsed.subjectKind === "companion" ? "companion" : "npc",
      subjectId: typeof parsed.subjectId === "string" ? parsed.subjectId : "",
      to: "courting",
      note: typeof parsed.note === "string" ? parsed.note : "",
      madeAtTurn: Math.max(0, Number(parsed.madeAtTurn) || 0),
    };
  } catch {
    return null;
  }
}

type ProposalRow = { id: string; character_id: string; args_json: string; created_at: string; user_id: string };

// The advances still waiting on an answer.
export function listPendingAdvances(campaignId: string): Array<{ id: string; characterId: string; userId: string; args: AdvanceArgs }> {
  const rows = getDatabase()
    .prepare(
      `SELECT id, character_id, args_json, created_at, user_id FROM item_proposals
       WHERE campaign_id = ? AND tool_name = ? AND status = 'pending' ORDER BY seq ASC`,
    )
    .all(campaignId, ADVANCE_TOOL) as ProposalRow[];
  return rows.flatMap((row) => {
    const args = advanceArgs({ argsJson: row.args_json });
    return args ? [{ id: row.id, characterId: row.character_id, userId: row.user_id, args }] : [];
  });
}

// What an answer other than yes leaves between the two. A no stings a
// little and the suitor does not ask again for a while; no answer at all,
// or one withdrawn, closes the moment with no sting. Every one of them
// closes the window.
export function settleAdvanceRelationship(
  proposal: Pick<ItemProposal, "argsJson" | "campaignId">,
  status: "declined" | "expired" | "cancelled",
  characterName: string,
): void {
  const args = advanceArgs(proposal);
  const relationship = args ? getRelationshipById(args.relationshipId) : null;
  if (!args || !relationship) {
    return;
  }
  const now = getAiTurns(proposal.campaignId);
  if (status === "declined") {
    patchRelationship(relationship.id, {
      approval: applyApproval(relationship.approval, REFUSAL_COST),
      advanceReadyUntil: 0,
      advanceCooldownUntil: now + DECLINE_COOLDOWN,
      memories: addMemory(relationship.memories, {
        kind: "refused",
        text: `${characterName} turned down ${args.subject}`,
        at: new Date().toISOString(),
      }),
    });
    return;
  }
  patchRelationship(relationship.id, {
    advanceReadyUntil: 0,
    ...(status === "expired" ? { advanceCooldownUntil: now + LAPSE_COOLDOWN } : {}),
  });
}
