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
// Must not import turn.ts, loop.ts, encounter-tools.ts, enemy-damage.ts or
// mutations.ts: encounter-tools imports this.

import { campaignSeats, isCampaignMember, listMembers, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { isCompanionUserId } from "@/lib/db/users";
import { hasHumanDm, isDmSeat } from "@/lib/dm/viewer";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type CommandFields = Pick<CharacterSheet, "isCompanion" | "commandedBy" | "summon">;

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
// commander who left the table, or took a DM seat, commands nobody.
export function commanderOf(campaign: Campaign, sheet: CommandFields): string | null {
  const userId = sheet.commandedBy;
  if (!userId || !commandable(sheet)) {
    return null;
  }
  if (isDmSeat(campaignSeats(campaign), userId) || !isCampaignMember(campaign.id, userId)) {
    return null;
  }
  return userId;
}

// The person whose move it is while the initiative pointer rests on this
// entry: a companion's commander, else the entry's own owner.
export function turnUserId(campaign: Campaign, entry: { characterId: string; userId: string }): string {
  if (!isCompanionUserId(entry.userId)) {
    return entry.userId;
  }
  const sheet = getSheetById(entry.characterId);
  return (sheet && commanderOf(campaign, sheet)) ?? entry.userId;
}

// A companion this player commands, by id, or null: theirs to arrange the
// Hand of, as they play it.
export function commandedSheet(campaign: Campaign, userId: string, characterId: string): CharacterSheet | null {
  const sheet = getSheetById(characterId);
  return sheet && sheet.campaignId === campaign.id && commanderOf(campaign, sheet) === userId ? sheet : null;
}

// Whether the AI plays this character's turns as its own: a companion nobody
// commands. A commanded one waits for its commander like any player's
// character: nothing is spent, walked or ended for it until they speak
// (src/lib/dm/player-word.ts, claims.ts turnOverFor, map-tools move_token).
export function aiPlaysSheet(campaign: Campaign | null, sheet: CommandFields): boolean {
  return sheet.isCompanion && !(campaign && commanderOf(campaign, sheet));
}

// Whether the DM plays this companion's turn (nobody commands it).
export function dmPlaysTurn(campaign: Campaign, entry: { characterId: string; userId: string }): boolean {
  return isCompanionUserId(entry.userId) && turnUserId(campaign, entry) === entry.userId;
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
