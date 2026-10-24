import type { Campaign } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { getCurrentLocation } from "@/lib/db/locations";
import { patchRelationship } from "@/lib/db/relationships";
import { getAiTurns, listPendingAdvances } from "@/lib/db/advances";
import {
  ADVANCE_ANSWER_TURNS,
  ADVANCE_EVERY,
  ADVANCE_WINDOW,
  advanceCue,
  advanceRollSucceeds,
  pickSuitor,
  presentInScene,
  rollDue,
  romanceSafetyBlock,
  windowOpen,
  windowTurnsLeft,
  type Suitor,
} from "@/lib/dm/advance-logic";
import { closeAdvance, suitorContext, suitorFrom, suitorIdentity, targetFrom } from "@/lib/dm/npc-advance";
import { resolveSubject } from "@/lib/dm/relationship-subject";
import { romanceEnabled } from "@/lib/dm/relationship-tools";
import { rollExpression } from "@/lib/dice";
import { getNpcByName } from "@/lib/db/npcs";
import { attractionBlank } from "@/lib/attraction";
import { abilityMod } from "@/lib/srd";

// The roll for NPC advances (issue 501), after every AI turn that finished,
// beside the world tick rather than inside it: the world tick runs only
// while world simulation is on and rolls outside the dice the test harness
// forces. This one counts the table's AI turns (campaigns.ai_turns), so a
// table that turns simulation off still has NPCs who make the first move.
// No model call: dice and server state only.

export function tickAdvances(campaign: Campaign, aiTurns: number, narration: string): void {
  const allowed = advancesAllowed(campaign);
  for (const offer of listPendingAdvances(campaign.id)) {
    // Romance switched off, or a safety tool now rules it out: what was
    // waiting is withdrawn. An advance nobody answered for long enough is
    // "no answer".
    if (!allowed) {
      closeAdvance(campaign, offer.id, "cancelled");
    } else if (aiTurns - offer.args.madeAtTurn >= ADVANCE_ANSWER_TURNS) {
      closeAdvance(campaign, offer.id, "expired");
    }
  }
  if (aiTurns % ADVANCE_EVERY !== 0 || !allowed) {
    return;
  }
  const sheets = listSheets(campaign.id);
  const open = sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon && sheet.openToAdvances);
  if (!open.length) {
    return;
  }
  const partyLocation = getCurrentLocation(campaign.id)?.name ?? "";
  let context = suitorContext(campaign.id);
  for (const sheet of open) {
    const target = targetFrom(context, sheet);
    if (target.awaiting) {
      continue;
    }
    const candidates: Array<{ suitor: Suitor; relationshipId: string }> = [];
    for (const relationship of context.relationships) {
      if (relationship.characterId !== sheet.id || !rollDue(aiTurns, relationship.advanceCooldownUntil)) {
        continue;
      }
      const subject = resolveSubject(campaign, relationship.subjectName, sheets);
      if ("error" in subject) {
        continue;
      }
      const who = suitorIdentity(campaign, subject, sheets);
      // A party companion travels with them; an NPC is in the scene when
      // they are where the party is, or the narration just named them.
      const present = who.kind === "companion" || presentInScene({ name: subject.name, location: subject.npc?.location ?? "" }, partyLocation, narration);
      candidates.push({ suitor: suitorFrom(context, relationship, { ...who, present }), relationshipId: relationship.id });
    }
    const best = pickSuitor(
      candidates.map((candidate) => candidate.suitor),
      target,
    );
    if (!best) {
      continue;
    }
    // A d100 through the engine's dice (crypto.randomInt), so a test can
    // force it.
    const d100 = rollExpression("1d100").total;
    if (!advanceRollSucceeds(d100, abilityMod(sheet.abilities.cha))) {
      continue;
    }
    const chosen = candidates.find((candidate) => candidate.suitor === best);
    if (chosen) {
      patchRelationship(chosen.relationshipId, { advanceReadyUntil: aiTurns + ADVANCE_WINDOW });
      // One suitor, one moment: the next character cannot draw them too.
      context = suitorContext(campaign.id);
    }
  }
}

// Whether this table has advances at all: romance on, and nothing in the
// safety tools that says otherwise (a family table, a line or veil naming
// romance).
export function advancesAllowed(campaign: Campaign): boolean {
  return romanceEnabled(campaign) && !romanceSafetyBlock(campaign.gameSettings.safety);
}

// The DM-only director notes while a window is open, one per suitor ready.
export function advanceDirectorNotes(campaign: Campaign): string[] {
  if (!advancesAllowed(campaign)) {
    return [];
  }
  const context = suitorContext(campaign.id);
  const sheets = listSheets(campaign.id);
  return context.relationships.flatMap((relationship) => {
    if (!windowOpen(relationship.advanceReadyUntil, context.aiTurns)) {
      return [];
    }
    const sheet = sheets.find((entry) => entry.id === relationship.characterId);
    if (!sheet?.openToAdvances) {
      return [];
    }
    const row = getNpcByName(campaign.id, relationship.subjectName);
    const companion = sheets.find((entry) => entry.isCompanion && entry.id === row?.companionSheetId);
    const undecided = attractionBlank(row?.attraction) && attractionBlank(companion?.attraction);
    return [advanceCue(relationship.subjectName, sheet.name, windowTurnsLeft(relationship.advanceReadyUntil, context.aiTurns), undecided)];
  });
}

// For the compact tool profile: a window is open, so the relationships
// group is offered for those turns.
export function advanceWindowOpen(campaign: Campaign): boolean {
  if (!advancesAllowed(campaign)) {
    return false;
  }
  const aiTurns = getAiTurns(campaign.id);
  return suitorContext(campaign.id).relationships.some((relationship) => windowOpen(relationship.advanceReadyUntil, aiTurns));
}
