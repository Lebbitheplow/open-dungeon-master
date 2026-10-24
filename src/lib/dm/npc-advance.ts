import { allocateSeq, campaignSeats, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { getNpcByName, type Npc } from "@/lib/db/npcs";
import { companionAttraction, companionNpcFor } from "@/lib/db/companion-npcs";
import { getRelationshipById, listRelationships, patchRelationship, type Relationship } from "@/lib/db/relationships";
import { insertItemProposal, resolveItemProposal, type ItemProposal } from "@/lib/db/item-proposals";
import { insertCampaignMessage } from "@/lib/db/messages";
import { advanceArgs, getAiTurns, listPendingAdvances, settleAdvanceRelationship, type AdvanceArgs } from "@/lib/db/advances";
import {
  ADVANCE_TARGET,
  ADVANCE_TOOL,
  advanceResolutionNote,
  advanceSummary,
  canResolveAdvance,
  npcAdvanceProblem,
  romanceSafetyBlock,
  windowOpen,
  type AdvanceResolution,
  type AdvanceTarget,
  type Suitor,
} from "@/lib/dm/advance-logic";
import { OFFER_NOTE_PREFIX } from "@/lib/dm/proposal-logic";
import { addFlag, addMemory, romanceIndex, ROMANCE_THRESHOLD, type RomanceStage } from "@/lib/dm/relationship-logic";
import {
  openLedger,
  publishRelationshipsUpdated,
  recordMilestone,
  resolveActor,
  resolveSubject,
  type Subject,
} from "@/lib/dm/relationship-subject";
import { hasHumanDm } from "@/lib/dm/viewer";
import { actRunning, outwardApproval } from "@/lib/dm/scheme-logic";
import { unknownSheetRef } from "@/lib/dm/rolls";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";

// An NPC's first move toward a character whose player opened them to it
// (issue 501): romance_advance with initiator "npc", one tool per intent
// (src/lib/dm/tool-merge-logic.ts). The move is checked by the same rules
// the server's roll picks the suitor by (src/lib/dm/advance-logic.ts) and
// becomes an offer only the character's own player can answer
// (item_proposals, tool_name "romance_advance"). The answer is theirs:
// accepting is courting with no consent roll, because the NPC asked.

// What the advance rules read about the table at this moment.
export type SuitorContext = {
  relationships: Relationship[];
  pending: ReturnType<typeof listPendingAdvances>;
  aiTurns: number;
};

export function suitorContext(campaignId: string): SuitorContext {
  return {
    relationships: listRelationships(campaignId),
    pending: listPendingAdvances(campaignId),
    aiTurns: getAiTurns(campaignId),
  };
}

// The suitor side of one relationship, as advance-logic reads it.
export function suitorFrom(
  context: SuitorContext,
  relationship: Relationship,
  who: Pick<Suitor, "kind" | "name" | "gender" | "attraction" | "warmth" | "present"> & { companionKind?: Suitor["companionKind"] },
): Suitor {
  const key = textKey(who.name);
  const others = context.relationships.filter((entry) => textKey(entry.subjectName) === key && entry.id !== relationship.id);
  return {
    ...who,
    status: relationship.status,
    // A schemer's first move is the same move an honest suitor makes: the
    // rules read the warmth the act shows (src/lib/dm/scheme-logic.ts).
    approval: outwardApproval(relationship),
    romance: relationship.romance,
    committedElsewhere: others.some((entry) => entry.status !== "ended" && romanceIndex(entry.romance) >= romanceIndex("together")),
    pendingAdvance:
      context.pending.some((offer) => textKey(offer.args.subject) === key) ||
      others.some((entry) => windowOpen(entry.advanceReadyUntil, context.aiTurns)),
  };
}

// The character side: open to it, and not already waiting on another
// suitor's moment (an open window or an unanswered advance).
export function targetFrom(context: SuitorContext, sheet: CharacterSheet, except?: Relationship): AdvanceTarget {
  return {
    name: sheet.name,
    gender: sheet.gender,
    attraction: sheet.attraction ?? null,
    open: Boolean(sheet.openToAdvances),
    isCompanion: sheet.isCompanion,
    awaiting:
      context.pending.some((offer) => offer.characterId === sheet.id) ||
      context.relationships.some(
        (entry) => entry.characterId === sheet.id && entry.id !== except?.id && windowOpen(entry.advanceReadyUntil, context.aiTurns),
      ),
  };
}

// Who a subject is for the advance rules: an NPC's row, or a lasting
// companion's sheet and the row behind it.
export function suitorIdentity(campaign: Campaign, subject: Subject, sheets: readonly CharacterSheet[]) {
  const companion = subject.kind === "companion" ? sheets.find((sheet) => sheet.id === subject.id) ?? null : null;
  if (companion) {
    const row = companionNpcFor(companion);
    return {
      kind: "companion" as const,
      name: companion.name,
      gender: companion.gender,
      attraction: companionAttraction(companion, row),
      warmth: row?.agency.personality?.warmth ?? 0,
      companionKind: companion.companionKind,
      portraitUrl: companion.portrait?.url ?? "",
      look: { gender: String(companion.gender ?? ""), race: companion.race, class: companion.class } as Record<string, string>,
    };
  }
  const npc: Npc | null = subject.npc ?? getNpcByName(campaign.id, subject.name);
  return {
    kind: subject.kind,
    name: subject.name,
    gender: npc?.gender ?? "",
    attraction: npc?.attraction ?? null,
    warmth: subject.personality?.warmth ?? 0,
    companionKind: null,
    portraitUrl: npc?.portraitUrl ?? "",
    look: { gender: String(npc?.gender ?? ""), role: npc?.role ?? "" } as Record<string, string>,
  };
}

type AdvanceCall = { characterId: string; subject: string; to?: RomanceStage; note?: string };

export function handleNpcAdvance(
  campaign: Campaign,
  turn: DmTurn,
  args: AdvanceCall,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  const sheet = resolveActor(args, sheets, sheetsById);
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const subject = resolveSubject(campaign, args.subject, sheets);
  if ("error" in subject) {
    return subject;
  }
  const relationship = openLedger(campaign, sheet, subject);
  if (relationship.lastShiftTurn === turn.id) {
    return {
      error: `${sheet.name} and ${subject.name} already took a step this exchange. Let the scene breathe before the next one.`,
      retry: true,
    };
  }
  const context = suitorContext(campaign.id);
  const who = suitorIdentity(campaign, subject, sheets);
  // Presence is the roll's to judge (src/lib/dm/advance-tick.ts): the window
  // it opened says this person was in the scene. A person running the table
  // says so themselves.
  const suitor = suitorFrom(context, relationship, { ...who, present: true });
  const problem = npcAdvanceProblem(suitor, targetFrom(context, sheet, relationship), {
    windowOpen: windowOpen(relationship.advanceReadyUntil, context.aiTurns),
    fromConsole: turn.actor === "human_dm" && hasHumanDm(campaignSeats(campaign)),
    safety: romanceSafetyBlock(campaign.gameSettings.safety),
    to: args.to,
  });
  if (problem) {
    return { error: problem, refused: "rules" };
  }

  const line = args.note?.trim().slice(0, 200) ?? "";
  const stored: AdvanceArgs & { portraitUrl: string; look: Record<string, string> } = {
    relationshipId: relationship.id,
    subject: subject.name,
    subjectKind: subject.kind,
    subjectId: subject.id,
    to: "courting",
    note: line,
    madeAtTurn: context.aiTurns,
    portraitUrl: who.portraitUrl,
    look: who.look,
  };
  const proposal = insertItemProposal({
    campaignId: campaign.id,
    turnId: turn.id,
    characterId: sheet.id,
    userId: sheet.userId,
    toolName: ADVANCE_TOOL,
    argsJson: JSON.stringify(stored),
    summary: advanceSummary(subject.name, sheet.name),
    reason: line,
    seq: allocateSeq(campaign.id),
  });
  // The moment is spent: the window closes whatever the answer.
  patchRelationship(relationship.id, { advanceReadyUntil: 0, lastShiftTurn: turn.id });
  publishPersisted(campaign.id, "item_proposal_added", { proposal: publicItemProposal(proposal) });
  return {
    ok: true,
    offered: proposal.summary,
    note: `${subject.name}'s move is made and ${sheet.name}'s player answers it on their screen. Narrate ${subject.name}'s approach in their own voice and stop there: never narrate or decide ${sheet.name}'s answer, and do not ask for it in words. It arrives as a table note.`,
  };
}

export { canResolveAdvance };

// What the answer does. A yes takes the step to courting with no consent
// roll, settles the meter at the rung's floor and records the milestone; a
// no or no answer is src/lib/db/advances.ts. Returns the sentence the table
// note and the offer row keep.
export function settleNpcAdvance(
  campaign: Campaign,
  proposal: ItemProposal,
  status: "approved" | "declined" | "cancelled" | "expired",
): string {
  const sheet = getSheetById(proposal.characterId);
  const args = advanceArgs(proposal);
  const characterName = sheet?.name ?? "the character";
  if (status !== "approved") {
    settleAdvanceRelationship(proposal, status, characterName);
    publishRelationshipsUpdated(campaign.id);
    return "";
  }
  const relationship = args ? getRelationshipById(args.relationshipId) : null;
  if (!sheet || !args || !relationship) {
    return "";
  }
  // The story may have moved on while the card waited (they are courting
  // already, or it ended): the yes changes nothing it cannot.
  if (relationship.status === "ended" || romanceIndex(relationship.romance) >= romanceIndex(ADVANCE_TARGET)) {
    patchRelationship(relationship.id, { advanceReadyUntil: 0 });
    return `${sheet.name} and ${args.subject} are already past this step.`;
  }
  const act = actRunning(relationship.pretense) ? relationship.pretense : null;
  patchRelationship(relationship.id, {
    romance: ADVANCE_TARGET,
    // A yes settles the meter at the rung's floor; to an act, the warmth it
    // shows, never what the schemer truly feels.
    ...(act
      ? { pretense: { ...act, shown: Math.max(act.shown, ROMANCE_THRESHOLD[ADVANCE_TARGET]) } }
      : { approval: Math.max(relationship.approval, ROMANCE_THRESHOLD[ADVANCE_TARGET]) }),
    flags: addFlag(relationship.flags, ADVANCE_TARGET),
    advanceReadyUntil: 0,
    memories: addMemory(relationship.memories, {
      kind: ADVANCE_TARGET,
      text: args.note ? `${args.subject} asked to court ${sheet.name} ("${args.note}"), and ${sheet.name} said yes` : `${args.subject} asked to court ${sheet.name}, and ${sheet.name} said yes`,
      at: new Date().toISOString(),
    }),
  });
  const npc = args.subjectKind === "npc" ? getNpcByName(campaign.id, args.subject) : null;
  recordMilestone(campaign, sheet, { name: args.subject, npc }, ADVANCE_TARGET);
  publishRelationshipsUpdated(campaign.id);
  return `${sheet.name} and ${args.subject} are now openly courting.`;
}

// The table note an advance's settling leaves (issue 239's settled-offer
// line), worded for a romantic answer: the DM reads it as the answer.
export function announceAdvanceSettled(
  campaignId: string,
  proposal: Pick<ItemProposal, "argsJson" | "characterId">,
  status: AdvanceResolution,
) {
  const characterName = getSheetById(proposal.characterId)?.name ?? "the character";
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    content: `${OFFER_NOTE_PREFIX}${advanceResolutionNote(status, advanceArgs(proposal)?.subject ?? "The suitor", characterName)}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

// Settles one advance as anything but a yes, end to end: the row, the
// relationship, the card and the table note.
export function closeAdvance(campaign: Campaign, proposalId: string, status: "cancelled" | "expired"): boolean {
  const resolved = resolveItemProposal(proposalId, status);
  if (!resolved) {
    return false;
  }
  settleNpcAdvance(campaign, resolved, status);
  publishPersisted(campaign.id, "item_proposal_resolved", { proposal: publicItemProposal(resolved) });
  announceAdvanceSettled(campaign.id, resolved, status);
  return true;
}

// Switching the opt-in off stops it at once: every open window toward the
// character closes and every advance waiting on them is withdrawn.
export function closeAdvancesToward(campaign: Campaign, sheet: CharacterSheet): number {
  for (const relationship of listRelationships(campaign.id)) {
    if (relationship.characterId === sheet.id && relationship.advanceReadyUntil > 0) {
      patchRelationship(relationship.id, { advanceReadyUntil: 0 });
    }
  }
  let withdrawn = 0;
  for (const offer of listPendingAdvances(campaign.id).filter((entry) => entry.characterId === sheet.id)) {
    if (closeAdvance(campaign, offer.id, "cancelled")) {
      withdrawn += 1;
    }
  }
  publishRelationshipsUpdated(campaign.id);
  return withdrawn;
}
