// Argument normalizers for model-supplied tool calls: an ability written as
// its rules name ("Wisdom", "DEX save") reaches its id, and a boolean sent as
// a string is the boolean it names. A fixed choice's other values are not
// guessed from words: its z.enum refuses them, and the refusal lists the
// values (src/lib/dm/tool-errors.ts invalidArguments), which reads the same at
// every table language. Pure and dependency-free for the test suite.

const ABILITY_NAMES: Record<string, string> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

// "Wisdom" / "wis." / "DEX save" -> the three-letter id. Only genuine
// prefixes of the full ability name map ("charm" stays "charm").
export function normalizeAbility(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase().replace(/[^a-z]/g, " ").trim();
  const first = cleaned.split(/\s+/)[0] ?? "";
  for (const [id, full] of Object.entries(ABILITY_NAMES)) {
    if (first === id || (first.length >= 3 && full.startsWith(first))) {
      return id;
    }
  }
  return value;
}

// The strings "true" and "false" a model sometimes sends for a boolean
// argument, turned into the booleans they mean before any schema reads them.
// A tool's z.coerce.boolean() reads every non-empty string as true, so
// useInspiration: "false" spent the Inspiration it was told to keep. Only a
// top-level value that is exactly one of the two words is touched: no text
// argument of any tool is ever the bare word, and anything that is not a JSON
// object is handed back as it came for the handler to refuse.
export function strictBooleanArgs(rawArguments: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || "{}");
  } catch {
    return rawArguments;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return rawArguments;
  }
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const word = typeof value === "string" ? value.trim().toLowerCase() : null;
    if (word === "true" || word === "false") {
      out[key] = word === "true";
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return changed ? JSON.stringify(out) : rawArguments;
}
