import { getDatabase, nowIso } from "@/lib/db/core";
import { getCharacter, type LibraryCharacter } from "@/lib/db/characters";
import { tableAuthors } from "@/lib/db/homebrew";
import { getSheetById } from "@/lib/db/sheets";
import { byName } from "@/lib/language/text-logic";

// A DM's pregens offered to the players of a table (option B of "sharing a
// DM's own pregens with the table"): the DM ticks "Offer to players" on a
// pregen in the workshop's Party panel, and a player joining a table made
// from that workshop sees it in the hero chooser, confirms it, and takes a
// seat with a copy adapted to the table's level. One player per pregen per
// table: the claim is a row here, and the pregen shows as taken to the rest.
//
// Every check is the server's (the join and its preview both ask here):
//   - the pregen is ticked, a player character, and filed under a workshop;
//   - its owner holds a DM seat at this table (src/lib/db/homebrew.ts
//     tableAuthors), so a workshop someone else imported offers nothing;
//   - this table was made from that workshop: prep was imported from it
//     (src/lib/db/content-origins.ts records every copied row's source);
//   - nobody else holds it here.
// An unticked pregen is never listed and never seats.
//
// The copy a player takes is marked as that pregen's (library_characters
// pregen_origin_id), and so is a duplicate of it. A pregen is held at a table
// while any sheet there plays it or a copy of it, so the claim survives a
// lobby edit (which stores the sheet under a new id) and comes back when the
// copy is seated again; and a copy does not sit where someone else holds its
// pregen (pregenSeatRefusal, asked by every library door in
// src/app/api/campaigns/[campaignId]/sheet/route.ts and its preview).

export type OfferedPregen = {
  character: LibraryCharacter;
  // Who holds it at this table, or null while it is free.
  claim: PregenClaim | null;
};

// A pregen's holder at a table: the player, the sheet that plays it, and the
// library character behind that sheet ("" when it is gone from the library).
export type PregenClaim = { userId: string; sheetId: string; libraryCharacterId: string };

// The pregen a library character plays: the DM's pregen itself (a character
// filed under a workshop), the one a player's copy was taken from, or "" for
// any other character.
export function pregenOf(character: Pick<LibraryCharacter, "id" | "workshopId" | "pregenOriginId">): string {
  return character.pregenOriginId || (character.workshopId ? character.id : "");
}

// Whether this table drew prep from that workshop.
function drawsFrom(campaignId: string, workshopId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(`SELECT 1 FROM content_origins WHERE campaign_id = ? AND origin_id = ? LIMIT 1`)
      .get(campaignId, workshopId),
  );
}

// Who holds a pregen at a table: the first sheet there that plays it or a
// copy of it, whatever id a lobby edit gave that sheet; else the seat the
// claim last made, while it is there (a copy the player has since deleted
// from their library still plays). A player who gave the seat up in the
// lobby gave the pregen up with it. `except` is a sheet about to go (the one
// a lobby switch or edit replaces), which holds nothing.
function liveClaim(campaignId: string, pregenId: string, except = ""): PregenClaim | null {
  const db = getDatabase();
  const seated = db
    .prepare(
      `SELECT s.id AS sheet_id, s.user_id, s.library_character_id
         FROM character_sheets s
         JOIN library_characters l ON l.id = s.library_character_id
        WHERE s.campaign_id = ? AND (l.id = ? OR l.pregen_origin_id = ?) AND s.id != ?
          AND (s.is_companion IS NULL OR s.is_companion = 0)
        ORDER BY s.created_at ASC, s.rowid ASC
        LIMIT 1`,
    )
    .get(campaignId, pregenId, pregenId, except) as
    | { sheet_id: string; user_id: string; library_character_id: string }
    | undefined;
  if (seated) {
    return { userId: seated.user_id, sheetId: seated.sheet_id, libraryCharacterId: seated.library_character_id };
  }
  const row = db
    .prepare(`SELECT sheet_id FROM pregen_claims WHERE campaign_id = ? AND character_id = ?`)
    .get(campaignId, pregenId) as { sheet_id: string } | undefined;
  const sheet = row && row.sheet_id !== except ? getSheetById(row.sheet_id) : null;
  if (!sheet || sheet.campaignId !== campaignId || sheet.isCompanion) {
    return null;
  }
  return { userId: sheet.userId, sheetId: sheet.id, libraryCharacterId: sheet.libraryCharacterId ?? "" };
}

