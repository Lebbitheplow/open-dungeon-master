// Pure logic for chapter rewind: snapshot row serialization and the
// warning summary shown before a rollback is confirmed. No DB access and no
// "@/" imports so scripts/test-rollback-logic.mjs can load it directly; the
// impure rim is src/lib/db/snapshots.ts + src/lib/dm/rollback.ts.

// Tables captured wholesale at each chapter boundary and restored on rewind.
// Order matters on restore: parents before children so the FK cascade of the
// preceding delete pass never fires against fresh rows.
export const SNAPSHOT_TABLES = [
  "character_sheets",
  "npcs",
  "locations",
  "world_facts",
  "encounters",
  "encounter_enemies",
  "battle_maps",
  "battle_tokens",
  "battle_explored",
  "overworld_maps",
] as const;
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

// battle_explored has no campaign_id column; it is captured and deleted
// through its battle_maps parent.
export const MAP_SCOPED_TABLES: ReadonlySet<string> = new Set(["battle_explored"]);

// Embedding BLOBs are dropped from snapshots: they are bulky and the
// semantic index refills missing vectors lazily.
export const STRIPPED_COLUMNS: ReadonlySet<string> = new Set(["embedding"]);

// campaigns columns that hold in-place world state; restored on rewind.
export const CAMPAIGN_SNAPSHOT_COLUMNS = [
  "scene",
  "quest_log_json",
  "story_summary",
  "story_summary_count",
  "dm_outline",
  "floor_json",
  "story_arc_json",
  "world_tick_json",
  "last_recap_seq",
] as const;

export type SnapshotRow = Record<string, unknown>;

export type SnapshotPayload = {
  capturedAt: string;
  campaign: SnapshotRow;
  tables: Record<string, SnapshotRow[]>;
  // Lead-owned lore/rules text does not rewind; only the prompt-facing
  // flags are restored for entries that still exist.
  loreFlags: Array<{ id: string; pinned: number }>;
  ruleFlags: Array<{ id: string; enabled: number; pinned: number }>;
};

// SQLite BLOBs come back as Buffers, which JSON cannot round-trip natively.
// They are wrapped as {__blob: base64}; everything else passes through.
export function serializeRow(row: SnapshotRow): SnapshotRow {
  const out: SnapshotRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (STRIPPED_COLUMNS.has(key)) {
      out[key] = null;
    } else if (value instanceof Uint8Array) {
      out[key] = { __blob: Buffer.from(value).toString("base64") };
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function reviveRow(row: SnapshotRow): SnapshotRow {
  const out: SnapshotRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { __blob?: unknown }).__blob === "string"
    ) {
      out[key] = Buffer.from((value as { __blob: string }).__blob, "base64");
    } else {
      out[key] = value;
    }
  }
  return out;
}

export type RollbackScope = {
  targetChapterIndex: number;
  boundarySeq: number;
  messagesToDelete: number;
  chaptersToDelete: number;
  activeEncounter: boolean;
  inFlightTurn: boolean;
  pendingRolls: number;
  pendingProposals: number;
  sheetsToRemove: string[];
};

// Human summary for the confirm dialog; empty means nothing beyond the
// ordinary "messages will be deleted" baseline is at stake.
export function rollbackWarnings(scope: RollbackScope): string[] {
  const warnings: string[] = [];
  if (scope.messagesToDelete > 0) {
    warnings.push(
      `${scope.messagesToDelete} message${scope.messagesToDelete === 1 ? "" : "s"} after the chapter ${scope.targetChapterIndex} boundary will be deleted.`,
    );
  }
  if (scope.chaptersToDelete > 0) {
    warnings.push(
      `${scope.chaptersToDelete} later chapter${scope.chaptersToDelete === 1 ? "" : "s"} will be deleted along with their summaries.`,
    );
  }
  if (scope.activeEncounter) {
    warnings.push("The active combat encounter will be discarded.");
  }
  if (scope.inFlightTurn) {
    warnings.push("A DM turn is in progress; it will be cancelled.");
  }
  if (scope.pendingRolls > 0) {
    warnings.push("Pending dice rolls will be cancelled.");
  }
  if (scope.pendingProposals > 0) {
    warnings.push("Pending item offers will be discarded.");
  }
  for (const name of scope.sheetsToRemove) {
    warnings.push(
      `${name} joined after this point and will be removed from the campaign.`,
    );
  }
  return warnings;
}
