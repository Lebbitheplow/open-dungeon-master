// How a roll is worded wherever it is stored or shown: the detail the engine
// writes, the chronicle card, cinematic mode's toast and chronicle line. An
// attack or damage roll records its attacker, who goes in front, and its
// detail says what was used and against whom, so each creature is named
// once. Every other roll, and one stored before the attacker was recorded,
// keeps the sheet it concerns (characterId) in front, as it always has.
// Pure (type imports only), so client components and test scripts import it.

import type { StoredRoll } from "@/lib/db/rolls";

type Worded = Pick<StoredRoll, "kind" | "detail" | "attacker">;

// One target: "Club vs Aria".
export function rollAgainst(what: string, target: string): string {
  return `${what} vs ${target}`;
}

// An area's creatures, or what a fall lands on: "Fireball on Goblin 1, Goblin 2".
// An area that caught only creatures the table cannot see names none.
export function rollOn(what: string, targets: string[]): string {
  return targets.length ? `${what} on ${targets.join(", ")}` : what;
}

// Who made the roll: its attacker, else the sheet it concerns.
export function rollerName(roll: Pick<StoredRoll, "attacker">, sheetName: string | undefined): string | undefined {
  return roll.attacker ? roll.attacker.name : sheetName;
}

// A roll kind as the table reads it, on every card and in cinematic mode.
export const ROLL_KIND_LABELS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

// The chronicle card's line: "Goblin · Attack roll (Club vs Aria)".
export function rollCardLabel(roll: Worded, sheetName: string | undefined): string {
  const who = rollerName(roll, sheetName);
  const detail = roll.detail ? roll.detail.replaceAll("_", " ") : "";
  return `${who ? `${who} · ` : ""}${ROLL_KIND_LABELS[roll.kind] ?? "Roll"}${detail ? ` (${detail})` : ""}`;
}

// Cinematic mode's roll pill, up to the dice: "Goblin · Club vs Aria".
export function rollToastLead(roll: Worded & Pick<StoredRoll, "requestedBy">, sheetName: string | undefined): string {
  const who = rollerName(roll, sheetName);
  const what = roll.detail.trim() || ROLL_KIND_LABELS[roll.kind] || "Roll";
  return `${who ? `${who} · ` : roll.requestedBy === "dm" ? "The DM · " : ""}${what}`;
}

// Cinematic mode's chronicle line, up to the dice. A roll without an
// attacker keeps the reading it always had: its detail alone, which for a
// roll stored before the attacker was recorded still opens with the roller's
// name.
export function rollChronicleLead(roll: Worded, sheetName: string | undefined): string {
  const label = ROLL_KIND_LABELS[roll.kind] || "Roll";
  const detail = roll.detail.trim();
  if (roll.attacker) {
    return `${roll.attacker.name} · ${detail || label}`;
  }
  return detail || (sheetName ? `${sheetName} · ${label}` : label);
}
