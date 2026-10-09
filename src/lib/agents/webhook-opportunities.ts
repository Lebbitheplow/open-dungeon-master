import type { Floor } from "@/lib/db/campaigns";

export type PlayerOpportunity = {
  type: "turn_started" | "roll_requested" | "response_requested";
  opportunityId: string;
  characterId: string;
  pendingRollId?: string;
  phase?: "act" | "finish";
};

export type OpportunityState = {
  active: boolean;
  paused: boolean;
  busy: boolean;
  awaitingRolls?: boolean;
  floor: Floor;
  floorSeq: number;
  userId: string;
  characterId: string;
  rolls: Array<{ id: string; userId: string; characterId: string | null }>;
  turn: { id: string; characterId: string; userId: string; key: string; waitingSeq: number } | null;
  narration: { id: string; seq: number } | null;
  lastPlayerSeq: number;
};

// IDs name decisions, not notifications: another player's reply, a sheet
// update or retrying delivery must not invite the same decision twice.
export function playerOpportunities(s: OpportunityState): PlayerOpportunity[] {
  if (!s.active || s.paused || s.floor.mode === "hold" || !s.characterId || s.busy) return [];
  const rolls = s.rolls.filter((r) => r.userId === s.userId && r.characterId === s.characterId);
  if (rolls.length) {
    return rolls.map((r) => ({
      type: "roll_requested", opportunityId: `roll:${r.id}`, characterId: s.characterId, pendingRollId: r.id,
    }));
  }
  // A parked narration cannot invite new actions while another seat rolls.
  if (s.rolls.length || s.awaitingRolls) return [];
  if (s.floor.mode === "initiative") {
    const t = s.turn;
    const phase = t && s.lastPlayerSeq > t.waitingSeq ? "finish" : "act";
    return t && t.userId === s.userId && t.characterId === s.characterId && s.floor.userIds.includes(s.userId)
      ? [{ type: "turn_started", opportunityId: `turn:${t.id}:${t.key}:${t.waitingSeq}:${phase}`, characterId: s.characterId, phase }]
      : [];
  }
  if (s.floor.mode === "spotlight") {
    return s.floor.userIds.includes(s.userId) && !s.floor.respondedUserIds.includes(s.userId)
      ? [{ type: "response_requested", opportunityId: `spotlight:${s.floorSeq}`, characterId: s.characterId }]
      : [];
  }
  // This is permission to inspect a settled passage, not an instruction to
  // speak. The agent decides whether that passage actually invites it.
  return s.narration && s.lastPlayerSeq < s.narration.seq
    ? [{ type: "response_requested", opportunityId: `narration:${s.narration.id}`, characterId: s.characterId }]
    : [];
}
