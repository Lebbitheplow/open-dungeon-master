// The spell desk's filters (backlog F13): school, ritual, concentration and
// casting time, read from each tile's own row where it has one (a pack's or
// a homebrew spell's), else from the bundled spell facts. Pure, so
// scripts/test-builder-spell-desk.mjs can check it without React.
import { textKey } from "@/lib/language/text-logic";
import { bundledSpellFacts, bundledSpellSchool, castingTimeFrom, spellFlagsOf, type CastingTime } from "@/lib/srd/spell-facts";

export type CastingTimeKind = "action" | "bonus" | "reaction" | "longer";

export type SpellDeskFacts = {
  // The school as a key ("evocation"), or null when nothing says.
  school: string | null;
  ritual: boolean;
  concentration: boolean;
  castingTime: CastingTimeKind | null;
};

export type SpellFilter = {
  // A school key, or "" for any.
  school: string;
  // Only rituals.
  ritual: boolean;
  // "yes": only spells that take concentration; "no": only those that do not.
  concentration: "" | "yes" | "no";
  castingTime: "" | CastingTimeKind;
};

export const NO_SPELL_FILTER: SpellFilter = { school: "", ritual: false, concentration: "", castingTime: "" };

export const CASTING_TIME_LABELS: Record<CastingTimeKind, string> = {
  action: "1 action",
  bonus: "Bonus action",
  reaction: "Reaction",
  longer: "1 minute or longer",
};

