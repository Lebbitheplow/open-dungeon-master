// The correction ledger's words (issue #460), shared by the server, which
// records a fix, and the table, which offers the reason chips once a fix is
// made. Pure and free of "@/" imports, so the browser bundle and the test
// scripts can both load it.

// Every fix a table makes to state an AI turn set. "dispute_overruled" is
// the issue's "upheld dispute": a player's objection the steerer (or the
// table's vote) agreed with, which the code calls overruling the ruling.
export const CORRECTION_KINDS = [
  "sheet_undo",
  "turn_revert",
  "sheet_edit",
  "enemy_hp",
  "initiative",
  "narration_edit",
  "renarrate",
  "retry",
  "dispute_overruled",
  "rollback",
] as const;

export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

// Direct: the fix names the turn (an audit row, a message, the turn itself).
// Inferred: tied to the most recent AI turn of the same fight, because the
// fix names only an enemy or a slot in the turn order.
export type CorrectionAttribution = "direct" | "inferred";

// The optional reason chip: one tap, after the fix, never before it.
export const CORRECTION_REASONS = ["wrong_rule", "wrong_number", "wrong_target", "story", "changed_mind"] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export const CORRECTION_REASON_LABELS: Readonly<Record<CorrectionReason, string>> = {
  wrong_rule: "Wrong rule",
  wrong_number: "Wrong number",
  wrong_target: "Wrong target",
  story: "Story",
  changed_mind: "Changed my mind",
};

// What a fix's answer carries back to the page: the ids of the rows it
// wrote, so the person who made it may add a reason. Absent when nothing
// was recorded (a table a person runs, a change the AI did not make).
export function correctionsField(ids: readonly string[]): { corrections?: string[] } {
  return ids.length ? { corrections: [...ids] } : {};
}
