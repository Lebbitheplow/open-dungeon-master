// Who takes an AI companion's turns in a fight. The DM plays every companion
// out of fights, their voice and their choices; in a fight a companion may
// follow a player's orders instead, the way a tactics game hands the whole
// party to the one person playing it. The sheet's commandedBy names that
// player (null: the DM plays the turns). A party companion who joins a table
// with one player and an AI storyteller starts under that player's command
// (defaultCommander); whoever steers the story changes it on the companion's
// card in the Party panel (PATCH /companions/[characterId]).
//
// On a commanded companion's turn the floor is the commander's: the Hand, the
// board and End turn act as the companion (src/lib/player-characters.ts
// initiativeCharacter), and the DM is not woken to play it.
//
// A player's own character held by a Dominate spell cast from the other side
// (SRD 5.1: "you have a telepathic link with it" and command it) is played by
// the DM in the same way for as long as the charm holds (dominatedByFoe): the
// floor on its turn is nobody's at the table, the DM is woken to play it, and
// its player's moves for it are refused with the reason. Nothing is stored:
// the charm ending gives it back to its player.
//
// Must not import turn.ts, loop.ts, encounter-tools.ts, enemy-damage.ts or
// mutations.ts: encounter-tools imports this.

import { campaignSeats, isCampaignMember, listMembers, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { isCompanionUserId } from "@/lib/db/users";
import { hasHumanDm, isDmSeat } from "@/lib/dm/viewer";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { getActiveEncounter } from "@/lib/db/encounters";
import { sideOf } from "@/lib/dm/combatant";
import { dominatorOf } from "@/lib/dm/combat-sides-logic";

type CommandFields = Pick<CharacterSheet, "isCompanion" | "commandedBy" | "summon">;
type HeldFields = Pick<CharacterSheet, "isCompanion" | "conditions" | "conditionMeta"> & { id: string };

// The floor's holder while the DM plays a dominated character's turn: no
// person at the table.
export const DOMINATED_TURN = "dm:dominated";

// Whether a character is dominated by the other side of the fight running
// now: the charm of a Dominate spell holds it, and it fights on the foes'
// side for it (combatant.ts sideOf follows the dominator).
export function dominatedByFoe(campaignId: string, sheet: HeldFields): boolean {
  if (!dominatorOf(sheet.conditions, sheet.conditionMeta as Record<string, { spell?: unknown; source?: unknown }>)) {
    return false;
  }
  return againstTheParty(campaignId, sheet.id);
}

// The player's refusal while their character is dominated, or null.
export function dominatedRefusal(campaignId: string, sheet: HeldFields & { name: string }): string | null {
  return dominatedByFoe(campaignId, sheet)
    ? `${sheet.name} is dominated: the DM plays ${sheet.name} until the charm ends. Use OOC for table talk.`
    : null;
}

// Whether a companion can be put under a player's command at all: a creature
// a spell made (a summon) keeps to the rules of its spell.
export function commandable(sheet: Pick<CharacterSheet, "isCompanion" | "summon">): boolean {
  return sheet.isCompanion && !sheet.summon;
}

// The players at the table who could command a companion: members holding a
// party slot (not the DM seats).
export function commandingPlayers(campaign: Campaign): string[] {
  const seats = campaignSeats(campaign);
  return listMembers(campaign.id)
    .map((member) => member.userId)
    .filter((id) => !isDmSeat(seats, id) && !isCompanionUserId(id));
}

// The player commanding this companion in fights now, or null for the DM. A
// commander who left the table, or took a DM seat, commands nobody. Nor does
// anyone command a companion fighting against the party (issue 503,
// src/lib/dm/combat-sides.ts): the DM plays it for as long as it is on the
// foes' side, and the command holds again once it comes back. The stored
// commandedBy is never touched by a move.
export function commanderOf(campaign: Campaign, sheet: CommandFields & { id?: string }): string | null {
  const userId = sheet.commandedBy;
  if (!userId || !commandable(sheet)) {
    return null;
  }
  if (isDmSeat(campaignSeats(campaign), userId) || !isCampaignMember(campaign.id, userId)) {
    return null;
  }
  if (sheet.id && againstTheParty(campaign.id, sheet.id)) {
    return null;
  }
  return userId;
}

// Whether this sheet fights on the foes' side of the fight running now.
function againstTheParty(campaignId: string, sheetId: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  return Boolean(encounter && sideOf(encounter, "sheet", sheetId) === "foe");
}

// The person whose move it is while the initiative pointer rests on this
// entry: a companion's commander, else the entry's own owner.
export function turnUserId(campaign: Campaign, entry: { characterId: string; userId: string }): string {
  const sheet = getSheetById(entry.characterId);
  if (!isCompanionUserId(entry.userId)) {
    return sheet && dominatedByFoe(campaign.id, sheet) ? DOMINATED_TURN : entry.userId;
  }
  return (sheet && commanderOf(campaign, sheet)) ?? entry.userId;
}

// A companion this player commands, by id, or null: theirs to arrange the
// Hand of, as they play it.
export function commandedSheet(campaign: Campaign, userId: string, characterId: string): CharacterSheet | null {
  const sheet = getSheetById(characterId);
  return sheet && sheet.campaignId === campaign.id && commanderOf(campaign, sheet) === userId ? sheet : null;
}

// Whether the AI plays this character's turns as its own: a companion nobody
// commands, or a player's character dominated by the other side. A commanded
// one waits for its commander like any player's character: nothing is spent,
// walked or ended for it until they speak (src/lib/dm/player-word.ts,
// claims.ts turnOverFor, map-tools move_token).
export function aiPlaysSheet(campaign: Campaign | null, sheet: CommandFields & Partial<HeldFields>): boolean {
  if (!sheet.isCompanion) {
    return Boolean(campaign && sheet.id && sheet.conditions && dominatedByFoe(campaign.id, sheet as HeldFields));
  }
  return !(campaign && commanderOf(campaign, sheet));
}

// Whether the DM plays this turn: a companion nobody commands, or a
// dominated player's character.
export function dmPlaysTurn(campaign: Campaign, entry: { characterId: string; userId: string }): boolean {
  const holder = turnUserId(campaign, entry);
  return holder === DOMINATED_TURN || (isCompanionUserId(entry.userId) && holder === entry.userId);
}

// The player a companion joining this table follows in fights: the one
// player at a table the AI runs. Nobody (the DM) when a person narrates,
// when several players share the table, and for a guest who comes for one
// scene or fight.
export function defaultCommander(campaign: Campaign, kind: "party" | "guest"): string | null {
  if (kind !== "party" || hasHumanDm(campaignSeats(campaign))) {
    return null;
  }
  const players = commandingPlayers(campaign);
  return players.length === 1 ? players[0] : null;
}
