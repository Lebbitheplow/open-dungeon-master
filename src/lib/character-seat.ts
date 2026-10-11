import type { Campaign } from "@/lib/db/campaigns";
import { setMemberActiveCharacter } from "@/lib/db/campaigns";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { initiativeCharacter, ownedCharacters } from "@/lib/player-characters";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A player fielding several characters has three different "my character"s
// (src/lib/player-characters.ts): the ones they own, the one they have
// selected to look at and act as, and the one whose turn it is. These are
// the server-side readings of them, for the routes a player hits with no
// character named by an older client.

// The player character whose turn it is, when the order has locked.
export function currentPcId(
  encounter: Pick<Encounter, "order" | "turnIndex" | "orderReady"> | null | undefined,
): string | undefined {
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return current?.kind === "pc" ? current.characterId : undefined;
}

// The sheet a request names when it is the caller's own, else the selected
// one. Null when the named sheet is somebody else's or a companion's, so the
// caller refuses instead of quietly answering on the wrong sheet.
export function ownSheetFor(
  campaignId: string,
  userId: string,
  characterId?: string | null,
): CharacterSheet | null {
  if (characterId) {
    return ownedCharacters(listSheets(campaignId), userId).find((sheet) => sheet.id === characterId) ?? null;
  }
  return getSheetForUser(campaignId, userId);
}

// The character the player is acting as right now: the one named, else the
// one whose turn it is (the Hand, the board and the dice follow the
// initiative order, whatever sheet the player has open), else the selected
// one. Null when a named sheet is not theirs.
export function actingSheetFor(
  campaignId: string,
  userId: string,
  characterId?: string | null,
  encounter: Encounter | null = getActiveEncounter(campaignId),
): CharacterSheet | null {
  if (characterId) {
    return ownSheetFor(campaignId, userId, characterId);
  }
  return (
    initiativeCharacter(listSheets(campaignId), userId, currentPcId(encounter)) ??
    getSheetForUser(campaignId, userId)
  );
}

// A character just added takes its player's seat, so the one they made is
// the one they play, unless the table fields one character at a time and a
// fight is on: the initiative order and the board hold the character already
// fielded, so the new one waits on the bench until the fight ends. Returns
// whether it took the seat.
export function seatAddedSheet(campaign: Campaign, userId: string, sheetId: string): boolean {
  if (campaign.gameSettings.multiCharacter === "one_active" && getActiveEncounter(campaign.id)) {
    const fielded = getSheetForUser(campaign.id, userId);
    if (fielded && fielded.id !== sheetId) {
      return false;
    }
  }
  setMemberActiveCharacter(campaign.id, userId, sheetId);
  publishEphemeral(campaign.id, "roster_updated", { userId, activeSheetId: sheetId, at: Date.now() });
  return true;
}
