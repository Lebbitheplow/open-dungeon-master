import { resolveMonster, bestiaryFor } from "@/lib/bestiary";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { deleteCalendarEvent, insertCalendarEvent } from "@/lib/db/calendar-events";
import { companionValues } from "@/lib/db/companion-conscience";
import { companionDeparture, listDepartures, saveDeparture } from "@/lib/db/companion-departures";
import { deleteEncounterTemplate, insertEncounterTemplate, listEncounterTemplates } from "@/lib/db/encounter-templates";
import { getNpcById, type Npc } from "@/lib/db/npcs";
import { listRelationships } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { returningCombatant, returnWear } from "@/lib/dm/companion-return";
import { slotsSpentCount, wearWords, wornReason } from "@/lib/dm/return-wear-logic";
import {
  allyPreferences,
  planReturn,
  returnKind,
  rumourFor,
  type AllyChoice,
  type Departure,
  type Gone,
  type ReturnKind,
} from "@/lib/dm/departure-logic";
import { EMPTY_TEMPLATE_MAP } from "@/lib/dm/encounter-template-logic";
import type { FactCandidate } from "@/lib/dm/fact-logic";
import type { NpcSessionGoal } from "@/lib/dm/npc-logic";
import { partyLevelsFor } from "@/lib/dm/party-budget";
import { publishEphemeral } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";

// A departed companion's return (issue 503 Phase 3), the rim around
// src/lib/dm/departure-logic.ts. One who left hating the party, or set
// against it, goes to work on a session goal on the row behind it ("gather
// enough help to bring down the party"), advanced by the same agency dice
// every NPC's goals move on at a chapter close and a timeskip
// (src/lib/dm/npc-agency.ts). Each round writes a rumour as a DM-only fact.
// When the goal is done the return is cued: a prepared fight (its allies
// chosen by what it holds to and budgeted to hard or deadly, under the
// campaign's ceiling), a DM-only calendar event, and a director note each
// turn until it runs. Arc events have no public scheduling API, so the cue
// is those two. A companion whose standing has climbed back since comes to
// parley instead, and the cue follows its standing until it arrives.
//
// The return fight's companion is rated by companion-return.ts
// returningCombatant and fights as its own sheet on the foes' side, fielded
// by fieldReturning when the fight starts (src/lib/dm/sheet-foes.ts).

// How far from the moment the cue is set the calendar puts the return.
const RETURN_AFTER_MINUTES = 24 * 60;

// Their standing with the party they left: the worst of the bonds still
// held (parted bonds included; the party is apart from them now), or null.
export function standingWithParty(campaignId: string, name: string): number | null {
  const party = new Set(listSheets(campaignId).filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.id));
  const key = textKey(name);
  const approvals = listRelationships(campaignId)
    .filter((entry) => entry.status !== "ended" && party.has(entry.characterId) && textKey(entry.subjectName) === key)
    .map((entry) => entry.approval);
  return approvals.length ? Math.min(...approvals) : null;
}

function returnName(name: string): string {
  return `${name}'s return`;
}

// One round of the goal, from the agency pass: the rumour it leaves, and
// the return cued when the goal is done. Nothing for anyone else's goal.
export function avengingRound(
  campaignId: string,
  npc: Npc,
  round: { completed: boolean; goal: NpcSessionGoal },
): FactCandidate[] {
  const departure = companionDeparture(npc.id);
  const gone = departure.gone;
  if (!gone?.avenging || gone.cued) {
    return [];
  }
  saveDeparture(npc.id, { ...departure, gone: { ...gone, rumours: gone.rumours + 1 } });
  if (round.completed) {
    const campaign = getCampaignById(campaignId);
    if (campaign) {
      cueReturn(campaign, npc.id);
    }
  }
  return [
    {
      category: "npc",
      subject: `Rumour of ${npc.name}`,
      fact: rumourFor(npc.name, round.goal.progress, round.goal.target, round.completed),
    },
  ];
}

// The allies a return can field, in the order its values prefer them: each
// a stat block this table resolves (the content pack, or the setting's own
// bestiary), then the setting's humanoids as a fallback.
function allyCandidates(campaign: Campaign, values: Parameters<typeof allyPreferences>[0], reported: boolean): AllyChoice[] {
  const choices: AllyChoice[] = [];
  const seen = new Set<string>();
  for (const slug of allyPreferences(values, reported)) {
    const found = resolveMonster(slug, campaign.gameSettings);
    if (found && !seen.has(slug)) {
      seen.add(slug);
      choices.push({ slug, name: found.reskinName ?? found.baseName, cr: found.stats.cr });
    }
  }
  for (const entry of [...bestiaryFor(campaign.gameSettings)].filter((row) => row.type === "humanoid").sort((a, b) => b.cr - a.cr)) {
    if (!seen.has(entry.slug)) {
      seen.add(entry.slug);
      choices.push({ slug: entry.slug, name: entry.name, cr: entry.cr });
    }
  }
  return choices;
}

