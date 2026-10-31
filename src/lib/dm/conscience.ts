import { allocateSeq, getCampaignById, listMembers, type Campaign } from "@/lib/db/campaigns";
import { deleteCalendarEvent, insertCalendarEvent } from "@/lib/db/calendar-events";
import { companionConscience, companionValues, saveConscience } from "@/lib/db/companion-conscience";
import { companionNpcFor, lastingCompanion } from "@/lib/db/companion-npcs";
import { companionDeparture } from "@/lib/db/companion-departures";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listRelationships } from "@/lib/db/relationships";
import { getSheetForUser, listSheets, setCompanionCommander } from "@/lib/db/sheets";
import { livingHero } from "@/lib/characters/fallen-logic";
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
  RUNG_WORD,
  rungGuidance,
  rungName,
  settingOf,
  settleConscience,
  withUltimatum,
  type Conscience,
  type ConscienceRung,
  type ConscienceSetting,
} from "@/lib/dm/conscience-logic";
import { afterMove, concealsUnease, rungIndex, viewFor, type ConscienceViewer } from "@/lib/dm/conscience-voice-logic";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { friendshipTier, hasStanding, tierIndex, type FriendshipTier, type SouredLeaving } from "@/lib/dm/relationship-logic";
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
  return settingOf(campaign.gameSettings);
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
// Null when nobody has dealt with them yet. A hero who fell drives nobody
// (issue 657): their old feud no longer pushes a companion to leave.
export function worstApproval(campaignId: string, companionName: string, sheets: readonly CharacterSheet[]): number | null {
  const party = new Set(sheets.filter(livingHero).map((sheet) => sheet.id));
  const key = textKey(companionName);
  const approvals = listRelationships(campaignId)
    .filter((relationship) => relationship.status === "active" && party.has(relationship.characterId) && textKey(relationship.subjectName) === key && hasStanding(relationship))
    .map((relationship) => relationship.approval);
  return approvals.length ? Math.min(...approvals) : null;
}

// The characters at the table this companion stands with at `tier` or
// better: devoted, for its reactions; close, for whom it still cares for as
// it leaves (issue 563).
export function friendsAtLeast(campaignId: string, companionName: string, sheets: readonly CharacterSheet[], tier: FriendshipTier): string[] {
  const names = new Map(sheets.filter(livingHero).map((sheet) => [sheet.id, sheet.name]));
  const key = textKey(companionName);
  return listRelationships(campaignId)
    .filter((entry) => entry.status === "active" && names.has(entry.characterId) && textKey(entry.subjectName) === key && tierIndex(friendshipTier(entry.approval)) >= tierIndex(tier))
    .map((entry) => names.get(entry.characterId)!);
}

// Where a lasting companion stands now, at a table that runs a conscience:
// null for anyone else (another kind of companion, one set against the
// party, or no conscience at the table).
export function companionRung(campaign: Campaign, companion: CharacterSheet, sheets: readonly CharacterSheet[] = listSheets(campaign.id)): number | null {
  const npc = conscienceOn(campaign) && consciousCompanions([companion]).length ? companionNpcFor(companion) : null;
  return npc ? effectiveRung(companionConscience(npc.id), worstApproval(campaign.id, companion.name, sheets)) : null;
}

