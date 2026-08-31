import type { Campaign } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { isWorkshop, targetPartyLevels } from "@/lib/workshop/kind";

// The party every difficulty number is measured against, in one place.
//
// A campaign answers with its real roster. A workshop has no roster and
// answers with the stand-in party it declares (src/lib/workshop/kind.ts),
// which is the whole reason that declaration exists.
//
// This was worth extracting rather than repeating: before it, the prepared
// encounter readout fell back to a list of ONE level in a workshop, so every
// prepared fight there was costed against a solo adventurer and read far
// deadlier than it is. Two callers reading the same answer is how that stops
// happening again.
export function partyLevelsFor(campaign: Campaign): number[] {
  const sheets = listSheets(campaign.id)
    .filter((sheet) => !sheet.isCompanion)
    .map((sheet) => sheet.level);
  if (sheets.length) {
    return sheets;
  }
  if (isWorkshop(campaign)) {
    return targetPartyLevels(campaign.gameSettings.targetParty);
  }
  // A campaign whose players have not rolled up yet: one character at the
  // level the campaign starts at, which is what this has always answered.
  return [campaign.startingLevel];
}
