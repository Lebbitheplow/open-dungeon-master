// Moving a combatant to the other side of a fight (issue 503, Phase 6): the
// engine's entry point for a companion who turns on the party (Phase 2's
// "confront", Phase 3's return), a character who joins a pact against the
// others (Phase 7), and a summon whose maker loses control of it
// (summon-store.ts). The sheet is never deleted and never copied: the same
// sheet fights on, with every feature, slot and wound it had, on the other
// side of the initiative order.
//
//   moveToSide(campaign, id, "foe", { reason })   turn on the party
//   moveToSide(campaign, id, "party", { reason }) come back
//
// What changes with the side (src/lib/dm/combatant.ts asks it everywhere):
// who the combatant may target and who may target it, who counts for the
// party's fall and for victory, who shares the fight's XP, whose aura helps
// it, who it flanks with, which way opportunity attacks go, who the server's
// backstop has it attack, and the colour of its token's rim. A companion on
// the foes' side is played by the DM: a player's command over it lapses
// while it is there and holds again when it comes back
// (companion-command.ts commanderOf). A player's own character keeps its
// player wherever it fights, except while a Dominate spell from the other
// side holds it (companion-command.ts dominatedByFoe, announceDominated).
//
// A move works at the start of a fight as well as in one: a sheet not yet in
// the initiative order is rolled in (its own initiative, the DM's die) and
// put on the board near the side it joins.
//
// Must not import encounter-tools, turn.ts or mutations.ts: the engine's low
// layers (summon-store) call in here.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  saveEncounter,
  setEncounterSides,
  type Encounter,
  type OrderEntry,
} from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getBattleMapForEncounter, getTokenByRef, insertToken, listTokens } from "@/lib/db/battle-maps";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById } from "@/lib/db/sheets";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { d20Expression } from "@/lib/dice";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import { withSide, type CombatSide } from "@/lib/dm/combat-sides-logic";
import { combatantsOf, resolveCombatant, sideOf, type Combatant } from "@/lib/dm/combatant";
import { dmRoll } from "@/lib/dm/roll-card";
import { onDominationShift } from "@/lib/db/side-watch";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type SideMove =
  | { ok: true; id: string; name: string; side: CombatSide; changed: boolean; line: string }
  | { error: string };

const mod = (score: number) => Math.floor((score - 10) / 2);

// Moves one combatant (an id or a name, sheet or enemy) to `side` in the
// fight running now. `reason` is said to the table with the move ("Brother
// Aldric turns on the party"); `quiet` leaves the table note to the caller.
export function moveToSide(
  campaign: Campaign,
  ref: string,
  side: CombatSide,
  options: { reason?: string; quiet?: boolean } = {},
): SideMove {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No fight is running: a side is a place in a fight." };
  }
  const combatant = resolveCombatant(campaign.id, encounter, ref);
  if (!combatant) {
    return { error: `Nobody in this fight or at this table is called ${ref}.` };
  }
  // A domination decides its creature's side for as long as it lasts: what
  // is stored underneath is the side it returns to.
  const before = combatant.side;
  setEncounterSides(encounter.id, withSide(encounter.sides, combatant.kind, combatant.id, side));
  if (combatant.kind === "sheet") {
    joinFight(campaign, getActiveEncounter(campaign.id) ?? encounter, combatant.sheet, side);
  }
  surpriseFollowsSide(campaign.id, combatant.id, side);
  const live = getActiveEncounter(campaign.id) ?? encounter;
  const now = sideOf(live, combatant.kind, combatant.id);
  const changed = now !== before;
  const line = sideLine(combatant, now, options.reason);
  if (changed && !options.quiet) {
    tableNote(campaign, line);
  }
  publishSides(campaign.id);
  return { ok: true, id: combatant.id, name: combatant.name, side: now, changed, line };
}

