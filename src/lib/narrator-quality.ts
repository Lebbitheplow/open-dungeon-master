import { createHash } from "node:crypto";
import type { CorrectionAttribution, CorrectionKind, CorrectionReason } from "./correction-reasons.ts";
import type { DmMode } from "./dm/viewer.ts";

// Narrator quality (issue #460): how each AI turn ended (turn_quality) and
// what the table fixed (turn_corrections), read as rates. Pure: no "@/"
// import and no database, so scripts/test-narrator-quality.mjs builds
// reports from plain rows, and the clean rule lives in one place.
//
// The rules:
// - A turn is clean when it finished, no tool call was refused (as invalid,
//   by the rules, or at a per-turn cap), the narration guard stayed quiet
//   (or had nothing to read), and nobody corrected it. It is worked out here,
//   when a report runs, and never stored, so a turn from an agent program
//   and one from a small local model are judged by the same rule, and a
//   changed rule re-scores old turns.
// - "Changed my mind" is left out of every rate: the AI was not wrong.
// - A rewind is recorded, but by default it does not make a turn unclean (it
//   can delete many turns for reasons that have nothing to do with the AI);
//   it is shown as its own count.
// - Rates are compared within one backend class and DM mode, never pooled:
//   the testers who send these lean towards people who know the rules.
// - It counts only mistakes someone noticed.

// What the narration guard (src/lib/dm/narration-guard.ts) did with a
// turn's prose: nothing to fix (quiet), fixed it (rewritten), or kept the
// prose because the rewrite came back too short, did not resolve it, or the
// call failed. "unread": the prose reader failed, so nothing was checked.
// "off": the table turned the outcome check off. "none": no narration to
// check, or the guard never ran (a turn that failed first).
export const GUARD_OUTCOMES = ["quiet", "rewritten", "kept_short", "kept_unresolved", "call_failed", "unread", "off", "none"] as const;
export type GuardOutcome = (typeof GUARD_OUTCOMES)[number];

// The contradiction kinds a guard found (src/lib/dm/engine-boundary.ts
// Contradiction), and "line" for a safety line crossed.
export type GuardKind = "hit" | "miss" | "death" | "number" | "spell" | "line";

export type GuardReport = { outcome: GuardOutcome; kinds: GuardKind[] };

// The split docs/configuration.md already uses: a backend on this machine
// or the network, a hosted API, or an agent program.
export type BackendClass = "local" | "api" | "agent";

export type QualityRow = {
  turnId: string;
  campaignId: string;
  dmMode: DmMode;
  backendClass: BackendClass | null;
  backend: string | null;
  model: string | null;
  status: "done" | "failed";
  modelCalls: number;
  toolCalls: number;
  refusedInvalid: number;
  refusedRules: number;
  refusedLimit: number;
  guard: GuardOutcome;
  guardKinds: GuardKind[];
  durationMs: number | null;
  rolledBack: boolean;
  createdAt: string;
};

export type LedgerCorrection = {
  turnId: string | null;
  kind: CorrectionKind;
  attribution: CorrectionAttribution;
  tool: string | null;
  reason: CorrectionReason | null;
  userId: string;
  createdAt: string;
};

export type CleanRule = { countRollback: boolean };
export const DEFAULT_CLEAN_RULE: CleanRule = { countRollback: false };

// The DM modes where a person runs the table: no fix there is recorded as
// the AI's (src/lib/db/turn-ledger.ts), so their turns show no corrections.
export function correctionsCounted(dmMode: DmMode): boolean {
  return !new Set<DmMode>(["human", "assisted"]).has(dmMode);
}

export function countsAgainst(correction: Pick<LedgerCorrection, "kind" | "reason">, rule: CleanRule = DEFAULT_CLEAN_RULE): boolean {
  if (correction.reason === "changed_mind") {
    return false;
  }
  return correction.kind !== "rollback" || rule.countRollback;
}

export function isClean(row: QualityRow, corrections: readonly LedgerCorrection[], rule: CleanRule = DEFAULT_CLEAN_RULE): boolean {
  return (
    row.status === "done" &&
    row.refusedInvalid === 0 &&
    row.refusedRules === 0 &&
    row.refusedLimit === 0 &&
    (row.guard === "quiet" || row.guard === "none") &&
    !(rule.countRollback && row.rolledBack) &&
    !corrections.some((correction) => countsAgainst(correction, rule))
  );
}

