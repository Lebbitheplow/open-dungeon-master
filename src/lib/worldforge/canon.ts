import type { Calendar, Canon, Secret, WorldEvent } from "./model.ts";
import { formatYear, sortEvents } from "./time.ts";

// One canon policy for every path that hands the world to a model (audit
// finding WF-14): the gameplay prompt (src/lib/dm/world-prompt.ts), lore
// search (src/lib/dm/lore-search.ts), Ask (src/lib/worldforge/forge.ts
// worldDigest) and Draft (src/lib/dm/world-ai.ts). Each used to decide for
// itself, so an alternate event read as plain history in play while Ask
// gave retired entries as if they held. The rule:
//
//   - canon is what happened, said plainly;
//   - draft and alternate are said with their status, never as fact;
//   - retired is left out of play, and named as retired where the author
//     is the one asking (Ask);
//   - a secret the party has learned is established knowledge;
//   - events come in the world's own order, by date in its calendars, with
//     the year as its calendar writes it.
//
// Pure, so the scripts and the client can use it.

const NOTES: Record<Canon, string> = {
  canon: "",
  draft: "draft: not settled, use only if it fits",
  alternate: "alternate: one telling, not what happened",
  retired: "retired: no longer true in this world",
};

// The status a non-canon entry or event carries in a model's text, "" for
// canon.
export const canonNote = (canon: Canon): string => NOTES[canon];

// Whether an entry or event belongs in what play draws on.
export const inPlay = (canon: Canon): boolean => canon !== "retired";

// The year as its calendar writes it ("70 RT"), or "undated".
export const yearOf = (event: Pick<WorldEvent, "when">, calendars: Calendar[]): string => formatYear(event.when, calendars).primary || "undated";

// A world's events in its own order, by date: those naming any of `refs`
// when given, and without the retired unless `retired` says to keep them.
export function eventsInOrder(events: WorldEvent[], calendars: Calendar[], options: { refs?: string[]; retired?: boolean } = {}): WorldEvent[] {
  const kept = events.filter((event) => (options.retired || inPlay(event.canon)) && (!options.refs || event.refs.some((ref) => options.refs!.includes(ref))));
  return sortEvents(kept, calendars);
}

// One event as a model reads it: its year, its title, its status when not
// canon, and as much of its account as `bodyMax` allows.
export function eventLine(event: WorldEvent, calendars: Calendar[], bodyMax = 100): string {
  const note = canonNote(event.canon);
  const body = event.body && bodyMax > 0 ? ` (${event.body.length > bodyMax ? `${event.body.slice(0, bodyMax - 1).trimEnd()}…` : event.body})` : "";
  return `${yearOf(event, calendars)}: ${event.title}${note ? ` [${note}]` : ""}${body}`;
}

// The secrets the party has learned: established, no longer to be kept.
export const establishedSecrets = (secrets: Secret[]): Secret[] => secrets.filter((secret) => secret.partyKnows);