function offerable(character: LibraryCharacter | null, campaignId: string, authors: string[]): character is LibraryCharacter {
  return Boolean(
    character &&
      character.offered &&
      character.workshopId &&
      character.role !== "companion" &&
      authors.includes(character.userId) &&
      drawsFrom(campaignId, character.workshopId),
  );
}

// Every pregen offered at this table, by name, with who holds each.
export function listOfferedPregens(campaignId: string): OfferedPregen[] {
  const authors = tableAuthors(campaignId);
  if (!authors.length) {
    return [];
  }
  const rows = getDatabase()
    .prepare(
      `SELECT id FROM library_characters
        WHERE offered_to_table = 1 AND workshop_id != '' AND user_id IN (${authors.map(() => "?").join(", ")})`,
    )
    .all(...authors) as Array<{ id: string }>;
  return rows
    .map((row) => getCharacter(row.id))
    .filter((character): character is LibraryCharacter => offerable(character, campaignId, authors))
    .sort(byName)
    .map((character) => ({ character, claim: liveClaim(campaignId, character.id) }));
}

// One offered pregen at this table, or null when it is not offered here
// (unticked, another table's, a companion, or no such character): the
// routes answer that as "no such hero", so an unticked pregen stays unseen.
export function offeredPregenFor(campaignId: string, characterId: string): OfferedPregen | null {
  const character = getCharacter(characterId);
  if (!offerable(character, campaignId, tableAuthors(campaignId))) {
    return null;
  }
  return { character, claim: liveClaim(campaignId, character.id) };
}

// Why this player cannot take the pregen, or null when they can.
export function claimRefusal(offer: OfferedPregen, userId: string): string | null {
  if (!offer.claim) {
    return null;
  }
  return offer.claim.userId === userId
    ? `You already play ${offer.character.name} at this table.`
    : `${offer.character.name} is already taken at this table.`;
}

// Why a library character may not sit at this table because the pregen it
// plays is held here by another sheet, or null. One player per pregen per
// table: a player's copy (or a duplicate of it) does not sit where someone
// else plays the pregen, nor beside another copy of the same pregen, and the
// DM's own pregen does not sit where a player holds a copy. `replacing` is
// the sheet a lobby switch or edit gives up first.
export function pregenSeatRefusal(
  campaignId: string,
  character: LibraryCharacter,
  userId: string,
  replacing = "",
): string | null {
  const pregenId = pregenOf(character);
  const claim = pregenId ? liveClaim(campaignId, pregenId, replacing) : null;
  if (!claim || claim.libraryCharacterId === character.id) {
    return null;
  }
  return claim.userId === userId
    ? `You already play ${character.name} at this table, from another copy of the same pregen.`
    : `${character.name} is a pregen another player already plays at this table. The DM offers each pregen to one player.`;
}

// Records the seat a player took with the pregen. Called once the sheet is
// stored, in the same request that checked claimRefusal; a stale claim (its
// seat gone) is replaced. A pregen its DM has since deleted holds nothing.
export function claimPregen(campaignId: string, characterId: string, userId: string, sheetId: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO pregen_claims (campaign_id, character_id, user_id, sheet_id, created_at)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM library_characters WHERE id = ?)
       ON CONFLICT (campaign_id, character_id) DO UPDATE SET user_id = excluded.user_id, sheet_id = excluded.sheet_id, created_at = excluded.created_at`,
    )
    .run(campaignId, characterId, userId, sheetId, nowIso(), characterId);
}

// A player's copy of a pregen seated again (a lobby switch or edit, or a
// join from the library): the claim follows the new seat, so it holds even
// if the copy is later deleted from the library. Any other character holds
// no claim row; the DM's own pregen is found by its sheet.
export function recordPregenSeat(campaignId: string, character: LibraryCharacter, userId: string, sheetId: string): void {
  if (character.pregenOriginId) {
    claimPregen(campaignId, character.pregenOriginId, userId, sheetId);
  }
}
