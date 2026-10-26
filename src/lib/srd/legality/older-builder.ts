// A character builder older than a species' own picks. The apps compile the
// server's pages when they are built, so an app in people's hands runs the
// builder of the server it was built with against whatever host it joins:
// the 0.30.2 builder (client 0.21.2) has no picker for a workshop species'
// choice of packages (racialChoices.variant) and one cantrip picker however
// many the species offers (racialChoices.cantrips). Its sheets leave both
// keys out, which today's builder never does (it sends them empty), so their
// absence is what says the page could not ask.
//
// Such a sheet is not refused for a pick its page could not make. Made, the
// pick is owed, as a character file older than the choice owes it
// (species-variant.ts, racial-cantrips.ts), and the builder of today asks
// for it when the character is opened there. Edited, the stored character
// keeps the picks it holds, as the builder keeps every field it has no
// control for (submit.ts keepUnedited). Leaving a pick out never gains a
// character anything: an option or a cantrip owed is one it does not have.
import { textKey } from "@/lib/language/text-logic";
import { racialCantripsOf, type RacialCantripChoices } from "@/lib/srd/racial-cantrips";

// Which of the two picks the page that built the sheet had no field for.
export type OlderBuilder = { variant: boolean; cantrips: boolean };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// Read off the sheet as it was sent, before the schema fills its defaults.
// Null for a sheet from a builder that knows both.
export function olderBuilderOf(sentSheet: unknown): OlderBuilder | null {
  const choices = record(record(sentSheet).racialChoices);
  const variant = !("variant" in choices);
  const cantrips = !("cantrips" in choices);
  return variant || cantrips ? { variant, cantrips } : null;
}

type HeldChoices = { variant?: string; cantrip?: string; cantrips?: string[] } | undefined;

// The option an older page's edit keeps: the stored character's, while it is
// still the same species and the species still offers it. Anything else is
// owed.
export function carriedVariant(
  held: { race: string; racialChoices?: HeldChoices } | null,
  race: string,
  offered: readonly string[],
): string {
  if (!held || textKey(held.race) !== textKey(race)) {
    return "";
  }
  const id = (held.racialChoices?.variant ?? "").trim();
  return offered.includes(id) ? id : "";
}

// The cantrip picks an older page's edit keeps. That builder shows the first
// of the stored picks (the sheet's `cantrip`) and sends it back, or the one
// the player put in its place; the stored picks after it stay as they were.
export function carriedCantrips(
  sent: RacialCantripChoices,
  held: { race: string; racialChoices?: HeldChoices } | null,
  race: string,
): RacialCantripChoices {
  if (!held || textKey(held.race) !== textKey(race)) {
    return sent;
  }
  const stored = racialCantripsOf(held.racialChoices);
  if (stored.length < 2) {
    return sent;
  }
  const first = (sent?.cantrip ?? "").trim() || stored[0];
  const rest = stored.slice(1).filter((name) => textKey(name) !== textKey(first));
  return { ...sent, cantrip: first, cantrips: [first, ...rest] };
}
