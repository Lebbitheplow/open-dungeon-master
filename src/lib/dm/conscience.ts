import { allocateSeq, getCampaignById, listMembers, type Campaign } from "@/lib/db/campaigns";
import { deleteCalendarEvent, insertCalendarEvent } from "@/lib/db/calendar-events";
import { companionConscience, companionValues, saveConscience } from "@/lib/db/companion-conscience";
import { companionNpcFor, lastingCompanion } from "@/lib/db/companion-npcs";
import { companionDeparture } from "@/lib/db/companion-departures";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listRelationships } from "@/lib/db/relationships";
import { listSheets, setCompanionCommander } from "@/lib/db/sheets";
import { formatDate } from "@/lib/dm/calendar";
import { commanderOf } from "@/lib/dm/companion-command";
import { handTurnToDm } from "@/lib/dm/initiative-floor";
import { valueLabel } from "@/lib/dm/companion-values-logic";
import {
  commandEnds,
  deadlineHours,
  defaultCondition,
  durationLabel,
  effectiveRung,
  minutesLeft,
  rungGuidance,
  rungName,
  settleConscience,
  withUltimatum,
  type Conscience,
  type ConscienceRung,
  type ConscienceSetting,
} from "@/lib/dm/conscience-logic";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { friendshipTier, type SouredLeaving } from "@/lib/dm/relationship-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A lasting companion's conscience (issue 503 Phase 1), the rim around
// src/lib/dm/conscience-logic.ts: which table runs it, where each companion
// stands, what moving a rung does at the table (an ultimatum written and
// mirrored as a DM-only calendar event, a player's command over the
// companion ended where the table lets companions turn), what the DM is told
// each turn, and what the Bonds tab shows. Deeds reach it through
// relationship_beat (src/lib/dm/beat-landing.ts); every other change of
// standing through publishRelationshipsUpdated, which settles it.
//
// Must not import relationship-subject.ts or relationship-tools.ts (they
// import this), nor the clock module (it ticks this), nor the turn machinery
// (encounter-tools.ts, loop.ts); a turn changes hands through
// initiative-floor.ts.

export function conscienceSetting(campaign: Pick<Campaign, "gameSettings">): ConscienceSetting {
  if (campaign.gameSettings.relationships === "off") {
    return "off";
  }
  return campaign.gameSettings.companionConscience ?? "leave";
}

export function conscienceOn(campaign: Pick<Campaign, "gameSettings">): boolean {
  return conscienceSetting(campaign) !== "off";
}

// Who removes a companion who cannot stand the party, for the DM's soured
// line (relationship-logic.ts souredNote): the DM with no conscience at the
// table, nobody at Talk, the server at Leave and Turn (departure.ts).
export function souredLeaving(campaign: Pick<Campaign, "gameSettings">): SouredLeaving {
  const setting = conscienceSetting(campaign);
  return setting === "off" ? "dm" : setting === "talk" ? "stays" : "server";
}

// The companions a conscience applies to: lasting ones in the party. One set
// against it (turned on it, or fielded for its return: src/lib/dm/
// turncoat.ts) is past its conscience.
export function consciousCompanions(sheets: readonly CharacterSheet[]): CharacterSheet[] {
  return sheets.filter((sheet) => {
    const npc = lastingCompanion(sheet) ? companionNpcFor(sheet) : null;
    const departure = npc ? companionDeparture(npc.id) : null;
    return Boolean(npc) && !departure?.turned && !departure?.gone;
  });
}

// The worst any player character's standing is with them, among the
// characters at the table: the one they cannot stand is who drives them.
// Null when nobody has dealt with them yet.
export function worstApproval(campaignId: string, companionName: string, sheets: readonly CharacterSheet[]): number | null {
  const party = new Set(sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.id));
  const key = textKey(companionName);
  const approvals = listRelationships(campaignId)
    .filter((relationship) => relationship.status === "active" && party.has(relationship.characterId) && textKey(relationship.subjectName) === key)
    .map((relationship) => relationship.approval);
  return approvals.length ? Math.min(...approvals) : null;
}

// The characters at the table this companion is devoted to.
function devotedFriends(campaignId: string, companionName: string, sheets: readonly CharacterSheet[]): string[] {
  const names = new Map(sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => [sheet.id, sheet.name]));
  const key = textKey(companionName);
  return listRelationships(campaignId)
    .filter((entry) => entry.status === "active" && names.has(entry.characterId) && textKey(entry.subjectName) === key && friendshipTier(entry.approval) === "devoted")
    .map((entry) => names.get(entry.characterId)!);
}

