// A character's class and level in words, wherever a card, a row or a
// heading names them (backlog F9): one class reads as it always has, a
// split names each class's levels, the first class first ("fighter 3 /
// rogue 2"). Pure, so the builder, the lobby, the roster and the library
// all say a split the same way, and scripts/test-builder-multiclass.mjs
// reads it directly.

import { workshopClassName } from "@/lib/classes/workshop-registry";

export type ClassWordsSource = {
  class: string;
  level: number;
  classes?: ReadonlyArray<{ id: string; level: number }> | null;
};

const asIs = (id: string) => id;

// Whether the character holds more than one class.
export function isSplit(source: Pick<ClassWordsSource, "classes">): boolean {
  return (source.classes?.length ?? 0) > 1;
}

// "fighter 5", or "fighter 3 / rogue 2": the class with the level, each
// class with its own levels on a split. `nameOf` turns an id into the
// words shown (a display name, title case); the id itself by default.
export function classLevelWords(source: ClassWordsSource, nameOf: (id: string) => string = asIs): string {
  return isSplit(source)
    ? (source.classes ?? []).map((entry) => `${nameOf(entry.id)} ${entry.level}`).join(" / ")
    : `${nameOf(source.class)} ${source.level}`;
}

// The class part of a line that already says the level ("Level 5 Hill
// Dwarf Fighter"): the class alone, or each class's levels on a split
// ("Level 5 Hill Dwarf Fighter 3 / Rogue 2").
export function classWordsAfterLevel(source: ClassWordsSource, nameOf: (id: string) => string = asIs): string {
  return isSplit(source) ? classLevelWords(source, nameOf) : nameOf(source.class);
}

// ---- names on a card ----
//
// A sheet keeps its species and classes as ids ("bhain-kwai", "plague_doctor"),
// and a card that printed them showed the id to the table (the lobby's
// companion card, the party roster). Every card reads its words here instead,
// so the roster says what the sheet dialog and the library already say.

// An id as a name: "bhain-kwai" is "Bhain Kwai", "plague_doctor" "Plague
// Doctor". A homebrew id names nothing a reader can use, so it is "".
export function idAsName(id: string): string {
  const value = String(id ?? "").trim();
  if (/^homebrew[:-]/.test(value)) {
    return "";
  }
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

// A class's name: a workshop class's own name, else its id as a name.
export function className(id: string): string {
  return workshopClassName(id) ?? idAsName(id);
}

// A species' name: the homebrew name the server derived, else its id as a name.
export function speciesName(source: { race: string; raceLabel?: string | null }): string {
  return source.raceLabel || idAsName(source.race);
}

// "Bhain Kwai Fighter 3 / Rogue 2": the species and each class with its levels,
// as a card's second line reads.
export function speciesAndClassWords(source: ClassWordsSource & { race: string; raceLabel?: string | null }): string {
  return [speciesName(source), classLevelWords(source, className)].filter(Boolean).join(" ");
}
