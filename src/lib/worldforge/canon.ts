import type { Calendar, Canon, Secret, WorldEvent } from "./model.ts";
import { absoluteYear, formatYear, sortEvents } from "./time.ts";

// One canon policy for everything that hands the world to a model (audit
// finding WF-14): the narrator's world block and its WORLD LORE block,
// search_lore, and WorldForge's Ask and Draft. Each used to decide alone, so
// an alternate event reached the narrator as plain history and Ask read a
// retired entry as true. The rule, one per state:
//
//   - canon: settled, and stated as what is true.
//   - draft: not settled yet. Carried and marked: the model may use it if it
//     fits, never as something already established.
//   - alternate: another telling, not what happened in this world. Carried
//     and marked: never stated as fact, at most a rumour or a false belief.
//   - retired: no longer true. Left out of everything a model writes from for
//     the table or the page: the narrator, search_lore and Draft. The
//     author's own Ask still reads it, marked and ranked last, so a question
//     about something retired is answered rather than met with silence.
//
// Events follow the same rule as entries. Who may read a record is a
// separate decision (src/lib/db/world-publication.ts, WF-01): a player never
// reads one that is not canon. A secret the party has learned is established
// for the party; one it has not stays the DM's. Pure.

// "play": the narrator, search_lore and Draft. "ask": the author's Ask.
export type CanonReader = "play" | "ask";

const MEANING: Record<Exclude<Canon, "canon">, string> = {
  draft: "not settled yet; use it only if it fits, never as established",
  alternate: "another telling, not what happened in this world; never state it as fact",
  retired: "no longer true in this world",
};
const RANK: Record<Canon, number> = { canon: 0, draft: 1, alternate: 2, retired: 3 };

export function canonAdmits(canon: Canon, reader: CanonReader): boolean {
  return canon !== "retired" || reader === "ask";
}

// Settled first, retired last: the order a budget drops them in.
export function canonRank(canon: Canon): number {
  return RANK[canon];
}

// " [draft]" after a name or an event, "" for canon.
export function canonTag(canon: Canon): string {
  return canon === "canon" ? "" : ` [${canon}]`;
}

// The state and what it means, for a record read on its own (a search
// result, a lore line): "draft: not settled yet; ...", "" for canon. Loud
// puts the state in capitals, the way the WORLD LORE block marks a secret.
export function canonMeaning(canon: Canon, loud = false): string {
  return canon === "canon" ? "" : `${loud ? canon.toUpperCase() : canon}: ${MEANING[canon]}`;
}

// One line saying what the tags in a block mean, only those it uses: "" when
// everything in it is canon.
export function canonLegend(states: Iterable<Canon>): string {
  const seen = new Set(states);
  const parts = (["draft", "alternate", "retired"] as const).filter((state) => seen.has(state)).map((state) => `[${state}] ${MEANING[state]}.`);
  return parts.length ? `WorldForge marks what is not canon: ${parts.join(" ")}` : "";
}

// The events a model reads, by the policy: the ones the reader may have,
// the settled and the preferred first, then the latest in the world's own
// time, up to max; returned in time order, so the history reads forward
// whatever order the author entered it in.
export function pickEvents(
  events: WorldEvent[],
  calendars: Calendar[],
  reader: CanonReader,
  max: number,
  prefer: (event: WorldEvent) => boolean = () => false,
): WorldEvent[] {
  const latest = (a: WorldEvent, b: WorldEvent) => {
    const ya = absoluteYear(a.when, calendars);
    const yb = absoluteYear(b.when, calendars);
    if (ya === yb) return 0;
    return ya === Infinity ? 1 : yb === Infinity ? -1 : yb - ya;
  };
  const chosen = events
    .filter((event) => canonAdmits(event.canon, reader))
    .sort((a, b) => Number(prefer(b)) - Number(prefer(a)) || canonRank(a.canon) - canonRank(b.canon) || latest(a, b))
    .slice(0, Math.max(0, max));
  return sortEvents(chosen, calendars);
}

// "61 TR (= 1301 AF): The sea wall falls [alternate]": the year in its own
// calendar, the same moment in the others when asked for, and the tag.
export function eventLine(event: WorldEvent, calendars: Calendar[], conversions = false): string {
  const year = formatYear(event.when, calendars);
  const when = year.primary ? `${year.primary}${conversions && year.conversions ? ` (${year.conversions})` : ""}: ` : "";
  return `${when}${event.title}${canonTag(event.canon)}`;
}

// Where a secret stands with the party, in the words a model reads.
export function secretStanding(secret: Pick<Secret, "partyKnows">): string {
  return secret.partyKnows ? "the party has learned this; it is established for them" : "DM only: the party has not learned this";
}
