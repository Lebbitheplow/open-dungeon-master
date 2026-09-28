// How many Ability Score Improvements a character has taken, kept on the
// sheet itself as one story feature ("Ability Score Improvements taken: 2").
//
// A level-up folds an improvement straight into the scores, so the scores
// alone cannot say how many were taken. The count is what lets the server
// offer exactly what is owed: the improvements a class has earned at its
// level (src/lib/srd/asi.ts) less the ones taken. It is a feature because
// story features survive every regrant, every library sync and every edit,
// and because the player can read it.
//
// A sheet from before the ledger has none. It is read as having taken what
// the old table gave, one at character levels 4, 8, 12, 16 and 19, so a
// fighter or a rogue made earlier is owed the improvements the per-class
// table adds and nothing is handed out twice.
import type { SheetFeature } from "@/lib/schemas/sheet";
import { ASI_LEVELS, earnedAsiCountFor } from "@/lib/srd/asi";

const PREFIX = "Ability Score Improvements taken: ";
const PATTERN = /^ability score improvements taken:\s*(\d+)$/i;

export function isAsiLedger(feature: { name: string }): boolean {
  return PATTERN.test(feature.name.trim());
}

// The count on record, or null for a sheet from before the ledger.
export function readAsiLedger(features: Array<{ name: string }>): number | null {
  for (const feature of features) {
    const match = PATTERN.exec(feature.name.trim());
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

// What a sheet without a ledger is taken to have used, by character level.
export function legacyAsiTaken(level: number): number {
  return ASI_LEVELS.filter((threshold) => level >= threshold).length;
}

export function asiTaken(sheet: { level: number; features: Array<{ name: string }> }): number {
  return readAsiLedger(sheet.features) ?? legacyAsiTaken(sheet.level);
}

// Improvements this class list has earned and the sheet has not taken.
export function asiOwed(
  sheet: { level: number; features: Array<{ name: string }> },
  classes: Array<{ id: string; level: number }>,
): number {
  return Math.max(0, earnedAsiCountFor(classes) - asiTaken(sheet));
}

export function withAsiLedger(features: SheetFeature[], taken: number): SheetFeature[] {
  const count = Math.max(0, Math.floor(taken));
  return [
    ...features.filter((feature) => !isAsiLedger(feature)),
    { name: `${PREFIX}${count}`, source: "story" as const },
  ];
}