const GUARD_FIRED = new Set<GuardOutcome>(["rewritten", "kept_short", "kept_unresolved", "call_failed"]);
const GUARD_UNCHECKED = new Set<GuardOutcome>(["unread", "off"]);

export type QualityGroup = {
  backendClass: BackendClass | "unknown";
  dmMode: DmMode;
  turns: number;
  clean: number;
  // clean / turns, or null with no turns.
  cleanRate: number | null;
  failed: number;
  // Turns with a tool call refused as invalid or by the rules.
  refused: number;
  // Turns that hit a per-turn cap.
  capped: number;
  // Turns whose narration the guard had to act on.
  guardFired: number;
  // Turns the guard could not check: the reader failed, or it is off.
  unchecked: number;
  // Turns with a correction that counts.
  corrected: number;
  // Turns a rewind took, counted apart from the clean rate.
  rolledBack: number;
  // Fixes marked "changed my mind", left out of every rate.
  changedMind: number;
  // False where a person runs the table: no fix is recorded there.
  correctionsCounted: boolean;
  // The tools most often corrected in this group, most first.
  tools: Array<{ tool: string; corrections: number }>;
  kinds: Partial<Record<CorrectionKind, number>>;
};

export const TOP_TOOLS = 5;

function byTurn(corrections: readonly LedgerCorrection[]): Map<string, LedgerCorrection[]> {
  const map = new Map<string, LedgerCorrection[]>();
  for (const correction of corrections) {
    if (!correction.turnId) continue;
    const list = map.get(correction.turnId) ?? [];
    list.push(correction);
    map.set(correction.turnId, list);
  }
  return map;
}