// Surprise is a side's (an ambush catches one side of a fight): a combatant
// moved in the first round is surprised exactly when the side it joins is.
// A side with nobody surprised takes it out of the list; one with somebody
// surprised puts it in.
function surpriseFollowsSide(campaignId: string, id: string, side: CombatSide) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || encounter.round > 1 || !encounter.surprisedIds.length) {
    return;
  }
  const sideSurprised = combatantsOf(campaignId, encounter).some(
    (other) => other.id !== id && other.side === side && encounter.surprisedIds.includes(other.id),
  );
  const listed = encounter.surprisedIds.includes(id);
  if (sideSurprised === listed) {
    return;
  }
  encounter.surprisedIds = sideSurprised ? [...encounter.surprisedIds, id] : encounter.surprisedIds.filter((entry) => entry !== id);
  saveEncounter(encounter);
}

// What the table is told.
function sideLine(combatant: Combatant, side: CombatSide, reason?: string): string {
  const why = reason?.trim() ? ` ${reason.trim().replace(/\.?$/, ".")}` : "";
  return side === "foe"
    ? `${combatant.name} turns against the party.${why}`
    : `${combatant.name} fights beside the party again.${why}`;
}

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-battle", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// A Dominate spell from the other side has just taken a character
// (set-condition.ts): the table, its player among them, is told the DM plays
// it until the charm ends, and every client re-rims it. Returns the line.
export function announceDominated(campaign: Campaign, name: string): string {
  const line = `${name} is dominated: the DM plays ${name} until the charm ends.`;
  tableNote(campaign, line);
  publishSides(campaign.id);
  return line;
}

// Every client redraws the order and re-rims the token from the server's
// word (encounter-view.ts carries the sides).
export function publishSides(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", { encounter: activePublicEncounter(campaignId) });
  publishEphemeral(campaignId, "battle_map_updated", {});
}

// A Dominate that starts or ends by any route re-sides its creature on every
// client (src/lib/db/side-watch.ts), during a fight.
onDominationShift((campaignId) => {
  if (getActiveEncounter(campaignId)) {
    publishSides(campaignId);
  }
});

// A sheet not in the order yet is rolled in and put on the board, on the
// side it joins: at the start of a fight (Phase 3's return) or one arriving
// mid-fight.
function joinFight(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet, side: CombatSide) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const inOrder = encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === fresh.id);
  if (encounter.orderReady && !inOrder) {
    const initiative = dmRoll(campaign.id, null, "initiative", `${fresh.name}: initiative`, d20Expression(mod(fresh.abilities.dex))).total;
    const entry: OrderEntry = { kind: "pc", characterId: fresh.id, userId: fresh.userId, name: fresh.name, initiative };
    let at = encounter.order.findIndex((other) => other.initiative < initiative);
    if (at < 0) {
      at = encounter.order.length;
    }
    encounter.order.splice(at, 0, entry);
    if (at <= encounter.turnIndex) {
      encounter.turnIndex += 1;
    }
    saveEncounter(encounter);
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map || getTokenByRef(map.id, fresh.id)) {
    return;
  }
  const tokens = listTokens(map.id);
  const friends = tokens.filter((token) => (token.kind === "pc" ? sideOf(encounter, "sheet", token.refId) : token.kind === "enemy" ? sideOf(encounter, "enemy", token.refId) : null) === side);
  const others = tokens.filter((token) => !friends.includes(token) && (token.kind === "pc" || token.kind === "enemy"));
  const [spot] = findSpawnTiles(
    map.terrain,
    map.width,
    map.height,
    occupiedTiles(map, tokens, null),
    1,
    friends.map((token) => ({ x: token.x, y: token.y })),
    others.map((token) => ({ x: token.x, y: token.y })),
  );
  if (spot) {
    insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: fresh.id, name: fresh.name, x: spot.x, y: spot.y });
  }
}

// The sheets that ended (or stand in) a fight on the foes' side: for the
// phases that decide what becomes of a turncoat once the fight is over.
export function sheetsAgainstParty(encounter: Pick<Encounter, "id" | "sides" | "order">): string[] {
  return encounter.order
    .filter((entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc")
    .map((entry) => entry.characterId)
    .filter((id, index, all) => all.indexOf(id) === index && sideOf(encounter, "sheet", id) === "foe");
}