// The prepared fight for a return, or null when there can be none (the
// sheet no longer passes, or it is past the table's ceiling even worn to
// the floor). Past the ceiling whole, it comes alone and worn
// (return-wear-logic.ts), and the fight's note and the cue say why.
function prepareFight(campaign: Campaign, npcId: string, name: string, gone: Gone, standing: number | null) {
  const combatant = returningCombatant(campaign, npcId, name, null);
  const wearing = combatant ? returnWear(campaign, npcId, name) : null;
  if (!combatant || !wearing) {
    return null;
  }
  // Every sheet at the table, as start_encounter budgets a fight.
  const atTable = listSheets(campaign.id).filter((sheet) => !sheet.deathSaves?.dead).map((sheet) => sheet.level);
  const values = companionValues(npcId);
  const plan = planReturn({
    partyLevels: atTable.length ? atTable : partyLevelsFor(campaign),
    difficulty: campaign.difficulty,
    companionCr: combatant.cr,
    hostile: gone.hostile || (standing !== null && standing < -59),
    candidates: allyCandidates(campaign, values, Boolean(gone.reportedTo)),
    wearSteps: wearing.steps,
    rateWorn: wearing.rate,
  });
  if (plan.standoff || plan.adjustedXp > plan.ceiling) {
    return null;
  }
  const wear = plan.wear;
  const wornBy = wear ? `${wornReason(values, slotsSpentCount(wear) > 0)} (${wearWords(wearing.maxHp, wear)})` : "";
  const allies = plan.allies.map((ally) => `${ally.count > 1 ? `${ally.count} ` : ""}${ally.name}`).join(", ");
  const template = insertEncounterTemplate({
    campaignId: campaign.id,
    name: returnName(name),
    enemies: [{ monster: name, count: 1 }, ...plan.allies.map((ally) => ({ monster: ally.slug, count: ally.count }))],
    battlefield: "",
    map: EMPTY_TEMPLATE_MAP,
    notes: wear
      ? `${name} comes back for the party alone and worn, at level ${combatant.level}: ${wornBy}. Fighting as they did beside them. Budgeted ${plan.target} for this party (${plan.verdict.replace(/_/g, " ")}).`
      : `${name} comes back for the party${allies ? ` with ${allies}` : ""}, fighting as they did beside them, at level ${combatant.level}. Budgeted ${plan.target} for this party (${plan.verdict.replace(/_/g, " ")}).`,
    createdByUserId: campaign.ownerUserId,
  });
  return { template, plan, combatant, wear, wornBy };
}

// What the DM is told a cued return is, on the calendar and each turn.
function cueWords(name: string, gone: Pick<Gone, "cued" | "standoff" | "wornBy">): { title: string; body: string } {
  if (gone.cued === "fight") {
    return {
      title: gone.wornBy ? `${name} returns, alone and worn` : `${name} returns with help`,
      body: gone.wornBy
        ? `${name}, who left the party, comes for them alone and worn: ${gone.wornBy}. Narrate the wear as the reason they come at less than their best. When the party is next exposed (on the road, at camp, somewhere ${name} would know to wait), start the prepared fight "${returnName(name)}" with run_prepared_encounter. ${name} fights as their own sheet on the foes' side; you play them.`
        : `${name}, who left the party, has gathered help and comes for them: when the party is next exposed (on the road, at camp, somewhere ${name} would know to wait), start the prepared fight "${returnName(name)}" with run_prepared_encounter. ${name} fights as their own sheet on the foes' side; you play them.`,
    };
  }
  if (gone.standoff) {
    return {
      title: `${name} confronts the party`,
      body: `${name}, who left the party hating it, seeks them out, but even worn to half their strength a fight against ${name} would be past what this table's difficulty lets a fight be: they come to face the party in words (a demand, a threat, a reckoning). They do not rejoin unless the party makes amends.`,
    };
  }
  return {
    title: `${name} seeks the party out`,
    body: `${name}, who left the party, seeks them out to talk, not to fight: the party's standing with them has climbed back. Bring them to the party; if the party makes peace, add_companion ${name} again and they come back as they were.`,
  };
}

