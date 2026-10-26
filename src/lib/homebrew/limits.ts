import { CLASS_LIST_LIMITS, FEATURE_LIMITS, SUBCLASS_SPELLS_PER_LEVEL, levelOfKey } from "@/lib/homebrew/class-data";
import { RACE_LIMITS } from "@/lib/homebrew/race-data";
import { BACKGROUND_LIMITS } from "@/lib/homebrew/background-data";
import { GEAR_LIMITS } from "@/lib/homebrew/item-data";
import { HOMEBREW_NAME_MAX, type HomebrewKind } from "@/lib/schemas/homebrew";

// The lists and texts a homebrew entry holds more of than it keeps, each
// named by its field. The normalizers cut to these sizes without a word,
// which a campaign import, a rename carried to other entries and the rules
// comparison all rely on; a save is different, because whoever wrote the
// ninth feature at a level means it. So the routes refuse an entry with a
// problem here (src/app/api/homebrew), and the editor says the same before
// it is sent (src/app/workshop/homebrew/draft.ts). Pure.

export type LimitProblem = { field: string; text: string };

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const count = (value: number) => value.toLocaleString("en-US");
// A long name, shortened to say which one is meant.
const quoted = (name: string) => `"${name.length > 40 ? `${name.slice(0, 40)}...` : name}"`;

// The entries of a list once blanks are dropped and repeats folded, as the
// normalizers read them.
function distinct(value: unknown, length: number): string[] {
  return Array.isArray(value) ? [...new Set(value.map((entry) => String(entry ?? "").trim().slice(0, length)).filter(Boolean))] : [];
}

// The named features at each level of a class's or a subclass's table, as
// the normalizers merge them: "3" and "3.0" are one level, and a row with no
// name is not a feature.
export function featureCounts(levels: unknown): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, rows] of Object.entries(record(levels))) {
    const level = levelOfKey(key);
    if (level === null || !Array.isArray(rows)) continue;
    const named = rows.filter((row) => String(record(row).n ?? "").trim()).length;
    if (named) out.set(level, (out.get(level) ?? 0) + named);
  }
  return out;
}

function featureProblems(levels: unknown): LimitProblem[] {
  const out: LimitProblem[] = [];
  for (const [level, features] of [...featureCounts(levels)].sort(([a], [b]) => a - b)) {
    if (features > FEATURE_LIMITS.perLevel) {
      out.push({
        field: `levels.${level}`,
        text: `Level ${level} has ${features} features, and a level keeps ${FEATURE_LIMITS.perLevel} at most. Move one to another level or fold two into one.`,
      });
    }
  }
  // The editor holds a name and its words to these as they are typed; an
  // entry sent another way is told which feature is too long.
  for (const [key, rows] of Object.entries(record(levels))) {
    const level = levelOfKey(key);
    if (level === null || !Array.isArray(rows)) continue;
    for (const row of rows) {
      const name = String(record(row).n ?? "").trim();
      const words = String(record(row).d ?? "").trim();
      if (name.length > FEATURE_LIMITS.name) {
        out.push({ field: `levels.${level}`, text: `${quoted(name)} at level ${level} is a name of ${name.length} letters, and a feature's name keeps ${FEATURE_LIMITS.name} at most.` });
      }
      if (name && words.length > FEATURE_LIMITS.text) {
        out.push({ field: `levels.${level}`, text: `${quoted(name)} at level ${level} runs to ${count(words.length)} characters, and a feature's words keep ${count(FEATURE_LIMITS.text)} at most. Shorten them.` });
      }
    }
  }
  return out;
}

