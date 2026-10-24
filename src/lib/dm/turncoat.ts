import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { companionDeparture, saveDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor, lastingCompanion } from "@/lib/db/companion-npcs";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { setNpcAttitude } from "@/lib/db/npcs";
import { getSheetById, listSheets, setCompanionCommander } from "@/lib/db/sheets";
import { moveToSide, sheetsAgainstParty } from "@/lib/dm/combat-sides";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { handTurnToDm } from "@/lib/dm/initiative-floor";
import { departureHow, turnHow, type DepartureResponse, type DepartureWhere } from "@/lib/dm/departure-logic";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A lasting companion that turns on the party where it stands (issue 503,
// Phase 6 meeting Phase 2), and what becomes of it once the fight is over.
// At a Turn table a companion that confronts the party, or bides and strikes
// at its opening, fights it now as its own sheet on the foes' side
// (src/lib/dm/combat-sides.ts moveToSide): in the fight running, or in one
// the server starts with that companion alone against the party. Its
// command is revoked and the DM plays it. Nothing is deleted: the same sheet,
// every feature, slot and wound.
//
// After the fight, by the rule Phase 6 chose (combat-sides-logic.ts
// sheetOutOfFight): one still standing leaves as a departed companion, its
// sheet kept on the row behind it, gathering help to come back; one that
// died fell; one at 0 hit points lies at the party's mercy, still set
// against it, and goes the moment it is back on its feet or at the next
// long rest. The same holds for a departed companion fielded for its return
// (src/lib/dm/companion-return.ts fieldReturning).
//
// The rim departure.ts calls; the leaving itself is departure.ts departNow.
// Must not import encounter-tools.ts (enemy-damage.ts reaches this through
// departure.ts, and encounter-tools sits above it): the fight a turn starts
// comes through the starter encounter-tools registers.

type FightStarter = (campaign: Campaign, name: string, summary: string) => ToolResult;
let fightStarter: FightStarter | null = null;

export function registerFightStarter(start: FightStarter) {
  fightStarter = start;
}

export type TurnOutcome = {
  companion: string;
  response: DepartureResponse;
  how: string;
  departed: false;
  turned: true;
  // The start_encounter line for a fight the server started for it.
  fight?: string;
  // At 0 hit points after the fight, at the party's mercy.
  mercy?: boolean;
};

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-battle", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// The companion turns now. Null when no fight could be staged for it (the
// caller lets it leave as a foe instead).
export function turnOnTheSpot(campaign: Campaign, companion: CharacterSheet, response: DepartureResponse, where: DepartureWhere): TurnOutcome | null {
  const npc = companionNpcFor(companion);
  if (!npc) {
    return null;
  }
  const how = turnHow(response, where);
  const before = companionDeparture(npc.id);
  const at = (getCampaignById(campaign.id) ?? campaign).clock.instant;
  saveDeparture(npc.id, { ...before, intent: null, turned: { response, at } });
  let fight = "";
  if (getActiveEncounter(campaign.id)) {
    const moved = moveToSide(campaign, companion.id, "foe");
    if ("error" in moved) {
      saveDeparture(npc.id, before);
      return null;
    }
  } else {
    // A fight of its own: the companion alone against the party, by its own
    // choice, so the table's ceiling does not refuse it.
    const started = fightStarter ? fightStarter(campaign, companion.name, `${companion.name} turns on the party`) : null;
    if (!started || "error" in started) {
      saveDeparture(npc.id, before);
      return null;
    }
    tableNote(campaign, `${companion.name} turns against the party.`);
    fight = typeof started.next === "string" ? started.next : "";
  }
  if (companion.commandedBy) {
    const updated = setCompanionCommander(companion.id, null);
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  setNpcAttitude(npc.id, "hostile", "");
  // On its own turn, that turn is the DM's now.
  handTurnToDm(campaign, companion.id);
  publishEphemeral(campaign.id, "relationships_updated", {});
  return { companion: companion.name, response, how, departed: false, turned: true, ...(fight ? { fight } : {}) };
}

// A lasting companion set against the party and not in a fight now: what it
// does. `leave` is departure.ts's leaving, handed in so this module does not
// import the conscience's rim. Null while it lies at the party's mercy and
// nothing has changed.
export type Leave = (sheet: CharacterSheet, response: DepartureResponse, how: string, avenging: boolean) => unknown;

export function settleTurncoat(
  campaign: Campaign,
  sheet: CharacterSheet,
  when: "fight_end" | "turn" | "long_rest",
  leave: Leave,
): { left: boolean; mercy: TurnOutcome | null } {
  const npc = companionNpcFor(sheet);
  if (!npc) {
    return { left: false, mercy: null };
  }
  const departure = companionDeparture(npc.id);
  const response: DepartureResponse = departure.turned?.response ?? departure.gone?.response ?? "confront";
  const where: DepartureWhere = when === "long_rest" ? "night" : "fight";
  if (sheet.deathSaves?.dead) {
    leave(sheet, response, "Fell fighting the party", false);
    return { left: true, mercy: null };
  }
  if (sheet.currentHp > 0) {
    leave(sheet, response, departure.gone ? "Fought the party and got away" : departureHow(response, where), true);
    return { left: true, mercy: null };
  }
  if (when === "long_rest") {
    leave(sheet, response, "Crawled away in the night, beaten", true);
    return { left: true, mercy: null };
  }
  // Down at the party's mercy: still set against it, tracked as turned.
  if (!departure.turned) {
    saveDeparture(npc.id, { ...departure, turned: { response, at: (getCampaignById(campaign.id) ?? campaign).clock.instant } });
  }
  return when === "fight_end"
    ? { left: false, mercy: { companion: sheet.name, response, how: "Lies beaten at the party's mercy", departed: false, turned: true, mercy: true } }
    : { left: false, mercy: null };
}

// The fight just ended (enemy-damage.ts finishEncounter): every lasting
// companion that ended it on the foes' side, settled.
export function turncoatsAfterFight(campaign: Campaign, encounter: Pick<Encounter, "id" | "sides" | "order">, leave: Leave): TurnOutcome[] {
  const mercy: TurnOutcome[] = [];
  for (const id of sheetsAgainstParty(encounter)) {
    const sheet = getSheetById(id);
    if (sheet && lastingCompanion(sheet)) {
      const settled = settleTurncoat(campaign, sheet, "fight_end", leave);
      if (settled.mercy) {
        mercy.push(settled.mercy);
      }
    }
  }
  return mercy;
}

// The lasting companions at the table set against the party (turned, or
// fielded for a return), outside a fight.
export function turncoatsAtTable(campaignId: string): CharacterSheet[] {
  if (getActiveEncounter(campaignId)) {
    return [];
  }
  return listSheets(campaignId).filter((sheet) => {
    const npc = lastingCompanion(sheet) ? companionNpcFor(sheet) : null;
    const departure = npc ? companionDeparture(npc.id) : null;
    return Boolean(departure?.turned || departure?.gone);
  });
}

// For the moment part of GAME STATE: who lies at the party's mercy.
export function turncoatLinesForPrompt(campaignId: string): string[] {
  return turncoatsAtTable(campaignId).filter((sheet) => sheet.currentHp <= 0 && !sheet.deathSaves?.dead).map(
    (sheet) =>
      `- ${sheet.name} turned on the party and lies beaten at 0 hit points at its mercy (still set against it): finish them, bind them or leave them; they go once back on their feet or at the next long rest.`,
  );
}
