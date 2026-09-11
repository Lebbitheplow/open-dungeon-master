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

// The values a spell's timing fields take in the books. Offered beside the
// field so a new DM picks "1 bonus action" rather than inventing a spelling
// the engine will not recognise; anything else can still be typed.
export const CASTING_TIMES = [
  "1 action",
  "1 bonus action",
  "1 reaction",
  "1 minute",
  "10 minutes",
  "1 hour",
  "8 hours",
  "12 hours",
  "24 hours",
] as const;

export const SPELL_RANGES = [
  "Self",
  "Touch",
  "5 feet",
  "10 feet",
  "30 feet",
  "60 feet",
  "90 feet",
  "120 feet",
  "150 feet",
  "300 feet",
  "500 feet",
  "1 mile",
  "Sight",
  "Unlimited",
  "Self (15-foot cone)",
  "Self (30-foot radius)",
] as const;

export const SPELL_DURATIONS = [
  "Instantaneous",
  "1 round",
  "1 minute",
  "10 minutes",
  "1 hour",
  "8 hours",
  "24 hours",
  "7 days",
  "Until dispelled",
  "Concentration, up to 1 minute",
  "Concentration, up to 10 minutes",
  "Concentration, up to 1 hour",
  "Concentration, up to 8 hours",
] as const;

export const SPELL_COMPONENTS = ["V", "S", "M", "V, S", "V, M", "S, M", "V, S, M"] as const;

// The SRD's tool proficiencies, the closed list a background grants from.
export const TOOL_PROFICIENCIES = [
  "Alchemist's supplies",
  "Brewer's supplies",
  "Calligrapher's supplies",
  "Carpenter's tools",
  "Cartographer's tools",
  "Cobbler's tools",
  "Cook's utensils",
  "Glassblower's tools",
  "Jeweler's tools",
  "Leatherworker's tools",
  "Mason's tools",
  "Painter's supplies",
  "Potter's tools",
  "Smith's tools",
  "Tinker's tools",
  "Weaver's tools",
  "Woodcarver's tools",
  "Disguise kit",
  "Forgery kit",
  "Herbalism kit",
  "Navigator's tools",
  "Poisoner's kit",
  "Thieves' tools",
  "One type of gaming set",
  "One type of musical instrument",
  "One type of artisan's tools",
  "Vehicles (land)",
  "Vehicles (water)",
] as const;
