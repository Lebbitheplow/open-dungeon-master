// The lines the table reads when the server plays a creature's turn itself:
// the AI's backstop for the enemies a turn skipped (encounter-tools.ts
// autoActSkippedEnemies), a companion's turn it finishes (companionAutoAct),
// and a person's "run the monsters" (delegate.ts). Pure, so a suite reads
// every sentence without a fight.
//
// Issue #666: the turn note named four foes who act, and only two attack
// lines followed. An enemy that could not attack (out of reach, stunned,
// turned away by Sanctuary) passed with no line, and one that walked toward
// its target and still could not reach it moved across the board with no
// word. Every creature the note names now gets its line or a short reason,
// in the table's words, never the tool text written for the model.

// Why an attack the engine refused could not be made, tagged where the
// refusal is written (enemy-approach.ts, enemy-attack.ts) so this module
// never reads English back out of an error.
//   held: a character holds a readied action, so it does not walk in
//   fear: it will not walk closer to what it fears
//   reach / range / sight: still out of reach, out of range, or with no line
//     of sight once its movement was spent
//   target: this target cannot be attacked (charmed by them, Sanctuary,
//     Nature's Sanctuary, another plane, Antilife Shell): another may be
//   calmed: something holds it from attacking anyone (Calm Emotions, Turn
//     Undead, Fear's flight)
//   commanded: Command or Fear spends its turn on something else
export type AttackStop = "held" | "fear" | "reach" | "range" | "sight" | "target" | "calmed" | "commanded";

export const ATTACK_STOPS: readonly AttackStop[] = ["held", "fear", "reach", "range", "sight", "target", "calmed", "commanded"];

export function attackStopOf(value: unknown): AttackStop | null {
  return typeof value === "string" && (ATTACK_STOPS as readonly string[]).includes(value) ? (value as AttackStop) : null;
}

export type StandStill =
  | { why: "incapacitated"; by: string }
  | { why: "surprised" }
  | { why: "no_foe" }
  | { why: "reach" | "range" | "sight" | "fear"; target: string; closedIn: boolean }
  | { why: "held"; holder: string }
  | { why: "calmed"; by: string }
  // A sentence the rules already wrote for the table (Command's halt).
  | { why: "said"; line: string }
  // Every creature it could attack turned it away.
  | { why: "no_target" }
  | { why: "other" };

// One plain sentence for a creature that did not attack on its turn.
export function standStillLine(name: string, still: StandStill): string {
  switch (still.why) {
    case "incapacitated":
      return `${name} is ${still.by} and cannot act this turn.`;
    case "surprised":
      return `${name} is caught by surprise and does nothing this round.`;
    case "no_foe":
      return `${name} has no one left to fight.`;
    case "reach":
      return still.closedIn
        ? `${name} closes in on ${still.target} but cannot reach them this turn.`
        : `${name} cannot reach ${still.target} this turn.`;
    case "range":
      return still.closedIn
        ? `${name} moves for a shot at ${still.target} but is still out of range.`
        : `${name} cannot get ${still.target} within range this turn.`;
    case "sight":
      return still.closedIn
        ? `${name} moves but still has no clear line to ${still.target}.`
        : `${name} has no clear line to ${still.target} this turn.`;
    case "fear":
      return `${name} is too frightened to close in on ${still.target}.`;
    case "held":
      return `${name} does not close in while ${still.holder} holds a readied action.`;
    case "calmed":
      return `${name} is ${still.by} and makes no attack.`;
    case "said":
      return still.line;
    case "no_target":
      return `${name} finds no one it can attack this turn.`;
    case "other":
      return `${name} does not attack this turn.`;
  }
}

// The stand-still a refused attack's tag reads as.
export function stillFromStop(
  stop: AttackStop,
  detail: { target: string; closedIn: boolean; holder?: string; by?: string; line?: string },
): StandStill {
  switch (stop) {
    case "held":
      return { why: "held", holder: detail.holder ?? "someone" };
    case "fear":
    case "reach":
    case "range":
    case "sight":
      return { why: stop, target: detail.target, closedIn: detail.closedIn };
    case "calmed":
      return detail.by ? { why: "calmed", by: detail.by } : { why: "other" };
    case "commanded":
      return detail.line ? { why: "said", line: detail.line } : { why: "other" };
    case "target":
      return { why: "no_target" };
  }
}

// One swing as enemy_attack reports it.
export type SwingView = {
  attack?: unknown;
  rolled?: unknown;
  hit?: unknown;
  damage?: unknown;
  crit?: unknown;
  skipped?: unknown;
  missed?: unknown;
  duplicate?: unknown;
};

function swingWords(swing: SwingView, vsAc: unknown): string {
  if (typeof swing.skipped === "string") {
    return `${String(swing.attack ?? "an attack")} not made: ${swing.skipped}`;
  }
  if (typeof swing.missed === "string") {
    return `${String(swing.attack ?? "an attack")}: ${swing.missed}`;
  }
  if (swing.duplicate) {
    return `${String(swing.rolled)}: strikes a duplicate`;
  }
  return swing.hit
    ? `${String(swing.rolled)} vs AC ${String(vsAc)}: HIT for ${String(swing.damage)}${swing.crit ? " (CRIT)" : ""}`
    : `${String(swing.rolled)} vs AC ${String(vsAc)}: miss`;
}

// The line for an attack the engine resolved. With no swings (struck down on
// the way, an attack Among the Dead took away) the result's own note says
// what happened: the line used to read "X attacks Y with Z ()." and drop it.
export function attackLine(input: {
  name: string;
  target: string;
  attack: string;
  swings: SwingView[];
  vsAc: unknown;
  fell: boolean;
  note?: unknown;
}): string {
  if (!input.swings.length) {
    return typeof input.note === "string" && input.note.trim() ? input.note : `${input.name} does not attack this turn.`;
  }
  const summary = input.swings.map((swing) => swingWords(swing, input.vsAc)).join("; ");
  return `${input.name} attacks ${input.target} with ${input.attack} (${summary}).${input.fell ? ` ${input.target} falls!` : ""}`;
}

// How a creature is named in a line the whole table reads: one the GM keeps
// off the board is "someone unseen" there, as on the tracker and in the turn
// note (encounter-tools.ts owedNamesForTable).
export function tableName(name: string, hidden: boolean): string {
  return hidden ? "Someone unseen" : name;
}
