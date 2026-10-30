import type { CharacterSheet } from "@/lib/schemas/sheet";

// A lasting companion leaving the party, as the stream saw it go (issue 503):
// its card as it was, how it went (what the table saw), and when the client
// learned of it. The Party panel dims the card for DEPART_MS and then files
// it under Gone (PartyGone.tsx); the stream forgets it after
// DEPARTING_KEPT_MS, so a later reconnect never replays the moment.
export type DepartingSheet = { sheet: CharacterSheet; how: string; at: number };

export const DEPART_MS = 600;
export const DEPARTING_KEPT_MS = 10_000;

// One row of the Gone list, as GET /companions/gone sends it
// (src/lib/db/companion-npcs.ts goneCompanions).
export type GoneEntry = {
  // The sheet they had while in the party, so the lines they spoke and the
  // cards they played stay theirs in the story log; an older server sends none.
  sheetId?: string;
  name: string;
  how: string;
  at: string;
  portraitUrl: string;
  race: string;
  class: string;
  gender: string;
  // Who they still cared for as they went (issue 563); an older server
  // sends none.
  caresFor?: string[];
};

// A character as the story log draws a line of theirs: the name over it and
// the face beside it. A companion who has left keeps theirs (0.31.1
// playtest): with no sheet to read, their speech fell to a letter and a card
// they had played was put in the player's mouth.
export type TranscriptSheet = Pick<CharacterSheet, "id" | "name" | "race" | "class" | "gender" | "portrait">;

// The party's sheets, then the ones who left: a card still dimming carries
// its whole sheet, and a Gone row what the server kept of it. A sheet still
// in the party wins over its departed copy.
export function transcriptSheets(
  sheets: readonly TranscriptSheet[],
  departing: readonly DepartingSheet[] = [],
  gone: readonly GoneEntry[] = [],
): Map<string, TranscriptSheet> {
  const byId = new Map<string, TranscriptSheet>();
  for (const entry of gone) {
    if (entry.sheetId) {
      byId.set(entry.sheetId, {
        id: entry.sheetId,
        name: entry.name,
        race: entry.race,
        class: entry.class,
        gender: (entry.gender as CharacterSheet["gender"]) || "",
        portrait: entry.portraitUrl ? ({ url: entry.portraitUrl } as CharacterSheet["portrait"]) : null,
      });
    }
  }
  for (const { sheet } of departing) {
    byId.set(sheet.id, sheet);
  }
  for (const sheet of sheets) {
    byId.set(sheet.id, sheet);
  }
  return byId;
}