export type ConscienceMove = {
  companion: string;
  from: ConscienceRung;
  to: ConscienceRung;
  // Set as they reached the ultimatum rung.
  ultimatum?: { condition: string; due: string; left: string };
  // The player whose command over them ended (a Turn table, from Warning).
  commandEnded?: string;
};

// Settles one companion's conscience against their standing and the clock,
// writes it, and does what the move does at the table. `demand` and `hours`
// are what the DM named for an ultimatum this move may set.
export function settleCompanion(
  campaign: Campaign,
  companion: CharacterSheet,
  next?: Conscience,
  ultimatum: { demand?: string; hours?: number } = {},
  sheets: readonly CharacterSheet[] = listSheets(campaign.id),
): ConscienceMove | null {
  const setting = conscienceSetting(campaign);
  const npc = setting === "off" ? null : companionNpcFor(companion);
  if (!npc) {
    return null;
  }
  // The clock as it stands now: a turn may have moved it since its campaign
  // was read.
  const clock = (getCampaignById(campaign.id) ?? campaign).clock;
  const now = clock.instant;
  const before = next ?? companionConscience(npc.id);
  const settled = settleConscience(before, worstApproval(campaign.id, companion.name, sheets), now);
  let conscience = settled.conscience;
  for (const ended of [settled.ultimatumMet, settled.ultimatumLapsed]) {
    // A demand met, or made moot by the breaking point coming another way,
    // never fires; one whose deadline passed already did as the clock
    // crossed it.
    if (ended?.eventId && now < ended.due) {
      deleteCalendarEvent(campaign.id, ended.eventId);
    }
  }
  let set: ConscienceMove["ultimatum"];
  if (settled.needsUltimatum) {
    conscience = withUltimatum(conscience, ultimatum.demand?.trim() || defaultCondition(conscience.cause), now, deadlineHours(ultimatum.hours));
    const terms = conscience.ultimatum!;
    const event = insertCalendarEvent({
      campaignId: campaign.id,
      atInstant: terms.due,
      title: `${companion.name}'s ultimatum`,
      body: `${companion.name} demanded: ${terms.condition}. The deadline is now; if it is unmet, they are at their breaking point.`,
      visibility: "dm",
    });
    conscience = { ...conscience, ultimatum: { ...terms, eventId: event.id } };
    set = {
      condition: terms.condition,
      due: formatDate(clock.calendar, terms.due),
      left: durationLabel(minutesLeft(terms, now)),
    };
  }
  saveConscience(npc.id, conscience);
  const commandEnded = commandEnds(setting, conscience.shown) ? endCommand(campaign, companion) : null;
  if (settled.from === settled.to && !set && !commandEnded) {
    return null;
  }
  return {
    companion: companion.name,
    from: settled.from,
    to: settled.to,
    ...(set ? { ultimatum: set } : {}),
    ...(commandEnded ? { commandEnded } : {}),
  };
}

// Where the table lets companions turn, a companion who has warned the party
// stops taking a player's orders in a fight (the answered open question),
// and the table is told. Returns the player's name.
function endCommand(campaign: Campaign, companion: CharacterSheet): string | null {
  const commander = commanderOf(campaign, companion);
  if (!commander) {
    return null;
  }
  const updated = setCompanionCommander(companion.id, null);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const name = listMembers(campaign.id).find((member) => member.userId === commander)?.username ?? "their player";
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "system-party",
    content: `${companion.name} no longer takes ${name}'s orders in a fight: what the party has done stands between them. The DM plays their turns now.`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  // On their own turn, that turn is the DM's now, as the companion's card
  // hands it back (src/lib/dm/initiative-floor.ts).
  handTurnToDm(campaign, companion.id);
  return name;
}

// Whether a player may be given command over this companion now (the
// companion's card, PATCH /companions/[characterId]).
export function conscienceForbidsCommand(campaign: Campaign, companion: CharacterSheet): boolean {
  const setting = conscienceSetting(campaign);
  const npc = setting === "turn" ? companionNpcFor(companion) : null;
  return Boolean(npc) && commandEnds(setting, effectiveRung(companionConscience(npc!.id), worstApproval(campaign.id, companion.name, listSheets(campaign.id))));
}

