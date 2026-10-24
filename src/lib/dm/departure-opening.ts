import type { Campaign } from "@/lib/db/campaigns";
import { companionDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { listSheets } from "@/lib/db/sheets";
import { sheetStatBlock, sheetVitals } from "@/lib/dm/companion-statblock";
import { opensAt, readOdds, sideFitness, type IntentResponse, type OddsReading } from "@/lib/dm/departure-logic";
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
// side is now: the party's living player characters, and the companion.
export function companionOdds(
  campaign: Pick<Campaign, "id">,
  companion: CharacterSheet,
  sheets: readonly CharacterSheet[] = listSheets(campaign.id),
): OddsReading {
  const party = sheets.filter((sheet) => !sheet.isCompanion && !sheet.deathSaves?.dead);
  const levels = party.length ? party.map((sheet) => sheet.level) : [1];
  const { rating } = sheetStatBlock(companion, { open: true });
  return readOdds(levels, rating.cr, sideFitness(party.map(sheetVitals)), sideFitness([sheetVitals(companion)]));
}

// The plan this companion holds, when its opening is now (the caller says
// which moment it is: its own turn in a fight, or a long rest): slipping
// away goes at any such moment, biding to strike only when the odds have
// turned its way. Null for anyone holding no plan.
export function intentOpensNow(
  campaign: Pick<Campaign, "id">,
  companion: CharacterSheet,
  sheets: readonly CharacterSheet[] = listSheets(campaign.id),
): IntentResponse | null {
  const npc = companionNpcFor(companion);
  const intent = npc ? companionDeparture(npc.id).intent : null;
  if (!intent) {
    return null;
  }
  return opensAt(intent.response, companionOdds(campaign, companion, sheets).odds) ? intent.response : null;
}
