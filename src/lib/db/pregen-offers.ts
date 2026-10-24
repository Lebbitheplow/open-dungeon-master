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

export type OfferedPregen = {
  character: LibraryCharacter;
  // Who holds it at this table, or null while it is free.
  claim: { userId: string; sheetId: string } | null;
};

// Whether this table drew prep from that workshop.
function drawsFrom(campaignId: string, workshopId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(`SELECT 1 FROM content_origins WHERE campaign_id = ? AND origin_id = ? LIMIT 1`)
      .get(campaignId, workshopId),
  );
}

// The claim on a pregen at a table, while the seat it made is still there.
// A player who gave that seat up in the lobby gave the pregen up with it.
function liveClaim(campaignId: string, characterId: string): OfferedPregen["claim"] {
  const row = getDatabase()
    .prepare(`SELECT user_id, sheet_id FROM pregen_claims WHERE campaign_id = ? AND character_id = ?`)
    .get(campaignId, characterId) as { user_id: string; sheet_id: string } | undefined;
  if (!row) {
    return null;
  }
  const sheet = getSheetById(row.sheet_id);
  if (!sheet || sheet.campaignId !== campaignId) {
    return null;
  }
  return { userId: row.user_id, sheetId: row.sheet_id };
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

// Records the seat a player took with the pregen. Called once the sheet is
// stored, in the same request that checked claimRefusal; a stale claim (its
// seat gone) is replaced.
export function claimPregen(campaignId: string, characterId: string, userId: string, sheetId: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO pregen_claims (campaign_id, character_id, user_id, sheet_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (campaign_id, character_id) DO UPDATE SET user_id = excluded.user_id, sheet_id = excluded.sheet_id, created_at = excluded.created_at`,
    )
    .run(campaignId, characterId, userId, sheetId, nowIso());
}
