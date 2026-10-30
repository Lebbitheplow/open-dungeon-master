import { workshopClassName } from "@/lib/classes/workshop-registry";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A sheet's race, class and background as the AI GM and the table read them:
// a homebrew entry's or a workshop class's name, never its id ("homebrew:<id>",
// "homebrew-<id>"), which tells a reader nothing (issue 569). The rules keep
// reading the ids; these are only the words.

// An id's separators read as spaces, a hyphen as much as an underscore: the
// table's join note said "a bhain-kwai paladin" and "a human plague_doctor"
// (0.31.1 playtest). Kept lowercase, as a species or class reads mid-sentence.
function idWords(id: string): string {
  return id.replace(/[-_]+/g, " ");
}

export function raceWords(sheet: Pick<CharacterSheet, "race" | "raceLabel">): string {
  return sheet.raceLabel ?? idWords(sheet.race);
}

export function classWords(classId: string): string {
  return workshopClassName(classId) ?? idWords(classId);
}

export function backgroundWords(sheet: Pick<CharacterSheet, "background" | "backgroundLabel">): string {
  return sheet.backgroundLabel ?? sheet.background;
}
