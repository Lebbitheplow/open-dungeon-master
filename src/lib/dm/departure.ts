import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { companionConscience, companionValues } from "@/lib/db/companion-conscience";
import { companionDeparture, saveDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { pactOfNpc } from "@/lib/db/pacts";
import { getActiveEncounter } from "@/lib/db/encounters";
import { findFactionByName, listFactions } from "@/lib/db/factions";
import type { Faction } from "@/lib/dm/faction-logic";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getNpcById, patchNpcAgency, setNpcAttitude } from "@/lib/db/npcs";
import { listSheets } from "@/lib/db/sheets";
import { departCompanion } from "@/lib/dm/companion-tools";
import type { CompanionValue } from "@/lib/dm/companion-values-logic";
import { conscienceSetting, consciousCompanions, worstApproval } from "@/lib/dm/conscience";
import { BREAKING, effectiveRung } from "@/lib/dm/conscience-logic";
import { companionOdds, intentOpensNow } from "@/lib/dm/departure-opening";
import {
  avengeGoal,
  avengeTarget,
  chooseResponse,
  departureHow,
  INTENT_WORDS,
  PARLEY_FROM,
  turnsOnParty,
  waitsForOpening,
  type DepartureResponse,
  type DepartureWhere,
  type OpeningHook,
} from "@/lib/dm/departure-logic";
import { handleAdjustReputation } from "@/lib/dm/faction-tools";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A lasting companion leaving the party (issue 503 Phase 2), the rim around
// src/lib/dm/departure-logic.ts. At a table set to Leave or Turn, a
// companion at its breaking point does what the server decides from who it
// is and the odds (src/lib/dm/departure-opening.ts): walks out, reports the
// party, or turns on it at once; or holds a plan (slip away, bide and
// strike) until its opening, its own turn in a fight or the night watch of a
// long rest. Talk and Off tables never depart anyone. The AI narrates what
// happened; it never decides it, and never calls dismiss_companion for it.
//
// Departures go through the dismissal's own removal (companion-tools.ts
// departCompanion), so the sheet is kept on the row behind the companion
// for its return (src/lib/dm/companion-revenge.ts), and the bonds with it
// are parted, not ended.
//
// A held plan is a storyteller secret (src/lib/dm/viewer.ts): it reaches
// the AI only in the storyteller's section of its prompt, and a person
// running the table on the Bonds tab; no tool result names it, since a
// console call's result is read by whoever made it.

export type DepartureOutcome = {
  companion: string;
  response: DepartureResponse;
  // What the table saw; "" while it is still only a plan.
  how: string;
  departed: boolean;
  reportedTo?: string;
  standing?: string;
  avenging?: boolean;
};

function clockNow(campaign: Campaign): number {
  return (getCampaignById(campaign.id) ?? campaign).clock.instant;
}

function leaves(campaign: Campaign): "leave" | "turn" | null {
  const setting = conscienceSetting(campaign);
  return setting === "leave" || setting === "turn" ? setting : null;
}

