import { workshopClassName } from "@/lib/classes/workshop-registry";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A sheet's race, class and background as the AI GM and the table read them:
// a homebrew entry's or a workshop class's name, never its id ("homebrew:<id>",
// "homebrew-<id>"), which tells a reader nothing (issue 569). The rules keep
// reading the ids; these are only the words.

export function raceWords(sheet: Pick<CharacterSheet, "race" | "raceLabel">): string {
  return sheet.raceLabel ?? sheet.race.replaceAll("_", " ");
}

export function classWords(classId: string): string {
  return workshopClassName(classId) ?? classId;
}

export function backgroundWords(sheet: Pick<CharacterSheet, "background" | "backgroundLabel">): string {
  return sheet.backgroundLabel ?? sheet.background;
}
