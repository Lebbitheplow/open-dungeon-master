// The pure half of the workshop's pick lists: the closed vocabularies that
// have no home elsewhere (languages, the usual senses, recharge triggers,
// feat prerequisites) and the two string edits a picker makes, appending a
// term to a comma-separated field and dropping a snippet into a body at the
// caret. No "@/" imports and no DOM, so scripts/test-tours.mjs can load it
// straight from disk.

// The SRD's standard and exotic languages, in the order a stat block
// prints them.
export const LANGUAGES = [
  "Common",
  "Dwarvish",
  "Elvish",
  "Giant",
  "Gnomish",
  "Goblin",
  "Halfling",
  "Orc",
  "Abyssal",
  "Celestial",
  "Draconic",
  "Deep Speech",
  "Infernal",
  "Primordial",
  "Sylvan",
  "Undercommon",
  "Thieves' cant",
  "Druidic",
  "telepathy 60 ft",
] as const;

// What a species' vision line usually says.
export const VISION_SUGGESTIONS = [
  "Darkvision 60 ft",
  "Darkvision 120 ft",
  "Superior darkvision 120 ft",
  "Blindsight 30 ft",
  "Tremorsense 30 ft",
  "Truesight 60 ft",
] as const;

// When a magic item's charges come back.
export const RECHARGE_TRIGGERS = ["dawn", "dusk", "short rest", "long rest", "never"] as const;

// The feat prerequisites the builder recognises by ability.
export const PREREQUISITE_SUGGESTIONS = [
  "Strength 13 or higher",
  "Dexterity 13 or higher",
  "Constitution 13 or higher",
  "Intelligence 13 or higher",
  "Wisdom 13 or higher",
  "Charisma 13 or higher",
  "Ability to cast at least one spell",
  "Proficiency with medium armor",
  "Proficiency with heavy armor",
  "4th level or higher",
] as const;

// Adds a term to a comma-separated field unless it is already in it. The
// comparison ignores case so "Insight" is not doubled by "insight".
export function appendTerm(current: string, term: string): string {
  const trimmed = term.trim();
  if (!trimmed) return current;
  const have = current
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (have.includes(trimmed.toLowerCase())) return current;
  const base = current.trim().replace(/,\s*$/, "");
  return base ? `${base}, ${trimmed}` : trimmed;
}

// Puts a snippet into text at a caret position, with a space on whichever
// side touches a word so "[[The Mill]]" never glues onto the previous one.
export function insertAt(text: string, at: number, snippet: string): { text: string; caret: number } {
  const index = Math.max(0, Math.min(at, text.length));
  const before = text.slice(0, index);
  const after = text.slice(index);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${snippet}${trail}`;
  return { text: `${before}${inserted}${after}`, caret: index + inserted.length };
}

// Appends a line to a multi-line body (a roll table's rows, a roster).
export function appendLine(text: string, line: string): string {
  const base = text.replace(/\s+$/, "");
  return base ? `${base}\n${line}` : line;
}

// Every distinct tag across a set of entries, sorted, for a tag picker.
export function collectTags(entries: ReadonlyArray<{ tags?: readonly string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      const key = tag.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, tag.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
