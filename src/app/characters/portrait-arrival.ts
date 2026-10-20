// The roster's portrait as it arrives (backlog F25): what each card's
// portrait is doing, and which ones changed between two reads of the
// library. A portrait that was painting and now has a picture is "ready",
// once; the page fades it in and says so in a toast. One that was painting
// and now failed says so on its card. A portrait already painted when the
// page opened is not news.

export type PortraitPhase = "painted" | "painting" | "failed" | "none";

export type PortraitSubject = {
  id: string;
  name: string;
  portraitStatus?: "queued" | "generating" | "failed" | null;
  sheet?: { portrait?: { url: string } | null };
};

export function portraitPhase(character: PortraitSubject): PortraitPhase {
  if (character.sheet?.portrait?.url) {
    return "painted";
  }
  if (character.portraitStatus === "queued" || character.portraitStatus === "generating") {
    return "painting";
  }
  return character.portraitStatus === "failed" ? "failed" : "none";
}

export function portraitPhases(characters: PortraitSubject[]): Record<string, PortraitPhase> {
  return Object.fromEntries(characters.map((character) => [character.id, portraitPhase(character)]));
}

// The portraits that finished painting between `before` and `characters`.
// A character missing from `before` (just imported or duplicated) is not
// counted: nobody was waiting on it.
export function portraitsReady(
  before: Record<string, PortraitPhase>,
  characters: PortraitSubject[],
): { id: string; name: string }[] {
  return characters
    .filter((character) => before[character.id] === "painting" && portraitPhase(character) === "painted")
    .map((character) => ({ id: character.id, name: character.name }));
}

export function portraitReadyLine(name: string) {
  return `${name}'s portrait is ready`;
}

// How long the toast stays. It never takes focus, so it may leave on its own.
export const PORTRAIT_TOAST_MS = 5000;
