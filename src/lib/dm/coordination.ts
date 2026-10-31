import { allocateSeq, campaignSeats, combatOwnsFloor, getFloor, listMembers, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { nowIso } from "@/lib/db/core";
import { dmNarratedSince, insertCoordination, latestCoordination, planStillPosted, saveCoordination } from "@/lib/db/coordination";
import { claimNarrationSeq } from "@/lib/dm/narration-slot";
import { requestDmTurn } from "@/lib/dm/loop";
import { answerSpotlight } from "@/lib/dm/spotlight-answer";
import { hasHumanDm, narratorIsAi } from "@/lib/dm/viewer";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import {
  coordinationBlock,
  frozenEntries,
  humansSettled,
  lapsed,
  orderPlan,
  resolvedNote,
  setAsideNote,
  stagePlan,
  stageRequest,
  unconfirmedOrder,
  withSequence,
  type CoordinationEntry,
  type CoordinationPhase,
} from "@/lib/dm/coordination-logic";
import { normalizeSequence, type PlanSequence } from "@/lib/dm/plan-order";

// Coordinate actions (issue 254), the server half: opening a plan, staging,
// resolving it into one DM turn, and setting it aside. The rules are in
// src/lib/dm/coordination-logic.ts. Every change is published as
// coordination_updated with the phase (or null), so every seat, a reload
// included, draws the same plan.

function publish(campaignId: string, phase: CoordinationPhase | null) {
  publishPersisted(campaignId, "coordination_updated", { phase });
}

// A table note, posted like the server's other lines.
function tableNote(campaignId: string, content: string) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-bell", content });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

function setAside(phase: CoordinationPhase, reason: "fight" | "lapsed" | "cancelled"): CoordinationPhase {
  const ended = saveCoordination({ ...phase, status: "cancelled", outcome: reason, updatedAt: nowIso() });
  tableNote(phase.campaignId, setAsideNote(phase, reason));
  publish(phase.campaignId, null);
  return ended;
}

// The plan the table is drafting now, or null. A fight that began, or a plan
// untouched for two hours, sets it aside here, on whichever read comes first,
// so a plan can never hold a table that has moved on.
export function currentCoordination(campaignId: string): CoordinationPhase | null {
  const phase = latestCoordination(campaignId);
  if (!phase || phase.status !== "drafting") {
    return null;
  }
  if (getActiveEncounter(campaignId) || combatOwnsFloor(getFloor(campaignId))) {
    setAside(phase, "fight");
    return null;
  }
  if (lapsed(phase, Date.now())) {
    setAside(phase, "lapsed");
    return null;
  }
  return phase;
}

// Whether the table may coordinate at all: the AI narrates it, and no fight
// owns the floor.
export function coordinationRefusal(campaign: Campaign): string | null {
  if (!narratorIsAi(campaign.gameSettings.dmMode) || hasHumanDm(campaignSeats(campaign))) {
    return "Coordinated actions are for a table the AI narrates; a GM in the seat already takes the party's moves together.";
  }
  if (campaign.status !== "active") {
    return "The adventure has not started yet.";
  }
  if (getActiveEncounter(campaign.id) || combatOwnsFloor(getFloor(campaign.id))) {
    return "A fight is running; the initiative order takes the turns now.";
  }
  return null;
}

export function openCoordination(
  campaign: Campaign,
  openedBy: string,
  input: { characterIds: string[]; prompt: string; sequence?: PlanSequence | null },
): { phase: CoordinationPhase } | { error: string; status: number } {
  const refusal = coordinationRefusal(campaign);
  if (refusal) {
    return { error: refusal, status: 409 };
  }
  if (currentCoordination(campaign.id)) {
    return { error: "The party is already coordinating; resolve or set aside that plan first.", status: 409 };
  }
  // The characters in the order the lead picked them; the whole party, in
  // sheet order, when none were picked.
  const wanted = new Set(input.characterIds);
  const picked = input.characterIds.filter((id, index) => input.characterIds.indexOf(id) === index);
  const party = listSheets(campaign.id);
  const sheets = wanted.size
    ? picked.flatMap((id) => party.filter((sheet) => sheet.id === id))
    : party;
  const now = nowIso();
  const unordered: CoordinationEntry[] = sheets.map((sheet) => ({
    characterId: sheet.id,
    name: sheet.name,
    userId: sheet.isCompanion ? null : sheet.userId,
    companion: Boolean(sheet.isCompanion),
    text: "",
    state: "waiting" as const,
    requestedBy: null,
    updatedAt: now,
  }));
  if (!unordered.some((entry) => !entry.companion)) {
    return { error: "Pick at least one player's character to coordinate.", status: 400 };
  }
  // The order the lead set, if any (issue 292): every character once.
  const sequence = input.sequence ? normalizeSequence(input.sequence, unordered.map((entry) => entry.characterId)) : null;
  if (input.sequence && !sequence) {
    return { error: "The order must name each character in the plan once.", status: 400 };
  }
  const entries = withSequence(unordered, sequence);
  const phase = insertCoordination({ campaignId: campaign.id, openedBy, prompt: input.prompt.trim().slice(0, 300), entries });
  publish(campaign.id, phase);
  return { phase };
}

// A player's own character, or a request for a companion; resolves the plan
// when this was the last player it waited on.
export function stageCoordination(
  campaignId: string,
  userId: string,
  input:
    | { kind: "plan"; characterId: string; text?: string; state: "drafting" | "ready" | "pass"; orderSeen?: string }
    | { kind: "request"; characterId: string; text: string; requestedBy: string | null },
): { phase: CoordinationPhase } | { error: string; status: number } {
  const phase = currentCoordination(campaignId);
  if (!phase) {
    return { error: "The party is not coordinating right now.", status: 409 };
  }
  if (input.kind === "request" && !phase.entries.some((entry) => !entry.companion && entry.userId === userId)) {
    return { error: "Only a player in the plan may ask a companion for something.", status: 403 };
  }
  const now = nowIso();
  const staged =
    input.kind === "plan"
      ? stagePlan(phase, { characterId: input.characterId, userId, text: input.text, state: input.state, orderSeen: input.orderSeen }, now)
      : stageRequest(phase, { characterId: input.characterId, text: input.text, requestedBy: input.requestedBy }, now);
  if ("error" in staged) {
    return { error: staged.error, status: 400 };
  }
  const saved = saveCoordination(staged.phase);
  if (humansSettled(saved)) {
    return { phase: resolveCoordination(saved) };
  }
  publish(campaignId, saved);
  return { phase: saved };
}

// The lead sets, changes or clears the plan's order (issue 292). A player
// whose character was Ready and now stands elsewhere in it is asked to look
// again before the plan can resolve (coordination-logic.ts orderPlan).
export function orderCoordination(
  campaignId: string,
  sequence: PlanSequence | null,
): { phase: CoordinationPhase } | { error: string; status: number } {
  const phase = currentCoordination(campaignId);
  if (!phase) {
    return { error: "The party is not coordinating right now.", status: 409 };
  }
  const ordered = orderPlan(phase, sequence, nowIso());
  if ("error" in ordered) {
    return { error: ordered.error, status: 400 };
  }
  const saved = saveCoordination(ordered.phase);
  publish(campaignId, saved);
  return { phase: saved };
}

// Why the lead cannot resolve the plan early, or null: a player has not yet
// seen the order the lead changed after they were Ready.
export function earlyResolveRefusal(phase: CoordinationPhase): string | null {
  const waiting = unconfirmedOrder(phase);
  return waiting.length
    ? `The order changed after ${waiting.join(" and ")} ${waiting.length === 1 ? "was" : "were"} ready; wait for ${waiting.length === 1 ? "that player" : "those players"} to mark it Ready again, or change the order back.`
    : null;
}

// Freezes the plan and hands it to the DM: each player's line is posted as
// their character's own action, a companion's request stays in the plan the
// DM reads, and ONE turn is requested. The lines go up in the plan's order
// (step by step when the lead set one). Synchronous up to that request, so two
// readies landing together resolve it once; a phase no longer drafting is
// returned as it is (a retry replays nothing).
export function resolveCoordination(phase: CoordinationPhase): CoordinationPhase {
  const latest = latestCoordination(phase.campaignId);
  if (!latest || latest.id !== phase.id || latest.status !== "drafting") {
    return latest ?? phase;
  }
  const entries = frozenEntries(phase);
  claimNarrationSeq(phase.campaignId);
  let firstSeq: number | null = null;
  for (const entry of entries) {
    if (entry.companion || entry.state !== "ready" || !entry.text || !entry.userId) {
      continue;
    }
    const seq = allocateSeq(phase.campaignId);
    firstSeq ??= seq;
    const message = insertCampaignMessage({
      campaignId: phase.campaignId,
      seq,
      authorType: "player",
      userId: entry.userId,
      characterId: entry.characterId,
      content: entry.text,
    });
    publishWithSeq(phase.campaignId, seq, "message_added", { message });
    // The line is that player's move, as one posted through the actions
    // route is, so it answers a spotlight on them: a lead who opens a plan
    // for the players the GM asked must not leave the GM's question up.
    answerSpotlight(phase.campaignId, getFloor(phase.campaignId), entry.userId);
  }
  const noteSeq = allocateSeq(phase.campaignId);
  firstSeq ??= noteSeq;
  const note = insertCampaignMessage({
    campaignId: phase.campaignId,
    seq: noteSeq,
    authorType: "system",
    glyph: "cue-bell",
    content: resolvedNote({ entries }),
  });
  publishWithSeq(phase.campaignId, noteSeq, "message_added", { message: note });
  const resolved = saveCoordination({ ...phase, entries, status: "resolved", resolvedSeq: firstSeq, updatedAt: nowIso() });
  publish(phase.campaignId, null);
  requestDmTurn(phase.campaignId);
  return resolved;
}

export function cancelCoordination(campaignId: string): CoordinationPhase | null {
  const phase = currentCoordination(campaignId);
  return phase ? setAside(phase, "cancelled") : null;
}

// The block the DM reads with the turn a resolved plan woke, until it has
// narrated past the plan (src/lib/dm/prompt.ts).
export function coordinationForPrompt(campaignId: string): string | null {
  const phase = latestCoordination(campaignId);
  if (!phase || phase.status !== "resolved" || phase.resolvedSeq === null) {
    return null;
  }
  if (dmNarratedSince(campaignId, phase.resolvedSeq) || !planStillPosted(campaignId, phase.resolvedSeq)) {
    return null;
  }
  const names = new Map(listMembers(campaignId).map((member) => [member.userId, member.username]));
  return coordinationBlock(phase, (userId) => names.get(userId) ?? "player");
}

// Whether a player's own move should go into the plan instead: their
// character is in the plan being drafted.
export function inCoordination(campaignId: string, characterId: string): CoordinationPhase | null {
  const phase = currentCoordination(campaignId);
  return phase && phase.entries.some((entry) => !entry.companion && entry.characterId === characterId) ? phase : null;
}
