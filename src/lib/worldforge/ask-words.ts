// The words Ask says about its passages (ask.ts), shared by the prompt and
// the screen (src/app/workshop/world/AskView.tsx). Kept apart from ask.ts so
// the screen does not carry the search's stemmers. Pure.

export type AskPart = "facts" | "article" | "hidden" | "event" | "secret";

// The matches the budget left out: how many, and from what (the first few
// names, and how many others).
export type AskOmitted = { count: number; names: string[]; others: number };

// Where in its entry a passage comes from: "article, passage 4 of 9".
export function partWords(part: AskPart, at: number, of: number): string {
  if (part === "article") return of > 1 ? `article, passage ${at} of ${of}` : "article";
  return part === "facts" ? "facts" : part === "hidden" ? "hidden truth" : part === "event" ? "timeline event" : "secret";
}

// "7 more matching passages were left out for space, from Mira Fenn,
// Gullhaven and 2 others."
export function omittedLine(omitted: AskOmitted): string {
  const from = [...omitted.names, ...(omitted.others ? [`${omitted.others} other${omitted.others === 1 ? "" : "s"}`] : [])];
  const list = from.length > 1 ? `${from.slice(0, -1).join(", ")} and ${from.at(-1)}` : from.join("");
  return `${omitted.count} more matching passage${omitted.count === 1 ? " was" : "s were"} left out for space, from ${list}.`;
}

// The citation groups in an answer: "[2]", "[2][5]" and "[2, 5]". Each
// match's first group holds the numbers.
export const CITATION = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;

export function citationNumbers(group: string): number[] {
  return group.split(/[,;]/).map((number) => Number(number.trim()));
}
