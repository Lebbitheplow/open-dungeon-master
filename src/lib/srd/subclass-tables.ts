// Subclasses the bundled tables do not carry, as tables the feature grants
// can read: a workshop subclass (homebrew_entries kind "archetype", its
// features by level as { n, d }) and a content-pack archetype written as
// prose ("##### Roar of Defiance / Beginning at 3rd level, ..."). Without
// these a character who took one got the base class's features and none of
// the subclass's (src/lib/srd/features.ts classFeaturesFor), and a workshop
// copy of a published subclass started with no features at all.
//
// They reach the grants as `extras`, per table: a homebrew subclass is its
// author's, so two DMs' "Oath of Ash" never share features (the server
// builds them for whoever runs the table, src/lib/characters/
// subclass-extras.ts; the builder from the rows it fetched). Pure.

export type SubclassFeatureRow = { n: string; d: string };

export type ExtraSubclass = {
  name: string;
  levels: Record<string, SubclassFeatureRow[]>;
  // Always-prepared spells by class level (a domain's, an oath's).
  spells?: Record<string, string[]>;
  source: "homebrew" | "pack";
};

// By class id.
export type SubclassExtras = Record<string, ExtraSubclass[]>;

const ORDINAL = /\b(?:at|beginning at|starting at|when you reach|by|upon reaching|once you reach)\s+(\d{1,2})(?:st|nd|rd|th)\s+level/i;
const LEVEL_ANYWHERE = /\b(\d{1,2})(?:st|nd|rd|th)[- ]level\b/i;

// The features a prose archetype prints under its "#####" headings, each at
// the first level its text names (the class's subclass level when it names
// none). The text kept is the feature's own paragraph, trimmed.
export function subclassLevelsFromProse(desc: string, defaultLevel = 3): Record<string, SubclassFeatureRow[]> {
  const levels: Record<string, SubclassFeatureRow[]> = {};
  // "##### Roar of Defiance", "#####Hellish Aspect" and " ##### Bloodletting
  // Focus" are all headings in the pack's markdown.
  const parts = String(desc ?? "").split(/^\s*#{3,6}\s*/m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const name = head.replace(/[*_]/g, "").trim().slice(0, 80);
    const body = rest.join("\n").replace(/\s+/g, " ").trim();
    if (!name || !body) {
      continue;
    }
    const found = ORDINAL.exec(body) ?? LEVEL_ANYWHERE.exec(body);
    const level = found ? Math.min(20, Math.max(1, Number(found[1]))) : defaultLevel;
    (levels[String(level)] ??= []).push({ n: name, d: body.slice(0, 500) });
  }
  return levels;
}

type Row = { name: string; source: string; data: Record<string, unknown> };

function homebrewLevels(raw: unknown): Record<string, SubclassFeatureRow[]> {
  const out: Record<string, SubclassFeatureRow[]> = {};
  for (const [level, rows] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const features = rows
      .map((row) => ({ n: String((row as SubclassFeatureRow)?.n ?? "").trim(), d: String((row as SubclassFeatureRow)?.d ?? "") }))
      .filter((row) => row.n);
    if (features.length) {
      out[level] = features;
    }
  }
  return out;
}

function spellLevels(raw: unknown): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const [level, names] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const list = Array.isArray(names) ? names.map((name) => String(name).trim()).filter(Boolean) : [];
    if (list.length) {
      out[level] = list;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// One fetched archetype row as a table, or null when it says nothing a
// grant could use.
export function extraSubclassOf(row: Row, defaultLevel = 3): ExtraSubclass | null {
  const homebrew = row.source === "homebrew";
  const levels = homebrew ? homebrewLevels(row.data.levels) : subclassLevelsFromProse(String(row.data.desc ?? ""), defaultLevel);
  const spells = homebrew ? spellLevels(row.data.spells) : undefined;
  if (!Object.keys(levels).length && !spells) {
    return null;
  }
  return { name: row.name, levels, ...(spells ? { spells } : {}), source: homebrew ? "homebrew" : "pack" };
}

// Rows of one class, the homebrew first so a workshop subclass named like a
// pack one is the table's.
export function subclassExtrasFrom(classId: string, rows: Row[], defaultLevel = 3): SubclassExtras {
  const ordered = [...rows.filter((row) => row.source === "homebrew"), ...rows.filter((row) => row.source !== "homebrew")];
  const tables = ordered.map((row) => extraSubclassOf(row, defaultLevel)).filter((table): table is ExtraSubclass => table !== null);
  return tables.length ? { [classId]: tables } : {};
}

export function mergeExtras(...sets: SubclassExtras[]): SubclassExtras {
  const out: SubclassExtras = {};
  for (const set of sets) {
    for (const [classId, tables] of Object.entries(set)) {
      out[classId] = [...(out[classId] ?? []), ...tables];
    }
  }
  return out;
}