// Every companion settled at once: after any change of standing (the
// publish every relationship write ends with), so a meter that fell to
// disliked through a social check warns as surely as a deed does.
export function settleConsciences(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || !conscienceOn(campaign)) {
    return;
  }
  const sheets = listSheets(campaignId);
  for (const companion of consciousCompanions(sheets)) {
    settleCompanion(campaign, companion, undefined, {}, sheets);
  }
}

// The clock moved (src/lib/db/clock.ts advanceClock): an ultimatum whose
// deadline it passed is the breaking point. Never throws: the clock moving
// must not wedge on a companion.
export function conscienceClockTick(campaignId: string): boolean {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign || !conscienceOn(campaign)) {
      return false;
    }
    const sheets = listSheets(campaignId);
    let moved = false;
    for (const companion of consciousCompanions(sheets)) {
      const npc = companionNpcFor(companion);
      if (npc && companionConscience(npc.id).ultimatum) {
        settleCompanion(campaign, companion, undefined, {}, sheets);
        moved = true;
      }
    }
    return moved;
  } catch (error) {
    console.error("[conscience] clock tick failed", error);
    return false;
  }
}

// ---- what the DM is told ----

// The companions' block in the moment part of GAME STATE (not the cached
// prefix: a rung moves turn to turn): what each holds to, where they stand
// and why, and any ultimatum with the time left on the clock.
export function conscienceBlockForPrompt(campaign: Campaign, sheets: readonly CharacterSheet[]): string {
  const setting = conscienceSetting(campaign);
  if (setting === "off") {
    return "";
  }
  const now = campaign.clock.instant;
  const lines = consciousCompanions(sheets).flatMap((companion) => {
    const npc = companionNpcFor(companion);
    if (!npc) {
      return [];
    }
    const conscience = companionConscience(npc.id);
    const values = companionValues(npc.id);
    const rung = rungName(effectiveRung(conscience, worstApproval(campaign.id, companion.name, sheets)));
    const parts = [
      `- ${companion.name}: holds ${values.length ? values.map(valueLabel).join(", ") : "nothing in particular"}`,
      rungGuidance(rung, setting),
    ];
    if (rung !== "content" && conscience.cause) {
      parts.push(`after ${conscience.cause}`);
    }
    if (conscience.ultimatum) {
      parts.push(
        `their demand: "${conscience.ultimatum.condition}", by ${formatDate(campaign.clock.calendar, conscience.ultimatum.due)} (${durationLabel(minutesLeft(conscience.ultimatum, now))} left)`,
      );
    }
    // Issue 503 Phase 4: a devoted companion's reaction (devoted-guard.ts).
    const devoted = devotedFriends(campaign.id, companion.name, sheets);
    if (devoted.length) {
      parts.push(`devoted to ${devoted.join(", ")}: may take a blow meant for them once a fight (use_reaction "Take the Blow", targetCharacterId)`);
    }
    return [parts.join("; ")];
  });
  return lines.length
    ? `Companion conscience (server-held: deeds and standing move each rung, never narration; play the rung each one is on):\n${lines.join("\n")}`
    : "";
}

// ---- what the Bonds tab shows ----

export type ConscienceView = {
  rung: ConscienceRung;
  ultimatum: { condition: string; due: string; left: string } | null;
};

// Each lasting companion's rung and ultimatum, by name key, for the Bonds
// rows. Visible to every seat: the companion says them aloud.
export function conscienceViews(campaign: Campaign): Map<string, ConscienceView> {
  const views = new Map<string, ConscienceView>();
  if (!conscienceOn(campaign)) {
    return views;
  }
  const sheets = listSheets(campaign.id);
  const now = campaign.clock.instant;
  for (const companion of consciousCompanions(sheets)) {
    const npc = companionNpcFor(companion);
    if (!npc) {
      continue;
    }
    const conscience = companionConscience(npc.id);
    views.set(textKey(companion.name), {
      rung: rungName(effectiveRung(conscience, worstApproval(campaign.id, companion.name, sheets))),
      ultimatum: conscience.ultimatum
        ? {
            condition: conscience.ultimatum.condition,
            due: formatDate(campaign.clock.calendar, conscience.ultimatum.due),
            left: durationLabel(minutesLeft(conscience.ultimatum, now)),
          }
        : null,
    });
  }
  return views;
}