// A school key as a player reads it: "evocation" is "Evocation". Written
// here rather than left to CSS, which a native list and a screen reader
// never see.
export function schoolLabel(school: string): string {
  return school.replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

const CASTING_TIME_WORDS: Record<CastingTimeKind, string> = {
  action: "an action",
  bonus: "a bonus action",
  reaction: "a reaction",
  longer: "a minute or longer",
};

const kindOf =(time: CastingTime): CastingTimeKind => (typeof time === "number" ? "longer" : time);

export function spellDeskFacts(tile: { name: string; data?: Record<string, unknown>; concentration?: boolean }): SpellDeskFacts {
  const bundled = bundledSpellFacts(tile.name);
  const data = tile.data;
  const rowSchool = data ? ((data.school as { name?: unknown } | undefined)?.name ?? data.school) : undefined;
  const school = typeof rowSchool === "string" && rowSchool.trim() ? textKey(rowSchool) : bundledSpellSchool(tile.name);
  const flags = data ? spellFlagsOf(data) : null;
  const hasTime = data && data.casting_time !== undefined && data.casting_time !== null && data.casting_time !== "";
  return {
    school: school || null,
    ritual: flags ? flags.ritual : Boolean(bundled?.ritual),
    concentration:
      typeof tile.concentration === "boolean" ? tile.concentration : flags ? flags.concentration : Boolean(bundled?.concentration),
    castingTime: hasTime ? kindOf(castingTimeFrom(data.casting_time)) : bundled ? kindOf(bundled.castingTime) : null,
  };
}

export function spellFilterActive(filter: SpellFilter): boolean {
  return Boolean(filter.school || filter.ritual || filter.concentration || filter.castingTime);
}

export function matchesSpellFilter(facts: SpellDeskFacts, filter: SpellFilter): boolean {
  if (filter.school && facts.school !== filter.school) return false;
  if (filter.ritual && !facts.ritual) return false;
  if (filter.concentration === "yes" && !facts.concentration) return false;
  if (filter.concentration === "no" && facts.concentration) return false;
  if (filter.castingTime && facts.castingTime !== filter.castingTime) return false;
  return true;
}

// The values worth offering: only the schools and casting times some spell
// on the page has, so no choice can only ever empty the list.
export function spellFilterOptions(facts: SpellDeskFacts[]): {
  schools: string[];
  castingTimes: CastingTimeKind[];
  anyRitual: boolean;
  anyConcentration: boolean;
} {
  const schools = [...new Set(facts.flatMap((entry) => (entry.school ? [entry.school] : [])))].sort();
  const times = new Set(facts.flatMap((entry) => (entry.castingTime ? [entry.castingTime] : [])));
  return {
    schools,
    castingTimes: (["action", "bonus", "reaction", "longer"] as CastingTimeKind[]).filter((kind) => times.has(kind)),
    anyRitual: facts.some((entry) => entry.ritual),
    anyConcentration: facts.some((entry) => entry.concentration),
  };
}

export type SpellFilterOptions = ReturnType<typeof spellFilterOptions>;

// The filter as it can stand on this page: a value the page no longer
// offers (a casting time no spell in a wizard's book has, once the book is
// being prepared from) is dropped, so no filter is ever on while its
// control shows "any" or is not drawn at all.
export function liveSpellFilter(filter: SpellFilter, options: SpellFilterOptions): SpellFilter {
  return {
    school: options.schools.length > 1 && options.schools.includes(filter.school) ? filter.school : "",
    castingTime:
      options.castingTimes.length > 1 && filter.castingTime && options.castingTimes.includes(filter.castingTime) ? filter.castingTime : "",
    concentration: options.anyConcentration ? filter.concentration : "",
    ritual: options.anyRitual && filter.ritual,
  };
}

export function sameSpellFilter(a: SpellFilter, b: SpellFilter): boolean {
  return a.school === b.school && a.castingTime === b.castingTime && a.concentration === b.concentration && a.ritual === b.ritual;
}

// The value a picker holds for "any" (the kit's Select wants a value).
export const ANY_SPELL_FILTER = "any";

export type SpellFilterPicker = {
  key: "school" | "castingTime" | "concentration";
  label: string;
  // `ANY_SPELL_FILTER` for no filter; each label carries its picker's name,
  // so a closed picker reads "School: Evocation" on its own.
  options: Array<{ value: string; label: string }>;
};

// The pickers worth drawing, each only when it can narrow the list: a
// school or casting time once two are on the page, concentration once some
// spell asks for it. The ritual filter is a checkbox beside them.
export function spellFilterPickers(options: SpellFilterOptions): SpellFilterPicker[] {
  const picker = (key: SpellFilterPicker["key"], label: string, values: Array<{ value: string; label: string }>): SpellFilterPicker => ({
    key,
    label,
    options: [{ value: ANY_SPELL_FILTER, label: `${label}: any` }, ...values.map((entry) => ({ value: entry.value, label: `${label}: ${entry.label}` }))],
  });
  return [
    ...(options.schools.length > 1
      ? [picker("school", "School", options.schools.map((school) => ({ value: school, label: schoolLabel(school) })))]
      : []),
    ...(options.castingTimes.length > 1
      ? [picker("castingTime", "Casting time", options.castingTimes.map((kind) => ({ value: kind, label: CASTING_TIME_LABELS[kind] })))]
      : []),
    ...(options.anyConcentration
      ? [
          picker("concentration", "Concentration", [
            { value: "yes", label: "needs it" },
            { value: "no", label: "not needed" },
          ]),
        ]
      : []),
  ];
}

// The filter with one picker's choice in it.
export function withSpellFilterPick(filter: SpellFilter, key: SpellFilterPicker["key"], value: string): SpellFilter {
  const chosen = value === ANY_SPELL_FILTER ? "" : value;
  if (key === "castingTime") {
    return { ...filter, castingTime: chosen as SpellFilter["castingTime"] };
  }
  if (key === "concentration") {
    return { ...filter, concentration: chosen as SpellFilter["concentration"] };
  }
  return { ...filter, school: chosen };
}

// A few words for what the filters ask, for the heading over the tiles:
// "Evocation, ritual, no concentration".
export function spellFilterWords(filter: SpellFilter): string {
  return [
    filter.school ? schoolLabel(filter.school) : "",
    filter.ritual ? "ritual" : "",
    filter.concentration === "yes" ? "concentration" : filter.concentration === "no" ? "no concentration" : "",
    filter.castingTime ? CASTING_TIME_WORDS[filter.castingTime] : "",
  ]
    .filter(Boolean)
    .join(", ");
}
