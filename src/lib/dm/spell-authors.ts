// Whose homebrew spells count at a table.
//
// A homebrew spell is its author's to write and to look at, in the workshop
// and the library. In PLAY it is a rule of the table, and the rules of a
// table are set by whoever runs it: the owner, and the person in the DM's or
// the assistant DM's seat. A player's own spell is on no list until one of
// them writes it. This is the same reading the bestiary takes of a homebrew
// monster (src/lib/bestiary/index.ts resolveMonster).
//
// Every cast path passes this list to src/lib/content/index.ts, so a name
// nobody published resolves to the table's spell or to nothing.

import type { Campaign } from "@/lib/db/campaigns";
import { tableAuthors } from "@/lib/db/homebrew";

export function spellAuthorsFor(
  campaign: Pick<Campaign, "ownerUserId" | "dmUserId" | "assistantDmUserId">,
): string[] {
  return [
    ...new Set(
      [campaign.ownerUserId, campaign.dmUserId, campaign.assistantDmUserId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
}

// The same list for a sheet: its table's when it sits at one, its owner's
// own when it is a library character outside any campaign. Every play path
// that reads a spell for a sheet (the attack profile, concentration, auras)
// reads this, so the spell a cast resolves is the one the attack and the
// upkeep resolve too.
export function sheetSpellAuthors(sheet: { campaignId?: string | null; userId: string }): string[] {
  return sheet.campaignId ? tableAuthors(sheet.campaignId) : [sheet.userId];
}