export type ConscienceMove = {
  companion: string;
  from: ConscienceRung;
  to: ConscienceRung;
  // Set as they reached the ultimatum rung.
  ultimatum?: { condition: string; due: string; left: string };
  // The player whose command over them ended (a Turn table, from Warning).
  commandEnded?: string;
  // The table is owed this move in the story (issue 615): said in the next
  // narration, or the server posts the companion's line after it.
  owed?: boolean;
  // Unease a composed companion keeps in: no note or result names it, since
  // a console call's result is read by whoever made it; the storyteller's
  // section carries it (conscienceSecretLines).
  concealed?: boolean;
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
    conscience = withUltimatum(conscience, ultimatum.demand?.trim() || defaultCondition(conscience.cause, conscience.causeSecret), now, deadlineHours(ultimatum.hours));
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
  // What the table is owed of this move in the story, and unease a composed
  // companion keeps in (issue 615). Every road that moves a rung comes
  // through here (a deed, a standing that sank, the clock, a pact's talk, a
  // hidden employer's order), so each one is said at the table or kept, by
  // the same rule.
  const lapsed = settled.ultimatumLapsed && settled.to === "breaking" && now >= settled.ultimatumLapsed.due ? settled.ultimatumLapsed.condition : undefined;
  conscience = afterMove(conscience, rungIndex(settled.from), rungIndex(settled.to), setting, {
    keepsItIn: concealsUnease(npc.agency.personality),
    ultimatumSet: Boolean(set),
    lapsed,
  });
  saveConscience(npc.id, conscience);
  // A companion who has warned the party stops taking orders; one moved by
  // a road the table never saw, with nothing to say aloud (a hidden
  // employer's order at a table where companions leave), has warned nobody,
  // and its line would give the secret away (issue 615).
  const unseen = conscience.causeSecret && !conscience.owed;
  const commandEnded = commandEnds(setting, conscience.shown) && !unseen ? endCommand(campaign, companion) : null;
  if (settled.from === settled.to && !set && !commandEnded) {
    return null;
  }
  const owed = Boolean(conscience.owed) && (Boolean(set) || conscience.owed?.rung !== before.owed?.rung);
  const concealed = settled.to === "uneasy" && settled.from !== settled.to && Boolean(conscience.concealed);
  return {
    companion: companion.name,
    from: settled.from,
    to: settled.to,
    ...(set ? { ultimatum: set } : {}),
    ...(commandEnded ? { commandEnded } : {}),
    ...(owed ? { owed } : {}),
    ...(concealed ? { concealed } : {}),
  };
}

// Where the table lets companions turn, a companion who has warned the party
// stops taking a player's orders in a fight (the answered open question),
// and the table is told. Returns the name of the character whose orders end.
function endCommand(campaign: Campaign, companion: CharacterSheet): string | null {
  const commander = commanderOf(campaign, companion);
  if (!commander) {
    return null;
  }
  const updated = setCompanionCommander(companion.id, null);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const name = commanderName(campaign.id, commander);
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "system-party",
    content: `${companion.name} no longer takes ${name}'s orders in a fight: what the party has done stands between them. The GM plays their turns now.`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  // On their own turn, that turn is the DM's now, as the companion's card
  // hands it back (src/lib/dm/initiative-floor.ts).
  handTurnToDm(campaign, companion.id);
  return name;
}

// Who the companion stops following, as the story knows them: the
// commander's character, not the account (the 0.31.1 playtest read
// "no longer takes playtester's orders"). The seat's own character first,
// then any other of theirs that is not a companion; the account name only
// when they have none.
function commanderName(campaignId: string, userId: string): string {
  const seated = getSheetForUser(campaignId, userId);
  const own = seated && !seated.isCompanion
    ? seated
    : listSheets(campaignId).find((sheet) => sheet.userId === userId && !sheet.isCompanion);
  return own?.name ?? listMembers(campaignId).find((member) => member.userId === userId)?.username ?? "their player";
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
// and why, any ultimatum with the time left on the clock, and a rung the
// table has not heard yet. The lead of an AI table reads this block on the
// Context tab, so it carries nothing the table could not know (issue 615):
// unease a composed companion keeps in, and the breaking point under a plan
// held in secret (slip away, bide and strike), read as the rung the table
// has heard and are said in the storyteller's section (conscienceSecretLines);
// a cause that came by a secret road (a hidden employer's order, a pact's
// talk) is left out.
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
    const truth = effectiveRung(conscience, worstApproval(campaign.id, companion.name, sheets));
    const hidden = (Boolean(conscience.concealed) && rungName(truth) === "uneasy") || Boolean(companionDeparture(npc.id).intent);
    const rung = rungName(hidden ? Math.min(truth, conscience.told) : truth);
    const parts = [
      `- ${companion.name}: holds ${values.length ? values.map(valueLabel).join(", ") : "nothing in particular"}`,
      rungGuidance(rung, setting),
    ];
    if (rung !== "content" && conscience.cause && !conscience.causeSecret) {
      parts.push(`after ${conscience.cause}`);
    }
    if (conscience.ultimatum) {
      parts.push(
        `their demand: "${conscience.ultimatum.condition}", by ${formatDate(campaign.clock.calendar, conscience.ultimatum.due)} (${durationLabel(minutesLeft(conscience.ultimatum, now))} left)`,
      );
    }
    if (conscience.owed && !hidden) {
      parts.push(`not yet heard at the table: voice it this reply in their own words, or the server posts their line after it`);
    }
    // Issue 503 Phase 4: a devoted companion's reaction (devoted-guard.ts).
    const devoted = friendsAtLeast(campaign.id, companion.name, sheets, "devoted");
    if (devoted.length) {
      parts.push(`devoted to ${devoted.join(", ")}: may take a blow meant for them once a fight (use_reaction "Take the Blow", targetCharacterId), and heals them first while they lie dying`);
    }
    return [parts.join("; ")];
  });
  return lines.length
    ? `Companion conscience (server-held: deeds and standing move each rung, never narration; play the rung each one is on):\n${lines.join("\n")}`
    : "";
}

