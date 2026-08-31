// Shapes for the adjudication catalog: the declarative description of every
// action the engine can be asked to perform, whether the asker is the AI DM
// (through a tool call) or a person (through the DM console).
//
// The catalog describes ARGUMENTS FOR RENDERING, not validation. Every
// handler already parses its own arguments with zod and returns
// `{ error }` on bad input, and that stays the single source of truth; a
// second schema here would be exactly the drift the catalog exists to
// prevent. What the catalog adds is the console's form and a name list the
// guard test (scripts/test-invoke-catalog.mjs) checks against the tool
// lists the model is offered, so a tool added for the AI cannot silently
// stay missing from the human's console.
//
// Pure by design: no "@/" imports of anything with I/O, so the guard test
// can load it directly.

export type AdjudicationCategory =
  | "combat"
  | "party"
  | "world"
  | "social"
  | "story"
  | "table";

export const CATEGORY_LABELS: Record<AdjudicationCategory, string> = {
  combat: "Combat",
  party: "Party",
  world: "World",
  social: "Social",
  story: "Story",
  table: "Table",
};

// How the console renders one argument. "character" and "enemy" become
// pickers filled from live game state; the rest are ordinary inputs.
export type FieldKind =
  | "character"
  | "characters"
  | "enemy"
  | "text"
  | "longtext"
  | "number"
  | "boolean"
  | "select"
  | "dice";

export type CatalogField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
  // What a checkbox starts as. Booleans are off by default, which is right
  // for a flag like "forced" and wrong for one like "they can see it": the
  // engine reads an absent visionClear as darkness, so a console that
  // started it unticked would quietly stop drawing maps.
  default?: boolean;
  // One line under the input. Says what the server does with the value,
  // not what the value is.
  help?: string;
};

export type CatalogEntry = {
  // The tool name the engine dispatches on. Identical to the name the model
  // calls, which is the whole point: one engine, two callers.
  name: string;
  label: string;
  category: AdjudicationCategory;
  // One line for the console list. Written for a person running a table,
  // not for a model.
  summary: string;
  fields: CatalogField[];
  // Greyed out with a reason when no fight is running.
  needsEncounter?: boolean;
};

export function findAdjudication(
  entries: CatalogEntry[],
  name: string,
): CatalogEntry | null {
  const wanted = (name ?? "").trim();
  return entries.find((entry) => entry.name === wanted) ?? null;
}

// A pre-flight check for the console's form: required fields present,
// numbers actually numeric, selects within their options. The handler's own
// zod does the real validation; this exists so a person gets "Damage needs
// a target" instead of a generic parse failure.
export function checkArgs(
  entry: CatalogEntry,
  args: Record<string, unknown>,
): string | null {
  for (const field of entry.fields) {
    const value = args[field.name];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && missing) {
      return `${entry.label} needs ${field.label.toLowerCase()}.`;
    }
    if (missing) {
      continue;
    }
    if (field.kind === "number" && typeof value !== "number") {
      return `${field.label} must be a number.`;
    }
    if (field.kind === "boolean" && typeof value !== "boolean") {
      return `${field.label} must be true or false.`;
    }
    if (field.kind === "select" && field.options) {
      const allowed = field.options.map((option) => option.value);
      if (typeof value !== "string" || !allowed.includes(value)) {
        return `${field.label} must be one of: ${allowed.join(", ")}.`;
      }
    }
  }
  return null;
}
