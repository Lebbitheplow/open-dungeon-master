import { getCampaignById, setStoryArc, type Campaign } from "@/lib/db/campaigns";
import { companionAgenda, saveAgenda } from "@/lib/db/companion-agenda";
import { companionConscience, saveConscience } from "@/lib/db/companion-conscience";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { findFactionByName } from "@/lib/db/factions";
import type { Npc } from "@/lib/db/npcs";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import {
  agendaGoal,
  agendaLine,
  agendaWords,
  arcBetrayalFor,
  newAgenda,
  orderCause,
  type Agenda,
} from "@/lib/dm/agenda-logic";
import { conscienceSetting, consciousCompanions } from "@/lib/dm/conscience";
import { BREAKING } from "@/lib/dm/conscience-logic";
import { settleBreakingPoint } from "@/lib/dm/departure";
import { advanceSessionGoal } from "@/lib/dm/npc-logic";
import { publishEphemeral } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A lasting companion's hidden agenda (issue 503 Phase 8), the rim around
// src/lib/dm/agenda-logic.ts. Set by the DM's add_companion (`agenda`), or
// brought by a cast member of the story arc whose pending betrayal names
// them; advanced on the agency dice (src/lib/dm/npc-agency.ts); and when
// the employer's order comes, it breaks the party's trust: the companion is
// at its breaking point and the conscience decides what it does
// (departure.ts settleBreakingPoint: walk out, report to the employer when
// the table tracks it, slip away, or turn), and the arc's betrayal is
// marked delivered. A storyteller secret throughout: the AI's own section of
// its prompt, a person running the table on the Bonds tab, and no one else.

// The agenda a party companion joins with: the DM's, else the arc's.
export function seedAgenda(campaign: Campaign, sheet: CharacterSheet, given?: { employer?: string; aim?: string }) {
  const npc = companionNpcFor(sheet);
  if (!npc) {
    return;
  }
  const fromArc = arcBetrayalFor(campaign.storyArc ?? null, sheet.name, textKey);
  const agenda = given ? newAgenda({ ...given, eventId: fromArc?.eventId }, npc.agency.personality) : null;
  if (agenda) {
    saveAgenda(npc.id, agenda);
    return;
  }
  if (!companionAgenda(npc.id) && fromArc) {
    saveAgenda(npc.id, newAgenda(fromArc, npc.agency.personality));
  }
}

function inParty(npc: Npc): CharacterSheet | null {
  const sheet = npc.companionSheetId ? getSheetById(npc.companionSheetId) : null;
  return sheet && consciousCompanions([sheet]).length ? sheet : null;
}

// One pass of the agency dice (a chapter close, a timeskip's rounds): the
// employer's order comes nearer, and comes when the goal is done.
export function agendaRounds(campaignId: string, npc: Npc, rounds: number) {
  let agenda = companionAgenda(npc.id);
  if (!agenda || agenda.ordered || !inParty(npc)) {
    return;
  }
  for (let round = 0; round < rounds; round += 1) {
    const result = advanceSessionGoal(agendaGoal(agenda), npc.agency.personality, rollExpression("1d20").total);
    agenda = { ...agenda, progress: result.goal.progress };
    if (result.completed) {
      saveAgenda(npc.id, agenda);
      const campaign = getCampaignById(campaignId);
      if (campaign) {
        deliverOrder(campaign, npc.id);
      }
      return;
    }
  }
  saveAgenda(npc.id, agenda);
}

// The employer's order comes: the arc's betrayal is delivered, and where the
// table runs a conscience the companion is at its breaking point by it.
export function deliverOrder(campaign: Campaign, npcId: string) {
  const agenda = companionAgenda(npcId);
  if (!agenda || agenda.ordered) {
    return;
  }
  saveAgenda(npcId, { ...agenda, ordered: true });
  markBetrayalFired(campaign, agenda);
  const sheet = listSheets(campaign.id).find((entry) => companionNpcFor(entry)?.id === npcId);
  if (sheet && conscienceSetting(campaign) !== "off") {
    saveConscience(npcId, { ...companionConscience(npcId), held: BREAKING, cause: orderCause(agenda) });
    const employer = agenda.employer ? findFactionByName(campaign.id, agenda.employer) : null;
    settleBreakingPoint(campaign, getSheetById(sheet.id) ?? sheet, listSheets(campaign.id), employer);
  }
  publishEphemeral(campaign.id, "relationships_updated", {});
}

function markBetrayalFired(campaign: Campaign, agenda: Agenda) {
  const arc = (getCampaignById(campaign.id) ?? campaign).storyArc;
  if (!agenda.eventId || !arc?.events.some((event) => event.id === agenda.eventId && event.status === "pending")) {
    return;
  }
  setStoryArc(campaign.id, { ...arc, events: arc.events.map((event) => (event.id === agenda.eventId ? { ...event, status: "fired" } : event)) });
}

// ---- who reads it ----

// The storyteller's lines (the section tagged STORYTELLER_SECRET): each
// companion's agenda, to foreshadow and never say.
export function agendaLinesForPrompt(sheets: readonly CharacterSheet[]): string[] {
  return consciousCompanions(sheets).flatMap((companion) => {
    const npc = companionNpcFor(companion);
    const agenda = npc ? companionAgenda(npc.id) : null;
    return agenda ? [agendaLine(companion.name, agenda)] : [];
  });
}

// For a person running the table (the Bonds tab), by companion name key.
// The caller has checked the viewer may read it.
export function heldAgendas(campaign: Campaign): Map<string, string> {
  const held = new Map<string, string>();
  for (const companion of consciousCompanions(listSheets(campaign.id))) {
    const npc = companionNpcFor(companion);
    const agenda = npc ? companionAgenda(npc.id) : null;
    if (agenda) {
      held.set(textKey(companion.name), agendaWords(agenda));
    }
  }
  return held;
}
