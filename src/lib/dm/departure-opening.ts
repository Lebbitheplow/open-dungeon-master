import type { Campaign } from "@/lib/db/campaigns";
import { companionDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { listSheets } from "@/lib/db/sheets";
import { sheetStatBlock, sheetVitals } from "@/lib/dm/companion-statblock";
import { opensAt, readOdds, sideFitness, type IntentResponse, type OddsReading, type OpeningHook } from "@/lib/dm/departure-logic";
import { fightingParty } from "@/lib/dm/party-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The odds a lasting companion reads, and whether a plan it holds finds its
// opening now (issue 503 Phase 2). Kept apart from src/lib/dm/departure.ts,
// which acts on them, so the initiative floor (src/lib/dm/initiative-floor.ts)
// can ask on a companion's own turn without importing the conscience it
// would go round to.
//
// Must not import conscience.ts, departure.ts or encounter-tools.ts.

// The companion rated as a foe for the party (its sheet through the DMG's
// procedure, src/lib/dm/companion-statblock.ts), shifted by how whole each
// side is now: the party it would fight, and the companion. That party is
// the one every fight is measured against (party-budget.ts fightingParty,
// issue 563): the companions who would stand with it count, and the dead and
// a player's benched characters do not.
export function companionOdds(
  campaign: Campaign,
  companion: CharacterSheet,
  sheets: readonly CharacterSheet[] = listSheets(campaign.id),
): OddsReading {
  const party = fightingParty(campaign, [...sheets]).filter((sheet) => sheet.id !== companion.id);
  const levels = party.length ? party.map((sheet) => sheet.level) : [1];
  const { rating } = sheetStatBlock(companion, { open: true });
  return readOdds(levels, rating.cr, sideFitness(party.map(sheetVitals)), sideFitness([sheetVitals(companion)]));
}

// The plan this companion holds, when its opening is now (the caller says
// which moment it is: its own turn in a fight, a long rest, or the party
// splitting up): slipping away goes at any such moment, biding to strike
// only when the odds have turned its way, and never at a split. Null for
// anyone holding no plan.
export function intentOpensNow(
  campaign: Campaign,
  companion: CharacterSheet,
  sheets: readonly CharacterSheet[] = listSheets(campaign.id),
  hook: OpeningHook = "own_turn",
): IntentResponse | null {
  const npc = companionNpcFor(companion);
  const intent = npc ? companionDeparture(npc.id).intent : null;
  if (!intent) {
    return null;
  }
  return opensAt(intent.response, companionOdds(campaign, companion, sheets).odds, hook) ? intent.response : null;
}
