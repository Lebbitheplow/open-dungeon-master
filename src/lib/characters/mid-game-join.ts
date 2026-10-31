import type { MemberContext } from "@/lib/campaign-api";
import { JOIN_NOTE_PREFIX } from "@/lib/campaign-types";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { openJoinerBonds } from "@/lib/dm/party-bonds";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { classWords, raceWords } from "@/lib/sheet-words";

// A character arriving after the adventure started gets a table note so the
// DM writes them into the story on its next turn. Every door that seats a
// new hero calls it: one the builder made (POST /sheet) and a ready-made one
// (POST /sheet/pregen), which a player who joins a table in play can now
// take from the composer's gate. A hero who replaces one that fell
// (src/lib/characters/hero-door.ts) says so, so the GM brings them in as
// a new member of the party rather than a stranger with no reason to be there.
// It is also the one seam every door shares, so the hero's bonds open here.
// The note names the hero, not the player's account: the GM reads it, and an
// account name reached the story (#658, as #594 did for the fight notice).
export function announceMidGameJoin(context: MemberContext, sheet: CharacterSheet, replaces?: string) {
  // Whoever the party has met, this hero has a bond with (issue 657), in
  // the lobby as at a table in play: a companion who joined in the lobby
  // travels with them too. Bonds opened only at a first meeting, so a hero
  // who joined later had none with anyone the party already knew.
  if (openJoinerBonds(context.campaign, sheet)) {
    publishEphemeral(context.campaign.id, "relationships_updated", {});
  }
  if (context.campaign.status !== "active") {
    return;
  }
  const campaignId = context.campaign.id;
  const seq = allocateSeq(campaignId);
  const backstoryHint = sheet.backstory ? ` Their backstory: ${sheet.backstory.slice(0, 200)}` : "";
  const fallenHint = replaces ? `, taking the place of ${replaces}, who fell` : "";
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "system-party",
    content: `${JOIN_NOTE_PREFIX}${sheet.name}, a ${raceWords(sheet)} ${classWords(sheet.class)}, joins the party${fallenHint}.${backstoryHint} Introduce them into the scene at the next natural moment.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
