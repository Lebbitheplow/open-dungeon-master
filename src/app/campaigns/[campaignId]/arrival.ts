import type { CharacterSheet } from "@/lib/schemas/sheet";

// The lobby's arrival moment (backlog F27): when a player seats a character,
// everyone in the lobby sees "Thornwick takes a seat". Read off the sheets
// the campaign stream already keeps (a seat lands as sheet_updated), so no
// new channel and nothing about joining changes. The sheets present when
// the lobby opened are the baseline and never replay; companions are the
// story's, not a player taking a seat.

export type Arrival = Pick<CharacterSheet, "id" | "name" | "race" | "raceLabel" | "class" | "gender" | "portrait">;

type Seatable = Pick<CharacterSheet, "id" | "isCompanion">;

export function seatedIds(sheets: Seatable[]): string[] {
  return sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.id);
}

// The player characters in `sheets` that `known` has not seen.
export function newArrivals<T extends Seatable>(known: string[], sheets: T[]): T[] {
  const seen = new Set(known);
  return sheets.filter((sheet) => !sheet.isCompanion && !seen.has(sheet.id));
}

export function arrivalLine(sheet: Pick<CharacterSheet, "name">) {
  return `${sheet.name} takes a seat`;
}

// "Hill dwarf · Fighter", as the lobby's party list names them.
export function arrivalDetail(sheet: Pick<CharacterSheet, "race" | "raceLabel" | "class">) {
  return `${sheet.raceLabel ?? sheet.race.replaceAll("_", " ")} · ${sheet.class}`;
}

// What the banner knows: every player character it has seen, and the
// arrivals still to show, oldest first.
export type ArrivalState = { known: string[]; queue: Arrival[] };

export function startArrivals(sheets: (Arrival & Seatable)[]): ArrivalState {
  return { known: seatedIds(sheets), queue: [] };
}

// A new read of the sheets. Returns the same state when nobody new sat
// down, so a caller can tell "nothing happened" by identity.
export function seeSheets(state: ArrivalState, sheets: (Arrival & Seatable)[]): ArrivalState {
  const fresh = newArrivals(state.known, sheets);
  if (!fresh.length) {
    return state;
  }
  return {
    known: [...state.known, ...fresh.map((sheet) => sheet.id)],
    queue: [...state.queue, ...fresh.map(pickArrival)].slice(-ARRIVAL_QUEUE),
  };
}

// The arrival on show is dismissed (Dismiss, Escape, or its time ran out).
export function dismissArrival(state: ArrivalState): ArrivalState {
  return state.queue.length ? { ...state, queue: state.queue.slice(1) } : state;
}

// Whether the banner waits for Dismiss rather than leaving on its own:
// under low effects or reduced motion it holds still and stays.
export function arrivalStays(options: { lowEffects: boolean; reducedMotion: boolean }) {
  return options.lowEffects || options.reducedMotion;
}

function pickArrival(sheet: Arrival): Arrival {
  return {
    id: sheet.id,
    name: sheet.name,
    race: sheet.race,
    raceLabel: sheet.raceLabel,
    class: sheet.class,
    gender: sheet.gender,
    portrait: sheet.portrait,
  };
}

// How long the banner stays when it may leave on its own.
export const ARRIVAL_MS = 4500;
// The queue a busy lobby can build; past it the oldest arrivals are dropped.
export const ARRIVAL_QUEUE = 4;