// Who a dutiful companion tells: the faction it is loyal to, when the table
// tracks it; for one who respects the law, the strongest power the party
// answers to here.
function reportFaction(campaignId: string, values: readonly CompanionValue[]): Faction | null {
  for (const held of values) {
    if (held.value === "faction_loyalty" && held.faction) {
      const found = findFactionByName(campaignId, held.faction);
      if (found) {
        return found;
      }
    }
  }
  if (values.some((held) => held.value === "respects_law")) {
    return [...listFactions(campaignId)].sort((a, b) => b.power - a.power)[0] ?? null;
  }
  return null;
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function tableLine(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "system-party", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// A companion at its breaking point, by whatever road it got there (a deed,
// a standing that sank, an ultimatum the clock ran out): the response is
// decided once, then acted on at once or held as a plan. A companion who has
// climbed back off the breaking point drops any plan it held. Null when
// nothing happens.
export function settleBreakingPoint(
  campaign: Campaign,
  companion: CharacterSheet,
  sheets: readonly CharacterSheet[] = listSheets(campaign.id),
): DepartureOutcome | null {
  const setting = leaves(campaign);
  const npc = setting ? companionNpcFor(companion) : null;
  if (!setting || !npc) {
    return null;
  }
  const departure = companionDeparture(npc.id);
  const conscience = companionConscience(npc.id);
  if (effectiveRung(conscience, worstApproval(campaign.id, companion.name, sheets)) < BREAKING) {
    if (departure.intent) {
      saveDeparture(npc.id, { ...departure, intent: null });
    }
    return null;
  }
  if (departure.intent || departure.gone) {
    return null;
  }
  // A companion in a pact goes with it, at its moment (src/lib/dm/pact-fire.ts),
  // never alone.
  if (pactOfNpc(campaign.id, npc.id)) {
    return null;
  }
  const values = companionValues(npc.id);
  const faction = reportFaction(campaign.id, values);
  const response = chooseResponse({
    personality: npc.agency.personality,
    values,
    odds: companionOdds(campaign, companion, sheets).odds,
    setting,
    canReport: Boolean(faction),
  });
  if (waitsForOpening(response)) {
    saveDeparture(npc.id, { ...departure, intent: { response, at: clockNow(campaign), cause: conscience.cause } });
    return { companion: companion.name, response, how: "", departed: false };
  }
  return departNow(campaign, companion, response, "scene", response === "report" ? faction : null);
}

// Every companion at the table, settled: for the roads no tool reports (the
// clock passing an ultimatum's deadline, a standing that sank), at the start
// of a DM turn and after a console call.
export function settleDepartures(campaign: Campaign): DepartureOutcome[] {
  if (!leaves(campaign)) {
    return [];
  }
  const sheets = listSheets(campaign.id);
  return consciousCompanions(sheets)
    .map((companion) => settleBreakingPoint(campaign, companion, sheets))
    .filter((outcome): outcome is DepartureOutcome => Boolean(outcome?.departed));
}

// The companion goes, now: the table told how, a report made where it
// reports, the sheet kept on the row (src/lib/dm/companion-tools.ts
// departCompanion), and, when it left hating the party or set against it,
// the goal it goes to work on (src/lib/dm/companion-revenge.ts).
//
// Phase 6 plugs in here: a companion that turns (confront, or bide and
// strike at its opening) will fight the party on the spot, its own sheet on
// the enemy side (resolveCombatant()). Until then it leaves as a foe, and
// its return is the fight (companion-return.ts returningCombatant).
export function departNow(
  campaign: Campaign,
  companion: CharacterSheet,
  response: DepartureResponse,
  where: DepartureWhere,
  faction: Faction | null,
): DepartureOutcome {
  const npc = companionNpcFor(companion);
  const worst = worstApproval(campaign.id, companion.name, listSheets(campaign.id));
  const how = departureHow(response, where, faction?.name ?? "");
  const hostile = turnsOnParty(response);
  let standing = "";
  if (response === "report" && faction) {
    const reported = handleAdjustReputation(
      campaign,
      JSON.stringify({ faction: faction.id, delta: -2, reason: `${companion.name} reported what the party has done` }),
    );
    standing = "standing" in reported ? String(reported.standing) : "";
  }
  const avenging = hostile || worst === null || worst < PARLEY_FROM;
  if (npc) {
    saveDeparture(npc.id, {
      intent: null,
      gone: {
        response,
        how,
        at: clockNow(campaign),
        reportedTo: response === "report" ? (faction?.name ?? "") : "",
        hostile,
        leftLevel: companion.level,
        xpSince: 0,
        avenging,
        rumours: 0,
        cued: null,
        standoff: false,
        wear: null,
        wornBy: "",
        templateId: "",
        eventId: "",
        returned: false,
      },
    });
  }
  departCompanion(campaign, companion, how, how);
  if (npc && avenging) {
    const fresh = getNpcById(npc.id) ?? npc;
    patchNpcAgency(npc.id, {
      goals: { ...fresh.agency.goals, session: { text: avengeGoal(companion.name), progress: 0, target: avengeTarget(fresh.agency.personality) } },
    });
  }
  if (npc && hostile) {
    setNpcAttitude(npc.id, "hostile", "");
  }
  tableLine(campaign, `${companion.name} ${lowerFirst(how)}.`);
  publishEphemeral(campaign.id, "relationships_updated", {});
  publishEphemeral(campaign.id, "roster_updated", {});
  return {
    companion: companion.name,
    response,
    how,
    departed: true,
    ...(response === "report" && faction ? { reportedTo: faction.name, ...(standing ? { standing } : {}) } : {}),
    avenging,
  };
}

// A held plan's openings: the companion's own turn in a fight (`own_turn`,
// whoever commanded it; src/lib/dm/initiative-floor.ts hands that turn back
// to the DM), and the night watch of a long rest. Slipping away goes at
// either; biding to strike only when the party has fallen low enough that
// the odds have turned. Returns what departed.
export function departureOpenings(campaign: Campaign, hook: OpeningHook): DepartureOutcome[] {
  if (!leaves(campaign)) {
    return [];
  }
  const sheets = listSheets(campaign.id);
  let holders = consciousCompanions(sheets).filter((sheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead);
  if (hook === "own_turn") {
    const encounter = getActiveEncounter(campaign.id);
    const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
    holders = current?.kind === "pc" ? holders.filter((sheet) => sheet.id === current.characterId) : [];
  }
  const outcomes: DepartureOutcome[] = [];
  for (const companion of holders) {
    const response = intentOpensNow(campaign, companion, sheets);
    if (response) {
      outcomes.push(departNow(campaign, companion, response, hook === "own_turn" ? "fight" : "night", null));
    }
  }
  return outcomes;
}

// ---- what the DM is told ----

// For a tool result or the moment part of GAME STATE: what happened, never
// a plan (an outcome that did not depart says nothing).
export function departureNote(outcome: DepartureOutcome): string {
  if (!outcome.departed) {
    return "";
  }
  return [
    `${outcome.companion} ${lowerFirst(outcome.how)}: the server has taken them out of the party (their sheet is kept). Narrate it as it happened, in their own voice; never call dismiss_companion for it.`,
    outcome.reportedTo ? `The party's standing with ${outcome.reportedTo} fell${outcome.standing ? ` (now ${outcome.standing})` : ""}.` : "",
    outcome.avenging ? `They mean to come back with help; the server tracks it.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// The storyteller's own lines (src/lib/dm/scheme-tools.ts carries them into
// the section tagged STORYTELLER_SECRET): each companion's held plan, so the
// AI can foreshadow it and never say it.
export function intentLinesForPrompt(campaign: Campaign, sheets: readonly CharacterSheet[]): string[] {
  if (!leaves(campaign)) {
    return [];
  }
  return consciousCompanions(sheets).flatMap((companion) => {
    const npc = companionNpcFor(companion);
    const intent = npc ? companionDeparture(npc.id).intent : null;
    return intent
      ? [
          `- ${companion.name} ${INTENT_WORDS[intent.response]}. Foreshadow it (a pack kept ready, a long look down the road, too quiet on watch); never say it or let anyone learn it. The server picks the moment and tells you.`,
        ]
      : [];
  });
}

// For a person running the table (the Bonds tab), by companion name key
// (textKey): the plan each holds. The caller has checked the viewer may
// read it.
export function heldIntents(campaign: Campaign): Map<string, string> {
  const plans = new Map<string, string>();
  if (!leaves(campaign)) {
    return plans;
  }
  for (const companion of consciousCompanions(listSheets(campaign.id))) {
    const npc = companionNpcFor(companion);
    const intent = npc ? companionDeparture(npc.id).intent : null;
    if (intent) {
      plans.set(textKey(companion.name), INTENT_WORDS[intent.response]);
    }
  }
  return plans;
}
