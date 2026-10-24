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
  name: string;
  how: string;
  at: string;
  portraitUrl: string;
  race: string;
  class: string;
  gender: string;
};
