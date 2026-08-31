// DM-authored random tables: rumours, wandering monsters, what is in the
// drawer. The oldest tool in the hobby, and the one thing a VTT is expected
// to have that ODM did not.
//
// The design goal is that a DM can paste a table out of a book or a blog and
// have it work. That means accepting the three shapes people actually write:
// numbered ranges ("1-5 A goblin patrol"), single numbers ("6. Nothing"), and
// bare lines with no numbers at all, which are numbered in order.
//
// Pure and dependency-free so scripts/test-roll-tables.mjs can import it.

export type RollTableEntry = {
  // Inclusive range of die results this row covers.
  min: number;
  max: number;
  text: string;
};

export const TABLE_NAME_MAX = 80;
export const TABLE_TEXT_MAX = 300;
export const TABLE_MAX_ENTRIES = 100;

// A leading "1-5", "1–5" (en dash, which is what a copied book gives you),
// "6", "6." or "6)" is a range; anything else is the whole line.
const RANGE = /^\s*(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*[).:\t ]\s*(.+)$/;

export function parseRollTable(raw: string): RollTableEntry[] {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: RollTableEntry[] = [];
  // Bare lines are numbered from wherever the numbered rows left off, so a
  // half-numbered paste still lands in the right order.
  let next = 1;
  for (const line of lines.slice(0, TABLE_MAX_ENTRIES)) {
    const match = RANGE.exec(line);
    if (match) {
      const min = Number(match[1]);
      const max = match[2] ? Number(match[2]) : min;
      entries.push({
        min: Math.min(min, max),
        max: Math.max(min, max),
        text: match[3].trim().slice(0, TABLE_TEXT_MAX),
      });
      next = Math.max(max, min) + 1;
      continue;
    }
    entries.push({ min: next, max: next, text: line.slice(0, TABLE_TEXT_MAX) });
    next += 1;
  }
  return entries.sort((a, b) => a.min - b.min || a.max - b.max);
}

// The die a table wants, from the highest result it covers. A 12-row table
// rolls d12; a 7-row table rolls d8 and can therefore have a gap, which
// tableGaps reports rather than hiding.
const DICE = [4, 6, 8, 10, 12, 20, 100];

export function dieForTable(entries: RollTableEntry[]): number {
  const highest = entries.reduce((max, entry) => Math.max(max, entry.max), 0);
  if (highest <= 0) {
    return 0;
  }
  return DICE.find((sides) => sides >= highest) ?? highest;
}

// Results the die can roll that no row covers, and rows that overlap. Both
// are shown to the DM as a warning rather than refused: a table with a hole
// in it is a real thing people write, and a roll that lands there simply
// reports nothing.
export function tableGaps(entries: RollTableEntry[]): {
  uncovered: number[];
  overlapping: number[];
} {
  const die = dieForTable(entries);
  const counts = new Map<number, number>();
  for (const entry of entries) {
    for (let value = entry.min; value <= entry.max; value += 1) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const uncovered: number[] = [];
  const overlapping: number[] = [];
  for (let value = 1; value <= die; value += 1) {
    const count = counts.get(value) ?? 0;
    if (count === 0) {
      uncovered.push(value);
    } else if (count > 1) {
      overlapping.push(value);
    }
  }
  return { uncovered, overlapping };
}

// The first row covering a result. Null when the roll fell in a gap.
export function entryForRoll(
  entries: RollTableEntry[],
  roll: number,
): RollTableEntry | null {
  return entries.find((entry) => roll >= entry.min && roll <= entry.max) ?? null;
}

// One line per row, which is what the editor shows and what parseRollTable
// reads back. A round trip through these two must be stable.
export function formatRollTable(entries: RollTableEntry[]): string {
  return entries
    .map((entry) =>
      entry.min === entry.max
        ? `${entry.min}. ${entry.text}`
        : `${entry.min}-${entry.max}. ${entry.text}`,
    )
    .join("\n");
}