// A subclass's always-prepared spells: six at a level, each named whole.
function spellProblems(spells: unknown): LimitProblem[] {
  const out: LimitProblem[] = [];
  const byLevel = new Map<number, Set<string>>();
  for (const [key, names] of Object.entries(record(spells))) {
    const level = levelOfKey(key);
    if (level === null || !Array.isArray(names)) continue;
    for (const entry of names) {
      const name = typeof entry === "string" ? entry.trim() : "";
      if (!name) continue;
      if (name.length > HOMEBREW_NAME_MAX) {
        out.push({ field: `spells.${level}`, text: `${quoted(name)} at level ${level} is a spell name of ${name.length} letters, and a name keeps ${HOMEBREW_NAME_MAX} at most.` });
      }
      (byLevel.get(level) ?? byLevel.set(level, new Set()).get(level)!).add(name.slice(0, HOMEBREW_NAME_MAX));
    }
  }
  for (const [level, held] of [...byLevel].sort(([a], [b]) => a - b)) {
    if (held.size > SUBCLASS_SPELLS_PER_LEVEL) {
      out.push({
        field: `spells.${level}`,
        text: `Level ${level} has ${held.size} always-prepared spells, and a level keeps ${SUBCLASS_SPELLS_PER_LEVEL} at most. Move one to another level.`,
      });
    }
  }
  return out;
}

// Every list or text of this entry over what its kind keeps, in the order
// the editor shows the fields. Empty when the save keeps it whole.
export function homebrewLimitProblems(kind: HomebrewKind, raw: unknown): LimitProblem[] {
  const data = record(raw);
  const out: LimitProblem[] = [];
  if (kind === "class") {
    const tools = distinct(data.tools, 60).length;
    if (tools > CLASS_LIST_LIMITS.tools) {
      out.push({ field: "tools", text: `The class names ${tools} tools, and a class keeps ${CLASS_LIST_LIMITS.tools} at most. Remove one.` });
    }
    const weapons = distinct(data.weapons, 60).length;
    if (weapons > CLASS_LIST_LIMITS.weapons) {
      out.push({ field: "weapons", text: `The class names ${weapons} weapons, and a class keeps ${CLASS_LIST_LIMITS.weapons} at most: tick simple or martial instead of naming each.` });
    }
    out.push(...featureProblems(data.levels));
  }
  if (kind === "archetype") {
    out.push(...featureProblems(data.levels), ...spellProblems(data.spells));
  }
  if (kind === "race") {
    const skills = distinct(data.skills, 30).length;
    if (skills > RACE_LIMITS.skills) {
      out.push({ field: "skills", text: `The species grants ${skills} skills, and a species keeps ${RACE_LIMITS.skills} at most. Untick one.` });
    }
    const traits = typeof data.traits === "string" ? data.traits.trim().length : 0;
    if (traits > RACE_LIMITS.traits) {
      out.push({ field: "traits", text: `The traits run to ${count(traits)} characters, and a species keeps ${count(RACE_LIMITS.traits)} at most. Shorten them.` });
    }
  }
  if (kind === "background") {
    const grants = record(data.grants);
    const skills = distinct(grants.skills, 40).length;
    if (skills > BACKGROUND_LIMITS.skills) {
      out.push({ field: "grants.skills", text: `The background grants ${skills} skills, and a background keeps ${BACKGROUND_LIMITS.skills} at most. Untick one.` });
    }
    const kit = Array.isArray(grants.equipment) ? grants.equipment.filter((line) => typeof line === "string" && line.trim()).length : 0;
    if (kit > BACKGROUND_LIMITS.kit) {
      out.push({ field: "grants.equipment", text: `The starting kit holds ${kit} items, and a kit keeps ${BACKGROUND_LIMITS.kit} at most. Remove some.` });
    }
  }
  // Every kind's description, which "Start from the books" copies whole.
  const desc = typeof data.desc === "string" ? data.desc.trim().length : 0;
  if (desc > GEAR_LIMITS.descMax) {
    out.push({ field: "desc", text: `The description runs to ${count(desc)} characters, and a description keeps ${count(GEAR_LIMITS.descMax)} at most. Shorten it.` });
  }
  return out;
}
