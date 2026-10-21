import type { Floor } from "@/lib/db/campaigns";

export type PlayerOpportunity = {
  type: "turn_started" | "roll_requested" | "response_requested" | "level_up_available";
  opportunityId: string;
  characterId: string;
  pendingRollId?: string;
  phase?: "act" | "finish";
  // level_up_available: the next level, the one odm_level_up takes.
  level?: number;
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
  // The subscribed character's level and the level its experience has
  // earned (levelForXp, at most 20). Null for a companion's sheet.
  level?: { current: number; earned: number } | null;
};

// IDs name decisions, not notifications: another player's reply, a sheet
// update or retrying delivery must not invite the same decision twice.
export function playerOpportunities(s: OpportunityState): PlayerOpportunity[] {
  if (!s.active || s.paused || s.floor.mode === "hold" || !s.characterId || s.busy) return [];
  // An earned level comes after whatever the table asks, and nothing the
  // table does holds it back: another seat's roll, someone else's turn.
  return [...tableOpportunities(s), ...levelOpportunity(s)];
}

function tableOpportunities(s: OpportunityState): PlayerOpportunity[] {
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
  // lastPlayerSeq counts a pass as well as a post. At a table that waits for
  // everyone (src/lib/dm/table-wait.ts) another player's post no longer wakes
  // the DM, so the DM stays idle and this stays live while the table
  // gathers, until this player acts or passes.
  return s.narration && s.lastPlayerSeq < s.narration.seq
    ? [{ type: "response_requested", opportunityId: `narration:${s.narration.id}`, characterId: s.characterId }]
    : [];
}

// One level at a time, named by the level: more experience toward the same
// level is the same decision, and taking it opens the next one if earned.
function levelOpportunity(s: OpportunityState): PlayerOpportunity[] {
  const l = s.level;
  if (!l || l.current >= 20 || l.earned <= l.current) return [];
  const level = l.current + 1;
  return [{ type: "level_up_available", opportunityId: `level:${s.characterId}:${level}`, characterId: s.characterId, level }];
}
