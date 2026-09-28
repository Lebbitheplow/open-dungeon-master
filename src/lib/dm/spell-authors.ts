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
