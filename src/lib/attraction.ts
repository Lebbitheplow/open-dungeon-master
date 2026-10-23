// Who a character or an NPC is drawn to (issue 501): some of the genders a
// character can be, and a short note in the table's own words. Blank means
// unspecified. A character left blank who opts in to advances is open to
// anyone; an NPC left blank is undecided, and the DM fixes it the first time
// it matters (set_npc keeps the first value it is given).
//
// Identity, like gender (src/lib/gender.ts), so it is a fixed set of choices
// the server can match both ways, whatever language the table plays in.
// Pure and zod-free, so the builder, the NPC form and the test scripts
// import it directly.

import { GENDERS, type Gender } from "./gender.ts";
import { textKey } from "./language/text-logic.ts";

export type AttractionGender = (typeof GENDERS)[number];

export type Attraction = { genders: AttractionGender[]; note: string };

export const ATTRACTION_NOTE_MAX = 60;

// The chip labels, in the order the chips show, and the words the DM reads.
export const ATTRACTION_CHOICES: ReadonlyArray<{ gender: AttractionGender; label: string; word: string }> = [
  { gender: "Female", label: "Women", word: "women" },
  { gender: "Male", label: "Men", word: "men" },
  { gender: "Nonbinary", label: "Nonbinary people", word: "nonbinary people" },
];

// What the DM's tools take for drawnTo: the same words the DM reads.
export const TOLD_ATTRACTION = ATTRACTION_CHOICES.map((choice) => choice.word) as [string, ...string[]];

export const BLANK_ATTRACTION: Attraction = { genders: [], note: "" };

// Any stored or sent value as an attraction: unknown genders are dropped,
// repeats folded, the note trimmed to its length. A string is a stored JSON
// column; anything unreadable reads as blank.
export function normalizeAttraction(raw: unknown): Attraction {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = value.trim() ? JSON.parse(value) : null;
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== "object") {
    return { genders: [], note: "" };
  }
  const record = value as { genders?: unknown; note?: unknown };
  const listed = Array.isArray(record.genders) ? record.genders : [];
  const genders = GENDERS.filter((gender) => listed.includes(gender));
  const note = typeof record.note === "string" ? record.note.replace(/\s+/g, " ").trim().slice(0, ATTRACTION_NOTE_MAX) : "";
  return { genders: [...genders], note };
}

export function attractionBlank(attraction: Attraction | null | undefined): boolean {
  return !attraction || (!attraction.genders.length && !attraction.note.trim());
}

// Whether someone of `gender` fits this attraction. Blank fits anyone. A
// chosen set fits only the genders in it, so someone whose gender is
// unspecified fits only a blank one: the server never guesses.
export function drawnTo(attraction: Attraction | null | undefined, gender: Gender | undefined): boolean {
  if (!attraction || !attraction.genders.length) {
    return true;
  }
  return Boolean(gender) && attraction.genders.includes(gender as AttractionGender);
}

// Both ways: each is drawn to the other's gender.
export function attractionFits(
  a: { attraction?: Attraction | null; gender?: Gender },
  b: { attraction?: Attraction | null; gender?: Gender },
): boolean {
  return drawnTo(a.attraction, b.gender) && drawnTo(b.attraction, a.gender);
}

// "women and nonbinary people (only the brave ones)", or "" when blank.
export function attractionWords(attraction: Attraction | null | undefined): string {
  if (attractionBlank(attraction)) {
    return "";
  }
  const words = ATTRACTION_CHOICES.filter((choice) => attraction!.genders.includes(choice.gender)).map((choice) => choice.word);
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words.join("");
  const note = attraction!.note.trim();
  return list ? (note ? `${list} (${note})` : list) : note;
}

// The words a tool call sent ("women", "Men") as an attraction; unknown
// words are dropped. Null when nothing usable was sent, so a call that said
// nothing never blanks what is stored.
export function attractionFromTold(words: unknown, note?: unknown): Attraction | null {
  const list = Array.isArray(words) ? words.map((word) => textKey(String(word))) : [];
  const genders = ATTRACTION_CHOICES.filter((choice) =>
    list.some((word) => [choice.word, choice.label, choice.gender].some((name) => textKey(name) === word)),
  ).map((choice) => choice.gender);
  const text = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, ATTRACTION_NOTE_MAX) : "";
  if (!genders.length && !text) {
    return null;
  }
  return { genders, note: text };
}

export function attractionJson(attraction: Attraction | null | undefined): string {
  return attractionBlank(attraction) ? "" : JSON.stringify(normalizeAttraction(attraction));
}