// One group per backend class and DM mode, never pooled, the busiest first.
export function summarizeQuality(
  rows: readonly QualityRow[],
  corrections: readonly LedgerCorrection[],
  rule: CleanRule = DEFAULT_CLEAN_RULE,
): QualityGroup[] {
  const fixes = byTurn(corrections);
  const groups = new Map<string, QualityGroup & { toolCounts: Map<string, number> }>();
  for (const row of rows) {
    const backendClass = row.backendClass ?? "unknown";
    const key = `${backendClass}\u0000${row.dmMode}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        backendClass,
        dmMode: row.dmMode,
        turns: 0,
        clean: 0,
        cleanRate: null,
        failed: 0,
        refused: 0,
        capped: 0,
        guardFired: 0,
        unchecked: 0,
        corrected: 0,
        rolledBack: 0,
        changedMind: 0,
        correctionsCounted: correctionsCounted(row.dmMode),
        tools: [],
        kinds: {},
        toolCounts: new Map(),
      };
      groups.set(key, group);
    }
    const own = fixes.get(row.turnId) ?? [];
    group.turns += 1;
    if (isClean(row, own, rule)) group.clean += 1;
    if (row.status === "failed") group.failed += 1;
    if (row.refusedInvalid || row.refusedRules) group.refused += 1;
    if (row.refusedLimit) group.capped += 1;
    if (GUARD_FIRED.has(row.guard)) group.guardFired += 1;
    if (GUARD_UNCHECKED.has(row.guard)) group.unchecked += 1;
    if (row.rolledBack || own.some((correction) => correction.kind === "rollback")) group.rolledBack += 1;
    const counted = own.filter((correction) => countsAgainst(correction, rule));
    if (counted.length) group.corrected += 1;
    group.changedMind += own.filter((correction) => correction.reason === "changed_mind").length;
    for (const correction of counted) {
      group.kinds[correction.kind] = (group.kinds[correction.kind] ?? 0) + 1;
      const tool = correction.tool ?? "(no tool named)";
      group.toolCounts.set(tool, (group.toolCounts.get(tool) ?? 0) + 1);
    }
  }
  return [...groups.values()]
    .map(({ toolCounts, ...group }) => ({
      ...group,
      cleanRate: group.turns ? group.clean / group.turns : null,
      tools: [...toolCounts]
        .map(([tool, count]) => ({ tool, corrections: count }))
        .sort((a, b) => b.corrections - a.corrections || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0))
        .slice(0, TOP_TOOLS),
    }))
    .sort((a, b) => b.turns - a.turns || (a.backendClass < b.backendClass ? -1 : 1) || (a.dmMode < b.dmMode ? -1 : 1));
}

// ---- what leaves the server ----

// An id as the export and the report bundle carry it: the same id always
// gives the same hash, so rows that belong together still match, and the
// hash names no row anyone else can look up.
export function hashId(id: string): string {
  return createHash("sha256").update(`odm-narrator-quality:${id}`).digest("hex").slice(0, 16);
}

export type ExportedCorrection = {
  kind: CorrectionKind;
  attribution: CorrectionAttribution;
  tool: string | null;
  reason: CorrectionReason | null;
  by: string;
  at: string;
};

export type ExportedTurn = {
  turn: string;
  campaign: string;
  at: string;
  dmMode: DmMode;
  backendClass: BackendClass | null;
  backend: string | null;
  model: string | null;
  status: "done" | "failed";
  modelCalls: number;
  toolCalls: number;
  refused: { invalid: number; rules: number; limit: number };
  guard: GuardOutcome;
  guardKinds: GuardKind[];
  durationMs: number | null;
  rolledBack: boolean;
  // Worked out by the rule the file names, for a reader without a script.
  clean: boolean;
  corrections: ExportedCorrection[];
};

function exportedCorrection(correction: LedgerCorrection): ExportedCorrection {
  return {
    kind: correction.kind,
    attribution: correction.attribution,
    tool: correction.tool,
    reason: correction.reason,
    by: hashId(correction.userId),
    at: correction.createdAt,
  };
}

// One turn and its fixes, with every id hashed and no name, prompt or
// narration: the shape both the export and the report bundle carry.
export function exportedTurns(
  rows: readonly QualityRow[],
  corrections: readonly LedgerCorrection[],
  rule: CleanRule = DEFAULT_CLEAN_RULE,
): ExportedTurn[] {
  const fixes = byTurn(corrections);
  return rows.map((row) => {
    const own = fixes.get(row.turnId) ?? [];
    return {
      turn: hashId(row.turnId),
      campaign: hashId(row.campaignId),
      at: row.createdAt,
      dmMode: row.dmMode,
      backendClass: row.backendClass,
      backend: row.backend,
      model: row.model,
      status: row.status,
      modelCalls: row.modelCalls,
      toolCalls: row.toolCalls,
      refused: { invalid: row.refusedInvalid, rules: row.refusedRules, limit: row.refusedLimit },
      guard: row.guard,
      guardKinds: [...row.guardKinds],
      durationMs: row.durationMs,
      rolledBack: row.rolledBack,
      clean: isClean(row, own, rule),
      corrections: own.map(exportedCorrection),
    };
  });
}

export const NARRATOR_QUALITY_FORMAT = 1;

export type NarratorQualityExport = {
  kind: "odm-narrator-quality";
  format: typeof NARRATOR_QUALITY_FORMAT;
  createdAt: string;
  version: string;
  rule: string;
  groups: QualityGroup[];
  turns: ExportedTurn[];
  // Fixes to turns that ended before this server kept quality rows.
  earlierCorrections: Array<ExportedCorrection & { turn: string | null; campaign: string }>;
};

export const CLEAN_RULE_TEXT =
  "A turn is clean when it finished, no tool call was refused (invalid, by the rules, or at a cap), the narration guard stayed quiet or had nothing to read, and nobody corrected it. \"Changed my mind\" never counts; a rewind is counted apart.";

export function narratorQualityExport(input: {
  rows: readonly QualityRow[];
  corrections: ReadonlyArray<LedgerCorrection & { campaignId: string }>;
  version: string;
  now?: Date;
}): NarratorQualityExport {
  const known = new Set(input.rows.map((row) => row.turnId));
  return {
    kind: "odm-narrator-quality",
    format: NARRATOR_QUALITY_FORMAT,
    createdAt: (input.now ?? new Date()).toISOString(),
    version: input.version,
    rule: CLEAN_RULE_TEXT,
    groups: summarizeQuality(input.rows, input.corrections),
    turns: exportedTurns(input.rows, input.corrections),
    earlierCorrections: input.corrections
      .filter((correction) => !correction.turnId || !known.has(correction.turnId))
      .map((correction) => ({
        ...exportedCorrection(correction),
        turn: correction.turnId ? hashId(correction.turnId) : null,
        campaign: hashId(correction.campaignId),
      })),
  };
}
