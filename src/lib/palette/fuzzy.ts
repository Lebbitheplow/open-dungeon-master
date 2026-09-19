// The command palette's matcher (src/components/CommandPalette.tsx). Pure, so
// scripts/test-palette-fuzzy.mjs drives it.
//
// A query is split into words and every word has to land somewhere in the
// command: in its label first, then in its group or keywords. A word lands
// either as a plain substring (best at the start of the label, next best at
// the start of a word) or, failing that, as letters in order ("lgr" finds
// "Long rest"), which scores lower so exact typing always wins.

export type Searchable = {
  label: string;
  group?: string;
  keywords?: readonly string[];
};

function isWordStart(text: string, index: number): boolean {
  return index === 0 || /[^a-z0-9]/.test(text[index - 1]);
}

// How well one word matches one text; null when it does not match at all.
export function fuzzyScore(word: string, text: string): number | null {
  const needle = word.trim().toLowerCase();
  const hay = text.toLowerCase();
  if (!needle) {
    return 0;
  }
  const at = hay.indexOf(needle);
  if (at >= 0) {
    // A later word start beats an earlier mid-word hit: "rest" should find
    // "Long rest" before "Forest".
    let best = at;
    let from = at;
    while (from >= 0 && !isWordStart(hay, from)) {
      from = hay.indexOf(needle, from + 1);
    }
    const wordStart = from >= 0;
    if (wordStart) {
      best = from;
    }
    return 100 + (best === 0 ? 60 : wordStart ? 30 : 0) - Math.min(best, 20) + Math.min(needle.length, 10);
  }
  // Letters in order. Runs and word starts are worth more than strays.
  let score = 0;
  let cursor = 0;
  let previous = -2;
  for (const char of needle) {
    const found = hay.indexOf(char, cursor);
    if (found < 0) {
      return null;
    }
    score += 2;
    if (found === previous + 1) score += 4;
    if (isWordStart(hay, found)) score += 6;
    score -= Math.min(found - cursor, 4);
    previous = found;
    cursor = found + 1;
  }
  return Math.max(score, 1);
}

// The whole query against one command; null when any word misses.
export function commandScore(query: string, command: Searchable): number | null {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return 0;
  }
  let total = 0;
  for (const word of words) {
    const inLabel = fuzzyScore(word, command.label);
    let best = inLabel === null ? null : inLabel * 2;
    for (const extra of [command.group ?? "", ...(command.keywords ?? [])]) {
      if (!extra) continue;
      const score = fuzzyScore(word, extra);
      if (score !== null && (best === null || score > best)) {
        best = score;
      }
    }
    if (best === null) {
      return null;
    }
    total += best;
  }
  return total;
}

// The commands that match, best first. With no query the host's own order
// stands; ties keep it too, so the list never reshuffles for no reason.
export function filterCommands<T extends Searchable>(query: string, commands: readonly T[]): T[] {
  if (!query.trim()) {
    return [...commands];
  }
  return commands
    .map((command, index) => ({ command, index, score: commandScore(query, command) }))
    .filter((row): row is { command: T; index: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.command);
}
