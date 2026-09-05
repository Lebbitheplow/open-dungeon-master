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
  // A row that IS something rather than says something: another table to
  // roll on, a monster, an item, an NPC, a lore entry, all by name
  // (docs/workshop-parity-audit.md phase 14).
  ref?: RollTableRef;
};

export const ROLL_REF_KINDS = ["table", "monster", "item", "npc", "lore"] as const;
export type RollRefKind = (typeof ROLL_REF_KINDS)[number];
export type RollTableRef = { kind: RollRefKind; name: string };

export const TABLE_NAME_MAX = 80;
export const TABLE_TEXT_MAX = 300;
export const TABLE_MAX_ENTRIES = 100;

// A leading "1-5", "1–5" (en dash, which is what a copied book gives you),
// "6", "6." or "6)" is a range; anything else is the whole line.
const RANGE = /^\s*(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*[).:\t ]\s*(.+)$/;
// "x3 A goblin patrol" or "3x A goblin patrol": a bare row worth three
// results, which is how a weight is written when the ranges are not.
const WEIGHT = /^(?:x(\d{1,2})|(\d{1,2})x)\s+(.+)$/i;
// "@table: Gems", "@monster: wolf", "@item: Potion of Healing": a row that
// is a thing rather than a sentence.
const REF = /^@(table|monster|item|npc|lore)\s*:\s*(.+)$/i;

// The text of a row split into what it says and what it points at.
export function parseRowText(raw: string): { text: string; ref?: RollTableRef } {
  const match = REF.exec(raw.trim());
  if (!match) {
    return { text: raw.trim().slice(0, TABLE_TEXT_MAX) };
  }
  const name = match[2].trim().slice(0, TABLE_TEXT_MAX);
  return { text: name, ref: { kind: match[1].toLowerCase() as RollRefKind, name } };
}

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
        ...parseRowText(match[3]),
      });
      next = Math.max(max, min) + 1;
      continue;
    }
    const weighted = WEIGHT.exec(line);
    const weight = weighted ? Math.max(1, Number(weighted[1] ?? weighted[2])) : 1;
    entries.push({ min: next, max: next + weight - 1, ...parseRowText(weighted ? weighted[3] : line) });
    next += weight;
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
    .map((entry) => {
      const text = entry.ref ? `@${entry.ref.kind}: ${entry.ref.name}` : entry.text;
      return entry.min === entry.max ? `${entry.min}. ${text}` : `${entry.min}-${entry.max}. ${text}`;
    })
    .join("\n");
}

// ---- drawing without replacement ----
//
// A rumour the party has heard should not come up twice. A table that draws
// without replacement remembers the results it has handed out and picks
// among the rest; when nothing is left it says so, and the DM resets it.
// This is also what makes a table a deck of cards.

// The results the die can still land on: covered by a row, not yet drawn.
export function remainingResults(entries: RollTableEntry[], drawn: number[]): number[] {
  const die = dieForTable(entries);
  const taken = new Set(drawn);
  const out: number[] = [];
  for (let value = 1; value <= die; value += 1) {
    if (!taken.has(value) && entryForRoll(entries, value)) {
      out.push(value);
    }
  }
  return out;
}

// ---- nested tables ----
//
// A row that points at another table rolls it too, so "roll on Gems" is one
// press. Depth is capped and a table that points at itself stops after one
// pass, so a careless loop costs a line of output rather than the server.

export type RollStep = {
  table: string;
  die: number;
  total: number;
  entry: RollTableEntry | null;
};

export const MAX_NESTED_ROLLS = 4;

// Follows table references from a first result. `roll` is the die roller,
// so the server can hand in its real dice and a test a fixed one.
export function followTableRefs(
  first: RollStep,
  tables: Array<{ name: string; entries: RollTableEntry[] }>,
  roll: (sides: number) => number,
): RollStep[] {
  const chain: RollStep[] = [first];
  const visited = new Set<string>([first.table.toLowerCase()]);
  let current = first;
  while (chain.length < MAX_NESTED_ROLLS + 1) {
    const ref = current.entry?.ref;
    if (!ref || ref.kind !== "table") {
      break;
    }
    const wanted = ref.name.trim().toLowerCase();
    const next = tables.find((table) => table.name.trim().toLowerCase() === wanted);
    if (!next || visited.has(wanted)) {
      chain.push({ table: ref.name, die: 0, total: 0, entry: null });
      break;
    }
    visited.add(wanted);
    const die = dieForTable(next.entries);
    if (die < 1) {
      chain.push({ table: next.name, die: 0, total: 0, entry: null });
      break;
    }
    const total = roll(die);
    current = { table: next.name, die, total, entry: entryForRoll(next.entries, total) };
    chain.push(current);
  }
  return chain;
}

// One line per step, for the DM's readout.
export function describeRollChain(chain: RollStep[]): string[] {
  return chain.map((step) => {
    if (!step.die) {
      return `${step.table}: no such table to roll on.`;
    }
    const said = step.entry
      ? step.entry.ref && step.entry.ref.kind !== "table"
        ? `${step.entry.ref.kind}: ${step.entry.ref.name}`
        : step.entry.text
      : "nothing; that result is not on the table.";
    return `${step.table} (d${step.die}: ${step.total}): ${said}`;
  });
}