// Cues the return: a fight (prepared, with a DM-only calendar event) or a
// parley (the calendar event alone), by the standing they hold now. One who
// hates the party but is past the table's ceiling even worn to the floor
// comes in a standoff.
export function cueReturn(campaign: Campaign, npcId: string): ReturnKind | null {
  const npc = getNpcById(npcId);
  const departure = companionDeparture(npcId);
  const gone = departure.gone;
  if (!npc || !gone) {
    return null;
  }
  const standing = standingWithParty(campaign.id, npc.name);
  const wanted = returnKind(standing, gone.hostile);
  const fight = wanted === "fight" ? prepareFight(campaign, npcId, npc.name, gone, standing) : null;
  const kind: ReturnKind = fight ? "fight" : "parley";
  const standoff = wanted === "fight" && !fight;
  const wear = fight?.wear ?? null;
  const wornBy = fight?.wornBy ?? "";
  const clock = (getCampaignById(campaign.id) ?? campaign).clock;
  const words = cueWords(npc.name, { cued: kind, standoff, wornBy });
  const event = insertCalendarEvent({
    campaignId: campaign.id,
    atInstant: clock.instant + RETURN_AFTER_MINUTES,
    title: words.title,
    body: words.body,
    visibility: "dm",
  });
  saveDeparture(npcId, {
    ...departure,
    gone: { ...gone, cued: kind, standoff, wear, wornBy, templateId: fight?.template.id ?? "", eventId: event.id, returned: false },
  });
  publishEphemeral(campaign.id, "calendar_updated", { at: Date.now() });
  return kind;
}

function uncue(campaign: Campaign, npcId: string, departure: Departure) {
  const gone = departure.gone;
  if (!gone) {
    return;
  }
  if (gone.templateId) {
    deleteEncounterTemplate(gone.templateId);
  }
  if (gone.eventId) {
    deleteCalendarEvent(campaign.id, gone.eventId);
  }
  saveDeparture(npcId, { ...departure, gone: { ...gone, cued: null, standoff: false, wear: null, wornBy: "", templateId: "", eventId: "" } });
}

// Each turn (src/lib/dm/turn.ts) and after a console call: a cue whose
// standing has turned (climbed back to a parley, or sunk to a fight) is cued
// again; a return fight a rewind left behind with nobody waiting for it
// goes. A fight that has begun marked itself run as it fielded the companion
// (companion-return.ts fieldReturning).
export function settleReturns(campaign: Campaign) {
  const departures = listDepartures(campaign.id);
  const kept = new Set<string>();
  for (const entry of departures) {
    const gone = entry.departure.gone;
    if (!gone?.cued || gone.returned) {
      continue;
    }
    // A standoff is a fight the table could not stage: it is cued again only
    // when their standing climbs back to a parley.
    const cuedAs = gone.standoff ? "fight" : gone.cued;
    if (returnKind(standingWithParty(campaign.id, entry.name), gone.hostile) !== cuedAs) {
      uncue(campaign, entry.npcId, entry.departure);
      cueReturn(campaign, entry.npcId);
    }
    const now = companionDeparture(entry.npcId).gone;
    if (now?.templateId) {
      kept.add(now.templateId);
    }
  }
  const names = new Set(departures.map((entry) => returnName(entry.name)));
  for (const template of listEncounterTemplates(campaign.id)) {
    if (names.has(template.name) && !kept.has(template.id)) {
      deleteEncounterTemplate(template.id);
    }
  }
}

// ---- what the DM is told ----

// The moment part of GAME STATE: who has gone, how, and what they are doing
// about it. The DM's to know (rumours are DM-only facts too); never a plan
// a companion still in the party holds.
export function departedLinesForPrompt(campaign: Campaign): string[] {
  return listDepartures(campaign.id).flatMap((entry) => {
    const gone = entry.departure.gone;
    if (!gone || gone.returned) {
      return [];
    }
    const goal = getNpcById(entry.npcId)?.agency.goals.session;
    const parts = [`- ${entry.name} (gone: ${gone.how.charAt(0).toLowerCase()}${gone.how.slice(1)})`];
    if (gone.cued) {
      parts.push(`ready to return (${gone.cued === "fight" ? (gone.wornBy ? "alone and worn, to fight" : "with help, to fight") : gone.standoff ? "to face the party in words" : "to talk"}); see the director's notes`);
    } else if (gone.avenging) {
      parts.push(`gathering help against the party${goal ? ` (${goal.progress} of ${goal.target})` : ""}; let a rumour reach the party now and then`);
    }
    return [parts.join("; ")];
  });
}

// The director's notes for a cued return, every turn until it comes about.
export function returnDirectorNotes(campaign: Campaign): string[] {
  return listDepartures(campaign.id).flatMap((entry) => {
    const gone = entry.departure.gone;
    if (!gone?.cued || gone.returned) {
      return [];
    }
    return [cueWords(entry.name, gone).body];
  });
}
