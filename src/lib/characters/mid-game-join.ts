import type { MemberContext } from "@/lib/campaign-api";
import { JOIN_NOTE_PREFIX } from "@/lib/campaign-types";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { classWords, raceWords } from "@/lib/sheet-words";

// A character arriving after the adventure started gets a table note so the
// DM writes them into the story on its next turn. Every door that seats a
// new hero calls it: one the builder made (POST /sheet) and a ready-made one
// (POST /sheet/pregen), which a player who joins a table in play can now
// take from the composer's gate. A hero who replaces one that fell
// (src/lib/characters/hero-door.ts) says so, so the GM brings them in as
// a new member of the party rather than a stranger with no reason to be there.
export function announceMidGameJoin(
  context: MemberContext,
  sheet: CharacterSheet,
  replaces?: string,
  // Whose hero it is: the caller's, unless the owner seated it for them.
  username: string = context.user.username,
) {
  if (context.campaign.status !== "active") {
    return;
  }
  const campaignId = context.campaign.id;
  const seq = allocateSeq(campaignId);
  const backstoryHint = sheet.backstory ? ` Their backstory: ${sheet.backstory.slice(0, 200)}` : "";
  const fallenHint = replaces ? ` They take the place of ${replaces}, who fell.` : "";
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "system-party",
    content: `${JOIN_NOTE_PREFIX}${username} has joined the party as ${sheet.name}, a ${raceWords(sheet)} ${classWords(sheet.class)}.${fallenHint}${backstoryHint} Introduce them into the scene at the next natural moment.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
