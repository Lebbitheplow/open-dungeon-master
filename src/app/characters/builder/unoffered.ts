// The stored picks the option lists do not hold (issue 229): a table's own
// species, a pack row the server no longer has. A race, class or background
// the builder cannot find shows as not chosen; the wizard names each one and
// holds the save until the player picks on purpose. A pick the player
// changed is theirs, so only the stored one still selected counts.
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import { findRace } from "./useBuilderState";

export function unofferedPicks(
  initial: CreateSheetInput,
  state: { raceId: string; classId: string; backgroundId: string },
  races: RaceOption[],
  classes: ClassOption[],
  backgrounds: BackgroundOption[],
): Array<{ what: string }> {
  const words = (id: string) => id.replace(/[-_]/g, " ");
  const missing: Array<{ what: string }> = [];
  if (initial.race && state.raceId === initial.race && !findRace(races, initial.race)) {
    missing.push({ what: `race (${words(initial.race)})` });
  }
  if (initial.class && state.classId === initial.class && !classes.some((entry) => entry.id === initial.class)) {
    missing.push({ what: `class (${words(initial.class)})` });
  }
  if (
    initial.background &&
    state.backgroundId === initial.background &&
    !backgrounds.some((entry) => entry.id === initial.background)
  ) {
    missing.push({ what: `background (${words(initial.background)})` });
  }
  return missing;
}

export function listWords(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
