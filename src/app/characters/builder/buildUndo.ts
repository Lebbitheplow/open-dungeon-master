// One level of undo for build experiments (backlog F12). A change of class,
// race, subclass or level throws picks away (useBuilderState.ts changeClass,
// changeRace, reconcile.ts); the builder keeps the fields as they stood just
// before it, so "Put it back" returns the old choice and every pick that hung
// off it together. Pure, so scripts/test-builder-undo.mjs can read it.
import type { BuilderDraftFields, DroppedNotice } from "./useBuilderState";

export type UndoBecause = "class" | "race" | "subclass" | "level";

export type BuildUndo = {
  // A new number for every change kept, so the step it was made on can be
  // remembered against it (CharacterBuilder.tsx).
  id: number;
  because: UndoBecause;
  // The choice that was replaced and the one that replaced it, as the player
  // knows them: "Wizard", "Fighter", "level 5", "no subclass".
  from: string;
  to: string;
  // Every draft field as it stood before the change, and the notice of
  // dropped picks that was showing then.
  fields: BuilderDraftFields;
  dropped: DroppedNotice | null;
  // The draft fields right after the change, as JSON, once the change has
  // rendered: any later difference is another pick, which ends the undo.
  after: string | null;
};

const NOUN: Record<UndoBecause, string> = {
  class: "class",
  race: "ancestry",
  subclass: "subclass",
  level: "level",
};

// The line the bar shows and the live region says: what changed, and what
// "Put it back" brings back.
export function undoMessage(undo: Pick<BuildUndo, "because" | "from" | "to">): string {
  return `Changed ${NOUN[undo.because]} from ${undo.from} to ${undo.to}. Put it back to return to ${undo.from} with the picks that went with it.`;
}

// What the live region says once the old choice is back.
export function putBackMessage(undo: Pick<BuildUndo, "from">): string {
  return `Put back ${undo.from} and its picks.`;
}

// Whether the fields have moved since the change rendered: another pick in
// the new choice, which ends the undo (putting the old fields back then
// would throw that pick away unseen). `after` null is the change's own
// first render, which records where it left the fields.
export function undoOutcome(undo: BuildUndo, fieldsJson: string): "record" | "keep" | "clear" {
  if (undo.after === null) {
    return "record";
  }
  return undo.after === fieldsJson ? "keep" : "clear";
}
