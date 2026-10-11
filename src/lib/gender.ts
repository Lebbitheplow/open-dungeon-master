// A character's or an NPC's gender: one of the character builder's choices,
// or "" for unspecified. A fixed value rather than free text, so the voice
// cast, the stand-in face and the speech reader's pronouns read it the same
// way at every table, whatever language the table plays in. Pure and
// zod-free, so the builder and the NPC form import it.

export const GENDERS = ["Female", "Male", "Nonbinary"] as const;
export type Gender = (typeof GENDERS)[number] | "";

// A stored value as a choice. Sheets written through the API before the
// field was fixed may hold free text; it reads as unspecified.
export function storedGender(raw: unknown): Gender {
  return GENDERS.includes(raw as (typeof GENDERS)[number]) ? (raw as Gender) : "";
}

// The gender as "she" or "he" would stand for it: what picks a voice, and
// what the English pronouns of a speech line are matched against.
export type GenderMark = "f" | "m" | "";

export function genderMark(gender: Gender | undefined): GenderMark {
  return gender === "Female" ? "f" : gender === "Male" ? "m" : "";
}

// What the AI DM's tools and the console take when they register someone: a
// choice, or "Unknown" while the story has not shown it, stored as
// unspecified. "Unknown" never clears a gender already recorded.
export const TOLD_GENDERS = [...GENDERS, "Unknown"] as const;
export type ToldGender = (typeof TOLD_GENDERS)[number];

export function toldGender(told: ToldGender | undefined): Exclude<Gender, ""> | undefined {
  return told === "Unknown" ? undefined : told;
}

export const TOLD_GENDER_HELP = "Their gender as the story presents them, which picks their voice; Unknown until it shows.";
