import { listTurnCorrections, listCorrectionsForTurns, listTurnQuality, recentTurnQuality } from "@/lib/db/turn-ledger";
import {
  CLEAN_RULE_TEXT,
  exportedTurns,
  narratorQualityExport,
  summarizeQuality,
  type ExportedTurn,
  type NarratorQualityExport,
  type QualityGroup,
} from "@/lib/narrator-quality";
import { currentBuild } from "@/lib/update-check";

// The server's half of narrator quality (issue #460): the rows read for
// Admin's card, the export file, and the report bundle's part. The rules are
// src/lib/narrator-quality.ts's; this only reads.

export type NarratorQualityOverview = {
  generatedAt: string;
  rule: string;
  turns: number;
  corrections: number;
  // Fixes to turns that ended before this server kept quality rows.
  earlierCorrections: number;
  groups: QualityGroup[];
};

export function narratorQualityOverview(): NarratorQualityOverview {
  const rows = listTurnQuality();
  const corrections = listTurnCorrections();
  const known = new Set(rows.map((row) => row.turnId));
  return {
    generatedAt: new Date().toISOString(),
    rule: CLEAN_RULE_TEXT,
    turns: rows.length,
    corrections: corrections.length,
    earlierCorrections: corrections.filter((correction) => !correction.turnId || !known.has(correction.turnId)).length,
    groups: summarizeQuality(rows, corrections),
  };
}

export function narratorQualityFile(): NarratorQualityExport {
  return narratorQualityExport({ rows: listTurnQuality(), corrections: listTurnCorrections(), version: currentBuild().label });
}

// How many of a table's newest turns the report bundle carries.
export const BUNDLE_QUALITY_TURNS = 20;

// One table's newest quality rows and their fixes, hashed and nameless.
export function bundleNarratorQuality(campaignId: string): ExportedTurn[] {
  const rows = recentTurnQuality(campaignId, BUNDLE_QUALITY_TURNS);
  return exportedTurns(rows, listCorrectionsForTurns(rows.map((row) => row.turnId)));
}
