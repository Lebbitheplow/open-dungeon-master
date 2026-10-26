// The cantrips a race lets the player choose (a high elf's one wizard
// cantrip, a homebrew species' three), read off a sheet's racialChoices.
//
// The list is `cantrips`; a sheet written before a race could offer more
// than one holds its single pick in `cantrip`, and every sheet still writes
// the first pick there so an older server keeps it. Readers prefer a
// non-empty list.
//
// Pure and import-light: the builder, the legality check, the level-up
// count and the Homebrew rename all read picks through here.
import { textKey } from "@/lib/language/text-logic";

export type RacialCantripChoices = { cantrip?: string | null; cantrips?: string[] | null } | null | undefined;

// The names as the sheet holds them, trimmed, blanks dropped. Repeats are
// kept, so the legality check can refuse a sheet that names one twice.
export function namedRacialCantrips(choices: RacialCantripChoices): string[] {
  const list = (choices?.cantrips ?? []).map((name) => name.trim()).filter(Boolean);
  if (list.length) {
    return list;
  }
  const one = (choices?.cantrip ?? "").trim();
  return one ? [one] : [];
}

// The picks, each once ("Fire Bolt" and "fire bolt" are one spell).
export function racialCantripsOf(choices: RacialCantripChoices): string[] {
  const seen = new Set<string>();
  return namedRacialCantrips(choices).filter((name) => {
    const key = textKey(name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// The two fields a sheet writes for its picks.
export function racialCantripFields(picks: string[]): { cantrips: string[]; cantrip: string } {
  return { cantrips: picks, cantrip: picks[0] ?? "" };
}