// The storyteller's own lines (the section tagged STORYTELLER_SECRET, built
// in src/lib/dm/turn.ts): each companion who keeps unease in, to be played as
// content, and who has noticed it, to be shown a tell; and each one whose
// breaking point stands under a plan held in secret, played as the rung the
// table has heard while the plan is only foreshadowed (issue 615).
export function conscienceSecretLines(campaign: Campaign, sheets: readonly CharacterSheet[]): string[] {
  const setting = conscienceSetting(campaign);
  if (setting === "off") {
    return [];
  }
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return consciousCompanions(sheets).flatMap((companion) => {
    const npc = companionNpcFor(companion);
    const conscience = npc ? companionConscience(npc.id) : null;
    if (!npc || !conscience) {
      return [];
    }
    const truth = effectiveRung(conscience, worstApproval(campaign.id, companion.name, sheets));
    if (companionDeparture(npc.id).intent) {
      const heard = RUNG_WORD[rungName(Math.min(truth, conscience.told))];
      return [
        `- ${companion.name} is at their ${RUNG_WORD[rungName(truth)]}, which the table has not seen (it has heard only: ${heard}). In the open play them as GAME STATE's conscience line says, and let their plan show only as foreshadowing.`,
      ];
    }
    if (!conscience.concealed || rungName(truth) !== "uneasy") {
      return [];
    }
    const noticed = conscience.concealed.noticedBy.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
    const cause = conscience.cause && !conscience.causeSecret ? ` (after ${conscience.cause})` : "";
    const who = noticed.length
      ? `${noticed.join(" and ")} noticed: show ${noticed.length > 1 ? "each of them" : noticed[0]} a tell (a look held too long, a silence where a word belonged), and no one else.`
      : "Nobody has noticed.";
    return [`- ${companion.name} is ${rungGuidance("uneasy", setting, true)}${cause}. ${who}`];
  });
}

// ---- what the Bonds tab shows ----

export type ConscienceView = {
  rung: ConscienceRung;
  ultimatum: { condition: string; due: string; left: string } | null;
  // For whoever runs the story (issue 615): a move the table has not heard
  // yet, and unease kept in, with the characters who noticed it.
  unheard?: true;
  hidden?: { noticedBy: string[] };
  // For a player: one of their own characters noticed unease kept in.
  noticed?: true;
};

export type { ConscienceViewer };

// The view of whoever runs the story, for the server's own reads.
export const STORYTELLER_VIEW: ConscienceViewer = { storyteller: true, characterIds: [] };

// Each lasting companion's rung and ultimatum, by name key, for the Bonds
// rows, as this viewer may know them (issue 615, conscience-voice-logic.ts
// viewFor): whoever runs the story reads the truth; a player reads what the
// table has heard, and unease kept in only where one of their own characters
// noticed it.
export function conscienceViews(campaign: Campaign, viewer: ConscienceViewer): Map<string, ConscienceView> {
  const views = new Map<string, ConscienceView>();
  if (!conscienceOn(campaign)) {
    return views;
  }
  const sheets = listSheets(campaign.id);
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  const now = campaign.clock.instant;
  for (const companion of consciousCompanions(sheets)) {
    const npc = companionNpcFor(companion);
    if (!npc) {
      continue;
    }
    const conscience = companionConscience(npc.id);
    const sight = viewFor(viewer, conscience, effectiveRung(conscience, worstApproval(campaign.id, companion.name, sheets)));
    views.set(textKey(companion.name), {
      rung: sight.rung,
      ultimatum:
        sight.terms && conscience.ultimatum
          ? {
              condition: conscience.ultimatum.condition,
              due: formatDate(campaign.clock.calendar, conscience.ultimatum.due),
              left: durationLabel(minutesLeft(conscience.ultimatum, now)),
            }
          : null,
      ...(sight.unheard ? { unheard: true as const } : {}),
      ...(sight.hidden ? { hidden: { noticedBy: sight.noticedBy.map((id) => names.get(id) ?? "").filter(Boolean) } } : {}),
      ...(sight.noticed ? { noticed: true as const } : {}),
    });
  }
  return views;
}
