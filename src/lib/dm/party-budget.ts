import type { Campaign } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { fieldedSheets } from "@/lib/dm/roster";
import { sheetFoeIds, turnedFoes } from "@/lib/dm/sheet-foes";
import type { ResolvedEnemyRequest } from "@/lib/dm/encounter-spawn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { encounterCeiling, evaluateEncounter, type EncounterEvaluation } from "@/lib/srd/encounter-math";
import { isWorkshop, targetPartyLevels } from "@/lib/workshop/kind";
import { ceilingHoldsCompanion, settingOf } from "@/lib/dm/conscience-logic";

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
// happening again. Issue 520 found the same split once more: the readout
// left companions out while start_encounter counted them, and
// start_encounter counted the dead and a player's benched characters, so a
// fight the readout called deadly ran and one it passed was refused.

// The characters a fight is measured against: the ones in play (a player
// with several fights with the one at the table), alive, and on the party's
// side (a companion that turned on it is a foe). Companions with the party
// count: they fight beside it.
export function fightingParty(campaign: Campaign, sheets: CharacterSheet[] = listSheets(campaign.id)): CharacterSheet[] {
  const against = sheetFoeIds(turnedFoes(campaign.id));
  return fieldedSheets(campaign, sheets).filter((sheet) => !sheet.deathSaves?.dead && !against.has(sheet.id));
}

export function partyLevelsFor(campaign: Campaign): number[] {
  const sheets = fightingParty(campaign).map((sheet) => sheet.level);
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

// The most combatants a fight takes.
export const MAX_COMBATANTS = 8;

export type RosterBudget = {
  evaluation: EncounterEvaluation;
  // The adjusted XP the table's difficulty allows, and what the roster
  // spends of it. A companion that fights the party where the table chose
  // Turn, turned on the spot or come back for it, is never held to the
  // ceiling; only what is added beside it answers to it (conscience-logic.ts
  // ceilingHoldsCompanion, issue 563).
  ceiling: number;
  stagedXp: number;
  tooMany: boolean;
  tooDeadly: boolean;
};

// start_encounter's two rails for a resolved roster against these levels:
// no more than MAX_COMBATANTS, and no more adjusted XP than the table's
// difficulty allows. The fight itself, the prep readout and a prepared
// fight scaled to the party all ask here.
export function rosterBudget(campaign: Pick<Campaign, "difficulty" | "gameSettings">, partyLevels: number[], resolved: Array<Pick<ResolvedEnemyRequest, "stats" | "sheetFoe">>): RosterBudget {
  const evaluation = evaluateEncounter(partyLevels, resolved.map((entry) => entry.stats.cr));
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  const companionsWhole = !ceilingHoldsCompanion(settingOf(campaign.gameSettings));
  const staged = resolved.filter((entry) => !(entry.sheetFoe?.kind === "turned" || (entry.sheetFoe?.kind === "returning" && companionsWhole)));
  const stagedXp = staged.length === resolved.length ? evaluation.adjustedXp : evaluateEncounter(partyLevels, staged.map((entry) => entry.stats.cr)).adjustedXp;
  return { evaluation, ceiling, stagedXp, tooMany: resolved.length > MAX_COMBATANTS, tooDeadly: stagedXp > ceiling };
}
